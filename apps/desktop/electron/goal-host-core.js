import {randomUUID} from 'node:crypto';
const GOAL_KEYS = ['id', 'summary', 'validFrom', 'validUntil', 'sensitivity', 'state', 'reason', 'dependencies'];
const DEADLINE_MS = 10 * 60 * 1000;

function requiredObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Goal 请求格式无效');
  return value;
}

function exactKeys(value, keys) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw Error('Goal 请求包含缺失或未支持的字段');
  }
}

function goalInput(value, commandId) {
  const goal = requiredObject(value);
  exactKeys(goal, GOAL_KEYS);
  return {...structuredClone(goal), sourceRef: `desktop-goal:${commandId}`};
}

function goalResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['applied', 'conflict', 'rejected'].includes(value.kind)
    || !Number.isSafeInteger(value.graphRevision) || value.graphRevision < 0) return null;
  if (value.kind !== 'applied') return {kind: value.kind, graphRevision: value.graphRevision};
  const ref = candidate => candidate && typeof candidate.id === 'string' && candidate.id
    && Number.isSafeInteger(candidate.revision) && candidate.revision > 0;
  if (!ref(value.currentGoal) || (value.previousGoal !== null && !ref(value.previousGoal))) return null;
  return {kind: 'applied', graphRevision: value.graphRevision,
    previousGoal: value.previousGoal === null ? null : {id: value.previousGoal.id, revision: value.previousGoal.revision},
    currentGoal: {id: value.currentGoal.id, revision: value.currentGoal.revision}};
}

function projectTask(readback, toolNames, runtime) {
  const {GOAL_CREATE_TOOL, GOAL_REVISE_TOOL, GOAL_TOOL_VERSION} = toolNames;
  const GOAL_TOOLS = new Set([GOAL_CREATE_TOOL, GOAL_REVISE_TOOL]);
  if (!GOAL_TOOLS.has(readback.toolName) || readback.toolVersion !== GOAL_TOOL_VERSION) {
    throw Error('Goal 任务不存在');
  }
  const {task, approval, confirmed} = readback;
  let expiresAt;
  if (approval) {
    try {
      const native = runtime.getApproval(approval.approvalId);
      if (native?.approvalId === approval.approvalId && native.taskId === task.taskId
        && native.toolName === readback.toolName && native.revision === approval.revision
        && native.state === approval.state && typeof native.expiresAt === 'string') {
        expiresAt = native.expiresAt;
      }
    } catch (error) { if (error?.code !== 'NOT_FOUND') throw error; }
  }
  const result = confirmed ? goalResult(confirmed.result) : null;
  if (task.state === 'succeeded' && !result) throw Error('Goal 任务缺少可验证的工具结果');
  return {taskId: task.taskId, commandId: readback.commandId, operation: readback.toolName,
    state: task.state, revision: task.revision, updatedAt: task.updatedAt,
    ...(approval ? {approval: {approvalId: approval.approvalId, revision: approval.revision, state: approval.state,
      ...(expiresAt === undefined ? {} : {expiresAt})}} : {}),
    ...(result ? {result, evidenceRefs: [...confirmed.evidenceRefs]} : {}),
    ...(task.error ? {error: {code: task.error.code, message: task.error.message}} : {})};
}

/** Trusted Desktop composition. Bind the store before any Goal IPC or recovery. */
export function createGoalHostCore(namespace, {getGoal, listGoals, createGoalTools,
  GOAL_CREATE_TOOL, GOAL_REVISE_TOOL, GOAL_TOOL_VERSION}) {
  let application;
  let store;
  const toolNames = {GOAL_CREATE_TOOL, GOAL_REVISE_TOOL, GOAL_TOOL_VERSION};
  const GOAL_TOOLS = new Set([GOAL_CREATE_TOOL, GOAL_REVISE_TOOL]);
  const tools = createGoalTools(() => store);
  function ready() {
    if (!application || !store) throw Error('Goal 宿主尚未就绪');
  }
  return {
    tools,
    bind(value) {
      if (application) throw Error('Goal 宿主已绑定');
      store = value.runtime.provisionCoordinationStore(namespace);
      application = value;
    },
    list() { ready(); return listGoals(store); },
    get(id) { ready(); return getGoal(store, id); },
    create(payload) { return submit(GOAL_CREATE_TOOL, payload); },
    revise(payload) { return submit(GOAL_REVISE_TOOL, payload); },
    readTask(taskId) { ready(); return projectTask(application.readHostToolTask(taskId), toolNames, application.runtime); },
    listTasks() {
      ready();
      const result = [];
      let beforeSequence;
      let snapshotSequence;
      do {
        const page = application.runtime.listTasks({conversationId: `host-tool:${namespace}`, limit: 100,
          ...(beforeSequence === undefined ? {} : {beforeSequence}),
          ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
        snapshotSequence = page.snapshotSequence;
        for (const task of page.items) {
          try { result.push(projectTask(application.readHostToolTask(task.taskId), toolNames, application.runtime)); }
          catch (error) { if (error?.code !== 'NOT_FOUND' && error?.message !== 'Goal 任务不存在') throw error; }
        }
        beforeSequence = page.nextBeforeSequence;
      } while (beforeSequence !== undefined);
      return result;
    },
    resumeApproved() {
      ready();
      let beforeSequence;
      let snapshotSequence;
      do {
        const page = application.runtime.listTasks({conversationId: `host-tool:${namespace}`,
          states: ['waiting_approval'], limit: 100,
          ...(beforeSequence === undefined ? {} : {beforeSequence}),
          ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
        snapshotSequence = page.snapshotSequence;
        for (const task of page.items) {
          let readback;
          try { readback = application.readHostToolTask(task.taskId); }
          catch (error) { if (error?.code === 'NOT_FOUND') continue; throw error; }
          if (GOAL_TOOLS.has(readback.toolName) && readback.toolVersion === GOAL_TOOL_VERSION
            && readback.approval?.state === 'allowed') {
            application.resumeHostToolTask(task.taskId);
          }
        }
        beforeSequence = page.nextBeforeSequence;
      } while (beforeSequence !== undefined);
    },
  };

  function submit(toolName, payload) {
    ready();
    const request = requiredObject(payload);
    exactKeys(request, toolName === GOAL_REVISE_TOOL
      ? ['expectedGraphRevision', 'expectedGoalRevision', 'goal']
      : ['expectedGraphRevision', 'goal']);
    const commandId = randomUUID();
    const args = {expectedGraphRevision: request.expectedGraphRevision,
      ...(toolName === GOAL_REVISE_TOOL ? {expectedGoalRevision: request.expectedGoalRevision} : {}),
      goal: goalInput(request.goal, commandId)};
    const readback = application.submitHostToolTask({commandId, toolName,
      toolVersion: GOAL_TOOL_VERSION, arguments: args,
      deadline: new Date(Date.now() + DEADLINE_MS).toISOString()});
    return projectTask(readback, toolNames, application.runtime);
  }
}
