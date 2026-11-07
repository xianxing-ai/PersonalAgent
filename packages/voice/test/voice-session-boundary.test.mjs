import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  assertVoiceSessionContext,
  planHuaweiSisAvailability,
  VoiceSessionError,
} from '../dist/index.js';

test('assertVoiceSessionContext rejects non-object contexts', () => {
  for (const invalid of [null, undefined, 42, 'context', true, [1, 2, 3]]) {
    assert.throws(
      () => assertVoiceSessionContext(invalid),
      error => error instanceof VoiceSessionError && error.code === 'INVALID_ARGUMENT'
    );
  }
});

test('assertVoiceSessionContext rejects malformed or invalid deadline formats', () => {
  const signal = new AbortController().signal;
  const invalidDeadlines = [
    undefined,
    null,
    123,
    '',
    '2026-11-07',
    '2026-11-07T00:00:00',
    '2026-11-07T00:00:00+08:00',
    'invalid-date',
    // 2026-02-30 does not exist; Date.parse rolls over to March, which fails canonical match
    '2026-02-30T00:00:00Z',
  ];

  for (const deadline of invalidDeadlines) {
    assert.throws(
      () => assertVoiceSessionContext({deadline, signal}),
      error => error instanceof VoiceSessionError && error.code === 'INVALID_ARGUMENT'
    );
  }
});

test('assertVoiceSessionContext rejects expired deadlines', () => {
  const signal = new AbortController().signal;
  const pastDeadline = new Date(Date.now() - 5_000).toISOString();

  assert.throws(
    () => assertVoiceSessionContext({deadline: pastDeadline, signal}),
    error => error instanceof VoiceSessionError && error.code === 'TIMEOUT'
  );

  // Exact boundary using nowMs option
  const exactTime = 1_800_000_000_000;
  const exactDeadline = new Date(exactTime).toISOString();
  assert.throws(
    () => assertVoiceSessionContext({deadline: exactDeadline, signal}, {nowMs: exactTime}),
    error => error instanceof VoiceSessionError && error.code === 'TIMEOUT'
  );
});

test('assertVoiceSessionContext rejects missing or invalid AbortSignal', () => {
  const futureDeadline = new Date(Date.now() + 60_000).toISOString();

  for (const invalidSignal of [undefined, null, {}, {aborted: 'not-a-bool'}, {aborted: false}]) {
    assert.throws(
      () => assertVoiceSessionContext({deadline: futureDeadline, signal: invalidSignal}),
      error => error instanceof VoiceSessionError && error.code === 'INVALID_ARGUMENT'
    );
  }
});

test('assertVoiceSessionContext rejects already aborted signal with CANCELLED code', () => {
  const futureDeadline = new Date(Date.now() + 60_000).toISOString();
  const controller = new AbortController();
  controller.abort();

  assert.throws(
    () => assertVoiceSessionContext({deadline: futureDeadline, signal: controller.signal}),
    error => error instanceof VoiceSessionError && error.code === 'CANCELLED'
  );
});

test('assertVoiceSessionContext returns validated context for valid deadline and signal', () => {
  const now = 1_800_000_000_000;
  const future = now + 15_000;
  const deadline = new Date(future).toISOString();
  const controller = new AbortController();

  const validated = assertVoiceSessionContext({deadline, signal: controller.signal}, {nowMs: now});

  assert.equal(validated.deadline, deadline);
  assert.equal(validated.expiresAt, future);
  assert.equal(validated.remainingMs, 15_000);
  assert.equal(validated.signal, controller.signal);
  assert.ok(Object.isFrozen(validated));
});

test('planHuaweiSisAvailability returns unavailable when config is missing or invalid', () => {
  for (const input of [undefined, null, 123, 'config', [], {}]) {
    const plan = planHuaweiSisAvailability(input);
    assert.equal(plan.available, false);
    assert.equal(plan.reason, 'unavailable');
  }
});

