import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAuthorizationPolicy } from '@personal-agent/policy';
import { ToolGateway } from '../dist/index.js';
import {ProtocolError} from '@personal-agent/contracts';

const now = Date.parse('2026-09-05T12:00:00.000Z');
const descriptor = {
  name: 'fixture.read',
  version: '1.0.0',
  inputSchema: {type: 'object', required: ['value'], additionalProperties: false, properties: {value: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['value'], additionalProperties: false, properties: {value: {type: 'string'}}},
  sideEffect: 'read',
  requiredScopes: ['fixture:read'],
  idempotencySupport: true,
  recoverySupport: true,
  requiresPresence: false,
};

const invocation = (overrides = {}) => ({
  toolName: 'fixture.read',
  toolVersion: '1.0.0',
  arguments: {value: 'ok'},
  taskId: 'task-1',
  runId: 'run-1',
  authorizationRef: 'auth-1',
  deadline: '2026-09-05T12:01:00.000Z',
  signal: new AbortController().signal,
  ...overrides,
});

const setup = (grant = {}) => {
  const policy = new InMemoryAuthorizationPolicy();
  policy.grant({
    authorizationRef: 'auth-1',
    taskId: 'task-1',
    toolName: 'fixture.read',
    scopes: ['fixture:read'],
    expiresAt: '2026-09-05T13:00:00.000Z',
    ...grant,
  });
  return {policy, gateway: new ToolGateway({policy, now: () => now})};
};

test('registered tools receive only policy-derived scopes', async () => {
  const {gateway} = setup();
  let received;
  gateway.register({descriptor, execute: async (input, context) => {
    received = context;
    return input;
  }});
  assert.deepEqual(await gateway.invoke(invocation()), {value: 'ok'});
  assert.deepEqual(received.scopes, ['fixture:read']);
  assert.equal(received.authorizationRef, 'auth-1');
});

test('write failures preserve classified cause and stage without exposing external text or retrying', async () => {
  for (const cause of ['EACCES','ENOENT','ECONNREFUSED','UNAUTHORIZED']) {
    const {gateway}=setup();let calls=0;
    gateway.register({descriptor:{...descriptor,sideEffect:'external_write'},execute:async()=>{
      calls++;throw Object.assign(new Error('token=synthetic-secret /private/mail/body.eml confidential body'),{code:cause});
    }});
    await assert.rejects(gateway.invoke(invocation()),error=>{
      assert.equal(error.code,'RESULT_UNKNOWN');assert.match(error.message,new RegExp(`stage=execute; cause=${cause}`));
      assert.doesNotMatch(error.message,/synthetic-secret|private|confidential/);return true;
    });
    assert.equal(calls,1);
  }
});

test('read protocol errors are classified safely and output validation has its own stage', async () => {
  const {gateway}=setup();
  const dispose=gateway.register({descriptor,execute:async()=>{throw new ProtocolError('UNAUTHORIZED','Bearer synthetic-secret');}});
  await assert.rejects(gateway.invoke(invocation()),error=>error.code==='UNAUTHORIZED'&&error.message.includes('cause=UNAUTHORIZED')&&!error.message.includes('synthetic-secret'));
  dispose();gateway.register({descriptor:{...descriptor,sideEffect:'external_write'},execute:async()=>({wrong:true})});
  await assert.rejects(gateway.invoke(invocation()),error=>error.code==='RESULT_UNKNOWN'&&error.message.includes('stage=output_validation; cause=INVALID_ARGUMENT'));
});

test('HTTP authentication and rate limits remain distinct inside unknown write failures', async()=>{
  const messages=[];
  for(const status of [401,429]){
    const {gateway}=setup();gateway.register({descriptor:{...descriptor,sideEffect:'external_write'},execute:async()=>{
      throw Object.assign(Error('private response body'),{status});
    }});
    await assert.rejects(gateway.invoke(invocation()),error=>{
      assert.equal(error.code,'RESULT_UNKNOWN');assert.match(error.message,new RegExp(`status=${status}`));messages.push(error.message);return true;
    });
  }
  assert.match(messages[0],/认证失败/);assert.match(messages[1],/频率或配额/);
});

test('forged, mismatched and insufficient authorizations are rejected', async () => {
  const {gateway} = setup({scopes: ['other:read']});
  gateway.register({descriptor, execute: async input => input});
  await assert.rejects(gateway.invoke(invocation()), {code: 'SCOPE_DENIED'});
  await assert.rejects(gateway.invoke(invocation({authorizationRef: 'forged'})), {code: 'UNAUTHORIZED'});
  await assert.rejects(gateway.invoke(invocation({taskId: 'task-2'})), {code: 'UNAUTHORIZED'});
});

test('invalid input does not consume a one-use authorization', async () => {
  const {policy, gateway} = setup({maxUses: 1});
  gateway.register({descriptor, execute: async input => input});
  await assert.rejects(gateway.invoke(invocation({arguments: {}})), {code: 'INVALID_ARGUMENT'});
  assert.equal(policy.get('auth-1').usesRemaining, 1);
  await gateway.invoke(invocation());
  assert.equal(policy.get('auth-1').usesRemaining, 0);
});

test('read cancellation reaches the tool and reports CANCELLED', async () => {
  const {gateway} = setup();
  let toolSignal;
  gateway.register({descriptor, execute: async (_input, context) => {
    toolSignal = context.signal;
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true}));
    return {value: 'late'};
  }});
  const controller = new AbortController();
  const pending = gateway.invoke(invocation({signal: controller.signal}));
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
  assert.equal(toolSignal.aborted, true);
});

