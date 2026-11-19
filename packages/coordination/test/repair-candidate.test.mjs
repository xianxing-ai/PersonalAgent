import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCoordinationRepairCandidate, parseCoordinationResult} from '../dist/index.js';

const valid = () => ({kind: 'repair_candidate', candidateVersion: '1.0', verification: 'unverified', candidate: {
  expectedGraphRevision: 6, changes: [{node: {id: 'prepare', revision: 1},
    summary: 'Prepare at 16:00', reason: 'Meeting moved to 17:00', dependencies: [{id: 'meeting', revision: 2}]}],
}});

test('versioned candidate is an isolated existing repair request shape, not an authorization', () => {
  const input = valid();
  const result = parseCoordinationRepairCandidate(input);
  assert.deepEqual(parseCoordinationResult(input), result);
  input.candidate.changes[0].summary = 'changed';
  assert.equal(result.candidate.changes[0].summary, 'Prepare at 16:00');
});

test('candidate rejects unsupported versions, authority fields and verification claims', () => {
  for (const mutate of [v => {v.candidateVersion = '2.0';}, v => {delete v.candidateVersion;},
    v => {v.verification = 'verified';}, v => {v.verification = 'mock';},
    v => {v.taskId = 'forged';}, v => {v.candidate.evidenceRefs = ['forged'];},
    v => {v.candidate.changes[0].scopeRef = 'forged';}]) {
    const input = valid(); mutate(input);
    assert.throws(() => parseCoordinationRepairCandidate(input), error => error.code === 'INVALID_ARGUMENT');
  }
});

test('candidate rejects duplicate targets/dependencies, self refs and bad revisions', () => {
  for (const mutate of [v => {v.candidate.changes.push(v.candidate.changes[0]);},
    v => {v.candidate.changes[0].dependencies.push({id: 'meeting', revision: 1});},
    v => {v.candidate.changes[0].dependencies = [{id: 'prepare', revision: 1}];},
    v => {v.candidate.expectedGraphRevision = -1;}, v => {v.candidate.changes[0].node.revision = 0;},
    v => {v.candidate.changes = [];}]) {
    const input = valid(); mutate(input);
    assert.throws(() => parseCoordinationRepairCandidate(input));
  }
});

test('candidate requires an exact-shape object at every level', () => {
  for (const input of [undefined, null, 'repair_candidate', 7, [], [valid()],
    {...valid(), kind: 'result'}, {...valid(), extra: 'field'},
    (() => {const input = valid(); delete input.verification; return input;})(),
    (() => {const input = valid(); input.candidate = 'shape'; return input;})(),
    (() => {const input = valid(); input.candidate.extra = 'field'; return input;})(),
    (() => {const input = valid(); input.candidate.changes[0] = 'shape'; return input;})(),
    (() => {const input = valid(); input.candidate.changes[0].extra = 'field'; return input;})(),
    (() => {const input = valid(); input.candidate.changes[0].node.extra = 'field'; return input;})(),
    (() => {const input = valid(); input.candidate.changes[0].dependencies[0].extra = 'field'; return input;})()]) {
    assert.throws(() => parseCoordinationRepairCandidate(input), error => error.code === 'INVALID_ARGUMENT');
  }
});

test('candidate text fields, revisions and collection sizes enforce their bounds', () => {
  for (const mutate of [v => {v.candidate.changes[0].summary = 'x'.repeat(1025);},
    v => {v.candidate.changes[0].reason = 'x'.repeat(1025);},
    v => {v.candidate.changes[0].summary = 'boundary\u007f';},
    v => {v.candidate.changes[0].summary = 'multi\nline';},
    v => {v.candidate.changes[0].summary = '   ';},
    v => {v.candidate.changes[0].node.id = 'x'.repeat(129);},
    v => {v.candidate.changes[0].node.revision = 1.5;},
    v => {v.candidate.changes[0].node.revision = '1';},
    v => {v.candidate.expectedGraphRevision = 1.5;},
    v => {v.candidate.changes = 'not-an-array';},
    v => {v.candidate.changes[0].dependencies = 'not-an-array';},
    v => {v.candidate.changes[0].dependencies = Array.from({length: 17}, (_, index) => ({id: `dependency-${index}`, revision: 1}));},
    v => {v.candidate.changes = Array.from({length: 17}, (_, index) => ({...v.candidate.changes[0],
      node: {id: `node-${index}`, revision: 1}}));}]) {
    const input = valid(); mutate(input);
    assert.throws(() => parseCoordinationRepairCandidate(input), error => error.code === 'INVALID_ARGUMENT');
  }
  const full = valid();
  full.candidate.changes[0].summary = 'x'.repeat(1024);
  full.candidate.changes[0].reason = 'x'.repeat(1024);
  assert.equal(parseCoordinationRepairCandidate(full).candidate.changes[0].summary.length, 1024);
});

test('the 8KiB budget counts UTF-8 bytes, not characters', () => {
  const input = valid();
  input.candidate.changes = Array.from({length: 8}, (_, index) => ({...valid().candidate.changes[0],
    node: {id: `node-${index}`, revision: 1}, summary: '边界'.repeat(600)}));
  assert.throws(() => parseCoordinationRepairCandidate(input), error => error.code === 'INVALID_ARGUMENT');
  const within = valid();
  within.candidate.changes[0].summary = '边界'.repeat(512);
  assert.equal(parseCoordinationRepairCandidate(within).candidate.changes[0].summary.length, 1024);
});

test('candidate never invokes getters and enforces its entire 8KiB budget', () => {
  let reads = 0;
  const input = valid();
  Object.defineProperty(input.candidate, 'expectedGraphRevision', {enumerable: true, get() {reads++; return 6;}});
  assert.throws(() => parseCoordinationRepairCandidate(input));
  assert.equal(reads, 0);
  const large = valid();
  large.candidate.changes = Array.from({length: 8}, (_, index) => ({...valid().candidate.changes[0],
    node: {id: `node-${index}`, revision: 1}, summary: 'x'.repeat(1024)}));
  assert.throws(() => parseCoordinationRepairCandidate(large));
});
