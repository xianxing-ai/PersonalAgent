import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Reuses the existing device port, which persists beginDelivery before calling the OS.
 * The model selects no title/body or recipient: these come from the bound workflow input. */
export function createF12NotificationWorkflowPorts({getApplication,notificationHost,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof notificationHost?.deliverRound!=='function'
    ||typeof authorizeExport!=='function')
    throw Error('F12 requires original Runtime binding and durable device delivery host');
  const binding=scope=>{
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F12 operation is no longer active');
    const bound=getApplication().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F12',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F12 original workflow binding unavailable');
    return bound;
  };
  const original=(scope,input)=>{
    const bound=binding(scope),plan=bound.input;
    if(!isDeepStrictEqual(input,{roundId:plan.roundId,itemId:plan.itemId,channel:plan.channel}))
      fail('UNAUTHORIZED','F12 delivery differs from the original plan');
    const round=notificationHost.runtimeHost.getInterruptionRound(plan.roundId);
    if(!round?.counted||!round.itemIds.includes(plan.itemId)||!round.channels.includes(plan.channel)
      ||round.policyRevisionDigest!==plan.policyRevisionDigest||Date.parse(round.expiresAt)<=now())
      fail('REVISION_CONFLICT','F12 original notification round changed or expired');
    return {plan,round};
  };
  return {
    notificationHost:{getInterruptionRound:roundId=>notificationHost.runtimeHost.getInterruptionRound(roundId)},
    assertCurrent:scope=>{binding(scope);},
    async verifyDeliveryBinding(scope,input){original(scope,input);return true;},
    async resolveDeliveryReceipt(scope,input){
      const {plan}=original(scope,input);
      await notificationHost.deliverRound({roundId:plan.roundId,channel:plan.channel,title:plan.title,body:plan.body,source:plan.source});
      const {round}=original(scope,input),attempt=round.attempts[plan.channel];
      if(!attempt||attempt.state==='sending')fail('RESULT_UNKNOWN','F12 original device receipt unavailable');
      if(attempt.state==='delivered'&&!attempt.evidenceRefs.length)fail('RESULT_UNKNOWN','F12 device delivery lacks evidence');
      return {state:attempt.state,evidenceRefs:structuredClone(attempt.evidenceRefs)};
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
