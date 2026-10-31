import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,ToolNotStartedError,validateToolValue} from '@personal-agent/contracts';
import type {ToolContext,ToolDescriptor} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication,SubmitHostToolTaskRequest} from './runtime-application.js';
import type {ToolExecutionRecord} from '../index.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

export interface WorkflowBusinessToolRequest {actionKey:string;input:Record<string,unknown>}
export interface WorkflowBusinessToolResolution {
  workflowId:string;nodeId:string;hostToolName:string;
  toolName:string;toolVersion:string;arguments:Record<string,unknown>;
}
export interface WorkflowBusinessToolReceipt {
  taskId:string;runId:string;scopeRef:string;toolName:string;toolVersion:string;
  arguments:Record<string,unknown>;evidenceRefs:string[];result:unknown;
}
export interface WorkflowBusinessToolReadback {
  state:string;taskId?:string;runId?:string;confirmed?:WorkflowBusinessToolReceipt;
}
export type WorkflowBusinessToolSourceReference=Pick<WorkflowBusinessToolReceipt,'taskId'|'runId'|'scopeRef'|'toolVersion'|'arguments'>;
export interface WorkflowBusinessToolSourceProof {
  readonly graph:Readonly<{taskId:string;sessionId:string;workflowId:string;nodeId:string;operationId:string}>;
  readonly sourceHost:Readonly<{taskId:string;runId:string;toolName:string;toolVersion:string}>;
  readonly actionKey:string;
  readonly descriptor:Readonly<ToolDescriptor>;
  readonly request:Readonly<SubmitHostToolTaskRequest>;
  readonly record:Readonly<ToolExecutionRecord>;
  readonly receipt:Readonly<WorkflowBusinessToolReceipt>;
}
type Application=RuntimeApplication;
type Invocation={taskId:string;runId:string;toolName:string;toolVersion:string;arguments:unknown;deadline:string};
const childSourceKey='workflow-business-tool:source';
const activeChildren=new WeakMap<Application,Map<string,(invocation:Invocation)=>void>>();
type Intent={version:2;sourceTaskId:string;sourceRunId:string;parentTaskId:string;operationId:string;sessionId:string;
  workflowId:string;nodeId:string;sourceToolName:string;sourceToolVersion:string;sourceArgumentsDigest:string;
  namespace:string;actionKey:string;inputDigest:string;descriptor:ToolDescriptor;request:SubmitHostToolTaskRequest};
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048;

/** Exact graph -> host -> business receipt proof, not an authority to dispatch
 * or export. Direct graph tools retain their separate original proof path. */
