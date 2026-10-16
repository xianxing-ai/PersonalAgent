import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createHuaweiSisOutputPort,
  createHuaweiSisRecognitionPort,
  VOICE_AUDIO_FORMAT,
  VoiceSessionError,
  VoiceSessionManager,
} from '../dist/index.js';

const deferred = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setImmediate(resolve));
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
const failed = error => error.code === 'EXTERNAL_FAILURE'
  && !error.message.includes('private');

test('SIS ASR copies bounded PCM and uses only the fixed authenticated regional endpoint', async () => {
  const calls = [];
  const port = createHuaweiSisRecognitionPort(config({fetchImpl: async (url, init) => {
    calls.push({url, init});
    return Response.json({result: {text: '合成识别结果'}});
  }}));
  const audio = new Uint8Array(320).fill(3);
  const operation = port.recognize(recognitionRequest({audio}));
  audio.fill(7);
  assert.deepEqual(await operation.result, {text: '合成识别结果', locale: 'zh-CN'});
  await operation.stop('completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url,
    'https://sis-ext.cn-north-4.myhuaweicloud.com/v1/synthetic-project/asr/short-audio');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['X-Auth-Token'], 'synthetic-token');
  assert.deepEqual(Buffer.from(JSON.parse(calls[0].init.body).data, 'base64'), Buffer.alloc(320, 3));
});

