import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate,workflowShadowReleaseDigest as digest,
  createWorkflowShadowReleaseService,createWorkflowShadowReleaseAdapter,createWorkflowShadowReleaseReadbackAdapter} from '@personal-agent/agentarts';
import {invokeF23PairedEvaluation} from './f23-evaluation-transport.js';
import {readAgentArtsEvaluation} from './agentarts-evaluation-readback.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:256},empty=object({}),scopes=['workflow:configuration:write'];
const fail=(code='UNAUTHORIZED')=>{throw new ProtocolError(code,'原 F23 样本、授权、评估或配置尚未核实');};
export const F23_PREPARE_TOOL='workflow.evaluation.prepare';
export const F23_BIND_TOOL='workflow.evaluation.bind';

/** F23 production composition: original host tasks, actual cloud outputs, platform scores and existing guarded CAS. */
export function createDesktopF23WorkflowPorts({runtimeModule,getApplication,models,configuration,decisionConfiguration,
  namespace,authorizeEvaluation,authorizeExport,invokePaired=invokeF23PairedEvaluation,readEvaluation=readAgentArtsEvaluation,onUpdate=()=>{}}){
  const app=()=>getApplication(),runtime=()=>app().runtime,acceptanceNamespace=namespace+':f23-acceptance';
  const state=()=>runtime().bindTrustedHostState(namespace+':f23-evaluation');
  const deployment=()=>({...configuration.binding(),version:configuration.snapshot().deploymentVersion,credentialRef:configuration.readCredentialReference()});
  function original(context,name,args){
    const invocation=app().readAuthorizationQuestionInvocation(context.taskId,context.runId),read=app().readHostToolTask(context.taskId),
      record=runtime().readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId),grant=runtime().policy.get(context.authorizationRef);
    if(context.signal.aborted||Date.parse(context.deadline)<=Date.now()||!invocation||invocation.deadline!==context.deadline
      ||read.task.state!=='running'||read.task.cancelRequested||read.toolName!==name||invocation.toolName!==name
      ||!same(invocation.arguments,args)||!record||record.state!=='started'||record.policyDecision!=='allow'||!record.executionStarted
      ||!runtime().isToolExecutionActive(record)||!runtime().matchesToolExecutionInput(record,{arguments:args,scopeRef:context.runId})
      ||!grant||grant.taskId!==context.taskId||grant.toolName!==name||grant.argumentsDigest!==toolArgumentsDigest(args)
      ||Date.parse(grant.expiresAt)<=Date.now()||!scopes.every(scope=>grant.scopes.includes(scope)))fail();
  }
  const acceptance=id=>runtimeModule.readRuntimeWorkflowShadowAcceptanceCurrent(runtime(),acceptanceNamespace,id,'f23:'+id);
  function experiment(id){
    const saved=runtime().loadCheckpoint(id,'f23:experiment'),receipt=runtime().loadCheckpoint(id,'f23:outputs'),read=app().readHostToolTask(id);
    if(!saved||!receipt||read.toolName!==F23_PREPARE_TOOL||read.task.state!=='succeeded'||!read.confirmed||read.task.cancelRequested
      ||!same(read.confirmed.result,{experimentId:id,outputDigest:digest(receipt),status:'awaiting_platform_evaluation'})
      ||!same(saved.deployment,deployment())||!same(saved.acceptance,acceptance(id)))fail('UNSUPPORTED_CAPABILITY');
    models.resolveExecutionModel(saved.input.main);models.resolveExecutionModel(saved.input.shadow);
    return {saved,receipt};
  }
  function validateExperiment(input){
    if(!input||Object.keys(input).sort().join(',')!=='candidate,candidateVersion,cases,expiresAt,metricRules,splitAt'
      ||typeof input.candidateVersion!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(input.candidateVersion)
      ||!Number.isFinite(Date.parse(input.splitAt))||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now()
      ||!Array.isArray(input.cases)||!input.cases.length||input.cases.length>10||new Set(input.cases.map(item=>item.id)).size!==input.cases.length
      ||input.cases.some(item=>!item||Object.keys(item).sort().join(',')!=='availableAt,expectedAt,id,input,reference'
        ||!/^[A-Za-z0-9_-]{1,64}$/.test(item.id)||typeof item.input!=='string'||!item.input.trim()||item.input.length>16000
        ||typeof item.reference!=='string'||!item.reference.trim()||item.reference.length>16000
        ||!Number.isFinite(Date.parse(item.availableAt))||!Number.isFinite(Date.parse(item.expectedAt))
        ||Date.parse(item.availableAt)>Date.parse(input.splitAt)||Date.parse(item.expectedAt)<=Date.parse(input.splitAt)))fail('INVALID_ARGUMENT');
    return models.resolveExecutionModel(input.candidate);
  }
  const prepare={descriptor:{name:F23_PREPARE_TOOL,version:'1.0.0',sideEffect:'external_write',requiredScopes:scopes,
    requiresPresence:false,idempotencySupport:false,recoverySupport:false,inputSchema:object({experiment:{type:'object'}}),outputSchema:{type:'object'}},
    async execute(args,context){
      original(context,F23_PREPARE_TOOL,args);const candidate=validateExperiment(args.experiment),baseline=decisionConfiguration.readDecisionConfiguration();
      if(!baseline||!deployment().version)fail('UNSUPPORTED_CAPABILITY');
      const source=structuredClone(args.experiment),input={evaluationVersion:1,operation:'paired_model_outputs',main:baseline.executionModel,shadow:candidate,
        cases:source.cases.map(item=>({id:item.id,messages:[{role:'user',content:item.input}]}))};
      const policy={policyId:'f23:'+context.taskId,revision:1,configurationId:decisionConfiguration.configurationId,taskClass:'f03-model-candidate-generation',
        validFrom:new Date().toISOString(),expiresAt:new Date(source.expiresAt).toISOString(),baseline:{...baseline.configuration,resultBaselineSha256:digest(source.cases)},
        candidate:{version:source.candidateVersion,parametersDigest:digest(candidate)},conditionsDigest:digest({cases:input.cases,splitAt:source.splitAt}),
        qualityMetricId:'agentarts-evaluation',metricRules:source.metricRules,requiredChecks:['original_outputs','temporal_manifest','platform_evaluation']};
      delete policy.baseline.configurationId;
      const saved={source,input,baseline,deployment:deployment(),acceptance:policy};
      const current=()=>{original(context,F23_PREPARE_TOOL,args);if(!same(deployment(),saved.deployment)||!same(decisionConfiguration.readDecisionConfiguration(),baseline))fail('REVISION_CONFLICT');};
      const host=runtimeModule.createRuntimeWorkflowShadowAcceptanceHost({runtime:runtime(),namespace:acceptanceNamespace,stateKey:context.taskId,requiredScopes:scopes,
        authorize:async(c,action,value)=>{current();return c===context&&action==='configure'&&same(value,policy);}});
      if(!runtime().saveCheckpointOnce(context.taskId,'f23:experiment',saved))fail('RESULT_UNKNOWN');
      await host.configure('f23-acceptance:'+context.taskId,policy,context);current();
      const receipt=await invokePaired({configuration,input,context,assertCurrent:current});current();
      for(const branch of ['main','shadow']){
        const rows=receipt?.result?.branches?.[branch];
        if(!Array.isArray(rows)||rows.length!==input.cases.length||rows.some((row,i)=>row.id!==input.cases[i].id
          ||row.inputDigest!==hash(input.cases[i].messages)||typeof row.output!=='string'||!row.output.trim()||row.output.length>64000
          ||!Number.isFinite(row.wallMs)||row.wallMs<0||row.modelCalls!==1||row.deployment?.verification==='mock'
          ||!Number.isFinite(Date.parse(row.startedAt))||!Number.isFinite(Date.parse(row.finishedAt))
          ||Date.parse(row.startedAt)<Date.parse(policy.validFrom)||Date.parse(row.finishedAt)>Date.now()))fail('PROTOCOL_MISMATCH');
      }
      if(!runtime().saveCheckpointOnce(context.taskId,'f23:outputs',receipt))fail('RESULT_UNKNOWN');
      state().set('latest',{experimentId:context.taskId});onUpdate();
      return {experimentId:context.taskId,outputDigest:digest(receipt),status:'awaiting_platform_evaluation'};
    }};
  function rows(id,branch){const {saved,receipt}=experiment(id);return saved.source.cases.map((item,i)=>({input:item.input,
    output:receipt.result.branches[branch][i].output,reference:item.reference}));}
  const bind={descriptor:{name:F23_BIND_TOOL,version:'1.0.0',sideEffect:'local_write',requiredScopes:scopes,requiresPresence:false,
    idempotencySupport:false,recoverySupport:false,inputSchema:object({experimentId:text,main:{type:'object'},shadow:{type:'object'}}),outputSchema:{type:'object'}},
    async execute(args,context){original(context,F23_BIND_TOOL,args);experiment(args.experimentId);
      const value={experimentId:args.experimentId,main:args.main,shadow:args.shadow};
      await scores(value,context,()=>original(context,F23_BIND_TOOL,args));original(context,F23_BIND_TOOL,args);
      if(!runtime().saveCheckpointOnce(context.taskId,'f23:evaluations',value))fail('RESULT_UNKNOWN');
      state().set('latest',{experimentId:args.experimentId,evaluationTaskId:context.taskId});onUpdate();return {evaluationTaskId:context.taskId,experimentId:args.experimentId};
    }};
  async function scores(value,context,assertCurrent){
    const results={};for(const branch of ['main','shadow']){
      const binding=value[branch],dataset=rows(value.experimentId,branch);
      if(!binding||Object.keys(binding).sort().join(',')!=='datasetId,datasetVersion,evaluatorId,evaluatorVersion,itemIds,taskId'
        ||!Array.isArray(binding.itemIds)||binding.itemIds.length!==dataset.length)fail('INVALID_ARGUMENT');
      results[branch]=await readEvaluation({...binding,expected:dataset.map((item,i)=>({itemId:binding.itemIds[i],inputDigest:hash([item]),outputDigest:hash([])})),
        deadline:context.deadline,signal:context.signal,authorize:request=>authorizeEvaluation(request,[value.main.taskId,value.shadow.taskId]),assertCurrent});
    }
    if(value.main.evaluatorId!==value.shadow.evaluatorId||value.main.evaluatorVersion!==value.shadow.evaluatorVersion)fail('REVISION_CONFLICT');
    return results;
  }
  function source(evaluationTaskId){const read=app().readHostToolTask(evaluationTaskId),value=runtime().loadCheckpoint(evaluationTaskId,'f23:evaluations');
    if(!value||read.toolName!==F23_BIND_TOOL||read.task.state!=='succeeded'||read.task.cancelRequested||!read.confirmed
      ||!same(read.confirmed.result,{evaluationTaskId,experimentId:value.experimentId}))fail('UNSUPPORTED_CAPABILITY');
    return {...experiment(value.experimentId),evaluations:value,evaluationTaskId};}
  function current(scope){const task=runtime().getTask(scope.taskId);
    if(scope.signal.aborted||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state)
      ||runtime().loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline||Date.parse(scope.deadline)<=Date.now())fail();
    const saved=runtime().loadCheckpoint(scope.taskId,'f23:source');if(saved&&!same(saved,source(saved.evaluationTaskId)))fail('REVISION_CONFLICT');}
  function graph(scope,sessionId){current(scope);const value=app().readConfiguredWorkflowBinding({...scope,workflowId:'F23',sessionId});if(!value)fail();return value;}
  function operation(value,nodeId){const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName==='workflow.host.'+nodeId.toLowerCase());
    if(found.length!==1)fail();return found[0];}
  function host(context,nodeId,args){return runtimeModule.assertOwnedWorkflowHostScope({runtime:runtime(),context,workflowId:'F23',nodeId,
    hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:args,assertCurrent:s=>current({taskId:s.parentTaskId,deadline:s.deadline,signal:s.signal})});}
  function release(scope,context){
    const lifetime={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},value=graph(lifetime,scope.sessionId),input=value.input,
      originalSource=source(input.evaluationTaskId),policy=originalSource.saved.acceptance;
    const loop=runtime().loadCheckpoint(scope.parentTaskId,'competition-loop'),proposal=loop?.pending;
    if(proposal?.toolName!=='workflow.evaluation.release')fail();
    let port;
    const auth=runtimeModule.createRuntimeWorkflowShadowAuthorization({runtime:runtime(),hostUserNamespace:namespace,
      driverCheckpointKey:'owned-workflow:configured:'+hash([proposal.toolName,proposal.proposalId])+':graph',requiredScopes:scopes,
      now:()=>new Date(),readAcceptance:()=>acceptance(originalSource.evaluations.experimentId),readPromotion:(id,c)=>port.readOperation(id,c)});
    port=runtimeModule.createRuntimeWorkflowShadowConfigurationPort({runtime:runtime(),namespace:decisionConfiguration.stateNamespace,
      stateKey:decisionConfiguration.stateKey,requiredScopes:scopes,authorize:auth.authorize,commitGuard:auth.commitGuard,
      acceptanceBinding:{namespace:acceptanceNamespace,stateKey:originalSource.evaluations.experimentId,policyId:policy.policyId}});
    const verified=()=>operation(graph(lifetime,scope.sessionId),'F23_N03').result;
    return createWorkflowShadowReleaseService({configurationPort:port,acceptance:policy,requiredScopes:scopes,
      verifyBranch:async branch=>{current(lifetime);return same(branch,verified().releaseRequest[branch.branch]);},
      verifyTestEvidence:async evidence=>{current(lifetime);return same(evidence,verified().releaseRequest.testEvidence);},
      verifyComparable:async(main,shadow)=>{
        const before=verified(),readback=await scores(originalSource.evaluations,context,()=>current(lifetime));
        return same(before.scores,readback)&&same(main,before.releaseRequest.main)&&same(shadow,before.releaseRequest.shadow);
      }});
  }
  function expected(value,nodeId){if(nodeId==='F23_N04')return operation(value,'F23_N03').result.releaseRequest;
    if(nodeId==='F23_N05')return {operationId:operation(value,'F23_N03').result.releaseRequest.operationId,configurationId:decisionConfiguration.configurationId};return {};}
  const readTools=['F23_N01','F23_N02','F23_N03'].map(nodeId=>createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'read',requiredScopes:scopes,
    inputSchema:empty,outputSchema:{type:'object'},async execute(args,context){const scope=host(context,nodeId,args),life={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},
      value=graph(life,scope.sessionId),originalSource=source(value.input.evaluationTaskId),{saved,receipt,evaluations}=originalSource;
      if(nodeId==='F23_N01')return {datasetDigest:digest(saved.source.cases),experimentId:evaluations.experimentId,items:saved.source.cases.length};
      if(nodeId==='F23_N02'){operation(value,'F23_N01');validateExperiment(saved.source);return {state:'passed',scope:'manifest_time_split_only',splitAt:saved.source.splitAt};}
      operation(value,'F23_N02');const score=await scores(evaluations,context,()=>current(life)),policy=saved.acceptance,observedAt=new Date().toISOString();
      const branch=name=>({receiptId:scope.parentTaskId+':'+name,taskKey:scope.parentTaskId,taskClass:policy.taskClass,decisionRef:evaluations.experimentId,
        branch:name,candidateId:name==='main'?saved.input.main.modelId:saved.input.shadow.modelId,baselineSha256:policy.baseline.resultBaselineSha256,
        conditionsDigest:policy.conditionsDigest,workspaceRef:evaluations.experimentId+':'+name,resultSha256:digest(receipt.result.branches[name]),
        qualityMetricId:policy.qualityMetricId,qualityScore:score[name].qualityScore,wallMs:receipt.result.branches[name].reduce((sum,item)=>sum+item.wallMs,0),
        modelCalls:receipt.result.branches[name].reduce((sum,item)=>sum+item.modelCalls,0),evidenceRefs:[app().readHostToolTask(evaluations.experimentId).confirmed.runId,score[name].digest],
        proof:{experimentId:evaluations.experimentId,evaluationDigest:score[name].digest},configurationId:policy.configurationId,
        version:name==='main'?policy.baseline.version:policy.candidate.version,parametersDigest:name==='main'?policy.baseline.parametersDigest:policy.candidate.parametersDigest,
        observedAt,expiresAt:policy.expiresAt});
      const testEvidence={evidenceId:scope.parentTaskId+':test',configurationId:policy.configurationId,version:policy.candidate.version,
        parametersDigest:policy.candidate.parametersDigest,policyId:policy.policyId,policyRevision:policy.revision,baselineSha256:policy.baseline.resultBaselineSha256,
        conditionsDigest:policy.conditionsDigest,observedAt,expiresAt:policy.expiresAt,checks:policy.requiredChecks.map(id=>({id,state:'passed'})),
        proof:{experimentId:evaluations.experimentId,main:score.main.digest,shadow:score.shadow.digest}};
      const base={action:value.input.action,operationId:'f23:'+scope.parentTaskId,configurationId:policy.configurationId};
      return {scores:score,releaseRequest:value.input.action==='rollback'?{...base,promotionOperationId:value.input.promotionOperationId}:
        {...base,main:branch('main'),shadow:branch('shadow'),testEvidence,candidateParameters:saved.input.shadow}};
    }}));
  const descriptorService=createWorkflowShadowReleaseService({requiredScopes:scopes});
  const releaseTool=createWorkflowShadowReleaseAdapter(descriptorService,{sideEffect:'local_write'}),readbackTool=createWorkflowShadowReleaseReadbackAdapter(descriptorService);
  releaseTool.execute=async(args,context)=>{const scope=host(context,'F23_N04',args),value=graph({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},scope.sessionId);
    if(!same(args,expected(value,'F23_N04')))fail();return release(scope,context).execute(args,context);};
  readbackTool.execute=async(args,context)=>{const scope=host(context,'F23_N05',args),value=graph({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},scope.sessionId);
    if(!same(args,expected(value,'F23_N05')))fail();const result=await release(scope,context).reconcile(args,context);
    if(['promoted','rolled_back'].includes(result.state)&&!same(decisionConfiguration.readDecisionConfiguration()?.configuration,
      {configurationId:result.readback.configurationId,revision:result.readback.revision,version:result.readback.version,parametersDigest:result.readback.parametersDigest}))fail('RESULT_UNKNOWN');return result;};
  const tools=[...readTools,releaseTool,readbackTool],requestSchema={...object({evaluationTaskId:text,action:{enum:['promote','rollback']}}),
    properties:{evaluationTaskId:text,action:{enum:['promote','rollback']},promotionOperationId:text}};
  const worker={workflowId:'F23',toolName:'workflow.evaluation.release',toolVersion:'1.0.0',configurationVersion:'f23-platform-cas-v1',
    sideEffect:'local_write',requestSchema,inputSchema:requestSchema,
    resultSchema:object({state:{enum:['promoted','rolled_back','rejected','superseded']},operationId:text,configurationId:text,revision:{type:'integer',minimum:1}}),
    publicEnumPaths:['/action'],requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:'1.0.0'})),{name:'decision.choose_candidate',version:'1.0.0'}],
    available:()=>{try{return !!source(state().get('latest')?.evaluationTaskId);}catch{return false;}},assertCurrent:current,
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);if(args.action==='rollback'&&!args.promotionOperationId||args.action==='promote'&&args.promotionOperationId)fail('INVALID_ARGUMENT');
      const value=source(args.evaluationTaskId);runtime().saveCheckpointOnce(scope.taskId,'f23:source',value);current(scope);return args;},
    assertFrontier(request){current(request);const value=graph(request,request.state.sessionId),proposal=request.proposal,args=expected(value,proposal.nodeId);
      if(proposal.toolName==='decision.choose_candidate'){
        let parsed;try{parsed=JSON.parse(proposal.arguments.context);}catch{return false;}
        const predecessors=Object.fromEntries(getOwnedWorkflowTemplate('F23').nodes.find(node=>node.id===proposal.nodeId).dependencies.map(dep=>[dep.nodeId,operation(value,dep.nodeId).result]));
        return parsed.workflowId==='F23'&&parsed.nodeId===proposal.nodeId&&same(parsed.input,value.input)&&same(parsed.predecessors,predecessors)
          &&Array.isArray(parsed.candidateValues)&&same(parsed.candidateValues.map(item=>item.id),proposal.arguments.candidates.map(item=>item.id))
          &&parsed.candidateValues.every(item=>item.branches===undefined&&(item.abstain===true||same(item.value,{arguments:args})));}
      return proposal.toolName==='workflow.host.'+proposal.nodeId.toLowerCase()&&same(proposal.arguments,args);},
    async authorizeExport(request){current(request);const allowed=await authorizeExport({...request,workflowId:'F23'});current(request);return allowed===true;},
    async verifyCompletion(request){const value=graph(request,request.state.sessionId);for(const node of getOwnedWorkflowTemplate('F23').nodes)
      if(request.state.result?.nodes[node.id]?.state!=='completed')fail('RESULT_UNKNOWN');
      const final=operation(value,'F23_N05').result,currentConfig=decisionConfiguration.readDecisionConfiguration()?.configuration;
      if(!['promoted','rolled_back','rejected','superseded'].includes(final.state)||!currentConfig)fail('RESULT_UNKNOWN');
      return {result:{state:final.state,operationId:final.operationId,configurationId:currentConfig.configurationId,revision:currentConfig.revision},resultSummary:'Original platform evaluation and configuration operation read back'};}};
  return {tools:[prepare,bind,...tools],configuredWorkflowWorkerPorts:[worker],hostOnlyTools:[F23_PREPARE_TOOL,F23_BIND_TOOL],
    submit(name,args,{commandId,deadline}){if(![F23_PREPARE_TOOL,F23_BIND_TOOL].includes(name)||typeof commandId!=='string'||!commandId||commandId.length>128)fail('INVALID_ARGUMENT');
      return app().submitHostToolTask({commandId:'f23:'+commandId,toolName:name,toolVersion:'1.0.0',arguments:args,deadline}).task;},
    snapshot(){let latest;try{latest=state().get('latest');if(!latest)return {available:!!decisionConfiguration.snapshot().initialized};
        const value=experiment(latest.experimentId);return {available:true,...latest,expiresAt:value.saved.acceptance.expiresAt,
          mainRows:rows(latest.experimentId,'main'),shadowRows:rows(latest.experimentId,'shadow')};}catch{return {available:false,...latest};}}};
}