export function readWorkflowBusinessToolSource(application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>,
  scope:Pick<OwnedWorkflowHostScope,'parentTaskId'|'sessionId'|'deadline'>,
  ref:WorkflowBusinessToolSourceReference,toolName:string):WorkflowBusinessToolSourceProof {
  const {runtime}=application;
  if(!ref||![ref.taskId,ref.runId,ref.scopeRef,ref.toolVersion,toolName,scope.parentTaskId,scope.sessionId,scope.deadline].every(text)
    ||ref.runId!=='host-tool-'+ref.taskId||ref.scopeRef!==ref.runId||!plain(ref.arguments))fail('UNAUTHORIZED','Original business source reference is invalid');
  const marker=runtime.loadCheckpoint(ref.taskId,childSourceKey);
  if(!plain(marker)||!text(marker.sourceTaskId)||!text(marker.sourceRunId)||!text(marker.commandId)||!text(marker.intentDigest))
    fail('UNAUTHORIZED','Original business source proof is unavailable');
  const intent=runtime.loadCheckpoint(marker.sourceTaskId,'workflow-business-tool:'+marker.commandId) as Intent|undefined;
  if(!intent||intent.version!==2||!plain(intent.request)||!plain(intent.descriptor)||!text(intent.actionKey)
    ||marker.intentDigest!==toolArgumentsDigest(intent)||intent.sourceTaskId!==marker.sourceTaskId||intent.sourceRunId!==marker.sourceRunId
    ||intent.sourceRunId!=='host-tool-'+intent.sourceTaskId||intent.parentTaskId!==scope.parentTaskId||intent.sessionId!==scope.sessionId
    ||marker.commandId!=='workflow-business-'+hash([intent.sourceTaskId,intent.sourceRunId,intent.actionKey])
    ||intent.request.commandId!==marker.commandId||intent.request.toolName!==toolName||intent.request.toolVersion!==ref.toolVersion
    ||intent.request.deadline!==scope.deadline||!isDeepStrictEqual(intent.request.arguments,ref.arguments)
    ||intent.descriptor.name!==toolName||intent.descriptor.version!==ref.toolVersion
    ||!isDeepStrictEqual(runtime.readToolDescriptors().find(tool=>tool.name===toolName&&tool.version===ref.toolVersion),intent.descriptor))
    fail('UNAUTHORIZED','Original business action, input or descriptor changed');
  if(!isDeepStrictEqual(marker,{sourceTaskId:intent.sourceTaskId,sourceRunId:intent.sourceRunId,
    commandId:intent.request.commandId,intentDigest:toolArgumentsDigest(intent)})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(ref.taskId,'coding-repair:parent'),{taskId:intent.sourceTaskId,operationId:intent.request.commandId})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(intent.sourceTaskId,'coding-repair:host:'+intent.request.commandId),
      {localTaskId:ref.taskId,request:intent.request}))fail('UNAUTHORIZED','Original business child edge changed');
  const hostIntent=runtime.loadCheckpoint(intent.sourceTaskId,'host-tool-intent');
  const ownerIntent=runtime.loadCheckpoint(scope.parentTaskId,'owned-workflow:intent:'+intent.operationId);
  if(!plain(hostIntent)||!plain(hostIntent.arguments)||hostIntent.namespace!==intent.namespace
    ||hostIntent.commandId!==intent.operationId||hostIntent.toolName!==intent.sourceToolName||hostIntent.toolVersion!==intent.sourceToolVersion
    ||hostIntent.deadline!==scope.deadline||hostIntent.argumentsDigest!==intent.sourceArgumentsDigest
    ||toolArgumentsDigest(hostIntent.arguments)!==intent.sourceArgumentsDigest
    ||!isDeepStrictEqual(runtime.loadCheckpoint(intent.sourceTaskId,'coding-repair:parent'),{taskId:scope.parentTaskId,operationId:intent.operationId})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(scope.parentTaskId,'coding-repair:host:'+intent.operationId),{localTaskId:intent.sourceTaskId,
      request:{commandId:intent.operationId,toolName:intent.sourceToolName,toolVersion:intent.sourceToolVersion,arguments:hostIntent.arguments,deadline:scope.deadline}})
    ||!plain(ownerIntent)||ownerIntent.taskId!==scope.parentTaskId||ownerIntent.sessionId!==scope.sessionId
    ||ownerIntent.workflowId!==intent.workflowId||ownerIntent.deadline!==scope.deadline||!plain(ownerIntent.proposal)
    ||ownerIntent.proposal.operationId!==intent.operationId||ownerIntent.proposal.nodeId!==intent.nodeId
    ||ownerIntent.proposal.toolName!==intent.sourceToolName||ownerIntent.proposal.toolVersion!==intent.sourceToolVersion
    ||!isDeepStrictEqual(ownerIntent.proposal.arguments,hostIntent.arguments))fail('UNAUTHORIZED','Original source host graph edge changed');
  const source=application.readHostToolTask(intent.sourceTaskId);
  const sourceRecord=runtime.readToolExecutions(intent.sourceTaskId).find(record=>record.evidenceId===intent.sourceRunId);
  if(source.commandId!==intent.operationId||source.toolName!==intent.sourceToolName||source.toolVersion!==intent.sourceToolVersion
    ||!sourceRecord||!sourceRecord.executionStarted||sourceRecord.policyDecision!=='allow'
    ||sourceRecord.toolName!==intent.sourceToolName||sourceRecord.toolVersion!==intent.sourceToolVersion
    ||!runtime.matchesToolExecutionInput(sourceRecord,{arguments:hostIntent.arguments,scopeRef:intent.sourceRunId}))
    fail('UNAUTHORIZED','Original source host execution is unavailable');
  const childIntent=runtime.loadCheckpoint(ref.taskId,'host-tool-intent'),read=application.readHostToolTask(ref.taskId);
  const record=runtime.readToolExecutions(ref.taskId).find(item=>item.evidenceId===ref.runId);
  const saved=runtime.loadCheckpoint(ref.taskId,'tool-result-'+ref.runId);
  if(!plain(childIntent)||childIntent.namespace!==intent.namespace||childIntent.commandId!==intent.request.commandId
    ||childIntent.toolName!==toolName||childIntent.toolVersion!==ref.toolVersion||childIntent.deadline!==scope.deadline
    ||childIntent.argumentsDigest!==toolArgumentsDigest(ref.arguments)||!isDeepStrictEqual(childIntent.arguments,ref.arguments)
    ||read.task.state!=='succeeded'||read.task.cancelRequested||read.commandId!==intent.request.commandId
    ||read.toolName!==toolName||read.toolVersion!==ref.toolVersion||read.confirmed?.runId!==ref.runId
    ||!read.confirmed.evidenceRefs.includes(ref.runId)||!read.task.evidenceRefs.includes(ref.runId)
    ||!record||record.state!=='confirmed'||!record.executionStarted||record.policyDecision!=='allow'
    ||record.toolName!==toolName||record.toolVersion!==ref.toolVersion
    ||!runtime.matchesToolExecutionInput(record,{arguments:ref.arguments,scopeRef:ref.scopeRef})
    ||!plain(saved)||!Object.hasOwn(saved,'result')||!isDeepStrictEqual(saved.result,read.confirmed.result))
    fail('UNAUTHORIZED','Original business source is not confirmed');
  validateToolValue(intent.descriptor.outputSchema,saved.result);
  const proof=structuredClone({graph:{taskId:intent.parentTaskId,sessionId:intent.sessionId,workflowId:intent.workflowId,
    nodeId:intent.nodeId,operationId:intent.operationId},sourceHost:{taskId:intent.sourceTaskId,runId:intent.sourceRunId,
    toolName:intent.sourceToolName,toolVersion:intent.sourceToolVersion},actionKey:intent.actionKey,descriptor:intent.descriptor,
    request:intent.request,record,receipt:{taskId:ref.taskId,runId:ref.runId,scopeRef:ref.scopeRef,toolName,toolVersion:ref.toolVersion,
      arguments:ref.arguments,evidenceRefs:read.confirmed.evidenceRefs,result:saved.result}});
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){
    for(const item of Object.values(value))freeze(item);Object.freeze(value);
  }};
  freeze(proof);return proof;
}

