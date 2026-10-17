import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  VOICE_AUDIO_FORMAT,
  VoiceSessionError,
  createVoicePcmFrameSourcePort,
} from '../dist/index.js';
import {
  FakeVoicePcmCaptureBinding,
} from '../dist/testing.js';

const futureDeadline = (offsetMs = 10_000) => new Date(Date.now() + offsetMs).toISOString();

test('frame bound and overflow ends subscription without truncation or silent drop', async () => {
  const fakeBinding = new FakeVoicePcmCaptureBinding();
  const port = createVoicePcmFrameSourcePort(fakeBinding);

  let endReason;
  let endCount = 0;
  const receivedFrames = [];

  let resolveFirstFrame;
  const firstFrameGate = new Promise(resolve => {
    resolveFirstFrame = resolve;
  });

  const controller = new AbortController();
  const chunk1 = new Uint8Array(3200).fill(1);

  const sub = port.subscribe({
    signal: controller.signal,
    deadline: futureDeadline(),
    onFrame: async frame => {
      receivedFrames.push(frame);
      if (receivedFrames.length === 1) {
        // Independent copy: modifying original chunk1 while callback is active does not alter frame.data
        chunk1.fill(99);
        assert.equal(frame.data[0], 1);
        await firstFrameGate;
      }
    },
    onEnd: reason => {
      endCount += 1;
      endReason = reason;
    },
  });

  assert.equal(fakeBinding.startCount, 1);
  assert.equal(fakeBinding.activeSubscriptions, 1);

  // Emit Frame 1 (3200 bytes, valid 16kHz mono S16LE, 100ms)
  fakeBinding.emitFrame(chunk1);

  // Push 4 more frames while Frame 1 is blocked in onFrame
  // Frames 2, 3, 4, 5 fill queue up to 4 frames (12800 bytes)
  for (let i = 0; i < 4; i++) {
    const chunk = new Uint8Array(3200).fill(i + 2);
    fakeBinding.emitFrame(chunk);
  }

  // Push 6th frame to exceed queue bound (max 4 frames / 12800 bytes)
  const chunk6 = new Uint8Array(3200).fill(9);
  fakeBinding.emitFrame(chunk6);

  // Unblock first frame
  resolveFirstFrame();
  await sub.closed;

  // Overflow ended subscription immediately
  assert.equal(endCount, 1);
  assert.equal(endReason, 'overflow');
  assert.equal(fakeBinding.releaseCount, 1);
  assert.equal(fakeBinding.activeSubscriptions, 0);

  // First frame was delivered with sequence 0 and format
  assert.equal(receivedFrames.length, 1);
  assert.equal(receivedFrames[0].sequence, 0);
  assert.equal(receivedFrames[0].data.byteLength, 3200);
  assert.deepEqual(receivedFrames[0].format, VOICE_AUDIO_FORMAT);

  // Frame data is zeroed after callback settles and session closes
  assert.equal(receivedFrames[0].data.every(b => b === 0), true);
});

