import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VoiceSessionManager, VOICE_AUDIO_FORMAT} from '../dist/index.js';

const options = () => ({signal: new AbortController().signal,
  deadline: new Date(Date.now() + 10_000).toISOString()});
const clip = () => ({data: new Uint8Array(320), format: VOICE_AUDIO_FORMAT, durationMs: 10});
const tick = () => new Promise(resolve => setImmediate(resolve));
const done = value => ({result: Promise.resolve(value), async stop() {}});

for (const kind of ['recognition', 'consumption', 'playback']) {
  for (const releaseFails of [false, true]) {
    test(`${kind} reentrant stop waits for its returned handle (${releaseFails ? 'failed' : 'confirmed'} release)`, async t => {
      const release = Promise.withResolvers();
      const stopReasons = [];
      const states = [];
      let stopping;
      let stopped = false;
      let started = false;
      const provider = request => {
        stopping = manager.stop(request.sessionId).then(result => {stopped = true; return result;});
        return {result: new Promise(() => {}), async stop(reason) {
          stopReasons.push(reason);
          await release.promise;
          if (releaseFails) throw Error('private release failure');
        }};
      };
      const manager = new VoiceSessionManager({
        recognition: {recognize: kind === 'recognition' ? provider : () => done({text: 'synthetic transcript'})},
        output: {speak: kind === 'playback' ? provider : () => done(undefined)},
      });
      t.after(async () => {
        release.resolve();
        const current = manager.current();
        if (current) await manager.stop(current.sessionId);
      });
      const session = await manager.start(options());
      manager.subscribe(snapshot => {if (snapshot.sessionId === session.sessionId) states.push(snapshot.state);});
      let transcript;
      let reply;
      if (kind !== 'recognition') transcript = await manager.recognizeAudio(session.sessionId, clip());
      if (kind === 'playback') reply = await manager.consumeTranscript(session.sessionId, transcript.transcriptId,
        {consume: () => done({replyText: 'synthetic reply'})});
      const running = (kind === 'recognition' ? manager.recognizeAudio(session.sessionId, clip())
        : kind === 'consumption' ? manager.consumeTranscript(session.sessionId, transcript.transcriptId, {consume: provider})
        : manager.speakReply(session.sessionId, reply.replyId)).catch(error => error);
      const replacement = manager.start(options()).then(value => {started = true; return value;}, error => error);
      await tick();
      assert.equal(stopped, false);
      assert.equal(started, false);
      assert.equal(manager.current().state, 'stopped');
      assert.deepEqual(stopReasons, ['user']);
      release.resolve();
      assert.equal((await stopping).resourcesReleased, !releaseFails);
      assert.equal((await running).code, 'CANCELLED');
      const next = await replacement;
      if (releaseFails) {
        assert.equal(next.code, 'EXTERNAL_FAILURE');
        assert.equal(manager.current().sessionId, session.sessionId);
      } else assert.notEqual(next.sessionId, session.sessionId);
      assert.deepEqual(states.slice(states.indexOf('stopped')), ['stopped']);
      assert.deepEqual(stopReasons, ['user']);
    });
  }
}

test('provider startup failure after reentrant stop does not strand the stop receipt', async () => {
  let stopping;
  const manager = new VoiceSessionManager({recognition: {recognize(request) {
    stopping = manager.stop(request.sessionId);
    throw Error('private startup failure');
  }}});
  const session = await manager.start(options());
  await assert.rejects(manager.recognizeAudio(session.sessionId, clip()),
    error => error.code === 'EXTERNAL_FAILURE' && !error.message.includes('private'));
  assert.equal((await stopping).resourcesReleased, true);
  assert.equal(manager.current().state, 'stopped');
});

