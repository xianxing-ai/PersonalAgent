import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {replayFrozenWorkflowTrace, workflowTraceDigest} from '@personal-agent/agentarts/trace-replay';

export const WORKFLOW_SHADOW_PREVIEW = 'workflow.shadow_preview';
const VERSION = '1.0.0';
const SCOPE = 'workflow:shadow_preview';
const inputSchema = {type:'object',additionalProperties:false,required:['toolName','toolVersion','arguments'],properties:{
  toolName:{type:'string',minLength:1,maxLength:128,description:'Name of the intended tool from the current task catalog.'},
  toolVersion:{type:'string',minLength:1,maxLength:64},
  arguments:{type:'object',description:'Exact arguments for the intended operation.'},
}};
const outputSchema = {type:'object',additionalProperties:false,
  required:['state','actualToolCalls','actualModelCalls','authorizationGranted','actionExecuted'],properties:{
    state:{enum:['ready','skipped']},reason:{enum:['disabled','invalid_action','trace_unavailable']},
    action:{type:'object',additionalProperties:false,required:['toolName','toolVersion','effect','argumentCount','comparability'],properties:{
      toolName:{type:'string'},toolVersion:{type:'string'},effect:{enum:['read','local_write','external_write']},
      argumentCount:{type:'integer',minimum:0},comparability:{const:'counterfactual_unknown'},
    }},
    matchedHistoricalReads:{type:'integer',minimum:0},historicalWrites:{type:'integer',minimum:0},
    actualToolCalls:{const:0},actualModelCalls:{const:0},authorizationGranted:{const:false},actionExecuted:{const:false},
  }};
const advisory = {actualToolCalls:0,actualModelCalls:0,authorizationGranted:false,actionExecuted:false};
const skipped = reason => ({state:'skipped',reason,...advisory});

function action(name, version, args, actionId, sourceVersions) {
  return {actionId,toolName:name,toolVersion:version,arguments:args,argumentsDigest:workflowTraceDigest(args),sourceVersions};
}

/** Freeze the confirmed prefix of the original task. Preview calls themselves are never part of that prefix. */
function freezeTrace(runtime, task, describeTool) {
  const {taskId,revision} = task;
  const asOf = new Date().toISOString();
  const sourceVersions = {taskRuntimeRevision:String(revision)};
  const executions = new Map(runtime.readToolExecutions(taskId).map(record => [record.evidenceId,record]));
  const receipts = runtime.loadCheckpoint(taskId,'competition-loop')?.receipts ?? [];
  const records = [], requestedActions = [];
  for(const {proposal,runId,continuation,workerSelection} of receipts) {
    if(proposal.toolName===WORKFLOW_SHADOW_PREVIEW) continue;
    if(proposal.verification==='mock'||workerSelection!==undefined||continuation?.proposalId!==proposal.proposalId) break;
    const descriptor = describeTool(proposal.toolName,proposal.toolVersion);
    const execution = executions.get(runId);
    if(!descriptor||!execution?.executionStarted||execution.policyDecision!=='allow'||execution.state!=='confirmed'
      ||!execution.finishedAt||execution.toolName!==proposal.toolName||execution.toolVersion!==proposal.toolVersion
      ||!runtime.matchesToolExecutionInput(execution,{arguments:proposal.arguments,scopeRef:runId})) break;
    const persisted = runtime.loadCheckpoint(taskId,'tool-result-'+runId);
    if(!persisted||!Object.hasOwn(persisted,'result')) break;
    const step = action(proposal.toolName,proposal.toolVersion,proposal.arguments,'history-'+records.length,sourceVersions);
    const {actionId,...invocation} = step;
    records.push({...invocation,recordId:runId,kind:'tool',observedAt:execution.finishedAt,
      effect:descriptor.sideEffect==='read'?'read':'write',state:'confirmed',result:persisted.result,
      resultDigest:workflowTraceDigest(persisted.result),evidenceRefs:[runId]});
    requestedActions.push(step);
  }
  return {snapshot:{asOf,sourceVersions,records},requestedActions};
}

/** One advisory tool in the original model loop. It never invokes the proposed action. */
export function createWorkflowShadowPreview({getApplication,enabled,ownsTask,describeTool}) {
  const catalog = (runtime,taskId) => runtime.loadCheckpoint(taskId,'competition-tool-catalog')?.entries ?? [];
  const published = (runtime,taskId) => catalog(runtime,taskId)
    .some(({name,version})=>name===WORKFLOW_SHADOW_PREVIEW&&version===VERSION);
  const bound = ({taskId,signal})=>!signal?.aborted&&ownsTask(taskId);
  const descriptor = {name:WORKFLOW_SHADOW_PREVIEW,version:VERSION,inputSchema,outputSchema,
    sideEffect:'read',requiredScopes:[SCOPE],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
  const tool = {descriptor,execute:async (input,context)=>{
    const {taskId,signal} = context;
    if(!bound(context)||!context.authorizationRef||!context.scopes?.includes(SCOPE))
      throw new ProtocolError('UNAUTHORIZED','Original shadow preview scope is unavailable');
    if(!enabled()) return skipped('disabled');
    const application = getApplication();
    if(application.isHistoryWithheld(taskId)) return skipped('trace_unavailable');
    const {runtime} = application;
    const originalPool = runtime.loadCheckpoint(taskId,'competition-tool-discovery-pool:v1')?.entries ?? [];
    const candidate = describeTool(input.toolName,input.toolVersion);
    if(!candidate||candidate.name===WORKFLOW_SHADOW_PREVIEW||![...catalog(runtime,taskId),...originalPool]
      .some(({name,version})=>name===candidate.name&&version===candidate.version)) return skipped('invalid_action');
    try {validateToolValue(candidate.inputSchema,input.arguments);}
    catch {return skipped('invalid_action');}
    try {
      const trace = freezeTrace(runtime,runtime.getTask(taskId),describeTool);
      trace.requestedActions.push(action(candidate.name,candidate.version,input.arguments,'proposed',trace.snapshot.sourceVersions));
      const replay = replayFrozenWorkflowTrace(trace,{signal,deadline:context.deadline});
      return {state:'ready',...advisory,actualToolCalls:replay.actualToolCalls,actualModelCalls:replay.actualModelCalls,
        action:{toolName:candidate.name,toolVersion:candidate.version,effect:candidate.sideEffect,
          argumentCount:Object.keys(input.arguments).length,comparability:replay.actions.at(-1).comparability},
        matchedHistoricalReads:replay.actions.filter(step=>step.state==='reused_historical_read').length,
        historicalWrites:replay.timeline.filter(({record})=>record.effect==='write').length};
    } catch(error) {
      if(signal.aborted) throw error;
      return skipped('trace_unavailable');
    }
  }};
  return {tool,availability:{toolName:WORKFLOW_SHADOW_PREVIEW,toolVersion:VERSION,
    publicDescription:'Optional read-only shadow preview. Use it when preview materially reduces uncertainty about an important action. It does not invoke the proposed tool, call another model or grant permission. If skipped, continue the user’s work.',
    available:scope=>bound(scope)&&(enabled()||published(getApplication().runtime,scope.taskId))},
  exportBinding:{toolName:WORKFLOW_SHADOW_PREVIEW,toolVersion:VERSION,exportPolicyVersion:'task-shadow-preview-metadata-v1',
    accepts:bound,
    project({result}) {validateToolValue(outputSchema,result);return result;}}};
}
