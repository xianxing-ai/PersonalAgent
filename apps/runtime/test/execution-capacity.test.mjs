import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_COORDINATION_INITIAL_QUERY_BYTES} from '@personal-agent/contracts';
import {advanceExecutionCapacity, assertExecutionCapacityReceiptPrefix, createExecutionCapacity, MAX_OMITTED_TOOL_SUMMARIES,
  MAX_PRIOR_EXECUTION_CONTINUATIONS, resolveExecutionStepLimit, selectContinuationContext} from '../src/application/execution-capacity.ts';

const deadline = '2030-01-01T00:00:00.000Z';
const nowMs = Date.parse('2026-10-24T00:00:00.000Z');
const signal = new AbortController().signal;
const capacity = (options = {}) => createExecutionCapacity({enabled: true, initialWindowSteps: 4,
  deadline, ...options});
const advance = (state, receipts, options = {}) => advanceExecutionCapacity(state,
  {step: state?.windowEndStep ?? 4, deadline, nowMs, signal, receipts, ...options});
function receipt(index, options = {}) {
  const proposal = {kind: 'tool_proposal', proposalId: `proposal-${index}`, toolName: 'workspace.read_file',
    toolVersion: '1.0.0', arguments: {path: `src/file-${index}.ts`}, verification: 'unverified', ...options.proposal};
  return {proposal, continuation: {proposalId: proposal.proposalId, state: 'confirmed',
    result: {text: `original-result-${index}`}, ...options.continuation}};
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function select(receipts, options = {}) {
  return selectContinuationContext({receipts, current: receipts.at(-1).continuation, ...options});
}
function serializedQuery(selection, queryBase = {}) {
  return JSON.stringify({...queryBase, continuation: selection.continuation,
    ...(selection.priorContinuations.length ? {priorContinuations: selection.priorContinuations} : {})});
}

test('legacy or explicitly disabled tasks never acquire progressive windows', () => {
  assert.equal(createExecutionCapacity({initialWindowSteps: 4, deadline}), undefined);
  assert.equal(capacity({enabled: false}), undefined);
  assert.deepEqual(advance(undefined, [receipt(1)]), {state: undefined, extended: false, reason: 'disabled'});
});

test('new enabled state is serializable host capacity without an implicit project limit', () => {
  const state = capacity();
  assert.equal(state.windowEndStep, 4);
  assert.equal(state.windowSteps, 4);
  assert.equal(state.maxSteps, undefined);
  assert.equal(Object.hasOwn(state, 'maxSteps'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('host readers use only a validated window bound to the original budget and deadline', () => {
  assert.equal(resolveExecutionStepLimit(4, undefined, deadline), 4, 'Legacy tasks keep their original limit');
  const state = advance(capacity(), [receipt(1)]).state;
  assert.equal(resolveExecutionStepLimit(4, state, deadline), 8);
  assert.throws(() => resolveExecutionStepLimit(6, state, deadline), {code: 'UNAUTHORIZED'});
  assert.throws(() => resolveExecutionStepLimit(4, state, '2031-01-01T00:00:00.000Z'), {code: 'UNAUTHORIZED'});
  for (const invalid of [null, {...state, windowEndStep: 99}, {...state, extensions: -1},
    {...state, untrustedBudget: 100}, {...state, maxSteps: 5}]) {
    assert.throws(() => resolveExecutionStepLimit(4, invalid, deadline), {code: 'INVALID_ARGUMENT'});
  }
  for (const invalid of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveExecutionStepLimit(invalid, undefined, deadline), {code: 'INVALID_ARGUMENT'});
  }
  const bounded = advance(capacity({maxSteps: 6}), [receipt(1)]).state;
  assert.equal(resolveExecutionStepLimit(4, bounded, deadline), 6, 'Explicit limits still clamp expanded windows');
});

test('host readers bind the evaluated prefix to original proposal, action and confirmation identities', () => {
  const originals=deepFreeze([receipt(1),receipt(2)]),state=advance(capacity(),originals).state;
  assertExecutionCapacityReceiptPrefix(state,originals);
  assertExecutionCapacityReceiptPrefix(state,[...originals,receipt(3)]);
  assertExecutionCapacityReceiptPrefix(capacity(),[]);
  for(const replaced of [originals.slice(1),[receipt(9),originals[1]],
    [receipt(1,{proposal:{arguments:{path:'replaced.ts'}}}),originals[1]],
    [receipt(1,{proposal:{verification:'mock'}}),originals[1]],
    [receipt(1,{continuation:{state:'failed'}}),originals[1]]]) {
    assert.throws(()=>assertExecutionCapacityReceiptPrefix(state,replaced),{code:'REVISION_CONFLICT'});
  }
  assert.throws(()=>assertExecutionCapacityReceiptPrefix({...state,evaluatedReceiptDigest:'0'.repeat(64)},originals),
    {code:'REVISION_CONFLICT'});
  assert.throws(()=>assertExecutionCapacityReceiptPrefix({...capacity(),evaluatedReceiptDigest:'0'.repeat(64)},[]),
    {code:'REVISION_CONFLICT'});
  assert.deepEqual(originals,[receipt(1),receipt(2)]);
});

test('confirmed progress can extend only at the exact current window boundary', () => {
  const state = deepFreeze(capacity());
  assert.equal(advance(state, [receipt(1)], {step: 3}).reason, 'window_open');
  assert.throws(() => advance(state, [receipt(1)], {step: 5}), {code: 'INVALID_ARGUMENT'});
  const decision = advance(state, [receipt(1)]);
  assert.equal(decision.reason, 'extended');
  assert.equal(decision.state.windowEndStep, 8);
  assert.equal(state.windowEndStep, 4);
  assert.equal(decision.state.deadline, deadline);
});

test('150 distinct confirmed read/write/test actions continue across windows with constant state', () => {
  let state = capacity({initialWindowSteps: 2, windowSteps: 3});
  const originals = [];
  for (let step = 1; step <= 150; step++) {
    if (step === state.windowEndStep) {
      const resumed = JSON.parse(JSON.stringify(state));
      const decision = advance(resumed, originals, {step});
      assert.equal(decision.extended, true, `window at step ${step}`);
      state = decision.state;
    }
    const toolName = ['workspace.read_file', 'workspace.apply_patch', 'workspace.run_tests'][step % 3];
    originals.push(receipt(step, {proposal: {toolName, arguments: {path: `src/distinct-${step}.ts`, revision: step}}}));
  }
  assert.ok(state.windowEndStep > 150);
  assert.ok(state.extensions > 32);
  assert.ok(Object.values(state).every(value => value === null || typeof value !== 'object'));
  assert.ok(JSON.stringify(state).length < 512);
  assert.doesNotMatch(JSON.stringify(state), /distinct-|arguments|original-result/);
  assert.equal(originals.length, 150);
});

test('same action with new proposal IDs and changing timestamps cannot renew windows indefinitely', () => {
  let originals = [receipt(1, {proposal: {arguments: {path: 'same-file.ts'}}, continuation: {result: {timestamp: 1}}})];
  const first = advance(capacity(), originals);
  assert.equal(first.extended, true);
  originals = [...originals, receipt(2, {proposal: {arguments: {path: 'same-file.ts'}}, continuation: {result: {timestamp: 2}}})];
  const second = advance(first.state, originals);
  assert.equal(second.extended, false);
  assert.equal(second.reason, 'no_confirmed_progress');
});

test('canonical arguments prevent key order changes from manufacturing progress', () => {
  const originals = [receipt(1, {proposal: {arguments: {path: 'same.ts', settings: {a: 1, b: [2, 3]}}}})];
  const first = advance(capacity(), originals);
  originals.push(receipt(2, {proposal: {arguments: {settings: {b: [2, 3], a: 1}, path: 'same.ts'}}}));
  assert.equal(advance(first.state, originals).reason, 'no_confirmed_progress');
});

test('replaying an old A/B cycle beyond 32 receipts does not create new progress', () => {
  const originals = Array.from({length: 40}, (_, index) => receipt(index,
    {proposal: {arguments: {path: index % 2 ? 'A.ts' : 'B.ts'}}}));
  const first = advance(capacity(), originals);
  originals.push(...Array.from({length: 40}, (_, index) => receipt(40 + index,
    {proposal: {arguments: {path: index % 2 ? 'A.ts' : 'B.ts'}}})));
  assert.equal(advance(first.state, originals).reason, 'no_confirmed_progress');
});

test('a distinct registered tool version or name is a new action', () => {
  const originals = [receipt(1, {proposal: {arguments: {path: 'same.ts'}}})];
  const first = advance(capacity(), originals);
  originals.push(receipt(2, {proposal: {toolVersion: '2.0.0', arguments: {path: 'same.ts'}}}));
  const second = advance(first.state, originals);
  assert.equal(second.extended, true);
  originals.push(receipt(3, {proposal: {toolName: 'workspace.run_tests', arguments: {path: 'same.ts'}}}));
  assert.equal(advance(second.state, originals).extended, true);
});

test('empty, mock, pending and unknown receipts cannot supply progressive capacity', () => {
  assert.equal(advance(capacity(), []).reason, 'no_confirmed_progress');
  assert.equal(advance(capacity(), [receipt(1, {proposal: {verification: 'mock'}})]).reason, 'no_confirmed_progress');
  for (const state of ['pending', 'unknown']) {
    assert.equal(advance(capacity(), [receipt(1, {continuation: {state}})]).reason, 'unconfirmed_progress');
  }
});

test('explicit user step limit clamps the final window and cannot be raised by progress', () => {
  const originals = [receipt(1)];
  const first = advance(capacity({maxSteps: 6}), originals);
  assert.equal(first.state.windowEndStep, 6);
  originals.push(receipt(2));
  const second = advance(first.state, originals);
  assert.equal(second.reason, 'explicit_limit');
  assert.equal(second.state.windowEndStep, 6);
  assert.equal(capacity({maxSteps: 1}).windowEndStep, 1);
});

test('unsafe or nonpositive configuration integers are rejected', () => {
  for (const key of ['initialWindowSteps', 'windowSteps', 'maxSteps']) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4']) {
      assert.throws(() => capacity({[key]: value}), {code: 'INVALID_ARGUMENT'}, `${key}=${value}`);
    }
  }
});

test('persisted state rejects extra fields, inconsistent windows and unsafe counters', () => {
  for (const patch of [{extensions: -1}, {evaluatedReceiptCount: Infinity}, {windowEndStep: 5},
    {maxSteps: 0}, {modelSaysContinue: true}, {evaluatedReceiptDigest: 'not-a-digest'}]) {
    assert.throws(() => advance({...capacity(), ...patch}, [receipt(1)]), {code: 'INVALID_ARGUMENT'});
  }
});

test('safe integer overflow fails explicitly without mutating persisted capacity', () => {
  const state = deepFreeze(capacity({initialWindowSteps: Number.MAX_SAFE_INTEGER - 2, windowSteps: 4}));
  assert.throws(() => advance(state, [receipt(1)]), {code: 'INVALID_ARGUMENT',
    message: 'Execution capacity exceeds the safe integer range'});
  assert.equal(state.extensions, 0);
});

test('cancellation, Runtime cancel requests and the original deadline remain binding', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => advance(capacity(), [receipt(1)], {signal: controller.signal}), {code: 'CANCELLED'});
  assert.throws(() => advance(capacity(), [receipt(1)], {cancelRequested: true}), {code: 'CANCELLED'});
  assert.throws(() => advance(capacity(), [receipt(1)], {nowMs: Date.parse(deadline)}), {code: 'TIMEOUT'});
  assert.throws(() => advance(capacity(), [receipt(1)], {deadline: '2031-01-01T00:00:00.000Z'}), {code: 'UNAUTHORIZED'});
});

