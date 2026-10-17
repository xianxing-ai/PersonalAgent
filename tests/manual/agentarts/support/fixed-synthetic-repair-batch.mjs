import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ProtocolError} from '@personal-agent/contracts';
import {CompetitionCoordinator, parseCoordinationRepairCandidate} from '@personal-agent/coordination';
import {buildFixedSyntheticRepairCases} from './fixed-synthetic-repair-cases.mjs';
import {scoreRepairProposal, scoreRepairReadback} from './fixed-synthetic-repair-score.mjs';

const ERRORS = new Set(['CANCELLED', 'TIMEOUT', 'UNSUPPORTED_CAPABILITY',
  'EXTERNAL_FAILURE', 'INVALID_ARGUMENT']);

function invalid() {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid fixed synthetic repair batch input');
}

function inputs(port, options) {
  try {
    if (!port || !['object', 'function'].includes(typeof port)) invalid();
    const execute = port.execute;
    if (typeof execute !== 'function' || !options || typeof options !== 'object'
      || Array.isArray(options)) invalid();
    const keys = Reflect.ownKeys(options);
    if (keys.some(key => !['deadline', 'signal', 'repetitions', 'readback'].includes(key))
      || !keys.includes('deadline') || !keys.includes('signal')) invalid();
    const copy = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
      copy[key] = descriptor.value;
    }
    const {deadline, signal, repetitions = 1} = copy;
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3
      || typeof deadline !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deadline)) invalid();
    const expiresAt = Date.parse(deadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || deadline.replace(/\.000Z$/, 'Z') !== new Date(expiresAt).toISOString().replace(/\.000Z$/, 'Z')
      || !(signal instanceof AbortSignal)) invalid();
    let read;
    if (keys.includes('readback')) {
      if (!copy.readback || typeof copy.readback !== 'object' || Array.isArray(copy.readback)) invalid();
      const method = copy.readback.read;
      if (typeof method !== 'function') invalid();
      read = request => method.call(copy.readback, request);
    }
    return {execute: request => execute.call(port, request), deadline, signal, repetitions, expiresAt, read};
  } catch {
    invalid();
  }
}

function fixedError(error, fallback) {
  try {if (error instanceof ProtocolError && ERRORS.has(error.code)) return error.code;} catch {}
  return fallback;
}

