import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createF16GitPublicationPort,readF16OriginalInvocation} from './f16-git-publication-port.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const hostName='workflow.host.f16_n05',prefix='f16:publication:';
export const F16_PUBLICATION_SCHEMA={type:'object',additionalProperties:false,required:['branch','createNewBranch'],properties:{
  branch:{type:'string',pattern:'^(?:agent|codex|repair)/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$'},createNewBranch:{const:true}}};
const ref=receipt=>({taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,
  toolVersion:receipt.toolVersion,arguments:receipt.arguments});

/** Only this original active N05 may ask the business bridge for writes. Each child
 * keeps its own ToolGateway/Policy approval. No command, grant or credentials minted. */
export function createF16PublicationHost({getApplication,runtimeModule:r,binding,bridge,readSource,assertReview,configuration,now}) {
  const app=getApplication;
  function source(ctx,pending=false){
    const runtime=app().runtime,parent=runtime.loadCheckpoint(ctx.taskId,'coding-repair:parent');
    const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    const edge=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
    const host=app().readHostToolTask(ctx.taskId),invocation=pending?app().readAuthorizationQuestionInvocation(ctx.taskId,ctx.runId):
      readF16OriginalInvocation(app(),ctx.taskId,ctx.runId,ctx);
    const record=runtime.readToolExecutions(ctx.taskId).find(value=>value.evidenceId===ctx.runId);
    if(!parent||ctx.runId!=='host-tool-'+ctx.taskId||ctx.authorizationRef!==ctx.runId||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F16'||intent.proposal?.nodeId!=='F16_N05'||intent.proposal.operationId!==parent.operationId
      ||intent.proposal.toolName!==hostName||intent.proposal.toolVersion!=='1.0.0'||intent.deadline!==ctx.deadline
      ||!isDeepStrictEqual(intent.proposal.arguments,{})||edge?.localTaskId!==ctx.taskId
      ||!isDeepStrictEqual(edge.request,{commandId:parent.operationId,toolName:hostName,toolVersion:'1.0.0',arguments:{},deadline:ctx.deadline})
      ||host.commandId!==parent.operationId||host.toolName!==hostName||host.toolVersion!=='1.0.0'
      ||invocation?.toolName!==hostName||invocation.deadline!==ctx.deadline||!isDeepStrictEqual(invocation.arguments,{})
      ||!pending&&(!record?.executionStarted||record.policyDecision!=='allow'||record.toolName!==hostName
        ||!runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:ctx.runId})))fail('Original F16 publishing host changed');
    const scope={parentTaskId:parent.taskId,localTaskId:ctx.taskId,operationId:parent.operationId,sessionId:intent.sessionId,
      deadline:ctx.deadline,signal:ctx.signal};
    const bound=binding('F16',scope);configuration.assertCurrent(bound.input,scope);
    return {scope,bound};
  }
  const publication=input=>({selectionRef:input.selectionRef,branch:input.publication.branch,baseHeadSha:input.headSha,repairDigest:hash(input.patch)});
  function savedSource(scope,kind){
    const saved=app().runtime.loadCheckpoint(scope.localTaskId,prefix+kind);
    if(!saved)fail('Original F16 '+kind+' receipt unavailable');
    const toolName={command:'workspace.run_allowed_command',commit:'workspace.git.commit',push:'workspace.git.push'}[kind];
    const value=readSource(scope,saved,toolName);
    const proof=r.readWorkflowBusinessToolSource(app(),scope,saved,toolName);
    if(proof.sourceHost.taskId!==scope.localTaskId||proof.graph.nodeId!=='F16_N05'
      ||proof.actionKey!=='f16.publish.'+kind)fail('Foreign F16 publishing receipt');
    return value;
  }
  function resolveTool(request,scope){
    const {input}=binding('F16',scope);configuration.assertCurrent(input,scope);
    let toolName,args;
    if(request.actionKey==='f16.publish.command'){toolName='workspace.run_allowed_command';args={recipeId:input.recipeId};}
    else if(request.actionKey==='f16.publish.commit'){
      const command=savedSource(scope,'command');
      if(command.result.exitCode!==0||command.result.recipeId!==input.recipeId)fail('Original F16 acceptance command failed');
      toolName='workspace.git.commit';args={repository:input.repository,expectedHeadSha:input.headSha,paths:[input.patch.path],
        message:'F16 verified repair '+hash({selectionRef:input.selectionRef,patch:input.patch}),
        verificationRunId:command.ref.runId,publication:publication(input)};
    }else if(request.actionKey==='f16.publish.push'){
      const commit=savedSource(scope,'commit');
      if(commit.result.parentSha!==input.headSha||commit.result.branch!==input.publication.branch)fail('Original F16 commit changed');
      toolName='workspace.git.push';args={repository:input.repository,expectedHeadSha:commit.result.headSha,publication:publication(input)};
    }else if(/^f16\.publish\.ci\.([0-9]|[12][0-9]|3[01])$/.test(request.actionKey)){
      savedSource(scope,'push');toolName='github.actions.run.list';args={repo:input.repository,status:'success'};
    }else if(/^f16\.publish\.remote\.(before_export|after_export)\.([0-9]|[12][0-9]|3[01])$/.test(request.actionKey)){
      const push=savedSource(scope,'push');toolName='workspace.git.read_publication';
      args={repository:input.repository,taskId:push.ref.taskId,runId:push.ref.runId,publication:publication(input)};
    }else return;
    if(request.input!==undefined&&!isDeepStrictEqual(request.input,args))fail('F16 publishing arguments changed');
    return {workflowId:'F16',nodeId:'F16_N05',hostToolName:hostName,toolName,
      toolVersion:toolName.startsWith('github.')?configuration.githubVersion:'1.0.0',arguments:args};
  }
  function resolveGit(context,target,pending=false){
    const runtime=app().runtime,invocation=pending?app().readAuthorizationQuestionInvocation(target.taskId,target.runId):
      readF16OriginalInvocation(app(),target.taskId,target.runId,context);
    if(!['workspace.git.commit','workspace.git.push'].includes(invocation?.toolName))fail('Foreign original Git operation');
    const parent=runtime.loadCheckpoint(target.taskId,'coding-repair:parent');
    if(!parent)fail('Original publication child has no source host');
    const ctx={taskId:parent.taskId,runId:'host-tool-'+parent.taskId,authorizationRef:'host-tool-'+parent.taskId,
      deadline:context.deadline,signal:context.signal,scopes:['workspace:read']};
    const {scope,bound}=source(ctx),actionKey='f16.publish.'+(invocation.toolName==='workspace.git.commit'?'commit':'push');
    const request={actionKey,input:invocation.arguments},expected=resolveTool(request,scope);
    const record=runtime.readToolExecutions(target.taskId).find(item=>item.evidenceId===target.runId);
    if(record?.state==='confirmed'){
      const proof=r.readWorkflowBusinessToolSource(app(),scope,{...target,scopeRef:target.runId,toolVersion:'1.0.0',arguments:invocation.arguments},invocation.toolName);
      if(proof.sourceHost.taskId!==ctx.taskId||proof.actionKey!==actionKey)fail('Foreign original Git publication');
    }else{
      const read=bridge().read(request,ctx);
      if(read.taskId!==target.taskId||read.runId!==target.runId)fail('Original Git publication child changed');
    }
    return {toolName:expected.toolName,arguments:expected.arguments,publication:publication(bound.input),
      command:savedSource(scope,'command'),scope};
  }
  function authorization(scope){
    const original=app().readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(!original||![hostName,'workspace.git.commit','workspace.git.push'].includes(original.toolName))return;
    if(original.toolName!==hostName){
      const parent=app().runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
      if(!parent||app().runtime.loadCheckpoint(parent.taskId,'host-tool-intent')?.toolName!==hostName)return; // Routing only; exact proof follows below.
    }
    if(scope.toolName!==original.toolName||scope.toolVersion!==original.toolVersion||scope.argumentsDigest!==original.argumentsDigest
      ||scope.deadline!==original.deadline||scope.signal.aborted)fail('Original F16 publication question changed');
    const ctx={...scope,authorizationRef:scope.runId};
    const owner=original.toolName===hostName?source(ctx,true).scope:resolveGit(ctx,ctx,true).scope;
    const bound=binding('F16',owner);
    return {taskId:scope.taskId,runId:scope.runId,argumentsDigest:original.argumentsDigest,parentTaskId:owner.parentTaskId,
      sessionId:owner.sessionId,operationId:owner.operationId,configurationDigest:bound.configurationDigest};
  }
  const gitPort=createF16GitPublicationPort({getApplication:app,resolve:resolveGit,now});
  const rawCurrent=gitPort.assertCurrent;
  gitPort.assertCurrent=async(ctx,value)=>{
    await rawCurrent(ctx,value);
    const invocation=app().readAuthorizationQuestionInvocation(ctx.taskId,ctx.runId);
    const proof=resolveGit(ctx,invocation.toolName==='workspace.git.read_publication'?invocation.arguments:ctx);
    await assertReview(proof.scope);
    await rawCurrent(ctx,value);
  };
  const tool={descriptor:{name:hostName,version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['headSha','verificationRunId','commitRunId','pushRunId'],properties:{
      headSha:{type:'string',pattern:'^[a-f0-9]{40,64}$'},...Object.fromEntries(['verificationRunId','commitRunId','pushRunId'].map(key=>[key,{type:'string',minLength:1}]))}},
    sideEffect:'external_write',requiredScopes:['workspace:read'],requiresPresence:true,idempotencySupport:false,recoverySupport:false},
    async execute(input,ctx){
      validateToolValue(tool.descriptor.inputSchema,input);const {scope,bound}=source(ctx);
      if(!ctx.scopes.includes('workspace:read'))fail('Original publishing host scope is required');
      const receipts={};
      for(const kind of ['command','commit','push']){
        await assertReview(scope);source(ctx);
        const actionKey='f16.publish.'+kind,args=resolveTool({actionKey},scope).arguments;
        // Bridge never replays an unknown write. Every side effect has its own original approval.
        let receipt;
        try{receipt=await bridge().invoke({actionKey,input:args},ctx);}
        catch(error){
          // Preserve the original unknown child's identity, never an invented result.
          // The public source reader will still reject it until real reconciliation.
          try{const original=bridge().read({actionKey,input:args},ctx);
            if(original.state==='waiting_reconciliation'&&original.taskId&&original.runId)
              app().runtime.saveCheckpointOnce(ctx.taskId,prefix+kind,{taskId:original.taskId,runId:original.runId,
                scopeRef:original.runId,toolVersion:'1.0.0',arguments:args});
          }catch{/* Preserve the original failure; an expired authority cannot prepare recovery. */}
          throw error;
        }
        const value=ref(receipt);app().runtime.saveCheckpointOnce(ctx.taskId,prefix+kind,value);
        if(!isDeepStrictEqual(value,app().runtime.loadCheckpoint(ctx.taskId,prefix+kind)))fail('Original publishing receipt changed');
        receipts[kind]=savedSource(scope,kind);source(ctx);
      }
      // Only actual GitHub run receipts qualify; no stdout parsing or local success substitution.
      const baseline=configuration.readBaseline(scope,bound.input),headSha=receipts.push.result.headSha;
      for(let attempt=0;attempt<32;attempt++){
        const actionKey='f16.publish.ci.'+attempt,args=resolveTool({actionKey},scope).arguments;
        const receipt=await bridge().invoke({actionKey,input:args},ctx),runs=readSource(scope,ref(receipt),'github.actions.run.list');
        if(runs.result.items.some(run=>run.id!==bound.input.runId&&run.headSha===headSha&&run.name===baseline.bytes.workflowName
          &&run.status==='completed'&&run.conclusion==='success'&&Date.parse(run.createdAt)>=Date.parse(receipts.commit.record.startedAt))){
          await assertReview(scope);source(ctx);
          return {headSha,verificationRunId:receipts.command.ref.runId,commitRunId:receipts.commit.ref.runId,pushRunId:receipts.push.ref.runId};
        }
        if(attempt<31)await r.awaitF16Port(scope,now,()=>new Promise(resolve=>{
          const done=()=>{clearTimeout(timer);ctx.signal.removeEventListener('abort',done);resolve();};
          const timer=setTimeout(done,15000);ctx.signal.addEventListener('abort',done,{once:true});
        }));
      }
      throw new ProtocolError('RESULT_UNKNOWN','Exact published repair has no successful GitHub CI readback yet; do not publish again');
    }};
  return {tool,resolveTool,gitPort,command:scope=>savedSource(scope,'command'),
    async readPublishedHead(scope,ctx,stage,index){
      const actionKey='f16.publish.remote.'+stage+'.'+index,args=resolveTool({actionKey},scope)?.arguments;
      if(!args)fail('Unknown original publication readback stage');
      const receipt=await bridge().invoke({actionKey,input:args},ctx);
      return readSource(scope,ref(receipt),'workspace.git.read_publication');
    },
    prepareQuestion(scope,question){
      const proof=authorization(scope);if(!proof)return;
      question.prepare(scope,{assertCurrent:()=>{try{return isDeepStrictEqual(proof,authorization(scope));}catch{return false;}}});
      return proof;
    },
    async confirmPresence(scope){
      const proof=authorization(scope);if(!proof)return;
      if(typeof configuration.requestPresence!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original task presence broker unavailable');
      await r.awaitF16Port(scope,now,()=>configuration.requestPresence(scope));
      if(!isDeepStrictEqual(proof,authorization(scope)))fail('Original F16 publication changed during native presence confirmation');
    },
    async readUnknownInspection(taskId,{signal}){
      const read=app().readHostToolTask(taskId),intent=app().runtime.loadCheckpoint(taskId,'host-tool-intent');
      if(read.toolName!==hostName||read.task.state!=='waiting_reconciliation'||!intent)return;
      const ctx={taskId,runId:'host-tool-'+taskId,authorizationRef:'host-tool-'+taskId,scopes:['workspace:read'],deadline:intent.deadline,signal};
      const {scope}=source(ctx);
      for(const kind of ['commit','push']){
        const original=app().runtime.loadCheckpoint(taskId,prefix+kind);if(!original)return;
        const record=app().runtime.readToolExecutions(original.taskId).find(value=>value.evidenceId===original.runId);
        if(record?.state==='confirmed'){savedSource(scope,kind);continue;}
        if(app().runtime.getTask(original.taskId).state==='waiting_reconciliation'){
          const saved=await gitPort.load(ctx,original);
          if(!saved)return;
          // Main submits this read via its existing HostBridge/Policy. This method
          // starts no task and does not claim either child or graph completion.
          return {toolName:'workspace.git.read_publication',toolVersion:'1.0.0',deadline:intent.deadline,
            arguments:{repository:saved.repository,taskId:saved.taskId,runId:saved.runId,publication:structuredClone(saved.publication)}};
        }
        return;
      }
    },
    verify(scope,result){const command=savedSource(scope,'command'),commit=savedSource(scope,'commit'),push=savedSource(scope,'push');
      if(!isDeepStrictEqual(result,{headSha:push.result.headSha,verificationRunId:command.ref.runId,commitRunId:commit.ref.runId,pushRunId:push.ref.runId})
        ||commit.result.headSha!==push.result.headSha)fail('Original F16 publication completion changed');return {command,commit,push};}};
}
