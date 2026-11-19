import {ProtocolError} from '@personal-agent/contracts';

/**
 * 金额是调用方给出的估算价目，不是 AgentArts 账单。
 * 平台 trace 里仍然写 cost=unavailable，因为读回里没有请求级费用。
 */
export interface ModelPriceCard {
  model: string;
  currency: 'CNY';
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface CostBudget {
  scope: 'user' | 'repo' | 'task';
  scopeId: string;
  currency: 'CNY';
  daily: number;
  perTask: number;
  onExceed: 'pause' | 'downgrade_model' | 'ask';
}

export interface BudgetReservation {
  id: string;
  scopeId: string;
  taskId: string;
  model: string;
  reserved: number;
  settled?: number;
  status: 'reserved' | 'settled' | 'released';
  day: string;
}

export interface BudgetState {
  reservations: BudgetReservation[];
}

export interface BudgetDecision {
  action: 'reserved' | 'pause' | 'downgrade_model' | 'ask';
  estimated: number;
  evidenceLevel: 'estimated';
  reason: string;
}

const fail = (message: string): never => {throw new ProtocolError('INVALID_ARGUMENT', message);};
const money = (value: number) => Math.round(value * 1000) / 1000;

export function estimateCost(price: ModelPriceCard, tokens: {input: number; output: number}): number {
  if (!price.model.trim() || price.currency !== 'CNY') fail('Price card is invalid');
  if (!Number.isFinite(price.inputPerMillion) || price.inputPerMillion < 0 || !Number.isFinite(price.outputPerMillion) || price.outputPerMillion < 0) fail('Price card is invalid');
  if (!Number.isSafeInteger(tokens.input) || tokens.input < 0 || !Number.isSafeInteger(tokens.output) || tokens.output < 0) fail('Token count is invalid');
  return money((tokens.input / 1_000_000) * price.inputPerMillion + (tokens.output / 1_000_000) * price.outputPerMillion);
}

export function assertBudget(budget: CostBudget): void {
  if (!['user', 'repo', 'task'].includes(budget.scope) || !budget.scopeId.trim()) fail('Budget scope is invalid');
  if (budget.currency !== 'CNY' || !Number.isFinite(budget.daily) || budget.daily <= 0 || !Number.isFinite(budget.perTask) || budget.perTask <= 0 || budget.perTask > budget.daily) fail('Budget amount is invalid');
  if (!['pause', 'downgrade_model', 'ask'].includes(budget.onExceed)) fail('Budget exceed action is invalid');
}

function spent(state: BudgetState, budget: CostBudget, taskId: string, day: string): {daily: number; task: number} {
  const rows = state.reservations.filter(item => item.scopeId === budget.scopeId && item.status !== 'released' && item.day === day);
  const daily = rows.reduce((sum, item) => sum + (item.status === 'settled' ? item.settled ?? item.reserved : item.reserved), 0);
  const task = rows.filter(item => item.taskId === taskId).reduce((sum, item) => sum + (item.status === 'settled' ? item.settled ?? item.reserved : item.reserved), 0);
  return {daily: money(daily), task: money(task)};
}

export function reserveBudget(state: BudgetState, budget: CostBudget, input: {id: string; taskId: string; model: string; estimated: number; now: number}): {state: BudgetState; decision: BudgetDecision; reservation?: BudgetReservation} {
  assertBudget(budget);
  if (!input.id.trim() || !input.taskId.trim() || !Number.isFinite(input.estimated) || input.estimated < 0) fail('Reservation is invalid');
  if (state.reservations.some(item => item.id === input.id)) fail('Reservation id already exists');
  const day = new Date(input.now).toISOString().slice(0, 10);
  const used = spent(state, budget, input.taskId, day);
  const nextDaily = money(used.daily + input.estimated);
  const nextTask = money(used.task + input.estimated);
  if (nextDaily > budget.daily || nextTask > budget.perTask) {
    return {state, decision: {action: budget.onExceed, estimated: money(input.estimated), evidenceLevel: 'estimated', reason: 'estimated cost exceeds the budget'}};
  }
  const reservation: BudgetReservation = {id: input.id, scopeId: budget.scopeId, taskId: input.taskId, model: input.model, reserved: money(input.estimated), status: 'reserved', day};
  return {state: {reservations: [...state.reservations, reservation]}, reservation, decision: {action: 'reserved', estimated: reservation.reserved, evidenceLevel: 'estimated', reason: 'estimated cost reserved'}};
}

export function settleBudget(state: BudgetState, input: {id: string; actual: number}): BudgetState {
  if (!Number.isFinite(input.actual) || input.actual < 0) fail('Settlement is invalid');
  const current = state.reservations.find(item => item.id === input.id);
  if (!current || current.status !== 'reserved') fail('Reservation is not open');
  return {reservations: state.reservations.map(item => item.id === input.id ? {...item, status: 'settled', settled: money(input.actual)} : item)};
}

export function releaseBudget(state: BudgetState, id: string): BudgetState {
  const current = state.reservations.find(item => item.id === id);
  if (!current || current.status !== 'reserved') fail('Reservation is not open');
  return {reservations: state.reservations.map(item => item.id === id ? {...item, status: 'released', settled: 0} : item)};
}

export function budgetSpent(state: BudgetState, scopeId: string): {currency: 'CNY'; amount: number; evidenceLevel: 'estimated'} {
  const amount = state.reservations.filter(item => item.scopeId === scopeId && item.status === 'settled').reduce((sum, item) => sum + (item.settled ?? 0), 0);
  return {currency: 'CNY', amount: money(amount), evidenceLevel: 'estimated'};
}
