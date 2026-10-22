import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';

const READ_CHECKPOINT = 'desktop-calendar-read-v1';
const MEETING_CHECKPOINT = 'desktop-calendar-meeting-v1';
const text = value => typeof value === 'string' && value.trim() && value.length <= 512
  && !/[\u0000-\u001f\u007f]/.test(value);
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const error = (code, message) => Object.assign(new Error(message), {code});
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const calendarConfigurationId = binding => createHash('sha256').update(JSON.stringify(binding)).digest('hex');
/** Translate the local control revision into the existing protocol field. */
export function calendarApprovalResponse({approvalId, revision, decision}) {
  if (!text(approvalId) || !Number.isSafeInteger(revision) || revision < 1
    || !['allow_once', 'deny'].includes(decision)) throw error('INVALID_ARGUMENT', '日历审批响应无效');
  return {approvalId, expectedRevision: revision, decision};
}
const configurationId = calendarConfigurationId;
export const calendarMeetingSourceRef = (accountRef, externalId) =>
  `calendar:${createHash('sha256').update(JSON.stringify([accountRef, externalId])).digest('hex')}`;

function itemIdentity(item, accountRef, externalId) {
  const utc = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
  if (!item || item.source !== 'calendar' || item.accountRef !== accountRef
    || item.externalId !== externalId || typeof item.contentRef !== 'string' || !item.contentRef.trim()
    || !utc(item.fetchedAt)) return;
  // P1 CalDAV's fixed calendarId; UID may itself contain colons.
  const prefix = `calendar:caldav:${externalId}:`;
  if (typeof item.dedupeKey !== 'string' || !item.dedupeKey.startsWith(prefix)) return;
  const sequence = item.dedupeKey.slice(prefix.length);
  const interval = typeof item.validFor === 'string' ? item.validFor.split('/') : [];
  if (!/^(0|[1-9]\d*)$/.test(sequence) || !Number.isSafeInteger(Number(sequence))
    || interval.length !== 2 || interval.some(value => !utc(value)) || !utc(item.occurredAt)
    || Date.parse(interval[0]) >= Date.parse(interval[1])
    || Date.parse(item.occurredAt) !== Date.parse(interval[0])) return;
  return {sequence, interval};
}

/** Trusted shared composition only. A read factory must supply a registered
 * read-only tool and its argument builder; absent factory remains unavailable.
 * Old items and meeting bindings live in existing Runtime checkpoints, never a
 * second calendar store. Renderer can select IDs, but cannot provide source data.
 */
