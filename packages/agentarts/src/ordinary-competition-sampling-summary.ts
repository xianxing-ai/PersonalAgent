import {ProtocolError} from '@personal-agent/contracts';
import type {OrdinaryCompetitionSamplingRecord} from './ordinary-competition-sampling.js';

export interface OrdinaryCompetitionSamplingSummary {
  version: 1;
  kind: 'ordinary_competition_sampling_summary';
  /** Total number of unique ordinary sampling opportunities deduplicated by task and decision reference */
  totalOpportunities: number;
  /** Total raw records observed before deduplication */
  rawRecordCount: number;
  /** Duplicate records suppressed to guarantee idempotent counting across restarts */
  duplicateRecordCount: number;
  /** Distribution across policy admission actions */
  actions: {
    run: number;
    defer: number;
    skip: number;
    need_teacher: number;
  };
  /** Opportunities marked as sampled by policy */
  sampledCount: number;
  /** Counterfactual comparison states distribution */
  comparisons: {
    unknown: number;
    comparable: number;
  };
  /** Ratio of unknown counterfactual comparisons over total opportunities [0, 1] (0 if total is 0) */
  unknownRatio: number;
  /**
   * Sum of verified net benefits across comparable samples.
   * Strictly null when no comparable samples exist.
   * Never inferred or defaulted when counterfactual is missing or unknown.
   */
  totalBenefit: number | null;
  /**
   * Arithmetic average verified benefit across comparable samples.
   * Strictly null when no comparable samples exist.
   */
  averageBenefit: number | null;
  /** Number of comparable samples with verified same-baseline quality */
  comparableCount: number;
  /** Execution counter - strictly 0; admission is never execution */
  executedCount: 0;
  executed: false;
  actualExecutionVerified: false;
  admissionIsNotExecution: true;
  provenance: 'experience_statistics_not_training';
  realEnvironmentAcceptance: 'not_performed';
}

const bad = (message: string): never => { throw new ProtocolError('INVALID_ARGUMENT', message); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Type guard verifying that a value conforms to OrdinaryCompetitionSamplingRecord. */
export function isOrdinaryCompetitionSamplingRecord(value: unknown): value is OrdinaryCompetitionSamplingRecord {
  if (!plain(value)) return false;
  if (value.kind !== 'ordinary_competition_sampling' || value.version !== 1) return false;
  // Forged execution claims are strictly rejected
  if (value.executed !== false || value.actualExecutionVerified !== false || value.admissionIsNotExecution !== true) {
    bad('Sampling record cannot claim actual execution');
  }
  if (!text(value.taskKey) || !text(value.taskClass) || value.taskClass === 'special-serial-pair' || !text(value.decisionRef)) {
    return false;
  }
  if (!['run', 'defer', 'skip', 'need_teacher'].includes(String(value.action))) return false;
  if (typeof value.sampled !== 'boolean') return false;
  if (!plain(value.comparison) || !['unknown', 'comparable'].includes(String(value.comparison.status))) return false;
  if (value.comparison.status === 'comparable') {
    if (value.benefit === null || typeof value.benefit !== 'number' || !Number.isFinite(value.benefit)) return false;
  } else {
    if (value.benefit !== null) return false;
  }
  return true;
}

/** Pure function summarizing ordinary competition sampling records with deduplication and unyielding counterfactual boundaries. */
export function summarizeOrdinaryCompetitionSampling(records: Iterable<unknown>): OrdinaryCompetitionSamplingSummary {
  let rawRecordCount = 0;
  let duplicateRecordCount = 0;
  const actions = {run: 0, defer: 0, skip: 0, need_teacher: 0};
  let sampledCount = 0;
  const comparisons = {unknown: 0, comparable: 0};
  let comparableBenefitSum = 0;
  let comparableCount = 0;
  const seenKeys = new Set<string>();

  for (const item of records ?? []) {
    if (!plain(item)) continue;
    // Intercept forged execution claims even if kind matches
    if (item.kind === 'ordinary_competition_sampling') {
      if (item.executed === true || item.actualExecutionVerified === true) {
        bad('Execution claim must not be forged in sampling record');
      }
      if (item.taskClass === 'special-serial-pair') {
        bad('Special serial comparison must not enter ordinary sampling ledger');
      }
    }
    if (!isOrdinaryCompetitionSamplingRecord(item)) continue;

    rawRecordCount++;
    const dedupKey = `${item.taskKey}:${item.decisionRef}`;
    if (seenKeys.has(dedupKey)) {
      duplicateRecordCount++;
      continue;
    }
    seenKeys.add(dedupKey);

    actions[item.action]++;
    if (item.sampled) sampledCount++;

    if (item.comparison.status === 'comparable' && item.benefit !== null) {
      comparisons.comparable++;
      comparableCount++;
      comparableBenefitSum += item.benefit;
    } else {
      comparisons.unknown++;
    }
  }

  const totalOpportunities = seenKeys.size;
  const unknownRatio = totalOpportunities === 0 ? 0 : Number((comparisons.unknown / totalOpportunities).toFixed(6));
  const totalBenefit = comparableCount > 0 ? Number(comparableBenefitSum.toFixed(6)) : null;
  const averageBenefit = comparableCount > 0 ? Number((comparableBenefitSum / comparableCount).toFixed(6)) : null;

  return {
    version: 1,
    kind: 'ordinary_competition_sampling_summary',
    totalOpportunities,
    rawRecordCount,
    duplicateRecordCount,
    actions,
    sampledCount,
    comparisons,
    unknownRatio,
    totalBenefit,
    averageBenefit,
    comparableCount,
    executedCount: 0,
    executed: false,
    actualExecutionVerified: false,
    admissionIsNotExecution: true,
    provenance: 'experience_statistics_not_training',
    realEnvironmentAcceptance: 'not_performed',
  };
}

/** Safe helper to collect ordinary sampling records from a checkpoint reader. */
export function collectOrdinaryCompetitionSamplingRecords(
  checkpoints: { read(taskId: string, key: string): unknown },
  taskId: string,
  keys: Iterable<string>
): OrdinaryCompetitionSamplingRecord[] {
  if (!checkpoints || typeof checkpoints.read !== 'function' || !text(taskId)) bad('Checkpoint reader and task ID required');
  const result: OrdinaryCompetitionSamplingRecord[] = [];
  for (const key of keys ?? []) {
    if (typeof key !== 'string' || !key.startsWith('owned-workflow:ordinary-sampling:')) continue;
    const value = checkpoints.read(taskId, key);
    if (isOrdinaryCompetitionSamplingRecord(value)) {
      result.push(value);
    }
  }
  return result;
}
