import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createRuntimeF25OutboundContextHost} from './workflow-f25-outbound-graph-host.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Scope=Parameters<Worker['assertCurrent']>[0];
interface DataScope {sourceId:string;configRevision:number;enabled:boolean;dataLevel:'public'|'private';writeAllowed:boolean;cloudExportAllowed:boolean;publicQueries:string[];}
interface Selection {revision:number;accountRef:string;sourceBefore:DataScope;desired:DataScope;}
interface Saved {saved:true;configurationRef:string;sourceId:string;sourceRevision:number;dataLevel:'public'|'private';cloudExportAllowed:boolean;
  pingConnected:'unverified';capabilityTested:'unverified';accountActive:'unverified';privateDataBlocked:boolean;}
export interface F25ConfigurationWorkflowOptions {
  application:RuntimeApplication;
  configuration:{readSelection():Selection;assertCurrent(selection:Selection,scope:Scope):void;
    readOutboundContext(selection:Selection,scope:Scope):{sourceId:string;revision:number;dataLevel:'public'|'private'|'sensitive';cloudExportAllowed:boolean;payload:unknown};
    apply(selection:Selection,scope:Scope):Promise<Saved>;readSaved(selection:Selection,scope:Scope):Saved|undefined;};
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F25'})=>Promise<boolean>;
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
const key='f25:original-configuration';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code:string,message:string):never{throw new ProtocolError(code,message);}

/** The original account and Knowledge configuration are the only implementation.
 * Raw catalog/configuration bodies are local; the graph receives bounded metadata. */
