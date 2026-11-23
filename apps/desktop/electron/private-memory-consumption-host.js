import {createHash} from 'node:crypto';

export const PRIVATE_MEMORY_CONSUMPTION_CHECKPOINT = 'private-memory:consumption:v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const terminal = task => ['succeeded', 'failed', 'cancelled'].includes(task.state) || task.cancelRequested;

/** Host-only, ephemeral projection into the existing Competition worker. No task loop or cloud grant. */
export function createPrivateMemoryConsumptionHost({profile, privateMemory, readTask,
  readTaskBinding, writeTaskBinding, readConfigurationRef, assertCopyManagement}) {
  if (profile !== 'huawei_ict_agentarts' || !privateMemory
    || [readTask, readTaskBinding, writeTaskBinding, readConfigurationRef].some(value => typeof value !== 'function')) {
    throw Error('需要可信任务与 Competition 配置绑定');
  }
  const selections = new Map();
  const leases = new Map();
  let closed = false;
  const checkTask = (taskId, conversationId, deadline, signal) => {
    if (closed || !signal || signal.aborted || !Number.isFinite(Date.parse(deadline))
      || Date.parse(deadline) <= Date.now()) throw Error('私人记忆任务已取消或过期');
    const task = readTask(taskId);
    if (!task || task.taskId !== taskId || task.conversationId !== conversationId || terminal(task)) {
      throw Error('私人记忆任务绑定不可用');
    }
    return task;
  };
  const configuration = () => {
    const ref = readConfigurationRef();
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 256) throw Error('Competition 配置未绑定');
    return ref;
  };
  const checkLease = (lease, request) => {
    if (typeof assertCopyManagement !== 'function') throw Error('私人任务副本清除未接通');
    const gate = assertCopyManagement();
    if (gate && typeof gate.then === 'function') throw Error('私人副本门禁必须同步完成');
    checkTask(request.taskId, lease.conversationId, lease.binding.deadline, request.signal);
    if (request.deadline !== lease.binding.deadline || request.goal !== lease.goal
      || configuration() !== lease.binding.configurationRef
      || !same(readTaskBinding(request.taskId), lease.binding)) throw Error('私人记忆发送范围已变化');
    privateMemory.assertConsumption(lease.binding.fact);
  };
  return Object.freeze({
    /** Sender-checked admin selection is a request, not permission. Native confirmation follows per task. */
    select({conversationId, ref}) {
      if (closed || typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 256) {
        throw Error('无效的私人记忆对话范围');
      }
      if (ref === null) { selections.delete(conversationId); return {selected: false}; }
      const binding = privateMemory.readConsumptionBinding(ref);
      selections.set(conversationId, binding);
      return {selected: true, ref: structuredClone(binding.ref)};
    },
    snapshot(conversationId) {
      const selected = selections.get(conversationId);
      if (!selected || closed) return {selected: false};
      try { privateMemory.assertConsumption(selected); return {selected: true, ref: structuredClone(selected.ref)}; }
      catch { return {selected: false, state: 'selection_changed'}; }
    },
    /** Run after TaskRuntime acceptance, before dispatch. Persist only public user goal and this metadata binding. */
    async prepare({taskId, conversationId, goal, deadline, signal}) {
      checkTask(taskId, conversationId, deadline, signal);
      if (typeof goal !== 'string' || !goal.trim()) throw Error('无效的对话请求');
      const previous = leases.get(taskId);
      if (previous) {
        if (previous.binding.userGoalDigest !== hash(goal)) throw Error('私人记忆任务输入已变化');
        checkLease(previous, {taskId, goal: previous.goal, deadline, signal});
        return {state: 'authorized', goal: previous.goal};
      }
      if (readTaskBinding(taskId) !== undefined && readTaskBinding(taskId) !== null) {
        throw Error('私人记忆授权未跨重启恢复，请提交新任务重新确认');
      }
      const selected = selections.get(conversationId);
      if (!selected) return {state: 'not_selected', goal};
      if (typeof assertCopyManagement !== 'function') throw Error('私人派生副本清除未接通，消费保持禁用');
      const readiness = assertCopyManagement();
      if (readiness && typeof readiness.then === 'function') {
        void Promise.resolve(readiness).catch(() => undefined);
        throw Error('私人副本清单检查必须同步完成');
      }
      privateMemory.assertConsumption(selected);
      const configurationRef = configuration();
      const result = await privateMemory.consumeConfirmed({refs: [selected.ref], taskId,
        destination: 'agentarts', configurationRef, deadline, signal});
      checkTask(taskId, conversationId, deadline, signal);
      if (configuration() !== configurationRef || !same(selections.get(conversationId), selected)) {
        throw Error('私人记忆确认范围已变化');
      }
      if (result.state !== 'authorized') return {state: 'declined', goal};
      privateMemory.assertConsumption(selected);
      if (result.facts.length !== 1 || !same(result.bindings, [selected])) throw Error('私人记忆返回范围已变化');
      const binding = {taskId, conversationId, destination: 'agentarts', configurationRef, deadline,
        userGoalDigest: hash(goal), fact: structuredClone(selected)};
      const projected = JSON.stringify({goal, userConfirmedMemory: {treatment: 'user_confirmed_data',
        summary: result.facts[0].summary}});
      // The trusted composition must write atomically before any worker can send.
      writeTaskBinding(taskId, structuredClone(binding));
      if (!same(readTaskBinding(taskId), binding)) throw Error('私人记忆任务绑定未持久化');
      const lease = {binding, conversationId, goal: projected};
      leases.set(taskId, lease);
      checkLease(lease, {taskId, goal: projected, deadline, signal});
      return {state: 'authorized', goal: projected};
    },
    /** Synchronous final beforeCompetitionSend guard, after credential waits and immediately before fetch. */
    assertCloudSend(request, scope) {
      const binding = readTaskBinding(request.taskId);
      const lease = leases.get(request.taskId);
      if (binding === undefined || binding === null) {
        if (lease) throw Error('私人记忆任务绑定缺失');
        return;
      }
      if (!lease) throw Error('私人记忆发送授权已失效，请重新确认新任务');
      if (scope && typeof scope === 'object' && typeof scope.preparedGoal === 'string') {
        checkLease(lease, {...request, goal: scope.preparedGoal});
        if (typeof request.goal !== 'string' || (!request.goal.includes(scope.preparedGoal)
          && !request.goal.includes(JSON.stringify(scope.preparedGoal)))) {
          throw Error('私人记忆发送范围已变化');
        }
        return;
      }
      checkLease(lease, request);
    },
    releaseTask(taskId) { leases.delete(taskId); },
    close() { closed = true; leases.clear(); selections.clear(); },
  });
}