export function createDesktopCalendarMeetingHost({config, namespace, readTool, question,
  readArguments, now = Date.now, onUpdate = () => {}}) {
  if (!config || !text(namespace)) throw error('INVALID_ARGUMENT', '日历宿主配置无效');
  const descriptor = readTool?.descriptor;
  if (readTool && (descriptor?.sideEffect !== 'read' || descriptor.requiresPresence
    || !isDeepStrictEqual(descriptor.requiredScopes, ['calendar:read'])
    || typeof readArguments !== 'function')) {
    throw error('INVALID_ARGUMENT', '日历读取必须保留受控只读范围');
  }
  let application, store, closed = false, activePair, lastTaskId, tail = Promise.resolve();
  const controllers = new Set();
  const authorization=new AsyncLocalStorage(),prepared=new Map();
  const questionReady=()=>!question||['prepare','currentRequirement','readResourceGeneration'].every(name=>typeof question[name]==='function');
  const publish = () => {try {onUpdate();} catch {}};
  const binding = () => {
    const value = config.binding();
    if (closed || !value || value.providerKind !== 'caldav') {
      throw error('UNSUPPORTED_CAPABILITY', '日历配置未绑定或已撤销');
    }
    return value;
  };
  const ready = () => {
    if (closed || !application || !readTool || !questionReady()) {
      throw error('UNSUPPORTED_CAPABILITY', '受控日历单条读取工具尚未接入');
    }
  };
  function assertRead(entry,scope) {
    ready();const account=binding(),intent=application.runtime.loadCheckpoint(scope.taskId,READ_CHECKPOINT);
    if(!entry||scope.signal.aborted||Date.parse(scope.deadline)<=now()||entry.configurationId!==configurationId(account)
      ||intent?.namespace!==namespace||intent.configurationId!==entry.configurationId||intent.externalId!==entry.externalId
      ||question.readResourceGeneration(entry.resource)!==entry.resourceGeneration)throw error('UNAUTHORIZED','本次日历读取授权已失效');
    question.currentRequirement(scope,'calendar-local-read');
  }
  const protectedReadTool=readTool&&question?{descriptor:readTool.descriptor,async execute(input,context){
    const entry=prepared.get(context.runId);
    if(!entry||entry.scope.taskId!==context.taskId||!isDeepStrictEqual(input,readArguments(binding(),entry.externalId)))throw error('UNAUTHORIZED','读取参数与原问题不匹配');
    assertRead(entry,context);
    return authorization.run({entry,scope:context},async()=>{
      const result=await readTool.execute(input,context);assertRead(entry,context);return result;
    });
  }}:readTool;
  function confirmedRead(taskId) {
    ready();
    const account = binding();
    const intent = application.runtime.loadCheckpoint(taskId, READ_CHECKPOINT);
    const readback = application.readHostToolTask(taskId);
    if (intent?.version !== 1 || intent.namespace !== namespace
      || intent.configurationId !== configurationId(account)
      || readback.toolName !== descriptor.name || readback.toolVersion !== descriptor.version
      || readback.task.state !== 'succeeded' || !readback.confirmed
      || readback.confirmed.runId !== `host-tool-${taskId}`) {
      throw error('UNAUTHORIZED', '日历读取尚未确认或属于其他配置');
    }
    const item = readback.confirmed.result;
    const identity = itemIdentity(item, account.accountRef, intent.externalId);
    if (!identity || Date.parse(item.fetchedAt) > now()) {
      throw error('EXTERNAL_FAILURE', '日历读取结果身份或时间无效');
    }
    return {account, intent, readback, item: structuredClone(item), ...identity};
  }
  function assertFact(record) {
    const node = store.read().history.findLast(value => value.id === record.binding.meetingFactId);
    if (!node || node.kind !== 'fact' || node.revision !== record.factRevision
      || node.state !== 'active' || Date.parse(node.validFrom) > now()
      || Date.parse(node.validUntil) <= now() || node.sourceRef !== record.binding.sourceRef
      || node.summary !== record.baseline.contentRef
      || /\[sourceRevision:\s*([^\]]+)\]/.exec(node.reason ?? '')?.[1]?.trim() !== record.sequence) {
      throw error('REVISION_CONFLICT', '现有会议事实与可信旧日历条目不匹配');
    }
  }
  function meetingRecord(taskId) {
    const read = confirmedRead(taskId);
    const record = application.runtime.loadCheckpoint(taskId, MEETING_CHECKPOINT);
    if (record?.version !== 1 || record.namespace !== namespace
      || record.configurationId !== read.intent.configurationId
      || record.baselineTaskId !== taskId || record.sequence !== read.sequence
      || record.binding?.accountRef !== read.account.accountRef
      || record.binding?.calendarId !== 'caldav' || record.binding?.externalId !== read.intent.externalId
      || record.binding?.sourceRef !== calendarMeetingSourceRef(read.account.accountRef, read.intent.externalId)
      || !isDeepStrictEqual(record.baseline, read.item)
      || !isDeepStrictEqual(record.evidenceRefs, read.readback.confirmed.evidenceRefs)) {
      throw error('UNAUTHORIZED', '会议旧条目绑定不存在或已变更');
    }
    assertFact(record);
    return structuredClone(record);
  }
  const host = {
    tools: protectedReadTool ? [protectedReadTool] : [],
    prepareAuthorization(scope) {
      if(!question||scope.toolName!==descriptor?.name)return;
      ready();const account=binding(),intent=application.runtime.loadCheckpoint(scope.taskId,READ_CHECKPOINT);
      if(!scope.runId||intent?.namespace!==namespace||intent.configurationId!==configurationId(account)
        ||!text(intent.externalId)||scope.signal.aborted||Date.parse(scope.deadline)<=now())throw error('UNAUTHORIZED','原日历读取任务已改变');
      const resource=config.authorizationResource?.();
      if(!resource)throw error('UNSUPPORTED_CAPABILITY','日历原配置授权身份不可用');
      const resourceGeneration=question.readResourceGeneration(resource),entry={scope,resource,resourceGeneration,
        configurationId:intent.configurationId,externalId:intent.externalId};
      for(const [key,value]of prepared)if(Date.parse(value.scope.deadline)<=now())prepared.delete(key);
      const previous=prepared.get(scope.runId);
      if(previous&&(previous.scope.taskId!==scope.taskId||previous.configurationId!==entry.configurationId||previous.externalId!==entry.externalId))throw error('REVISION_CONFLICT','原读取问题不能更换参数');
      prepared.set(scope.runId,entry);
      question.prepare(scope,{requirements:[{requirementId:'calendar-local-read',kind:'connector_session',scopes:['calendar:read'],
        bindingDigest:configurationId({namespace,resource,resourceGeneration,taskId:scope.taskId,runId:scope.runId,
          externalId:entry.externalId,deadline:scope.deadline}),
        ruleBindingDigest:configurationId({namespace,resource,resourceGeneration,toolName:descriptor.name,toolVersion:descriptor.version,
          projection:descriptor.outputSchema}),summary:'仅从已配置日历读取所选单条事件并在本机展示；不修改日历或发送到云端'}],
        assertCurrent:()=>{try{const current=binding(),cp=application.runtime.loadCheckpoint(scope.taskId,READ_CHECKPOINT);
          return !scope.signal.aborted&&Date.parse(scope.deadline)>now()&&configurationId(current)===entry.configurationId
            &&cp?.configurationId===entry.configurationId&&cp.externalId===entry.externalId
            &&question.readResourceGeneration(resource)===resourceGeneration;}catch{return false;}}});
    },
    // Main injects this into the original read tool's fetch wrapper, after credential await.
    assertCurrentRead() {
      if(!question)return;
      const active=authorization.getStore();if(!active)throw error('UNAUTHORIZED','日历读取没有原执行上下文');
      assertRead(active.entry,active.scope);
    },
    bindApplication(value) {
      if (application) throw error('REVISION_CONFLICT', '日历宿主已装配');
      application = value;
      store = value.runtime.bindCoordinationStore(namespace);
      if (readTool) {
        let beforeSequence, snapshotSequence;
        do {
          const page = application.runtime.listTasks({conversationId: `host-tool:${namespace}`, limit: 100,
            ...(beforeSequence === undefined ? {} : {beforeSequence}),
            ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
          snapshotSequence = page.snapshotSequence;
          for (const task of page.items) {
            const intent = application.runtime.loadCheckpoint(task.taskId, READ_CHECKPOINT);
            const account = config.binding();
            if (intent?.version !== 1 || intent.namespace !== namespace || !account
              || intent.configurationId !== configurationId(account)) continue;
            const readback = application.readHostToolTask(task.taskId);
            if (readback.toolName !== descriptor.name || readback.toolVersion !== descriptor.version) continue;
            lastTaskId ??= task.taskId;
            if (task.state === 'waiting_approval' && readback.approval?.state === 'allowed') {
              application.resumeHostToolTask(task.taskId);
            }
          }
          beforeSequence = page.nextBeforeSequence;
        } while (beforeSequence !== undefined);
      }
    },
    snapshot() {
      const saved = config.snapshot();
      const available = !closed && questionReady() && Boolean(application && readTool && saved.configured);
      let readTask;
      if (available && lastTaskId) {
        try {readTask = host.readTask(lastTaskId);} catch {readTask = {state: 'unavailable', calendarWriteVerified: false};}
      }
      return {...saved, readAvailable: available, sessionAllowed: false,
        reason: available ? '单条读取逐次经过 Runtime 审批；会议变化还需匹配现有事实'
          : saved.reason, meetingBindingAvailable: available,
        ...(readTask ? {readTask} : {}),
        calendarWriteVerified: false};
    },
    read(payload) {
      ready();
      if (!exact(payload, ['externalId']) || !text(payload.externalId)) {
        throw error('INVALID_ARGUMENT', '请选择有效的日历事件');
      }
      const account = binding(), commandId = randomUUID();
      const task = application.prepareHostToolTask({commandId, toolName: descriptor.name,
        toolVersion: descriptor.version, deadline: new Date(now() + 60_000).toISOString()});
      try {
        const saved = application.runtime.saveCheckpointOnceForCreatedTask(task.taskId, READ_CHECKPOINT,
          {version: 1, namespace, configurationId: configurationId(account), externalId: payload.externalId}, task.revision);
        if (!saved) throw error('REVISION_CONFLICT', '读取任务在配置绑定前已改变');
        application.finalizeHostToolTask({taskId: task.taskId, commandId,
          expectedTaskRevision: task.revision, arguments: readArguments(account, payload.externalId)});
      } catch (cause) {
        try {application.cancelPreparedHostToolTask(task.taskId, commandId, task.revision);} catch {}
        throw cause;
      }
      lastTaskId = task.taskId; publish();
      return host.readTask(task.taskId);
    },
    readTask(taskId) {
      ready();
      const intent = application.runtime.loadCheckpoint(taskId, READ_CHECKPOINT);
      if (intent?.version !== 1 || intent.namespace !== namespace) throw error('NOT_FOUND', '日历任务不存在');
      const value = application.readHostToolTask(taskId);
      if (value.toolName !== descriptor.name || value.toolVersion !== descriptor.version) throw error('NOT_FOUND', '日历任务不存在');
      const result = {taskId, state: value.task.state, revision: value.task.revision,
        ...(value.approval ? {approval: {...value.approval}} : {}), calendarWriteVerified: false};
      if (value.task.state === 'succeeded') {
        const read = confirmedRead(taskId);
        result.item = {externalId: read.item.externalId, summary: read.item.contentRef,
          startUtc: read.interval[0], endUtc: read.interval[1]};
      }
      return result;
    },
    bindMeeting(payload) {
      if (!exact(payload, ['taskId', 'meetingFactId']) || !text(payload.taskId) || !text(payload.meetingFactId)) {
        throw error('INVALID_ARGUMENT', '会议绑定只能选择已确认任务与现有事实');
      }
      const read = confirmedRead(payload.taskId);
      if (!read.item.contentRef.startsWith('[confirmed] ')) throw error('REVISION_CONFLICT', '旧会议条目需要确认状态');
      const fact = store.read().history.findLast(node => node.id === payload.meetingFactId);
      const record = {version: 1, namespace, configurationId: read.intent.configurationId,
        baselineTaskId: payload.taskId, factRevision: fact?.revision, sequence: read.sequence,
        binding: {accountRef: read.account.accountRef, calendarId: 'caldav', externalId: read.intent.externalId,
          sourceRef: calendarMeetingSourceRef(read.account.accountRef, read.intent.externalId), meetingFactId: payload.meetingFactId},
        baseline: read.item, evidenceRefs: [...read.readback.confirmed.evidenceRefs]};
      assertFact(record);
      const previous = application.runtime.loadCheckpoint(payload.taskId, MEETING_CHECKPOINT);
      if (previous !== undefined && !isDeepStrictEqual(previous, record)) throw error('REVISION_CONFLICT', '旧会议绑定不可替换');
      if (previous === undefined && !application.runtime.saveCheckpointOnce(payload.taskId, MEETING_CHECKPOINT, record)
        && !isDeepStrictEqual(application.runtime.loadCheckpoint(payload.taskId, MEETING_CHECKPOINT), record)) {
        throw error('REVISION_CONFLICT', '旧会议绑定在保存时已改变');
      }
      publish();
      return {baselineTaskId: payload.taskId, meetingFactId: payload.meetingFactId,
        factRevision: record.factRevision, bound: true, calendarWriteVerified: false};
    },
    calendarReadPort: {
      readBaseline(bound) {
        if (!activePair || !isDeepStrictEqual(activePair.record.binding, bound)) throw error('UNAUTHORIZED', '会议读回未绑定');
        return meetingRecord(activePair.record.baselineTaskId).baseline;
      },
      readCurrent(bound) {
        if (!activePair || !isDeepStrictEqual(activePair.record.binding, bound)) throw error('UNAUTHORIZED', '会议读回未绑定');
        return confirmedRead(activePair.currentTaskId).item;
      },
    },
    refreshMeeting(payload, refresh) {
      if (!exact(payload, ['baselineTaskId', 'currentTaskId']) || !text(payload.baselineTaskId)
        || !text(payload.currentTaskId) || payload.baselineTaskId === payload.currentTaskId) {
        throw error('INVALID_ARGUMENT', '请提供独立的旧条目与当前读回任务');
      }
      const operation = tail.then(async () => {
        ready();
        if (typeof refresh !== 'function') throw error('UNSUPPORTED_CAPABILITY', '会议认知尚未接入');
        const record = meetingRecord(payload.baselineTaskId), current = confirmedRead(payload.currentTaskId);
        if (current.intent.externalId !== record.binding.externalId
          || current.intent.configurationId !== record.configurationId
          || Date.parse(current.item.fetchedAt) < Date.parse(record.baseline.fetchedAt)) {
          throw error('UNAUTHORIZED', '当前读回不能替换其他会议或旧版本');
        }
        const controller = new AbortController(); controllers.add(controller);
        activePair = {record, currentTaskId: payload.currentTaskId};
        try {return await refresh(record.binding, {signal: controller.signal,
          deadline: new Date(now() + 60_000).toISOString()});}
        finally {activePair = undefined; controllers.delete(controller); publish();}
      });
      tail = operation.then(() => {}, () => {});
      return operation;
    },
    invalidate() {
      prepared.clear();
      lastTaskId = undefined;
      for (const controller of controllers) controller.abort();
      if (application) {
        let beforeSequence, snapshotSequence;
        do {
          const page = application.runtime.listTasks({conversationId: `host-tool:${namespace}`, limit: 100,
            ...(beforeSequence === undefined ? {} : {beforeSequence}),
            ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
          snapshotSequence = page.snapshotSequence;
          for (const task of page.items) {
            const intent = application.runtime.loadCheckpoint(task.taskId, READ_CHECKPOINT);
            if (terminal.has(task.state) || intent?.version !== 1 || intent.namespace !== namespace) continue;
            application.runtime.policy.revoke(`host-tool-${task.taskId}`);
            application.runtime.requestCancel(task.taskId, 'Calendar configuration changed');
          }
          beforeSequence = page.nextBeforeSequence;
        } while (beforeSequence !== undefined);
      }
      publish();
    },
    close() {closed = true; host.invalidate();},
  };
  return Object.freeze(host);
}
