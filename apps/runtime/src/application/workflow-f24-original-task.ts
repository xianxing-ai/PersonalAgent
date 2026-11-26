import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';

export type F24RecoveryScope={taskId:string;deadline:string;signal:AbortSignal};
export interface F24OriginalTask {
  sourceTaskId:string;sourceRunId:string;conversationId:string;sourceDeadline:string;
  sourceId:string;configRevision:number;
  toolName:'knowledge.apply_note_patch';toolVersion:'1.0.0';inputDigest:string;argumentsDigest:string;
}
const key='f24:original-recovery-target';
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Historical tool identity is not authority. Only the current delegated user
 * conversation may select its own existing write, and only for readback. */
export function readF24OriginalTask(application:RuntimeApplication,namespace:string,scope:F24RecoveryScope,sourceTaskId:string):F24OriginalTask {
  if(scope.signal.aborted)fail('CANCELLED','Original F24 request cancelled');
  if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original F24 request expired');
  const owner=application.runtime.getTask(scope.taskId),parent=application.readDelegatedUserTaskParent(scope.taskId);
  if(!parent||parent.deadline!==scope.deadline||owner.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(owner.state)
    ||application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
    ||sourceTaskId===scope.taskId||sourceTaskId===parent.taskId||application.readToolConversation(sourceTaskId)!==parent.conversationId)
    fail('UNAUTHORIZED','F24 target must belong to the current original user conversation');
  const runtime=application.runtime,task=runtime.getTask(sourceTaskId);
  const intent=runtime.loadCheckpoint(sourceTaskId,'host-tool-intent') as
    {namespace?:string;toolName?:string;toolVersion?:string;arguments?:Record<string,unknown>;argumentsDigest?:string;deadline?:string}|undefined;
  const sourceRunId='host-tool-'+sourceTaskId,record=runtime.readToolExecutions(sourceTaskId).find(item=>item.evidenceId===sourceRunId);
  if(!intent||intent.namespace!==namespace||task.conversationId!=='host-tool:'+namespace||intent.toolName!=='knowledge.apply_note_patch'
    ||intent.toolVersion!=='1.0.0'||!intent.arguments||intent.argumentsDigest!==toolArgumentsDigest(intent.arguments)
    ||typeof intent.arguments.sourceId!=='string'||!intent.arguments.sourceId||!Number.isSafeInteger(intent.arguments.configRevision)
    ||Number(intent.arguments.configRevision)<1||typeof intent.deadline!=='string'||!Number.isFinite(Date.parse(intent.deadline))||!record
    ||record.taskId!==sourceTaskId||record.toolName!==intent.toolName||record.toolVersion!==intent.toolVersion
    ||record.policyDecision!=='allow'||!record.executionStarted
    ||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:sourceRunId})
    ||!(task.state==='waiting_reconciliation'&&['started','unknown'].includes(record.state)
      ||['applied','not_applied'].includes(String(record.reconciliationOutcome))))
    fail('UNSUPPORTED_CAPABILITY','F24 requires an original knowledge write awaiting or having completed readback');
  return {sourceTaskId,sourceRunId,conversationId:parent.conversationId,sourceDeadline:intent.deadline,
    sourceId:intent.arguments.sourceId as string,configRevision:intent.arguments.configRevision as number,
    toolName:'knowledge.apply_note_patch',toolVersion:'1.0.0',inputDigest:record.inputDigest,argumentsDigest:intent.argumentsDigest};
}

/** One immutable selection per original delegated worker; no new operation ID. */
export function bindF24OriginalTask(application:RuntimeApplication,namespace:string,scope:F24RecoveryScope,sourceTaskId:string):F24OriginalTask {
  const input=readF24OriginalTask(application,namespace,scope,sourceTaskId),record={deadline:scope.deadline,input};
  const saved=application.runtime.loadCheckpoint(scope.taskId,key);
  if(saved!==undefined&&!isDeepStrictEqual(saved,record))fail('REVISION_CONFLICT','Original F24 target changed');
  if(saved===undefined&&!application.runtime.saveCheckpointOnce(scope.taskId,key,record))fail('REVISION_CONFLICT','F24 target was concurrently selected');
  return input;
}

export function assertF24OriginalTask(application:RuntimeApplication,namespace:string,scope:F24RecoveryScope):F24OriginalTask {
  const saved=application.runtime.loadCheckpoint(scope.taskId,key) as {deadline?:string;input?:F24OriginalTask}|undefined;
  if(!saved?.input||saved.deadline!==scope.deadline)fail('UNAUTHORIZED','Original F24 target is not bound');
  const current=readF24OriginalTask(application,namespace,scope,saved.input.sourceTaskId);
  if(!isDeepStrictEqual(saved.input,current))fail('REVISION_CONFLICT','Original F24 target identity changed');
  return current;
}
