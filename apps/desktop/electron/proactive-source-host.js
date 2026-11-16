import {createHash} from 'node:crypto';
import path from 'node:path';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {
  createNodeReadOnlyDirectoryScan,
  createProactiveSourceTrigger,
  createPublicToolReadPort,
} from '@personal-agent/cognition';

const INTERVAL_MS = 120_000;
const QUIET = {startMinute: 22 * 60, endMinute: 7 * 60};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function ruleChoice(request) {
  const propose = request.candidates[0];
  const selected = {id: propose.id, revision: propose.revision};
  if (propose.risk === 'high') return {state: 'review', eligibleForRuntime: false, reason: 'high_risk', selected};
  return {state: 'selected', eligibleForRuntime: true, reason: 'selected', selected};
}

function defaults() {
  return {version: 1, enabled: false, calendar: true, mail: true, quiet: true, directories: [], recent: [], gates: {}};
}

/** Host assembly for the cognition trigger. Reads only public calendar.events and mail.inbox tools. */
export function createProactiveSourceHost({getApplication, getTools, submitTask, namespace, scan = createNodeReadOnlyDirectoryScan(),
  chooser, risk, now = Date.now, onUpdate = () => {}}) {
  if (typeof getApplication !== 'function' || typeof getTools !== 'function' || typeof submitTask !== 'function' || !namespace) {
    throw new Error('主动任务宿主缺少运行时端口');
  }
  let settings = defaults();
  let loaded = false;
  let trigger;
  let triggerKey = '';
  let nextReadAt = 0;
  const conversationId = `proactive-source:${namespace}`;

  function hydrate() {
    if (loaded) return;
    try {
      const saved = createRuntimeAtomicStatePort(runtime(), 'desktop-proactive-source').read(namespace);
      if (saved?.value?.version === 1) settings = {...defaults(), ...saved.value};
      loaded = true;
    } catch { /* 运行时未就绪时保持默认，下次再读 */ }
  }
  function persist() {
    try {
      const port = createRuntimeAtomicStatePort(runtime(), 'desktop-proactive-source');
      const saved = port.read(namespace);
      port.compareAndSet(namespace, saved?.revision, settings);
    } catch { /* 设置仍留在本次进程，不阻断来源读取 */ }
  }
  function runtime() {
    const application = getApplication();
    if (!application?.runtime) throw new Error('运行时尚未就绪');
    return application.runtime;
  }
  function remember(outcomes) {
    const rows = outcomes.filter(item => item.eventId).map(item => ({
      at: new Date(now()).toISOString(), source: item.source, status: item.status, summary: item.kind ?? item.status,
    }));
    settings.recent = [...rows, ...settings.recent].slice(0, 8);
  }
  function ports() {
    const invoke = async (name, input, context) => {
      const tool = getTools()?.find(item => item.descriptor?.name === name);
      if (!tool || tool.descriptor.sideEffect !== 'read' || !['calendar.events', 'mail.inbox'].includes(name)) {
        const error = new Error('来源工具不可用');
        error.code = 'UNSUPPORTED_CAPABILITY';
        throw error;
      }
      return tool.execute(input, {taskId: conversationId, runId: conversationId, signal: context.signal, deadline: context.deadline,
        authorizationRef: conversationId, scopes: [...context.scopes]});
    };
    const calendar = settings.calendar ? createPublicToolReadPort({invoke, toolName: 'calendar.events', scope: 'calendar:read', source: 'calendar'}) : undefined;
    const mail = settings.mail ? createPublicToolReadPort({invoke, toolName: 'mail.inbox', scope: 'mail:read', source: 'mail'}) : undefined;
    const files = settings.directories.length ? {roots: settings.directories.map(item => ({root: item.root, authorized: true})), scan} : undefined;
    return {calendar, mail, files};
  }
  function currentTrigger() {
    const key = JSON.stringify([settings.calendar, settings.mail, settings.quiet, settings.directories]);
    if (trigger && key === triggerKey) return trigger;
    const previous = trigger?.exportState();
    const offset = -new Date(now()).getTimezoneOffset();
    const built = ports();
    trigger = createProactiveSourceTrigger({
      chooser: {async choose(request) {
        if (chooser) {
          const selection = await chooser.choose(request);
          if (selection?.reason !== 'unavailable') return selection;
        }
        return ruleChoice(request);
      }},
      tasks: {submit: submitTask},
      approvals: {request: requestApproval},
      ...(built.calendar ? {calendar: built.calendar} : {}),
      ...(built.mail ? {mail: built.mail} : {}),
      ...(built.files ? {files: built.files} : {}),
      ...(settings.quiet ? {quietHours: {...QUIET, utcOffsetMinutes: offset}} : {}),
      ...(risk ? {risk} : {}),
      conversationId,
      now,
    });
    if (previous) trigger.importState(previous);
    triggerKey = key;
    return trigger;
  }
  async function requestApproval(input) {
    const current = runtime();
    const task = current.submitTask({goal: input.summary, conversationId: `${conversationId}:approval`, idempotencyKey: `proactive-approval:${input.idempotencyKey}`});
    current.saveCheckpoint(task.taskId, 'proactive-source-gate', {eventId: input.idempotencyKey, argumentsDigest: input.argumentsDigest});
    const approvalId = `proactive-approval-${task.taskId}`;
    current.transitionTask(task.taskId, 'planning');
    current.transitionTask(task.taskId, 'running');
    current.requestToolApproval(approvalId, task.taskId, {name: input.summary, version: '1.0.0', requiredScopes: [...input.scopes],
      sideEffect: 'read', inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, idempotencySupport: false,
      recoverySupport: false, requiresPresence: false}, input.expiresAt, input.argumentsDigest);
    const approval = current.getApproval(approvalId);
    settings.gates[input.idempotencyKey] = {taskId: task.taskId, approvalId};
    return {approvalId: approval.approvalId, state: 'pending', revision: approval.revision};
  }
  function arm() {
    const current = runtime();
    if (!settings.enabled) {
      current.reconcileSchedules(conversationId, []);
      return;
    }
    if (current.listSchedules(conversationId).some(item => item.status === 'pending')) return;
    const runAt = new Date(now() + INTERVAL_MS).toISOString();
    current.createSchedule({scheduleId: `proactive-source-${digest(runAt)}`, conversationId, goal: '检查已开启的主动来源',
      runAt, timeZone: 'UTC', missedRunPolicy: 'run_once', taskIdempotencyKey: `proactive-source-${runAt}`});
  }
  async function settle(active) {
    const saved = active.exportState();
    const current = runtime();
    const deadline = new Date(now() + 60_000).toISOString();
    const signal = new AbortController().signal;
    for (const [eventId, record] of Object.entries(saved.approvals)) {
      if (record.taskId || record.denied) continue;
      let approval;
      try { approval = current.getApproval(record.approvalId); } catch { continue; }
      if (approval.state === 'pending' || approval.argumentsDigest !== record.argumentsDigest) continue;
      await active.resumeApproved({eventId, approvalId: record.approvalId, revision: record.revision,
        state: approval.state === 'allowed' ? 'allowed' : 'denied', argumentsDigest: record.argumentsDigest, signal, deadline});
      const gate = settings.gates[eventId];
      if (gate) {
        try { current.requestCancel(gate.taskId, '主动任务审批已处理'); } catch { /* 审批载体取消失败不重放业务任务 */ }
        delete settings.gates[eventId];
      }
    }
  }
  return {
    snapshot() {
      hydrate();
      return {enabled: settings.enabled, calendar: settings.calendar, mail: settings.mail, quiet: settings.quiet,
        directories: settings.directories.map(item => item.root), recent: settings.recent.map(item => ({...item})),
        rules: ['会前准备材料', '新邮件摘要', '目录变化审阅', '会议改期先询问']};
    },
    update(patch) {
      if (!patch || typeof patch !== 'object') throw new Error('主动任务设置无效');
      if (patch.enabled !== undefined) settings.enabled = patch.enabled === true;
      if (patch.calendar !== undefined) settings.calendar = patch.calendar === true;
      if (patch.mail !== undefined) settings.mail = patch.mail === true;
      if (patch.quiet !== undefined) settings.quiet = patch.quiet === true;
      triggerKey = '';
      persist();
      if (settings.enabled) nextReadAt = 0;
      try { arm(); } catch { /* 运行时未就绪时先记住设置，启动后再排程 */ }
      onUpdate();
      return this.snapshot();
    },
    authorize(root) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('请选择一个具体目录');
      const resolved = path.resolve(root);
      if (resolved === path.parse(resolved).root) throw new Error('请选择一个具体目录');
      if (!settings.directories.some(item => item.root === resolved)) settings.directories.push({root: resolved});
      triggerKey = '';
      persist();
      onUpdate();
      return this.snapshot();
    },
    revoke(root) {
      const resolved = path.resolve(String(root ?? ''));
      settings.directories = settings.directories.filter(item => item.root !== resolved);
      triggerKey = '';
      persist();
      onUpdate();
      return this.snapshot();
    },
    async tick() {
      hydrate();
      const current = runtime();
      const fired = current.dispatchDueSchedules(conversationId);
      const active = settings.enabled || trigger ? currentTrigger() : undefined;
      if (active) await settle(active);
      if (!settings.enabled) return this.snapshot();
      if (!fired.length && now() < nextReadAt) return this.snapshot();
      const result = await active.tick({signal: new AbortController().signal, deadline: new Date(now() + INTERVAL_MS).toISOString(),
        scopes: ['calendar:read', 'mail:read']});
      remember(result.outcomes);
      nextReadAt = now() + INTERVAL_MS;
      arm();
      persist();
      onUpdate();
      return this.snapshot();
    },
  };
}
