import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import * as runtimeModule from '@personal-agent/runtime/application';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const sha={type:'string',pattern:'^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const identity={repo:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'},
  prNumber:{type:'integer',minimum:1},headSha:sha,baseSha:sha};
const schema=object({...identity,mergeMethod:{enum:['merge','squash','rebase']}});
const reviewRequirements='For F18_N02 and F18_N03, return actual review data plus headSha and diffDigest from the confirmed F18_N01 diff, hasBlockingBugs (boolean), and blockingCount (nonnegative integer). Preserve every actual blocker; these fields never grant merge authority.';
const inputSchema=object({...schema.properties,reviewRequirements:{const:reviewRequirements}});
const resultSchema=object({mergedSha:sha,prClosed:{const:true}});
const nodeTools={F18_N01:'workflow.host.f18_n01',F18_N02:'decision.choose_candidate',F18_N03:'decision.choose_candidate',
  F18_N04:'workflow.host.f18_n04',F18_N05:'workflow.host.f18_n05'};
const ref=receipt=>({taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments});
const prIdentity=input=>({repo:input.repo,prNumber:input.prNumber,headSha:input.headSha,baseSha:input.baseSha});
const mergeInput=input=>({...prIdentity(input),mergeMethod:input.mergeMethod});

/** Same developer deployment and same Runtime. Main supplies its existing exact
 * export consent. The original Policy independently approves each business child. */
