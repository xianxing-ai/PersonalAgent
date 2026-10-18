import {performance} from 'node:perf_hooks';
import {ProtocolError} from '@personal-agent/contracts';
import {runFixedSyntheticBatch} from './fixed-synthetic-batch.mjs';

function invalid() {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid paired synthetic batch input');
}

function dataFields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const fields = [...required, ...optional];
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !fields.includes(key)) || required.some(key => !keys.includes(key))) invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function inputs(ports, options) {
  try {
    const {candidate, baseline} = dataFields(ports, ['candidate', 'baseline']);
    const {deadline, signal, repetitions = 1} = dataFields(options, ['deadline', 'signal'], ['repetitions']);
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3) invalid();
    // Preserve the fixed runner's canonical UTC, future absolute deadline contract.
    if (typeof deadline !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deadline)) invalid();
    const expiresAt = Date.parse(deadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || deadline.replace(/\.000Z$/, 'Z') !== new Date(expiresAt).toISOString().replace(/\.000Z$/, 'Z')
      || !(signal instanceof AbortSignal)) invalid();
    const capture = port => {
      if (!port || (typeof port !== 'object' && typeof port !== 'function')) invalid();
      const execute = port.execute;
      if (typeof execute !== 'function') invalid();
      return {execute: request => execute.call(port, request)};
    };
    return {candidate: capture(candidate), baseline: capture(baseline), deadline, signal, expiresAt, repetitions};
  } catch {
    invalid();
  }
}

function interrupted(batch) {
  return batch.cases.find(item => item.errorCode === 'CANCELLED' || item.errorCode === 'TIMEOUT')?.errorCode;
}

/**
 * Compare only the existing three-label synthetic classifications. Both ports are
 * caller-supplied; this runner selects no service, reads no credentials, and cannot
 * establish role execution, model quality, cloud availability, trace or token usage.
 */
export async function runPairedSyntheticBatch(ports, options) {
  const {candidate, baseline, deadline, signal, expiresAt, repetitions} = inputs(ports, options);
  const startedAt = performance.now();
  const batches = [];
  const pairs = [];
  let stopReason = null;
  const lifecycle = () => signal.aborted ? 'CANCELLED' : Date.now() >= expiresAt ? 'TIMEOUT' : null;
  for (let runIndex = 1; runIndex <= repetitions; runIndex++) {
    const results = {};
    // Alternate which port runs first to avoid always giving one the earlier budget.
    const order = runIndex % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const variant of order) {
      stopReason = lifecycle();
      if (stopReason) break;
      let result;
      try {
        result = await runFixedSyntheticBatch(variant === 'candidate' ? candidate : baseline, {deadline, signal});
      } catch (error) {
        // The original deadline may pass between the check and fixed-runner setup.
        stopReason = lifecycle();
        if (!stopReason) throw error;
        break;
      }
      batches.push({runIndex, variant, result});
      results[variant] = result;
      stopReason = interrupted(result) ?? lifecycle();
      if (stopReason) break;
    }
    if (results.candidate && results.baseline
      && !interrupted(results.candidate) && !interrupted(results.baseline)) {
      pairs.push({runIndex, total: results.candidate.counts.total,
        candidateCorrect: results.candidate.counts.passed, baselineCorrect: results.baseline.counts.passed,
        candidateDurationMs: results.candidate.durationMs, baselineDurationMs: results.baseline.durationMs});
    }
    if (stopReason) break;
  }
  const total = pairs.reduce((sum, pair) => sum + pair.total, 0);
  const candidateCorrect = pairs.reduce((sum, pair) => sum + pair.candidateCorrect, 0);
  const baselineCorrect = pairs.reduce((sum, pair) => sum + pair.baselineCorrect, 0);
  return {schemaVersion: '1.0', profile: 'huawei_ict_agentarts', synthetic: true,
    requestedPairs: repetitions, completedPairs: pairs.length, stopReason, batches, pairs,
    pairedClassification: {total, candidateCorrect, baselineCorrect,
      candidateAccuracy: total ? candidateCorrect / total : null,
      baselineAccuracy: total ? baselineCorrect / total : null,
      accuracyDelta: total ? (candidateCorrect - baselineCorrect) / total : null},
    durationMs: Math.max(0, Math.round(performance.now() - startedAt))};
}
