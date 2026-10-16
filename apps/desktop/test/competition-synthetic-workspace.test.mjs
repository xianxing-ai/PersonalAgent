import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createSyntheticMeetingToolset, projectSyntheticMeetingResult} from '../electron/competition-synthetic-workspace.js';

const content = JSON.stringify({meetingId: 'mvp-meeting', revision: 2, start: '17:00', timezone: 'Asia/Shanghai'});
const digest = value => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
const result = () => ({path: 'meeting-update.json', encoding: 'utf-8', byteLength: Buffer.byteLength(content), content, sha256: digest(content)});

test('synthetic export projects only the explicitly approved meeting fields', () => {
  assert.deepEqual(projectSyntheticMeetingResult(result()), JSON.parse(content));
  const {sha256, ...historical} = result();
  assert.deepEqual(projectSyntheticMeetingResult(historical), JSON.parse(content), 'public 1.0.0 historical four-field receipts remain supported without inventing a digest');
});

test('a supplied workspace digest must exactly bind its current UTF8 bytes and never expands the exported fields', () => {
  for (const sha256 of ['0'.repeat(64), digest(content).toUpperCase(), 'a'.repeat(63), null, undefined])
    assert.throws(() => projectSyntheticMeetingResult({...result(), sha256}), /^Error: Synthetic meeting result export denied$/);
  assert.deepEqual(Object.keys(projectSyntheticMeetingResult(result())), ['meetingId', 'revision', 'start', 'timezone']);
  let reads = 0;
  const accessor = {...result()};
  Object.defineProperty(accessor, 'sha256', {enumerable: true, get() {reads++; return digest(content);}});
  assert.throws(() => projectSyntheticMeetingResult(accessor), /export denied/); assert.equal(reads, 0);
});

test('synthetic export rejects arbitrary file results and expanded content with fixed errors', () => {
  for (const invalid of [
    {...result(), path: 'private.txt'}, {...result(), byteLength: 0},
    {...result(), content: '{invalid'}, {...result(), extra: 'private'},
    {...result(), content: content.replace('17:00', '18:00'), sha256: digest(content.replace('17:00', '18:00'))},
  ]) assert.throws(() => projectSyntheticMeetingResult(invalid), /^Error: Synthetic meeting result export denied$/);
  const extraContent = JSON.stringify({...JSON.parse(content), secret: 'must-not-export'});
  assert.throws(() => projectSyntheticMeetingResult({...result(), content: extraContent, byteLength: Buffer.byteLength(extraContent), sha256: digest(extraContent)}),
    /^Error: Synthetic meeting result export denied$/);
  let getterReads = 0;
  const accessor = {...result()};
  Object.defineProperty(accessor, 'content', {enumerable: true, get() { getterReads++; return content; }});
  assert.throws(() => projectSyntheticMeetingResult(accessor), /export denied/);
  assert.equal(getterReads, 0);
});

test('host binding permits only the exact synthetic tool arguments and honours cancellation', () => {
  const fixtureRoot = fileURLToPath(new URL('../../../tests/manual/agentarts/fixtures/mvp-meeting/', import.meta.url));
  const {tools, competitionToolExports: [binding]} = createSyntheticMeetingToolset(fixtureRoot);
  assert.equal(tools.length, 1);
  assert.equal(binding.toolName, 'workspace.read_text');
  assert.equal(binding.toolVersion, '1.0.0');
  assert.equal(binding.accepts({arguments: {path: 'meeting-update.json'}}), true);
  assert.equal(binding.accepts({arguments: {path: 'meeting-update.json', maxBytes: 2048}}), false);
  assert.equal(binding.accepts({arguments: {path: '../private.txt'}}), false);
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
