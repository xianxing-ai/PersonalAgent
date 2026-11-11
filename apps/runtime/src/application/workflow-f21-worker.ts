import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue,type RegisteredTool,type ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource,readWorkflowBusinessToolOrigin,
  type WorkflowBusinessToolReceipt} from './workflow-business-tool-bridge.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Scope={taskId:string;deadline:string;signal:AbortSignal};
type Graph=RuntimeConfiguredWorkflowBinding;
export interface F21SourceConfiguration {configurationDigest:string;manifestDigest:string;skillId:string;skillVersion:string;
  toolName:string;toolVersion:string;packageVersion:string;sdkVersion:string;transport:'stdio';}
export interface F21WorkflowOptions {
  getApplication:()=>RuntimeApplication;
  sourceConfiguration:(scope?:Scope)=>F21SourceConfiguration|undefined;
  verifyProbe:(receipt:WorkflowBusinessToolReceipt,scope:OwnedWorkflowHostScope)=>Record<string,unknown>;
  enable:(scope:OwnedWorkflowHostScope,context:ToolContext)=>Promise<Record<string,unknown>>;
  readEnabled:(scope:OwnedWorkflowHostScope)=>Record<string,unknown>|undefined;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F21'})=>Promise<boolean>;
}
const workflowId='F21',commandName='workspace.f21_mcp_probe',recipeId='f21-filesystem-protocol';
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const empty=object({}),text={type:'string',minLength:1,maxLength:2048};
const requestSchema=object({capability:{const:'workspace-reference'}}),configurationKey='f21:source-configuration';
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Fixed original reference capability; no user-selected command, installer or permission. */
export function createF21WorkflowWorkerPorts(options:F21WorkflowOptions) {
  const app=()=>options.getApplication();
  function current(scope:Scope){
    const task=app().runtime.getTask(scope.taskId),parent=app().readDelegatedUserTaskParent(scope.taskId);
    if(scope.signal.aborted||task.cancelRequested)fail('CANCELLED','F21 original task cancelled');
    if(!parent||parent.deadline!==scope.deadline||!['running','waiting_approval'].includes(task.state)
      ||app().runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
      ||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=Date.now())fail('UNAUTHORIZED','F21 original user task unavailable');
    const source=options.sourceConfiguration(scope),saved=app().runtime.loadCheckpoint(scope.taskId,configurationKey);
    if(!source||source.toolName!=='mcp.workspace.read_text'||source.toolVersion!=='1.0.0'
      ||saved!==undefined&&!isDeepStrictEqual(saved,source))fail('REVISION_CONFLICT','F21 original installation or workspace permission changed');
  }
  function graph(scope:Scope,sessionId:string){current(scope);const value=app().readConfiguredWorkflowBinding({taskId:scope.taskId,workflowId,sessionId,signal:scope.signal});
    if(!value||value.deadline!==scope.deadline||!isDeepStrictEqual((value.input as {configuration?:unknown}).configuration,options.sourceConfiguration()))
      fail('UNAUTHORIZED','F21 original graph binding unavailable');return value;}
  function operation(value:Graph,nodeId:string,toolName='workflow.host.'+nodeId.toLowerCase()){
    const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName===toolName);
    if(found.length!==1)fail('UNAUTHORIZED','F21 requires one original node receipt');return found[0]!;
  }
  function predecessors(value:Graph,nodeId:string){const result:Record<string,unknown>={};
    for(const dependency of getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies)
      result[dependency.nodeId]=operation(value,dependency.nodeId).result;return result;}
  const asScope=(scope:OwnedWorkflowHostScope)=>({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
  function host(nodeId:string,args:unknown,context:ToolContext){const scope=assertOwnedWorkflowHostScope({runtime:app().runtime,context,workflowId,nodeId,
    hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:args,assertCurrent:scope=>current(asScope(scope))});
    return {scope,binding:graph(asScope(scope),scope.sessionId)};}
  let bridgeApp:RuntimeApplication|undefined,bridge:ReturnType<typeof createWorkflowBusinessToolBridge>|undefined;
  function originalBridge(){if(bridgeApp!==app()){bridgeApp=app();bridge=createWorkflowBusinessToolBridge({application:bridgeApp,
    resolveTool:request=>request.actionKey==='f21.protocol'&&isDeepStrictEqual(request.input,{recipeId})?{
      workflowId,nodeId:'F21_N03',hostToolName:'workflow.host.f21_n03',toolName:commandName,toolVersion:'1.0.0',arguments:{recipeId}}:undefined,
    assertCurrent:scope=>current(asScope(scope)),now:()=>new Date()});}return bridge!;}
  function probe(value:Graph,scope:OwnedWorkflowHostScope){
    const result=operation(value,'F21_N03').result;
    if(!plain(result)||!plain(result.original))fail('UNAUTHORIZED','F21 original probe receipt unavailable');
    const source=readWorkflowBusinessToolSource(app(),scope,result.original as unknown as WorkflowBusinessToolReceipt,commandName);
    if(source.graph.nodeId!=='F21_N03'||source.actionKey!=='f21.protocol'
      ||!isDeepStrictEqual(source.request.arguments,{recipeId}))fail('UNAUTHORIZED','F21 probe origin changed');
    const verified=options.verifyProbe(source.receipt,scope);
    if(!isDeepStrictEqual(result.probe,verified))fail('REVISION_CONFLICT','F21 original probe readback changed');return verified;
  }
  const tools:RegisteredTool[]=[];
  for(const nodeId of ['F21_N01','F21_N02','F21_N03','F21_N04','F21_N05'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'host',
    sideEffect:['F21_N02','F21_N05'].includes(nodeId)?'local_write':'read',requiredScopes:['mcp:workspace:read'],inputSchema:empty,outputSchema:{type:'object'},
    async execute(args,context){const {scope,binding}=host(nodeId,args,context),configuration=options.sourceConfiguration()!;
      if(nodeId==='F21_N01')return {toolId:configuration.toolName,transport:'stdio',manifestDigest:configuration.manifestDigest,
        skillId:configuration.skillId,skillVersion:configuration.skillVersion,permissions:['mcp:workspace:read']};
      if(nodeId==='F21_N02'){
        const descriptor=app().runtime.readToolDescriptors().find(item=>item.name===configuration.toolName&&item.version===configuration.toolVersion);
        if(!descriptor||descriptor.sideEffect!=='read'||!isDeepStrictEqual(descriptor.requiredScopes,['mcp:workspace:read']))
          fail('UNSUPPORTED_CAPABILITY','F21 original registered capability unavailable');
        return {registered:true,installation:'existing_pinned_package',toolId:configuration.toolName,manifestDigest:configuration.manifestDigest};
      }
      if(nodeId==='F21_N03'){
        const result=await originalBridge().invoke({actionKey:'f21.protocol',input:{recipeId}},context);current(asScope(scope));
        const verified=options.verifyProbe(result,scope);
        return {connectionAlive:true,probe:verified,original:{taskId:result.taskId,runId:result.runId,scopeRef:result.scopeRef,toolVersion:result.toolVersion,arguments:result.arguments}};
      }
      const verified=probe(binding,scope);
      if(nodeId==='F21_N04')return {filesReturned:1,noSandboxEscape:true,probeAuditDigest:verified.auditDigest,
        boundary:'windows-psec-read-only-fixed-reference-probe'};
      const result=await options.enable(scope,context);current(asScope(scope));
      if(!isDeepStrictEqual(result,options.readEnabled(scope)))fail('RESULT_UNKNOWN','F21 original enable result requires readback');return result;
    }}));
  const worker:Worker={workflowId,toolName:'workflow.skills.enable_reference',toolVersion:'1.0.0',configurationVersion:'f21-reference-probe-v1',
    requestSchema,inputSchema:object({...requestSchema.properties,configuration:{type:'object'}}),
    resultSchema:object({availableInWorkflow:{const:true},toolId:text,skillId:text,manifestDigest:text,configurationRef:text}),
    publicEnumPaths:['/capability'],sideEffect:'local_write',requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
      {name:'decision.choose_candidate',version:'1.0.0'}],assertCurrent:current,
    available:scope=>{try{current(scope);return app().runtime.readToolDescriptors().some(item=>item.name===commandName&&item.version==='1.0.0');}catch{return false;}},
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);const configuration=options.sourceConfiguration()!;
      app().runtime.saveCheckpointOnce(scope.taskId,configurationKey,configuration);return {...args,configuration};},
    assertFrontier(request){current(request);const value=graph(request,request.state.sessionId),proposal=request.proposal;
      if(!tools.some(tool=>tool.descriptor.name==='workflow.host.'+proposal.nodeId.toLowerCase()))return false;
      if(proposal.toolName==='decision.choose_candidate'){
        let parsed;try{parsed=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(!plain(parsed)||parsed.workflowId!==workflowId||parsed.nodeId!==proposal.nodeId||!isDeepStrictEqual(parsed.input,value.input)
          ||!isDeepStrictEqual(parsed.predecessors,predecessors(value,proposal.nodeId))||!Array.isArray(parsed.candidateValues)||!Array.isArray(proposal.arguments.candidates)
          ||!isDeepStrictEqual(parsed.candidateValues.map(item=>plain(item)?item.id:null),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        return parsed.candidateValues.every(item=>plain(item)&&item.branches===undefined&&(item.abstain===true||plain(item.value)&&isDeepStrictEqual(item.value,{arguments:{}})));
      }
      return proposal.toolName==='workflow.host.'+proposal.nodeId.toLowerCase()&&isDeepStrictEqual(proposal.arguments,{});
    },
    async authorizeExport(request){const check=()=>{current(request);
      if(request.stage==='initial'&&!isDeepStrictEqual(request.value,{capability:'workspace-reference',configuration:options.sourceConfiguration()}))
        fail('UNAUTHORIZED','F21 initial source export changed');
      if(request.stage==='receipt'){
        const read=request.localTaskId?app().readHostToolTask(request.localTaskId):undefined,proposal=request.proposal;
        if(!proposal||!read?.confirmed||read.task.state!=='succeeded'||read.task.cancelRequested||read.commandId!==proposal.operationId
          ||!isDeepStrictEqual((request.value as {result?:unknown}).result,read.confirmed.result))fail('UNAUTHORIZED','F21 original export receipt changed');
      }};check();const allowed=await options.authorizeExport({...request,workflowId});check();return allowed===true;},
    async verifyCompletion(request){const value=graph(request,request.state.sessionId);
      for(const node of getOwnedWorkflowTemplate(workflowId)!.nodes)if(request.state.result?.nodes[node.id]?.state!=='completed')
        fail('UNAUTHORIZED','F21 original required nodes are incomplete');
      const final=operation(value,'F21_N05'),scope={parentTaskId:request.taskId,localTaskId:final.localTaskId,operationId:final.operationId,
        sessionId:value.sessionId,deadline:request.deadline,signal:request.signal};probe(value,scope);
      if(!isDeepStrictEqual(final.result,options.readEnabled(scope)))fail('UNAUTHORIZED','F21 original enabled configuration changed');
      return {result:final.result,resultSummary:'Pinned reference capability enabled after original isolated protocol evidence and native confirmation'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null,
    readVerifiedProbe:(scope:OwnedWorkflowHostScope)=>probe(graph(asScope(scope),scope.sessionId),scope),
    readProbeBinding(context:ToolContext){const runtime=app().runtime,parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string}|undefined;
      const owner=parent?.taskId?runtime.loadCheckpoint(parent.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined:undefined;
      const intent=owner?.taskId?runtime.loadCheckpoint(owner.taskId,'owned-workflow:intent:'+owner.operationId) as {sessionId?:string;deadline?:string}|undefined:undefined;
      const child=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {deadline?:string}|undefined;
      if(!owner?.taskId||!intent?.sessionId||intent.deadline!==child?.deadline
        ||Date.parse(context.deadline)>Date.parse(intent.deadline!))fail('UNAUTHORIZED','F21 original command lifetime unavailable');
      const scope={parentTaskId:owner.taskId,sessionId:intent.sessionId,deadline:intent.deadline!};current({taskId:owner.taskId,deadline:scope.deadline,signal:context.signal});
      const proof=readWorkflowBusinessToolOrigin(app(),scope,{taskId:context.taskId,runId:context.runId,scopeRef:context.runId,toolVersion:'1.0.0',arguments:{recipeId}},commandName);
      if(proof.graph.workflowId!==workflowId||proof.graph.nodeId!=='F21_N03'||proof.actionKey!=='f21.protocol')fail('UNAUTHORIZED','F21 original probe lineage changed');
      graph({taskId:scope.parentTaskId,deadline:scope.deadline,signal:context.signal},scope.sessionId);
      return {...scope,hostTaskId:proof.sourceHost.taskId,taskId:context.taskId,runId:context.runId,argumentsDigest:context.argumentsDigest};
    }};
}