export function createF25ConfigurationWorkflowPorts(options?:F25ConfigurationWorkflowOptions):{
  tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null;
} {
  if(!options?.application||!options.configuration||typeof options.authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f25_original_configuration_unavailable'};
  const app=options.application,config=options.configuration;
  function active(scope:Scope) {
    if(scope.signal.aborted)fail('CANCELLED','Original F25 request cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original F25 request expired');
    const parent=app.readDelegatedUserTaskParent(scope.taskId),task=app.runtime.getTask(scope.taskId);
    if(!parent||parent.deadline!==scope.deadline||task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||app.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('UNAUTHORIZED','Original F25 user task unavailable');
  }
  function original(scope:Scope) {
    active(scope);const selected=app.runtime.loadCheckpoint(scope.taskId,key) as Selection|undefined;
    if(!selected||!isDeepStrictEqual(selected,config.readSelection()))fail('REVISION_CONFLICT','Original F25 selection changed');
    config.assertCurrent(selected,scope);return selected;
  }
  const decision=(selected:Selection)=>({allowedCategories:selected.desired.dataLevel==='public'&&selected.desired.cloudExportAllowed?['public']:[],
    bannedCategories:['private','sensitive','credentials']});
  const input=(selected:Selection)=>({configurationRevision:selected.revision,configurationDigest:digest(selected),sourceId:selected.sourceBefore.sourceId,
    sourceRevision:selected.sourceBefore.configRevision,accountRef:selected.accountRef,dataLevel:selected.desired.dataLevel,
    cloudExportAllowed:selected.desired.cloudExportAllowed,queryCount:selected.desired.publicQueries.length,decisionOutput:decision(selected)});
  function host(context:ToolContext,nodeId:string) {
    const scope=assertOwnedWorkflowHostScope({runtime:app.runtime,context,workflowId:'F25',nodeId,
      hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:{},hostArguments:{}});
    const owner={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},selected=original(owner);
    const binding=app.readConfiguredWorkflowBinding({taskId:owner.taskId,workflowId:'F25',sessionId:scope.sessionId,signal:scope.signal});
    const run=app.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId),grant=app.runtime.policy.get(context.authorizationRef);
    if(!binding||binding.deadline!==context.deadline||!isDeepStrictEqual(binding.input,input(selected))||context.authorizationRef!==context.runId
      ||!run||!['started','confirmed'].includes(run.state)||run.policyDecision!=='allow'||!run.executionStarted
      ||run.state==='started'&&!app.runtime.isToolExecutionActive(run)||run.toolName!=='workflow.host.'+nodeId.toLowerCase()
      ||run.toolVersion!=='1.0.0'||!app.runtime.matchesToolExecutionInput(run,{arguments:{},scopeRef:context.runId})
      ||!grant||grant.taskId!==context.taskId||grant.toolName!==run.toolName||grant.argumentsDigest!==toolArgumentsDigest({})
      ||Date.parse(grant.expiresAt)<=Date.now())fail('UNAUTHORIZED','Original F25 ToolGateway execution unavailable');
    return {scope,owner,selected,binding,run};
  }
  const outbound=createRuntimeF25OutboundContextHost({application:app,requiredScopes:['workflow:configuration:read'],now:()=>new Date(),
    assertCurrent:(_scope,context)=>{host(context,'F25_N03');},
    readOutboundContext(scope){const owner={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal};return config.readOutboundContext(original(owner),owner);},
    authorizeExport:(scope,result)=>options.authorizeExport({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal,
      workflowId:'F25',stage:'receipt',localTaskId:scope.localTaskId,value:result})});
  if(!outbound.tools.length||!outbound.assertReceiptCurrent)return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:outbound.unavailable};
  const resultSchema=object({saved:{const:true},configurationRef:text,sourceId:text,sourceRevision:{type:'integer',minimum:1},
    dataLevel:{enum:['public','private']},cloudExportAllowed:{type:'boolean'},pingConnected:{const:'unverified'},capabilityTested:{const:'unverified'},
    accountActive:{const:'unverified'},privateDataBlocked:{type:'boolean'}});
  const save=createOwnedWorkflowAdapter({nodeId:'F25_N04',kind:'host',sideEffect:'local_write',requiredScopes:['workflow:configuration:write'],
    inputSchema:object({}),outputSchema:resultSchema,
    async execute(_args,context){
      const {owner,selected,binding,run}=host(context,'F25_N04');
      if(run.state!=='started')fail('UNAUTHORIZED','F25 save requires its original active execution');
      const checked=binding.confirmedOperations.find(op=>op.nodeId==='F25_N03'&&op.toolName==='workflow.host.f25_n03');
      const result=checked?.result as {filteredOut?:string[]}|undefined;
      if(!checked||checked.readback.task.state!=='succeeded'||!Array.isArray(result?.filteredOut))fail('UNAUTHORIZED','Original outbound inspection unavailable');
      if(selected.desired.cloudExportAllowed&&result.filteredOut.some(reason=>['credential_pattern','private_marker'].includes(reason)))
        fail('SCOPE_DENIED','Credential-bearing payload cannot be enabled for export');
      const attempt={parentTaskId:owner.taskId,selectionDigest:digest(selected),runId:context.runId};
      if(!app.runtime.saveCheckpointOnce(context.taskId,'f25:save-attempt',attempt))fail('RESULT_UNKNOWN','Original configuration save must not be repeated');
      const saved=await config.apply(selected,owner);original(owner);
      if(!isDeepStrictEqual(saved,config.readSaved(selected,owner)))fail('RESULT_UNKNOWN','Original configuration save needs readback');
      return saved;
    }});
  const tools=[...outbound.tools,save];
  function receipt(request:Parameters<Worker['authorizeExport']>[0]) {
    const p=request.proposal,read=request.localTaskId&&app.readHostToolTask(request.localTaskId);
    if(!p||!read||read.commandId!==p.operationId||read.toolName!==p.toolName||!read.confirmed
      ||!isDeepStrictEqual((request.value as {result?:unknown}).result,read.confirmed.result))fail('UNAUTHORIZED','Original F25 receipt changed');
    if(p.toolName==='workflow.host.f25_n03'){
      const runId='host-tool-'+read.task.taskId,grant=app.runtime.policy.get(runId);
      if(!grant)fail('UNAUTHORIZED','Original F25 receipt grant revoked');
      outbound.assertReceiptCurrent!({context:{taskId:read.task.taskId,runId,authorizationRef:runId,scopes:grant.scopes,
        deadline:request.deadline,signal:request.signal},result:read.confirmed.result});
    }
    if(p.toolName==='workflow.host.f25_n04'&&!isDeepStrictEqual(read.confirmed.result,config.readSaved(original(request),request)))
      fail('REVISION_CONFLICT','Saved F25 scope changed');
  }
  function exportCurrent(request:Parameters<Worker['authorizeExport']>[0]) {
    const selected=original(request);
    if(request.stage==='initial'&&!isDeepStrictEqual(request.value,input(selected)))fail('UNAUTHORIZED','F25 input changed');
    if(request.stage==='receipt')receipt(request);
    if(request.stage==='completion'&&!isDeepStrictEqual(request.value,config.readSaved(selected,request)))fail('REVISION_CONFLICT','F25 saved readback changed');
  }
  const worker:Worker={workflowId:'F25',toolName:'workflow.f25.configure_data_scope',toolVersion:'1.0.0',configurationVersion:'f25-original-knowledge-scope-v1',
    requestSchema:object({}),inputSchema:object({configurationRevision:{type:'integer',minimum:1},configurationDigest:text,sourceId:text,
      sourceRevision:{type:'integer',minimum:1},accountRef:text,dataLevel:{enum:['public','private']},cloudExportAllowed:{type:'boolean'},
      queryCount:{type:'integer',minimum:0,maximum:16},decisionOutput:{type:'object'}}),resultSchema,publicEnumPaths:[],sideEffect:'local_write',
    requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),{name:'decision.choose_candidate',version:'1.0.0'}],
    available(scope){try{active(scope);const selected=config.readSelection();config.assertCurrent(selected,scope);return true;}catch{return false;}},
    assertCurrent(scope){active(scope);if(app.runtime.loadCheckpoint(scope.taskId,key)!==undefined)original(scope);},
    async resolveInput(_args,scope){active(scope);const selected=config.readSelection();config.assertCurrent(selected,scope);
      const prior=app.runtime.loadCheckpoint(scope.taskId,key);
      if(prior!==undefined&&!isDeepStrictEqual(prior,selected)||prior===undefined&&!app.runtime.saveCheckpointOnce(scope.taskId,key,selected))
        fail('REVISION_CONFLICT','Original F25 selection changed');return input(original(scope));},
    assertFrontier(request){
      const selected=original(request),p=request.proposal,expected=input(selected);
      if(!isDeepStrictEqual(request.input,expected)||p.toolVersion!=='1.0.0')return false;
      if(p.toolName!=='decision.choose_candidate')return ['F25_N03','F25_N04'].includes(p.nodeId)
        &&p.toolName==='workflow.host.'+p.nodeId.toLowerCase()&&isDeepStrictEqual(p.arguments,{});
      let context:{workflowId:string;nodeId:string;input:unknown;candidateValues:{value:unknown;abstain?:boolean;branches?:unknown}[]};
      try{context=JSON.parse(p.arguments.context as string);}catch{return false;}
      return context.workflowId==='F25'&&context.nodeId===p.nodeId&&isDeepStrictEqual(context.input,expected)&&!!context.candidateValues?.length
        &&context.candidateValues.every(candidate=>candidate.abstain===true||candidate.branches===undefined
          &&isDeepStrictEqual(candidate.value,p.nodeId==='F25_N02'?decision(selected):{arguments:{}}));
    },
    async authorizeExport(request){exportCurrent(request);const allowed=await options.authorizeExport({...request,workflowId:'F25'});exportCurrent(request);return allowed===true;},
    async verifyCompletion(request){
      const selected=original(request),saved=config.readSaved(selected,request);
      if(!saved)fail('RESULT_UNKNOWN','Original F25 save has no current readback');
      for(const [nodeId,toolName] of [['F25_N02','decision.choose_candidate'],['F25_N03','workflow.host.f25_n03'],['F25_N04','workflow.host.f25_n04']]){
        const op=Object.values(request.state.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName===toolName);
        if(!op||!request.readbacks.some(read=>read.task.taskId===op.localTaskId&&read.task.state==='succeeded'
          &&read.confirmed?.evidenceRefs.includes(read.confirmed.runId)&&isDeepStrictEqual(read.confirmed.result,op.result))
          ||nodeId==='F25_N04'&&!isDeepStrictEqual(op.result,saved))fail('UNAUTHORIZED','Original F25 completion evidence unavailable');
      }
      return {result:saved,resultSummary:'Original encrypted account reference and Knowledge scope saved; connectivity and capability remain unverified'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null};
}