test('unsubscribe and cancel invalidate immediately with no late callbacks and await upstream release', async () => {
  const fakeBinding = new FakeVoicePcmCaptureBinding({releaseDelayMs: 20});
  const port = createVoicePcmFrameSourcePort(fakeBinding);

  // 1. Unsubscribe flow
  const receivedA = [];
  let endReasonA;
  let endCountA = 0;

  const subA = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: frame => {
      receivedA.push(frame);
    },
    onEnd: reason => {
      endCountA += 1;
      endReasonA = reason;
    },
  });

  await subA.ready;

  fakeBinding.emitFrame(new Uint8Array(640).fill(1));
  assert.equal(receivedA.length, 1);
  assert.equal(receivedA[0].sequence, 0);

  // Immediate unsubscribe invalidation
  subA.unsubscribe();
  subA.unsubscribe(); // Idempotent check

  // Emit late frame after unsubscribe
  fakeBinding.emitFrame(new Uint8Array(640).fill(2));

  let closedSettled = false;
  const closePromise = subA.closed.then(() => {
    closedSettled = true;
  });

  // Upstream release is delayed by 20ms; closed has not settled immediately
  assert.equal(closedSettled, false);
  await closePromise;
  assert.equal(closedSettled, true);

  // Proves no late onFrame callbacks and onEnd called exactly once with 'disposed'
  assert.equal(receivedA.length, 1);
  assert.equal(endCountA, 1);
  assert.equal(endReasonA, 'disposed');
  assert.equal(fakeBinding.releaseCount, 1);
  assert.equal(receivedA[0].data.every(b => b === 0), true);

  // 2. Abort cancellation flow
  const receivedB = [];
  let endReasonB;
  let endCountB = 0;
  const abortCtrl = new AbortController();

  const subB = port.subscribe({
    signal: abortCtrl.signal,
    deadline: futureDeadline(),
    onFrame: frame => {
      receivedB.push(frame);
    },
    onEnd: reason => {
      endCountB += 1;
      endReasonB = reason;
    },
  });

  fakeBinding.emitFrame(new Uint8Array(320).fill(3));
  assert.equal(receivedB.length, 1);

  // Cancel via AbortSignal
  abortCtrl.abort();

  // Emit late frame
  fakeBinding.emitFrame(new Uint8Array(320).fill(4));
  await subB.closed;

  assert.equal(receivedB.length, 1);
  assert.equal(endCountB, 1);
  assert.equal(endReasonB, 'cancelled');
  assert.equal(fakeBinding.releaseCount, 2);
  assert.equal(receivedB[0].data.every(b => b === 0), true);
});

test('hanging onFrame does not delay closed and in-flight frame is zeroed immediately', async () => {
  const fakeBinding = new FakeVoicePcmCaptureBinding({releaseDelayMs: 15});
  const port = createVoicePcmFrameSourcePort(fakeBinding);

  let hangFrame;
  let frameCount = 0;
  let endCalled = false;
  let endReason;

  const sub = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: frame => {
      frameCount += 1;
      hangFrame = frame;
      // Untrusted hanging user callback that never resolves
      return new Promise(() => {});
    },
    onEnd: reason => {
      endCalled = true;
      endReason = reason;
    },
  });

  fakeBinding.emitFrame(new Uint8Array(640).fill(7));
  assert.equal(frameCount, 1);
  assert.equal(hangFrame.data[0], 7);

  // Invalidate subscription while onFrame is still hanging
  sub.unsubscribe();

  // In-flight data must be immediately zeroed on close
  assert.equal(hangFrame.data.every(b => b === 0), true);

  // closed must resolve awaiting only upstream release, without waiting for hanging onFrame
  await sub.closed;
  assert.equal(endCalled, true);
  assert.equal(endReason, 'disposed');
  assert.equal(fakeBinding.releaseCount, 1);

  // Subsequent upstream frames must not trigger further onFrame invocations
  fakeBinding.emitFrame(new Uint8Array(640).fill(8));
  assert.equal(frameCount, 1);
});

test('synchronous revoked-before-return waits for returned handle and delays closed until release completes', async () => {
  let releaseCalls = 0;
  let releaseCompleted = false;

  const binding = {
    start(sink) {
      sink.onRevoked();
      return {
        async release() {
          releaseCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 30));
          releaseCompleted = true;
        },
      };
    },
  };

  const port = createVoicePcmFrameSourcePort(binding);
  let endCalled = false;
  let endReason;

  const sub = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: reason => {
      endCalled = true;
      endReason = reason;
    },
  });

  assert.equal(endCalled, true);
  assert.equal(endReason, 'revoked');

  let closedSettled = false;
  const closedPromise = sub.closed.then(() => {
    closedSettled = true;
  });

  assert.equal(closedSettled, false);
  assert.equal(releaseCompleted, false);

  await closedPromise;

  assert.equal(closedSettled, true);
  assert.equal(releaseCompleted, true);
  assert.equal(releaseCalls, 1);
});

