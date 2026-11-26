import {ProtocolError} from '@personal-agent/contracts';
import {createHash} from 'node:crypto';
import type {TaskRuntime} from '../index.js';
import {isDirectNotepadRequest} from './capability-context.js';

export const NOTEPAD_TOOL = 'computer.desktop.launch_app';
export const NOTEPAD_INTENT = 'notepad-worker-intent:v1';
const NOTEPAD_CHILD = 'notepad-requested-child:v1';
type NotepadIntent = {parentTaskId:string;requireValue:boolean;expectedTextDigest?:string};
const textDigest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');

function requestedValue(goal:string):{requireValue:boolean;expectedTextDigest?:string} {
  for(const write of goal.matchAll(/(?:写入|输入|键入|\b(?:write|type|enter)\b)/giu)) {
    const prefix=goal.slice(Math.max(0,write.index-24),write.index);
    if(/(?:不要|不用|不必|不得|无需|禁止|避免|不|do not|don['’]t|without)\s*$/iu.test(prefix))continue;
    const tail=goal.slice(write.index+write[0].length).trim().replace(/^(?:文本|文字)\s*[:：]?\s*/u,'');
    const quoted=/^“([^”]+)”[。.!！]?$/u.exec(tail)?.[1]??/^"([^"]+)"[。.!！]?$/u.exec(tail)?.[1];
    // Bind an unambiguous literal without retaining a second private plaintext copy.
    const literal=quoted??(/^[A-Za-z0-9_]+$/u.test(tail)?tail:undefined);
    return {requireValue:true,...(literal?{expectedTextDigest:textDigest(literal)}:{})};
  }
  return {requireValue:false};
}

/** Called only after Runtime has checked the original child identity and tool binding. */
export function bindNotepadWorker(runtime:TaskRuntime,taskId:string,parentTaskId:string,subtaskId:string,childGoal:string):boolean {
  const parentGoal=runtime.getTask(parentTaskId).goal??'';
  const original=isDirectNotepadRequest(parentGoal);
  // A rewritten worker instruction may start with a role or execution requirements.
  // Only a worker assigned the requested action may inherit its parent's routing hint.
  const assigned=/(?:打开|启动|新建|\bopen\s+)\s*(?:Windows\s*)?(?:记事本|Notepad)/iu.test(childGoal);
  const goal=original&&(subtaskId==='user-work'||assigned)?parentGoal
    :isDirectNotepadRequest(childGoal)?childGoal:undefined;
  if(!goal)return false;
  const intent:NotepadIntent={parentTaskId,...requestedValue(goal)};
  const saved=runtime.loadCheckpoint(taskId,NOTEPAD_INTENT) as NotepadIntent|undefined;
  if(saved&&(saved.parentTaskId!==parentTaskId||saved.requireValue!==intent.requireValue||saved.expectedTextDigest!==intent.expectedTextDigest))
    throw new ProtocolError('REVISION_CONFLICT','记事本工人的原任务绑定已变化');
  if(!saved)runtime.saveCheckpoint(taskId,NOTEPAD_INTENT,intent);
  runtime.saveCheckpointOnce(parentTaskId,NOTEPAD_CHILD,true);
  return true;
}

/** Front-desk dispatch may have multiple attempts. Their tool receipts outrank the final chat text. */
export function assertNotepadChildrenComplete(runtime:TaskRuntime,parentTaskId:string):void {
  if(runtime.loadCheckpoint(parentTaskId,NOTEPAD_CHILD)!==true)return;
  const required=new Set<string>(),verified=new Set<string>();
  let uncertain=false,beforeSequence:number|undefined,snapshotSequence:number|undefined;
  for(;;) {
    const page=runtime.listTasks({conversationId:'desktop-subtask:'+parentTaskId,limit:100,
      ...(beforeSequence===undefined?{}:{beforeSequence}),...(snapshotSequence===undefined?{}:{snapshotSequence})});
    for(const child of page.items) {
      const intent=runtime.loadCheckpoint(child.taskId,NOTEPAD_INTENT) as NotepadIntent|undefined;
      if(intent?.parentTaskId!==parentTaskId)continue;
      const needed=intent.requireValue?'value:'+(intent.expectedTextDigest??child.taskId):'window';
      required.add(needed);
      if(child.state==='waiting_reconciliation')uncertain=true;
      if(child.state==='succeeded'){assertNotepadWorkerComplete(runtime,child.taskId);verified.add(needed);}
    }
    if(page.nextBeforeSequence===undefined)break;
    beforeSequence=page.nextBeforeSequence;snapshotSequence=page.snapshotSequence;
  }
  if(!required.size||[...required].some(needed=>!verified.has(needed)))
    throw new ProtocolError(uncertain?'RESULT_UNKNOWN':'EXTERNAL_FAILURE','工人尚未完成请求的记事本操作，请查看其原生执行记录');
}

/** Cloud prose and a confirmed dispatch are insufficient; inspect the original native tool receipt. */
export function assertNotepadWorkerComplete(runtime:TaskRuntime,taskId:string):'window'|'value'|undefined {
  const intent=runtime.loadCheckpoint(taskId,NOTEPAD_INTENT) as NotepadIntent|undefined;
  if(!intent)return;
  const runs=runtime.readToolExecutions(taskId).filter(run=>run.toolName===NOTEPAD_TOOL&&run.toolVersion==='1.0.0'
    &&run.policyDecision==='allow'&&run.executionStarted===true);
  for(const run of runs){
    if(run.state!=='confirmed')continue;
    const args=(runtime.loadCheckpoint(taskId,'application-tool-invocation:'+run.evidenceId) as
      {arguments?:Record<string,unknown>}|undefined)?.arguments;
    if(args?.app!=='notepad'||!runtime.matchesToolExecutionInput(run,{arguments:args,scopeRef:run.evidenceId})
      ||(intent.requireValue&&typeof args.text!=='string')
      ||(intent.expectedTextDigest!==undefined&&(typeof args.text!=='string'||textDigest(args.text)!==intent.expectedTextDigest)))continue;
    const result=(runtime.loadCheckpoint(taskId,'tool-result-'+run.evidenceId) as
      {result?:{source?:string;state?:string;goalVerified?:boolean;verification?:{state?:string;kind?:string}}}|undefined)?.result;
    if(result?.source==='windows-native'&&result.state==='verified'&&result.goalVerified===true&&result.verification?.state==='verified'
      &&result.verification.kind===(typeof args.text==='string'?'value':'app_launched'))return intent.requireValue?'value':'window';
  }
  const uncertain=runs.some(run=>run.state==='started'||run.state==='unknown');
  throw new ProtocolError(uncertain?'RESULT_UNKNOWN':'EXTERNAL_FAILURE',
    intent.requireValue?'工人尚未取得记事本文字的原生读回回执':'工人尚未取得记事本的原生打开回执');
}
