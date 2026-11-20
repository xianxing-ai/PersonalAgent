import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {ToolExecutionRecord} from '../index.js';

type Scope={parentTaskId:string;localTaskId:string;sessionId:string;operationId:string;deadline:string;signal:AbortSignal};
export interface F24OriginalEffectBinding {taskId:string;runId:string;toolName:string;toolVersion:string;inputDigest:string;readbackEvidenceId:string}
export interface F24ReconciliationResult {state:'applied'|'not_applied';taskId:string;taskRevision:number;runId:string;evidenceRefs:string[]}
export interface F24ReconciliationHostOptions {
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  hostUserNamespace:string;
  /** Fixed by trusted composition, never selected by the model. */
  driverCheckpointKey:string;
  requiredScopes:readonly string[];
  now:()=>Date;
  /** Recheck the actual original graph grant and its selected frontier synchronously. */
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  /** Resolve the user's independently authorized business task and original run, not the graph task. */
  resolveOriginalEffect:(scope:Scope)=>Promise<F24OriginalEffectBinding|undefined>;
  /** Verify that these actual verified observations prove this precise original outcome. */
  verifyReadback:(input:{scope:Scope;binding:F24OriginalEffectBinding;record:ToolExecutionRecord;
    observations:ReturnType<RuntimeApplication['runtime']['readEvidence']>})=>Promise<boolean>;
  /** Permission to export this exact minimal result to the original graph destination. */
  authorizeExport:(scope:Scope,result:F24ReconciliationResult)=>Promise<boolean>;
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=512;
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
function validBinding(value:unknown):value is F24OriginalEffectBinding {
  return plain(value)&&Object.keys(value).sort().join(',')==='inputDigest,readbackEvidenceId,runId,taskId,toolName,toolVersion'
    &&text(value.taskId)&&text(value.runId)&&text(value.toolName)&&text(value.toolVersion)&&sha(value.inputDigest)&&text(value.readbackEvidenceId);
}

/** Read-only observation of an already reconciled original effect. No new task,
 * retry, cancellation, reconciliation, or assertion of task completion. */
export function createRuntimeF24ReconciliationHost(options?:F24ReconciliationHostOptions):{tools:RegisteredTool[];
  authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  return createOriginalReconciliationHost('F24',options);
}

/** Internal fixed workflow selection; the graph/model cannot choose this binding. */
export function createOriginalReconciliationHost(workflowId:'F24'|'F03',options?:F24ReconciliationHostOptions):{tools:RegisteredTool[];
  authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  const nodeId=workflowId==='F24'?'F24_N09':'F03_N07',toolName=workflowId==='F24'?'workflow.host.f24_n09':'workflow.host.f03_n07';
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||!text(options.driverCheckpointKey)||!text(options.hostUserNamespace)
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text)
    ||typeof options.now!=='function'||typeof options.assertCurrent!=='function'||typeof options.resolveOriginalEffect!=='function'
    ||typeof options.verifyReadback!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],unavailable:workflowId.toLowerCase()+'_original_reconciliation_ports_unavailable'};
  const {application}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,phase:'execution'|'receipt'='execution'):Scope=>{
    if(!(context.signal instanceof AbortSignal)||context.signal.aborted)fail('CANCELLED',`Original ${workflowId} request cancelled`);
    let now:Date;
    try {now=options.now();}catch {return fail('UNSUPPORTED_CAPABILITY',`${workflowId} trusted clock unavailable`);}
    if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
      ||Date.parse(context.deadline)<=now.getTime())fail('TIMEOUT',`Original ${workflowId} request expired`);
    if(!context.authorizationRef||context.authorizationRef!==context.runId||context.argumentsDigest!==toolArgumentsDigest({})
      ||!requiredScopes.every(scope=>context.scopes.includes(scope)))fail('SCOPE_DENIED',`${workflowId} original scope required`);
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!text(parent?.taskId)||!text(parent.operationId)||context.runId!=='host-tool-'+context.taskId)
      fail('UNAUTHORIZED',`Original ${workflowId} host binding unavailable`);
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;taskDeadline?:string;proposal?:Record<string,unknown>}|undefined;
    const child=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as
      {commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown;argumentsDigest?:string;deadline?:string;namespace?:string}|undefined;
    const issued=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId) as
      {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown;deadline?:string}}|undefined;
    const graph=runtime.loadCheckpoint(parent.taskId,options.driverCheckpointKey) as
      {sessionId?:string;controlRevision?:number;result?:{state?:string;proposals?:unknown[];nodes?:Record<string,{state?:string}>}}|undefined;
    const binding=runtime.loadCheckpoint(parent.taskId,options.driverCheckpointKey+':driver-binding') as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string}|undefined;
    const task=runtime.getTask(parent.taskId),hostTask=runtime.getTask(context.taskId),proposal=intent?.proposal;
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state)||intent?.taskId!==parent.taskId
      ||intent.workflowId!==workflowId||!text(intent.sessionId)||intent.deadline!==context.deadline||intent.taskDeadline!==context.deadline
      ||hostTask.cancelRequested||hostTask.conversationId!=='host-tool:'+options.hostUserNamespace
      ||phase==='execution'&&hostTask.state!=='running'||phase==='receipt'&&hostTask.state!=='succeeded'
      ||!proposal||proposal.kind!=='tool_proposal'||proposal.nodeId!==nodeId||proposal.toolName!==toolName||proposal.toolVersion!=='1.0.0'
      ||proposal.operationId!==parent.operationId||!isDeepStrictEqual(proposal.arguments,{})
      ||child?.commandId!==parent.operationId||child.toolName!==toolName||child.toolVersion!=='1.0.0'
      ||child.namespace!==options.hostUserNamespace||child.argumentsDigest!==toolArgumentsDigest({})
      ||child.deadline!==context.deadline||!isDeepStrictEqual(child.arguments,{})
      ||issued?.localTaskId!==context.taskId||issued.request?.commandId!==parent.operationId
      ||issued.request.toolName!==child.toolName||issued.request.toolVersion!==child.toolVersion
      ||issued.request.deadline!==context.deadline||!isDeepStrictEqual(issued.request.arguments,{})
      ||binding?.taskId!==parent.taskId||binding.workflowId!==workflowId||binding.sessionId!==intent.sessionId
      ||binding.deadline!==context.deadline||graph?.sessionId!==intent.sessionId||graph.controlRevision!==proposal.originControlRevision
      ||graph.result?.state!=='awaiting_host'||graph.result.nodes?.[nodeId]?.state!=='waiting_receipt'
      ||!Array.isArray(graph.result.proposals)||!graph.result.proposals.some(item=>isDeepStrictEqual(item,proposal)))
      fail('UNAUTHORIZED',`Original ${workflowId} current frontier unavailable`);
    const execution=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
    const grant=runtime.policy.get(context.authorizationRef);
    if(!execution||execution.taskId!==context.taskId||execution.toolName!==child.toolName||execution.toolVersion!==child.toolVersion
      ||execution.policyDecision!=='allow'||!execution.executionStarted
      ||!runtime.matchesToolExecutionInput(execution,{arguments:{},scopeRef:context.authorizationRef})
      ||phase==='execution'&&(execution.state!=='started'||!runtime.isToolExecutionActive(execution))
      ||phase==='receipt'&&execution.state!=='confirmed'
      ||!grant||grant.taskId!==context.taskId||grant.toolName!==child.toolName||grant.argumentsDigest!==toolArgumentsDigest({})
      ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now.getTime()
      ||!requiredScopes.every(scope=>grant.scopes.includes(scope)))
      fail('UNAUTHORIZED',`Original ${workflowId} tool execution authorization unavailable`);
    const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,sessionId:intent.sessionId,
      operationId:parent.operationId,deadline:context.deadline,signal:context.signal};
    try {
      const result:unknown=options.assertCurrent(scope,context);
      if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);fail('UNAUTHORIZED',`${workflowId} current gate must be synchronous`);}
    } catch {fail('UNAUTHORIZED',`Original ${workflowId} authorization unavailable`);}
    return scope;
  };
  const safely=async<T>(context:ToolContext,phase:'execution'|'receipt',work:()=>Promise<T>):Promise<T>=>{
    try{return await work();}catch{active(context,phase);return fail('UNSUPPORTED_CAPABILITY',`${workflowId} trusted readback unavailable`);}
  };
  const observe=async(scope:Scope,context:ToolContext,phase:'execution'|'receipt'):Promise<F24ReconciliationResult>=>{
    const supplied=await safely(context,phase,()=>options.resolveOriginalEffect(scope));active(context,phase);
    if(!validBinding(supplied)||supplied.taskId===scope.parentTaskId||supplied.taskId===scope.localTaskId)
      fail('UNSUPPORTED_CAPABILITY','Original business operation binding unavailable');
    const binding=structuredClone(supplied);
    const current=()=>{
      let task:ReturnType<typeof runtime.getTask>,records:ReturnType<typeof runtime.readToolExecutions>,evidence:ReturnType<typeof runtime.readEvidence>;
      try {task=runtime.getTask(binding.taskId);records=runtime.readToolExecutions(binding.taskId);evidence=runtime.readEvidence(binding.taskId);}
      catch {return fail('UNSUPPORTED_CAPABILITY','Original business execution unavailable');}
      const record=records.find(value=>value.evidenceId===binding.runId);
      if(!record||record.taskId!==binding.taskId||record.toolName!==binding.toolName||record.toolVersion!==binding.toolVersion
        ||record.inputDigest!==binding.inputDigest||record.policyDecision!=='allow'||!record.executionStarted)
        fail('UNSUPPORTED_CAPABILITY','Original authorized business execution unavailable');
      if(!['applied','not_applied'].includes(String(record.reconciliationOutcome)))
        fail('RESULT_UNKNOWN','Original effect requires independent readback');
      if(record.reconciliationOutcome==='applied'&&record.state!=='confirmed'
        ||record.reconciliationOutcome==='not_applied'&&record.state!=='failed')
        fail('REVISION_CONFLICT','Original reconciliation record is inconsistent');
      const observations=evidence.filter(value=>value.evidenceId===binding.readbackEvidenceId
        &&value.kind==='observation'&&value.verification==='verified'&&task.evidenceRefs.includes(value.evidenceId));
      if(observations.length!==1)fail('RESULT_UNKNOWN','Original effect lacks verified readback');
      return {task,record,observations};
    };
    const before=structuredClone(current());
    const verified=await safely(context,phase,()=>options.verifyReadback({scope,binding:structuredClone(binding),
      record:structuredClone(before.record),observations:structuredClone(before.observations)}));active(context,phase);
    if(verified!==true)fail('UNSUPPORTED_CAPABILITY','Original readback could not be verified');
    const again=await safely(context,phase,()=>options.resolveOriginalEffect(scope));active(context,phase);
    if(!isDeepStrictEqual(binding,again)||!isDeepStrictEqual(before,current()))fail('REVISION_CONFLICT','Original business effect changed');
    return {state:before.record.reconciliationOutcome as 'applied'|'not_applied',taskId:binding.taskId,taskRevision:before.task.revision,runId:binding.runId,
      evidenceRefs:before.observations.map(value=>value.evidenceId)};
  };
  const tool=createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['state','taskId','taskRevision','runId','evidenceRefs'],properties:{
      state:{type:'string',enum:['applied','not_applied']},taskId:{type:'string'},taskRevision:{type:'integer',minimum:0},runId:{type:'string'},
      evidenceRefs:{type:'array',items:{type:'string'}}}},
    async execute(_input,context){const scope=active(context);return observe(scope,context,'execution');}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context,'receipt'),saved=application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!==toolName||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))fail('UNAUTHORIZED',`Original ${workflowId} readback receipt unavailable`);
    const before=await observe(scope,context,'receipt');
    if(!isDeepStrictEqual(before,result))fail('REVISION_CONFLICT','Original effect changed before export');
    if(await safely(context,'receipt',()=>options.authorizeExport(scope,structuredClone(before)))!==true)
      fail('UNAUTHORIZED',`${workflowId} exact readback export denied`);
    active(context,'receipt');
    if(!isDeepStrictEqual(before,await observe(scope,context,'receipt')))fail('REVISION_CONFLICT','Original effect changed during export');
  }};
}