test('upstream release rejection causes closed and port dispose to reject with EXTERNAL_FAILURE', async () => {
  const binding = {
    start() {
      return {
        async release() {
          throw new Error('Host capture release failed');
        },
      };
    },
  };

  const port = createVoicePcmFrameSourcePort(binding);
  let endCalled = false;
  let endReason;

  const sub = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: reason => {
      endCalled = true;
      endReason = reason;
    },
  });

  sub.unsubscribe();

  assert.equal(endCalled, true);
  assert.equal(endReason, 'disposed');

  await assert.rejects(
    sub.closed,
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture release failed');
      return true;
    },
  );

  // sub.closed rejection settled and session was removed from activeSet; later dispose() must still reject
  await assert.rejects(
    port.dispose(),
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture release failed');
      return true;
    },
  );

  // Repeated call to dispose() still rejects with same failure
  await assert.rejects(
    port.dispose(),
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture release failed');
      return true;
    },
  );
});

test('unsubscribe then port.dispose while delayed release is pending awaits release completion', async () => {
  let releaseCompleted = false;
  const binding = {
    start() {
      return {
        async release() {
          await new Promise(resolve => setTimeout(resolve, 30));
          releaseCompleted = true;
        },
      };
    },
  };

  const port = createVoicePcmFrameSourcePort(binding);
  const sub = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: () => {},
  });

  sub.unsubscribe();
  assert.equal(releaseCompleted, false);

  let disposeSettled = false;
  const disposePromise = port.dispose().then(() => {
    disposeSettled = true;
  });

  assert.equal(disposeSettled, false);
  assert.equal(releaseCompleted, false);

  await disposePromise;
  assert.equal(disposeSettled, true);
  assert.equal(releaseCompleted, true);
});

test('multi-subscription release failure waits for all pending releases and sync start failure rejects closed', async () => {
  let sub1ReleaseCompleted = false;
  let sub2ReleaseCompleted = false;

  let callIndex = 0;
  const multiBinding = {
    start() {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          async release() {
            await new Promise(resolve => setTimeout(resolve, 10));
            sub1ReleaseCompleted = true;
            throw new Error('Host capture release failed');
          },
        };
      }
      return {
        async release() {
          await new Promise(resolve => setTimeout(resolve, 40));
          sub2ReleaseCompleted = true;
        },
      };
    },
  };

  const port = createVoicePcmFrameSourcePort(multiBinding);
  port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: () => {},
  });
  port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: () => {},
  });

  const disposeStart = Date.now();
  await assert.rejects(
    port.dispose(),
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture release failed');
      return true;
    },
  );
  const elapsed = Date.now() - disposeStart;

  assert.equal(sub1ReleaseCompleted, true);
  assert.equal(sub2ReleaseCompleted, true);
  assert.ok(elapsed >= 35, `Expected >= 35ms, took ${elapsed}ms`);

  let syncEndReason;
  let immediateResubscribeError;
  let startCalls = 0;
  const failingBinding = {
    start() {
      startCalls += 1;
      throw new Error('Immediate hardware failure');
    },
  };
  const failPort = createVoicePcmFrameSourcePort(failingBinding);
  const failSub = failPort.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: reason => {
      syncEndReason = reason;
      try {
        failPort.subscribe({
          signal: new AbortController().signal,
          deadline: futureDeadline(),
          onFrame: () => {},
          onEnd: () => {},
        });
      } catch (error) {
        immediateResubscribeError = error;
      }
    },
  });

  assert.equal(syncEndReason, 'device_unavailable');
  assert.equal(immediateResubscribeError.code, 'EXTERNAL_FAILURE');
  assert.equal(startCalls, 1);
  await assert.rejects(
    failSub.ready,
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture start failed');
      return true;
    },
  );
  await assert.rejects(
    failSub.closed,
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Voice PCM capture release failed');
      return true;
    },
  );
  assert.throws(
    () => failPort.subscribe({
      signal: new AbortController().signal,
      deadline: futureDeadline(),
      onFrame: () => {},
      onEnd: () => {},
    }),
    error => error.code === 'EXTERNAL_FAILURE',
  );
  assert.equal(startCalls, 1);
});