for (const kind of ['recognition', 'consumption', 'playback']) {
  test(`${kind} failure keeps new work blocked until its handle releases`, async t => {
    const release = Promise.withResolvers();
    const manager = new VoiceSessionManager({
      recognition: {recognize: () => kind === 'recognition' ? failed() : done({text: 'synthetic transcript'})},
      output: {speak: () => failed()},
    });
    const failed = () => ({result: Promise.reject(Error('private provider failure')),
      async stop() { await release.promise; }});
    t.after(async () => { release.resolve(); await manager.stop(session.sessionId); });
    const session = await manager.start(options());
    let transcript;
    let reply;
    if (kind !== 'recognition') transcript = await manager.recognizeAudio(session.sessionId, clip());
    if (kind === 'playback') reply = await manager.consumeTranscript(session.sessionId, transcript.transcriptId,
      {consume: () => done({replyText: 'synthetic reply'})});
    const running = (kind === 'recognition' ? manager.recognizeAudio(session.sessionId, clip())
      : kind === 'consumption' ? manager.consumeTranscript(session.sessionId, transcript.transcriptId, {consume: failed})
      : manager.speakReply(session.sessionId, reply.replyId)).catch(error => error);
    await tick();
    assert.equal(manager.current().state, {recognition: 'recognizing', consumption: 'consuming', playback: 'speaking'}[kind]);
    await assert.rejects(manager.recognizeAudio(session.sessionId, clip()), {code: 'INVALID_STATE'});
    release.resolve();
    assert.equal((await running).code, 'EXTERNAL_FAILURE');
    assert.equal(manager.current().state, 'listening');
  });
}

for (const releaseFails of [false, true]) {
  test(`reentrant playback interruption awaits ${releaseFails ? 'failed' : 'confirmed'} release before readiness`, async t => {
    const release = Promise.withResolvers();
    const nextRecognition = Promise.withResolvers();
    const stopReasons = [];
    let interruption;
    let recognitionCalls = 0;
    let next;
    const manager = new VoiceSessionManager({
      recognition: {recognize() {
        recognitionCalls++;
        return recognitionCalls === 1 ? done({text: 'synthetic transcript'})
          : {result: nextRecognition.promise, async stop() {}};
      }},
      output: {speak(request) {
        interruption = manager.stopSpeaking(request.sessionId);
        return {result: new Promise(() => {}), async stop(reason) {
          stopReasons.push(reason);
          await release.promise;
          if (releaseFails) throw Error('private release failure');
        }};
      }},
    });
    t.after(async () => {
      release.resolve(); nextRecognition.resolve({text: 'next synthetic transcript'});
      await manager.stop(session.sessionId);
    });
    const session = await manager.start(options());
    const transcript = await manager.recognizeAudio(session.sessionId, clip());
    const reply = await manager.consumeTranscript(session.sessionId, transcript.transcriptId,
      {consume: () => done({replyText: 'synthetic reply'})});
    manager.subscribe(snapshot => {
      if (snapshot.state === 'listening' && !next) next = manager.recognizeAudio(session.sessionId, clip()).catch(error => error);
    });
    const running = manager.speakReply(session.sessionId, reply.replyId).catch(error => error);
    await tick();
    assert.equal(manager.current().state, 'speaking');
    assert.equal(recognitionCalls, 1);
    await assert.rejects(manager.recognizeAudio(session.sessionId, clip()), {code: 'INVALID_STATE'});
    release.resolve();
    assert.equal((await interruption).resourcesReleased, !releaseFails);
    const result = await running;
    assert.deepEqual(stopReasons, ['interrupted']);
    if (releaseFails) {
      assert.equal(manager.current().state, 'stopped');
      assert.equal(recognitionCalls, 1);
      assert.equal(result.code, 'CANCELLED');
      await assert.rejects(manager.start(options()), {code: 'EXTERNAL_FAILURE'});
    } else {
      assert.equal(result.interrupted, true);
      assert.equal(recognitionCalls, 2);
      assert.equal(manager.current().state, 'recognizing');
      nextRecognition.resolve({text: 'next synthetic transcript'});
      assert.equal((await next).characterCount, 25);
      assert.equal(manager.current().state, 'awaiting_consume');
    }
  });
}
