import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {notificationDigest,quietHoursActive} from '@personal-agent/notifications';

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

/** Binds a published feed item, not a model-authored notification or return event. */
export function createF12ConfiguredNotificationPorts({getApplication,notificationHost,now=Date.now}={}) {
  if(typeof getApplication!=='function'||['getDigest','deliverRound','getInterruptionPolicy','getLegacyPolicy','drain'].some(name=>typeof notificationHost?.[name]!=='function'))
    throw Error('F12 requires the original notification application host');
  const key='business-workflow:F12:source';
  const policyValue=policy=>({state:policy.state,scope:policy.scope,revision:policy.revision,effective:policy.effective,constraints:policy.constraints});
  const legacy=scope=>[...new Map([{kind:'global'},...('connectorId' in scope&&scope.connectorId?[{kind:'connector',connectorId:scope.connectorId}]:[]),scope]
    .map(item=>[notificationDigest(item),item])).values()].map(item=>notificationHost.getLegacyPolicy(item));
  const feed=itemId=>notificationHost.runtimeHost.notificationFeed().items.find(item=>item.id===itemId);
  const source=scope=>{
    const app=getApplication(),taskId=scope.parentTaskId??scope.taskId;
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F12 original feed scope expired');
    const saved=app.runtime.loadCheckpoint(taskId,key);
    const bound=app.readConfiguredWorkflowBinding({taskId,workflowId:'F12',sessionId:scope.sessionId,signal:scope.signal});
    if(!saved||!bound||bound.deadline!==scope.deadline||bound.input.itemId!==saved.entry.id||bound.input.trigger!==saved.trigger)
      fail('UNAUTHORIZED','F12 original feed binding unavailable');
    const current=feed(saved.entry.id),policy=policyValue(notificationHost.getInterruptionPolicy(saved.entry.scope));
    // Delivery timestamp is the sole expected change made by this graph. Read/withdraw/expiry still revoke it.
    const {deliveredAt:priorDelivery,...original}=saved.entry,{deliveredAt:currentDelivery,...entry}=current??{};
    if(!isDeepStrictEqual(entry,original)||!isDeepStrictEqual(policy,saved.policy)||!isDeepStrictEqual(legacy(saved.entry.scope),saved.legacy))
      fail('REVISION_CONFLICT','F12 original feed or policy changed');
    if(currentDelivery!==priorDelivery){
      const round=notificationHost.runtimeHost.getInterruptionRound(saved.roundId);
      if(!round||round.attempts.banner?.state!=='delivered'||!round.itemIds.includes(saved.entry.id)||!round.attempts.banner.evidenceRefs.length)
        fail('REVISION_CONFLICT','F12 delivery timestamp lacks original round evidence');
    }
    return {...saved,entry:current};
  };
  const action=saved=>{
    if(saved.trigger==='on_demand')return 'feed_only';
    const legacyBlocked=saved.legacy.some(({policy})=>policy&&(policy.pauseUntilUtc&&Date.parse(policy.pauseUntilUtc)>now()
      ||policy.quietHours&&quietHoursActive(policy.quietHours,now())));
    const blocked=legacyBlocked||saved.policy.constraints.some(({policy})=>(policy.mode==='silent'&&policy.silentUntilUtc===null
      ||policy.silentUntilUtc!==null&&Date.parse(policy.silentUntilUtc)>now()
      ||policy.quietHours!==null&&quietHoursActive(policy.quietHours,now()))&&!(saved.entry.urgent&&policy.allowUrgentBreakthrough));
    return blocked?'feed_only':'deliver';
  };
  const delivery=(scope,input)=>{
    const saved=source(scope);
    if(!isDeepStrictEqual(input,{roundId:saved.roundId,itemId:saved.entry.id,channel:'banner'})||action(saved)!=='deliver')
      fail('UNAUTHORIZED','F12 delivery differs from original feed and current policy');
    return saved;
  };
  const readRound=(scope,input)=>{
    const saved=delivery(scope,input),round=notificationHost.runtimeHost.getInterruptionRound(saved.roundId);
    if(!round||!isDeepStrictEqual(round.itemIds,[saved.entry.id])||!isDeepStrictEqual(round.scope,saved.entry.scope)
      ||round.expiresAt!==scope.deadline||!isDeepStrictEqual(round.channels,['banner'])
      ||round.policyRevisionDigest!==notificationDigest(saved.policy.constraints))fail('RESULT_UNKNOWN','F12 original round binding unavailable');
    return round;
  };
  return {
    prepareInput(input,scope){
      const app=getApplication(),entry=feed(input.itemId);
      if(!entry||entry.validity!=='active'||!entry.unread)fail('UNAUTHORIZED','F12 requires an original active unread feed item');
      const policy=policyValue(notificationHost.getInterruptionPolicy(entry.scope));
      if(policy.state!=='configured'||!policy.effective)fail('UNSUPPORTED_CAPABILITY','F12 current notification policy unavailable');
      if(input.trigger==='event'&&policy.effective.preferredChannel==='voice')fail('UNSUPPORTED_CAPABILITY','F12 original voice channel unavailable');
      const value={entry,policy,legacy:legacy(entry.scope),trigger:input.trigger,roundId:'workflow-f12-'+notificationDigest(scope.taskId)};
      const prior=app.runtime.loadCheckpoint(scope.taskId,key);
      if(prior&&!isDeepStrictEqual(prior,value))fail('REVISION_CONFLICT','F12 input already bound to another feed snapshot');
      app.runtime.saveCheckpointOnce(scope.taskId,key,value);
    },
    source,action:scope=>action(source(scope)),
    policy(scope){const saved=source(scope);return {...structuredClone(saved.policy.effective),roundId:saved.roundId,itemId:saved.entry.id};},
    deliveryInput(scope){const saved=source(scope);return {roundId:saved.roundId,itemId:saved.entry.id,channel:'banner'};},
    async verifyDeliveryBinding(scope,input){delivery(scope,input);return true;},
    notificationHost:{getInterruptionRound:roundId=>notificationHost.runtimeHost.getInterruptionRound(roundId)},
    async resolveDeliveryReceipt(scope,input){
      const saved=delivery(scope,input),host=notificationHost.runtimeHost;
      let round=host.getInterruptionRound(saved.roundId);
      if(!round){
        // This mutation runs only inside the approved external-write host. It uses the original queue and CAS budget.
        const batch=notificationHost.drain().batches.find(item=>item.itemRefs.length===1&&item.itemRefs[0]===saved.entry.id);
        if(!batch)fail('UNSUPPORTED_CAPABILITY','F12 original single-item ready batch unavailable');
        delivery(scope,input);
        round=host.reserveInterruption({roundId:saved.roundId,batchIds:[batch.id],scope:saved.entry.scope,channels:['banner'],
          expiresAt:scope.deadline,urgent:saved.entry.urgent});
      }
      readRound(scope,input);
      if(round.reason==='original_round_requires_readback_or_is_terminal')fail('RESULT_UNKNOWN','F12 original notification round requires independent readback');
      if(round.state==='suppressed'&&!round.counted&&!round.attempts.banner)return {state:'suppressed',evidenceRefs:[]};
      await notificationHost.deliverRound({roundId:saved.roundId,channel:'banner',title:'PersonalAgent 通知',
        body:'来源 '+saved.entry.source+' 有一条更新，请查看通知列表。',source:saved.entry.source});
      round=readRound(scope,input);const attempt=round.attempts.banner;
      if(!attempt){if(round.state==='suppressed'&&!round.counted)return {state:'suppressed',evidenceRefs:[]};
        fail('RESULT_UNKNOWN','F12 original device attempt unavailable');}
      if(attempt.state==='sending')fail('RESULT_UNKNOWN','F12 original device attempt is unresolved');
      return {state:attempt.state,evidenceRefs:structuredClone(attempt.evidenceRefs)};
    },
    verifyDeliveryResult(scope,result){
      const saved=source(scope),round=readRound(scope,{roundId:saved.roundId,itemId:saved.entry.id,channel:'banner'}),attempt=round.attempts.banner;
      if(result.roundId!==round.roundId||typeof result.delivered!=='boolean'
        ||(result.delivered?!(attempt?.state==='delivered'&&attempt.evidenceRefs.length)
          :!(attempt?.state==='failed'||round.state==='suppressed'&&!round.counted&&!attempt)))
        fail('RESULT_UNKNOWN','F12 delivery result lacks original durable outcome');
      return result;
    },
    digest(scope){
      const saved=source(scope);
      // The explicit read has its own Policy approval. No on_return event or read acknowledgement is inferred.
      const item=notificationHost.getDigest({trigger:'on_demand',scope:saved.entry.scope}).items.find(item=>item.id===saved.entry.id);
      if(!item||item.validity!=='active'||!item.unread)fail('REVISION_CONFLICT','F12 original change is no longer in the active unread digest');
      source(scope);return {itemId:item.id,unread:item.unread,validity:item.validity,source:item.source,contentRef:item.contentRef,
        ...(item.deliveredAt?{deliveredAt:item.deliveredAt}:{}),interruptionCount:0};
    },
  };
}