test('shortened or rewritten original receipt prefixes cannot earn another window', () => {
  const originals = [receipt(1)];
  const first = advance(capacity(), originals);
  assert.throws(() => advance(first.state, []), {code: 'REVISION_CONFLICT'});
  assert.throws(() => advance(first.state, [receipt(8), receipt(2)]), {code: 'REVISION_CONFLICT'});
});

test('reusing a proposal ID for different arguments fails closed', () => {
  const originals = [receipt(1)];
  const first = advance(capacity(), originals);
  originals.push(receipt(1, {proposal: {arguments: {path: 'replacement.ts'}}}));
  assert.throws(() => advance(first.state, originals), {code: 'REVISION_CONFLICT'});
});

test('a new action cannot hide a later conflicting proposal in the same capacity window', () => {
  const first = advance(capacity(), [receipt(1)]);
  for (const state of [capacity(), first.state]) {
    const originals = deepFreeze([receipt(1), receipt(2),
      receipt(1, {proposal: {arguments: {path: 'replacement.ts'}}})]);
    assert.throws(() => advance(state, originals), {code: 'REVISION_CONFLICT'});
  }
});

test('an earlier matching action cannot hide a later prior binding with the same proposal ID', () => {
  const originals = [receipt(1, {proposal: {arguments: {path: 'B.ts'}}}),
    receipt(2, {proposal: {arguments: {path: 'A.ts'}}})];
  const first = advance(capacity(), originals);
  originals.push(receipt(2, {proposal: {arguments: {path: 'B.ts'}}}));
  assert.throws(() => advance(first.state, deepFreeze(originals)), {code: 'REVISION_CONFLICT'});
});

