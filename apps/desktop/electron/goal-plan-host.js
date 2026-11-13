import {decomposeGoal} from '@personal-agent/goals';
import {randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const LABELS = {plan: '主计划', fast: '快速子任务', review: '复核', assigned: '已分派', running: '进行中', done: '完成', blocked: '受阻'};

function atomicWriteJson(file, value) {
  mkdirSync(path.dirname(file), {recursive: true});
  const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  let renamed = false;
  try {
    fd = openSync(tempFile, 'w');
    writeFileSync(fd, JSON.stringify(value), 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempFile, file);
    renamed = true;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    if (!renamed && existsSync(tempFile)) {
      try { rmSync(tempFile, {force: true}); } catch {}
    }
  }
}

function loadPersistedPlans(file) {
  const map = new Map();
  if (!file || !existsSync(file)) return map;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
    for (const [goalId, plan] of Object.entries(parsed)) {
      if (!plan || typeof plan !== 'object' || !Number.isSafeInteger(plan.revision) || !Array.isArray(plan.subtasks)) continue;
      map.set(goalId, {
        revision: plan.revision,
        subtasks: plan.subtasks.map(step => ({
          id: String(step.id ?? ''),
          summary: String(step.summary ?? ''),
          assignee: String(step.assignee ?? 'plan'),
          state: String(step.state ?? 'assigned'),
          ...(typeof step.taskId === 'string' && step.taskId ? {taskId: step.taskId} : {}),
          ...(typeof step.subtaskId === 'string' && step.subtaskId ? {subtaskId: step.subtaskId} : {}),
        })),
      });
    }
  } catch {
    // Ignore corrupted cache and let fresh decomposition overwrite cleanly.
  }
  return map;
}

/** Tracks and persists subtasks for the current goal. Child progress is associated strictly by ID. */
export function createGoalPlanHost({userData, listGoals, readChildren} = {}) {
  const file = userData ? path.join(userData, 'goal-plans.json') : '';
  const plans = loadPersistedPlans(file);
  function persist() {
    if (!file) return;
    atomicWriteJson(file, Object.fromEntries(plans));
  }
  function listed() {
    try { return listGoals?.() ?? {goals: []}; }
    catch { return {goals: []}; }
  }
  function current() {
    return (listed().goals ?? []).filter(goal => goal?.state === 'active').at(-1) ?? null;
  }
  function matchChild(step, children, goalId) {
    return children.find(item => {
      if (!item || typeof item !== 'object') return false;
      if (typeof step.taskId === 'string' && step.taskId && item.taskId === step.taskId) return true;
      if (typeof step.subtaskId === 'string' && step.subtaskId && item.subtaskId === step.subtaskId) return true;
      if (typeof item.subtaskId === 'string' && item.subtaskId === step.id && (!item.goalId || item.goalId === goalId)) return true;
      if (typeof item.planStepId === 'string' && item.planStepId === step.id && (!item.goalId || item.goalId === goalId)) return true;
      return false;
    });
  }
  function sync(goalId, plan) {
    let children = [];
    try { children = readChildren?.() ?? []; }
    catch { children = []; }
    if (!Array.isArray(children) || !children.length) return;
    let changed = false;
    for (const step of plan.subtasks) {
      const child = matchChild(step, children, goalId);
      if (!child) continue;
      if (typeof child.taskId === 'string' && child.taskId && step.taskId !== child.taskId) {
        step.taskId = child.taskId;
        changed = true;
      }
      if (typeof child.subtaskId === 'string' && child.subtaskId && step.subtaskId !== child.subtaskId) {
        step.subtaskId = child.subtaskId;
        changed = true;
      }
      const nextState = child.state === 'succeeded' ? 'done'
        : (child.state === 'failed' || child.state === 'cancelled') ? 'blocked'
        : (step.state !== 'done' && step.state !== 'blocked') ? 'running'
        : step.state;
      if (step.state !== nextState) {
        step.state = nextState;
        changed = true;
      }
    }
    if (changed) persist();
  }
  return {
    snapshot() {
      const goal = current();
      if (!goal) return {goalId: '', revision: 0, subtasks: []};
      const plan = plans.get(goal.id);
      if (!plan || plan.revision !== goal.revision) return {goalId: goal.id, revision: goal.revision, summary: goal.summary, subtasks: []};
      sync(goal.id, plan);
      return {goalId: goal.id, revision: goal.revision, summary: goal.summary, subtasks: plan.subtasks.map(step => ({...step}))};
    },
    decompose(goalId) {
      const goal = (listed().goals ?? []).find(item => item.id === goalId && item.state === 'active');
      if (!goal) throw Error('没有可拆的目标');
      const subtasks = decomposeGoal(goal.summary).map(step => ({...step, state: 'assigned'}));
      plans.set(goal.id, {revision: goal.revision, subtasks});
      persist();
      return this.snapshot();
    },
    bindChild({goalId, stepId, taskId, subtaskId} = {}) {
      if (typeof goalId !== 'string' || !goalId.trim() || typeof stepId !== 'string' || !stepId.trim()) {
        throw Error('子任务关联参数无效');
      }
      if ((typeof taskId !== 'string' || !taskId.trim()) && (typeof subtaskId !== 'string' || !subtaskId.trim())) {
        throw Error('必须提供有效的任务或子任务 ID');
      }
      const plan = plans.get(goalId);
      if (!plan) throw Error('未找到对应的目标计划');
      const step = plan.subtasks.find(item => item.id === stepId);
      if (!step) throw Error('未找到对应的计划步骤');
      if (typeof taskId === 'string' && taskId.trim()) step.taskId = taskId.trim();
      if (typeof subtaskId === 'string' && subtaskId.trim()) step.subtaskId = subtaskId.trim();
      persist();
      return this.snapshot();
    },
    labels: LABELS,
  };
}

export {LABELS as goalPlanLabels};
