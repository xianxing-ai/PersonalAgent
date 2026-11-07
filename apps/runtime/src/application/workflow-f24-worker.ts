import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createF24KnowledgeReconciliationPorts} from './workflow-f24-knowledge-ports.js';
import {assertF24OriginalTask,bindF24OriginalTask,type F24OriginalTask,type F24RecoveryScope} from './workflow-f24-original-task.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type ExportRequest=Parameters<Worker['authorizeExport']>[0]&{workflowId:'F24'};
export interface F24RecoveryWorkflowOptions {
  application:RuntimeApplication;hostUserNamespace:string;
  /** Live trusted source configuration; changes invalidate the original graph. */
  sourceConfiguration:()=>{sourceId:string;configRevision:number}|undefined;
  authorizeExport:(request:ExportRequest)=>Promise<boolean>;
}
export interface RuntimeF24RecoveryPort {
  readAvailable:(scope:F24RecoveryScope)=>boolean;
  reconcileOriginalReadback:(scope:F24RecoveryScope)=>Promise<{state:'unknown'|'confirmed';localTaskId:string}>;
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
const configurationKey='f24:source-configuration';
const workflowId='F24';
const resultSchema=object({state:{enum:['applied','not_applied']},sourceTaskId:text,sourceRunId:text,
  taskRevision:{type:'integer',minimum:0},evidenceRefs:{type:'array',minItems:1,items:text}});
const statusProperties={sourceTaskId:text,sourceRunId:text,taskRevision:{type:'integer',minimum:0},state:{enum:['unknown','applied','not_applied']},
  taskState:text,cancelRequested:{type:'boolean'},executionStarted:{type:'boolean'},active:{type:'boolean'}};

/** Bounded recovery consumer of the existing Runtime/Knowledge writer. It
 * observes an already issued operation; it cannot submit or compensate a write. */
export function createF24RecoveryWorkflowPorts(options?:F24RecoveryWorkflowOptions):{
  tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null;
  reconcileOriginalReadback?:(scope:F24RecoveryScope)=>Promise<{state:'unknown'|'confirmed';localTaskId:string}>;
  recovery?:RuntimeF24RecoveryPort;
} {
  if(!options?.application||!options.hostUserNamespace||typeof options.sourceConfiguration!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f24_original_knowledge_recovery_unavailable'};
  const {application:app,hostUserNamespace:namespace}=options;
  function current(scope:F24RecoveryScope):void {
    if(scope.signal.aborted)fail('CANCELLED','Original F24 recovery cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original F24 recovery expired');
    const parent=app.readDelegatedUserTaskParent(scope.taskId),task=app.runtime.getTask(scope.taskId);
    if(!parent||parent.deadline!==scope.deadline||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      fail('UNAUTHORIZED','Original F24 user request unavailable');
    const config=options!.sourceConfiguration(),saved=app.runtime.loadCheckpoint(scope.taskId,configurationKey);
    if(!config||!config.sourceId||!Number.isSafeInteger(config.configRevision)||config.configRevision<1)
      fail('UNSUPPORTED_CAPABILITY','F24 knowledge source unavailable');
    if(saved!==undefined&&!isDeepStrictEqual(saved,config))fail('REVISION_CONFLICT','F24 knowledge source changed');
  }
  const owner=(scope:OwnedWorkflowHostScope):F24RecoveryScope=>({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
  const original=(scope:F24RecoveryScope)=>{current(scope);const input=assertF24OriginalTask(app,namespace,scope),config=options.sourceConfiguration();
    if(input.sourceId!==config?.sourceId||input.configRevision!==config.configRevision)fail('REVISION_CONFLICT','Original knowledge source version changed');
    return input;};
  function binding(scope:OwnedWorkflowHostScope) {
    const input=original(owner(scope));
    const graph=app.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId,sessionId:scope.sessionId,signal:scope.signal});
    if(!graph||graph.deadline!==scope.deadline||!isDeepStrictEqual(graph.input,input))fail('UNAUTHORIZED','Original F24 configured graph unavailable');
    return {input,graph};
  }
  function status(input:F24OriginalTask) {
    const task=app.runtime.getTask(input.sourceTaskId),record=app.runtime.readToolExecutions(input.sourceTaskId).find(item=>item.evidenceId===input.sourceRunId)!;
    return {sourceTaskId:input.sourceTaskId,sourceRunId:input.sourceRunId,taskRevision:task.revision,
      state:record.reconciliationOutcome??'unknown',taskState:task.state,cancelRequested:task.cancelRequested===true,
      executionStarted:record.executionStarted,active:app.runtime.isToolExecutionActive(record)};
  }
  const selected=(nodeId:string,observed:ReturnType<typeof status>)=>nodeId==='F24_N06'?observed.cancelRequested:nodeId==='F24_N07'?false:
    nodeId==='F24_N08'?observed.cancelRequested&&observed.state==='unknown':nodeId==='F24_N09'||nodeId==='F24_N11'?true:
    nodeId==='F24_N10'?observed.state==='applied':false;
  const knowledge=(scope:OwnedWorkflowHostScope,input:F24OriginalTask)=>createF24KnowledgeReconciliationPorts({runtime:app.runtime,namespace,
    target:{taskId:input.sourceTaskId,runId:input.sourceRunId},isOriginalTarget:async()=>isDeepStrictEqual(binding(scope).input,input)});
  async function verified(scope:OwnedWorkflowHostScope) {
    const {input}=binding(scope),ports=knowledge(scope,input),source=await ports.resolveOriginalEffect?.(scope);binding(scope);
    if(!source)fail('RESULT_UNKNOWN','Original knowledge effect still needs readback');
    const record=app.runtime.readToolExecutions(source.taskId).find(item=>item.evidenceId===source.runId)!;
    const observations=app.runtime.readEvidence(source.taskId).filter(item=>item.evidenceId===source.readbackEvidenceId);
    if(await ports.verifyReadback?.({scope,binding:source,record,observations})!==true)fail('RESULT_UNKNOWN','Original knowledge readback changed');
    binding(scope);
    return {state:record.reconciliationOutcome as 'applied'|'not_applied',sourceTaskId:source.taskId,sourceRunId:source.runId,
      taskRevision:app.runtime.getTask(source.taskId).revision,evidenceRefs:[source.readbackEvidenceId]};
  }
  const template=getOwnedWorkflowTemplate(workflowId)!;
  const tools:RegisteredTool[]=[];
  for(const node of template.nodes) {
    if(node.kind!=='host')continue;
    for(const kind of (node.condition?['guard','host']:['host']) as ('guard'|'host')[]) {
      const toolName='workflow.'+kind+'.'+node.id.toLowerCase();
      const inputSchema=kind==='host'?object({}):object({workflowId:{const:workflowId},nodeId:{const:node.id},
        input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}});
      const tool=createOwnedWorkflowAdapter({nodeId:node.id,kind,sideEffect:kind==='guard'||node.effect!=='write'?'read':'local_write',
        requiredScopes:['workflow:recovery'],inputSchema,outputSchema:['F24_N09','F24_N10','F24_N12'].includes(node.id)?resultSchema:
          object({...statusProperties,...(node.id==='F24_N01'?{sessionId:text,configurationDigest:text,persisted:{const:true}}:{})}),
        async execute(args,context){
          const scope=assertOwnedWorkflowHostScope({runtime:app.runtime,context,workflowId,nodeId:node.id,hostToolName:toolName,
            proposalArguments:args,hostArguments:args,assertCurrent:scope=>{binding(scope);}});
          // An intent alone must never permit direct invocation outside ToolGateway.
          const run=app.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
          const grant=app.runtime.policy.get(context.authorizationRef!);
          if(context.authorizationRef!==context.runId||!run||run.state!=='started'||run.policyDecision!=='allow'||!run.executionStarted
            ||!app.runtime.isToolExecutionActive(run)||run.toolName!==toolName||run.toolVersion!=='1.0.0'
            ||!app.runtime.matchesToolExecutionInput(run,{arguments:args as Record<string,unknown>,scopeRef:context.runId})
            ||!grant||grant.taskId!==context.taskId||grant.toolName!==toolName||grant.argumentsDigest!==toolArgumentsDigest(args)
            ||Date.parse(grant.expiresAt)<=Date.now()||!grant.scopes.includes('workflow:recovery'))
            fail('UNAUTHORIZED','Original F24 tool execution unavailable');
          const {input,graph}=binding(scope),observed=status(input);
          if(kind==='guard') {
            if(!isDeepStrictEqual((args as {input?:unknown}).input,input))fail('UNAUTHORIZED','F24 guard input changed');
            return {state:selected(node.id,observed)?'selected':'skipped'};
          }
          if(node.id==='F24_N09') {
            if(observed.state==='unknown')await app.reconcileKnowledgeWriteTask(input.sourceTaskId,{deadline:scope.deadline,signal:scope.signal});
            return verified(scope);
          }
          if(node.id==='F24_N10'||node.id==='F24_N12') {
            const result=await verified(scope);
            if(node.id==='F24_N10'&&result.state!=='applied')fail('REVISION_CONFLICT','Original effect was not applied');
            return result;
          }
          if(node.id==='F24_N07')fail('UNSUPPORTED_CAPABILITY','A previously started write cannot be reported as never submitted');
          if(node.id==='F24_N06'&&!observed.cancelRequested||node.id==='F24_N08'&&(!observed.cancelRequested||observed.state!=='unknown'))
            fail('REVISION_CONFLICT','No original in-flight cancellation to observe');
          if(node.id==='F24_N01')return {...observed,sessionId:graph.sessionId,configurationDigest:graph.configurationDigest,persisted:true};
          // N03/N04 reuse the original authorized execution; N05/N11 expose its
          // actual checkpoint. No resume, new grant, writer, or cancellation here.
          return observed;
        }});
      tools.push(tool);
    }
  }
  const byName=new Map(tools.map(tool=>[tool.descriptor.name,tool]));
  function assertExportCurrent(request:Parameters<Worker['authorizeExport']>[0]):void {
    const input=original(request),observed=status(input);
    if(request.stage==='initial'){if(!isDeepStrictEqual(request.value,input))fail('UNAUTHORIZED','F24 initial export changed');return;}
    let result=request.value as Record<string,unknown>;
    if(request.stage==='receipt') {
      if(!request.localTaskId||!request.proposal)fail('UNAUTHORIZED','F24 receipt export lacks original operation');
      const read=app.readHostToolTask(request.localTaskId);
      if(read.task.state!=='succeeded'||read.commandId!==request.proposal.operationId||read.toolName!==request.proposal.toolName
        ||!read.confirmed||!isDeepStrictEqual((request.value as {result?:unknown}).result,read.confirmed.result))
        fail('UNAUTHORIZED','F24 original receipt export changed');
      result=read.confirmed.result as Record<string,unknown>;
      if(request.proposal.toolName.startsWith('workflow.guard.')) {
        if(result.state!==(selected(request.proposal.nodeId,observed)?'selected':'skipped'))fail('REVISION_CONFLICT','F24 local condition changed during export');
        return;
      }
    }
    if(!result||result.sourceTaskId!==input.sourceTaskId||result.sourceRunId!==input.sourceRunId
      ||result.taskRevision!==observed.taskRevision||result.state!==observed.state)
      fail('REVISION_CONFLICT','F24 original effect changed during export');
  }
  const worker:Worker={workflowId,toolName:'workflow.recovery.knowledge',toolVersion:'1.0.0',configurationVersion:'f24-original-knowledge-v1',
    requestSchema:object({sourceTaskId:text}),inputSchema:object({sourceTaskId:text,sourceRunId:text,conversationId:text,sourceDeadline:text,
      sourceId:text,configRevision:{type:'integer',minimum:1},
      toolName:{const:'knowledge.apply_note_patch'},toolVersion:{const:'1.0.0'},inputDigest:text,argumentsDigest:text}),resultSchema,
    publicEnumPaths:[],sideEffect:'local_write',requiredTools:tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
    available(scope){try{current(scope);return true;}catch{return false;}},assertCurrent:current,
    async resolveInput(args,scope){
      current(scope);const input=bindF24OriginalTask(app,namespace,scope,args.sourceTaskId as string),config=options.sourceConfiguration();
      if(!config)fail('UNSUPPORTED_CAPABILITY','F24 source configuration unavailable');
      const saved=app.runtime.loadCheckpoint(scope.taskId,configurationKey);
      if(saved===undefined&&!app.runtime.saveCheckpointOnce(scope.taskId,configurationKey,config))fail('REVISION_CONFLICT','F24 source concurrently changed');
      original(scope);return input;
    },
    assertFrontier(input){
      const target=original(input),proposal=input.proposal,tool=byName.get(proposal.toolName);
      if(!isDeepStrictEqual(input.input,target)||!tool||proposal.toolVersion!==tool.descriptor.version
        ||!proposal.toolName.endsWith('.'+proposal.nodeId.toLowerCase()))return false;
      return proposal.toolName.startsWith('workflow.guard.')?isDeepStrictEqual((proposal.arguments as {input?:unknown}).input,target)
        &&proposal.arguments.workflowId===workflowId&&proposal.arguments.nodeId===proposal.nodeId:isDeepStrictEqual(proposal.arguments,{});
    },
    async authorizeExport(request){
      assertExportCurrent(request);const allowed=await options.authorizeExport({...request,workflowId});assertExportCurrent(request);return allowed===true;
    },
    async verifyCompletion(request){
      const input=original(request);
      const operations=Object.values(request.state.confirmedOperations??{});
      const confirmed=(nodeId:string)=>operations.find(op=>op.nodeId===nodeId&&op.toolName==='workflow.host.'+nodeId.toLowerCase()
        &&request.readbacks.some(read=>read.task.taskId===op.localTaskId&&read.task.state==='succeeded'
          &&read.confirmed?.evidenceRefs.includes(read.confirmed.runId)&&isDeepStrictEqual(read.confirmed.result,op.result)));
      for(const nodeId of ['F24_N01','F24_N03','F24_N04','F24_N05','F24_N09','F24_N11','F24_N12'])
        if(!confirmed(nodeId))fail('UNAUTHORIZED','F24 required original receipts unavailable');
      const last=confirmed('F24_N12')!,scope={parentTaskId:request.taskId,localTaskId:last.localTaskId,operationId:last.operationId,
        sessionId:request.state.sessionId,deadline:request.deadline,signal:request.signal};
      const result=await verified(scope);
      if(result.sourceTaskId!==input.sourceTaskId||!isDeepStrictEqual(result,last.result))fail('REVISION_CONFLICT','F24 final original readback changed');
      return {result,resultSummary:'Original knowledge operation independently read back; no write was replayed'};
    }};
  const recoveries=new Map<string,Promise<{state:'unknown'|'confirmed';localTaskId:string}>>();
  function recoveryBinding(scope:F24RecoveryScope) {
    const input=original(scope),pending=app.readPendingOwnedWorkflowHostTask(scope.taskId);
    if(!pending)fail('UNSUPPORTED_CAPABILITY','Original F24 pending readback unavailable');
    const localTaskId=pending.taskId,runId='host-tool-'+localTaskId;
    const parent=app.runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const intent=app.runtime.loadCheckpoint(localTaskId,'host-tool-intent') as {toolName?:string;toolVersion?:string;arguments?:unknown;deadline?:string}|undefined;
    const originalIntent=app.runtime.loadCheckpoint(scope.taskId,'owned-workflow:intent:'+parent?.operationId) as {sessionId?:string;workflowId?:string}|undefined;
    if(parent?.taskId!==scope.taskId||!parent.operationId||intent?.toolName!=='workflow.host.f24_n09'||intent.toolVersion!=='1.0.0'
      ||!isDeepStrictEqual(intent.arguments,{})||intent.deadline!==scope.deadline||originalIntent?.workflowId!==workflowId||!originalIntent.sessionId)
      fail('UNAUTHORIZED','Original F24 recovery host binding changed');
    const hostScope={parentTaskId:scope.taskId,localTaskId,operationId:parent.operationId,sessionId:originalIntent.sessionId,
      deadline:scope.deadline,signal:scope.signal};binding(hostScope);
    const read=app.readHostToolTask(localTaskId),record=app.runtime.readToolExecutions(localTaskId).find(item=>item.evidenceId===runId);
    if(!record||record.toolName!==intent.toolName||record.toolVersion!==intent.toolVersion||record.policyDecision!=='allow'||!record.executionStarted
      ||!app.runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:runId}))fail('UNAUTHORIZED','Original F24 recovery execution changed');
    return {input,localTaskId,runId,hostScope,read,record};
  }
  async function reconcile(scope:F24RecoveryScope):Promise<{state:'unknown'|'confirmed';localTaskId:string}> {
    const {input,localTaskId,runId,hostScope,read,record}=recoveryBinding(scope);
    if(read.task.state==='succeeded'&&record.state==='confirmed') {
      if(!isDeepStrictEqual(read.confirmed?.result,await verified(hostScope)))fail('REVISION_CONFLICT','Original F24 recovery result changed');
      return {state:'confirmed',localTaskId};
    }
    if(read.task.state!=='waiting_reconciliation'||record.state!=='unknown'||app.runtime.isToolExecutionActive(record))
      fail('RESULT_UNKNOWN','Original F24 host has not stopped');
    await app.reconcileKnowledgeWriteTask(input.sourceTaskId,{deadline:scope.deadline,signal:scope.signal});binding(hostScope);
    let result;
    try {result=await verified(hostScope);}catch(error){
      if((error as {code?:string}).code==='RESULT_UNKNOWN')return {state:'unknown',localTaskId};throw error;
    }
    if(!isDeepStrictEqual(record,app.runtime.readToolExecutions(localTaskId).find(item=>item.evidenceId===runId)))
      fail('REVISION_CONFLICT','Original F24 recovery host changed during readback');
    const evidenceId='f24-readback-'+createHash('sha256').update(JSON.stringify([localTaskId,runId,result])).digest('hex');
    app.runtime.saveCheckpoint(localTaskId,'trusted-readback-evidence:'+evidenceId,{evidenceId,kind:'observation',
      sourceRef:'runtime:f24-original-knowledge-readback',capturedAt:new Date().toISOString(),
      summary:'Original F24 read-only host resolved from its bound verified knowledge readback',verification:'verified',sensitivity:'internal'});
    binding(hostScope);app.runtime.reconcileToolExecution(localTaskId,runId,'applied',result,[evidenceId]);
    return {state:'confirmed',localTaskId};
  }
  const recovery:RuntimeF24RecoveryPort={readAvailable(scope){
    try{const {read,record}=recoveryBinding(scope);return read.task.state==='succeeded'&&record.state==='confirmed'
      ||read.task.state==='waiting_reconciliation'&&record.state==='unknown'&&!app.runtime.isToolExecutionActive(record);}catch{return false;}
  },reconcileOriginalReadback(scope){
    // Duplicate requests share the original readback only; no graph/tool replay.
    original(scope);const active=recoveries.get(scope.taskId);if(active)return active;
    const work=reconcile(scope).finally(()=>recoveries.delete(scope.taskId));recoveries.set(scope.taskId,work);return work;
  }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null,recovery,reconcileOriginalReadback:recovery.reconcileOriginalReadback};
}
