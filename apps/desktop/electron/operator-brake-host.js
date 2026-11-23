import {createOperatorBrake} from '@personal-agent/cognition';

export const OPERATOR_BRAKE_ACTION = 'operator.brake';
const HOLDS = ['created', 'planning', 'running', 'waiting_approval', 'waiting_external', 'verifying'];

/**
 * Product adapter. The panel, tray and startup path all call this object.
 * Checkpoint, abort and resume go through the existing TaskRuntime hold/resume
 * and RuntimeApplication.resumeTask. There is no second task store.
 */
export function createDesktopOperatorBrake({getRuntime, continueTask, extensions, now = () => new Date().toISOString()} = {}) {
  if (typeof getRuntime !== 'function' || typeof continueTask !== 'function') throw Error('总暂停需要 Runtime 和原恢复入口');
  let brake;
  let triggersHeld = false;

  function runtime() {
    const current = getRuntime();
    if (!current?.holdForOperatorPause || !current?.bindTrustedHostState) throw Error('Runtime 尚未连接');
    return current;
  }

  function store() {
    const host = runtime().bindTrustedHostState('operator-brake');
    return {load: () => host.get('record'), save: record => host.set('record', record)};
  }

  function listActive() {
    const current = runtime();
    const runs = [];
    const seen = new Set();
    for (const state of HOLDS) {
      let before;
      for (let page = 0; page < 20; page += 1) {
        const result = current.listTasks({limit: 100, states: [state], ...(before === undefined ? {} : {beforeSequence: before})});
        for (const task of result.items) {
          if (task.cancelRequested || seen.has(task.taskId)) continue;
          seen.add(task.taskId);
          const cursor = current.loadCheckpoint(task.taskId, 'competition-loop') ?? current.loadCheckpoint(task.taskId, 'agent-loop');
          runs.push({id: task.taskId, kind: 'task', ...(cursor === undefined ? {} : {cursor})});
        }
        if (result.nextBeforeSequence === undefined) break;
        before = result.nextBeforeSequence;
      }
    }
    for (const taskId of current.activeTaskIds?.() ?? []) {
      if (seen.has(taskId)) continue;
      try {
        const task = current.getTask(taskId);
        if (task.cancelRequested || ['succeeded', 'failed', 'cancelled', 'cancelling'].includes(task.state)) continue;
        seen.add(taskId);
        runs.push({id: taskId, kind: 'task'});
      } catch { /* A worker that already exited is not a hold. */ }
    }
    return runs;
  }

  async function continueHeld(taskId) {
    const current = runtime();
    let task = current.getTask(taskId);
    if (task.state === 'waiting_reconciliation') {
      try { task = current.resumeOperatorHold(taskId); }
      catch { return {taskId, resumed: false}; }
    }
    if (current.getTask(taskId).state !== 'waiting_approval') return {taskId, resumed: false};
    await continueTask(taskId);
    return {taskId, resumed: true};
  }

  function ensure() {
    if (brake) return brake;
    brake = createOperatorBrake({
      now,
      store: store(),
      extensions,
      listActive,
      async checkpoint(run) {runtime().holdForOperatorPause(run.id);},
      abort(run) {runtime().holdForOperatorPause(run.id);},
      async resume(run) {try {await continueHeld(run.id);} catch { /* Existing resume refused; the hold stays. */ }},
      holdTriggers() {triggersHeld = true;},
      releaseTriggers() {triggersHeld = false;},
    });
    return brake;
  }

  return {
    /** Call after the desktop Runtime is open, including the startup path. */
    attach() {
      brake = undefined;
      return ensure().snapshot();
    },
    isPaused() {
      try {return runtime().isOperatorPaused() === true;}
      catch {return brake?.isPaused() === true;}
    },
    triggersHeld: () => triggersHeld,
    snapshot() {
      try {if (!brake) ensure();} catch {return {version: 1, paused: false, holds: []};}
      const current = brake.snapshot();
      return {...current, paused: this.isPaused()};
    },
    async engage() {
      const paused = await ensure().engage();
      for (const taskId of runtime().activeTaskIds()) {
        try {runtime().holdForOperatorPause(taskId);} catch { /* Already terminal or unchanged. */ }
      }
      return {...paused, paused: true};
    },
    async release() {
      await ensure().release();
      for (const task of runtime().listOperatorHolds()) {
        try {await continueHeld(task.taskId);} catch { /* Existing resume refused; the hold stays. */ }
      }
      return this.snapshot();
    },
    /** IPC entry used by the panel and workspace. Tray calls engage/release directly. */
    async handleAction(name, payload) {
      if (name !== OPERATOR_BRAKE_ACTION) return undefined;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1
        || typeof payload.paused !== 'boolean') throw Error('总暂停格式无效');
      return payload.paused ? this.engage() : this.release();
    },
  };
}

export function operatorBrakeTrayLabel(snapshot) {
  return snapshot?.paused === true ? '恢复运行' : '暂停全部';
}
