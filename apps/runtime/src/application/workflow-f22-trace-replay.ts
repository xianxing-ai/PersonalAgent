import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolDescriptor} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {replayFrozenWorkflowTrace,workflowTraceDigest} from '@personal-agent/agentarts/trace-replay';
import type {FrozenWorkflowTrace} from '@personal-agent/agentarts/trace-replay';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Scope=Parameters<Worker['assertCurrent']>[0];
export interface F22TraceReplayAdmission {revision:number;advancedEnabled:boolean;shadowAllowed:boolean;mainPriorityAvailable:boolean;}
export interface F22TraceReplayOptions {
  application:RuntimeApplication;hostUserNamespace:string;
  getToolDescriptor:(name:string,version:string)=>ToolDescriptor|undefined;
  readAdmission:(scope:Scope)=>F22TraceReplayAdmission|undefined;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F22'})=>Promise<boolean>;
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
const key='f22:original-trace-replay';
const branches=[{nodeId:'F22_N03',state:'skipped'},{nodeId:'F22_N04',state:'selected'},
  {nodeId:'F22_N05',state:'skipped'},{nodeId:'F22_N06',state:'selected'},{nodeId:'F22_N07',state:'selected'}];
const decisions={F22_N02:{shadowPlan:{mode:'trace_replay'}},F22_N08:{mode:'trace_replay',counterfactualComparison:'unknown',candidateRef:null,trainingPerformed:false}};
const hostIds=['F22_N09','F22_N01','F22_N04','F22_N06'];
function fail(code:string,message:string):never{throw new ProtocolError(code,message);}

/** Historical replay only. No executor, model port, writer, grant issuer or retry is available here. */
export function createF22TraceReplayWorkflowPorts(options?:F22TraceReplayOptions):{
  tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null;
} {
  if(!options?.application||!options.hostUserNamespace||typeof options.getToolDescriptor!=='function'
    ||typeof options.readAdmission!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f22_original_trace_ports_unavailable'};
  const app=options.application;
  function current(scope:Scope) {
    if(scope.signal.aborted)fail('CANCELLED','Original replay cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original replay expired');
    const task=app.runtime.getTask(scope.taskId),parent=app.readDelegatedUserTaskParent(scope.taskId);
    if(!parent||parent.deadline!==scope.deadline||task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||app.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)
      fail('UNAUTHORIZED','Original replay user task unavailable');
    const admission=options!.readAdmission(scope);
    if(!admission||!Number.isSafeInteger(admission.revision)||admission.revision<1||admission.advancedEnabled!==true
      ||admission.shadowAllowed!==true||admission.mainPriorityAvailable!==true)
      fail('UNSUPPORTED_CAPABILITY','Trace replay is disabled or a main task has priority');
    return {parent,admissionRevision:admission.revision};
  }
  function source(scope:Scope,sourceTaskId:string) {
    const {parent,admissionRevision}=current(scope),runtime=app.runtime;
    if(sourceTaskId===scope.taskId||sourceTaskId===parent.taskId||app.readToolConversation(sourceTaskId)!==parent.conversationId)
      fail('UNAUTHORIZED','Replay source must belong to the original user conversation');
    const task=runtime.getTask(sourceTaskId),intent=runtime.loadCheckpoint(sourceTaskId,'host-tool-intent') as
      {namespace?:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>;argumentsDigest:string}|undefined;
    const sourceRunId='host-tool-'+sourceTaskId,record=runtime.readToolExecutions(sourceTaskId).find(item=>item.evidenceId===sourceRunId);
    const descriptor=intent&&options!.getToolDescriptor(intent.toolName,intent.toolVersion);
    const grant=runtime.policy.get(sourceRunId);
    if(!intent||intent.namespace!==options!.hostUserNamespace||task.conversationId!=='host-tool:'+options!.hostUserNamespace
      ||!descriptor||descriptor.name!==intent.toolName||descriptor.version!==intent.toolVersion||!record
      ||record.taskId!==sourceTaskId||record.toolName!==intent.toolName||record.toolVersion!==intent.toolVersion
      ||record.policyDecision!=='allow'||!record.executionStarted||record.state==='started'||!record.finishedAt
      ||runtime.isTaskActive(sourceTaskId)||runtime.isToolExecutionActive(record)
      ||!['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state)
      ||intent.argumentsDigest!==toolArgumentsDigest(intent.arguments)
      ||!grant||grant.taskId!==sourceTaskId||grant.toolName!==intent.toolName||grant.argumentsDigest!==intent.argumentsDigest
      ||!descriptor.requiredScopes.every(scope=>grant.scopes.includes(scope))
      ||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:sourceRunId}))
      fail('UNAUTHORIZED','Original stopped tool execution unavailable');
    const read=app.readHostToolTask(sourceTaskId);
    if(record.state==='confirmed'&&(!read.confirmed||read.confirmed.runId!==sourceRunId))
      fail('UNAUTHORIZED','Original confirmed result unavailable');
    const result=record.state==='confirmed'?read.confirmed!.result:{state:record.state,errorCode:record.errorCode??null};
    const sourceVersions={taskRevision:String(task.revision),inputDigest:record.inputDigest,descriptorDigest:workflowTraceDigest(descriptor)};
    const frozenRecord={recordId:sourceRunId,kind:'tool',observedAt:record.finishedAt,sourceVersions,state:record.state,
      result,resultDigest:workflowTraceDigest(result),evidenceRefs:[sourceRunId],effect:descriptor.sideEffect==='read'?'read':'write',
      toolName:intent.toolName,toolVersion:intent.toolVersion,arguments:intent.arguments,argumentsDigest:workflowTraceDigest(intent.arguments)};
    return {mode:'trace_replay' as const,sourceTaskId,sourceRunId,conversationId:parent.conversationId,admissionRevision,
      frozenSnapshot:{asOf:record.finishedAt,sourceVersions,records:[frozenRecord]} as FrozenWorkflowTrace,
      requestedActions:[{actionId:'original-operation',toolName:intent.toolName,toolVersion:intent.toolVersion,arguments:intent.arguments,
        argumentsDigest:frozenRecord.argumentsDigest,sourceVersions}],decisionOutputs:decisions,branches};
  }
  function original(scope:Scope) {
    const saved=app.runtime.loadCheckpoint(scope.taskId,key) as ReturnType<typeof source>|undefined;
    if(!saved)fail('UNAUTHORIZED','Original replay source is not bound');
    const observed=source(scope,saved.sourceTaskId);
    if(!isDeepStrictEqual(saved,observed))fail('REVISION_CONFLICT','Original replay source or configuration changed');
    return observed;
  }
  const replay=(scope:Scope)=>{
    const input=original(scope),result=replayFrozenWorkflowTrace({snapshot:input.frozenSnapshot,requestedActions:input.requestedActions},scope);
    return {...result,mode:'trace_replay' as const,provenance:'runtime_original_execution_not_new_execution' as const,
      sourceTaskId:input.sourceTaskId,sourceRunId:input.sourceRunId};
  };
  function hostValue(nodeId:string,scope:Scope) {
    const input=original(scope);
    if(nodeId==='F22_N09')return {eligible:true,mode:input.mode,admissionRevision:input.admissionRevision};
    if(nodeId==='F22_N01')return {frozenComparisonInput:input};
    if(nodeId==='F22_N06')return {mode:input.mode,counterfactualComparison:'unknown',actualToolCalls:0,actualModelCalls:0,trainingPerformed:false};
    return replay(scope);
  }
  const resultSchema=object({mode:{const:'trace_replay'},sourceTaskId:text,sourceRunId:text,snapshotAsOf:text,
    sourceVersions:{type:'object'},snapshotDigest:text,timeline:{type:'array'},actions:{type:'array'},actualToolCalls:{const:0},actualModelCalls:{const:0},
    authority:{const:'data_only_no_tool_grant'},currentResultValidity:{const:'not_independently_verified'},counterfactualComparison:{const:'unknown'},
    provenance:{const:'runtime_original_execution_not_new_execution'},trainingPerformed:{const:false}});
  const tools=hostIds.map(nodeId=>createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'read',requiredScopes:['workflow:trace_replay'],
    inputSchema:object({}),outputSchema:nodeId==='F22_N04'?resultSchema:{type:'object'},
    async execute(args,context){
      const scope=assertOwnedWorkflowHostScope({runtime:app.runtime,context,workflowId:'F22',nodeId,
        hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:args,hostArguments:args});
      const owner={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},input=original(owner);
      const binding=app.readConfiguredWorkflowBinding({taskId:owner.taskId,workflowId:'F22',sessionId:scope.sessionId,signal:scope.signal});
      const run=app.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId),grant=app.runtime.policy.get(context.authorizationRef!);
      if(!binding||binding.deadline!==scope.deadline||!isDeepStrictEqual(binding.input,input)||!run||run.state!=='started'
        ||run.policyDecision!=='allow'||!run.executionStarted||!app.runtime.isToolExecutionActive(run)||context.authorizationRef!==context.runId
        ||run.toolName!=='workflow.host.'+nodeId.toLowerCase()||run.toolVersion!=='1.0.0'
        ||!app.runtime.matchesToolExecutionInput(run,{arguments:args as Record<string,unknown>,scopeRef:context.runId})
        ||!grant||grant.taskId!==context.taskId||grant.toolName!==run.toolName||grant.argumentsDigest!==toolArgumentsDigest(args)
        ||Date.parse(grant.expiresAt)<=Date.now()||!grant.scopes.includes('workflow:trace_replay'))
        fail('UNAUTHORIZED','Original replay host execution unavailable');
      return hostValue(nodeId,owner);
    }}));
  function exportCurrent(request:Parameters<Worker['authorizeExport']>[0]) {
    const input=original(request);
    if(request.stage==='initial'){if(!isDeepStrictEqual(request.value,input))fail('UNAUTHORIZED','Original replay input changed');return;}
    if(request.stage==='completion'){if(!isDeepStrictEqual(request.value,replay(request)))fail('UNAUTHORIZED','Original replay result changed');return;}
    const p=request.proposal,read=request.localTaskId&&app.readHostToolTask(request.localTaskId);
    if(!p||!read||read.commandId!==p.operationId||read.toolName!==p.toolName||!read.confirmed
      ||!isDeepStrictEqual((request.value as {result?:unknown}).result,read.confirmed.result))fail('UNAUTHORIZED','Original replay receipt changed');
    if(hostIds.includes(p.nodeId)&&p.toolName!=='decision.choose_candidate'&&!isDeepStrictEqual(read.confirmed.result,hostValue(p.nodeId,request)))
      fail('REVISION_CONFLICT','Original replay host result changed');
  }
  const worker:Worker={workflowId:'F22',toolName:'workflow.f22.trace_replay',toolVersion:'1.0.0',configurationVersion:'f22-original-trace-v1',
    requestSchema:object({sourceTaskId:text}),inputSchema:object({mode:{const:'trace_replay'},sourceTaskId:text,sourceRunId:text,conversationId:text,
      admissionRevision:{type:'integer',minimum:1},frozenSnapshot:{type:'object'},requestedActions:{type:'array'},decisionOutputs:{const:decisions},branches:{const:branches}}),
    resultSchema,publicEnumPaths:[],sideEffect:'read',requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
      {name:'decision.choose_candidate',version:'1.0.0'}],
    available(scope){try{current(scope);return true;}catch{return false;}},assertCurrent(scope){current(scope);},
    async resolveInput(args,scope){
      const input=source(scope,args.sourceTaskId as string),saved=app.runtime.loadCheckpoint(scope.taskId,key);
      if(saved!==undefined&&!isDeepStrictEqual(saved,input)||saved===undefined&&!app.runtime.saveCheckpointOnce(scope.taskId,key,input))
        fail('REVISION_CONFLICT','Original replay source changed');
      return original(scope);
    },
    assertFrontier(request){
      const input=original(request),p=request.proposal;
      if(!isDeepStrictEqual(request.input,input)||p.toolVersion!=='1.0.0')return false;
      if(p.toolName!=='decision.choose_candidate')return hostIds.includes(p.nodeId)&&p.toolName==='workflow.host.'+p.nodeId.toLowerCase()
        &&isDeepStrictEqual(p.arguments,{});
      let context:{nodeId?:string;workflowId?:string;input?:unknown;candidateValues?:{value:unknown;branches?:unknown;abstain?:boolean}[]};
      try{context=JSON.parse(p.arguments.context as string);}catch{return false;}
      if(context.workflowId!=='F22'||context.nodeId!==p.nodeId||!isDeepStrictEqual(context.input,input)||!context.candidateValues?.length)return false;
      return context.candidateValues.every(candidate=>candidate.abstain===true||
        (p.nodeId==='F22_N02'?isDeepStrictEqual(candidate.value,decisions.F22_N02)&&isDeepStrictEqual(candidate.branches,branches):
          p.nodeId==='F22_N08'?isDeepStrictEqual(candidate.value,decisions.F22_N08)&&candidate.branches===undefined:
          hostIds.includes(p.nodeId)&&isDeepStrictEqual(candidate.value,{arguments:{}})&&candidate.branches===undefined));
    },
    async authorizeExport(request){exportCurrent(request);const allowed=await options.authorizeExport({...request,workflowId:'F22'});exportCurrent(request);return allowed===true;},
    async verifyCompletion(request){
      original(request);
      for(const nodeId of ['F22_N02','F22_N08']) {
        const op=Object.values(request.state.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName==='decision.choose_candidate');
        if(!op||!request.readbacks.some(read=>read.task.taskId===op.localTaskId&&read.task.state==='succeeded'
          &&read.confirmed?.evidenceRefs.includes(read.confirmed.runId)&&isDeepStrictEqual(read.confirmed.result,op.result)))
          fail('UNAUTHORIZED','Original replay decision receipt unavailable');
      }
      for(const nodeId of hostIds) {
        const op=Object.values(request.state.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName==='workflow.host.'+nodeId.toLowerCase());
        if(!op||!isDeepStrictEqual(op.result,hostValue(nodeId,request))||!request.readbacks.some(read=>read.task.taskId===op.localTaskId
          &&read.task.state==='succeeded'&&read.confirmed?.evidenceRefs.includes(read.confirmed.runId)&&isDeepStrictEqual(read.confirmed.result,op.result)))
          fail('UNAUTHORIZED','Original replay node receipt unavailable');
      }
      return {result:replay(request),resultSummary:'Historical trace replay only; no original tool or model re-executed; counterfactual comparison unknown'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null};
}
