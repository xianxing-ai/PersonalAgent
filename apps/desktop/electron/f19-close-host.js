import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {readF16OriginalInvocation} from './f16-git-publication-port.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const hostName='workflow.host.f19_n05',key='f19:original-close-attempt:v1';
const ref=value=>({taskId:value.taskId,runId:value.runId,scopeRef:value.scopeRef,toolVersion:value.toolVersion,arguments:value.arguments});

export function createF19CloseHost({getApplication:app,binding,bridge,publisher,regression,publication,authorizeExport}) {
  function expected(scope){
    const bound=binding(scope),published=publisher.original(scope).value,verified=regression.original(scope);
    const snapshots=bound.confirmedOperations.filter(value=>value.nodeId==='F19_N01'&&value.toolName==='workflow.host.f19_n01');
    if(snapshots.length!==1||snapshots[0].result.issueId!==published.issueId||verified.proof.source.headSha!==published.headSha)
      fail('Original F19 close source changed');
    return {repo:published.repo,issueId:published.issueId,prNumber:published.prNumber,headSha:published.headSha,baseSha:published.baseSha,
      mergedSha:verified.proof.source.mergedSha,expectedUpdatedAt:snapshots[0].result.updatedAt,snapshotDigest:snapshots[0].result.snapshotDigest};
  }
  function resolveTool(request,scope){
    if(!['f19.close.issue','f19.close.readback'].includes(request.actionKey))return;
    const value=expected(scope),write=request.actionKey==='f19.close.issue';
    const args=write?value:{repo:value.repo,issueId:value.issueId};
    if(request.input!==undefined&&!isDeepStrictEqual(request.input,args))fail('Original F19 close arguments changed');
    return {workflowId:'F19',nodeId:'F19_N05',hostToolName:hostName,toolName:write?'github.registered_close_issue':'github.issue_close_readback',
      toolVersion:GITHUB_CONNECTOR_VERSION,arguments:args};
  }
  function original(context,pending){
    const runtime=app().runtime,invocation=pending?app().readAuthorizationQuestionInvocation(context.taskId,context.runId):
      readF16OriginalInvocation(app(),context.taskId,context.runId,context);
    if(invocation?.toolName!=='github.registered_close_issue')return;
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent'),owner=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:parent');
    const intent=owner&&runtime.loadCheckpoint(owner.taskId,'owned-workflow:intent:'+owner.operationId);
    if(!parent||!owner||intent?.workflowId!=='F19'||intent.proposal?.nodeId!=='F19_N05'||intent.proposal.toolName!==hostName
      ||intent.proposal.operationId!==owner.operationId||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,{})
      ||context.runId!=='host-tool-'+context.taskId||invocation.deadline!==context.deadline
      ||context.toolName!==undefined&&context.toolName!==invocation.toolName
      ||context.toolVersion!==undefined&&context.toolVersion!==invocation.toolVersion)
      fail('Original F19 close lineage changed');
    const source={parentTaskId:owner.taskId,localTaskId:parent.taskId,operationId:owner.operationId,sessionId:intent.sessionId,
      deadline:context.deadline,signal:context.signal};
    const args=expected(source),ctx={...context,taskId:parent.taskId,runId:'host-tool-'+parent.taskId,authorizationRef:'host-tool-'+parent.taskId,scopes:['github:write']};
    const read=bridge().read({actionKey:'f19.close.issue',input:args},ctx);
    const saved=runtime.loadCheckpoint(context.taskId,'application-tool-invocation:'+context.runId);
    if(read.taskId!==context.taskId||read.runId!==context.runId||!isDeepStrictEqual(invocation.arguments,args)
      ||context.argumentsDigest!==saved?.argumentsDigest||pending&&invocation.argumentsDigest!==context.argumentsDigest)
      fail('Original F19 close approval arguments changed');
    return {taskId:context.taskId,runId:context.runId,argumentsDigest:context.argumentsDigest,parentTaskId:owner.taskId,
      sessionId:intent.sessionId,arguments:args};
  }
  return {resolveTool,
    beforeWrite(operation,input,context){
      if(operation!=='registered_close_issue')fail('Unexpected F19 write operation');
      const proof=original(context,false);
      if(!proof||!isDeepStrictEqual(proof.arguments,input))fail('Original F19 close write changed');
      const runtime=app().runtime;
      if(!runtime.saveCheckpointOnce(context.taskId,key,proof))throw new ProtocolError('RESULT_UNKNOWN','Original Issue close attempt already exists; do not retry');
      if(!isDeepStrictEqual(proof,runtime.loadCheckpoint(context.taskId,key)))fail('Original F19 close attempt changed');
    },
    prepareQuestion(scope,question){const proof=original(scope,true);if(!proof)return;
      question.prepare(scope,{requirements:[{requirementId:'f19-close-issue',kind:'tool',scopes:['github:write'],bindingDigest:hash(proof),
        ruleBindingDigest:hash(['f19-close-issue',proof.arguments.repo]),summary:'原关联 PR 已合并且原独立回归通过；仅关闭这一个原 Issue，并核验返回版本。未知结果不重发'}],
        assertCurrent:()=>{try{return isDeepStrictEqual(proof,original(scope,true));}catch{return false;}}});return proof;},
    async confirmPresence(scope){const proof=original(scope,true);if(!proof)return false;
      await publication.requestPresence(scope);if(!isDeepStrictEqual(proof,original(scope,true)))fail('Original F19 close presence changed');return true;},
    async close(scope,context){
      const args=expected(scope),request={actionKey:'f19.close.issue',input:args};
      if(bridge().read(request,context).state==='unbound'){
        if(await authorizeExport({workflowId:'F19',taskId:scope.parentTaskId,localTaskId:scope.localTaskId,stage:'receipt',
          value:{kind:'original_f19_issue_close',toolName:'github.registered_close_issue',arguments:args},deadline:scope.deadline,signal:scope.signal})!==true)
          fail('Original F19 close export denied');
        if(!isDeepStrictEqual(expected(scope),args))fail('Original F19 close changed during export');
      }
      const receipt=await bridge().invoke(request,context);
      if(receipt.result.closed!==true||receipt.result.issueId!==args.issueId||receipt.result.mergedSha!==args.mergedSha)
        throw new ProtocolError('RESULT_UNKNOWN','Original Issue close is unconfirmed');
      return {repo:args.repo,issueId:args.issueId,closeRead:ref(receipt)};
    },
    async verifyCompletion(scope,context){
      const args=expected(scope),closed=bridge().read({actionKey:'f19.close.issue',input:args},context);
      if(!closed.confirmed||closed.confirmed.result.closed!==true)fail('Original F19 close receipt unavailable');
      const receipt=await bridge().invoke({actionKey:'f19.close.readback',input:{repo:args.repo,issueId:args.issueId}},context);
      if(receipt.result.closed!==true||receipt.result.issueId!==args.issueId||receipt.result.updatedAt!==closed.confirmed.result.updatedAt)
        throw new ProtocolError('RESULT_UNKNOWN','Original closed Issue version changed');
      return {issueId:args.issueId,closed:true};
    }};
}
