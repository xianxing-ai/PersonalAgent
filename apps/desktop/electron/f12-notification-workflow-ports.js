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
export function createF12ConfiguredNotificationPorts({getApplication,notificationHost,explicitReturnSource,now=Date.now}={}) {
  if(typeof getApplication!=='function'||['getDigest','deliverRound','getInterruptionPolicy','getLegacyPolicy','drain'].some(name=>typeof notificationHost?.[name]!=='function'))
    throw Error('F12 requires the original notification application host');
  const key='business-workflow:F12:source';
  const selection=input=>input.itemIds?{itemIds:[...input.itemIds]}:{itemId:input.itemId};
  const ids=input=>input.itemIds??[input.itemId];
  const sameIds=(left,right)=>isDeepStrictEqual([...left].sort(),[...right].sort());
  const policyValue=policy=>({state:policy.state,scope:policy.scope,revision:policy.revision,effective:policy.effective,constraints:policy.constraints});
  const selectedChannel=saved=>saved.policy.effective.preferredChannel==='voice'?'voice':'banner';
  const legacy=scope=>[...new Map([{kind:'global'},...('connectorId' in scope&&scope.connectorId?[{kind:'connector',connectorId:scope.connectorId}]:[]),scope]
    .map(item=>[notificationDigest(item),item])).values()].map(item=>notificationHost.getLegacyPolicy(item));
  const feed=itemId=>notificationHost.runtimeHost.notificationFeed().items.find(item=>item.id===itemId);
  const source=scope=>{
    const app=getApplication(),taskId=scope.parentTaskId??scope.taskId;
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F12 original feed scope expired');
    const saved=app.runtime.loadCheckpoint(taskId,key);
    const bound=app.readConfiguredWorkflowBinding({taskId,workflowId:'F12',sessionId:scope.sessionId,signal:scope.signal});
    if(!saved||!bound||bound.deadline!==scope.deadline||!isDeepStrictEqual(selection(bound.input),saved.selection)||bound.input.trigger!==saved.trigger)
      fail('UNAUTHORIZED','F12 original feed binding unavailable');
    if(saved.trigger==='on_return'&&(!isDeepStrictEqual(bound.input.returnSource,saved.returnProof?.source)
      ||!isDeepStrictEqual(explicitReturnSource?.read(bound.input.returnSource,scope),saved.returnProof)))
      fail('UNAUTHORIZED','F12 original explicit return source changed');
    const entries=saved.entries.map(original=>feed(original.id)),policy=policyValue(notificationHost.getInterruptionPolicy(saved.scope));
    if(!isDeepStrictEqual(policy,saved.policy)||!isDeepStrictEqual(legacy(saved.scope),saved.legacy))fail('REVISION_CONFLICT','F12 original policy changed');
    for(let index=0;index<entries.length;index++){
      // Delivery timestamp is the sole expected change made by this graph. Every original item remains bound.
      const {deliveredAt:priorDelivery,...original}=saved.entries[index],{deliveredAt:currentDelivery,...entry}=entries[index]??{};
      if(!isDeepStrictEqual(entry,original))fail('REVISION_CONFLICT','F12 original feed changed');
      if(currentDelivery!==priorDelivery){
        const round=notificationHost.runtimeHost.getInterruptionRound(saved.roundId);
        if(!round||round.attempts[selectedChannel(saved)]?.state!=='delivered'||!sameIds(round.itemIds,ids(saved.selection))||!round.attempts[selectedChannel(saved)].evidenceRefs.length)
          fail('REVISION_CONFLICT','F12 delivery timestamp lacks original round evidence');
      }
    }
    return {...saved,entries};
  };
  const action=saved=>{
    if(saved.trigger==='on_demand'||saved.trigger==='on_return')return 'feed_only';
    const legacyBlocked=saved.legacy.some(({policy})=>policy&&(policy.pauseUntilUtc&&Date.parse(policy.pauseUntilUtc)>now()
      ||policy.quietHours&&quietHoursActive(policy.quietHours,now())));
    const blocked=legacyBlocked||saved.policy.constraints.some(({policy})=>(policy.mode==='silent'&&policy.silentUntilUtc===null
      ||policy.silentUntilUtc!==null&&Date.parse(policy.silentUntilUtc)>now()
      ||policy.quietHours!==null&&quietHoursActive(policy.quietHours,now()))&&!(saved.entries.every(entry=>entry.urgent)&&policy.allowUrgentBreakthrough));
    return blocked?'feed_only':'deliver';
  };
  const delivery=(scope,input)=>{
    const saved=source(scope);
    if(!isDeepStrictEqual(input,{roundId:saved.roundId,...saved.selection,channel:selectedChannel(saved)})||action(saved)!=='deliver')
      fail('UNAUTHORIZED','F12 delivery differs from original feed and current policy');
    return saved;
  };
  const readRound=(scope,input)=>{
    const saved=delivery(scope,input),round=notificationHost.runtimeHost.getInterruptionRound(saved.roundId);
    if(!round||!sameIds(round.itemIds,ids(saved.selection))||!isDeepStrictEqual(round.scope,saved.scope)
      ||round.expiresAt!==scope.deadline||!isDeepStrictEqual(round.channels,[selectedChannel(saved)])
      ||round.policyRevisionDigest!==notificationDigest(saved.policy.constraints))fail('RESULT_UNKNOWN','F12 original round binding unavailable');
    return round;
  };
  return {
    prepareInput(input,scope){
      const app=getApplication(),chosen=selection(input),itemIds=ids(chosen),entries=itemIds.map(feed);
      if(!itemIds.length||new Set(itemIds).size!==itemIds.length||entries.some(entry=>!entry||entry.validity!=='active'||!entry.unread))
        fail('UNAUTHORIZED','F12 requires explicit unique original active unread feed items');
      const entryScope=entries[0].scope;
      if(entries.some(entry=>!isDeepStrictEqual(entry.scope,entryScope)))fail('UNAUTHORIZED','F12 one round requires the same original notification scope');
      const policy=policyValue(notificationHost.getInterruptionPolicy(entryScope));
      if(policy.state!=='configured'||!policy.effective)fail('UNSUPPORTED_CAPABILITY','F12 current notification policy unavailable');
      if(input.trigger==='event'&&policy.effective.preferredChannel==='voice'
        &&notificationHost.hasVoicePort?.(app.readToolConversation(scope.taskId)??app.runtime.getTask(scope.taskId).conversationId)!==true)
        fail('UNSUPPORTED_CAPABILITY','F12 original voice channel unavailable');
      let returnProof;
      if(input.trigger==='on_return'){
        if(typeof explicitReturnSource?.read!=='function')fail('UNSUPPORTED_CAPABILITY','F12 explicit user return source unavailable');
        returnProof=explicitReturnSource.read(input.returnSource,scope);
        const digest=notificationHost.getDigest({trigger:'on_return',scope:entryScope});
        if(itemIds.some(id=>!digest.items.some(item=>item.id===id)))fail('UNAUTHORIZED','F12 selected items are not in the original return digest');
      }
      const value={entries,selection:chosen,scope:entryScope,policy,legacy:legacy(entryScope),trigger:input.trigger,roundId:'workflow-f12-'+notificationDigest(scope.taskId),
        ...(returnProof?{returnProof}: {})};
      const prior=app.runtime.loadCheckpoint(scope.taskId,key);
      if(prior&&!isDeepStrictEqual(prior,value))fail('REVISION_CONFLICT','F12 input already bound to another feed snapshot');
      app.runtime.saveCheckpointOnce(scope.taskId,key,value);
    },
    source,action:scope=>action(source(scope)),selection:scope=>structuredClone(source(scope).selection),
    policy(scope){const saved=source(scope);return {...structuredClone(saved.policy.effective),roundId:saved.roundId,...saved.selection};},
    deliveryInput(scope){const saved=source(scope);return {roundId:saved.roundId,...saved.selection,channel:selectedChannel(saved)};},
    async verifyDeliveryBinding(scope,input){delivery(scope,input);return true;},
    notificationHost:{getInterruptionRound:roundId=>notificationHost.runtimeHost.getInterruptionRound(roundId)},
    async resolveDeliveryReceipt(scope,input,context){
      const saved=delivery(scope,input),host=notificationHost.runtimeHost,channel=selectedChannel(saved);
      let round=host.getInterruptionRound(saved.roundId);
      if(!round){
        // This mutation runs only inside the approved external-write host. It uses the original queue and CAS budget.
        const itemIds=ids(saved.selection),batches=notificationHost.drain().batches.filter(batch=>batch.itemRefs.every(id=>itemIds.includes(id)));
        if(!batches.length||!sameIds(batches.flatMap(batch=>batch.itemRefs),itemIds))
          fail('UNSUPPORTED_CAPABILITY','F12 complete original ready batches do not match the explicit item selection');
        delivery(scope,input);
        round=host.reserveInterruption({roundId:saved.roundId,batchIds:batches.map(batch=>batch.id),scope:saved.scope,channels:[channel],
          expiresAt:scope.deadline,urgent:saved.entries.every(entry=>entry.urgent)});
      }
      readRound(scope,input);
      if(round.reason==='original_round_requires_readback_or_is_terminal')fail('RESULT_UNKNOWN','F12 original notification round requires independent readback');
      if(round.state==='suppressed'&&!round.counted&&!round.attempts[channel])return {state:'suppressed',evidenceRefs:[]};
      await notificationHost.deliverRound({roundId:saved.roundId,channel,title:'PersonalAgent 通知',
        body:saved.entries.length===1?'来源 '+saved.entries[0].source+' 有一条更新，请查看通知列表。'
          :'有 '+saved.entries.length+' 条更新，请查看通知列表。',source:saved.entries.length===1?saved.entries[0].source:'notifications',
        ...(channel==='voice'?{authority:{context,assertCurrent:()=>{delivery(scope,input);}}}: {})});
      // Electron show is asynchronous. Only observe the original durable round;
      // a pending/unknown native attempt never calls deliverRound a second time.
      const waitUntil=Math.min(Date.parse(scope.deadline),now()+5000);
      for(;;){
        notificationHost.reconcileDelivery?.(saved.roundId);
        round=readRound(scope,input);
        const voice=channel==='voice'?notificationHost.readVoiceDelivery({roundId:saved.roundId,taskId:context.taskId}):undefined;
        if(voice&&['renderer_completed','unknown'].includes(voice.state)||!['sending','unknown'].includes(round.attempts[channel]?.state)||now()>=waitUntil)break;
        await new Promise(resolve=>{
          const done=()=>{clearTimeout(timer);scope.signal.removeEventListener('abort',done);resolve();};
          const timer=setTimeout(done,Math.min(25,waitUntil-now()));
          scope.signal.addEventListener('abort',done,{once:true});if(scope.signal.aborted)done();
        });
      }
      const attempt=round.attempts[channel];
      if(!attempt){if(round.state==='suppressed'&&!round.counted)return {state:'suppressed',evidenceRefs:[]};
        fail('RESULT_UNKNOWN','F12 original device attempt unavailable');}
      if(attempt.state==='sending')fail('RESULT_UNKNOWN','F12 original device attempt is unresolved');
      return {state:attempt.state,evidenceRefs:structuredClone(attempt.evidenceRefs)};
    },
    verifyDeliveryResult(scope,result){
      const saved=source(scope),channel=selectedChannel(saved),round=readRound(scope,{roundId:saved.roundId,...saved.selection,channel}),attempt=round.attempts[channel];
      if(result.roundId!==round.roundId||typeof result.delivered!=='boolean'
        ||(result.delivered?!(attempt?.state==='delivered'&&attempt.evidenceRefs.length)
          :!(attempt?.state==='failed'||round.state==='suppressed'&&!round.counted&&!attempt)))
        fail('RESULT_UNKNOWN','F12 delivery result lacks original durable outcome');
      return result;
    },
    digest(scope){
      const saved=source(scope);
      // The explicit read has its own Policy approval. Return needs its original UI control marker; neither path acknowledges read.
      const current=notificationHost.getDigest({trigger:saved.trigger==='on_return'?'on_return':'on_demand',scope:saved.scope}),items=ids(saved.selection).map(id=>current.items.find(item=>item.id===id));
      if(items.some(item=>!item||item.validity!=='active'||!item.unread))fail('REVISION_CONFLICT','F12 original changes are no longer in the active unread digest');
      source(scope);const projected=items.map(item=>({itemId:item.id,unread:item.unread,validity:item.validity,source:item.source,contentRef:item.contentRef,
        ...(item.deliveredAt?{deliveredAt:item.deliveredAt}:{})}));
      return saved.selection.itemId?{...projected[0],interruptionCount:0}:{items:projected,interruptionCount:0};
    },
  };
}
