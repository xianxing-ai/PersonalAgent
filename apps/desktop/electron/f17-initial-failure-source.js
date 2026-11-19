import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';

const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F17 原任务的失败命令与前后版本回执不匹配');};

/** Read existing, consecutive Competition ToolGateway receipts on this exact task.
 * Neither the native case file nor the model can supply output, authority or another task. */
export function readF17InitialFailure(application,scope,selection) {
  const runtime=application.runtime,task=runtime.getTask(scope.taskId);
  if(scope.signal.aborted||task.cancelRequested||!['running','waiting_approval'].includes(task.state)
    ||runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
    ||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail();
  const loop=runtime.loadCheckpoint(scope.taskId,'competition-loop'),refs=selection.initialFailure;
  if(refs?.kind!=='competition'||!Array.isArray(loop?.receipts))fail();
  const names=['workspace.git.head','workspace.run_allowed_command','workspace.git.head'];
  const ids=[refs.beforeRunId,refs.commandRunId,refs.afterRunId];
  const indexes=ids.map(id=>loop.receipts.findIndex(receipt=>receipt.runId===id));
  if(indexes[0]<0||indexes.some((index,i)=>index!==indexes[0]+i)||new Set(ids).size!==3)fail();
  const sources=ids.map((runId,i)=>{
    const matches=loop.receipts.filter(receipt=>receipt.runId===runId),entry=matches[0];
    const original=application.readAuthorizationQuestionInvocation(scope.taskId,runId,true);
    const records=runtime.readToolExecutions(scope.taskId).filter(record=>record.evidenceId===runId),record=records[0];
    const saved=runtime.loadCheckpoint(scope.taskId,'tool-result-'+runId);
    const descriptor=runtime.readToolDescriptors().find(tool=>tool.name===names[i]&&tool.version==='1.0.0');
    const args=i===1?{recipeId:selection.recipeId}:{repository:selection.repository};
    if(typeof runId!=='string'||!runId.startsWith('competition-tool-'+scope.taskId+'-')||matches.length!==1
      ||entry.workerSelection!==undefined||entry.continuation?.state!=='confirmed'
      ||entry.continuation.proposalId!==entry.proposal?.proposalId||entry.proposal.toolName!==names[i]||entry.proposal.toolVersion!=='1.0.0'
      ||!isDeepStrictEqual(entry.proposal.arguments,args)||!original||original.deadline!==scope.deadline
      ||original.toolName!==names[i]||original.toolVersion!=='1.0.0'||!isDeepStrictEqual(original.arguments,args)
      ||records.length!==1||record.taskId!==scope.taskId||record.toolName!==names[i]||record.toolVersion!=='1.0.0'
      ||record.state!=='confirmed'||record.policyDecision!=='allow'||!record.executionStarted
      ||!task.evidenceRefs.includes(runId)||!runtime.matchesToolExecutionInput(record,{arguments:args,scopeRef:runId})
      ||!saved||!Object.hasOwn(saved,'result')||!descriptor)fail();
    // Exported continuation may be a projection. Only the original locally saved output is evidence.
    validateToolValue(descriptor.outputSchema,saved.result);
    return structuredClone({taskId:scope.taskId,runId,entry,original,record,result:saved.result});
  });
  const [before,command,after]=sources;
  const times=sources.flatMap(source=>[source.record.startedAt,source.record.finishedAt]);
  if(!times.every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
    ||times.some((value,i)=>i>0&&Date.parse(value)<Date.parse(times[i-1]))
    ||!isDeepStrictEqual(before.result,after.result)||before.result.headSha!==selection.headSha
    ||!/^[a-f0-9]{64}$/.test(before.result.fingerprint)||command.result.recipeId!==selection.recipeId
    ||!Number.isSafeInteger(command.result.exitCode)||command.result.exitCode<=0
    ||typeof command.result.stdout!=='string'||typeof command.result.stderr!=='string')fail();
  return {before,command,after};
}

export function findF17InitialFailure(application,scope,selection) {
  const receipts=application.runtime.loadCheckpoint(scope.taskId,'competition-loop')?.receipts;
  if(!Array.isArray(receipts))return undefined;
  // Latest matching window only; a newer invalid/unknown reproduction cannot revive an older one.
  for(let i=receipts.length-1;i>=1;i--){
    const command=receipts[i];
    if(command.proposal?.toolName!=='workspace.run_allowed_command'
      ||!isDeepStrictEqual(command.proposal.arguments,{recipeId:selection.recipeId}))continue;
    const before=receipts[i-1],after=receipts[i+1];if(!after)return undefined;
    const initialFailure={kind:'competition',beforeRunId:before.runId,commandRunId:command.runId,afterRunId:after.runId};
    const headSha=application.runtime.loadCheckpoint(scope.taskId,'tool-result-'+before.runId)?.result?.headSha;
    const value={...selection,headSha,initialFailure};
    const proof=readF17InitialFailure(application,scope,value);
    if(application.runtime.readToolExecutions(scope.taskId).some(record=>record.toolName==='workspace.run_allowed_command'
      &&record.evidenceId!==command.runId&&Date.parse(record.startedAt)>=Date.parse(proof.command.record.finishedAt)))return undefined;
    return value;
  }
  return undefined;
}
