import {performance} from 'node:perf_hooks';
import {ProtocolError} from '@personal-agent/contracts';
import {runFixedSyntheticRepairBatch, summarizeRepairScopes} from './fixed-synthetic-repair-batch.mjs';

function invalid() {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid paired synthetic repair batch input');
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Reflect.ownKeys(value), allowed = [...required, ...optional];
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !keys.includes(key))) invalid();
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
    const {candidate, baseline} = fields(ports, ['candidate', 'baseline']);
    const {deadline, signal, repetitions = 1, readbacks} = fields(options,
      ['deadline', 'signal'], ['repetitions', 'readbacks']);
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3
      || typeof deadline !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deadline)) invalid();
    const expiresAt = Date.parse(deadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || deadline.replace(/\.000Z$/, 'Z') !== new Date(expiresAt).toISOString().replace(/\.000Z$/, 'Z')
      || !(signal instanceof AbortSignal)) invalid();
    const capture = port => {
      if (!port || !['object', 'function'].includes(typeof port)) invalid();
      const execute = port.execute;
      if (typeof execute !== 'function') invalid();
      return {execute: request => execute.call(port, request)};
    };
    let readers;
    if (readbacks !== undefined) {
      const sides = fields(readbacks, ['candidate', 'baseline']);
      readers = {};
      for (const variant of ['candidate', 'baseline']) {
        const port = sides[variant];
        if (!port || typeof port !== 'object' || Array.isArray(port)) invalid();
        const read = port.read;
        if (typeof read !== 'function') invalid();
        readers[variant] = {read: request => read.call(port, request)};
      }
    } else if (Object.hasOwn(options, 'readbacks')) invalid();
    return {candidate: capture(candidate), baseline: capture(baseline), deadline, signal, repetitions, expiresAt, readers};
  } catch { invalid(); }
}

const complete = batch => batch.counts.total === 3 && batch.counts.attempted === 3
  && batch.counts.notRun === 0 && batch.stopReason === null;

/** Caller-supplied ports only; compares the existing fixed repairs without creating
 * new expectations, selecting services, reading credentials or writing graphs. */
export async function runPairedSyntheticRepairBatch(ports, options) {
  const {candidate, baseline, deadline, signal, repetitions, expiresAt, readers} = inputs(ports, options);
  const lifecycle = () => signal.aborted ? 'CANCELLED' : Date.now() >= expiresAt ? 'TIMEOUT' : null;
  const began = performance.now();
  const batches = [], pairs = [];
  const pairedCases = {candidate: [], baseline: []};
  let stopReason = null;
  for (let runIndex = 1; runIndex <= repetitions; runIndex++) {
    const results = {};
    const order = runIndex % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const variant of order) {
      stopReason = lifecycle();
      if (stopReason) break;
      let result;
      try {
        result = await runFixedSyntheticRepairBatch(variant === 'candidate' ? candidate : baseline,
          {deadline, signal, ...(readers ? {readback: readers[variant]} : {})});
      } catch (error) {
        // The same original deadline can expire during fixed-runner setup.
        stopReason = lifecycle();
        if (!stopReason) throw error;
        break;
      }
      batches.push({runIndex, variant, result});
      results[variant] = result;
      stopReason = result.stopReason ?? lifecycle();
      if (stopReason) break;
    }
    if (results.candidate && results.baseline && complete(results.candidate) && complete(results.baseline)) {
      for (const variant of ['candidate', 'baseline']) pairedCases[variant].push(...results[variant].cases);
      pairs.push({runIndex, total: 3,
        candidateCorrect: results.candidate.counts.passed, baselineCorrect: results.baseline.counts.passed,
        candidateErrors: results.candidate.counts.error, baselineErrors: results.baseline.counts.error,
        candidateDurationMs: results.candidate.durationMs, baselineDurationMs: results.baseline.durationMs});
    }
    if (stopReason) break;
  }
  const total = pairs.reduce((sum, pair) => sum + pair.total, 0);
  const candidateCorrect = pairs.reduce((sum, pair) => sum + pair.candidateCorrect, 0);
  const baselineCorrect = pairs.reduce((sum, pair) => sum + pair.baselineCorrect, 0);
  return {schemaVersion: '1.0', profile: 'huawei_ict_agentarts', synthetic: true, verification: 'unverified',
    evaluationMode: readers ? 'local-readback' : 'proposal-only',
    requestedPairs: repetitions, completedPairs: pairs.length, stopReason, batches, pairs,
    pairedRepairQuality: {total, candidateCorrect, baselineCorrect,
      candidateAccuracy: total ? candidateCorrect / total : null,
      baselineAccuracy: total ? baselineCorrect / total : null,
      accuracyDelta: total ? (candidateCorrect - baselineCorrect) / total : null},
    pairedScopeQuality: Object.fromEntries(['candidate', 'baseline'].map(variant =>
      [variant, summarizeRepairScopes(pairedCases[variant].map(item => item.scope))])),
    pairedReadbackQuality: Object.fromEntries(['candidate', 'baseline'].map(variant => [variant, {
      counts: Object.fromEntries(['passed', 'failed', 'error', 'not_run', 'not_requested']
        .map(status => [status, pairedCases[variant].filter(item => item.readback.status === status).length])),
      scope: summarizeRepairScopes(pairedCases[variant].map(item => item.readback.scope)),
    }])),
    durationMs: Math.max(0, Math.round(performance.now() - began))};
}
