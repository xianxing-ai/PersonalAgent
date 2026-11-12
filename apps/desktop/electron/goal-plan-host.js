import {decomposeGoal} from '@personal-agent/goals';

const LABELS = {plan: '主计划', fast: '快速子任务', review: '复核', assigned: '已分派', running: '进行中', done: '完成', blocked: '受阻'};

/** Tracks subtasks for the current goal. Child progress comes from existing subagent records. */
export function createGoalPlanHost({listGoals, readChildren} = {}) {
  const plans = new Map();
  function listed() {
    try { return listGoals?.() ?? {goals: []}; }
    catch { return {goals: []}; }
  }
  function current() {
    return (listed().goals ?? []).filter(goal => goal?.state === 'active').at(-1) ?? null;
  }
  function sync(plan) {
    let children = [];
    try { children = readChildren?.() ?? []; }
    catch { children = []; }
    if (!Array.isArray(children)) return;
    for (const step of plan.subtasks) {
      const child = children.find(item => typeof item?.goal === 'string' && item.goal.includes(step.summary.slice(0, 40)));
      if (!child) continue;
      if (child.state === 'succeeded') step.state = 'done';
      else if (child.state === 'failed' || child.state === 'cancelled') step.state = 'blocked';
      else if (step.state !== 'done' && step.state !== 'blocked') step.state = 'running';
    }
  }
  return {
    snapshot() {
      const goal = current();
      if (!goal) return {goalId: '', revision: 0, subtasks: []};
      const plan = plans.get(goal.id);
      if (!plan || plan.revision !== goal.revision) return {goalId: goal.id, revision: goal.revision, summary: goal.summary, subtasks: []};
      sync(plan);
      return {goalId: goal.id, revision: goal.revision, summary: goal.summary, subtasks: plan.subtasks.map(step => ({...step}))};
    },
    decompose(goalId) {
      const goal = (listed().goals ?? []).find(item => item.id === goalId && item.state === 'active');
      if (!goal) throw Error('没有可拆的目标');
      const subtasks = decomposeGoal(goal.summary).map(step => ({...step, state: 'assigned'}));
      plans.set(goal.id, {revision: goal.revision, subtasks});
      return this.snapshot();
    },
    labels: LABELS,
  };
}

export {LABELS as goalPlanLabels};
