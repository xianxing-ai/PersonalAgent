import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createSyntheticMeetingToolset, projectSyntheticMeetingResult} from '../electron/competition-synthetic-workspace.js';

const content = JSON.stringify({meetingId: 'mvp-meeting', revision: 2, start: '17:00', timezone: 'Asia/Shanghai'});
const result = () => ({path: 'meeting-update.json', encoding: 'utf-8', byteLength: Buffer.byteLength(content), content});

test('synthetic export projects only the explicitly approved meeting fields', () => {
  assert.deepEqual(projectSyntheticMeetingResult(result()), JSON.parse(content));
});

test('synthetic export verifies the production optional digest without exporting it', () => {
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  assert.deepEqual(projectSyntheticMeetingResult({...result(), sha256}), JSON.parse(content));
  for (const invalid of [undefined, '0'.repeat(64), sha256.toUpperCase(), 'invalid']) {
    assert.throws(() => projectSyntheticMeetingResult({...result(), sha256: invalid}), /export denied/);
  }
  let reads = 0;
  const accessor = {...result()};
  Object.defineProperty(accessor, 'sha256', {enumerable: true, get() { reads++; return sha256; }});
  assert.throws(() => projectSyntheticMeetingResult(accessor), /export denied/);
  assert.equal(reads, 0);
});

test('synthetic export rejects arbitrary file results and expanded content with fixed errors', () => {
  for (const invalid of [
    {...result(), path: 'private.txt'}, {...result(), byteLength: 0},
    {...result(), content: '{invalid'}, {...result(), extra: 'private'},
    {...result(), content: content.replace('17:00', '18:00')},
  ]) assert.throws(() => projectSyntheticMeetingResult(invalid), /^Error: Synthetic meeting result export denied$/);
  const extraContent = JSON.stringify({...JSON.parse(content), secret: 'must-not-export'});
  assert.throws(() => projectSyntheticMeetingResult({...result(), content: extraContent, byteLength: Buffer.byteLength(extraContent)}),
    /^Error: Synthetic meeting result export denied$/);
  let getterReads = 0;
  const accessor = {...result()};
  Object.defineProperty(accessor, 'content', {enumerable: true, get() { getterReads++; return content; }});
  assert.throws(() => projectSyntheticMeetingResult(accessor), /export denied/);
  assert.equal(getterReads, 0);
});

test('host binding permits the fixed path and optional bounded maxBytes and honours cancellation', () => {
  const fixtureRoot = fileURLToPath(new URL('../../../tests/manual/agentarts/fixtures/mvp-meeting/', import.meta.url));
  const {tools, competitionToolExports: [binding]} = createSyntheticMeetingToolset(fixtureRoot);
  assert.equal(tools.length, 1);
  assert.equal(binding.toolName, 'workspace.read_text');
  assert.equal(binding.toolVersion, '1.0.0');
  assert.equal(binding.accepts({arguments: {path: 'meeting-update.json'}}), true);
  const maxBytes = tools[0].descriptor.inputSchema.properties.maxBytes.maximum;
  assert.equal(maxBytes, 2048);
  for (const valid of [1, maxBytes]) {
    assert.equal(binding.accepts({arguments: {path: 'meeting-update.json', maxBytes: valid}}), true);
  }
  for (const invalid of [0, -1, maxBytes + 1, 1.5, NaN, Infinity, '2048', null, undefined]) {
    assert.equal(binding.accepts({arguments: {path: 'meeting-update.json', maxBytes: invalid}}), false);
  }
  assert.equal(binding.accepts({arguments: {path: 'meeting-update.json', maxBytes, extra: true}}), false);
  assert.equal(binding.accepts({arguments: {path: '../private.txt'}}), false);
  assert.equal(binding.accepts({arguments: {path: '../private.txt', maxBytes}}), false);
  let reads = 0;
  const accessor = {path: 'meeting-update.json'};
  Object.defineProperty(accessor, 'maxBytes', {enumerable: true, get() { reads++; return maxBytes; }});
  assert.equal(binding.accepts({arguments: accessor}), false);
  assert.equal(reads, 0);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => binding.project({result: result(), signal: controller.signal}), /cancelled/);
});

test('synthetic tool registration rejects an alternate root and a junction to external same-name content', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pa-mvp-external-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const outside = path.join(directory, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'meeting-update.json'), JSON.stringify({meetingId: 'mvp-meeting',
    revision: 2, start: '17:00', timezone: 'Asia/Shanghai'}));
  const alias = path.join(directory, 'alias');
  symlinkSync(outside, alias, 'junction');
  for (const root of [outside, alias]) {
    assert.throws(() => createSyntheticMeetingToolset(root), error =>
      error.message === 'Synthetic fixture root unavailable' && !error.message.includes(directory));
  }
});
