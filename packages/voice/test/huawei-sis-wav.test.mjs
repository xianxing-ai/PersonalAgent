import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHuaweiSisOutputPort} from '../dist/index.js';

const wav = pcmBytes => {
  const bytes = Buffer.alloc(44 + pcmBytes);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(pcmBytes, 40);
  bytes.fill(1, 44);
  return bytes;
};

const speak = data => {
  const played = [];
  const stops = [];
  const port = createHuaweiSisOutputPort({
    region: 'cn-north-4', projectId: 'synthetic-project',
    tokenPort: {async getSisToken() { return 'synthetic-token'; }},
    fetchImpl: async () => Response.json({result: {data}}),
    playback: {playWav({audio}) {
      played.push(Buffer.from(audio));
      return {result: Promise.resolve(), async stop(reason) { stops.push(reason); }};
    }},
  });
  const operation = port.speak({
    sessionId: 'synthetic-session', replyId: 'synthetic-reply',
    text: '合成测试', locale: 'zh-CN', deadline: new Date(Date.now() + 5_000).toISOString(),
    signal: new AbortController().signal,
  });
  return {operation, played, stops};
};

test('SIS plays a valid multi-megabyte WAV without overflowing Base64 validation', async () => {
  const bytes = wav(4_096_000);
  const data = bytes.toString('base64');
  assert.equal(bytes.length, 4_096_044);
  assert.equal(data.length, 5_461_392);
  const {operation, played, stops} = speak(data);
  await operation.result;
  assert.deepEqual(played, [bytes]);
  assert.deepEqual(stops, ['completed']);
});

test('SIS accepts unpadded, single-padding and double-padding Base64 WAV endings', async () => {
  for (const pcmBytes of [2, 4, 6]) {
    const bytes = wav(pcmBytes);
    const {operation, played} = speak(bytes.toString('base64'));
    await operation.result;
    assert.deepEqual(played, [bytes]);
  }
});

test('SIS rejects malformed Base64 padding and characters before playback', async () => {
  const valid = wav(2).toString('base64');
  const invalid = [
    valid.slice(0, -1),
    valid.slice(0, -2),
    `${valid}=`,
    `${valid.slice(0, -3)}===`,
    `=${valid.slice(1)}`,
    `${valid.slice(0, 4)}=${valid.slice(5)}`,
    `${valid.slice(0, -4)}=AAA`,
    `${valid}AAAA`,
    `-${valid.slice(1)}`,
    `_${valid.slice(1)}`,
    ` ${valid.slice(1)}`,
    `${valid}\n`,
  ];
  for (const data of invalid) {
    const {operation, played, stops} = speak(data);
    await assert.rejects(operation.result, {code: 'EXTERNAL_FAILURE', message: 'Huawei SIS request failed'});
    assert.deepEqual(played, []);
    assert.deepEqual(stops, []);
  }
});
