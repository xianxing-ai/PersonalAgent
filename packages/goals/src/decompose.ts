import {GraphError} from './index.js';

export interface PlannedSubtask {
  id: string;
  summary: string;
  assignee: 'plan' | 'fast' | 'review';
}

const ROLES = ['plan', 'fast', 'review'] as const;

/** Split one active goal into ordered subtasks. This does not write the graph or dispatch a child. */
export function decomposeGoal(summary: string): PlannedSubtask[] {
  if (typeof summary !== 'string' || !summary.trim()) throw new GraphError('INVALID_ARGUMENT', 'Invalid goal summary');
  const text = summary.trim();
  const lines = text.split(/\n+|；|;|(?:^|\s)\d+[.、)]\s+/).map(item => item.trim()).filter(item => item.length >= 2);
  const clauses = lines.length > 1 ? lines : text.split(/，|,(?=\s)/).map(item => item.trim()).filter(item => item.length >= 4);
  const steps = (clauses.length ? clauses : [text]).slice(0, 8);
  return steps.map((item, index) => ({
    id: `step-${index + 1}`,
    summary: item.slice(0, 240),
    assignee: ROLES[index % ROLES.length]!,
  }));
}
