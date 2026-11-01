import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createNotificationSettingsDescriptor, notificationDigest as digest} from '@personal-agent/notifications';
import {validateToolValue} from '@personal-agent/contracts';

const SETTINGS_SCOPES = ['notifications:settings'];
const COMMAND_BINDING = 'desktop-notification-user-command';

/** Desktop composition over the original Runtime host, ToolGateway and OS receipt port.
 * No renderer send endpoint, second queue, permission store or task executor lives here.
 */
export function createDesktopNotificationApplicationHost({namespace, channel, question,getVoiceHost,now = Date.now, onUpdate = () => {}}) {
  if (typeof namespace !== 'string' || !namespace || !channel
    || typeof channel.sendAdvisoryNotification !== 'function' || typeof channel.readDeliveryOutcome !== 'function') {
    throw Error('通知应用宿主缺少用户或真实回执端口');
  }
  let application, client, host, disposed = false;
  const commands = new Map(), deliveries = new Map(), operations = new Map();
  let savedLegacyPolicy;
  const legacyScope={kind:'connector',connectorId:'productivity'};
  const descriptor = createNotificationSettingsDescriptor(SETTINGS_SCOPES);
  const publish = () => {try {onUpdate();} catch {}};
  const current = () => {
    if (disposed || !host || !application) throw Error('通知 Runtime 宿主尚未连接');
    return host;
  };
  const validCommand = (command, context) => {
    const original = commands.get(context.taskId);
    return Boolean(original && !disposed && command.proof === original.command.proof
      && command.argumentsDigest === digest(original.command.settings)
      && digest(command.settings) === command.argumentsDigest
      && now() < Date.parse(original.command.expiresAt) && original.isCurrent());
  };
  const settingsTool = {descriptor, async execute(input, context) {
    if(question)question.currentRequirement(context,'notifications-settings');
    return current().settingsTool.execute(input, context);
  }};
  const channelId = roundId => 'notification-round-' + digest(roundId);
  const voiceKey=roundId=>'desktop-notification:voice:'+digest(roundId);
  function voiceScope(roundId,authority) {
    const context=authority?.context,runtime=application?.runtime;
    if(!context||!(context.signal instanceof AbortSignal)||context.signal.aborted||disposed||!runtime
      ||context.runId!=='host-tool-'+context.taskId||context.authorizationRef!==context.runId
      ||typeof authority.assertCurrent!=='function'||!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=now())
      throw Error('原语音通知执行许可不可用');
    const task=runtime.getTask(context.taskId),intent=runtime.loadCheckpoint(context.taskId,'host-tool-intent');
    const record=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
    const grant=runtime.policy.get(context.authorizationRef);
    if(task.state!=='running'||task.cancelRequested||intent?.toolName!=='workflow.host.f12_n04'||intent.deadline!==context.deadline
      ||intent.arguments.roundId!==roundId||intent.arguments.channel!=='voice'||!grant||grant.taskId!==context.taskId
      ||grant.toolName!==intent.toolName||Date.parse(grant.expiresAt)<=now()||!grant.scopes.includes('notifications:deliver')
      ||record?.state!=='started'||record.policyDecision!=='allow'||!record.executionStarted||record.toolName!==intent.toolName
      ||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:context.runId}))throw Error('原语音通知没有正在执行的独立 Policy 证据');
    const checked=authority.assertCurrent();
    if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});throw Error('原语音通知来源必须同步核验');}
    const conversationId=application.readToolConversation(context.taskId);
    if(!conversationId)throw Error('原语音通知会话绑定缺失');
    return {taskId:context.taskId,runId:context.runId,conversationId,deadline:context.deadline};
  }
  function deliverVoice({roundId,title,body,authority}) {
    const service=current(),scope=voiceScope(roundId,authority),round=service.getInterruptionRound(roundId);
    const voice=getVoiceHost?.(),binding={...scope,roundId,text:title+'。'+body};
    if(!round||round.expiresAt!==scope.deadline||!isDeepStrictEqual(round.channels,['voice']))throw Error('原语音通知轮次绑定缺失');
    const args=application.runtime.loadCheckpoint(scope.taskId,'host-tool-intent').arguments;
    if(!isDeepStrictEqual([...(args.itemIds??[args.itemId])].sort(),[...round.itemIds].sort()))throw Error('原语音通知选择已改变');
    const feed=service.notificationFeed({limit:100}).items,entries=round.itemIds.map(id=>feed.find(item=>item.id===id));
    const fixedBody=entries.length===1?'来源 '+entries[0]?.source+' 有一条更新，请查看通知列表。':'有 '+entries.length+' 条更新，请查看通知列表。';
    if(entries.some(item=>!item||item.validity!=='active'||!item.unread)||title!=='PersonalAgent 通知'||body!==fixedBody)
      throw Error('语音通知必须使用原选择的固定提示文本');
    const original=application.runtime.loadCheckpoint(scope.taskId,voiceKey(roundId));
    if(original&&!isDeepStrictEqual(original.binding,binding))throw Error('原语音通知内容已被替换');
    if(round.attempts.voice)return round; // Restart/unknown can only read the original attempt.
    if(typeof voice?.speakNotification!=='function'||typeof voice.readNotificationDelivery!=='function'||voice.canSpeakNotification?.(scope.conversationId)!==true)
      throw Error('原 Live 通知端口不可用');
    const begun=service.beginDelivery({roundId,channel:'voice'});if(!begun.maySend)return begun.round;
    application.runtime.saveCheckpointOnce(scope.taskId,voiceKey(roundId),{binding,receipt:{state:'unknown',playbackVerified:false}});
    const assertCurrent=()=>{voiceScope(roundId,authority);
      if(!isDeepStrictEqual(application.runtime.loadCheckpoint(scope.taskId,voiceKey(roundId))?.binding,binding))throw Error('原语音通知持久绑定改变');};
    try {
      voice.speakNotification({...binding,signal:authority.context.signal},{assertCurrent,onReceipt:receipt=>{
        assertCurrent();
        if(receipt.roundId!==roundId||receipt.taskId!==scope.taskId||receipt.runId!==scope.runId
          ||receipt.conversationId!==scope.conversationId||receipt.deadline!==scope.deadline||receipt.textDigest!==createHash('sha256').update(binding.text).digest('hex')
          ||receipt.playbackVerified!==false||!['unknown','accepted','draining','renderer_completed'].includes(receipt.state))throw Error('原语音通知回执不匹配');
        application.runtime.saveCheckpoint(scope.taskId,voiceKey(roundId),{binding,receipt:structuredClone(receipt)});publish();
      }});
    }catch { /* The original session may have accepted audio. Never retry or declare hardware delivery. */ }
    const result=service.completeDelivery({roundId,channel:'voice',state:'unknown',evidenceRefs:[]});publish();return result;
  }
  function recordOutcome(roundId) {
    const service = current(), round = service.getInterruptionRound(roundId);
    if (!round?.attempts.banner) return round;
    const id=channelId(roundId),outcome = channel.readDeliveryOutcome(id);
    if (!outcome || outcome.id!==id || outcome.roundId!==undefined&&outcome.roundId!==roundId) return round;
    const terminal=['delivered','failed'].includes(outcome.deliveryState);
    const updated=terminal?service.completeDelivery({roundId,channel:'banner',state:outcome.deliveryState,
      evidenceRefs:outcome.evidenceRefs}):round;
    // A native click can mark the original feed read while the channel send is
    // still unknown. It never supplies a show receipt or changes that attempt.
    const clicked=outcome.deliveryState!=='failed'&&(Number.isFinite(Date.parse(outcome.clickedAt))
      ||terminal&&outcome.userRead===true);
    if(clicked)service.acknowledgeRead({operationId:'native-read-'+digest(roundId),itemIds:round.itemIds});
    if(terminal||clicked)publish();
    return updated;
  }
  function receipt(outcome) {
    const roundId = deliveries.get(outcome?.id)??(typeof outcome?.roundId==='string'
      &&channelId(outcome.roundId)===outcome.id?outcome.roundId:undefined);
    if (!roundId || disposed) return;
    try {recordOutcome(roundId);} catch { /* Original sending/unknown state requires readback, never resend. */ }
  }
  function restoreClickReceipts() {
    let receipts;
    try {receipts=channel.listClickReceipts?.();}catch{return;}
    if(!Array.isArray(receipts))return;
    for(const receipt of receipts) {
      if(typeof receipt?.id!=='string'||typeof receipt.roundId!=='string'
        ||receipt.id!==channelId(receipt.roundId)||!Number.isFinite(Date.parse(receipt.clickedAt)))continue;
      try {
        if(!host.getInterruptionRound(receipt.roundId)?.attempts.banner)continue;
        deliveries.set(receipt.id,receipt.roundId);recordOutcome(receipt.roundId);
      }catch{ /* A stale or unbound click cannot create a new round or retry a send. */ }
    }
  }
  async function waitForSettings(taskId, command, isCurrent) {
    let responded = false;
    while (now() < Date.parse(command.expiresAt) && !disposed) {
      const read = application.readHostToolTask(taskId);
      if (read.confirmed) return {state: 'confirmed', taskId, result: read.confirmed.result, evidenceRefs: read.confirmed.evidenceRefs};
      if (['failed', 'cancelled'].includes(read.task.state)) throw Error(read.task.error?.message || '通知设置未应用，请读取原任务');
      if (read.task.state === 'waiting_reconciliation') return {state: 'unknown', taskId};
      if (!question&&read.approval?.state === 'pending' && !responded) {
        if (!isCurrent()) throw Error('当前设置或最终语音确认已经失效');
        // The explicit settings submit/final is the user's decision for these exact
        // frozen arguments. Runtime's original approval owns the one-use grant.
        responded = true;
        try {await client.call('authorization.respond', {approvalId: read.approval.approvalId,
          expectedRevision: read.approval.revision, decision: 'allow_once'});}
        catch {return {state: 'unknown', taskId};}
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return {state: 'pending', taskId};
  }
  function configureSettings(settings, authority = {}) {
    current(); validateToolValue(descriptor.inputSchema, settings);
    const frozen = structuredClone(settings), inputDigest = digest(frozen);
    const known = operations.get(frozen.operationId);
    if (known) {
      if (known.digest !== inputDigest) throw Error('通知设置 operationId 已绑定不同参数');
      return known.promise;
    }
    const isCurrent = authority.isCurrent ?? (() => true);
    if (typeof isCurrent !== 'function' || !isCurrent()) throw Error('通知设置来源已经失效');
    if (authority.source !== undefined && !['structured', 'voice'].includes(authority.source)) throw Error('通知设置来源无效');
    if (authority.source === 'voice' && (!authority.utteranceId || !/^[a-f0-9]{64}$/u.test(authority.transcriptDigest ?? ''))) {
      throw Error('缺少受信最终语音绑定');
    }
    const commandId = 'notification-' + digest(frozen.operationId);
    const original = application.runtime.findTaskByIdempotencyKey(`host-tool:${JSON.stringify([namespace, commandId])}`);
    if (original) {
      const binding = application.runtime.loadCheckpoint(original.taskId, COMMAND_BINDING);
      if (binding?.argumentsDigest !== inputDigest) throw Error('原通知设置任务绑定不同参数');
      // A lost reply is read back independently. Never re-finalize/re-authorize it.
      const read = application.readHostToolTask(original.taskId);
      return Promise.resolve(read.confirmed ? {state: 'confirmed', taskId: original.taskId,
        result: read.confirmed.result, evidenceRefs: read.confirmed.evidenceRefs}
        : {state: read.task.state === 'waiting_reconciliation' ? 'unknown' : 'pending', taskId: original.taskId});
    }
    const issuedAt = new Date(now()).toISOString();
    const expiresAt = authority.expiresAt ?? new Date(now() + 30_000).toISOString();
    if (!(Date.parse(expiresAt) > now())) throw Error('通知设置命令已过期');
    const command = {settings: frozen, source: authority.source ?? 'structured', phase: 'final', origin: 'user', echo: false,
      issuedAt, expiresAt, argumentsDigest: inputDigest, proof: randomUUID(),
      ...(authority.source === 'voice' ? {utteranceId: authority.utteranceId, transcriptDigest: authority.transcriptDigest} : {})};
    const task = application.prepareHostToolTask({commandId, toolName: descriptor.name, toolVersion: descriptor.version, deadline: expiresAt});
    commands.set(task.taskId, {command, isCurrent});
    application.runtime.saveCheckpoint(task.taskId, COMMAND_BINDING, {operationId: frozen.operationId, argumentsDigest: inputDigest});
    application.finalizeHostToolTask({taskId: task.taskId, commandId, expectedTaskRevision: task.revision, arguments: frozen});
    const promise = waitForSettings(task.taskId, command, isCurrent).finally(publish);
    operations.set(frozen.operationId, {digest: inputDigest, promise});
    return promise;
  }
  const api = {
    tools: [settingsTool], configureSettings, receipt,
    prepareAuthorization(scope){
      if(!question||scope.toolName!==descriptor.name)return;
      const original=commands.get(scope.taskId);if(!original||!original.isCurrent())throw Error('原通知设置请求已失效');
      question.prepare(scope,{requirements:[{requirementId:'notifications-settings',kind:'tool',scopes:SETTINGS_SCOPES,
        bindingDigest:digest([scope.taskId,scope.runId,original.command.argumentsDigest,original.command.expiresAt]),
        ruleBindingDigest:digest([namespace,original.command.settings.scope]),
        summary:'仅所选通知范围的配置修改；执行前重新核对本次参数和设置版本，不授予其他业务权限'}],
        assertCurrent:()=>!disposed&&original.isCurrent()&&now()<Date.parse(original.command.expiresAt)});
    },
    restoreLegacySettings(policy) {
      savedLegacyPolicy=structuredClone(policy);
      if(host)return host.importLegacyPolicy(legacyScope,savedLegacyPolicy);
    },
    legacySettingsSnapshot() {return host&&!disposed?host.getLegacyPolicy(legacyScope):null;},
    configureLegacySettings(policy) {
      const latest=current().getLegacyPolicy(legacyScope);
      return configureSettings({operationId:randomUUID(),expectedRevision:latest.revision,scope:legacyScope,legacyPolicy:structuredClone(policy)});
    },
    bindApplication(value, connection) {
      if (disposed) throw Error('通知 Runtime 宿主已经释放');
      if (application && application !== value) throw Error('通知宿主不能重新绑定不同 Runtime');
      // Startup needs the original local policy before Client exists. Later binding
      // attaches only that connection; a second host would replace trusted closures.
      if (host) {if(connection!==undefined)client=connection;return host;}
      application = value; if(connection!==undefined)client=connection;
      host = value.createNotificationHost({policy: {}, settingsScopes: SETTINGS_SCOPES, now,
        verifyUserCommand: validCommand,
        resolveUserCommand: (_input, context) => commands.get(context.taskId)?.command});
      if(savedLegacyPolicy!==undefined)host.importLegacyPolicy(legacyScope,savedLegacyPolicy);
      restoreClickReceipts();
      return host;
    },
    get runtimeHost() {return current();},
    readSettingsTask(taskId) {
      current(); const read = application.readHostToolTask(taskId);
      return read.confirmed ? {state: 'confirmed', taskId, result: read.confirmed.result} : {state: 'pending', taskId};
    },
    snapshot(scope = {kind: 'global'}) {
      if (!host || disposed) return {available: false, reason: '通知设置等待 Competition Runtime 连接'};
      return {available: true, policy: host.getInterruptionPolicy(scope), status: host.status(),
        feed: host.notificationFeed({limit: 100}), deviceVerification: 'unverified'};
    },
    ingest: (items, metadata) => current().ingest(items, metadata), drain: () => current().drain(),
    status: scope => host ? current().status(scope) : {pausedUntil:null,quietUntil:null,pending:0,nextDigestCloseAt:null,
      unacknowledgedBatches:0,interruptionQuotaSafety:'unavailable'}, getInterruptionPolicy: scope => current().getInterruptionPolicy(scope),
    getLegacyPolicy: scope => current().getLegacyPolicy(scope),
    acknowledgeRead(input) {const result = current().acknowledgeRead(input); publish(); return result;},
    getDigest(input) {return current().getDigest(input);},
    async deliverBatch({batchId, scope, expiresAt, title, body, source}) {
      const service = current(), policy = service.getInterruptionPolicy(scope);
      const channelName = policy.effective?.preferredChannel === 'voice' ? 'voice' : 'banner';
      const roundId = 'desktop-batch-' + digest(batchId);
      const previous = service.getInterruptionRound(roundId);
      if (previous?.attempts.banner) return recordOutcome(roundId) ?? previous;
      // No speech output implementation is inferred from a Live connection.
      if (channelName === 'voice') return {state: 'unavailable', reason: 'notification_voice_delivery_unavailable'};
      const round = previous ?? service.reserveInterruption({roundId, batchIds: [batchId], scope,
        channels: [channelName], expiresAt});
      if (!round.counted) return round;
      return api.deliverRound({roundId, channel: channelName, title, body, source});
    },
    async deliverRound({roundId, channel: channelName, title, body, source, authority}) {
      if (typeof title !== 'string' || !title.trim() || title.length > 200
        || typeof body !== 'string' || !body.trim() || body.length > 2000) throw Error('通知展示内容无效');
      if(channelName==='voice')return deliverVoice({roundId,title,body,authority});
      if(channelName!=='banner')return {state:'unavailable',reason:'notification_channel_unavailable'};
      const service = current(), round = service.getInterruptionRound(roundId);
      if (!round) throw Error('原通知轮次不存在');
      if (round.attempts.banner) return recordOutcome(roundId) ?? round;
      const begun = service.beginDelivery({roundId, channel: 'banner'});
      if (!begun.maySend) return begun.round;
      const id = channelId(roundId); deliveries.set(id, roundId);
      try {
        await channel.sendAdvisoryNotification({id, title, body, source, roundId});
        const outcome = channel.readDeliveryOutcome(id);
        if (outcome && ['delivered', 'failed'].includes(outcome.deliveryState)) return recordOutcome(roundId);
      } catch { /* The OS may already have accepted it. Persist unknown and read the original port. */ }
      const after = service.getInterruptionRound(roundId);
      if (after.attempts.banner.state !== 'sending') return after;
      const result = service.completeDelivery({roundId, channel: 'banner', state: 'unknown', evidenceRefs: []});
      publish(); return result;
    },
    reconcileDelivery(roundId) {return recordOutcome(roundId);},
    hasVoicePort:conversationId=>{const voice=getVoiceHost?.();return typeof voice?.speakNotification==='function'
      &&typeof voice.readNotificationDelivery==='function'&&voice.canSpeakNotification?.(conversationId)===true;},
    readVoiceDelivery({roundId,taskId}) {
      current();const saved=application.runtime.loadCheckpoint(taskId,voiceKey(roundId));
      return saved?.binding.roundId===roundId&&saved.binding.taskId===taskId?structuredClone(saved.receipt):undefined;
    },
    dispose() {disposed = true; commands.clear(); channel.dispose?.();},
  };
  return api;
}