export function createDesktopF18F19WorkflowPorts({getApplication,github,selection,requiredChecks,eligibleReviewers,authorizeExport,requestPresence,
  now=()=>new Date()}={}) {
  const unavailable=['f19_original_f15_enqueue_and_independent_bug_regression_unavailable'];
  if(typeof getApplication!=='function'||typeof github?.createTools!=='function'||typeof github.available!=='function'
    ||typeof github.assertCurrent!=='function'||typeof selection?.readSelection!=='function'||typeof selection.assertCurrent!=='function'
    ||typeof selection.configurationRef!=='string'||!/^[a-f0-9]{64}$/u.test(selection.configurationRef)
    ||typeof authorizeExport!=='function'||typeof requestPresence!=='function'||!Array.isArray(requiredChecks)||!requiredChecks.length
    ||!Array.isArray(eligibleReviewers)||!eligibleReviewers.length)
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:[...unavailable,'f18_github_trusted_configuration_unavailable']};
  const configurationVersion='f18-github-v1:'+selection.configurationRef;
  const app=()=>{const value=getApplication();if(!value)fail('UNSUPPORTED_CAPABILITY','Original Runtime unavailable');return value;};
  const runtime=new Proxy({},{get(_target,key){const owner=app().runtime,value=owner[key];return typeof value==='function'?value.bind(owner):value;}});
  const application={runtime,readHostToolTask:id=>app().readHostToolTask(id)};
  const current=scope=>{
    if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now().getTime())
      fail('CANCELLED','Original GitHub workflow ended');
    for(const check of [()=>github.assertCurrent(scope),()=>selection.assertCurrent(scope)]){
      const result=check();
      if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail('UNAUTHORIZED','GitHub current guard must be synchronous');}
    }
  };
  const binding=scope=>{
    current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
    const bound=app().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F18',sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline||bound.configurationVersion!==configurationVersion)fail('UNAUTHORIZED','Original F18 binding unavailable');
    validateToolValue(inputSchema,bound.input);return bound;
  };
  const selected=(operation,input)=>{
    let request;try{request=JSON.parse(app().runtime.loadCheckpoint(operation.localTaskId,'host-tool-intent')?.arguments?.context);}catch{}
    const choice=request?.candidateValues?.find(value=>value.id===operation.result?.selectedId);
    if(!choice||choice.abstain===true||request.workflowId!=='F18'||request.nodeId!==operation.nodeId||!isDeepStrictEqual(request.input,input))
      fail('UNAUTHORIZED','Original PR review selection changed');
    return choice.value;
  };
  const review=bound=>{
    const unique=(node,tool)=>{
      const values=bound.confirmedOperations.filter(op=>op.nodeId===node&&op.toolName===tool);
      if(values.length!==1)fail('UNAUTHORIZED','Original PR review is incomplete');return values[0];
    };
    const diff=unique('F18_N01',nodeTools.F18_N01).result;
    for(const node of ['F18_N02','F18_N03']){
      const value=selected(unique(node,'decision.choose_candidate'),bound.input);
      if(value?.headSha!==bound.input.headSha||value.diffDigest!==diff.diffDigest
        ||value.hasBlockingBugs!==false||value.blockingCount!==0)
        fail('UNAUTHORIZED','Original PR review has unresolved blockers or another revision');
    }
  };
  const writeIntentKey='f18:original-github-merge-attempt';
  const pendingMerge=scope=>{
    const runtime=app().runtime,original=app().readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(original?.toolName!=='github.registered_merge')return;
    const source=runtime.loadCheckpoint(scope.taskId,'workflow-business-tool:source');
    const intent=source&&runtime.loadCheckpoint(source.sourceTaskId,'workflow-business-tool:'+source.commandId);
    const parent=source&&runtime.loadCheckpoint(source.sourceTaskId,'coding-repair:parent');
    const graph=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    const child=app().readHostToolTask(scope.taskId),host=source&&app().readHostToolTask(source.sourceTaskId);
    const hostIntent=source&&runtime.loadCheckpoint(source.sourceTaskId,'host-tool-intent');
    const hostRecord=source&&runtime.readToolExecutions(source.sourceTaskId).find(value=>value.evidenceId===source.sourceRunId);
    if(!intent||!parent||source.intentDigest!==toolArgumentsDigest(intent)||intent.workflowId!=='F18'||intent.nodeId!=='F18_N05'
      ||intent.sourceTaskId!==source.sourceTaskId||intent.sourceRunId!==source.sourceRunId||source.sourceRunId!=='host-tool-'+source.sourceTaskId
      ||intent.parentTaskId!==parent.taskId||intent.operationId!==parent.operationId||intent.sourceToolName!==nodeTools.F18_N05
      ||graph?.workflowId!=='F18'||graph.sessionId!==intent.sessionId||graph.proposal?.nodeId!=='F18_N05'
      ||graph.proposal.toolName!==nodeTools.F18_N05||graph.proposal.operationId!==parent.operationId||graph.deadline!==scope.deadline
      ||!isDeepStrictEqual(graph.proposal.arguments,{})||host?.commandId!==parent.operationId||host.toolName!==nodeTools.F18_N05
      ||!hostIntent||hostIntent.toolName!==nodeTools.F18_N05||hostIntent.deadline!==scope.deadline
      ||!isDeepStrictEqual(hostIntent.arguments,{})||hostIntent.commandId!==parent.operationId
      ||!isDeepStrictEqual(runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId),{localTaskId:source.sourceTaskId,
        request:{commandId:parent.operationId,toolName:hostIntent.toolName,toolVersion:hostIntent.toolVersion,arguments:hostIntent.arguments,deadline:scope.deadline}})
      ||!hostRecord||hostRecord.policyDecision!=='allow'||!runtime.isToolExecutionActive(hostRecord)
      ||!runtime.matchesToolExecutionInput(hostRecord,{arguments:hostIntent.arguments,scopeRef:source.sourceRunId})
      ||intent.request?.commandId!==source.commandId||intent.request.toolName!==original.toolName
      ||intent.request.toolVersion!==original.toolVersion||original.toolVersion!==GITHUB_CONNECTOR_VERSION||original.deadline!==scope.deadline
      ||scope.runId!=='host-tool-'+scope.taskId||!isDeepStrictEqual(original.arguments,intent.request.arguments)
      ||!isDeepStrictEqual(runtime.loadCheckpoint(scope.taskId,'coding-repair:parent'),{taskId:source.sourceTaskId,operationId:source.commandId})
      ||!isDeepStrictEqual(runtime.loadCheckpoint(source.sourceTaskId,'coding-repair:host:'+source.commandId),{localTaskId:scope.taskId,request:intent.request})
      ||child.commandId!==source.commandId||child.toolName!==original.toolName
      ||scope.toolName!==undefined&&scope.toolName!==original.toolName
      ||scope.toolVersion!==undefined&&scope.toolVersion!==original.toolVersion
      ||scope.argumentsDigest!==undefined&&scope.argumentsDigest!==original.argumentsDigest
      ||scope.proposal&&(!isDeepStrictEqual(scope.proposal.arguments,original.arguments)||scope.proposal.toolName!==original.toolName
        ||scope.proposal.toolVersion!==original.toolVersion))fail('UNAUTHORIZED','Original pending merge source changed');
    const bound=binding({parentTaskId:parent.taskId,sessionId:intent.sessionId,deadline:scope.deadline,signal:scope.signal});review(bound);
    if(!isDeepStrictEqual(mergeInput(bound.input),original.arguments))fail('REVISION_CONFLICT','Original pending merge input changed');
    const descriptor=runtime.readToolDescriptors().find(tool=>tool.name===nodeTools.F18_N05&&tool.version===host.toolVersion);
    if(!descriptor)fail('UNAUTHORIZED','Original merge host descriptor unavailable');
    const pending=bridge().read({actionKey:'f18.merge',input:mergeInput(bound.input)},
      {taskId:source.sourceTaskId,runId:source.sourceRunId,authorizationRef:source.sourceRunId,scopes:descriptor.requiredScopes,
        deadline:scope.deadline,signal:scope.signal});
    if(pending.taskId!==scope.taskId||pending.runId!==scope.runId||!['created','running','waiting_approval'].includes(pending.state))
      fail('UNAUTHORIZED','Original fixed merge business action changed');
    return {taskId:scope.taskId,runId:scope.runId,source:structuredClone(source),argumentsDigest:original.argumentsDigest,
      configurationDigest:bound.configurationDigest};
  };
  const beforeWrite=(operation,input,ctx)=>{
    if(!pendingMerge(ctx))fail('UNAUTHORIZED','Original pending merge is unavailable');
    const runtime=app().runtime,source=runtime.loadCheckpoint(ctx.taskId,'workflow-business-tool:source');
    const intent=source&&runtime.loadCheckpoint(source.sourceTaskId,'workflow-business-tool:'+source.commandId);
    if(operation!=='registered_merge'||!intent||intent.workflowId!=='F18'||intent.nodeId!=='F18_N05'
      ||intent.sourceToolName!==nodeTools.F18_N05||intent.request?.toolName!=='github.registered_merge'
      ||!isDeepStrictEqual(intent.request.arguments,input)||intent.request.deadline!==ctx.deadline
      ||ctx.runId!=='host-tool-'+ctx.taskId||ctx.authorizationRef!==ctx.runId)
      fail('UNAUTHORIZED','Original graph merge source is unavailable');
    const bound=binding({parentTaskId:intent.parentTaskId,sessionId:intent.sessionId,deadline:ctx.deadline,signal:ctx.signal});
    if(!isDeepStrictEqual(mergeInput(bound.input),input))fail('REVISION_CONFLICT','Original merge selection changed');
    review(bound);
    const gate=bound.confirmedOperations.filter(op=>op.nodeId==='F18_N04'&&op.toolName===nodeTools.F18_N04);
    if(gate.length!==1||gate[0].result.mergeRequirementsSatisfied!==true||gate[0].result.headSha!==input.headSha)
      fail('UNAUTHORIZED','Original merge gate is not confirmed');
    const execution=runtime.readToolExecutions(ctx.taskId).find(value=>value.evidenceId===ctx.runId);
    if(!execution||execution.toolName!=='github.registered_merge'||execution.policyDecision!=='allow'
      ||!runtime.isToolExecutionActive(execution)||!runtime.matchesToolExecutionInput(execution,{arguments:input,scopeRef:ctx.runId}))
      fail('UNAUTHORIZED','Original business merge authorization is unavailable');
    if(!runtime.saveCheckpointOnce(ctx.taskId,writeIntentKey,{operation,input,taskId:ctx.taskId,runId:ctx.runId,
      source:structuredClone(source),deadline:ctx.deadline}))fail('RESULT_UNKNOWN','Original GitHub merge was already attempted; inspect it without replay');
  };
  const business=github.createTools({requiredChecks:[...requiredChecks],eligibleReviewers:[...eligibleReviewers],beforeWrite});
  if(!Array.isArray(business)||business.some(tool=>!tool?.descriptor||typeof tool.execute!=='function')
    ||['bound_pr_diff','current_head_merge_gate','registered_merge','merged_pr_readback','issue_snapshot','issue_close_readback']
      .some(name=>!business.some(tool=>tool.descriptor.name==='github.'+name&&tool.descriptor.version===GITHUB_CONNECTOR_VERSION)))
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:[...unavailable,'f18_github_tools_unavailable']};
  const actions={diff:['F18_N01','github.bound_pr_diff'],gate:['F18_N04','github.current_head_merge_gate'],
    head:['F18_N04','github.merged_pr_readback'],merge:['F18_N05','github.registered_merge'],readback:['F18_N05','github.merged_pr_readback']};
  const bridges=new WeakMap();
  const bridge=()=>{
    const application=app();let value=bridges.get(application);
    if(!value){value=runtimeModule.createWorkflowBusinessToolBridge({application,now,assertCurrent:scope=>{binding(scope);},
      resolveTool(request,scope){
        const action=request.actionKey.startsWith('f18.')?actions[request.actionKey.slice(4)]:undefined;if(!action)return;
        const bound=binding(scope),args=request.actionKey==='f18.merge'?mergeInput(bound.input):prIdentity(bound.input);
        if(!isDeepStrictEqual(request.input,args))fail('UNAUTHORIZED','Original GitHub business arguments changed');
        return {workflowId:'F18',nodeId:action[0],hostToolName:nodeTools[action[0]],toolName:action[1],
          toolVersion:GITHUB_CONNECTOR_VERSION,arguments:args};
      }});bridges.set(application,value);}return value;
  };
  const invoke=async(action,scope,ctx)=>{
    const bound=binding(scope),receipt=await bridge().invoke({actionKey:'f18.'+action,
      input:action==='merge'?mergeInput(bound.input):prIdentity(bound.input)},ctx);
    runtimeModule.readWorkflowBusinessToolSource(application,scope,ref(receipt),actions[action][1]);return receipt;
  };
  const hostOptions={application,now,requiredScopes:['github:read'],assertCurrent:scope=>{binding(scope);},
    authorizeExport:async(scope,value)=>{
      binding(scope);const allowed=await authorizeExport({workflowId:'F18',taskId:scope.parentTaskId,localTaskId:scope.localTaskId,
        stage:'receipt',value,deadline:scope.deadline,signal:scope.signal});binding(scope);return allowed===true;
    }};
  const hosts=[runtimeModule.createRuntimeF18BoundPrDiffHost({...hostOptions,
    async resolveBoundDiff(scope,ctx){const bound=binding(scope),receipt=await invoke('diff',scope,ctx);
      return {...prIdentity(bound.input),diffRead:ref(receipt)};}}),
  runtimeModule.createRuntimeF18MergeGateHost({...hostOptions,
    async resolveMergeGate(scope,ctx){const bound=binding(scope);review(bound);const receipt=await invoke('gate',scope,ctx);
      return {...prIdentity(bound.input),gateRead:ref(receipt)};},
    readCurrentHead:async(scope,ctx)=>(await invoke('head',scope,ctx)).result.headSha}),
  runtimeModule.createRuntimeF18RegisteredMergeHost({...hostOptions,requiredScopes:['github:write'],
    async resolveRegisteredMerge(scope,ctx){const bound=binding(scope);review(bound);const receipt=await invoke('merge',scope,ctx);
      return {...prIdentity(bound.input),mergeRead:ref(receipt)};}})];
  const tools=[...business,...hosts.flatMap(host=>host.tools)];
  const required=[...new Set([...Object.values(nodeTools),'github.bound_pr_diff','github.current_head_merge_gate',
    'github.registered_merge','github.merged_pr_readback'])].map(name=>({name,version:name.startsWith('github.')?GITHUB_CONNECTOR_VERSION:'1.0.0'}));
  const worker={workflowId:'F18',toolName:'workflow.f18.review_merge',toolVersion:'1.0.0',configurationVersion,
    requestSchema:schema,inputSchema,resultSchema,publicEnumPaths:['/mergeMethod'],requiredTools:required,sideEffect:'external_write',
    assertCurrent:current,async available(scope){try{current(scope);const allowed=await github.available(scope);current(scope);return allowed===true;}catch{return false;}},
    async resolveInput(args,scope){
      current(scope);validateToolValue(schema,args);const selected=await selection.readSelection(scope);current(scope);
      if(!isDeepStrictEqual(args,selected))fail('UNAUTHORIZED','Original native PR selection is unavailable or changed');
      return {...structuredClone(args),reviewRequirements};
    },
    async assertFrontier({input,proposal,state,...scope}){
      const bound=binding({...scope,parentTaskId:scope.taskId,sessionId:state.sessionId});
      const node=getOwnedWorkflowTemplate('F18').nodes.find(item=>item.id===proposal.nodeId);
      if(!node||!isDeepStrictEqual(input,bound.input)||proposal.toolVersion!=='1.0.0'
        ||node.dependencies.some(dependency=>state.result?.nodes[dependency.nodeId]?.state!=='completed'))return false;
      if(proposal.nodeId==='F18_N04'||proposal.nodeId==='F18_N05')review(bound);
      if(proposal.nodeId==='F18_N05'&&!bound.confirmedOperations.some(op=>op.nodeId==='F18_N04'
        &&op.toolName===nodeTools.F18_N04&&op.result.mergeRequirementsSatisfied===true&&op.result.headSha===input.headSha))return false;
      if(proposal.toolName==='decision.choose_candidate'){
        let context;try{context=JSON.parse(proposal.arguments.context);}catch{return false;}
        return context.workflowId==='F18'&&context.nodeId===proposal.nodeId&&isDeepStrictEqual(context.input,input);
      }
      return proposal.toolName===nodeTools[proposal.nodeId]&&isDeepStrictEqual(proposal.arguments,{});
    },
    async authorizeExport(value){
      current(value);
      const allowed=await authorizeExport({...value,workflowId:'F18'});current(value);return allowed===true;
    },
    async verifyCompletion({input,state,readbacks,...scope}){
      const owner={...scope,parentTaskId:scope.taskId,sessionId:state.sessionId},bound=binding(owner);review(bound);
      if(!isDeepStrictEqual(input,bound.input)||getOwnedWorkflowTemplate('F18').nodes.some(node=>state.result?.nodes[node.id]?.state!=='completed')
        ||bound.confirmedOperations.length!==readbacks.length||bound.confirmedOperations.some(op=>!readbacks.some(read=>isDeepStrictEqual(read,op.readback))))
        fail('UNAUTHORIZED','Original PR workflow is incomplete');
      for(const node of Object.keys(nodeTools))if(bound.confirmedOperations.filter(op=>op.nodeId===node&&op.toolName===nodeTools[node]).length!==1)
        fail('UNAUTHORIZED','Original required PR node is missing');
      const merged=bound.confirmedOperations.find(op=>op.nodeId==='F18_N05'&&op.toolName===nodeTools.F18_N05);
      const descriptor=tools.find(tool=>tool.descriptor.name===nodeTools.F18_N05).descriptor;
      const ctx={taskId:merged.localTaskId,runId:merged.readback.confirmed.runId,authorizationRef:merged.readback.confirmed.runId,
        scopes:descriptor.requiredScopes,deadline:scope.deadline,signal:scope.signal};
      const read=await invoke('readback',{...owner,localTaskId:merged.localTaskId,operationId:merged.operationId},ctx);
      if(read.result.merged!==true||read.result.mergedSha!==merged.result.mergedSha||merged.result.prClosed!==true)
        fail('RESULT_UNKNOWN','Original merged PR readback is not confirmed');
      return {result:merged.result,resultSummary:'Original PR review, current non-author approval and technical CI passed; exact merge read back'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable,
    prepareMergeQuestion(scope,question){
      const proof=pendingMerge(scope);if(!proof)return;
      question.prepare(scope,{assertCurrent:()=>{try{return isDeepStrictEqual(proof,pendingMerge(scope));}catch{return false;}}});return proof;
    },
    async confirmMergePresence(scope){
      const proof=pendingMerge(scope);if(!proof)return false;
      await requestPresence(scope);
      if(!isDeepStrictEqual(proof,pendingMerge(scope)))fail('UNAUTHORIZED','Original merge presence source changed');return true;
    },
    /** Preparation only. Caller must run this exact read through original Policy.
     * Target consistency is never an attribution or a confirmation of our write. */
    readUnknownMergeInspection(taskId){
      const runtime=app().runtime,attempt=runtime.loadCheckpoint(taskId,writeIntentKey);
      const read=app().readHostToolTask(taskId),record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===attempt?.runId);
      if(!attempt||attempt.taskId!==taskId||read.toolName!=='github.registered_merge'||read.task.state!=='waiting_reconciliation'
        ||!record?.executionStarted||record.policyDecision!=='allow'||record.state==='confirmed'
        ||!runtime.matchesToolExecutionInput(record,{arguments:attempt.input,scopeRef:attempt.runId})
        ||!isDeepStrictEqual(runtime.loadCheckpoint(taskId,'workflow-business-tool:source'),attempt.source))
        fail('UNAUTHORIZED','Original unknown GitHub merge attempt unavailable');
      return {toolName:'github.merged_pr_readback',toolVersion:GITHUB_CONNECTOR_VERSION,arguments:prIdentity(attempt.input),
        originalTaskId:taskId,originalRunId:attempt.runId,meaning:'target_state_only_original_write_remains_unknown'};
    }};
}