test('a later repeated action does not erase distinct progress already confirmed in the same window', () => {
  const originals = [receipt(1)];
  const first = advance(capacity(), originals);
  originals.push(receipt(2), receipt(3, {proposal: {arguments: receipt(1).proposal.arguments}}));
  const next = advance(first.state, deepFreeze(originals));
  assert.equal(next.extended, true);
  assert.equal(next.state.evaluatedReceiptCount, originals.length);
  assert.equal(next.state.windowEndStep, first.state.windowEndStep + first.state.windowSteps);
});

test('capacity and selection leave frozen original receipts untouched', () => {
  const originals = deepFreeze([receipt(1), receipt(2)]);
  const snapshot = structuredClone(originals);
  advance(deepFreeze(capacity()), originals);
  const selected = select(originals);
  selected.continuation.result.text = 'caller-local-copy';
  selected.priorContinuations[0].result.text = 'another-local-copy';
  assert.deepEqual(originals, snapshot);
});

test('rolling selection retains the newest current and exactly 32 recent priors across 100 receipts', () => {
  const originals = Array.from({length: 100}, (_, index) => receipt(index));
  const selection = select(originals);
  assert.equal(selection.priorContinuations.length, MAX_PRIOR_EXECUTION_CONTINUATIONS);
  assert.equal(selection.currentReceiptIndex, 99);
  assert.deepEqual(selection.priorReceiptIndices, Array.from({length: 32}, (_, index) => 67 + index));
  assert.deepEqual(selection.continuation, originals[99].continuation);
  assert.equal(selection.omitted.count, 67);
  assert.equal(new Set([...selection.priorContinuations, selection.continuation].map(item => item.proposalId)).size, 33);
  assert.equal(originals.length, 100);
});

