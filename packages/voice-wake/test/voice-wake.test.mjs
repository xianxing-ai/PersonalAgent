import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  FakeWakeAuthorization,
  FakeWakeClock,
  FakeWakeSource,
  WakeLifecycleController,
} from '../dist/index.js';

const setup = (options = {}) => {
  const clock = options.clock ?? new FakeWakeClock(0);
  const source = options.source ?? new FakeWakeSource();
  const authorization = options.authorization ?? new FakeWakeAuthorization({expiresAtMs: 100});
  const wakes = [];
  const errors = [];
  const controller = new WakeLifecycleController({
    authorization,
    source,
    clock,
    cooldownMs: options.cooldownMs ?? 0,
    onWake: event => wakes.push(event),
    onError: error => errors.push(error),
  });
  return {clock, source, authorization, wakes, errors, controller};
};

const enable = (controller, deadlineAtMs = 100) => controller.enable({deadlineAtMs});

test('starts disabled and subscribes exactly once only after explicit enable', async () => {
  const {controller, source, authorization} = setup();
  assert.deepEqual(controller.snapshot(), {
    state: 'disabled', sessionId: null, expiresAtMs: null, playbackActive: false, cooldownUntilMs: null,
  });
  assert.equal(source.activeSubscriptions, 0);
  const first = await enable(controller);
  const second = await enable(controller);
  assert.equal(first.kind, 'listening');
  assert.equal(second.kind, 'listening');
  assert.equal(source.subscribeCount, 1);
  assert.equal(source.activeSubscriptions, 1);
  assert.equal(authorization.checks, 1);
});

test('wake output is fixed and contains no source text or recognition result', async () => {
  const {controller, source, wakes} = setup();
  await enable(controller);
  source.emit({kind: 'wake', text: 'private transcript'});
  assert.deepEqual(wakes, [{kind: 'wake', sessionId: 1, occurredAtMs: 0}]);
  assert.equal(JSON.stringify(wakes).includes('private transcript'), false);
});

test('disable and repeated stop are idempotent and drop late callbacks', async () => {
  const {controller, source, wakes, errors} = setup();
  await enable(controller);
  controller.disable();
  controller.stop();
  source.emitLate({kind: 'wake'});
  assert.equal(source.activeSubscriptions, 0);
  assert.equal(wakes.length, 0);
  assert.deepEqual(errors, []);
  assert.equal(controller.snapshot().state, 'disabled');
});

test('revocation immediately stops the session and suppresses callbacks', async () => {
  const {controller, source, authorization, wakes, errors} = setup();
  await enable(controller);
  authorization.revoke();
  source.emitLate({kind: 'wake'});
  assert.equal(source.activeSubscriptions, 0);
  assert.equal(wakes.length, 0);
  assert.deepEqual(errors, [{code: 'AUTHORIZATION_REVOKED'}]);
});

for (const reason of ['revocation', 'caller-cancel']) {
  test(`an earlier ${reason} observer cannot deliver wake while cancellation is being dispatched`, async () => {
    const revoked = new AbortController(), caller = new AbortController();
    const source = new FakeWakeSource();
    const interrupted = reason === 'revocation' ? revoked : caller;
    interrupted.signal.addEventListener('abort', () => source.emit({kind: 'wake'}), {once: true});
    const {controller, wakes, errors} = setup({source, authorization: {check: async () => ({
      kind: 'allowed', expiresAtMs: 100, revocationSignal: revoked.signal,
    })}});
    await controller.enable({deadlineAtMs: 100, signal: caller.signal});
    source.emit({kind: 'wake'});
    assert.equal(wakes.length, 1);
    interrupted.abort();
    assert.equal(wakes.length, 1);
    assert.equal(source.activeSubscriptions, 0);
    assert.equal(source.subscribeCount, 1);
    assert.equal(controller.snapshot().state, 'disabled');
    assert.deepEqual(errors, [{code: reason === 'revocation' ? 'AUTHORIZATION_REVOKED' : 'CANCELLED'}]);
    controller.dispose();
  });
}

test('expiry cancels the source and cannot be bypassed by a late event', async () => {
  const {controller, source, clock, wakes, errors} = setup();
  await enable(controller);
  clock.advance(100);
  source.emitLate({kind: 'wake'});
  assert.equal(source.activeSubscriptions, 0);
  assert.equal(wakes.length, 0);
  assert.deepEqual(errors, [{code: 'EXPIRED'}]);
  assert.equal(controller.snapshot().state, 'disabled');
});