test('SIS refuses invalid input and credentials without a request or fallback', async () => {
  let calls = 0;
  const port = createHuaweiSisRecognitionPort(config({
    tokenPort: {async getSisToken() {return 'private\r\ntoken';}},
    fetchImpl: async () => {calls++; throw Error('must not send');},
  }));
  assert.throws(() => port.recognize(recognitionRequest({audio: new Uint8Array(3)})),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => port.recognize(recognitionRequest({locale: 'en-US'})),
    {code: 'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(port.recognize(recognitionRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY' && !error.message.includes('private'));
  assert.equal(calls, 0);
});

test('SIS token cancellation settles even when the token provider never cooperates', async () => {
  const entered = deferred();
  let calls = 0;
  const parent = new AbortController();
  const port = createHuaweiSisRecognitionPort(config({tokenPort: {getSisToken() {
    entered.resolve(); return new Promise(() => {});
  }}, fetchImpl: async () => {calls++;}}));
  const operation = port.recognize(recognitionRequest({signal: parent.signal}));
  const rejected = assert.rejects(operation.result, {code: 'CANCELLED'});
  await entered.promise;
  parent.abort();
  await rejected;
  await operation.stop('user');
  assert.equal(calls, 0);
});

test('SIS rechecks expiry after token resolution when the deadline timer has not run', async t => {
  t.mock.timers.enable({apis: ['Date'], now: 1000});
  const token = deferred();
  let calls = 0;
  const port = createHuaweiSisRecognitionPort(config({
    tokenPort: {getSisToken: () => token.promise},
    fetchImpl: async () => {calls++; return Response.json({result: {text: 'late'}});},
  }));
  const operation = port.recognize(recognitionRequest({deadline: new Date(1500).toISOString()}));
  const rejected = assert.rejects(operation.result, {code: 'TIMEOUT'});
  await tick();
  t.mock.timers.setTime(2000);
  token.resolve('synthetic-token');
  await rejected;
  await operation.stop('completed');
  assert.equal(calls, 0);
});

test('SIS cancels a late response body after a non-cooperative transport outlives stop', async () => {
  const incoming = deferred();
  const entered = deferred();
  const parent = new AbortController();
  let cancelled = false;
  const port = createHuaweiSisRecognitionPort(config({fetchImpl() {
    entered.resolve(); return incoming.promise;
  }}));
  const operation = port.recognize(recognitionRequest({signal: parent.signal}));
  const rejected = assert.rejects(operation.result, {code: 'CANCELLED'});
  await entered.promise;
  parent.abort();
  await rejected;
  await operation.stop('user');
  incoming.resolve(new Response(new ReadableStream({cancel() {cancelled = true;}})));
  await tick();
  assert.equal(cancelled, true);
});

test('SIS sanitizes provider VoiceSessionError messages', async () => {
  const port = createHuaweiSisRecognitionPort(config({tokenPort: {getSisToken() {
    throw new VoiceSessionError('EXTERNAL_FAILURE', 'private token details');
  }}}));
  await assert.rejects(port.recognize(recognitionRequest()).result, failed);
});

test('SIS rejects bounded malformed, oversized and HTTP failure responses without retry', async () => {
  for (const response of [
    Response.json({error_msg: 'private provider details'}),
    Response.json({result: {text: '字'.repeat(8001)}}),
    new Response(' '.repeat(65_537)),
    new Response('private authentication details', {status: 401}),
  ]) {
    let calls = 0;
    const port = createHuaweiSisRecognitionPort(config({fetchImpl: async () => {calls++; return response;}}));
    await assert.rejects(port.recognize(recognitionRequest()).result, failed);
    assert.equal(calls, 1);
  }
});

test('SIS never plays a TTS response delivered after expiry and cancels its body', async t => {
  t.mock.timers.enable({apis: ['Date'], now: 1000});
  const response = deferred();
  const entered = deferred();
  let cancelled = false;
  let plays = 0;
  const port = createHuaweiSisOutputPort(config({
    fetchImpl() {entered.resolve(); return response.promise;},
    playback: {playWav() {plays++; throw Error('must not play');}},
  }));
  const operation = port.speak(request({deadline: new Date(1500).toISOString()}));
  const rejected = assert.rejects(operation.result, {code: 'TIMEOUT'});
  await entered.promise;
  t.mock.timers.setTime(2000);
  response.resolve(new Response(new ReadableStream({cancel() {cancelled = true;}})));
  await rejected;
  await operation.stop('completed');
  assert.equal(plays, 0);
  assert.equal(cancelled, true);
});

test('SIS successful Unicode TTS segments stay ordered and release before the next request', async () => {
  const timeline = [];
  const segments = [];
  const audio = [];
  const port = createHuaweiSisOutputPort(config({fetchImpl: async (_url, init) => {
    timeline.push('request'); segments.push(JSON.parse(init.body).text); return ttsResponse();
  }, playback: {playWav(input) {
    timeline.push('play'); audio.push(input.audio);
    return {result: Promise.resolve(), async stop() {timeline.push('release');}};
  }}}));
  const text = '测'.repeat(499) + '🌍继续';
  const operation = port.speak(request({text}));
  await operation.result;
  await operation.stop('completed');
  assert.equal(segments.join(''), text);
  assert.deepEqual(segments.map(segment => [...segment].length), [500, 2]);
  assert.deepEqual(timeline, ['request', 'play', 'release', 'request', 'play', 'release']);
  assert.ok(audio.every(bytes => bytes.every(byte => byte === 0)));
});

test('failed TTS playback releases before clearing audio and settling its result', async () => {
  const release = deferred();
  let audio;
  const stops = [];
  let settled = false;
  const port = createHuaweiSisOutputPort(config({fetchImpl: async () => ttsResponse(),
    playback: {playWav(input) {
      audio = input.audio;
      return {result: Promise.reject(Error('private playback details')),
        stop(reason) {stops.push(reason); return release.promise;}};
    }},
  }));
  const operation = port.speak(request());
  const rejected = assert.rejects(operation.result, failed).finally(() => {settled = true;});
  try {
    await tick();
    assert.deepEqual(stops, ['completed']);
    assert.equal(settled, false);
    assert.ok(audio.some(byte => byte !== 0));
  } finally {release.resolve();}
  await rejected;
  await operation.stop('completed');
  assert.deepEqual(stops, ['completed']);
  assert.ok(audio.every(byte => byte === 0));
});

test('TTS segments wait for release; interruption shares one stop and prevents the next request', async () => {
  const started = deferred();
  const release = deferred();
  let calls = 0;
  let audio;
  const stops = [];
  const parent = new AbortController();
  const port = createHuaweiSisOutputPort(config({fetchImpl: async () => {calls++; return ttsResponse();},
    playback: {playWav(input) {
      audio = input.audio; started.resolve();
      return {result: new Promise(() => {}), stop(reason) {stops.push(reason); return release.promise;}};
    }},
  }));
  const operation = port.speak(request({text: '合'.repeat(501), signal: parent.signal}));
  const rejected = assert.rejects(operation.result, {code: 'CANCELLED'});
  await started.promise;
  const stopping = operation.stop('interrupted');
  const duplicate = operation.stop('user');
  assert.equal(stopping, duplicate);
  try {await tick(); assert.deepEqual(stops, ['interrupted']);}
  finally {release.resolve();}
  await Promise.all([stopping, rejected]);
  assert.equal(calls, 1);
  assert.deepEqual(stops, ['interrupted']);
  assert.ok(audio.every(byte => byte === 0));
});

test('failed SIS playback release remains failed and locks the voice manager', async () => {
  let releases = 0;
  const output = createHuaweiSisOutputPort(config({fetchImpl: async () => ttsResponse(),
    playback: {playWav() {return {result: Promise.resolve(), stop() {
      releases++; return Promise.reject(Error('private release details'));
    }};}},
  }));
  const manager = new VoiceSessionManager({output, recognition: {recognize() {
    return {result: Promise.resolve({text: '合成输入'}), async stop() {}};
  }}});
  const session = await manager.start(request());
  const transcript = await manager.recognizeAudio(session.sessionId,
    {data: new Uint8Array(320), format: VOICE_AUDIO_FORMAT, durationMs: 10});
  const reply = await manager.consumeTranscript(session.sessionId, transcript.transcriptId,
    {consume() {return {result: Promise.resolve({replyText: '合成回复'}), async stop() {}};}});
  await assert.rejects(manager.speakReply(session.sessionId, reply.replyId), failed);
  assert.equal((await manager.stop(session.sessionId)).resourcesReleased, false);
  await assert.rejects(manager.start(request()), failed);
  assert.equal(releases, 1);
});

test('SIS expiry during final playback release cannot report completed', async t => {
  t.mock.timers.enable({apis: ['Date'], now: 1000});
  const release = deferred();
  const releasing = deferred();
  let stops = 0;
  const port = createHuaweiSisOutputPort(config({fetchImpl: async () => ttsResponse(),
    playback: {playWav() {return {result: Promise.resolve(), stop() {
      stops++; releasing.resolve(); return release.promise;
    }};}},
  }));
  const operation = port.speak(request({deadline: new Date(1500).toISOString()}));
  const rejected = assert.rejects(operation.result, {code: 'TIMEOUT'});
  await releasing.promise;
  t.mock.timers.setTime(2000);
  release.resolve();
  await rejected;
  await operation.stop('completed');
  assert.equal(stops, 1);
});

test('reentrant playback revocation drains its rejection and shares the release result', async () => {
  const parent = new AbortController();
  let stops = 0;
  const port = createHuaweiSisOutputPort(config({fetchImpl: async () => ttsResponse(),
    playback: {playWav() {
      parent.abort();
      return {result: Promise.reject(new VoiceSessionError('EXTERNAL_FAILURE', 'private playback')),
        async stop() {stops++;}};
    }},
  }));
  const operation = port.speak(request({signal: parent.signal}));
  await assert.rejects(operation.result, {code: 'CANCELLED'});
  await operation.stop('user');
  await tick();
  assert.equal(stops, 1);
});
