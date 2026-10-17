import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {test} from 'node:test';

import {VOICE_AUDIO_FORMAT, VoiceSessionError} from '../dist/index.js';
import {createWindowsSystemSpeechPortsForTesting} from '../dist/windows-system-speech.js';

const deadline = (offsetMs = 2_000) => new Date(Date.now() + offsetMs).toISOString();

class FakeSpeechProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  input = [];
  killed = false;
  closed = false;

  constructor(mode, responder) {
    super();
    this.stdin.on('data', chunk => this.input.push(Buffer.from(chunk)));
    this.stdin.on('finish', () => responder(this, mode, Buffer.concat(this.input)));
  }

  respond(value, code = 0) {
    if (this.closed) return;
    this.stdout.end(typeof value === 'string' ? value : JSON.stringify(value));
    this.stderr.end();
    setImmediate(() => this.close(code, null));
  }

  close(code, signal) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, signal);
  }

  kill() {
    if (this.closed) return false;
    this.killed = true;
    setTimeout(() => this.close(null, 'SIGTERM'), 5);
    return true;
  }
}

function factory(responder) {
  const calls = [];
  const ports = createWindowsSystemSpeechPortsForTesting(mode => {
    const process = new FakeSpeechProcess(mode, responder);
    calls.push({mode, process});
    return process;
  });
  return {ports, calls};
}

const recognitionRequest = (overrides = {}) => ({
  sessionId: 'session-1',
  audio: Uint8Array.of(1, 2, 3, 4),
  format: VOICE_AUDIO_FORMAT,
  durationMs: 1,
  locale: 'zh-CN',
  deadline: deadline(),
  signal: new AbortController().signal,
  ...overrides,
});

const speechRequest = (overrides = {}) => ({
  sessionId: 'session-1',
  replyId: 'reply-1',
  text: '你好，欢迎回来',
  locale: 'zh-CN',
  deadline: deadline(),
  signal: new AbortController().signal,
  ...overrides,
});

test('fixed host frames provide one bounded recognition and one speech operation without retry', async () => {
  const captured = [];
  const {ports, calls} = factory((process, mode, input) => {
    captured.push({mode, input: Buffer.from(input)});
    process.respond(mode === 'recognize'
      ? {ok: true, text: '识别成功', locale: 'zh-CN'}
      : {ok: true, locale: 'zh-CN'});
  });

  const audio = Uint8Array.of(1, 2, 3, 4);
  const recognition = ports.recognition.recognize(recognitionRequest({audio}));
  audio.fill(99);
  assert.deepEqual(await recognition.result, {text: '识别成功', locale: 'zh-CN'});
  await ports.output.speak(speechRequest()).result;

  assert.deepEqual(calls.map(call => call.mode), ['recognize', 'speak']);
  assert.deepEqual([...captured[0].input], [1, 2, 3, 4]);
  assert.equal(captured[1].input.toString('utf8'), '你好，欢迎回来');
  await ports.dispose();
});

test('parent cancellation and stop kill the exact child and wait for its close', async () => {
  const parent = new AbortController();
  const {ports, calls} = factory(() => {});
  const operation = ports.recognition.recognize(recognitionRequest({signal: parent.signal}));
  const rejected = assert.rejects(operation.result, error => error.code === 'CANCELLED');
  parent.abort();
  await rejected;
  await operation.stop('user');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].process.killed, true);
  assert.equal(calls[0].process.closed, true);

  const speaking = ports.output.speak(speechRequest());
  const stopped = assert.rejects(speaking.result, error => error.code === 'CANCELLED');
  await speaking.stop('interrupted');
  await stopped;
  assert.equal(calls[1].process.killed, true);
  assert.equal(calls[1].process.closed, true);
  await ports.dispose();
});

