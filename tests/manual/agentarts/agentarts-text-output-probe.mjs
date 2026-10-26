import {createHash} from 'node:crypto';

/** Dedicated production session, public text only. No credentials, microphone, filesystem or playback. */
export async function runAgentArtsTextOutputProbe({gateway,text='这是一条公开的文字转语音验收消息。',deadline,signal,
  closeTimeoutMs=2000,maxAudioBytes=24_000*2*60,onAudio}={}) {
  if(typeof gateway?.connect!=='function'||typeof text!=='string'||!text.trim()||text.length>2000
    ||!(signal instanceof AbortSignal)||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now()
    ||!Number.isInteger(closeTimeoutMs)||closeTimeoutMs<1||closeTimeoutMs>10000
    ||!Number.isInteger(maxAudioBytes)||maxAudioBytes<2||maxAudioBytes>24_000*2*120
    ||onAudio!==undefined&&typeof onAudio!=='function')throw Error('Invalid text output probe input');
  const start=performance.now(),timings={},failures=[],transcripts=[],audio=createHash('sha256'),responseIds=new Set();
  let session,submitted=false,accepted=false,settled=false,reason='incomplete',outputAudioBytes=0,finish;
  const controller=new AbortController(),elapsed=()=>Math.round((performance.now()-start)*1000)/1000;
  const mark=name=>{timings[name]??=elapsed();};
  const completion=new Promise(resolve=>{finish=value=>{if(!settled){settled=true;reason=value;resolve();}};});
  const aborted=()=>{controller.abort();finish('cancelled');};
  signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
  const timer=setTimeout(()=>{controller.abort();finish('deadline');},Math.max(1,Date.parse(deadline)-Date.now()));
  try {
    if(!settled){
      const connecting=Promise.resolve().then(()=>gateway.connect({signal:controller.signal,deadline,
        instructions:'请逐字朗读指定公开文字。不要调用工具。',tools:[],onTool:async()=>{throw Error('Probe tools unavailable');},
        onEvent(event){
          if(settled)return;
          if(event.type==='error'){failures.push('gateway_error');finish('gateway_error');return;}
          if(!submitted)return;
          if(event.type==='audio'&&event.data instanceof Uint8Array&&event.data.byteLength){
            if(outputAudioBytes+event.data.byteLength>maxAudioBytes){failures.push('audio_limit');finish('audio_limit');return;}
            mark('outputAudioMs');audio.update(event.data);outputAudioBytes+=event.data.byteLength;
            if(typeof event.responseId==='string')responseIds.add(event.responseId);
            try{onAudio?.(new Uint8Array(event.data));}catch{failures.push('audio_sink_failed');finish('audio_sink_failed');}
          }
          if(event.type==='transcript'&&event.role==='assistant'&&event.source==='output_audio'&&event.phase==='final'
            &&typeof event.text==='string'&&event.text.trim()){mark('outputTranscriptMs');transcripts.push(event.text);}
          if(event.type==='turn_complete'){mark('turnCompleteMs');finish('turn_complete');}
        }}));
      void connecting.then(value=>{if(settled&&!session)void Promise.resolve().then(()=>value.close()).catch(()=>{});},()=>{});
      session=await Promise.race([connecting,completion.then(()=>undefined)]);
      if(session&&!settled){
        mark('sessionReadyMs');
        if(typeof session.speakText!=='function')throw Error('Text output unavailable');
        submitted=true;mark('textSubmittedMs');const receipt=await session.speakText(text);
        accepted=receipt?.accepted===true;await completion;
      }
    }
  }catch{failures.push('connect_or_submit_failed');finish('execution_error');}
  finally {
    clearTimeout(timer);signal.removeEventListener('abort',aborted);
    if(session){let closeTimer;try{
      await Promise.race([Promise.resolve().then(()=>session.close()),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error()),closeTimeoutMs);})]);
      mark('closedMs');
    }catch{failures.push('close_unconfirmed');}finally{clearTimeout(closeTimer);}}
    controller.abort();
  }
  const checks={sessionReady:timings.sessionReadyMs!==undefined,textSubmitted:submitted,
    outputTranscript:transcripts.length>0,outputAudio:outputAudioBytes>0&&outputAudioBytes%2===0,
    turnComplete:timings.turnCompleteMs!==undefined,closed:timings.closedMs!==undefined};
  return {version:'1.0',status:failures.length?'failed':Object.values(checks).every(Boolean)?'passed':'unknown',reason,
    checks,accepted,timings,failures,transcripts,responseIds:[...responseIds],outputAudioBytes,
    inputTextSha256:createHash('sha256').update(text).digest('hex'),
    outputAudioSha256:outputAudioBytes?audio.digest('hex'):null,
    audioFormat:'pcm16le-24000-mono',verification:'gateway_events_only_no_playback_or_platform_trace',elapsedMs:elapsed()};
}
