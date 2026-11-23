import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replayRepairTrace, summarizeRepairFailure} from '../src/repair-replay.mjs';
import {appendRepairAttempt, decideRepair, emptyRepairTrace} from '@personal-agent/agentarts';

const deadline = () => new Date(Date.now() + 60_000).toISOString();

test('runtime repair replay only restates the recorded decision', () => {
  const source = readFileSync(new URL('../src/repair-replay.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('submitHostToolTask'), false);
  assert.equal(source.includes('fetch('), false);
  const decision = decideRepair({
    effect: 'write', outcome: 'unknown', signal: {code: 'TIMEOUT'}, parentCanReplan: true,
  }, emptyRepairTrace(), {now: () => Date.parse('2026-11-11T00:00:00.000Z'), maxAttempts: 4, baseDelayMs: 200, maxDelayMs: 8000, maxElapsedMs: 60000});
  const trace = appendRepairAttempt(emptyRepairTrace(), decision);
  const replay = replayRepairTrace(trace, {signal: new AbortController().signal, deadline: deadline()});
  assert.equal(decision.strategy, 'reconcile_status');
  assert.equal(replay.actualToolCalls, 0);
  assert.equal(replay.actualWrites, 0);
  assert.equal(replay.actualModelCalls, 0);
  assert.equal(replay.timeline[0].executedDuringReplay, false);
  const summary = summarizeRepairFailure(trace);
  assert.equal(summary.lastStrategy, 'reconcile_status');
  assert.match(summary.lastReason, /reconcile status before any retry/);
  assert.equal(summary.unknownWriteBlindRetry, false);
});
