import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=runId=>'f16:git-publication:'+runId;
const seal=runId=>'f16:git-publication-seal:'+runId;
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','Original F16 Git publication proof changed');};

/** Read started/unknown original host invocations too. The question API deliberately
 * only returns active or confirmed invocations, so it is not an unknown-write reader. */
export function readF16OriginalInvocation(application,taskId,runId,scope){
  const {runtime}=application,host=runtime.loadCheckpoint(taskId,'host-tool-intent'),read=application.readHostToolTask(taskId);
  const record=runtime.readToolExecutions(taskId).find(value=>value.evidenceId===runId);
  if(!host||runId!=='host-tool-'+taskId||host.deadline!==scope.deadline||scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()
    ||read.task.cancelRequested||host.commandId!==read.commandId||host.toolName!==read.toolName||host.toolVersion!==read.toolVersion
    ||!record?.executionStarted||record.policyDecision!=='allow'||record.toolName!==host.toolName||record.toolVersion!==host.toolVersion
    ||!runtime.matchesToolExecutionInput(record,{arguments:host.arguments,scopeRef:runId}))fail();
  return {toolName:host.toolName,toolVersion:host.toolVersion,arguments:structuredClone(host.arguments),deadline:host.deadline};
}

/** Trusted adapter over the original child SQLite records. resolve is supplied by
 * the F16 host and proves the exact graph → N05 → business edges, never ancestry. */
export function createF16GitPublicationPort({getApplication,resolve,now=()=>new Date()}) {
  function original(context,target={taskId:context.taskId,runId:context.runId}) {
    const application=getApplication(),runtime=application.runtime;
    if(context.signal.aborted||Date.parse(context.deadline)<=now().getTime())fail();
    const proof=resolve(context,target),record=runtime.readToolExecutions(target.taskId).find(item=>item.evidenceId===target.runId);
    const invocation=readF16OriginalInvocation(application,target.taskId,target.runId,context);
    if(!invocation||!record||!record.executionStarted||record.policyDecision!=='allow'
      ||record.toolName!==proof.toolName||record.toolVersion!=='1.0.0'||invocation.toolName!==proof.toolName
      ||invocation.deadline!==context.deadline||!isDeepStrictEqual(invocation.arguments,proof.arguments)
      ||!runtime.matchesToolExecutionInput(record,{arguments:proof.arguments,scopeRef:target.runId}))fail();
    return {application,runtime,proof,record};
  }
  function load(context,target){
    const {runtime,proof}=original(context,target),intent=runtime.loadCheckpoint(target.taskId,key(target.runId));
    if(intent!==undefined&&(intent.taskId!==target.taskId||intent.runId!==target.runId||intent.repository!==proof.arguments.repository
      ||intent.operation!==(proof.toolName==='workspace.git.commit'?'commit':'push')
      ||!isDeepStrictEqual(intent.arguments,proof.arguments)||!isDeepStrictEqual(intent.publication,proof.publication)
      ||runtime.loadCheckpoint(target.taskId,seal(target.runId))!==hash(intent)))fail();
    return intent;
  }
  return {
    async assertCurrent(context,publication){
      const invocation=getApplication().readAuthorizationQuestionInvocation(context.taskId,context.runId);
      const target=invocation?.toolName==='workspace.git.read_publication'?invocation.arguments:context;
      const {proof}=original(context,{taskId:target.taskId,runId:target.runId});
      if(!isDeepStrictEqual(publication,proof.publication))fail();
    },
    async load(context,target){return load(context,target);},
    async saveOnce(context,intent){
      const {runtime,proof,record}=original(context);
      if(!runtime.isToolExecutionActive(record)||!isDeepStrictEqual(intent.arguments,proof.arguments)
        ||!isDeepStrictEqual(intent.publication,proof.publication)||intent.taskId!==context.taskId||intent.runId!==context.runId
        ||runtime.loadCheckpoint(context.taskId,key(context.runId))!==undefined)fail();
      runtime.saveCheckpointOnce(context.taskId,key(context.runId),structuredClone(intent));
      runtime.saveCheckpointOnce(context.taskId,seal(context.runId),hash(intent));
      if(!isDeepStrictEqual(load(context,context),intent))fail();
    },
    async readVerification(context,runId){
      const {runtime,proof}=original(context),command=proof.command;
      if(proof.toolName!=='workspace.git.commit'||!command||command.ref.runId!==runId||command.result.exitCode!==0)fail();
      const receipt=runtime.loadCheckpoint(command.ref.taskId,'developer-git-verification:'+runId);
      if(!receipt||receipt.taskId!==command.ref.taskId||receipt.runId!==runId||receipt.toolName!=='workspace.run_allowed_command'
        ||receipt.status!=='confirmed'||receipt.exitCode!==0||receipt.headSha!==proof.publication.baseHeadSha)fail();
      return {...structuredClone(receipt),consumer:{taskId:context.taskId,runId:context.runId,argumentsDigest:hash(proof.arguments)}};
    },
    async observed(context,intent,result){
      if(!isDeepStrictEqual(load(context,intent),intent))fail();
      const {runtime,record}=original(context,intent);
      if(result.state!=='applied'||record.state==='confirmed')return;
      if(runtime.isToolExecutionActive(record)||runtime.getTask(intent.taskId).state!=='waiting_reconciliation')fail();
      const evidenceId='f16-git-readback-'+hash({taskId:context.taskId,runId:context.runId,intent});
      runtime.saveCheckpoint(intent.taskId,'trusted-readback-evidence:'+evidenceId,{evidenceId,kind:'observation',
        sourceRef:context.taskId+':'+context.runId,capturedAt:now().toISOString(),
        summary:'Original F16 Git intent exact HEAD read back; no write retried',verification:'verified',sensitivity:'internal'});
      runtime.reconcileToolExecution(intent.taskId,intent.runId,'applied',intent.expected,[evidenceId]);
    },
  };
}
