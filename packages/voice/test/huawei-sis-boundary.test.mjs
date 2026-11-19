import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  MAX_SPEECH_CHARACTERS,
  createHuaweiSisOutputPort,
  createHuaweiSisRecognitionPort,
  VOICE_AUDIO_FORMAT,
} from '../dist/index.js';

const request = overrides => ({sessionId: 'synthetic-session', replyId: 'synthetic-reply',
  text: '合成测试', locale: 'zh-CN', deadline: new Date(Date.now() + 5_000).toISOString(),
  signal: new AbortController().signal, ...overrides});
const recognitionRequest = overrides => request({audio: new Uint8Array(320),
  format: VOICE_AUDIO_FORMAT, durationMs: 10, ...overrides});
const config = overrides => ({region: 'cn-north-4', projectId: 'synthetic-project',
  tokenPort: {async getSisToken() {return 'synthetic-token';}}, ...overrides});
const wav = () => {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40); bytes.writeInt16LE(256, 44);
  return bytes;
};
const ttsResponse = () => Response.json({result: {data: wav().toString('base64')}});
const speak = (data, overrides = {}) => {
  const played = [];
  const stops = [];
  const port = createHuaweiSisOutputPort(config({...overrides, fetchImpl: overrides.fetchImpl ??
    (async () => Response.json({result: {data}})),
  playback: {playWav(input) {played.push(Buffer.from(input.audio));
    return {result: Promise.resolve(), async stop(reason) {stops.push(reason);}};}}}));
  return {operation: port.speak(request()), played, stops};
};

test('SIS construction refuses unavailable regions, bad project IDs and missing credentials', () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; throw Error('must not send');};
  for (const region of ['cn-south-1', undefined, 123]) {
    assert.throws(() => createHuaweiSisRecognitionPort(config({region, fetchImpl})),
      {code: 'UNSUPPORTED_CAPABILITY'});
  }
  for (const projectId of ['', 'synthetic project', 'a'.repeat(129), 42]) {
    assert.throws(() => createHuaweiSisRecognitionPort(config({projectId, fetchImpl})),
      {code: 'INVALID_ARGUMENT'});
  }
  assert.doesNotThrow(() => createHuaweiSisRecognitionPort(
    config({projectId: 'a'.repeat(128), fetchImpl})));
  assert.throws(() => createHuaweiSisRecognitionPort(config({tokenPort: undefined, fetchImpl})),
    {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls, 0);
});

test('SIS output construction requires a playback port and a well-formed voice property', () => {
  for (const playback of [undefined, {}, {playWav: 'nope'}]) {
    assert.throws(() => createHuaweiSisOutputPort(config({playback})),
      {code: 'UNSUPPORTED_CAPABILITY'});
  }
  for (const voiceProperty of ['Bad Property', '中文语音', 'a'.repeat(129), 7]) {
    assert.throws(() => createHuaweiSisOutputPort(config({
      playback: {playWav() {return {result: Promise.resolve(), async stop() {}};}},
      voiceProperty})), {code: 'INVALID_ARGUMENT'});
  }
  assert.doesNotThrow(() => createHuaweiSisOutputPort(config({
    playback: {playWav() {return {result: Promise.resolve(), async stop() {}};}},
    voiceProperty: 'a'.repeat(128)})));
});

test('SIS validates deadlines synchronously before any request or playback', () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; throw Error('must not send');};
  const recognition = createHuaweiSisRecognitionPort(config({fetchImpl}));
  assert.throws(() => recognition.recognize(recognitionRequest({deadline: 'not-a-deadline'})),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => recognition.recognize(recognitionRequest({deadline: 123})),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => recognition.recognize(
    recognitionRequest({deadline: new Date(Date.now() - 1_000).toISOString()})), {code: 'TIMEOUT'});
  const output = createHuaweiSisOutputPort(config({fetchImpl,
    playback: {playWav() {return {result: Promise.resolve(), async stop() {}};}}}));
  assert.throws(() => output.speak(request({deadline: 'not-a-deadline'})),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => output.speak(
    request({deadline: new Date(Date.now() - 1_000).toISOString()})), {code: 'TIMEOUT'});
  assert.equal(calls, 0);
});