test('enable releases an expired source when a suspended host has not fired its timer', async () => {
  let currentMs = 0;
  const clock = {
    now: () => currentMs,
    setTimeout: () => ({cancel() {}}),
  };
  const {controller, source, errors} = setup({clock});
  assert.equal((await enable(controller)).kind, 'listening');
  assert.equal(source.activeSubscriptions, 1);

  currentMs = 100;
  assert.deepEqual(await enable(controller), {kind: 'not_listening', reason: 'expired'});
  assert.equal(source.activeSubscriptions, 0);
  assert.equal(controller.snapshot().state, 'disabled');
  assert.equal(errors[0]?.code, 'EXPIRED');
});

test('device loss stops listening without exposing source details', async () => {
  const {controller, source, errors} = setup();
  await enable(controller);
  source.emit({kind: 'device_unavailable', detail: 'microphone secret'});
  assert.equal(source.activeSubscriptions, 0);
  assert.deepEqual(errors, [{code: 'DEVICE_UNAVAILABLE'}]);
  assert.equal(JSON.stringify(errors).includes('microphone secret'), false);
});

test('dispose is idempotent and prevents a later enable', async () => {
  const {controller, source, errors} = setup();
  await enable(controller);
  controller.dispose();
  controller.dispose();
  assert.equal(source.activeSubscriptions, 0);
  assert.deepEqual(await enable(controller), {kind: 'not_listening', reason: 'disposed'});
  assert.equal(controller.snapshot().state, 'disposed');
  assert.deepEqual(errors, []);
});

test('old session callbacks cannot wake a newly enabled session', async () => {
  const {controller, source, clock, wakes} = setup();
  await enable(controller);
  controller.disable();
  await enable(controller);
  source.emitLate({kind: 'wake'});
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].sessionId, 2);
  clock.advance(100);
});

test('playback and explicit cooldown suppress wake events', async () => {
  const {controller, source, clock, wakes} = setup({cooldownMs: 50});
  await enable(controller);
  controller.setPlaybackActive(true);
  source.emit({kind: 'wake'});
  assert.equal(wakes.length, 0);
  controller.setPlaybackActive(false);
  source.emit({kind: 'wake'});
  source.emit({kind: 'wake'});
  assert.equal(wakes.length, 1);
  clock.advance(49);
  source.emit({kind: 'wake'});
  assert.equal(wakes.length, 1);
  clock.advance(1);
  source.emit({kind: 'wake'});
  assert.equal(wakes.length, 2);
});

test('caller deadline is passed to authorization and stops a session at expiry', async () => {
  const {controller, source, clock, authorization, wakes, errors} = setup();
  const result = await controller.enable({deadlineAtMs: 40});
  assert.equal(result.kind, 'listening');
  assert.equal(authorization.checks, 1);
  clock.advance(40);
  source.emitLate({kind: 'wake'});
  assert.equal(wakes.length, 0);
  assert.deepEqual(errors, [{code: 'EXPIRED'}]);
});

test('caller deadline bounds a non-cooperative permission check before subscribing', async () => {
  const clock = new FakeWakeClock(0);
  const source = new FakeWakeSource();
  let request;
  let resolvePermission;
  const authorization = {
    check: input => {
      request = input;
      return new Promise(resolve => { resolvePermission = resolve; });
    },
  };
  const controller = new WakeLifecycleController({authorization, source, clock, onWake: () => {}});
  const pending = controller.enable({deadlineAtMs: 40});
  assert.equal(request.deadlineAtMs, 40);
  clock.advance(40);
  resolvePermission({kind: 'allowed', expiresAtMs: 100, revocationSignal: new AbortController().signal});
  assert.deepEqual(await pending, {kind: 'not_listening', reason: 'expired'});
  assert.equal(source.subscribeCount, 0);
});