test('every concurrent dispose waits for all active host processes to close', async () => {
  const {ports, calls} = factory(() => {});
  const recognition = ports.recognition.recognize(recognitionRequest());
  const speaking = ports.output.speak(speechRequest());
  const rejected = [recognition, speaking].map(operation =>
    assert.rejects(operation.result, error => error.code === 'CANCELLED'));
  let kills = 0;
  for (const {process} of calls) process.kill = () => { kills++; return true; };
  const first = ports.dispose();
  const second = ports.dispose();
  assert.equal(first, second);
  let released = false;
  void second.then(() => { released = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(kills, 2);
  assert.equal(released, false);
  await assert.rejects(ports.output.speak(speechRequest()).result, {code: 'INVALID_STATE'});
  assert.equal(calls.length, 2);
  calls[0].process.close(null, 'SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(released, false);
  calls[1].process.close(null, 'SIGTERM');
  await Promise.all([first, second, ...rejected]);
  assert.equal(released, true);
  assert.equal(ports.dispose(), first);
  assert.equal(kills, 2);
});

test('invalid requests and malformed or oversized host responses fail locally without leaked text or retry', async () => {
  const {ports, calls} = factory(process => process.respond('private malformed response'));
  assert.throws(
    () => ports.recognition.recognize(recognitionRequest({locale: 'en-US'})),
    error => error.code === 'INVALID_ARGUMENT' && !error.message.includes('en-US'),
  );
  assert.throws(
    () => ports.recognition.recognize(recognitionRequest({audio: Uint8Array.of(1, 2, 3), durationMs: 1})),
    error => error.code === 'INVALID_ARGUMENT',
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    ports.recognition.recognize(recognitionRequest()).result,
    error => error.code === 'EXTERNAL_FAILURE' && error.message === 'Windows speech operation failed'
      && !error.message.includes('private'),
  );
  assert.equal(calls.length, 1);

  const oversized = factory(process => process.respond({
    ok: true, text: '字'.repeat(8_001), locale: 'zh-CN',
  }));
  await assert.rejects(
    oversized.ports.recognition.recognize(recognitionRequest()).result,
    error => error.code === 'EXTERNAL_FAILURE',
  );
  assert.equal(oversized.calls.length, 1);

  const policyBlocked = factory(process => process.respond('', 1));
  await assert.rejects(
    policyBlocked.ports.recognition.recognize(recognitionRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  assert.equal(policyBlocked.calls.length, 1);

  const speechBlocked = factory(process => process.respond('', 1));
  await assert.rejects(
    speechBlocked.ports.output.speak(speechRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  assert.equal(speechBlocked.calls.length, 1);

  await ports.dispose();
  await oversized.ports.dispose();
  await policyBlocked.ports.dispose();
  await speechBlocked.ports.dispose();
});

test('unavailable host spawner failure reports unsupported capability for speech and recognition', async () => {
  const ports = createWindowsSystemSpeechPortsForTesting(() => {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Windows System.Speech is unavailable');
  });
  await assert.rejects(
    ports.output.speak(speechRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  await assert.rejects(
    ports.recognition.recognize(recognitionRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  await ports.dispose();
});

test('host process spawn error terminates with fixed failure without leaking details', async () => {
  const {ports, calls} = factory(process => {
    process.emit('error', new Error('spawn failure'));
  });
  await assert.rejects(
    ports.output.speak(speechRequest()).result,
    error => error.code === 'EXTERNAL_FAILURE'
      && error.message === 'Windows speech operation failed',
  );
  assert.equal(calls.length, 1);
  await ports.dispose();
});

test('host unsupported capability envelope reports unavailable capability without retry', async () => {
  const speakUnsupported = factory(process => {
    process.respond({ok: false, code: 'UNSUPPORTED_CAPABILITY'}, 2);
  });
  await assert.rejects(
    speakUnsupported.ports.output.speak(speechRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  assert.equal(speakUnsupported.calls.length, 1);
  await speakUnsupported.ports.dispose();

  const recUnsupported = factory(process => {
    process.respond({ok: false, code: 'UNSUPPORTED_CAPABILITY'}, 2);
  });
  await assert.rejects(
    recUnsupported.ports.recognition.recognize(recognitionRequest()).result,
    error => error.code === 'UNSUPPORTED_CAPABILITY'
      && error.message === 'Windows System.Speech is unavailable',
  );
  assert.equal(recUnsupported.calls.length, 1);
  await recUnsupported.ports.dispose();
});

test('host external failure envelope reports operation failed without leaking text', async () => {
  const {ports, calls} = factory(process => {
    process.respond({ok: false, code: 'EXTERNAL_FAILURE'}, 1);
  });
  await assert.rejects(
    ports.output.speak(speechRequest()).result,
    error => error.code === 'EXTERNAL_FAILURE'
      && error.message === 'Windows speech operation failed',
  );
  assert.equal(calls.length, 1);
  await ports.dispose();
});
