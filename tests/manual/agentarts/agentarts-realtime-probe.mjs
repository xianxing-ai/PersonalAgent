import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

/** Parse public, uncompressed 16 kHz mono signed PCM16 WAV without recording or decoding media. */
export function parseRealtimeProbeWav(bytes) {
  const data=Buffer.from(bytes);
  if(data.length<12||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE'||data.readUInt32LE(4)+8!==data.length)throw Error('Invalid PCM WAV fixture');
  let format=false,pcm;
  for(let offset=12;offset+8<=data.length;){
    const name=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8;
    if(start+length>data.length)throw Error('Truncated PCM WAV fixture');
    if(name==='fmt '){
      if(format||length<16||data.readUInt16LE(start)!==1||data.readUInt16LE(start+2)!==1||data.readUInt32LE(start+4)!==16000
        ||data.readUInt32LE(start+8)!==32000||data.readUInt16LE(start+12)!==2||data.readUInt16LE(start+14)!==16)throw Error('Expected 16 kHz mono PCM16 fixture');
      format=true;
    }
    if(name==='data'){if(pcm)throw Error('Multiple WAV data chunks');pcm=data.subarray(start,start+length);}
    offset=start+length+(length%2);
  }
  if(!format||!pcm?.length||pcm.length%2)throw Error('Missing PCM WAV fixture');
  return new Uint8Array(pcm);
}

export async function readRealtimeProbeFixture(path,{format='wav'}={}) {
  const data=await readFile(path);
  if(format==='wav')return parseRealtimeProbeWav(data);
  if(format!=='pcm16le-16000-mono'||!data.length||data.length%2)throw Error('Invalid public PCM fixture');
  return new Uint8Array(data);
}

/** Inject the production gateway. This module never reads credentials, opens sockets or touches audio devices. */
export async function runAgentArtsRealtimeProbe({gateway,pcmBytes,deadline,signal,instructions='请简短回答听到的问题。',
  chunkDurationMs=100,trailingSilenceMs=1200,pace=true,closeTimeoutMs=2000}={}) {
  if(typeof gateway?.connect!=='function'||!(pcmBytes instanceof Uint8Array)||!pcmBytes.length||pcmBytes.length%2
    ||!(signal instanceof AbortSignal)||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now()
    ||!Number.isInteger(chunkDurationMs)||chunkDurationMs<20||chunkDurationMs>200
    ||!Number.isInteger(trailingSilenceMs)||trailingSilenceMs<600||trailingSilenceMs>5000
    ||!Number.isInteger(closeTimeoutMs)||closeTimeoutMs<1||closeTimeoutMs>10000)throw Error('Invalid realtime probe input');
  const start=performance.now(),timings={},audio=createHash('sha256');let outputAudioBytes=0,inputAudioBytes=0;
  const transcripts={input:[],output:[]},failures=[];
  let session,settled=false,reason='incomplete',finish;
  const controller=new AbortController();
  const elapsed=()=>Math.round((performance.now()-start)*1000)/1000;
  const mark=name=>{timings[name]??=elapsed();};
  const completion=new Promise(resolve=>{finish=value=>{if(!settled){settled=true;reason=value;resolve();}};});
  const aborted=()=>{controller.abort();finish('cancelled');};
  signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
  const timer=setTimeout(()=>{controller.abort();finish('deadline');},Math.max(1,Date.parse(deadline)-Date.now()));
  const wait=ms=>new Promise(resolve=>{
    if(controller.signal.aborted)return resolve();
    const done=()=>{clearTimeout(handle);controller.signal.removeEventListener('abort',done);resolve();};
    const handle=setTimeout(done,ms);controller.signal.addEventListener('abort',done,{once:true});
  });
  try {
    const connecting=Promise.resolve().then(()=>gateway.connect({signal:controller.signal,deadline,instructions,tools:[],
      onTool:async()=>{throw Error('Probe tools unavailable');},onEvent(event){
        if(settled)return;
        if(event.type==='error'){failures.push('gateway_error');finish('gateway_error');}
        if(event.type==='transcript'&&event.phase==='final'&&typeof event.text==='string'&&event.text.trim()){
          if(event.role==='user'&&event.source==='input_audio'){mark('inputFinalTranscriptMs');transcripts.input.push(event.text);}
          if(event.role==='assistant'&&event.source==='output_audio'){mark('outputTranscriptMs');transcripts.output.push(event.text);}
        }
        if(event.type==='audio'&&event.data instanceof Uint8Array&&event.data.byteLength){mark('outputAudioMs');audio.update(event.data);outputAudioBytes+=event.data.byteLength;}
        if(event.type==='turn_complete'){mark('turnCompleteMs');finish('turn_complete');}
      }}));
    // A late noncooperative connect is released rather than leaving a session open.
    void connecting.then(value=>{if(settled&&!session)void value.close().catch(()=>{});},()=>{});
    session=await Promise.race([connecting,completion.then(()=>undefined)]);
    if(session){
      mark('sessionReadyMs');
      const bytesPerChunk=chunkDurationMs*32;
      for(const bytes of [pcmBytes,new Uint8Array(trailingSilenceMs*32)]){
        for(let offset=0;offset<bytes.length&&!settled;offset+=bytesPerChunk){
          controller.signal.throwIfAborted();const chunk=bytes.subarray(offset,offset+bytesPerChunk);
          session.sendAudio(chunk);inputAudioBytes+=chunk.byteLength;
          if(pace)await wait(chunk.byteLength/32);
        }
      }
      mark('inputSentMs');await completion;
    }
  }catch{failures.push('connect_or_send_failed');finish('execution_error');}
  finally {
    clearTimeout(timer);signal.removeEventListener('abort',aborted);
    if(session){
      const closeStart=performance.now();let closeTimer;
      try{
        await Promise.race([Promise.resolve().then(()=>session.close()),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('close timeout')),closeTimeoutMs);})]);
        mark('closedMs');timings.closeDurationMs=Math.round((performance.now()-closeStart)*1000)/1000;
      }catch{failures.push('close_unconfirmed');}finally{clearTimeout(closeTimer);}
    }
    controller.abort();
  }
  const checks={sessionReady:timings.sessionReadyMs!==undefined,inputFinalTranscript:transcripts.input.length>0,
    outputTranscript:transcripts.output.length>0,outputAudio:outputAudioBytes>0,turnComplete:timings.turnCompleteMs!==undefined,closed:timings.closedMs!==undefined};
  const status=failures.some(value=>value!=='close_unconfirmed')?'failed':Object.values(checks).every(Boolean)?'passed':'unknown';
  return {version:'1.0',status,reason,checks,timings,failures,transcripts,inputAudioBytes,outputAudioBytes,
    outputAudioSha256:outputAudioBytes?audio.digest('hex'):null,verification:'gateway_events_only_no_playback_or_platform_trace',elapsedMs:elapsed()};
}