async function readWithinDeadline(read, request, expiresAt) {
  const controller = new AbortController();
  let timer, rejectWait;
  const interrupted = new Promise((_, reject) => { rejectWait = reject; });
  const stop = code => {
    controller.abort();
    rejectWait(new ProtocolError(code, 'Synthetic repair readback interrupted'));
  };
  const abort = () => stop('CANCELLED');
  const check = () => {
    if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Synthetic repair readback interrupted');
    if (Date.now() >= expiresAt) throw new ProtocolError('TIMEOUT', 'Synthetic repair readback interrupted');
  };
  const schedule = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) stop('TIMEOUT');
    else timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
  };
  request.signal.addEventListener('abort', abort, {once: true});
  try {
    check(); schedule();
    const value = await Promise.race([interrupted, Promise.resolve().then(() => {
      check();
      return read(Object.freeze({...request, signal: controller.signal}));
    })]);
    check();
    return value;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

export function summarizeRepairScopes(scopes) {
  const scores = scopes.filter(Boolean);
  const result = {scoredCases: scores.length};
  for (const key of ['required', 'proposed', 'targetHits', 'unrelated', 'missed', 'correctlyRepaired', 'unrepaired']) {
    result[key] = scores.reduce((sum, score) => sum + score[key], 0);
  }
  return {...result, precision: result.proposed ? result.targetHits / result.proposed : null,
    recall: result.required ? result.targetHits / result.required : null,
    repairRecall: result.required ? result.correctlyRepaired / result.required : null};
}

/**
 * Scores only fixed, synthetic minimum repairs. No service selection, credentials,
 * graph/tool/task writes, or platform trace/quality claims are made by this runner.
 */
export async function runFixedSyntheticRepairBatch(port, options) {
  const {execute, deadline, signal, repetitions, expiresAt, read} = inputs(port, options);
  const fixtures = buildFixedSyntheticRepairCases().map(item => ({caseId: item.caseId,
    goal: item.goal, snapshot: item.snapshot, expected: parseCoordinationRepairCandidate({kind: 'repair_candidate',
      candidateVersion: '1.0', candidate: item.expected, verification: 'unverified'}).candidate}));
  const coordinator = new CompetitionCoordinator({invoke: execute});
  const lifecycle = () => signal.aborted ? 'CANCELLED' : Date.now() >= expiresAt ? 'TIMEOUT' : null;
  const startedAt = performance.now();
  const cases = [];
  let stopReason = null;
  for (let runIndex = 1; runIndex <= repetitions; runIndex++) {
    for (const fixture of fixtures) {
      stopReason = lifecycle();
      if (stopReason) break;
      const began = performance.now();
      let entry;
      let scope = null;
      let readback = {status: read ? 'not_run' : 'not_requested', errorCode: 'NONE', checks: null, scope: null};
      try {
        const taskId = randomUUID();
        const result = await coordinator.execute({taskId, revision: 1,
          goal: fixture.goal, deadline, signal});
        if (result.kind !== 'repair_candidate') {
          entry = {status: 'failed', verification: result.verification,
            errorCode: 'RESULT_KIND_MISMATCH', checks: null};
        } else {
          const scored = scoreRepairProposal(result.candidate, fixture.expected);
          const {checks} = scored;
          scope = scored.scope;
          const matched = Object.values(checks).every(Boolean);
          entry = {status: matched ? 'passed' : 'failed', verification: result.verification,
            errorCode: matched ? 'NONE' : 'REPAIR_MISMATCH', checks};
          if (read) {
            try {
              const observation = await readWithinDeadline(read, {taskId, caseId: fixture.caseId,
                runIndex, deadline, signal}, expiresAt);
              const scoredReadback = scoreRepairReadback(observation, {taskId, fixture, candidate: result.candidate});
              const interruption = lifecycle();
              if (interruption) throw new ProtocolError(interruption, 'Synthetic repair readback interrupted');
              readback = {...scoredReadback, errorCode: 'NONE'};
              if (readback.status === 'failed') readback.errorCode = 'READBACK_MISMATCH';
            } catch (error) {
              readback = {status: 'error', errorCode: fixedError(error, 'EVALUATION_READBACK_FAILED'),
                checks: null, scope: null};
            }
          }
        }
      } catch (error) {
        const code = fixedError(error, 'EVALUATION_EXECUTION_FAILED');
        entry = {status: 'error', verification: null, errorCode: code, checks: null};
      }
      cases.push({caseId: fixture.caseId, runIndex, ...entry, scope, readback,
        durationMs: Math.max(0, Math.round(performance.now() - began))});
      stopReason = ['CANCELLED', 'TIMEOUT'].includes(entry.errorCode) ? entry.errorCode
        : ['CANCELLED', 'TIMEOUT'].includes(readback.errorCode) ? readback.errorCode : lifecycle();
      if (stopReason) break;
    }
    if (stopReason) break;
  }
  const counts = {total: fixtures.length * repetitions, attempted: cases.length,
    passed: cases.filter(item => item.status === 'passed').length,
    failed: cases.filter(item => item.status === 'failed').length,
    error: cases.filter(item => item.status === 'error').length,
    notRun: fixtures.length * repetitions - cases.length};
  return {schemaVersion: '1.0', profile: 'huawei_ict_agentarts', synthetic: true,
    evaluationMode: read ? 'local-readback' : 'proposal-only',
    verification: 'unverified', requestedRepetitions: repetitions, stopReason, counts,
    accuracy: counts.attempted ? counts.passed / counts.attempted : null, cases,
    scopeSummary: summarizeRepairScopes(cases.map(item => item.scope)),
    readbackCounts: Object.fromEntries(['passed', 'failed', 'error', 'not_run', 'not_requested']
      .map(status => [status, cases.filter(item => item.readback.status === status).length])),
    readbackScopeSummary: summarizeRepairScopes(cases.map(item => item.readback.scope)),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt))};
}
