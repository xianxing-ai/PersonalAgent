import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const fields=['roundId','taskId','runId','conversationId','text','deadline'];
const digest=text=>createHash('sha256').update(text).digest('hex');
const active=record=>record&&['accepted','draining'].includes(record.receipt.state);

/** One rendition in the existing Live session. Renderer drain is never hardware playback proof. */
export function createLiveNotificationOutput({readSession,canSpeak,interrupt,now=Date.now}) {
  let original;
  const snapshot=record=>record?structuredClone(record.receipt):undefined;
  const clear=record=>{clearTimeout(record.timer);record.signal.removeEventListener('abort',record.onAbort);};
  const publish=record=>{
    try {record.onReceipt(snapshot(record));}
    catch {record.receipt.state='unknown';record.receipt.reason='receipt_persistence_unconfirmed';clear(record);}
  };
  const invalidate=(reason,stop=false)=>{
    if(!active(original))return;
    original.receipt.state='unknown';original.receipt.reason=reason;clear(original);publish(original);
    if(stop)interrupt(original.session);
  };
  const current=record=>{
    const session=readSession();
    if(!session||session!==record.session||session.controller.signal.aborted||record.signal.aborted
      ||now()>=Date.parse(record.binding.deadline)||now()>=Date.parse(session.deadline))throw Error('原语音通知会话已失效');
    const checked=record.assertCurrent();
    if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});throw Error('原通知来源核验必须同步完成');}
  };
  const valid=()=>{
    try {current(original);return true;}
    catch {invalidate('original_authority_unavailable',true);return false;}
  };
  const match=event=>{
    if(!active(original)||!valid())return false;
    if(event.renditionId!==original.receipt.renditionId||typeof event.responseId!=='string'||!event.responseId
      ||original.receipt.responseId&&event.responseId!==original.receipt.responseId){invalidate('response_identity_changed',true);return false;}
    original.receipt.responseId=event.responseId;return true;
  };
  return {
    pending:()=>!!active(original),
    available(conversationId) {
      const session=readSession();
      return !!session&&!active(original)&&canSpeak(session)&&session.conversationId===conversationId
        &&!session.controller.signal.aborted&&now()<Date.parse(session.deadline)&&typeof session.session?.speakText==='function';
    },
    speak(binding,{assertCurrent,onReceipt}={}) {
      const session=readSession(),value=Object.fromEntries(fields.map(key=>[key,binding?.[key]]));
      if(fields.some(key=>typeof value[key]!=='string'||!value[key].trim())||value.text.length>2000||value.text!==value.text.trim()
        ||!Number.isFinite(Date.parse(value.deadline))||!(binding.signal instanceof AbortSignal)
        ||typeof assertCurrent!=='function'||typeof onReceipt!=='function')throw Error('原语音通知参数或读回端口无效');
      if(original?.binding.roundId===value.roundId){
        if(!isDeepStrictEqual(original.binding,value))throw Error('原语音通知轮次已绑定其他参数');
        current(original);return snapshot(original);
      }
      if(active(original)||!canSpeak(session)||session.conversationId!==value.conversationId
        ||typeof session.session?.speakText!=='function')throw Error('当前原语音会话不可播报通知');
      const record={binding:value,session,signal:binding.signal,assertCurrent,onReceipt,
        receipt:{state:'unknown',roundId:value.roundId,taskId:value.taskId,runId:value.runId,conversationId:value.conversationId,
          deadline:value.deadline,sessionId:session.id,textDigest:digest(value.text),audioFrames:0,playbackVerified:false}};
      current(record);original=record;
      record.onAbort=()=>{invalidate('cancelled');interrupt(session);};
      record.signal.addEventListener('abort',record.onAbort,{once:true});
      record.timer=setTimeout(()=>{invalidate('expired');interrupt(session);},Math.max(1,Date.parse(value.deadline)-now()));record.timer.unref?.();
      // Mark the attempt before invoking the session; an exception cannot safely retry it.
      publish(record);
      if(record.receipt.reason)return snapshot(record);
      try {
        current(record);
        session.phase='speaking';
        const accepted=session.session.speakText(value.text);
        if(accepted?.accepted!==true||typeof accepted.renditionId!=='string'||!accepted.renditionId)
          throw Error('原朗读身份缺失');
        record.receipt.state='accepted';record.receipt.renditionId=accepted.renditionId;current(record);publish(record);
      }catch {record.receipt.state='unknown';record.receipt.reason='rendition_unconfirmed';clear(record);publish(record);}
      return snapshot(record);
    },
    event(event) {
      if(!active(original))return event.type==='audio'&&original?.receipt.state==='unknown'&&original.receipt.renditionId
        &&event.renditionId===original.receipt.renditionId?{dropAudio:true}:undefined;
      if(event.type==='speech_started'||event.type==='interrupted'){invalidate('interrupted');return undefined;}
      if(event.type==='audio'){
        if(!match(event))return {dropAudio:true};
        original.receipt.audioFrames++;
      }
      if(event.type==='transcript'&&event.role==='assistant'){
        if(!match(event))return undefined;
        if(event.phase!=='final'||event.source!=='output_audio'||event.text!==original.binding.text){invalidate('rendition_text_changed',true);return undefined;}
        original.textMatched=true;
      }
      if(event.type==='turn_complete'&&match(event)){
        if(original.receipt.state==='draining')return {drainId:original.receipt.drainId};
        if(!original.textMatched||!original.receipt.audioFrames){invalidate('rendition_incomplete');return undefined;}
        original.receipt.state='draining';original.receipt.drainId=randomUUID();publish(original);
        return original.receipt.state==='draining'?{drainId:original.receipt.drainId}:undefined;
      }
      return undefined;
    },
    drained(message) {
      if(original?.receipt.state!=='draining'||message.drainId!==original.receipt.drainId||!valid())return false;
      original.receipt.state='renderer_completed';original.receipt.completedAt=new Date(now()).toISOString();
      clear(original);publish(original);return true;
    },
    read(binding) {
      if(!original||!(binding?.signal instanceof AbortSignal)||binding.signal.aborted
        ||!isDeepStrictEqual(original.binding,Object.fromEntries(fields.map(key=>[key,binding?.[key]]))))return undefined;
      try {current(original);}catch{return undefined;}
      return snapshot(original);
    },
    invalidate,
  };
}
