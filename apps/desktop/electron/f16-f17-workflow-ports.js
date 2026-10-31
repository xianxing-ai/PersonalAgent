import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {readF17InitialFailure} from './f17-initial-failure-source.js';
import {createF16TestIntentPort} from './f16-test-intent-port.js';
import {selectF16RepairedRun,selectF16RepairedJob} from './f16-ci-identity-recipe.js';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:256},sha={type:'string',pattern:'^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const recipe={type:'string',pattern:'^[a-z][a-z0-9._-]{0,63}$'},integer={type:'integer',minimum:1};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const toolVersion=name=>name.startsWith('github.')?GITHUB_CONNECTOR_VERSION:'1.0.0';
const patch=object({path:text,expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},edits:{type:'array',minItems:1,maxItems:32,
  items:object({oldText:{type:'string',minLength:1,maxLength:65536},newText:{type:'string',maxLength:65536}})}});
const reportSchema=object({failureCount:integer,locatedFrameCount:{type:'integer',minimum:0},reportRef:text,all6PassResolved:{const:false}});
const common={selectionRef:text,repository:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'},headSha:sha};
export const F16_F17_CONFIGURATIONS=freeze({
  F16:{toolName:'workflow.f16.ci_repair',version:'1.0.0',configurationVersion:'f16-desktop-v2',requestSchema:object({selectionRef:text}),
    inputSchema:object({...common,runId:integer,jobId:integer,patch,recipeId:recipe}),
    resultSchema:object({ciStatus:{const:'passed'},headSha:sha,runId:integer,jobId:integer,verificationRunId:text}),
    nodes:{F16_N01:'workflow.host.f16_n01',F16_N02:'decision.choose_candidate',F16_N03:'workspace.apply_text_patch',
      F16_N04:'workflow.host.f16_n04',F16_N05:'workspace.run_allowed_command'},
    tools:['workflow.host.f16_n01','decision.choose_candidate','workspace.apply_text_patch','workflow.host.f16_n04',
      'workspace.run_allowed_command','workspace.git.head','github.actions.run.list','github.actions.job.list','github.actions.log.read']},
  F17:{toolName:'workflow.f17.test_locate',version:'1.0.0',configurationVersion:'f17-desktop-v2',requestSchema:object({selectionRef:text}),
    inputSchema:object({...common,recipeId:recipe,sourceDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
      initialFailure:object({recipeId:recipe,exitCode:integer,stdout:{type:'string',maxLength:65536},stderr:{type:'string',maxLength:65536}})}),
    resultSchema:reportSchema,nodes:{F17_N02:'decision.choose_candidate',F17_N03:'workspace.run_allowed_command',F17_N04:'workflow.host.f17_n04'},
    tools:['decision.choose_candidate','workspace.run_allowed_command','workflow.host.f17_n04','workspace.git.head']},
});

/** AgentArts composition owns the image. These ports never create a Runtime, executor or grant. */
export function createF16F17WorkflowPorts({runtimeModule:r,getApplication,workspace,authority,authorizeExport,f16TestIntent,
  f16CiIdentityRecipe,now=()=>new Date()}={}) {
  const unavailable=[],tools=[],configuredWorkflowWorkerPorts=[];
  if(f16CiIdentityRecipe!==undefined&&f16CiIdentityRecipe!=='github-readback'
    ||f16CiIdentityRecipe==='github-readback'&&f16TestIntent!=='preserved-bytes'&&typeof f16TestIntent?.readBaseline!=='function')
    return {tools,configuredWorkflowWorkerPorts,unavailable:['f16_ci_identity_configuration_unavailable']};
  const configurationVersion=workflow=>workflow==='F16'&&f16CiIdentityRecipe==='github-readback'
    ?'f16-desktop-v3-bytes':F16_F17_CONFIGURATIONS[workflow].configurationVersion;
  const required=['createF16CiFailurePorts','createF17ReproductionPorts','createF17ConfiguredDriverResolver','createF17ObservedCommandTool',
    'createRuntimeF16CiFailureHost','createRuntimeF17FailureReportHost','createWorkflowBusinessToolBridge','readF16Source','createF16HeadReader','awaitF16Port'];
  if(!r||required.some(name=>typeof r[name]!=='function')||typeof getApplication!=='function'
    ||!workspace?.root||!Array.isArray(workspace.recipes)||!workspace.recipes.length||!workspace.commandTool
    ||typeof workspace.readSelection!=='function'||typeof workspace.assertCurrent!=='function'||typeof workspace.available!=='function'
    ||typeof authority?.available!=='function'||typeof authority.assertCurrent!=='function'||typeof authorizeExport!=='function')
    return {tools,configuredWorkflowWorkerPorts,unavailable:['f16_f17_trusted_services_unavailable']};
  const app=()=>{const application=getApplication();if(!application)fail('UNSUPPORTED_CAPABILITY','Original Runtime unavailable');return application;};
  const wait=(scope,work)=>r.awaitF16Port(scope,now,work);
  const application={get runtime(){return app().runtime;},readHostToolTask:id=>app().readHostToolTask(id),
    readConfiguredWorkflowBinding:scope=>app().readConfiguredWorkflowBinding(scope)};
  const current=(workflow,scope)=>{
    if(scope.signal.aborted)fail('CANCELLED','Original F16/F17 operation cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now().getTime())fail('TIMEOUT','Original F16/F17 operation expired');
    for(const check of [()=>authority.assertCurrent(workflow,scope),()=>workspace.assertCurrent(workflow,scope)]){
      const guard=check();
      if(guard!==undefined){void Promise.resolve(guard).catch(()=>{});fail('UNAUTHORIZED','F16/F17 current guards must be synchronous');}
    }
  };
  const binding=(workflow,scope)=>{
    const parent={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal};current(workflow,parent);
    const bound=app().readConfiguredWorkflowBinding({taskId:parent.taskId,workflowId:workflow,sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline||bound.configurationVersion!==configurationVersion(workflow))
      fail('UNAUTHORIZED','Original F16/F17 configured binding unavailable');
    return bound;
  };
  const context=(id,scope)=>{
    const read=app().readHostToolTask(id),descriptor=app().runtime.readToolDescriptors().find(v=>v.name===read.toolName&&v.version===read.toolVersion);
    if(!descriptor||!read.confirmed)fail('UNAUTHORIZED','Original configured receipt unavailable');
    return {taskId:id,runId:read.confirmed.runId,authorizationRef:read.confirmed.runId,scopes:[...descriptor.requiredScopes],
      deadline:scope.deadline,signal:scope.signal};
  };
  const sourceRef=read=>({taskId:read.taskId,runId:read.runId,scopeRef:read.scopeRef,toolVersion:read.toolVersion,arguments:read.arguments});
  const headAction=/^f(16|17)\.head\.(execute|before_export|after_export|before_command|after_command)\.([0-9]|[12][0-9]|3[01])$/;
  const bridges=new WeakMap();
  const recipeRun=scope=>{
    const saved=app().runtime.loadCheckpoint(scope.localTaskId,'f16:ci-readback-run');
    const bound=binding('F16',scope),patch=bound.confirmedOperations.find(operation=>operation.nodeId==='F16_N03'
      &&operation.toolName==='workspace.apply_text_patch');
    if(!saved||!patch||!isDeepStrictEqual(saved.input,bound.input))fail('UNAUTHORIZED','Original CI recipe readback unavailable');
    for(const source of [saved.head,saved.command,saved.runs,saved.failureRuns,saved.failureJobs])
      if(!isDeepStrictEqual(source,r.readF16Source(application,scope,source.ref,source.read.toolName)))
        fail('REVISION_CONFLICT','Original CI recipe source changed');
    const patchRecord=app().runtime.readToolExecutions(patch.localTaskId).find(record=>record.evidenceId===patch.readback.confirmed.runId);
    if(!isDeepStrictEqual(saved.originalRun,saved.failureRuns.result.items.find(run=>run.id===bound.input.runId))
      ||!isDeepStrictEqual(saved.baseline,f16TestIntent.readBaseline(scope,bound.input).bytes)
      ||!isDeepStrictEqual(saved.patchRecord,patchRecord))fail('REVISION_CONFLICT','Original CI recipe baseline changed');
    const run=selectF16RepairedRun(saved);
    if(!isDeepStrictEqual(run,saved.run))fail('REVISION_CONFLICT','Original CI recipe run changed');return saved;
  };
  const ciIdentity=scope=>{
    if(f16CiIdentityRecipe==='github-readback'){
      const saved=app().runtime.loadCheckpoint(scope.localTaskId,'f16:ci-readback-identity'),run=recipeRun(scope);
      if(!saved||!isDeepStrictEqual(saved.jobs,r.readF16Source(application,scope,saved.jobs.ref,'github.actions.job.list')))
        fail('UNAUTHORIZED','Original repaired job readback unavailable');
      return selectF16RepairedJob({input:run.input,run:run.run,originalJob:run.failureJobs.result.items.find(job=>job.id===run.input.jobId),jobs:saved.jobs});
    }
    const value=app().readHostToolTask(scope.localTaskId).confirmed?.result;let identity;
    try{identity=JSON.parse(value?.stdout);}catch{fail('UNSUPPORTED_CAPABILITY','Original CI command lacks a structured CI identity');}
    validateToolValue(object({repository:common.repository,headSha:sha,runId:integer,jobId:integer}),identity);
    const input=binding('F16',scope).input;
    if(value.exitCode!==0||value.recipeId!==input.recipeId||identity.repository!==input.repository||identity.headSha===input.headSha)
      fail('UNAUTHORIZED','Original CI command did not confirm the repaired version');
    return identity;
  };
  const resolveTool=(request,scope)=>{
    const workflow=request.actionKey.startsWith('f16.')?'F16':request.actionKey.startsWith('f17.')?'F17':undefined;
    if(!workflow)return;
    const bound=binding(workflow,scope),input=bound.input;
    let nodeId,toolName,args;
    if(headAction.test(request.actionKey)){
      const phase=request.actionKey.split('.')[2];
      nodeId=workflow==='F16'?(app().readHostToolTask(scope.localTaskId).toolName==='workspace.run_allowed_command'?'F16_N05':
        app().readHostToolTask(scope.localTaskId).toolName==='workflow.host.f16_n04'?'F16_N04':'F16_N01'):
        ['before_command','after_command'].includes(phase)?'F17_N03':'F17_N04';
      if(workflow==='F16'&&['before_command','after_command'].includes(phase))return;
      toolName='workspace.git.head';args={repository:input.repository};
    }else if(workflow==='F16'&&['f16.source.runs','f16.source.jobs','f16.source.log'].includes(request.actionKey)){
      nodeId='F16_N01';
      if(request.actionKey.endsWith('.runs')){toolName='github.actions.run.list';args={repo:input.repository,status:'failure'};}
      else if(request.actionKey.endsWith('.jobs')){toolName='github.actions.job.list';args={repo:input.repository,runId:input.runId};}
      else {toolName='github.actions.log.read';args={repo:input.repository,runId:input.runId,jobId:input.jobId,maxChars:65536};}
    }else if(workflow==='F16'&&['f16.completion.runs','f16.completion.jobs'].includes(request.actionKey)){
      nodeId='F16_N05';
      if(request.actionKey.endsWith('.runs')){toolName='github.actions.run.list';args={repo:input.repository,status:'success'};}
      else {toolName='github.actions.job.list';args={repo:input.repository,runId:
        f16CiIdentityRecipe==='github-readback'?recipeRun(scope).run.runId:ciIdentity(scope).runId};}
    }else return;
    if(!isDeepStrictEqual(request.input,args))fail('UNAUTHORIZED','F16/F17 business input substitution');
    return {workflowId:workflow,nodeId,hostToolName:F16_F17_CONFIGURATIONS[workflow].nodes[nodeId],toolName,toolVersion:toolVersion(toolName),arguments:args};
  };
  const bridge=()=>{
    const application=app();let value=bridges.get(application);
    if(!value){value=r.createWorkflowBusinessToolBridge({application,resolveTool,now,assertCurrent:(scope,ctx)=>{
      const node=application.readHostToolTask(ctx.taskId).toolName;
      const workflow=node.startsWith('workflow.host.f16')?'F16':node.startsWith('workflow.host.f17')?'F17':
        application.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F17',sessionId:scope.sessionId,signal:scope.signal})?'F17':'F16';
      binding(workflow,scope);
    }});bridges.set(application,value);}return value;
  };
  const invokeWorkspaceHead=async(scope,request,ctx)=>sourceRef(await bridge().invoke({actionKey:request.actionKey,input:request.arguments},ctx));
  const f16=r.createF16CiFailurePorts({application,selectionCheckpointKey:'f16:configured-source',now,invokeWorkspaceHead});
  const f17=r.createF17ReproductionPorts({application,checkpointPrefix:'f17:configured-reproduction:',recipes:workspace.recipes,now,invokeWorkspaceHead});
  const head=r.createF16HeadReader({application,now,invokeWorkspaceHead});
  if(f16TestIntent==='preserved-bytes')f16TestIntent=createF16TestIntentPort({getApplication:app,root:workspace.root,
    assertCurrent:scope=>current('F16',{taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal}),
    readHead:(scope,ctx,stage)=>head(scope,ctx,binding('F16',scope).input.repository,'f16',stage),
    resolveScope(ctx,nodeId){
      const runtime=app().runtime,parent=runtime.loadCheckpoint(ctx.taskId,'coding-repair:parent');
      const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
      const edge=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
      const original=app().readAuthorizationQuestionInvocation(ctx.taskId,ctx.runId),host=app().readHostToolTask(ctx.taskId);
      if(!original||!parent||ctx.runId!=='host-tool-'+ctx.taskId||!ctx.authorizationRef||intent?.taskId!==parent.taskId||intent?.workflowId!=='F16'
        ||intent.proposal?.nodeId!==nodeId||intent.proposal.operationId!==parent.operationId||intent.deadline!==ctx.deadline
        ||intent.proposal.toolName!==F16_F17_CONFIGURATIONS.F16.nodes[nodeId]||original.toolName!==intent.proposal.toolName
        ||original.toolVersion!=='1.0.0'||original.deadline!==ctx.deadline||!isDeepStrictEqual(original.arguments,{})
        ||!isDeepStrictEqual(intent.proposal.arguments,original.arguments)||edge?.localTaskId!==ctx.taskId
        ||edge.request?.commandId!==parent.operationId||edge.request.toolName!==original.toolName||edge.request.toolVersion!==original.toolVersion
        ||edge.request.deadline!==ctx.deadline||!isDeepStrictEqual(edge.request.arguments,original.arguments)
        ||host.commandId!==parent.operationId||host.toolName!==original.toolName||host.toolVersion!==original.toolVersion)
        fail('UNAUTHORIZED','Original F16 review invocation changed');
      const scope={parentTaskId:parent.taskId,sessionId:intent.sessionId,localTaskId:ctx.taskId,operationId:parent.operationId,
        deadline:ctx.deadline,signal:ctx.signal};return {scope,bound:binding('F16',scope)};
    }});
  const authorizeHost=workflow=>async(scope,value)=>{
    binding(workflow,scope);
    const allowed=await wait(scope,()=>authorizeExport({workflowId:workflow,taskId:scope.parentTaskId,localTaskId:scope.localTaskId,
      stage:'receipt',value:structuredClone(value),deadline:scope.deadline,signal:scope.signal}));
    binding(workflow,scope);return allowed===true;
  };
  const hosts={F16:r.createRuntimeF16CiFailureHost({application,now,requiredScopes:['github:read','workspace:read'],
    assertCurrent:scope=>{binding('F16',scope);},authorizeExport:authorizeHost('F16'),readCurrentHead:f16.readCurrentHead,
    async resolveFailure(scope,ctx){
      const {input}=binding('F16',scope),reads=[];
      for(const [actionKey,args] of [['f16.source.runs',{repo:input.repository,status:'failure'}],
        ['f16.source.jobs',{repo:input.repository,runId:input.runId}],
        ['f16.source.log',{repo:input.repository,runId:input.runId,jobId:input.jobId,maxChars:65536}]])
        reads.push(sourceRef(await bridge().invoke({actionKey,input:args},ctx)));
      const value={repo:input.repository,headSha:input.headSha,runId:input.runId,jobId:input.jobId,runList:reads[0],jobList:reads[1],logRead:reads[2]};
      f16.bindSelection(scope,value);
      if(f16TestIntent?.capture)await wait(scope,()=>f16TestIntent.capture(scope,ctx,input));
      return value;
    }}),
    F17:r.createRuntimeF17FailureReportHost({application,now,requiredScopes:['workspace:read'],workspaceRoot:workspace.root,
      readDriver:r.createF17ConfiguredDriverResolver(application,{configurationVersion:F16_F17_CONFIGURATIONS.F17.configurationVersion}),
      resolveReproduction:f17.resolveReproduction,assertCurrent:scope=>{binding('F17',scope);},authorizeExport:authorizeHost('F17')})};
  const initialInput=async(workflow,scope,args)=>{
    current(workflow,scope);const selected=await wait(scope,()=>workspace.readSelection(workflow,scope));current(workflow,scope);
    if(!selected||selected.selectionRef!==args.selectionRef)fail('UNAUTHORIZED','Original workspace selection changed');
    const saved={selectionRef:selected.selectionRef,repository:selected.repository,headSha:selected.headSha,recipeId:selected.recipeId};
    if(!workspace.recipes.some(v=>v.id===selected.recipeId))fail('UNSUPPORTED_CAPABILITY','Original selected recipe unavailable');
    let input;
    if(workflow==='F16')input={...saved,runId:selected.runId,jobId:selected.jobId,patch:selected.patch};
    else if(selected.initialFailure?.kind==='competition'){
      const source=readF17InitialFailure(app(),scope,selected);
      input={...saved,sourceDigest:hash(source),initialFailure:source.command.result};
    }else{
      const sourceScope={parentTaskId:scope.taskId,deadline:scope.deadline,sessionId:selected.sourceSessionId};
      const original=selected.initialFailure;
      if(!original)fail('UNSUPPORTED_CAPABILITY','Original failing test source unavailable');
      const command=r.readF16Source(application,sourceScope,original.command,'workspace.run_allowed_command');
      const before=r.readF16Source(application,sourceScope,original.beforeHead,'workspace.git.head');
      const after=r.readF16Source(application,sourceScope,original.afterHead,'workspace.git.head');
      const times=[before.record.finishedAt,command.record.startedAt,command.record.finishedAt,after.record.startedAt];
      if(new Set([command.ref.taskId,before.ref.taskId,after.ref.taskId]).size!==3||!Number.isSafeInteger(command.result.exitCode)
        ||command.result.exitCode<=0||!isDeepStrictEqual(command.ref.arguments,{recipeId:command.result.recipeId})
        ||!times.every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))
        ||!isDeepStrictEqual(before.result,after.result)||before.result.headSha!==saved.headSha||!/^[a-f0-9]{64}$/.test(before.result.fingerprint)
        ||!isDeepStrictEqual(before.ref.arguments,{repository:saved.repository})||!isDeepStrictEqual(after.ref.arguments,before.ref.arguments)
        ||Date.parse(before.record.finishedAt)>Date.parse(command.record.startedAt)||Date.parse(command.record.finishedAt)>Date.parse(after.record.startedAt))
        fail('UNAUTHORIZED','Original failure output and version are not bound');
      input={...saved,sourceDigest:hash({command,before,after}),initialFailure:command.result};
    }
    validateToolValue(F16_F17_CONFIGURATIONS[workflow].inputSchema,input);
    const key='f16-f17:configured-selection:'+workflow;
    app().runtime.saveCheckpointOnce(scope.taskId,key,{selected,input});
    if(!isDeepStrictEqual(app().runtime.loadCheckpoint(scope.taskId,key),{selected,input}))fail('REVISION_CONFLICT','Original selection or failure source replaced');
    return structuredClone(input);
  };
  const rememberCompletion=(workflow,scope,result,operations,headSha,fingerprint,sources=[])=>{
    const last=operations[workflow==='F16'?'F16_N05':'F17_N04'];
    const value={sessionId:scope.sessionId,deadline:scope.deadline,result,operations,sources,headSha,fingerprint,
      confirmedOperations:binding(workflow,{...scope,parentTaskId:scope.taskId}).confirmedOperations,
      localTaskId:last.localTaskId,operationId:last.operationId,...(workflow==='F17'?{
        reportSnapshot:app().runtime.loadCheckpoint(last.localTaskId,'f17:failure-report:'+last.operationId)}:{})};
    const key='f16-f17:completion:'+workflow;
    app().runtime.saveCheckpointOnce(scope.taskId,key,value);
    if(!isDeepStrictEqual(app().runtime.loadCheckpoint(scope.taskId,key),value))fail('REVISION_CONFLICT','Original completion changed');
  };
  const recheckCompletion=async(workflow,scope,result,stage)=>{
    const saved=app().runtime.loadCheckpoint(scope.taskId,'f16-f17:completion:'+workflow);
    if(!saved||saved.deadline!==scope.deadline||!isDeepStrictEqual(saved.result,result))fail('UNAUTHORIZED','Original completion unavailable');
    const hostScope={...scope,parentTaskId:scope.taskId,sessionId:saved.sessionId,localTaskId:saved.localTaskId,operationId:saved.operationId};
    const bound=binding(workflow,hostScope);
    if(!isDeepStrictEqual(bound.confirmedOperations,saved.confirmedOperations??Object.values(saved.operations)))
      fail('REVISION_CONFLICT','Completion operations changed');
    for(const source of saved.sources)
      if(!isDeepStrictEqual(source,r.readF16Source(application,hostScope,source.ref,source.read.toolName)))
        fail('REVISION_CONFLICT','Completion source changed');
    if(workflow==='F17'){
      const report=app().runtime.loadCheckpoint(saved.localTaskId,'f17:failure-report:'+saved.operationId);
      f17.assertReproductionCurrent(hostScope,saved.operations.F17_N03.operationId);
      if(!report||!isDeepStrictEqual(report,saved.reportSnapshot)||!isDeepStrictEqual(report.report,result)||report.document.reproduction.headSha!==saved.headSha
        ||report.document.reproduction.command.taskId!==saved.operations.F17_N03.localTaskId)
        fail('REVISION_CONFLICT','Completed F17 report changed');
    }else{
      f16.assertSelectionCurrent(hostScope);
      if(await wait(scope,()=>f16TestIntent.verifyReceipt({...scope,input:structuredClone(bound.input),
        patch:structuredClone(saved.operations.F16_N03),review:structuredClone(saved.operations.F16_N04)}))!==true)
        fail('UNAUTHORIZED','Original test intent review is no longer current');
    }
    const observed=await head(hostScope,context(saved.localTaskId,scope),bound.input.repository,workflow.toLowerCase(),stage);
    if(observed.result.headSha!==saved.headSha||observed.result.fingerprint!==saved.fingerprint)
      fail('REVISION_CONFLICT','Completed workspace version changed');
    binding(workflow,hostScope);
  };
  for(const workflow of ['F16','F17']){
    const definition=F16_F17_CONFIGURATIONS[workflow];
    if(workflow==='F16'&&(f16TestIntent?.tool?.descriptor?.name!=='workflow.host.f16_n04'
      ||f16TestIntent.tool.descriptor.version!=='1.0.0'||typeof f16TestIntent.available!=='function'||typeof f16TestIntent.verifyReceipt!=='function')){
      unavailable.push('f16_test_intent_verifier_unavailable');continue;}
    if(workflow==='F16'&&(!/^[a-f0-9]{64}$/.test(workspace.patchReconciliation?.bindingId)
      ||typeof workspace.patchReconciliation?.reconcile!=='function')){
      unavailable.push('f16_workspace_recovery_unavailable');continue;}
    tools.push(...hosts[workflow].tools);
    if(workflow==='F16')tools.push(f16TestIntent.tool);
    configuredWorkflowWorkerPorts.push({workflowId:workflow,toolName:definition.toolName,toolVersion:definition.version,
      configurationVersion:configurationVersion(workflow),requestSchema:structuredClone(definition.requestSchema),inputSchema:structuredClone(definition.inputSchema),
      resultSchema:structuredClone(definition.resultSchema),publicEnumPaths:[],sideEffect:'local_write',
      requiredTools:definition.tools.map(name=>({name,version:toolVersion(name)})),
      async available(scope){try{current(workflow,scope);const allowed=await wait(scope,()=>authority.available(workflow,scope));
        const ready=allowed===true&&await wait(scope,()=>workspace.available(workflow,scope))===true
          &&(workflow!=='F16'||await wait(scope,()=>f16TestIntent.available(scope))===true);
        current(workflow,scope);return ready;}catch{return false;}},
      assertCurrent:scope=>{current(workflow,scope);},resolveInput:(args,scope)=>initialInput(workflow,scope,args),
      async assertFrontier({input,proposal,state,...scope}){
        const bound=binding(workflow,{...scope,parentTaskId:scope.taskId,sessionId:state.sessionId});
        const decisionProposal=proposal.toolName==='decision.choose_candidate';
        if(!isDeepStrictEqual(input,bound.input)||!definition.nodes[proposal.nodeId]
          ||!decisionProposal&&definition.nodes[proposal.nodeId]!==proposal.toolName||proposal.toolVersion!=='1.0.0')return false;
        const node=getOwnedWorkflowTemplate(workflow).nodes.find(v=>v.id===proposal.nodeId);
        if(!node||node.dependencies.some(dep=>state.result?.nodes[dep.nodeId]?.state!=='completed'))return false;
        for(const dependency of node.dependencies){
          const expected=definition.nodes[dependency.nodeId];
          const originals=bound.confirmedOperations.filter(v=>v.nodeId===dependency.nodeId&&v.toolName===expected);
          if(expected&&originals.length!==1)return false;
          if(expected==='decision.choose_candidate'){
            const decision=originals[0];let request;
            try{request=JSON.parse(app().runtime.loadCheckpoint(decision.localTaskId,'host-tool-intent')?.arguments?.context);}catch{return false;}
            const selected=request.candidateValues?.find(v=>v.id===decision.result.selectedId);
            if(!selected||selected.abstain===true||workflow==='F16'&&selected.value?.legitimateFix!==true)return false;
          }
        }
        if(workflow==='F16'&&proposal.nodeId!=='F16_N01')f16.assertSelectionCurrent({...scope,parentTaskId:scope.taskId,sessionId:state.sessionId});
        if(proposal.nodeId==='F16_N03'){
          const failure=bound.confirmedOperations.find(v=>v.nodeId==='F16_N01'&&v.toolName===definition.nodes.F16_N01);
          if(!failure||failure.result.commitSha!==input.headSha||failure.result.runId!==input.runId||failure.result.jobId!==input.jobId)return false;
          const sourceScope={...scope,parentTaskId:scope.taskId,sessionId:state.sessionId,localTaskId:failure.localTaskId,operationId:failure.operationId};
          if(await f16.readCurrentHead(sourceScope,context(failure.localTaskId,scope),'execute')!==input.headSha)return false;
        }
        if(proposal.nodeId==='F16_N05'){
          const patch=bound.confirmedOperations.find(v=>v.nodeId==='F16_N03'&&v.toolName===definition.nodes.F16_N03),
            review=bound.confirmedOperations.find(v=>v.nodeId==='F16_N04'&&v.toolName===definition.nodes.F16_N04);
          if(!patch||!review||review.result.noCheatingDetected!==true||review.result.patchDigest!==hash(input.patch)
            ||await wait(scope,()=>f16TestIntent.verifyReceipt({...scope,input:structuredClone(input),patch:structuredClone(patch),review:structuredClone(review)}))!==true)return false;
        }
        binding(workflow,{...scope,parentTaskId:scope.taskId,sessionId:state.sessionId});
        if(decisionProposal){
          let decision;try{decision=JSON.parse(proposal.arguments.context);}catch{return false;}
          return decision.workflowId===workflow&&decision.nodeId===proposal.nodeId&&isDeepStrictEqual(decision.input,input)
            &&Array.isArray(decision.candidateValues)&&Array.isArray(proposal.arguments.candidates)
            &&isDeepStrictEqual(decision.candidateValues.map(v=>v.id),proposal.arguments.candidates.map(v=>v.id));
        }
        const selections=bound.confirmedOperations.filter(operation=>operation.nodeId===proposal.nodeId&&operation.toolName==='decision.choose_candidate');
        if(selections.length){
          let request;try{request=JSON.parse(app().runtime.loadCheckpoint(selections[0].localTaskId,'host-tool-intent')?.arguments?.context);}catch{return false;}
          const choice=request?.candidateValues?.find(value=>value.id===selections[0].result.selectedId);
          if(selections.length!==1||!choice||choice.abstain===true)return false;
        }
        const args=proposal.nodeId==='F16_N03'?input.patch:
          ['F16_N05','F17_N03'].includes(proposal.nodeId)?{recipeId:input.recipeId}:{};
        return isDeepStrictEqual(proposal.arguments,args);
      },
      async authorizeExport(value){
        const {taskId,deadline,signal,stage,localTaskId,proposal}=value;current(workflow,value);
        let originalRead;
        if(stage==='receipt'){
          if(!localTaskId||!proposal)fail('UNAUTHORIZED','Original receipt export identity required');
          const ctx=context(localTaskId,value),parent=app().runtime.loadCheckpoint(localTaskId,'coding-repair:parent');
          if(parent?.taskId!==taskId||parent.operationId!==proposal.operationId)fail('UNAUTHORIZED','Foreign graph receipt');
          const read=app().readHostToolTask(localTaskId),original=value.value;
          originalRead=read;
          if(original?.state!=='confirmed'||!isDeepStrictEqual(read.confirmed.result,original.result))fail('UNAUTHORIZED','Changed graph receipt');
          const boundScope={parentTaskId:taskId,localTaskId,operationId:proposal.operationId,
            sessionId:app().runtime.loadCheckpoint(taskId,'owned-workflow:intent:'+proposal.operationId)?.sessionId,deadline,signal};
          if(workflow==='F17'&&proposal.nodeId==='F17_N03'&&proposal.toolName==='workspace.run_allowed_command')f17.bindObservedReproduction(boundScope,{taskId:localTaskId,
            runId:ctx.runId,scopeRef:ctx.runId,toolVersion:read.toolVersion,arguments:app().runtime.loadCheckpoint(localTaskId,'host-tool-intent').arguments});
          if(proposal.toolName===hosts[workflow].tools[0].descriptor.name){
            await hosts[workflow].authorizeReceipt({context:ctx,result:original.result});return true;
          }
        }
        if(stage==='completion')await recheckCompletion(workflow,value,value.value,'before_export');
        const allowed=await wait(value,()=>authorizeExport({...value,value:structuredClone(value.value),
          ...(value.proposal?{proposal:structuredClone(value.proposal)}:{}),workflowId:workflow}));current(workflow,value);
        if(allowed!==true)return false;
        if(originalRead&&!isDeepStrictEqual(originalRead,app().readHostToolTask(localTaskId)))fail('REVISION_CONFLICT','Receipt changed during export');
        if(workflow==='F16'&&stage==='receipt'&&proposal.toolName==='workflow.host.f16_n04'){
          const parent=app().runtime.loadCheckpoint(localTaskId,'coding-repair:parent');
          const intent=app().runtime.loadCheckpoint(taskId,'owned-workflow:intent:'+parent.operationId);
          const bound=binding('F16',{parentTaskId:taskId,localTaskId,sessionId:intent.sessionId,deadline,signal});
          // The receipt is not confirmed in the graph until export completes. Check
          // exact current bytes via the production port without fabricating graph state.
          if(f16TestIntent.assertReceiptCurrent)await wait(value,()=>f16TestIntent.assertReceiptCurrent({scope:{parentTaskId:taskId,
            localTaskId,sessionId:intent.sessionId,deadline,signal},input:bound.input,patch:bound.confirmedOperations.find(operation=>
              operation.nodeId==='F16_N03'&&operation.toolName==='workspace.apply_text_patch'),result:originalRead.confirmed.result}));
        }
        if(stage==='initial'&&!isDeepStrictEqual(value.value,await initialInput(workflow,value,{selectionRef:value.value.selectionRef})))
          fail('REVISION_CONFLICT','Initial source changed during export');
        if(stage==='completion')await recheckCompletion(workflow,value,value.value,'after_export');
        return true;
      },
      async verifyCompletion({input,state,readbacks,...scope}){
        const owner={...scope,parentTaskId:scope.taskId,sessionId:state.sessionId},bound=binding(workflow,owner);
        if(!isDeepStrictEqual(input,bound.input)||!isDeepStrictEqual(input,await initialInput(workflow,scope,{selectionRef:input.selectionRef})))
          fail('REVISION_CONFLICT','Original configured input changed');
        const template=getOwnedWorkflowTemplate(workflow);
        if(template.nodes.some(node=>node.required&&state.result?.nodes[node.id]?.state!=='completed')
          ||readbacks.length!==bound.confirmedOperations.length)
          fail('UNAUTHORIZED','Incomplete original F16/F17 graph');
        const operations={};for(const operation of bound.confirmedOperations){
          if(operation.toolName==='decision.choose_candidate'&&definition.nodes[operation.nodeId]!==operation.toolName){
            const siblings=bound.confirmedOperations.filter(item=>item.nodeId===operation.nodeId&&item.toolName===operation.toolName);
            let request;try{request=JSON.parse(app().runtime.loadCheckpoint(operation.localTaskId,'host-tool-intent')?.arguments?.context);}catch{}
            const choice=request?.candidateValues?.find(item=>item.id===operation.result.selectedId);
            if(!definition.nodes[operation.nodeId]||siblings.length!==1||!choice||choice.abstain===true
              ||request.workflowId!==workflow||request.nodeId!==operation.nodeId||!isDeepStrictEqual(request.input,input)
              ||!readbacks.some(read=>isDeepStrictEqual(read,operation.readback)))fail('UNAUTHORIZED','Original node selection changed');
            continue;
          }
          if(operations[operation.nodeId]||definition.nodes[operation.nodeId]!==operation.toolName
            ||!readbacks.some(read=>isDeepStrictEqual(read,operation.readback)))fail('UNAUTHORIZED','Foreign completion operation');
          operations[operation.nodeId]=operation;
        }
        if(Object.keys(operations).length!==Object.keys(definition.nodes).length)fail('UNAUTHORIZED','Required original node execution missing');
        if(workflow==='F17'){
          const command=operations.F17_N03,report=operations.F17_N04;
          const saved=app().runtime.loadCheckpoint(report.localTaskId,'f17:failure-report:'+report.operationId);
          if(command.result.exitCode<=0||command.result.recipeId!==input.recipeId||!saved
            ||saved.document.reproduction.command.taskId!==command.localTaskId||saved.document.reproduction.headSha!==input.headSha
            ||!isDeepStrictEqual(saved.report,report.result))fail('UNAUTHORIZED','Original F17 report source changed');
          rememberCompletion(workflow,owner,report.result,operations,input.headSha,saved.document.reproduction.workspaceFingerprint);
          return {result:report.result,resultSummary:'Original failed reproduction and version-bound failure report confirmed'};
        }
        const patchOperation=operations.F16_N03,review=operations.F16_N04,command=operations.F16_N05;
        f16.assertSelectionCurrent(owner);
        if(patchOperation.result.applied!==true||patchOperation.result.path!==input.patch.path
          ||patchOperation.result.beforeSha256!==input.patch.expectedSha256
          ||review.result.noCheatingDetected!==true||review.result.patchDigest!==hash(input.patch)
          ||await wait(scope,()=>f16TestIntent.verifyReceipt({...scope,input:structuredClone(input),patch:structuredClone(patchOperation),review:structuredClone(review)}))!==true)
          fail('UNAUTHORIZED','Original patch or test intent verification unavailable');
        binding(workflow,owner);
        const commandScope={...owner,localTaskId:command.localTaskId,operationId:command.operationId},ctx=context(command.localTaskId,scope);
        if(f16CiIdentityRecipe==='github-readback'){
          const original=await f16.resolveFailure(commandScope),baseline=f16TestIntent.readBaseline(commandScope,input);
          const failureRuns=r.readF16Source(application,commandScope,original.runList,'github.actions.run.list');
          const failureJobs=r.readF16Source(application,commandScope,original.jobList,'github.actions.job.list');
          const observed=await head(commandScope,ctx,input.repository,'f16','execute');
          const commandSource=r.readF16Source(application,commandScope,{taskId:command.localTaskId,runId:ctx.runId,scopeRef:ctx.runId,
            toolVersion:command.toolVersion,arguments:{recipeId:input.recipeId}},'workspace.run_allowed_command');
          const patchRecord=app().runtime.readToolExecutions(patchOperation.localTaskId).find(item=>item.evidenceId===patchOperation.readback.confirmed.runId);
          const read=await bridge().invoke({actionKey:'f16.completion.runs',input:{repo:input.repository,status:'success'}},ctx);
          const runs=r.readF16Source(application,commandScope,sourceRef(read),'github.actions.run.list');
          const parameters={input,baseline:baseline.bytes,originalRun:failureRuns.result.items.find(run=>run.id===input.runId),
            head:observed,command:commandSource,patchRecord,runs,failureRuns,failureJobs};
          const saved={...parameters,run:selectF16RepairedRun(parameters)};
          app().runtime.saveCheckpointOnce(command.localTaskId,'f16:ci-readback-run',saved);
          if(!isDeepStrictEqual(saved,recipeRun(commandScope)))fail('REVISION_CONFLICT','Original repaired CI target changed');
          const jobs=await bridge().invoke({actionKey:'f16.completion.jobs',input:{repo:input.repository,runId:saved.run.runId}},ctx);
          const jobSource=r.readF16Source(application,commandScope,sourceRef(jobs),'github.actions.job.list');
          selectF16RepairedJob({input,run:saved.run,originalJob:failureJobs.result.items.find(job=>job.id===input.jobId),jobs:jobSource});
          app().runtime.saveCheckpointOnce(command.localTaskId,'f16:ci-readback-identity',{jobs:jobSource});
        }
        const identity=ciIdentity(commandScope),runs=await bridge().invoke({actionKey:'f16.completion.runs',input:{repo:input.repository,status:'success'}},ctx);
        const jobs=await bridge().invoke({actionKey:'f16.completion.jobs',input:{repo:input.repository,runId:identity.runId}},ctx);
        const runSource=r.readF16Source(application,commandScope,sourceRef(runs),'github.actions.run.list');
        const jobSource=r.readF16Source(application,commandScope,sourceRef(jobs),'github.actions.job.list');
        const run=runSource.result.items?.find(v=>v.id===identity.runId),job=jobSource.result.items?.find(v=>v.id===identity.jobId);
        const currentHead=await head(commandScope,ctx,input.repository,'f16','after_export');
        const patchRecord=app().runtime.readToolExecutions(patchOperation.localTaskId).find(v=>v.evidenceId===patchOperation.readback.confirmed.runId);
        if(run?.status!=='completed'||run.conclusion!=='success'||run.headSha!==identity.headSha
          ||job?.runId!==identity.runId||job.status!=='completed'||job.conclusion!=='success'||currentHead.result.headSha!==identity.headSha
          ||!Number.isFinite(Date.parse(run.createdAt))||Date.parse(run.createdAt)<Date.parse(patchRecord.finishedAt))
          fail('UNAUTHORIZED','Original repaired commit CI is not independently confirmed');
        binding(workflow,owner);
        const result={ciStatus:'passed',headSha:identity.headSha,runId:identity.runId,jobId:identity.jobId,verificationRunId:command.readback.confirmed.runId};
        rememberCompletion(workflow,owner,result,operations,identity.headSha,currentHead.result.fingerprint,[runSource,jobSource]);
        return {result,resultSummary:'Original patch, test intent and repaired commit CI confirmed'};
      },
    });
  }
  const commandTool=configuredWorkflowWorkerPorts.some(v=>v.workflowId==='F17')?r.createF17ObservedCommandTool({getApplication,
    tool:workspace.commandTool,recipes:workspace.recipes,now,invokeWorkspaceHead,assertCurrent:scope=>{binding('F17',scope);}}):workspace.commandTool;
  return {tools,configuredWorkflowWorkerPorts,commandTool,workspacePatchReconciliation:workspace.patchReconciliation,unavailable};
}