test('planHuaweiSisAvailability returns unavailable when region or project is missing or unsupported', () => {
  const tokenPort = {async getSisToken() { return 'token'; }};

  // Missing or unknown region
  for (const region of [undefined, '', 'cn-south-1', 'us-east-1']) {
    const plan = planHuaweiSisAvailability({region, projectId: 'proj-1', tokenPort});
    assert.equal(plan.available, false);
    assert.equal(plan.reason, 'unavailable');
  }

  // Missing or invalid project ID
  for (const projectId of [undefined, '', '   ', 'bad proj/id', 'project@domain']) {
    const plan = planHuaweiSisAvailability({region: 'cn-north-4', projectId, tokenPort});
    assert.equal(plan.available, false);
    assert.equal(plan.reason, 'unavailable');
  }
});

test('planHuaweiSisAvailability returns unavailable when auth ports are missing or ambiguous', () => {
  // Neither tokenPort nor requestAuthPort
  const noAuthPlan = planHuaweiSisAvailability({region: 'cn-north-4', projectId: 'proj-1'});
  assert.equal(noAuthPlan.available, false);
  assert.equal(noAuthPlan.reason, 'unavailable');

  // Both tokenPort and requestAuthPort (ambiguous configuration)
  const bothPlan = planHuaweiSisAvailability({
    region: 'cn-north-4',
    projectId: 'proj-1',
    tokenPort: {async getSisToken() { return 'token'; }},
    requestAuthPort: {async getSisRequestHeaders() { return {}; }},
  });
  assert.equal(bothPlan.available, false);
  assert.equal(bothPlan.reason, 'unavailable');

  // tokenPort without getSisToken method
  const badTokenPlan = planHuaweiSisAvailability({
    region: 'cn-north-4',
    projectId: 'proj-1',
    tokenPort: {},
  });
  assert.equal(badTokenPlan.available, false);
  assert.equal(badTokenPlan.reason, 'unavailable');

  // requestAuthPort without getSisRequestHeaders method
  const badAuthPlan = planHuaweiSisAvailability({
    region: 'cn-north-4',
    projectId: 'proj-1',
    requestAuthPort: {},
  });
  assert.equal(badAuthPlan.available, false);
  assert.equal(badAuthPlan.reason, 'unavailable');
});

test('planHuaweiSisAvailability returns unavailable when transport is unavailable', () => {
  const plan = planHuaweiSisAvailability({
    region: 'cn-north-4',
    projectId: 'proj-1',
    tokenPort: {async getSisToken() { return 'token'; }},
    fetchImpl: 'not-a-function',
  });
  assert.equal(plan.available, false);
  assert.equal(plan.reason, 'unavailable');
});

test('planHuaweiSisAvailability successfully plans token-based configuration offline', () => {
  let tokenCalls = 0;
  let fetchCalls = 0;

  const plan = planHuaweiSisAvailability({
    region: 'cn-north-4',
    projectId: 'proj-valid_123',
    tokenPort: {
      async getSisToken() {
        tokenCalls++;
        return 'must-not-be-called';
      },
    },
    fetchImpl: async () => {
      fetchCalls++;
      throw new Error('must-not-be-called');
    },
  });

  assert.equal(plan.available, true);
  assert.equal(plan.reason, 'ready');
  assert.equal(plan.region, 'cn-north-4');
  assert.equal(plan.projectId, 'proj-valid_123');
  assert.equal(plan.authMode, 'token');
  assert.equal(plan.endpoint, 'https://sis-ext.cn-north-4.myhuaweicloud.com');
  assert.ok(Object.isFrozen(plan));

  // Assert offline contract: no token calls, no network calls
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('planHuaweiSisAvailability successfully plans signed-auth configuration offline', () => {
  let authCalls = 0;
  let fetchCalls = 0;

  const plan = planHuaweiSisAvailability({
    region: 'cn-east-3',
    projectId: 'proj-east',
    requestAuthPort: {
      async getSisRequestHeaders() {
        authCalls++;
        return {};
      },
    },
    fetchImpl: async () => {
      fetchCalls++;
      throw new Error('must-not-be-called');
    },
  });

  assert.equal(plan.available, true);
  assert.equal(plan.reason, 'ready');
  assert.equal(plan.region, 'cn-east-3');
  assert.equal(plan.projectId, 'proj-east');
  assert.equal(plan.authMode, 'signature');
  assert.equal(plan.endpoint, 'https://sis-ext.cn-east-3.myhuaweicloud.com');
  assert.ok(Object.isFrozen(plan));

  // Assert offline contract: no auth signing calls, no network calls
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
});
