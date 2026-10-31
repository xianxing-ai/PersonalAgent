import {isDeepStrictEqual} from 'node:util';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;

/**
 * Trusted Desktop ports for F09 worker. Image binding is merged by AgentArts composition.
 * F10 enqueue remains unavailable; worker must stop before claiming research completion.
 */
export function createF09WorkflowWorkerPorts({getApplication,feedsHost,now=Date.now}={}) {
  if(typeof getApplication!=='function'||!feedsHost
    ||typeof feedsHost.authorizeWorkflowFeedSourceExport!=='function'
    ||typeof feedsHost.assertWorkflowFeedAccess!=='function'
    ||typeof feedsHost.snapshot!=='function')
    throw Error('F09 worker ports require feeds host and Runtime application reader');

  const active=(scope)=>{
    if(!plain(scope)||!text(scope.taskId)||!(scope.signal instanceof AbortSignal)||scope.signal.aborted)
      throw Error('F09 worker scope unavailable');
    if(!Number.isFinite(Date.parse(scope.deadline))||now()>=Date.parse(scope.deadline))
      throw Error('F09 worker deadline expired');
    const application=getApplication();
    if(!application?.runtime)throw Error('F09 Runtime application unavailable');
    const task=application.runtime.getTask(scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      throw Error('F09 original task is no longer current');
    return application;
  };

  const sessionReady=()=>{
    const snap=feedsHost.snapshot();
    return snap?.sessionAllowed===true&&Array.isArray(snap.subscriptions)&&snap.subscriptions.length>0;
  };
  const subscription=(inputRef)=>{
    if(!text(inputRef)||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(inputRef))return;
    const snap=feedsHost.snapshot();
    if(snap?.sessionAllowed!==true)return;
    const item=snap.subscriptions?.find(value=>value.id===inputRef);
    return item?{subscriptionId:item.id}:undefined;
  };

  return {
    available(scope){
      try {active(scope);return sessionReady();}catch{return false;}
    },
    resolveInput(inputRef,scope){
      active(scope);
      return subscription(inputRef);
    },
    assertCurrent(scope){active(scope);},
    async authorizeInput(input){
      active(input);
      const value=subscription(input.inputRef);
      return !!value&&isDeepStrictEqual(value,input.value);
    },
    async authorizeSource(input){
      active(input);
      return feedsHost.authorizeWorkflowFeedSourceExport({
        parentTaskId:input.parentTaskId,sourceTaskId:input.sourceTaskId,sourceOperationId:input.sourceOperationId,
        result:input.result,signal:input.signal})===true;
    },
    async authorizeReceipt(input){
      active(input);
      if(input.proposal?.nodeId==='F09_N01'&&input.proposal.toolName==='feeds.collect'&&input.receipt?.state==='confirmed')
        return feedsHost.authorizeWorkflowFeedSourceExport({
          parentTaskId:input.taskId,sourceTaskId:input.localTaskId,sourceOperationId:input.proposal.operationId,
          result:input.receipt.result,signal:input.signal})===true;
      if(input.proposal?.nodeId==='F09_N02'&&input.proposal.toolName==='workflow.host.f09_n02'&&input.receipt?.state==='confirmed')
        return feedsHost.assertWorkflowFeedAccess({
          parentTaskId:input.taskId,sourceTaskId:input.localTaskId,
          sourceOperationId:input.proposal.arguments?.sourceOperationId,result:input.receipt.result,
          context:{taskId:input.localTaskId,signal:input.signal},signal:input.signal})===true;
      // Decision nodes stay local; export still requires a live authorized feed session.
      return sessionReady();
    },
    assertFrontier(input){
      active(input);
      return sessionReady()&&!!subscription(input.input?.subscriptionId??'');
    },
  };
}