test('never-settling permission returns at deadline and allows a later enable', async () => {
  const clock = new FakeWakeClock(0);
  const source = new FakeWakeSource();
  let checks = 0;
  let resolveLate;
  const authorization = {
    check: input => {
      checks++;
      assert.equal(input.deadlineAtMs, checks === 1 ? 40 : 100);
      if (checks === 1) return new Promise(resolve => { resolveLate = resolve; });
      return Promise.resolve({kind: 'allowed', expiresAtMs: 100, revocationSignal: new AbortController().signal});
    },
  };
  const controller = new WakeLifecycleController({authorization, source, clock, onWake: () => {}});
  const pending = controller.enable({deadlineAtMs: 40});
  clock.advance(40);
  const result = await Promise.race([
    pending,
    new Promise(resolve => setImmediate(() => resolve('deadline did not win'))),
  ]);
  assert.deepEqual(result, {kind: 'not_listening', reason: 'expired'});
  assert.equal(source.subscribeCount, 0);

  resolveLate({kind: 'allowed', expiresAtMs: 100, revocationSignal: new AbortController().signal});
  assert.equal((await controller.enable({deadlineAtMs: 100})).kind, 'listening');
  assert.equal(checks, 2);
  assert.equal(source.subscribeCount, 1);
});

test('a delayed deadline timer cannot strand a pending authorization after resume', async () => {
  let currentMs = 0;
  const clock = {
    now: () => currentMs,
    setTimeout: () => ({cancel() {}}),
  };
  const source = new FakeWakeSource();
  let checks = 0;
  const authorization = {
    check: () => {
      checks++;
      if (checks === 1) return new Promise(() => {});
      return Promise.resolve({kind: 'allowed', expiresAtMs: 200, revocationSignal: new AbortController().signal});
    },
  };
  const controller = new WakeLifecycleController({authorization, source, clock, onWake: () => {}});
  const pending = controller.enable({deadlineAtMs: 100});
  currentMs = 100;
  assert.deepEqual(await controller.enable({deadlineAtMs: 200}), {kind: 'not_listening', reason: 'expired'});
  assert.deepEqual(await pending, {kind: 'not_listening', reason: 'expired'});
  assert.equal(source.subscribeCount, 0);
  assert.equal((await controller.enable({deadlineAtMs: 200})).kind, 'listening');
  controller.dispose();
});

