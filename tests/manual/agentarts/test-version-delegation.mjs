import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeSubagentDispatchTool} from '@personal-agent/runtime/application';
import {decisionDigest} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const actions=['continue','summary','notify_controller','request_controller'];
const descriptor=(name,properties={},required=[])=>({name,version:'1.0.0',inputSchema:{type:'object',properties,required,additionalProperties:false},
  outputSchema:{type:'object'},requiredScopes:['agent:delegate'],sideEffect:'read',idempotencySupport:true,recoverySupport:true,requiresPresence:false});
const live=context=>{context.signal.throwIfAborted();if(Date.parse(context.deadline)<=Date.now())fail('TIMEOUT','Delegation deadline expired');};
/** Test-host tools only. Existing dispatch owns child execution and runAgent loop.
 * observe is a trusted, task-scoped read-only port, never a child-selected path.
 * Register these tools in the existing ToolGateway/Policy; advice grants no scope.
 */
export function createTestVersionDelegationTools({getRuntime,adaptive,controller,getTools,observe=async()=>({}),dispatchOptions={}}) {
  if(!getRuntime||!adaptive?.decide||!controller?.complete||!getTools)throw TypeError('Runtime, adaptive selector, controller ModelGateway and tool port required');
  function binding(childId,parentId) {
    const runtime=getRuntime();
    const bound=runtime.loadCheckpoint(childId,'subtask-parent');
    if(!bound?.parentTaskId||!bound.subtaskId||parentId&&bound.parentTaskId!==parentId)fail('UNAUTHORIZED','Task is not a bound child of this caller');
    const child=runtime.getTask(childId);
    if(child.conversationId!==`desktop-subtask:${bound.parentTaskId}`
      ||runtime.findTaskByIdempotencyKey(`subagent-dispatch-${bound.parentTaskId}-${bound.subtaskId}`)?.taskId!==childId)
      fail('UNAUTHORIZED','Persisted child identity mismatch');
    return bound;
  }
  const taskVersion=task=>({taskId:task.taskId,state:task.state,revision:task.revision,cancelRequested:task.cancelRequested??false});
  function assertOpen(childId) {
    const runtime=getRuntime(),bound=binding(childId),parent=runtime.getTask(bound.parentTaskId),child=runtime.getTask(childId);
    if([parent,child].some(task=>task.cancelRequested||['cancelling','cancelled'].includes(task.state))
      ||['succeeded','failed'].includes(parent.state))fail('REVISION_CONFLICT','Parent or child no longer accepts new reports');
  }
  function assertCurrent(state) {
    const runtime=getRuntime();assertOpen(state.child.taskId);
    if(decisionDigest(taskVersion(runtime.getTask(state.child.taskId)))!==decisionDigest(state.child)
      ||decisionDigest(taskVersion(runtime.getTask(state.parent.taskId)))!==decisionDigest(state.parent))
      fail('REVISION_CONFLICT','Task state changed; obtain fresh evidence with a new report request');
  }
  function notificationReadback(value) {
    try {return getRuntime().readEvents().some(event=>event.type==='task.progress'&&event.taskId===value.parentTaskId&&event.payload.stepId===value.notification.stepId)?'published':'not_published';}
    catch {return 'unknown';}
  }
  async function snapshot(context) {
    const runtime=getRuntime();
    live(context);const bound=binding(context.taskId);
    const child=runtime.getTask(context.taskId),parent=runtime.getTask(bound.parentTaskId);
    const summarize=id=>runtime.readEvidence(id).map(({evidenceId,kind,sourceRef,capturedAt,summary,verification})=>({evidenceId,kind,sourceRef,capturedAt,summary,verification}));
    const value={version:1,child:taskVersion(child),parent:taskVersion(parent),
      evidence:{child:summarize(child.taskId),parent:summarize(parent.taskId)},observation:await observe({taskId:context.taskId,parentTaskId:bound.parentTaskId,signal:context.signal,deadline:context.deadline})};
    live(context);
    if(decisionDigest(taskVersion(runtime.getTask(child.taskId)))!==decisionDigest(value.child)
      ||decisionDigest(taskVersion(runtime.getTask(parent.taskId)))!==decisionDigest(value.parent))
      fail('REVISION_CONFLICT','Task changed while observing; obtain fresh evidence');
    return {...value,stateVersion:decisionDigest(value)};
  }
  const read={descriptor:descriptor('delegation.read_state'),execute:async(input,context)=>{
    if(Object.keys(input).length)fail('INVALID_ARGUMENT','State reader accepts no task identifiers');return snapshot(context);
  }};
  const report={descriptor:descriptor('delegation.report_state',{problem:{type:'string'},candidates:{type:'array',items:{type:'string'}},nextSteps:{type:'array',items:{type:'string'}}},['problem','candidates','nextSteps']),
    execute:async(input,context)=>{
      const runtime=getRuntime();
      live(context);const bound=binding(context.taskId),key='delegation:report:'+context.runId,digest=decisionDigest(input);
      if(Object.keys(input).sort().join(',')!=='candidates,nextSteps,problem'||typeof input.problem!=='string'||!input.problem.trim()
        ||![input.candidates,input.nextSteps].every(items=>Array.isArray(items)&&items.every(item=>typeof item==='string'&&item.trim())))
        fail('INVALID_ARGUMENT','Problem, candidates and next steps are required');
      const prior=runtime.loadCheckpoint(context.taskId,key);
      if(prior){
        if(prior.inputDigest!==digest)fail('REVISION_CONFLICT','Report run changed');
        if(['pending','unknown'].includes(prior.notification?.state)) {
          prior.notification={...prior.notification,state:notificationReadback(prior),recovery:'durable event readback only; no automatic resend or model replay'};
          runtime.saveCheckpoint(context.taskId,key,prior);
          if(runtime.loadCheckpoint(bound.parentTaskId,'delegation:child:'+bound.subtaskId)?.reportId===prior.reportId)
            runtime.saveCheckpoint(bound.parentTaskId,'delegation:child:'+bound.subtaskId,prior);
        }
        return prior;
      }
      assertOpen(context.taskId);
      if(!runtime.saveCheckpointOnce(context.taskId,key+':intent',{inputDigest:digest}))fail('RESULT_UNKNOWN','Reconcile original report request');
      const state=await snapshot(context);
      const decision=await adaptive.decide({requestId:'delegation-'+context.taskId+'-'+context.runId,site:'delegation.child-report.v1',criteriaVersion:'delegation-v1',
        criteria:'Choose continue for an executable next step, summary for completed findings, notify_controller for material observed changes, or request_controller when a concrete blocker needs controller advice. Never grant permission or stop unrelated work.',
        context:JSON.stringify({state,childReport:input}),candidates:actions.map(id=>({id,description:id.replaceAll('_',' ')})),
        sources:[{sourceId:context.taskId,revision:state.stateVersion,sha256:state.stateVersion}],signal:context.signal,deadline:context.deadline});
      if(!actions.includes(decision.selectedId))fail('INVALID_ARGUMENT','Unknown delegation action');
      assertCurrent(state);
      let controllerAdvice;
      if(decision.selectedId==='request_controller') {
        const frozen=runtime.loadCheckpoint(context.taskId,'subtask-tools-binding');
        if(!Array.isArray(frozen))fail('UNSUPPORTED_CAPABILITY','Original child tool binding is unavailable');
        const current=getTools().list();
        if(frozen.some(tool=>!current.some(item=>item.name===tool.name&&item.version===tool.version&&decisionDigest(item)===decisionDigest(tool))))
          fail('UNSUPPORTED_CAPABILITY','Bound child tool registration changed');
        const response=await controller.complete({tools:[],signal:context.signal,deadline:context.deadline,messages:[
          {role:'system',content:'You are the task controller, not the human user. Give advisory handling instructions for this round only. No authorization, scope grants or fabricated user decisions. Return JSON {"advice":"...","nextTool":null or an available tool name}. Tool execution remains behind the original Policy; unavailable capabilities require configuration by the host.'},
          {role:'user',content:JSON.stringify({state,childReport:input,availableTools:frozen.map(tool=>({name:tool.name,version:tool.version}))})}]});
        assertCurrent(state);
        try {controllerAdvice=JSON.parse(response.response.text);}catch {fail('INVALID_ARGUMENT','Controller advice is not JSON');}
        if(Object.keys(controllerAdvice??{}).sort().join(',')!=='advice,nextTool'||typeof controllerAdvice.advice!=='string'||!controllerAdvice.advice.trim()
          ||controllerAdvice.nextTool!==null&&!frozen.some(tool=>tool.name===controllerAdvice.nextTool))
          fail('UNSUPPORTED_CAPABILITY','Controller requested an unregistered tool or malformed advice');
      }
      live(context);assertCurrent(state);
      const notify=['notify_controller','request_controller'].includes(decision.selectedId);
      const value={version:1,inputDigest:digest,reportId:context.runId,childTaskId:context.taskId,parentTaskId:bound.parentTaskId,
        state,childReport:structuredClone(input),action:decision.selectedId,decided_by:decision.decided_by,decision,
        ...(controllerAdvice?{controllerAdvice,controllerActor:'model_controller',userDecision:null,executionRequiresOriginalPolicy:true}:{}),
        notification:notify?{state:'pending',stepId:'delegation-'+context.taskId+'-'+context.runId}:{state:'not_requested'},trainingPerformed:false};
      if(!runtime.saveCheckpointOnce(context.taskId,key,value))fail('REVISION_CONFLICT','Report already recorded');
      runtime.saveCheckpoint(bound.parentTaskId,'delegation:child:'+bound.subtaskId,value);
      if(notify) {
        try {
          runtime.recordProgress(bound.parentTaskId,{stepId:value.notification.stepId,label:'delegation report '+context.runId+' action '+value.action});
          value.notification={...value.notification,state:'published'};
        } catch {
          // No automatic resend: the synchronous event call may have committed before a host failure.
          value.notification={...value.notification,state:notificationReadback(value),recovery:'read durable task.progress by stepId; do not replay model/controller request'};
        }
        runtime.saveCheckpoint(context.taskId,key,value);
        runtime.saveCheckpoint(bound.parentTaskId,'delegation:child:'+bound.subtaskId,value);
      }
      return value;
    }};
  const parentRead={descriptor:descriptor('delegation.read_report',{subtaskId:{type:'string'}},['subtaskId']),execute:async(input,context)=>{
    const runtime=getRuntime();
    live(context);if(Object.keys(input).join(',')!=='subtaskId'||typeof input.subtaskId!=='string')fail('INVALID_ARGUMENT','Only a subtaskId is accepted');
    const child=runtime.findTaskByIdempotencyKey(`subagent-dispatch-${context.taskId}-${input.subtaskId}`);
    if(!child)fail('UNAUTHORIZED','Child is not bound to this parent');binding(child.taskId,context.taskId);
    return {version:1,childTask:runtime.getTask(child.taskId),report:runtime.loadCheckpoint(context.taskId,'delegation:child:'+input.subtaskId)??null};
  }};
  const dispatch=createRuntimeSubagentDispatchTool({...dispatchOptions,getRuntime,getTools});
  return {dispatch,childTools:[read,report],parentTools:[dispatch,parentRead]};
}