test('whole query UTF-8 budget includes goal, catalog, model selection and all receipt envelopes', () => {
  const originals = Array.from({length: 12}, (_, index) => receipt(index,
    {continuation: {result: {text: '汉字与换行\n'.repeat(20)}}}));
  const queryBase = {goal: '保留原始用户目标', availableTools: [{name: 'workspace.read_file', version: '1.0.0',
    inputSchema: {type: 'object', properties: {path: {type: 'string'}}}}],
  executionModel: {catalogRevision: 'a'.repeat(64), modelId: 'published-model', reasoningEffort: 'high'}};
  const selection = select(originals, {queryBase, maxQueryBytes: 1600});
  const exactBytes = Buffer.byteLength(serializedQuery(selection, queryBase), 'utf8');
  assert.equal(selection.queryBytes, exactBytes);
  assert.ok(exactBytes <= 1600);
  assert.ok(selection.priorContinuations.length > 0 && selection.priorContinuations.length < 11);
  assert.equal(selection.omitted.count + selection.priorContinuations.length + 1, originals.length);
});

test('an oversized current is reported explicitly and never truncated or dropped', () => {
  const originals = [receipt(1, {continuation: {result: {text: 'SENSITIVE-ORIGINAL-'.repeat(200)}}})];
  const original = structuredClone(originals);
  const base = {goal: 'final goal'};
  const exact = Buffer.byteLength(JSON.stringify({...base, continuation: originals[0].continuation}));
  assert.equal(select(originals, {queryBase: base, maxQueryBytes: exact}).queryBytes, exact);
  assert.throws(() => select(originals, {queryBase: base, maxQueryBytes: exact - 1}), {
    code: 'INVALID_ARGUMENT', message: 'Current continuation exceeds the complete query byte budget'});
  assert.deepEqual(originals, original);
});

test('large older receipts may be omitted while smaller recent originals still fit', () => {
  const originals = [receipt(1), receipt(2, {continuation: {result: {text: 'large'.repeat(1000)}}}), receipt(3)];
  const selection = select(originals, {maxQueryBytes: 400});
  assert.deepEqual(selection.priorReceiptIndices, [0]);
  assert.equal(selection.omitted.count, 1);
  assert.ok(selection.queryBytes <= 400);
});