test('dispose returns while permission is pending and consumes a late rejection', async () => {
  const clock = new FakeWakeClock(0);
  const source = new FakeWakeSource();
  let rejectLate;
  const authorization = {
    check: () => new Promise((resolve, reject) => { rejectLate = reject; }),
  };
  const controller = new WakeLifecycleController({authorization, source, clock, onWake: () => {}});
  const pending = controller.enable({deadlineAtMs: 100});
  controller.dispose();
  const result = await Promise.race([
    pending,
    new Promise(resolve => setImmediate(() => resolve('dispose did not win'))),
  ]);
  assert.deepEqual(result, {kind: 'not_listening', reason: 'disposed'});
  assert.equal(source.subscribeCount, 0);
  rejectLate(new Error('late private authorization detail'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.snapshot().state, 'disposed');
});

test('caller cancellation aborts permission checking without subscribing', async () => {
  const clock = new FakeWakeClock(0);
  const source = new FakeWakeSource();
  const abort = new AbortController();
  let resolvePermission;
  const authorization = {check: ({signal}) => new Promise((resolve, reject) => {
    resolvePermission = () => signal.aborted ? reject(new Error('cancelled secret')) : resolve({
      kind: 'allowed', expiresAtMs: 100, revocationSignal: new AbortController().signal,
    });
  })};
  const controller = new WakeLifecycleController({authorization, source, clock, onWake: () => {}});
  const pending = controller.enable({deadlineAtMs: 100, signal: abort.signal});
  abort.abort();
  resolvePermission();
  assert.deepEqual(await pending, {kind: 'not_listening', reason: 'cancelled'});
  assert.equal(source.subscribeCount, 0);
});

test('permission and source failures expose fixed codes only', async () => {
  const source = new FakeWakeSource();
  const permissionErrors = [];
  const permissionController = new WakeLifecycleController({
    source,
    clock: new FakeWakeClock(0),
    authorization: {check: async () => { throw new Error('credential body'); }},
    onWake: () => {},
    onError: error => permissionErrors.push(error),
  });
  assert.deepEqual(await enable(permissionController), {kind: 'not_listening', reason: 'permission_unavailable'});
  assert.deepEqual(permissionErrors, [{code: 'PERMISSION_UNAVAILABLE'}]);
  assert.equal(JSON.stringify(permissionErrors).includes('credential body'), false);

  const sourceErrors = [];
  const badSource = {subscribe: () => { throw new Error('raw source URL'); }};
  const sourceController = new WakeLifecycleController({
    source: badSource,
    authorization: new FakeWakeAuthorization({expiresAtMs: 100}),
    clock: new FakeWakeClock(0),
    onWake: () => {},
    onError: error => sourceErrors.push(error),
  });
  assert.deepEqual(await enable(sourceController), {kind: 'not_listening', reason: 'source_unavailable'});
  assert.deepEqual(sourceErrors, [{code: 'SOURCE_UNAVAILABLE'}]);
  assert.equal(JSON.stringify(sourceErrors).includes('raw source URL'), false);

  const asyncErrors = [];
  const asyncController = new WakeLifecycleController({
    source: {subscribe: () => Promise.reject(new Error('private model detail'))},
    authorization: new FakeWakeAuthorization({expiresAtMs: 100}),
    clock: new FakeWakeClock(0),
    onWake: () => {},
    onError: error => asyncErrors.push(error),
  });
  assert.deepEqual(await enable(asyncController), {kind: 'not_listening', reason: 'source_unavailable'});
  assert.deepEqual(asyncErrors, [{code: 'SOURCE_UNAVAILABLE'}]);
});

test('async source readiness does not publish listening or wake early', async () => {
  let sourceListener;
  let resolveSource;
  const source = {
    subscribe(listener) {
      sourceListener = listener;
      return new Promise(resolve => { resolveSource = resolve; });
    },
  };
  const {controller, wakes} = setup({source});
  const states = [];
  controller.subscribeLifecycle(snapshot => states.push(snapshot.state));
  const pending = enable(controller);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(states, ['disabled']);
  assert.equal(controller.snapshot().state, 'disabled');
  sourceListener({kind: 'wake'});
  assert.deepEqual(wakes, []);

  resolveSource({unsubscribe() {}});
  assert.equal((await pending).kind, 'listening');
  assert.deepEqual(states, ['disabled', 'listening']);
  sourceListener({kind: 'wake'});
  assert.equal(wakes.length, 1);
  controller.disable();
});

test('revocation and deadline settle pending source readiness and release a late subscription once', async () => {
  for (const stop of ['revoke', 'expire']) {
    let resolveSource;
    let releases = 0;
    const source = {subscribe: () => new Promise(resolve => { resolveSource = resolve; })};
    const context = setup({source});
    const pending = enable(context.controller);
    await new Promise(resolve => setImmediate(resolve));

    if (stop === 'revoke') context.authorization.revoke();
    else context.clock.advance(100);
    assert.deepEqual(await pending, {
      kind: 'not_listening', reason: stop === 'revoke' ? 'cancelled' : 'expired',
    });
    resolveSource({unsubscribe: () => { releases++; }});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(releases, 1, stop);
    assert.equal(context.controller.snapshot().state, 'disabled');
  }
});

for (const readiness of ['async', 'sync']) {
  for (const limit of ['caller', 'authorization']) {
    test(`${readiness} source readiness past the ${limit} deadline releases once before a delayed timer`, async () => {
      let currentMs = 1_000;
      const timers = [];
      const clock = {
        now: () => currentMs,
        setTimeout(callback) {
          const timer = {callback, cancelled: false};
          timers.push(timer);
          return {cancel() { timer.cancelled = true; }};
        },
      };
      let resolveSource;
      let sourceListener;
      let sourceContext;
      let releases = 0;
      const subscription = {unsubscribe() { releases++; }};
      const source = {
        subscribe(listener, context) {
          sourceListener = listener;
          sourceContext = context;
          if (readiness === 'async') return new Promise(resolve => { resolveSource = resolve; });
          currentMs = 1_500;
          return subscription;
        },
      };
      const {controller, errors, wakes} = setup({
        source, clock,
        authorization: new FakeWakeAuthorization({expiresAtMs: limit === 'authorization' ? 1_500 : 5_000}),
      });
      const states = [];
      controller.subscribeLifecycle(snapshot => states.push(snapshot.state));
      const pending = enable(controller, limit === 'caller' ? 1_500 : 5_000);
      if (readiness === 'async') {
        await new Promise(resolve => setImmediate(resolve));
        currentMs = 2_000;
        resolveSource(subscription);
      }

      assert.deepEqual(await pending, {kind: 'not_listening', reason: 'expired'});
      assert.deepEqual(states, ['disabled']);
      assert.equal(sourceContext.deadlineAtMs, 1_500);
      assert.equal(sourceContext.signal.aborted, true);
      assert.equal(releases, 1);
      assert.deepEqual(errors, [{code: 'EXPIRED'}]);
      assert.equal(timers.every(timer => timer.cancelled), true);

      sourceListener({kind: 'wake'});
      for (const timer of timers) timer.callback();
      controller.disable();
      controller.dispose();
      assert.deepEqual(wakes, []);
      assert.equal(releases, 1);
    });
  }
}

test('lifecycle subscription reports stable terminal states for every stop path', async () => {
  const scenarios = [
    {name: 'revoked', stop: context => context.authorization.revoke(), terminal: 'disabled'},
    {name: 'expired', stop: context => context.clock.advance(100), terminal: 'disabled'},
    {name: 'device unavailable', stop: context => context.source.emit({kind: 'device_unavailable'}), terminal: 'disabled'},
    {name: 'disabled', stop: context => context.controller.disable(), terminal: 'disabled'},
    {name: 'disposed', stop: context => context.controller.dispose(), terminal: 'disposed'},
  ];

  for (const scenario of scenarios) {
    const context = setup();
    const snapshots = [];
    context.controller.subscribeLifecycle(snapshot => {
      assert.equal(Object.isFrozen(snapshot), true, scenario.name);
      snapshots.push(snapshot);
    });
    assert.equal((await enable(context.controller)).kind, 'listening', scenario.name);
    scenario.stop(context);
    assert.deepEqual(snapshots, [
      {state: 'disabled', sessionId: null, expiresAtMs: null},
      {state: 'listening', sessionId: 1, expiresAtMs: 100},
      {state: scenario.terminal, sessionId: null, expiresAtMs: null},
    ], scenario.name);
  }
});

test('lifecycle listener failures are isolated and unsubscribe is idempotent', async () => {
  const {controller, errors} = setup();
  const healthy = [];
  const unsubscribeThrowing = controller.subscribeLifecycle(() => { throw new Error('private listener detail'); });
  const unsubscribeHealthy = controller.subscribeLifecycle(snapshot => healthy.push(snapshot));

  assert.equal((await enable(controller)).kind, 'listening');
  unsubscribeThrowing();
  unsubscribeThrowing();
  controller.disable();
  controller.disable();
  unsubscribeHealthy();
  unsubscribeHealthy();

  assert.deepEqual(healthy, [
    {state: 'disabled', sessionId: null, expiresAtMs: null},
    {state: 'listening', sessionId: 1, expiresAtMs: 100},
    {state: 'disabled', sessionId: null, expiresAtMs: null},
  ]);
  assert.deepEqual(errors, [{code: 'CALLBACK_FAILED'}, {code: 'CALLBACK_FAILED'}]);
  assert.equal(JSON.stringify(errors).includes('private listener detail'), false);
});

test('synchronous source failure never publishes an intermediate listening state', async () => {
  const clock = new FakeWakeClock(0);
  const states = [];
  const errors = [];
  let unsubscribeCount = 0;
  const source = {
    subscribe(listener) {
      listener({kind: 'device_unavailable'});
      return {unsubscribe: () => { unsubscribeCount++; }};
    },
  };
  const controller = new WakeLifecycleController({
    authorization: new FakeWakeAuthorization({expiresAtMs: 100}),
    source,
    clock,
    onWake: () => {},
    onError: error => errors.push(error),
  });
  controller.subscribeLifecycle(snapshot => states.push(snapshot.state));

  assert.deepEqual(await enable(controller), {kind: 'not_listening', reason: 'cancelled'});
  assert.deepEqual(states, ['disabled']);
  assert.deepEqual(errors, [{code: 'DEVICE_UNAVAILABLE'}]);
  assert.equal(unsubscribeCount, 1);
});

test('reentrant lifecycle changes do not deliver an older state after the terminal state', async () => {
  const {controller} = setup();
  const first = [];
  const second = [];
  controller.subscribeLifecycle(snapshot => {
    first.push(snapshot.state);
    if (snapshot.state === 'listening') controller.disable();
  });
  controller.subscribeLifecycle(snapshot => second.push(snapshot.state));

  assert.deepEqual(await enable(controller), {kind: 'not_listening', reason: 'cancelled'});
  assert.deepEqual(first, ['disabled', 'listening', 'disabled']);
  assert.deepEqual(second, ['disabled']);
  assert.equal(controller.snapshot().state, 'disabled');
});
