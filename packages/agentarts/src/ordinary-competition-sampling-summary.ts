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
  /**
   * Opportunities (taskKey + decisionRef) observed with more than one distinct record content,
   * e.g. after refreshShadowReceipt or a restart re-evaluates the same decision.
   * The merge rule below picks one deterministically; this counter keeps the conflict visible.
   */
  conflictingOpportunityCount: number;
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

/**
 * Type guard verifying that a value conforms to OrdinaryCompetitionSamplingRecord.
 *
 * Intentionally fail-closed (not a pure predicate): an `ordinary_competition_sampling` v1 record whose
 * execution markers are missing or not exactly `executed:false / actualExecutionVerified:false /
 * admissionIsNotExecution:true` throws INVALID_ARGUMENT instead of returning false. Such a record can only
 * come from corruption or forgery of the ledger written by admitOrdinaryCompetitionSampling, so the whole
 * summary/collection fails rather than silently dropping it and reporting a smaller, seemingly clean ledger.
 * Other structural mismatches (wrong kind/version, unknown action, ...) return false and are skipped.
 */
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

const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value as Record<string, unknown>).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';

/**
 * Deterministic merge rule for several distinct records of the same opportunity (taskKey + decisionRef):
 * 1. a `comparable` record wins over `unknown` (a later verified counterfactual supersedes a missing one;
 *    an unknown record never erases verified benefit, and benefit is never inferred for unknown);
 * 2. ties are broken by the lexicographically smallest canonical JSON of the record, so the same
 *    multiset of records always yields the same summary regardless of input order.
 * Records carry no trustworthy timestamp, so "latest" is deliberately not used.
 */
function pickOpportunityRecord(variants: Map<string, OrdinaryCompetitionSamplingRecord>): OrdinaryCompetitionSamplingRecord {
  let best: [string, OrdinaryCompetitionSamplingRecord] | undefined;
  for (const entry of variants) {
    if (!best) { best = entry; continue; }
    const rank = (record: OrdinaryCompetitionSamplingRecord) => record.comparison.status === 'comparable' ? 0 : 1;
    const delta = rank(entry[1]) - rank(best[1]);
    if (delta < 0 || (delta === 0 && entry[0] < best[0])) best = entry;
  }
  return best![1];
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
  // Group by opportunity first so the result never depends on input order.
  const groups = new Map<string, Map<string, OrdinaryCompetitionSamplingRecord>>();

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
    // JSON array encoding cannot collide the way `${taskKey}:${decisionRef}` does (e.g. 'a:b'+'c' vs 'a'+'b:c').
    const dedupKey = JSON.stringify([item.taskKey, item.decisionRef]);
    let variants = groups.get(dedupKey);
    if (!variants) groups.set(dedupKey, variants = new Map());
    else duplicateRecordCount++;
    variants.set(canonical(item), item);
  }

  let conflictingOpportunityCount = 0;
  for (const variants of groups.values()) {
    if (variants.size > 1) conflictingOpportunityCount++;
    const item = pickOpportunityRecord(variants);
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

  const totalOpportunities = groups.size;
  const unknownRatio = totalOpportunities === 0 ? 0 : Number((comparisons.unknown / totalOpportunities).toFixed(6));
  const totalBenefit = comparableCount > 0 ? Number(comparableBenefitSum.toFixed(6)) : null;
  const averageBenefit = comparableCount > 0 ? Number((comparableBenefitSum / comparableCount).toFixed(6)) : null;

  return {
    version: 1,
    kind: 'ordinary_competition_sampling_summary',
    totalOpportunities,
    rawRecordCount,
    duplicateRecordCount,
    conflictingOpportunityCount,
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

/**
 * Collect ordinary sampling records from a checkpoint reader for caller-supplied keys.
 * Fail-closed like isOrdinaryCompetitionSamplingRecord: one corrupt/forged ledger record throws for the whole
 * collection. There is no production key-listing entry yet; callers must supply the ledger keys.
 */
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