test('SIS recognizes only bounded even PCM in the fixed format', () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; throw Error('must not send');};
  const port = createHuaweiSisRecognitionPort(config({fetchImpl}));
  const rejects = candidate => assert.throws(() => port.recognize(candidate),
    {code: 'INVALID_ARGUMENT'});
  rejects(recognitionRequest({audio: new Uint8Array(0)}));
  rejects(recognitionRequest({audio: new Uint8Array(MAX_AUDIO_BYTES + 1)}));
  rejects(recognitionRequest({audio: 'pcm-bytes'}));
  rejects(recognitionRequest({format: undefined}));
  rejects(recognitionRequest({format: {...VOICE_AUDIO_FORMAT, sampleRateHz: 8_000}}));
  rejects(recognitionRequest({format: {...VOICE_AUDIO_FORMAT, channels: 2}}));
  rejects(recognitionRequest({format: {...VOICE_AUDIO_FORMAT, encoding: 'pcm_f32le'}}));
  for (const durationMs of [0, -1, NaN, Infinity, MAX_AUDIO_DURATION_MS + 1]) {
    rejects(recognitionRequest({durationMs}));
  }
  assert.equal(calls, 0);
});

test('SIS rejects whitespace transcripts and honors the alternate regional endpoint', async () => {
  const blank = createHuaweiSisRecognitionPort(config({fetchImpl: async () =>
    Response.json({result: {text: '   '}})}));
  await assert.rejects(blank.recognize(recognitionRequest()).result,
    {code: 'EXTERNAL_FAILURE', message: 'Huawei SIS request failed'});
  const urls = [];
  const east = createHuaweiSisRecognitionPort(config({region: 'cn-east-3',
    fetchImpl: async url => {urls.push(url); return Response.json({result: {text: '东端识别'}});}}));
  assert.deepEqual(await east.recognize(recognitionRequest()).result,
    {text: '东端识别', locale: 'zh-CN'});
  assert.deepEqual(urls,
    ['https://sis-ext.cn-east-3.myhuaweicloud.com/v1/synthetic-project/asr/short-audio']);
});

test('SIS TTS refuses unusable text without any request', () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; throw Error('must not send');};
  const port = createHuaweiSisOutputPort(config({fetchImpl,
    playback: {playWav() {return {result: Promise.resolve(), async stop() {}};}}}));
  assert.throws(() => port.speak(request({text: ''})), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => port.speak(request({text: '   '})), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => port.speak(request({text: 123})), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => port.speak(request({text: '合'.repeat(MAX_SPEECH_CHARACTERS + 1)})),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => port.speak(request({locale: 'en-US'})), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls, 0);
});

test('SIS TTS sends the fixed WAV config, honors the property override and stays in one segment', async () => {
  const bodies = [];
  const played = [];
  const port = createHuaweiSisOutputPort(config({
    fetchImpl: async (_url, init) => {bodies.push(JSON.parse(init.body)); return ttsResponse();},
    playback: {playWav(input) {played.push(Buffer.from(input.audio));
      return {result: Promise.resolve(), async stop() {}};}},
  }));
  const operation = port.speak(request({text: '合'.repeat(500)}));
  await operation.result;
  await operation.stop('completed');
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].config,
    {audio_format: 'wav', sample_rate: '16000', property: 'chinese_xiaoyu_common'});
  assert.equal(bodies[0].text, '合'.repeat(500));
  const custom = createHuaweiSisOutputPort(config({
    voiceProperty: 'synthetic_property_voice',
    fetchImpl: async (_url, init) => {bodies.push(JSON.parse(init.body)); return ttsResponse();},
    playback: {playWav() {return {result: Promise.resolve(), async stop() {}};}},
  }));
  await custom.speak(request({text: '自定义'})).result;
  assert.deepEqual(bodies[1].config,
    {audio_format: 'wav', sample_rate: '16000', property: 'synthetic_property_voice'});
  assert.equal(played.length, 1);
});

test('SIS validates WAV structure and response size after Base64 decoding before playback', async () => {
  const truncated = Buffer.alloc(43, 1);
  const badMagic = wav(); badMagic.write('XUNX', 0);
  const badFormat = wav(); badFormat.write('XUNX', 8);
  for (const data of [truncated.toString('base64'), badMagic.toString('base64'),
    badFormat.toString('base64'), 'A'.repeat(16 * 1024 * 1024 + 1)]) {
    const {operation, played, stops} = speak(data);
    await assert.rejects(operation.result, {code: 'EXTERNAL_FAILURE'});
    assert.deepEqual(played, []);
    assert.deepEqual(stops, []);
    await operation.stop('completed');
  }
  for (const data of [null, 123, '']) {
    const {operation, played} = speak(data);
    await assert.rejects(operation.result, {code: 'EXTERNAL_FAILURE'});
    assert.deepEqual(played, []);
    await operation.stop('completed');
  }
});
