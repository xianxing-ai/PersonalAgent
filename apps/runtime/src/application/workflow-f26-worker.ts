import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue,type RegisteredTool,type ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource,readWorkflowBusinessToolOrigin,type WorkflowBusinessToolReceipt} from './workflow-business-tool-bridge.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;type Scope={taskId:string;deadline:string;signal:AbortSignal};type Graph=RuntimeConfiguredWorkflowBinding;
export interface F26ReleaseConfiguration {configurationDigest:string;sourceRevision:string;sourceDigest:string;scriptDigest:string;imageTag:string;
  registryReference:string;imageReference:string;runtimeId:string;runtimeName:string;endpointId:string;endpointName:string;version:string;model:Record<string,unknown>;}
export interface F26WorkflowOptions {
  getApplication:()=>RuntimeApplication;sourceConfiguration:()=>F26ReleaseConfiguration|undefined;
  verifyBuild:(receipt:WorkflowBusinessToolReceipt,scope:OwnedWorkflowHostScope)=>Record<string,unknown>;
  readDeployment:(scope:OwnedWorkflowHostScope)=>Promise<Record<string,unknown>>;
  toolExports:readonly CompetitionToolExport[];prepareCompetitionToolExport:PrepareCompetitionToolExport;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F26'})=>Promise<boolean>;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const empty=object({}),requestSchema=object({operation:{const:'verify-selected-release'}});
const workflowId='F26',commandName='workspace.f26_release',recipeId='f26-owned-image-release',configurationKey='f26:configuration';
const research={toolName:'research.search',toolVersion:'0.1.0-alpha.2',arguments:{query:'AgentArts',limit:1}};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never{throw new ProtocolError(code,message);}

/** One fixed selected release, original publish command, authenticated image and one public read case. */
export function createF26WorkflowWorkerPorts(options:F26WorkflowOptions){
  const app=()=>options.getApplication(),lifetime=(scope:OwnedWorkflowHostScope):Scope=>({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
  function current(scope:Scope){const task=app().runtime.getTask(scope.taskId),parent=app().readDelegatedUserTaskParent(scope.taskId),configuration=options.sourceConfiguration();
    if(scope.signal.aborted||task.cancelRequested||!parent||!['running','waiting_approval'].includes(task.state)||parent.deadline!==scope.deadline
      ||app().runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline||Date.parse(scope.deadline)<=Date.now())fail('UNAUTHORIZED','F26 original task is not current');
    const saved=app().runtime.loadCheckpoint(scope.taskId,configurationKey);
    if(!configuration||saved!==undefined&&!isDeepStrictEqual(saved,configuration))fail('REVISION_CONFLICT','F26 original release configuration changed');}
  function graph(scope:Scope,sessionId:string):Graph{current(scope);const value=app().readConfiguredWorkflowBinding({...scope,workflowId,sessionId});
    if(!value||value.deadline!==scope.deadline||!isDeepStrictEqual((value.input as {configuration:unknown}).configuration,options.sourceConfiguration()))fail('UNAUTHORIZED','F26 original graph unavailable');return value;}
  function operation(value:Graph,nodeId:string,toolName='workflow.host.'+nodeId.toLowerCase()){
    const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName===toolName);if(found.length!==1)fail('UNAUTHORIZED','F26 requires one original receipt');return found[0]!;}
  function selection(value:Graph,nodeId:string){const original=operation(value,nodeId,'decision.choose_candidate'),intent=app().runtime.loadCheckpoint(original.localTaskId,'host-tool-intent') as {arguments?:{context?:string}};
    let parsed;try{parsed=JSON.parse(intent.arguments?.context??'');}catch{fail('UNAUTHORIZED','F26 original selection unavailable');}
    const values=parsed?.candidateValues?.filter((item:{id?:string})=>item.id===(original.result as {selectedId:string}).selectedId);
    if(parsed.workflowId!==workflowId||parsed.nodeId!==nodeId||!isDeepStrictEqual(parsed.input,value.input)||values?.length!==1||values[0].abstain===true)fail('UNAUTHORIZED','F26 original selection changed');
    return {value:values[0].value,original};}
  function predecessors(value:Graph,nodeId:string){return Object.fromEntries(getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies
    .map(item=>[item.nodeId,item.nodeId==='F26_N01'?value.input:operation(value,item.nodeId).result]));}
  function imageProof(request:Parameters<Worker['assertFrontier']>[0]){const runtime=app().runtime,id=runtime.loadCheckpoint(request.taskId,'f26:image-last');
    const proof=typeof id==='string'?runtime.loadCheckpoint(request.taskId,'f26:image-readback:'+id) as Record<string,unknown>:undefined;
    if(!proof||proof.workflowId!==workflowId||proof.taskId!==request.taskId||proof.sessionId!==request.state.sessionId||proof.bindingId!==request.state.bindingId
      ||proof.resultDigest!==hash(request.state.result)||proof.deploymentVersion!==options.sourceConfiguration()!.version)fail('UNAUTHORIZED','F26 original authenticated image response unavailable');return proof;}
  let bridgeApp:RuntimeApplication|undefined,bridge:ReturnType<typeof createWorkflowBusinessToolBridge>;
  function business(){if(bridgeApp!==app()){bridgeApp=app();bridge=createWorkflowBusinessToolBridge({application:bridgeApp,now:()=>new Date(),assertCurrent:scope=>current(lifetime(scope)),resolveTool:(request,scope)=>{
      const nodeId=request.actionKey==='f26.build'?'F26_N02':request.actionKey==='f26.public-read'?'F26_N04':undefined;if(!nodeId)return;
      const expected=nodeId==='F26_N02'?{recipeId}:research.arguments;if(!isDeepStrictEqual(request.input,expected))return;
      graph(lifetime(scope),scope.sessionId);return {workflowId,nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),toolName:nodeId==='F26_N02'?commandName:research.toolName,
        toolVersion:nodeId==='F26_N02'?'1.0.0':research.toolVersion,arguments:expected};}});}return bridge!;}
  function build(value:Graph,scope:OwnedWorkflowHostScope){const operation_=operation(value,'F26_N02'),result=operation_.result as {original:WorkflowBusinessToolReceipt;build:unknown};
    const proof=readWorkflowBusinessToolSource(app(),{parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline},result.original,commandName);
    if(proof.graph.nodeId!=='F26_N02'||proof.sourceHost.taskId!==operation_.localTaskId||!isDeepStrictEqual(proof.request.arguments,{recipeId}))fail('UNAUTHORIZED','F26 original build receipt changed');
    const verified=options.verifyBuild(proof.receipt,scope);if(!isDeepStrictEqual(result.build,verified))fail('REVISION_CONFLICT','F26 build readback changed');return verified;}
  function sourcePolicy(){const found=options.toolExports.filter(item=>item.toolName===research.toolName&&item.toolVersion===research.toolVersion);
    if(found.length!==1)fail('UNSUPPORTED_CAPABILITY','F26 public research policy unavailable');return found[0]!;}
  async function publicProjection(receipt:WorkflowBusinessToolReceipt,scope:OwnedWorkflowHostScope){const policy=sourcePolicy(),read=app().readHostToolTask(receipt.taskId),proposal={kind:'tool_proposal' as const,
    proposalId:read.commandId,...research,verification:'unverified' as const};const check=(phase:'preflight'|'final',projection?:unknown)=>{
      current(lifetime(scope));if(policy.accepts({taskId:receipt.taskId,proposalId:read.commandId,arguments:research.arguments,phase,projection,signal:scope.signal})!==true)fail('UNAUTHORIZED','F26 original public export denied');};
    check('preflight');await options.prepareCompetitionToolExport({phase:'projection',taskId:receipt.taskId,runId:receipt.runId,proposal,deadline:scope.deadline,signal:scope.signal});check('preflight');
    const result=await policy.project({taskId:receipt.taskId,proposalId:read.commandId,result:receipt.result,signal:scope.signal});check('final',result);
    app().runtime.saveCheckpointOnce(receipt.taskId,'f26:public-projection',{policyVersion:policy.exportPolicyVersion,result});return result;}
  const tools:RegisteredTool[]=['F26_N02','F26_N03','F26_N04','F26_N05'].map(nodeId=>createOwnedWorkflowAdapter({nodeId,kind:'host',
    sideEffect:nodeId==='F26_N02'?'external_write':nodeId==='F26_N05'?'local_write':'read',requiredScopes:[nodeId==='F26_N02'?'workspace:execute':nodeId==='F26_N04'?'research:read':'workflow:deployment'],
    inputSchema:empty,outputSchema:{type:'object'},async execute(args,context){const scope=assertOwnedWorkflowHostScope({runtime:app().runtime,context,workflowId,nodeId,
      hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:args,assertCurrent:scope=>current(lifetime(scope))}),value=graph(lifetime(scope),scope.sessionId);
      if(nodeId==='F26_N02'){const receipt=await business().invoke({actionKey:'f26.build',input:{recipeId}},context),verified=options.verifyBuild(receipt,scope);current(lifetime(scope));
        return {build:verified,original:{taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments}};}
      build(value,scope);
      if(nodeId==='F26_N03'){const result=await options.readDeployment(scope);current(lifetime(scope));
        if(result.podRunning!==true||result.readinessProbe!==true||result.imageReference!==options.sourceConfiguration()!.imageReference)fail('UNSUPPORTED_CAPABILITY','F26 selected image is not ready');return result;}
      const ready=operation(value,'F26_N03').result as Record<string,unknown>;if(ready.podRunning!==true||ready.readinessProbe!==true)fail('UNAUTHORIZED','F26 original readiness missing');
      if(nodeId==='F26_N04'){const selected=selection(value,nodeId),proof=app().runtime.loadCheckpoint(scope.parentTaskId,'f26:cloud-proposal:'+selected.original.operationId);
        if(!isDeepStrictEqual(selected.value,{arguments:{},proposal:research})||!proof)fail('UNAUTHORIZED','F26 exact original cloud proposal unavailable');
        const receipt=await business().invoke({actionKey:'f26.public-read',input:research.arguments},context),projected=await publicProjection(receipt,scope);
        const original=readWorkflowBusinessToolSource(app(),{parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline},receipt,research.toolName);
        if(original.record.state!=='confirmed'||original.record.policyDecision!=='allow'||!original.record.executionStarted)fail('UNAUTHORIZED','F26 local read evidence incomplete');
        return {cloudProposal:research,imageInvocation:proof,localPolicyVerdict:'allow',toolExecution:'confirmed',evidenceVerified:true,
          evidenceRefs:[receipt.runId],coverage:'single_public_research_metadata_read',result:projected,original:{taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments}};}
      const semantic=operation(value,'F26_N04').result as Record<string,unknown>;
      const result={activeServiceVersion:options.sourceConfiguration()!.version,status:'selected_release_case_verified',coverage:'single_public_research_metadata_read',
        sourceRevision:options.sourceConfiguration()!.sourceRevision,imageReference:options.sourceConfiguration()!.imageReference,evidenceDigest:hash({ready,semantic}),
        remaining:['all_28_workflows','platform_evaluation','independent_human_review'],routingChanged:false};
      app().runtime.saveCheckpointOnce(scope.parentTaskId,'f26:coverage',result);
      if(!isDeepStrictEqual(app().runtime.loadCheckpoint(scope.parentTaskId,'f26:coverage'),result))fail('REVISION_CONFLICT','F26 original coverage changed');return result;
    }}));
  const worker:Worker={workflowId,toolName:'workflow.release.verify',toolVersion:'1.0.0',configurationVersion:'f26-selected-release-v1',requestSchema,
    inputSchema:object({...requestSchema.properties,configuration:{type:'object'}}),resultSchema:{type:'object'},sideEffect:'external_write',publicEnumPaths:['/operation'],
    requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),{name:'decision.choose_candidate',version:'1.0.0'}],assertCurrent:current,
    available:scope=>{try{current(scope);sourcePolicy();return !!app().readRegisteredToolDescriptor(commandName,'1.0.0');}catch{return false;}},
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);const configuration=options.sourceConfiguration()!;app().runtime.saveCheckpointOnce(scope.taskId,configurationKey,configuration);return {...args,configuration};},
    assertFrontier(request){current(request);const value=graph(request,request.state.sessionId),proposal=request.proposal,proof=imageProof(request);
      if(proposal.toolName==='decision.choose_candidate'){let parsed;try{parsed=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(!plain(parsed)||parsed.workflowId!==workflowId||parsed.nodeId!==proposal.nodeId||!isDeepStrictEqual(parsed.input,value.input)||!isDeepStrictEqual(parsed.predecessors,predecessors(value,proposal.nodeId))
          ||!Array.isArray(parsed.candidateValues)||!Array.isArray(proposal.arguments.candidates)||!isDeepStrictEqual(parsed.candidateValues.map(item=>plain(item)?item.id:null),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        const expected=proposal.nodeId==='F26_N04'?{arguments:{},proposal:research}:{arguments:{}};
        if(!parsed.candidateValues.every(item=>plain(item)&&item.branches===undefined&&(item.abstain===true||isDeepStrictEqual(item.value,expected))))return false;
        app().runtime.saveCheckpointOnce(request.taskId,'f26:cloud-proposal:'+proposal.operationId,proof);return true;}
      return tools.some(tool=>tool.descriptor.name===proposal.toolName)&&proposal.toolName==='workflow.host.'+proposal.nodeId.toLowerCase()&&isDeepStrictEqual(proposal.arguments,{});},
    async authorizeExport(request){const check=()=>{current(request);if(request.stage==='receipt'){const read=request.localTaskId?app().readHostToolTask(request.localTaskId):undefined;
      if(!read?.confirmed||read.task.state!=='succeeded'||read.task.cancelRequested||read.commandId!==request.proposal?.operationId||!isDeepStrictEqual((request.value as {result:unknown}).result,read.confirmed.result))fail('UNAUTHORIZED','F26 original receipt export unavailable');}};
      check();const allowed=await options.authorizeExport({...request,workflowId});check();return allowed===true;},
    async verifyCompletion(request){const value=graph(request,request.state.sessionId);for(const node of getOwnedWorkflowTemplate(workflowId)!.nodes)
      if(request.state.result?.nodes[node.id]?.state!=='completed')fail('UNAUTHORIZED','F26 required original node incomplete');
      const final=operation(value,'F26_N05'),scope={parentTaskId:request.taskId,localTaskId:final.localTaskId,operationId:final.operationId,sessionId:value.sessionId,deadline:request.deadline,signal:request.signal};build(value,scope);
      const semantic=operation(value,'F26_N04').result as {original:WorkflowBusinessToolReceipt;result:unknown};
      const proof=readWorkflowBusinessToolSource(app(),{parentTaskId:request.taskId,sessionId:value.sessionId,deadline:request.deadline},semantic.original,research.toolName),policy=sourcePolicy(),stored=app().runtime.loadCheckpoint(proof.receipt.taskId,'f26:public-projection') as {policyVersion?:string;result?:unknown};
      if(!stored||stored.policyVersion!==policy.exportPolicyVersion||!isDeepStrictEqual(stored.result,semantic.result)||policy.accepts({taskId:proof.receipt.taskId,proposalId:proof.request.commandId,arguments:research.arguments,phase:'final',projection:semantic.result})!==true
        ||!isDeepStrictEqual(final.result,app().runtime.loadCheckpoint(request.taskId,'f26:coverage')))fail('UNAUTHORIZED','F26 original coverage export changed');
      return {result:final.result,resultSummary:'Selected release and one original public research case verified; remaining coverage stays explicit'};}};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null,readBuildBinding(context:ToolContext){const runtime=app().runtime,parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string}|undefined;
    const owner=parent?.taskId?runtime.loadCheckpoint(parent.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined:undefined;
    const intent=owner?.taskId?runtime.loadCheckpoint(owner.taskId,'owned-workflow:intent:'+owner.operationId) as {sessionId?:string;deadline?:string}|undefined:undefined;
    const child=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {deadline?:string}|undefined;
    if(!owner?.taskId||!intent?.sessionId||intent.deadline!==child?.deadline||Date.parse(context.deadline)>Date.parse(intent.deadline!))fail('UNAUTHORIZED','F26 original command lifetime unavailable');
    const scope={parentTaskId:owner.taskId,sessionId:intent.sessionId,deadline:intent.deadline!},origin=readWorkflowBusinessToolOrigin(app(),scope,
      {taskId:context.taskId,runId:context.runId,scopeRef:context.runId,toolVersion:'1.0.0',arguments:{recipeId}},commandName);
    if(origin.graph.workflowId!==workflowId||origin.graph.nodeId!=='F26_N02'||origin.actionKey!=='f26.build')fail('UNAUTHORIZED','F26 original build origin unavailable');
    graph({taskId:scope.parentTaskId,deadline:scope.deadline,signal:context.signal},scope.sessionId);
    return {...scope,taskId:context.taskId,runId:context.runId,argumentsDigest:context.argumentsDigest};}};
}