test('an in-flight read deadline aborts the tool and reports TIMEOUT', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now});
  const current = Date.now();
  const policy = new InMemoryAuthorizationPolicy();
  policy.grant({
    authorizationRef: 'auth-timeout',
    taskId: 'task-1',
    toolName: 'fixture.read',
    scopes: ['fixture:read'],
    expiresAt: new Date(current + 10_000).toISOString(),
  });
  const gateway = new ToolGateway({policy});
  let toolSignal;
  gateway.register({descriptor, execute: async (_input, context) => {
    toolSignal = context.signal;
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true}));
    return {value: 'late'};
  }});
  const pending = gateway.invoke(invocation({
    authorizationRef: 'auth-timeout',
    deadline: new Date(current + 20).toISOString(),
  }));
  assert.ok(toolSignal, 'the tool must start before testing an in-flight deadline');
  const rejected = assert.rejects(pending, {code: 'TIMEOUT'});
  t.mock.timers.tick(20);
  await rejected;
  assert.equal(toolSignal.aborted, true);
});

test('an interrupted external write is RESULT_UNKNOWN and is never retried', async () => {
  const {policy, gateway} = setup();
  policy.revoke('auth-1');
  policy.grant({
    authorizationRef: 'auth-write',
    taskId: 'task-1',
    toolName: 'fixture.write',
    scopes: ['fixture:write'],
    expiresAt: '2026-09-05T13:00:00.000Z',
  });
  let calls = 0;
  gateway.register({descriptor: {...descriptor, name: 'fixture.write', sideEffect: 'external_write', requiredScopes: ['fixture:write']}, execute: async (_input, context) => {
    calls++;
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true}));
    return {value: 'unknown'};
  }});
  const controller = new AbortController();
  const pending = gateway.invoke(invocation({toolName: 'fixture.write', authorizationRef: 'auth-write', signal: controller.signal}));
  controller.abort();
  await assert.rejects(pending, {code: 'RESULT_UNKNOWN'});
  assert.equal(calls, 1);
});

test('output, version, presence, deadline and disposal are enforced', async () => {
  const {policy, gateway} = setup();
  const unregister = gateway.register({descriptor, execute: async () => ({wrong: true})});
  await assert.rejects(gateway.invoke(invocation()), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(gateway.invoke(invocation({toolVersion: '2.0.0'})), {code: 'PROTOCOL_MISMATCH'});
  await assert.rejects(gateway.invoke(invocation({deadline: '2026-09-05T11:00:00.000Z'})), {code: 'TIMEOUT'});
  unregister();
  await assert.rejects(gateway.invoke(invocation()), {code: 'UNSUPPORTED_CAPABILITY'});

  policy.revoke('auth-1');
  policy.grant({
    authorizationRef: 'auth-presence',
    taskId: 'task-1',
    toolName: 'fixture.present',
    scopes: ['fixture:read'],
    expiresAt: '2026-09-05T13:00:00.000Z',
  });
  gateway.register({descriptor: {...descriptor, name: 'fixture.present', requiresPresence: true}, execute: async input => input});
  await assert.rejects(gateway.invoke(invocation({toolName: 'fixture.present', authorizationRef: 'auth-presence'})), {code: 'UNAUTHORIZED'});
  assert.equal(gateway.list().length, 1);
});