/** Runtime's existing pre-Policy path calls this for every dispatch/resume. A
 * persisted pending child cannot recover a process-local parent authority. */
export function assertWorkflowBusinessToolInvocation(application:Application,invocation:Invocation):void {
  const guard=activeChildren.get(application)?.get(invocation.taskId);
  if(application.runtime.loadCheckpoint(invocation.taskId,childSourceKey)===undefined&&!guard)return;
  try {
    if(!guard)fail('UNAUTHORIZED','Original business parent must recover before its child can execute');
    guard(invocation);
  }catch(error){throw new ToolNotStartedError(error instanceof ProtocolError?error.code:'UNAUTHORIZED',
    'Original workflow business authority is no longer available');}
}

/** Trusted local composition only. A graph grant never grants the business tool;
 * confirmed local results still require the graph's independent export guard. */
export function createWorkflowBusinessToolBridge(options:{
  application:Application;
  /** A fixed host action selects both the graph node and exact registered tool input. */
  resolveTool:(request:WorkflowBusinessToolRequest,scope:OwnedWorkflowHostScope)=>WorkflowBusinessToolResolution|undefined;
  assertCurrent:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  now?:()=>Date;
}) {
  const {application}=options,runtime=application.runtime;
  if(typeof options.resolveTool!=='function'||typeof options.assertCurrent!=='function')
    fail('INVALID_ARGUMENT','Trusted workflow business ports are required');
  const now=()=>options.now?.()??new Date();
  function resolve(request:WorkflowBusinessToolRequest,context:ToolContext) {
    if(!request||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(request.actionKey)||!plain(request.input))
      fail('INVALID_ARGUMENT','Invalid fixed workflow business action');
    const copied=structuredClone(request);
    if(!isDeepStrictEqual(JSON.parse(JSON.stringify(copied)),copied))fail('INVALID_ARGUMENT','Workflow business input must retain its JSON value');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const graph=parent?.taskId&&parent.operationId?runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {sessionId?:string;proposal?:{arguments?:unknown}}|undefined:undefined;
    const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as
      {namespace?:string;toolName?:string;toolVersion?:string;arguments?:unknown;argumentsDigest?:string;deadline?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||typeof graph?.sessionId!=='string'||!host?.namespace
      ||context.runId!=='host-tool-'+context.taskId||context.authorizationRef!==context.runId||host.deadline!==context.deadline
      ||!plain(host.arguments)||host.argumentsDigest!==toolArgumentsDigest(host.arguments))
      fail('UNAUTHORIZED','Original graph host identity is unavailable');
    const source=application.readHostToolTask(context.taskId);
    if(source.commandId!==parent.operationId||source.toolName!==host.toolName||source.toolVersion!==host.toolVersion)
      fail('UNAUTHORIZED','Original graph host task changed');
    const sourceArguments=host.arguments;
    const scope:OwnedWorkflowHostScope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
      sessionId:graph.sessionId,deadline:context.deadline,signal:context.signal};
    const resolution=options.resolveTool(copied,scope);
    if(!resolution||!plain(resolution.arguments))fail('UNSUPPORTED_CAPABILITY','Fixed workflow business tool is unavailable');
    const descriptor=runtime.readToolDescriptors().find(tool=>tool.name===resolution.toolName&&tool.version===resolution.toolVersion);
    if(!descriptor||descriptor.name===host.toolName)fail('UNSUPPORTED_CAPABILITY','Workflow business tool is not registered');
    validateToolValue(descriptor.inputSchema,resolution.arguments);
    const args=structuredClone(resolution.arguments);
    if(!isDeepStrictEqual(JSON.parse(JSON.stringify(args)),args))fail('INVALID_ARGUMENT','Business arguments must retain their JSON value');
    const commandId='workflow-business-'+hash([context.taskId,context.runId,request.actionKey]);
    const intent:Intent={version:2,sourceTaskId:context.taskId,sourceRunId:context.runId,parentTaskId:scope.parentTaskId,
      operationId:scope.operationId,sessionId:scope.sessionId,namespace:host.namespace,actionKey:request.actionKey,
      workflowId:resolution.workflowId,nodeId:resolution.nodeId,sourceToolName:source.toolName,sourceToolVersion:source.toolVersion,
      sourceArgumentsDigest:toolArgumentsDigest(sourceArguments),
      inputDigest:toolArgumentsDigest(copied.input),descriptor:structuredClone(descriptor),
      request:{commandId,toolName:descriptor.name,toolVersion:descriptor.version,arguments:args,deadline:context.deadline}};
    const key='workflow-business-tool:'+commandId;
    const saved=runtime.loadCheckpoint(context.taskId,key);
    if(saved!==undefined&&!isDeepStrictEqual(saved,intent))fail('REVISION_CONFLICT','Original workflow business operation changed');
    function current(requireActive:boolean,unbound=false) {
      assertOwnedWorkflowHostScope({runtime,context,workflowId:resolution!.workflowId,nodeId:resolution!.nodeId,
        hostToolName:resolution!.hostToolName,proposalArguments:graph!.proposal?.arguments,hostArguments:host!.arguments,
        assertCurrent:options.assertCurrent,now});
      const original=runtime.readToolExecutions(context.taskId).find(record=>record.evidenceId===context.runId);
      const sourceTask=runtime.getTask(context.taskId);
      const sourceDescriptor=runtime.readToolDescriptors().find(tool=>tool.name===host!.toolName&&tool.version===host!.toolVersion);
      if(!original||!original.executionStarted||original.policyDecision!=='allow'||original.toolName!==host!.toolName
        ||original.toolVersion!==host!.toolVersion||!runtime.matchesToolExecutionInput(original,{arguments:sourceArguments,scopeRef:context.runId})
        ||!sourceDescriptor||sourceDescriptor.requiredScopes.some(scope=>!context.scopes.includes(scope))
        ||sourceTask.cancelRequested||!['running','succeeded'].includes(sourceTask.state)
        ||(!runtime.isToolExecutionActive(original)&&(original.state!=='confirmed'||requireActive&&intent.descriptor.sideEffect!=='read')))
        fail('RESULT_UNKNOWN','Original graph execution is not active or confirmed');
      if(!isDeepStrictEqual(runtime.readToolDescriptors().find(tool=>tool.name===intent.descriptor.name&&tool.version===intent.descriptor.version),intent.descriptor))
        fail('REVISION_CONFLICT','Original business tool descriptor changed');
      const latest=runtime.loadCheckpoint(context.taskId,key);
      if(!(unbound&&latest===undefined)&&!isDeepStrictEqual(latest,intent))fail('REVISION_CONFLICT','Original business intent changed');
    }
    function child() {
      const task=runtime.findTaskByIdempotencyKey('host-tool:'+JSON.stringify([intent.namespace,commandId]));
      if(!task)return undefined;
      const link=runtime.loadCheckpoint(task.taskId,'coding-repair:parent');
      const original=runtime.loadCheckpoint(context.taskId,'coding-repair:host:'+commandId);
      if(!isDeepStrictEqual(link,{taskId:context.taskId,operationId:commandId})
        ||!isDeepStrictEqual(original,{localTaskId:task.taskId,request:intent.request}))
        fail('REVISION_CONFLICT','Original business child lineage changed');
      return task;
    }
    return {intent,key,saved,current,child};
  }
  function observe(bound:ReturnType<typeof resolve>):WorkflowBusinessToolReadback {
    const task=bound.child();
    if(!task)return {state:'unbound'};
    const runId='host-tool-'+task.taskId;
    if(task.state==='created')return {state:'created',taskId:task.taskId,runId};
    const value=application.readHostToolTask(task.taskId),request=bound.intent.request;
    const host=runtime.loadCheckpoint(task.taskId,'host-tool-intent') as {arguments?:unknown;deadline?:string}|undefined;
    if(value.commandId!==request.commandId||value.toolName!==request.toolName||value.toolVersion!==request.toolVersion
      ||!isDeepStrictEqual(host?.arguments,request.arguments)||host?.deadline!==request.deadline)
      fail('REVISION_CONFLICT','Original business child input changed');
    const record=runtime.readToolExecutions(task.taskId).find(item=>item.evidenceId===runId);
    if(value.confirmed){
      bound.current(false);
      if(value.confirmed.runId!==runId||!value.confirmed.evidenceRefs.includes(runId))fail('UNAUTHORIZED','Original business Evidence is unavailable');
      validateToolValue(bound.intent.descriptor.outputSchema,value.confirmed.result);
      return {state:task.state,taskId:task.taskId,runId,confirmed:{taskId:task.taskId,runId,scopeRef:runId,
        toolName:request.toolName,toolVersion:request.toolVersion,arguments:structuredClone(request.arguments),
        evidenceRefs:[...value.confirmed.evidenceRefs],result:structuredClone(value.confirmed.result)}};
    }
    if(task.state==='waiting_reconciliation'||record?.executionStarted&&record.state!=='confirmed'
      &&!runtime.isToolExecutionActive(record)&&record.reconciliationOutcome!=='not_applied')
      return {state:'waiting_reconciliation',taskId:task.taskId,runId};
    return {state:task.state,taskId:task.taskId,runId};
  }
  function read(request:WorkflowBusinessToolRequest,context:ToolContext):WorkflowBusinessToolReadback {
    const bound=resolve(request,context);
    return bound.saved===undefined?{state:'unbound'}:observe(bound);
  }
  async function invoke(request:WorkflowBusinessToolRequest,context:ToolContext):Promise<WorkflowBusinessToolReceipt> {
    const bound=resolve(request,context);
    let childId:string|undefined;
    let release=()=>{};
    try {
      if(bound.saved===undefined){
        // The original active host is the only opportunity to prepare/dispatch.
        // A saved intent without its child is an interrupted operation, never a retry.
        bound.current(true,true);
        if(!runtime.saveCheckpointOnce(context.taskId,bound.key,bound.intent))fail('REVISION_CONFLICT','Business intent was already bound');
        bound.current(true);
        const prepared=application.prepareHostToolTask(bound.intent.request);childId=prepared.taskId;
        if(!runtime.saveCheckpointOnce(childId,'coding-repair:parent',{taskId:context.taskId,operationId:bound.intent.request.commandId})
          ||!runtime.saveCheckpointOnce(context.taskId,'coding-repair:host:'+bound.intent.request.commandId,
            {localTaskId:childId,request:bound.intent.request}))fail('REVISION_CONFLICT','Business child was already bound');
        const marker={sourceTaskId:context.taskId,sourceRunId:context.runId,commandId:bound.intent.request.commandId,
          intentDigest:toolArgumentsDigest(bound.intent)};
        if(!runtime.saveCheckpointOnce(childId,childSourceKey,marker))fail('REVISION_CONFLICT','Business child authority was already bound');
        const guards=activeChildren.get(application)??new Map<string,(invocation:Invocation)=>void>();
        activeChildren.set(application,guards);
        const expectedId=childId;
        const guard=(invocation:Invocation)=>{
          bound.current(true);bound.child();
          if(!isDeepStrictEqual(runtime.loadCheckpoint(expectedId,childSourceKey),marker)
            ||invocation.taskId!==expectedId||invocation.runId!=='host-tool-'+expectedId
            ||invocation.toolName!==bound.intent.request.toolName||invocation.toolVersion!==bound.intent.request.toolVersion
            ||invocation.deadline!==bound.intent.request.deadline||!isDeepStrictEqual(invocation.arguments,bound.intent.request.arguments))
            fail('UNAUTHORIZED','Original business invocation changed');
        };
        guards.set(childId,guard);release=()=>{if(guards.get(expectedId)===guard)guards.delete(expectedId);};
        bound.current(true);
        application.finalizeHostToolTask({taskId:childId,commandId:bound.intent.request.commandId,
          arguments:bound.intent.request.arguments,expectedTaskRevision:prepared.revision});
      }else childId=bound.child()?.taskId;
      for(;;){
        const state=observe(bound);
        if(state.confirmed)return state.confirmed;
        if(['unbound','created','waiting_reconciliation'].includes(state.state))fail('RESULT_UNKNOWN','Original business operation requires readback');
        if(state.state==='failed')fail('UNAUTHORIZED','Original business operation was refused or failed without confirmation');
        if(state.state==='cancelled')fail('CANCELLED','Original business operation was cancelled');
        bound.current(true);
        await new Promise<void>(resolve=>{
          const done=()=>{clearTimeout(timer);context.signal.removeEventListener('abort',done);resolve();};
          const timer=setTimeout(done,25);context.signal.addEventListener('abort',done,{once:true});
          if(context.signal.aborted)done();
        });
      }
    }catch(error){
      if(childId&&error instanceof ProtocolError&&['CANCELLED','TIMEOUT','UNAUTHORIZED','REVISION_CONFLICT'].includes(error.code))
        runtime.requestCancel(childId);
      throw error;
    }finally{release();}
  }
  return Object.freeze({invoke,read});
}