test('the same current and duplicate prior IDs are never exported twice', () => {
  const one = receipt(1), two = receipt(2), current = receipt(3);
  const selection = select([one, one, two, current, current]);
  assert.deepEqual(selection.priorContinuations.map(item => item.proposalId), ['proposal-1', 'proposal-2']);
  assert.equal(selection.currentReceiptIndex, 4);
  assert.equal(selection.omitted.count, 2);
});

test('current result must exactly match an original confirmed Runtime continuation', () => {
  const originals = [receipt(1)];
  assert.throws(() => select(originals, {current: receipt(9).continuation}), {code: 'UNAUTHORIZED'});
  assert.throws(() => select(originals, {current: {...originals[0].continuation, result: {text: 'model-replacement'}}}),
    {code: 'UNAUTHORIZED'});
  assert.throws(() => select([receipt(1, {continuation: {state: 'unknown'}})]), {code: 'INVALID_ARGUMENT'});
});

test('older unconfirmed effects are rejected even when they would otherwise be omitted', () => {
  const originals = Array.from({length: 40}, (_, index) => receipt(index));
  originals[0].continuation.state = 'unknown';
  assert.throws(() => select(originals), {code: 'RESULT_UNKNOWN'});
});

test('omission metadata has only public tool names, versions, counts and digests', () => {
  const privatePath = 'C:/private/customer-secret/project-file.ts';
  const privateResult = 'PRIVATE ORIGINAL TOOL RESULT';
  const originals = Array.from({length: 40}, (_, index) => receipt(index, {
    proposal: {arguments: {path: privatePath}}, continuation: {result: {text: `${privateResult}-${index}`}}}));
  const selection = select(originals);
  const summary = JSON.stringify(selection.omitted);
  for (const secret of [privatePath, privateResult, 'proposal-', 'arguments', 'result', 'path']) {
    assert.equal(summary.includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(selection.omitted).sort(), ['count', 'digest', 'tools', 'unlisted']);
  assert.deepEqual(Object.keys(selection.omitted.tools[0]).sort(), ['count', 'digest', 'toolName', 'toolVersion']);
  assert.match(selection.omitted.digest, /^[a-f0-9]{64}$/);
  const changed = structuredClone(originals); changed[0].continuation.result.text = 'different-private-result';
  assert.notEqual(select(changed).omitted.digest, selection.omitted.digest);
  assert.equal(originals[0].continuation.result.text, `${privateResult}-0`);
});

test('metadata tool groups remain bounded for arbitrarily many original registered tools', () => {
  const originals = Array.from({length: 81}, (_, index) => receipt(index,
    {proposal: {toolName: `registered.tool_${index}`}}));
  const currentOnlyBytes = Buffer.byteLength(JSON.stringify({continuation: originals.at(-1).continuation}));
  const selection = select(originals, {maxQueryBytes: currentOnlyBytes});
  assert.equal(selection.priorContinuations.length, 0);
  assert.equal(selection.omitted.count, 80);
  assert.equal(selection.omitted.tools.length, MAX_OMITTED_TOOL_SUMMARIES);
  assert.equal(selection.omitted.unlisted.count, 48);
  assert.equal(selection.omitted.tools.reduce((sum, item) => sum + item.count, 0) + selection.omitted.unlisted.count, 80);
});

test('transport ceiling cannot be raised and malformed budgets or query keys are rejected', () => {
  for (const maxQueryBytes of [0, -1, 1.5, Infinity, MAX_COORDINATION_INITIAL_QUERY_BYTES + 1]) {
    assert.throws(() => select([receipt(1)], {maxQueryBytes}), {code: 'INVALID_ARGUMENT'});
  }
  assert.throws(() => select([receipt(1)], {queryBase: {continuation: 'replacement'}}), {code: 'INVALID_ARGUMENT'});
});

test('strict JSON parsing rejects getters without echoing their private error', () => {
  const original = receipt(1);
  const current = {...original.continuation, result: {get secret() { throw new Error('PRIVATE GETTER CONTENT'); }}};
  assert.throws(() => select([original], {current}), {code: 'INVALID_ARGUMENT', message: 'Invalid current continuation context'});
});
