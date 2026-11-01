import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {createWorkflowGitPublicationPort,readF16OriginalInvocation} from './f16-git-publication-port.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const hostName='workflow.host.f19_n03',prefix='f19:publication:';
const ref=receipt=>({taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments});
export const F19_PUBLICATION_INPUT={headSha:{type:'string',pattern:'^[a-f0-9]{40,64}$'},verificationRecipeId:{type:'string',minLength:1},
  publication:{type:'object',additionalProperties:false,required:['branch','base'],properties:{
    branch:{type:'string',pattern:'^(?:agent|codex|repair)/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$'},
    base:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$'}}}};

/** F19 owns only provenance/arguments. Existing Policy, business bridge, Git
 * implementation and GitHub connector own every original operation. */
export function createF19PublicationHost({getApplication:app,runtimeModule:r,binding,repairSource,bridge,configuration,authorizeExport,now}) {
  const configured=()=>typeof configuration?.assertCurrent==='function'&&typeof configuration.readConfiguration==='function'
    &&typeof configuration.requestPresence==='function'&&typeof authorizeExport==='function';
  function current(scope){
    if(!configured())throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original F19 publication configuration unavailable');
    const bound=binding(scope),value=configuration.assertCurrent(scope,bound.input);
    if(value!==undefined){void Promise.resolve(value).catch(()=>{});fail('Original publication guard must be synchronous');}
    const git=configuration.readConfiguration(scope);
    if(!git||git.repository!==bound.input.repo||git.remoteUrl!=='https://github.com/'+bound.input.repo+'.git'
      ||git.sourceBranch!==bound.input.publication.branch
      ||!isDeepStrictEqual([...git.allowedPaths].sort(),[...bound.input.allowedPaths].sort()))fail('Original F19 Git workspace changed');
    return bound;
  }
  function source(ctx,pending=false){
    const runtime=app().runtime,parent=runtime.loadCheckpoint(ctx.taskId,'coding-repair:parent');
    const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    const edge=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
    const host=app().readHostToolTask(ctx.taskId),invocation=pending?app().readAuthorizationQuestionInvocation(ctx.taskId,ctx.runId):
      readF16OriginalInvocation(app(),ctx.taskId,ctx.runId,ctx);
    if(!parent||ctx.runId!=='host-tool-'+ctx.taskId||ctx.authorizationRef!==ctx.runId||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F19'||intent.proposal?.nodeId!=='F19_N03'||intent.proposal.operationId!==parent.operationId
      ||intent.proposal.toolName!==hostName||intent.proposal.toolVersion!=='1.0.0'||intent.deadline!==ctx.deadline
      ||!isDeepStrictEqual(intent.proposal.arguments,{})||edge?.localTaskId!==ctx.taskId
      ||!isDeepStrictEqual(edge.request,{commandId:parent.operationId,toolName:hostName,toolVersion:'1.0.0',arguments:{},deadline:ctx.deadline})
      ||host.commandId!==parent.operationId||host.toolName!==hostName||host.toolVersion!=='1.0.0'
      ||invocation?.toolName!==hostName||invocation.deadline!==ctx.deadline||!isDeepStrictEqual(invocation.arguments,{}))fail('Original F19 publishing host changed');
    const scope={parentTaskId:parent.taskId,localTaskId:ctx.taskId,operationId:parent.operationId,sessionId:intent.sessionId,
      deadline:ctx.deadline,signal:ctx.signal};current(scope);return scope;
  }
  function saved(scope,kind){
    const reference=app().runtime.loadCheckpoint(scope.localTaskId,prefix+kind);
    if(!reference)fail('Original F19 '+kind+' receipt unavailable');
    const toolName={repair:'coding.repair.workflow',head:'workspace.git.head',command:'workspace.run_allowed_command',
      commit:'workspace.git.commit',push:'workspace.git.push',pr:'github.pr.create'}[kind];
    const proof=r.readWorkflowBusinessToolSource(app(),scope,reference,toolName);
    if(proof.graph.workflowId!=='F19'||proof.graph.nodeId!=='F19_N03'||proof.sourceHost.taskId!==scope.localTaskId
      ||proof.graph.operationId!==scope.operationId||proof.actionKey!==(kind==='repair'?'f19.repair.enqueue':'f19.publish.'+kind))fail('Foreign F19 publication receipt');
    return {ref:reference,record:proof.record,result:proof.receipt.result};
  }
  function artifact(scope){
    current(scope);const original=repairSource(scope),repair=saved(scope,'repair');
    if(!isDeepStrictEqual(original.args,repair.ref.arguments))fail('Original F19 repair arguments changed');
    const value=r.readRuntimeCodingRepairPublishedSource(app(),repair.ref);
    if(value.files.some(file=>!original.source.allowedPaths.includes(file.path)))fail('Original F15 publication exceeds selected paths');
    return value;
  }
  function publication(scope){const {input}=current(scope);return {selectionRef:hash(repairSource(scope).source),branch:input.publication.branch,
    baseHeadSha:input.headSha,repairDigest:hash(artifact(scope))};}
  function resolveTool(request,scope){
    if(!request.actionKey.startsWith('f19.publish.'))return;
    const {input}=current(scope),kind=request.actionKey.slice('f19.publish.'.length);let toolName,args;
    if(kind==='head'){toolName='workspace.git.head';args={repository:input.repo};}
    else if(kind==='command'){
      const head=saved(scope,'head');artifact(scope);
      if(head.result.headSha!==input.headSha||head.result.clean!==true)fail('Original publication baseline changed');
      toolName='workspace.run_allowed_command';args={recipeId:input.verificationRecipeId};
    }else if(kind==='commit'){
      const command=saved(scope,'command'),published=artifact(scope);
      if(command.result.exitCode!==0||command.result.recipeId!==input.verificationRecipeId)fail('Original publication verification failed');
      const verification=app().runtime.loadCheckpoint(command.ref.taskId,'developer-git-verification:'+command.ref.runId);
      if(!verification||verification.taskId!==command.ref.taskId||verification.runId!==command.ref.runId
        ||verification.toolName!=='workspace.run_allowed_command'||verification.status!=='confirmed'||verification.exitCode!==0
        ||verification.headSha!==input.headSha||!Array.isArray(verification.files)
        ||published.files.some(file=>verification.files.filter(value=>value.path===file.path&&value.sha256===file.afterSha256).length!==1))
        fail('Original F19 command did not verify the exact published F15 bytes');
      toolName='workspace.git.commit';args={repository:input.repo,expectedHeadSha:input.headSha,paths:published.files.map(file=>file.path).sort(),
        message:'F19 verified issue '+input.issueId+' repair '+hash(published),verificationRunId:command.ref.runId,publication:publication(scope)};
    }else if(kind==='push'){
      const commit=saved(scope,'commit');
      if(commit.result.parentSha!==input.headSha||commit.result.branch!==input.publication.branch)fail('Original F19 commit changed');
      toolName='workspace.git.push';args={repository:input.repo,expectedHeadSha:commit.result.headSha,publication:publication(scope)};
    }else if(kind==='pr'){
      const push=saved(scope,'push'),commit=saved(scope,'commit');
      if(push.result.pushed!==true||push.result.headSha!==commit.result.headSha)fail('Original F19 push is unconfirmed');
      toolName='github.pr.create';args={repo:input.repo,title:'F19 repair for issue '+input.issueId,
        // Do not use GitHub automatic-closing keywords: N04 must independently
        // verify the merged artifact and original bug before N05 may close it.
        body:'Related issue: https://github.com/'+input.repo+'/issues/'+input.issueId+'\nOriginal repair artifact SHA-256: '+hash(artifact(scope)),
        head:input.publication.branch,base:input.publication.base,expectedHeadSha:push.result.headSha,draft:true};
    }else return;
    if(request.input!==undefined&&!isDeepStrictEqual(request.input,args))fail('Original F19 publication arguments changed');
    return {workflowId:'F19',nodeId:'F19_N03',hostToolName:hostName,toolName,
      toolVersion:toolName.startsWith('github.')?GITHUB_CONNECTOR_VERSION:'1.0.0',arguments:args};
  }
  function resolveOriginal(context,target,pending=false){
    const invocation=pending?app().readAuthorizationQuestionInvocation(target.taskId,target.runId):readF16OriginalInvocation(app(),target.taskId,target.runId,context);
    const kind={'workspace.git.commit':'commit','workspace.git.push':'push','github.pr.create':'pr'}[invocation?.toolName];
    if(!kind)fail('Foreign original F19 publication operation');
    const parent=app().runtime.loadCheckpoint(target.taskId,'coding-repair:parent');if(!parent)fail('Original F19 publication parent unavailable');
    const ctx={taskId:parent.taskId,runId:'host-tool-'+parent.taskId,authorizationRef:'host-tool-'+parent.taskId,
      deadline:context.deadline,signal:context.signal,scopes:['agent:delegate']};
    const scope=source(ctx),actionKey='f19.publish.'+kind,expected=resolveTool({actionKey,input:invocation.arguments},scope);
    const read=bridge().read({actionKey,input:expected.arguments},ctx);
    if(read.taskId!==target.taskId||read.runId!==target.runId||invocation.toolVersion!==expected.toolVersion)fail('Original F19 publication child changed');
    return {scope,toolName:expected.toolName,arguments:expected.arguments,publication:publication(scope),
      ...(kind==='commit'?{command:saved(scope,'command')}:{})};
  }
  const gitPort=createWorkflowGitPublicationPort({getApplication:app,resolve:resolveOriginal,now,workflowId:'F19'});
  function authorization(scope){
    const invocation=app().readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(!['workspace.git.commit','workspace.git.push','github.pr.create'].includes(invocation?.toolName))return;
    const parent=app().runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
    if(!parent||app().runtime.loadCheckpoint(parent.taskId,'host-tool-intent')?.toolName!==hostName)return;
    if(scope.toolName!==invocation.toolName||scope.toolVersion!==invocation.toolVersion||scope.argumentsDigest!==invocation.argumentsDigest
      ||scope.deadline!==invocation.deadline||scope.signal.aborted)fail('Original F19 publication question changed');
    const original=resolveOriginal({...scope,authorizationRef:scope.runId},scope,true);
    return {taskId:scope.taskId,runId:scope.runId,argumentsDigest:invocation.argumentsDigest,
      parentTaskId:original.scope.parentTaskId,sessionId:original.scope.sessionId,publication:original.publication};
  }
  return {gitPort,resolveTool,
    async publish(scope,ctx,dispatchReceipt){
      current(scope);const repair=ref(dispatchReceipt);app().runtime.saveCheckpointOnce(scope.localTaskId,prefix+'repair',repair);
      if(!isDeepStrictEqual(repair,app().runtime.loadCheckpoint(scope.localTaskId,prefix+'repair')))fail('Original F19 repair receipt changed');
      artifact(scope);
      for(const kind of ['head','command','commit','push','pr']){
        const actionKey='f19.publish.'+kind,request=resolveTool({actionKey},scope);
        if(['commit','push','pr'].includes(kind)){
          const allowed=await authorizeExport({workflowId:'F19',taskId:scope.parentTaskId,localTaskId:scope.localTaskId,stage:'receipt',
            value:{kind:'original_f19_publication',toolName:request.toolName,arguments:request.arguments,source:artifact(scope)},
            deadline:scope.deadline,signal:scope.signal});current(scope);
          if(allowed!==true)fail('Original F19 publication export denied');
        }
        let receipt;
        try{receipt=await bridge().invoke({actionKey,input:request.arguments},ctx);}
        catch(error){
          // Retain the original unknown child; a later read cannot create a new write.
          try{const original=bridge().read({actionKey,input:request.arguments},ctx);
            if(original.taskId&&original.runId)app().runtime.saveCheckpointOnce(scope.localTaskId,prefix+kind,
              {taskId:original.taskId,runId:original.runId,scopeRef:original.runId,toolVersion:request.toolVersion,arguments:request.arguments});
          }catch{/* Preserve the original execution failure. */}throw error;
        }
        const value=ref(receipt);app().runtime.saveCheckpointOnce(scope.localTaskId,prefix+kind,value);
        if(!isDeepStrictEqual(value,app().runtime.loadCheckpoint(scope.localTaskId,prefix+kind)))fail('Original F19 publication receipt changed');
        saved(scope,kind);current(scope);
      }
      return this.read(scope);
    },
    read(scope){
      const published=artifact(scope),commit=saved(scope,'commit'),push=saved(scope,'push'),pr=saved(scope,'pr'),{input}=current(scope);
      const prNumber=Number(pr.result.externalId);
      if(pr.result.state!=='confirmed'||!Number.isSafeInteger(prNumber)||prNumber<=0
        ||pr.result.url!=='https://github.com/'+input.repo+'/pull/'+prNumber||push.result.headSha!==commit.result.headSha||push.result.pushed!==true)
        throw new ProtocolError('RESULT_UNKNOWN','Original F19 PR publication is unconfirmed; inspect without retry');
      return {repair:published,repo:input.repo,issueId:input.issueId,prNumber,headSha:push.result.headSha,baseSha:input.headSha,
        commit:commit.ref,push:push.ref,pr:pr.ref};
    },
    prepareQuestion(scope,question){const proof=authorization(scope);if(!proof)return;
      question.prepare(scope,{assertCurrent:()=>{try{return isDeepStrictEqual(proof,authorization(scope));}catch{return false;}}});return proof;},
    async confirmPresence(scope){const proof=authorization(scope);if(!proof)return false;
      await configuration.requestPresence(scope);
      if(!isDeepStrictEqual(proof,authorization(scope)))fail('Original F19 publication changed during presence confirmation');return true;},
  };
}