test('concurrent subscriptions coexist on shared binding and closing one does not stop the other', async () => {
  const fakeBinding = new FakeVoicePcmCaptureBinding({releaseDelayMs: 20});
  const port = createVoicePcmFrameSourcePort(fakeBinding);

  const framesA = [];
  const framesB = [];
  let endCountA = 0;
  let endCountB = 0;

  const subA = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: frame => {
      framesA.push(frame);
    },
    onEnd: () => {
      endCountA += 1;
    },
  });

  const subB = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: frame => {
      framesB.push(frame);
    },
    onEnd: () => {
      endCountB += 1;
    },
  });

  await subA.ready;
  await subB.ready;

  assert.equal(fakeBinding.startCount, 2);
  assert.equal(fakeBinding.activeSubscriptions, 2);

  // Both receive frame 1
  fakeBinding.emitFrame(new Uint8Array(640).fill(1));
  assert.equal(framesA.length, 1);
  assert.equal(framesB.length, 1);

  // Close subA
  subA.unsubscribe();
  await subA.closed;

  assert.equal(endCountA, 1);
  assert.equal(endCountB, 0);
  assert.equal(fakeBinding.activeSubscriptions, 1);
  assert.equal(fakeBinding.releaseCount, 1);

  // subB continues receiving frame 2 while subA receives nothing
  fakeBinding.emitFrame(new Uint8Array(640).fill(2));
  assert.equal(framesA.length, 1);
  assert.equal(framesB.length, 2);

  // Port disposal cleans up subB and awaits its release
  await port.dispose();
  assert.equal(endCountB, 1);
  assert.equal(fakeBinding.activeSubscriptions, 0);
  assert.equal(fakeBinding.releaseCount, 2);
});

test('async start with stop before ready rejects ready and releases late handle exactly once', async () => {
  let releaseCalls = 0;
  let releaseCompleted = false;
  let resolveStart;
  const startGate = new Promise(resolve => {
    resolveStart = resolve;
  });

  const binding = {
    async start() {
      await startGate;
      return {
        async release() {
          releaseCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 20));
          releaseCompleted = true;
        },
      };
    },
  };

  const port = createVoicePcmFrameSourcePort(binding);
  let endReason;

  const sub = port.subscribe({
    signal: new AbortController().signal,
    deadline: futureDeadline(),
    onFrame: () => {},
    onEnd: reason => {
      endReason = reason;
    },
  });

  // Stop the subscription BEFORE startGate resolves (while binding.start() is still pending)
  sub.unsubscribe();
  assert.equal(endReason, 'disposed');

  // ready must reject with INVALID_STATE because session was disposed before ready
  await assert.rejects(
    sub.ready,
    error => {
      assert.equal(error instanceof VoiceSessionError, true);
      assert.equal(error.code, 'INVALID_STATE');
      assert.equal(error.message, 'Voice PCM subscription disposed before capture ready');
      return true;
    },
  );

  // closed must not have settled yet because the start promise has not resolved and handle hasn't been released
  let closedSettled = false;
  const closedPromise = sub.closed.then(() => {
    closedSettled = true;
  });

  assert.equal(closedSettled, false);
  assert.equal(releaseCalls, 0);

  // Now resolve the delayed start
  resolveStart();

  // closed should await release completion
  await closedPromise;

  assert.equal(closedSettled, true);
  assert.equal(releaseCalls, 1);
  assert.equal(releaseCompleted, true);
});
