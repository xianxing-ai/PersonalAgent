import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {readWorkflowBusinessToolSource} from '@personal-agent/runtime/application';

/** Restore only the original F08 host receipt from its independently reconciled business child. Never invokes mail writes. */
export function createF08MailRecovery({getApplication,restoreWrite,exportResult,assertCurrent,now=Date.now}) {
  return async({taskId,deadline,signal})=>{
    const app=getApplication(),runtime=app.runtime,write=runtime.getTask(taskId),runId='host-tool-'+taskId;
    const source=runtime.loadCheckpoint(taskId,'workflow-business-tool:source');
    const child=runtime.loadCheckpoint(taskId,'host-tool-intent');
    const intent=source&&runtime.loadCheckpoint(source.sourceTaskId,'workflow-business-tool:'+source.commandId);
    const record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===runId);
    const kind=child?.toolName==='mail.archive'?'archive':'send',nodeId=kind==='archive'?'F08_N03':'F08_N07';
    const denied=()=>{throw new ProtocolError('UNAUTHORIZED','Original F08 mail recovery source is unavailable');};
    if(!source||!child||intent?.workflowId!=='F08'||intent.nodeId!==nodeId||intent.actionKey!=='f08.mail.'+kind
      ||child.toolName!=='mail.'+kind||write.cancelRequested||!['waiting_reconciliation','succeeded'].includes(write.state)
      ||!record||record.state!=='confirmed'||record.reconciliationOutcome!=='applied'||record.policyDecision!=='allow'||!record.executionStarted
      ||!runtime.matchesToolExecutionInput(record,{arguments:child.arguments,scopeRef:runId}))denied();
    const scope={parentTaskId:intent.parentTaskId,localTaskId:source.sourceTaskId,operationId:intent.operationId,
      sessionId:intent.sessionId,deadline:intent.request.deadline,signal};
    const current=()=>{
      if(signal.aborted||!Number.isFinite(Date.parse(deadline))||Math.min(Date.parse(deadline),Date.parse(scope.deadline))<=now())denied();
      if(!isDeepStrictEqual(source,runtime.loadCheckpoint(taskId,'workflow-business-tool:source'))
        ||!isDeepStrictEqual(child,runtime.loadCheckpoint(taskId,'host-tool-intent'))
        ||!isDeepStrictEqual(intent,runtime.loadCheckpoint(source.sourceTaskId,'workflow-business-tool:'+source.commandId)))denied();
      assertCurrent(scope,kind);
    };
    current();
    // The existing Runtime reconciliation API requires every original execution to be confirmed.
    // Only this exact single-tool host is completed; the graph/root remains Runtime-owned.
    if(write.state==='waiting_reconciliation')runtime.reconcileTask(taskId,'confirmed');
    const proof=readWorkflowBusinessToolSource(app,scope,{taskId,runId,scopeRef:runId,toolVersion:child.toolVersion,arguments:child.arguments},'mail.'+kind);
    if(proof.graph.workflowId!=='F08'||proof.graph.nodeId!==nodeId||proof.sourceHost.taskId!==scope.localTaskId
      ||proof.receipt.result?.state!=='confirmed')denied();
    await exportResult(taskId,proof.receipt.result,scope);current();
    restoreWrite(scope,kind,proof.receipt);
    const host=app.readHostToolTask(scope.localTaskId),hostRun='host-tool-'+scope.localTaskId;
    const result=kind==='send'?{sendOperationId:scope.operationId,toolState:'confirmed',messageId:proof.receipt.result.externalId,idempotencyKey:runId}
      :{archiveOperationId:scope.operationId,toolState:'confirmed'};
    if(host.task.cancelRequested)denied();
    if(host.task.state==='waiting_reconciliation'){
      const evidenceId='f08-mail-readback-'+createHash('sha256').update(JSON.stringify([taskId,runId,scope.localTaskId,result])).digest('hex');
      runtime.saveCheckpointOnce(scope.localTaskId,'trusted-readback-evidence:'+evidenceId,{evidenceId,kind:'observation',sourceRef:'mail.reconcile_'+kind,
        capturedAt:record.finishedAt,summary:'Original F08 mail host recovered from the independently verified original mail child',verification:'verified',sensitivity:'private'});
      current();runtime.reconcileToolExecution(scope.localTaskId,hostRun,'applied',result,[evidenceId]);
    }else if(host.task.state!=='succeeded'||!isDeepStrictEqual(host.confirmed?.result,result))denied();
    current();app.resumeTask(scope.parentTaskId);
    return {state:'confirmed',graphTaskId:scope.parentTaskId,localTaskId:scope.localTaskId,resumed:true};
  };
}
