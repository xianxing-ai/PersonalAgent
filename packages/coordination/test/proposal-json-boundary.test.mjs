import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCoordinationToolProposal, CompetitionCoordinator} from '../dist/index.js';

const limit = 65_536;
const proposal = argumentsValue => ({kind: 'tool_proposal', proposalId: 'fixture',
  toolName: 'read', toolVersion: '1', verification: 'unverified', arguments: argumentsValue});
const reject = value => assert.throws(() => parseCoordinationToolProposal(value), error =>
  error.code === 'INVALID_ARGUMENT' && error.message === 'Invalid coordination result');

test('tool proposal rejects sparse arrays and extra array properties without running provider methods', () => {
  let methods = 0;
  const mapped = [1];
  mapped.map = () => { methods++; return ['replacement']; };
  const extra = [1]; extra.extra = true;
  const symbol = [1]; symbol[Symbol('extra')] = true;
  const sparse = Array(2);
  for (const values of [mapped, extra, symbol, sparse]) reject(proposal({values}));
  assert.equal(methods, 0);
});

test('tool proposal rejects array accessors without invoking getters', () => {
  let getters = 0;
  const values = [1];
  Object.defineProperty(values, '0', {enumerable: true, get() { getters++; return 'replacement'; }});
  reject(proposal({values}));
  assert.equal(getters, 0);
});

test('tool proposal sanitizes hostile reflection at the envelope and nested arrays', () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const values = new Proxy([1], {ownKeys() { throw new Error('private-canary'); }});
  reject(revoked.proxy);
  reject(proposal({values}));
});

test('tool proposal keeps the existing exact UTF-16 JSON argument boundary', () => {
  const overhead = JSON.stringify({value: ''}).length;
  for (const [character, width] of [['x', 1], ['中', 1], ['😀', 2], ['\n', 2], ['\u0001', 6], ['\ud800', 6]]) {
    const count = Math.floor((limit - overhead) / width);
    const argumentsValue = {value: character.repeat(count)};
    assert.ok(JSON.stringify(argumentsValue).length <= limit);
    assert.deepEqual(parseCoordinationToolProposal(proposal(argumentsValue)), proposal(argumentsValue));
    reject(proposal({value: argumentsValue.value + character}));
  }
});

test('tool proposal stops aggregate cloning before inspecting an over-budget tail', () => {
  let tailInspected = false;
  const tail = new Proxy({}, {getPrototypeOf() { tailInspected = true; return Object.prototype; }});
  reject(proposal({first: 'a'.repeat(33_000), second: 'b'.repeat(33_000), tail}));
  assert.equal(tailInspected, false);
  reject(proposal({['x'.repeat(limit)]: null}));
});

test('tool proposal preserves repeated JSON data and returns isolated dense arrays', () => {
  const shared = {value: 1};
  const argumentsValue = JSON.parse('{"__proto__":{"safe":true},"constructor":"data"}');
  argumentsValue.values = [shared, shared, null, false, 1e30];
  const result = parseCoordinationToolProposal(proposal(argumentsValue));
  assert.deepEqual(result, proposal(argumentsValue));
  assert.equal(Object.getPrototypeOf(result.arguments), Object.prototype);
  assert.equal(Object.hasOwn(result.arguments, '__proto__'), true);
  result.arguments.values[0].value = 99;
  assert.equal(shared.value, 1);
  assert.equal(result.arguments.values[1].value, 1);
});

test('CompetitionCoordinator rejects malformed proposal arrays through the public boundary', async () => {
  const cloud = {invoke: async () => proposal({values: Array(1)})};
  await assert.rejects(new CompetitionCoordinator(cloud).execute({taskId: 'fixture', revision: 1,
    goal: 'Synthetic read', deadline: new Date(Date.now() + 5_000).toISOString(),
    signal: new AbortController().signal}), {code: 'INVALID_ARGUMENT'});
});
