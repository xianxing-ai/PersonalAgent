import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeWindowsHostAttemptStore} from '../dist/application.js';
import {createWindowsHostBridgeTransport,createWindowsHostNotepadAdapter} from '../dist/application/windows-host-adapter.js';

const targetRef = 'notepad_target_123456789';
const deadline = () => new Date(Date.now() + 30000).toISOString();
const input = {targetRef, expectedText: 'old', replacementText: 'new'};
const context = () => ({taskId: 'task-1', runId: 'run-1', authorizationRef: 'grant-1',
  deadline: deadline(), signal: new AbortController().signal, scopes: ['computer:notepad:write']});
const base = frame => ({protocolVersion: frame.protocolVersion, requestId: frame.requestId,
  sessionId: frame.sessionId});
test('trusted transport rejects relative, network, device and injected journal directories before spawning',()=>{
  for(const journalDirectory of ['relative','C:relative','\\\\server\\share','\\\\?\\C:\\journal',
    'C:\\journal:stream','C:\\journal\n--host','C:\\journal" --pipe x']){
    assert.throws(()=>createWindowsHostBridgeTransport({bridgePath:'C:\\trusted\\WindowsHost.PipeBridge.exe',
      hostPath:'C:\\trusted\\WindowsHost.Host.exe',journalDirectory}),
    {code:process.platform==='win32'?'INVALID_ARGUMENT':'UNSUPPORTED_CAPABILITY'});
  }
});

function fixture({executeState = 'verified', statusState = 'not_found', mismatchedResult = false,
  presence = true, onPresence, onRecord, observationError, targetExpiresAt, targetReady = true,
  prepareObservation, onObserve,
  now, taskId = 'task-1', attemptStore} = {}) {
  const sent = [];
  const attempts = new Map();
  let sessions = 0;
  let closes = 0;
  let observedExpiresAt;
  const transport = {
    async openVerifiedConnection() {
      const sessionId = 'session_' + ++sessions;
      return {
        async send(frame) { sent.push(frame); },
        async exchange(frame) {
          sent.push(frame);
          if (frame.kind === 'hello') return {kind: 'hello_ack', protocolVersion: frame.protocolVersion,
            requestId: frame.requestId, clientNonce: frame.clientNonce,
            hostNonce: 'a'.repeat(32), sessionId};
          if (frame.kind === 'observe') {
            const refusal = await onObserve?.(frame) ?? observationError;
            if (refusal) return {kind: 'observation_refused', ...base(frame), errorCode: refusal};
            observedExpiresAt = targetExpiresAt?.() ?? deadline();
            return {kind: 'observed', ...base(frame), targetRef,
              expiresAt: observedExpiresAt, source: 'windows-uia'};
          }
          if (frame.kind === 'target_ready') return targetReady
            ? {kind: 'target_ready_result', ...base(frame), targetRef: frame.targetRef,
              ready: true, expiresAt: observedExpiresAt}
            : {kind: 'target_ready_result', ...base(frame), targetRef: frame.targetRef,
              ready: false, errorCode: 'TARGET_STALE'};
          if (frame.kind === 'execute') return {kind: 'result', ...base(frame), taskId: frame.taskId,
            runId: frame.runId, toolName: frame.toolName, toolVersion: frame.toolVersion,
            argumentsDigest: frame.argumentsDigest,
            targetRef: mismatchedResult ? 'wrong_target_123456' : frame.targetRef, state: executeState,
            startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
            ...(executeState === 'verified' ? {evidenceRef: 'host-evidence'} : {errorCode: 'RESULT_UNKNOWN'})};
          if (frame.kind === 'status') return {kind: 'status_reply', ...base(frame),
            taskId: frame.taskId, runId: frame.runId, state: statusState};
          throw Error('Unexpected frame ' + frame.kind);
        },
        async close() { closes++; },
      };
    },
  };
  const adapter = createWindowsHostNotepadAdapter({transport, now, prepareObservation,
    attempts: attemptStore ?? {
      async record(identity) {
        if (attempts.has(identity.runId)) throw Error('duplicate run');
        attempts.set(identity.runId, structuredClone(identity));
        await onRecord?.();
      },
      async read(taskId, runId) {
        const identity = attempts.get(runId);
        return identity?.taskId === taskId ? identity : undefined;
      },
    },
    async authorizePresence(value) {
      assert.equal(value.taskId, taskId);
      await onPresence?.(value);
      return typeof presence === 'function' ? presence() : presence;
    },
  });
  return {adapter, sent, attempts, get closes() {return closes;}};
}

test('registered Notepad tool binds observed target and run identity to Host UIA readback receipt', async () => {
  const f = fixture();
  assert.equal(f.adapter.tool.descriptor.name, 'computer.notepad.replace_text');
  assert.equal(f.adapter.tool.descriptor.sideEffect, 'local_write');
  assert.equal(f.adapter.tool.descriptor.requiresPresence, false);
  const target = await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  assert.deepEqual(await f.adapter.checkObservationReady('task-1', deadline(), new AbortController().signal),
    {taskId: 'task-1', ...target});
  const result = await f.adapter.tool.execute(input, context());
  assert.deepEqual(result, {state: 'verified', hostEvidenceRef: 'host-evidence'});
  const execute = f.sent.find(frame => frame.kind === 'execute');
  assert.equal(execute.taskId, 'task-1');
  assert.equal(execute.runId, 'run-1');
  assert.equal(execute.authorizationRef, 'grant-1');
  assert.equal(execute.argumentsDigest, toolArgumentsDigest(input));
  assert.equal(execute.targetRef, targetRef);
  assert.equal(f.attempts.get('run-1').argumentsDigest, execute.argumentsDigest);
  assert.deepEqual(f.sent.slice(0, 5).map(frame => frame.kind),
    ['hello', 'bind', 'observe', 'target_ready', 'execute']);
});

test('trusted target preparation runs after the Host baseline handshake and before observe', async () => {
  let f;
  f = fixture({prepareObservation: async ({taskId, signal}) => {
    assert.equal(taskId, 'task-1');
    assert.equal(signal.aborted, false);
    assert.deepEqual(f.sent.map(frame => frame.kind), ['hello', 'bind']);
  }});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  assert.deepEqual(f.sent.slice(0, 3).map(frame => frame.kind), ['hello', 'bind', 'observe']);
  await f.adapter.releaseObservation('task-1');
});

test('fresh-target wait retains one original baseline session until native metadata observes the new target', async () => {
  let observations=0;
  const f=fixture({prepareObservation:async()=>({waitForFreshTarget:true}),
    onObserve:()=>++observations<3?'NOT_FOUND':undefined});
  await f.adapter.observe('task-1',deadline(),new AbortController().signal);
  assert.deepEqual(f.sent.map(frame=>frame.kind),['hello','bind','observe','observe','observe']);
  const frames=f.sent.filter(frame=>frame.kind==='observe');
  assert.equal(new Set(frames.map(frame=>frame.sessionId)).size,1);
  assert.equal(new Set(frames.map(frame=>frame.requestId)).size,3);
  assert.ok(frames.every(frame=>!('expectedText' in frame)&&!('replacementText' in frame)));
  await f.adapter.releaseObservation('task-1');assert.equal(f.closes,1);
});
test('fresh-target wait never retries ambiguous, stale or untrusted native targets',async t=>{
  for(const [errorCode,code]of[['TARGET_AMBIGUOUS','UNAUTHORIZED'],['TARGET_STALE','NOT_FOUND'],['UNAUTHORIZED','UNAUTHORIZED']]){
    await t.test(errorCode,async()=>{
      const f=fixture({prepareObservation:async()=>({waitForFreshTarget:true}),observationError:errorCode});
      await assert.rejects(f.adapter.observe('task-1',deadline(),new AbortController().signal),{code});
      assert.equal(f.sent.filter(frame=>frame.kind==='observe').length,1);assert.equal(f.closes,1);
      assert.equal(f.sent.some(frame=>frame.kind==='execute'),false);
    });
  }
});
test('fresh-target wait cancels or expires without reopening the baseline or writing',async t=>{
  for(const ending of ['cancel','close','deadline'])await t.test(ending,async()=>{
    const controller=new AbortController();let observed;
    const waiting=new Promise(resolve=>{observed=resolve;});
    const f=fixture({prepareObservation:async()=>({waitForFreshTarget:true}),onObserve:()=>{observed();return 'NOT_FOUND';}});
    const pending=f.adapter.observe('task-1',new Date(Date.now()+(ending==='deadline'?30:30000)).toISOString(),controller.signal);
    const rejected=assert.rejects(pending,{code:ending==='deadline'?'TIMEOUT':ending==='close'?'UNSUPPORTED_CAPABILITY':'CANCELLED'});
    await waiting;if(ending==='cancel')controller.abort();else if(ending==='close')await f.adapter.close();
    await rejected;assert.equal(f.sent.filter(frame=>frame.kind==='hello').length,1);assert.equal(f.closes,1);
    assert.equal(f.sent.some(frame=>frame.kind==='execute'),false);
  });
});
test('fresh-target wait rechecks policy after a native reply before accepting or retrying it',async()=>{
  let allowed=true;
  const f=fixture({presence:()=>allowed,prepareObservation:async()=>({waitForFreshTarget:true}),
    onObserve:()=>{allowed=false;}});
  await assert.rejects(f.adapter.observe('task-1',deadline(),new AbortController().signal),{code:'UNAUTHORIZED'});
  assert.equal(f.sent.filter(frame=>frame.kind==='observe').length,1);assert.equal(f.closes,1);
});
test('cancelling target preparation closes the baseline session without observing or executing', async () => {
  const controller = new AbortController();
  const f = fixture({prepareObservation: async ({signal}) => {
    controller.abort();
    assert.equal(signal.aborted, true);
    await new Promise(() => {});
  }});
  await assert.rejects(f.adapter.observe('task-1', deadline(), controller.signal), {code: 'CANCELLED'});
  assert.deepEqual(f.sent.map(frame => frame.kind), ['hello', 'bind']);
  assert.equal(f.closes, 1);
});

test('closing the adapter cancels target preparation and releases the baseline session', async () => {
  let entered;
  let signal;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = fixture({prepareObservation: async input => {
    signal = input.signal;
    entered();
    await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
  }});
  const observation = f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await waiting;
  await f.adapter.close();
  await assert.rejects(observation, {code: 'CANCELLED'});
  assert.deepEqual(f.sent.map(frame => frame.kind), ['hello', 'bind']);
  assert.equal(f.closes, 1);
});

test('stale Host target readiness releases the observation before authorization', async () => {
  const f = fixture({targetReady: false});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.checkObservationReady('task-1', deadline(), new AbortController().signal),
    {code: 'UNAUTHORIZED'});
  assert.equal(f.sent.filter(frame => frame.kind === 'target_ready').length, 1);
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
  assert.equal(f.closes, 1);
});

test('trusted presence callback is mandatory and denial prevents observation or execution', async () => {
  assert.throws(() => createWindowsHostNotepadAdapter({transport: {}, attempts: {}}),
    {code: 'UNSUPPORTED_CAPABILITY'});
  const f = fixture({presence: false});
  await assert.rejects(f.adapter.observe('task-1', deadline(), new AbortController().signal),
    {code: 'UNAUTHORIZED'});
  assert.equal(f.sent.length, 0);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'UNAUTHORIZED'});
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
});

test('Host-specific observation refusals map to public conservative codes', async () => {
  for (const [host, expected] of [['TARGET_AMBIGUOUS', 'UNAUTHORIZED'], ['TARGET_STALE', 'NOT_FOUND']]) {
    const f = fixture({observationError: host});
    await assert.rejects(f.adapter.observe('task-1', deadline(), new AbortController().signal),
      {code: expected});
    assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
  }
});

test('late abort after durable attempt is recorded never sends execute', async () => {
  const controller = new AbortController();
  const f = fixture({onRecord: () => controller.abort()});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, {...context(), signal: controller.signal}),
    {code: 'CANCELLED'});
  assert.equal(f.attempts.has('run-1'), true);
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
  assert.equal(f.sent.filter(frame => frame.kind === 'cancel').length, 0);
});

test('deadline after durable attempt is recorded never sends execute', async () => {
  let time = Date.now();
  const f = fixture({now: () => time, onRecord: () => { time += 6000; }});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  const expiredContext = {...context(), deadline: new Date(time + 5000).toISOString()};
  await assert.rejects(f.adapter.tool.execute(input, expiredContext), {code: 'TIMEOUT'});
  assert.equal(f.attempts.has('run-1'), true);
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
});

test('target expiring during trusted presence check releases session before attempt', async () => {
  let time = Date.now();
  const f = fixture({now: () => time,
    targetExpiresAt: () => new Date(time + 1000).toISOString(),
    onPresence: value => { if (value.targetRef) time += 1500; }});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'UNAUTHORIZED'});
  assert.equal(f.attempts.size, 0);
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
  assert.equal(f.closes, 1);
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await f.adapter.releaseObservation('task-1');
});

test('target expiring after durable attempt never reaches Host execute', async () => {
  let time = Date.now();
  const f = fixture({now: () => time,
    targetExpiresAt: () => new Date(time + 1000).toISOString(),
    onRecord: () => { time += 1500; }});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'UNAUTHORIZED'});
  assert.equal(f.attempts.has('run-1'), true);
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
  assert.equal(f.closes, 1);
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await f.adapter.releaseObservation('task-1');
});

test('missing observation and changed target never reach Host execute', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'UNAUTHORIZED'});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute({...input, targetRef: 'other_target_123456'}, context()), {code: 'UNAUTHORIZED'});
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
});

test('one adapter serializes Host sessions until the observed target is consumed', async () => {
  const f = fixture();
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.observe('task-2', deadline(), new AbortController().signal),
    {code: 'REVISION_CONFLICT'});
  await assert.rejects(f.adapter.recover('task-1', 'run-1'), {code: 'REVISION_CONFLICT'});
  await f.adapter.tool.execute(input, context());
  const recovered = await f.adapter.recover('task-1', 'run-1');
  assert.deepEqual(recovered, {state: 'unknown', reason: 'not_found'});
});

test('trusted host can release an unused observation after denial or cancellation', async () => {
  const f = fixture();
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await f.adapter.releaseObservation('task-1');
  assert.equal(f.closes, 1);
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await f.adapter.releaseObservation('task-1');
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 0);
});

test('Host nonverified result remains unknown and cannot confirm a write', async () => {
  const f = fixture({executeState: 'result_unknown'});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'RESULT_UNKNOWN'});
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 1);
});

test('Host verified with substituted target identity cannot confirm a write', async () => {
  const f = fixture({mismatchedResult: true});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'RESULT_UNKNOWN'});
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 1);
});

test('Runtime consumes one Policy grant and projects the correlated Host receipt as execution Evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pa-windows-gateway-'));
  let runtime;
  try {
    const attempts = createRuntimeWindowsHostAttemptStore(() => runtime);
    const taskId = 'windows-task-1';
    const f = fixture({taskId, attemptStore: attempts});
    let nextId = 0;
    runtime = new TaskRuntime(join(directory, 'runtime.sqlite'), {
      idFactory: () => nextId++ === 0 ? taskId : 'event-' + nextId,
      createToolGateway: policy => {
      const gateway = new ToolGateway({policy});
      gateway.register(f.adapter.tool);
      return gateway;
    }});
    const task = runtime.submitTask({goal: 'Synthetic Notepad text change',
      conversationId: 'synthetic', idempotencyKey: 'windows-task'});
    assert.equal(task.taskId, taskId);
    runtime.transitionTask(taskId, 'planning');
    runtime.transitionTask(taskId, 'running');
    runtime.policy.grant({authorizationRef: 'grant-1', taskId,
      toolName: f.adapter.tool.descriptor.name, scopes: ['computer:notepad:write'],
      expiresAt: deadline(), maxUses: 1, argumentsDigest: toolArgumentsDigest(input)});
    await f.adapter.observe(taskId, deadline(), new AbortController().signal);
    const request = {kind: 'request', protocolVersion: '1.0.0', requestId: 'invoke-1',
      taskId, deadline: deadline(), idempotencyKey: 'run-1', operation: 'tool.invoke',
      payload: {toolName: f.adapter.tool.descriptor.name, toolVersion: '1.0.0',
        arguments: input, scopeRef: 'grant-1'}};
    const first = await runtime.send(request, new AbortController().signal);
    assert.equal(first.outcome, 'ok');
    assert.equal(first.data.state, 'confirmed');
    assert.deepEqual(first.data.result, {state: 'verified', hostEvidenceRef: 'host-evidence'});
    assert.equal(runtime.policy.get('grant-1').usesRemaining, 0);
    assert.equal(runtime.readToolExecutions(taskId)[0].state, 'confirmed');
    assert.equal(runtime.readEvidence(taskId)[0].verification, 'conditional');
    assert.equal(runtime.readEvidence(taskId)[0].evidenceId, 'run-1');
    const replay = await runtime.send(request, new AbortController().signal);
    assert.equal(replay.outcome, 'ok');
    assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 1);
    await f.adapter.close();
  } finally {
    runtime?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('recovery polls original identity in a new session; not_found is unknown and never replays', async () => {
  const f = fixture({executeState: 'result_unknown'});
  await f.adapter.observe('task-1', deadline(), new AbortController().signal);
  await assert.rejects(f.adapter.tool.execute(input, context()), {code: 'RESULT_UNKNOWN'});
  const result = await f.adapter.recover('task-1', 'run-1');
  assert.deepEqual(result, {state: 'unknown', reason: 'not_found'});
  const execute = f.sent.find(frame => frame.kind === 'execute');
  const status = f.sent.findLast(frame => frame.kind === 'status');
  assert.notEqual(status.sessionId, execute.sessionId);
  for (const key of ['taskId', 'runId', 'toolName', 'toolVersion', 'argumentsDigest', 'targetRef']) {
    assert.equal(status[key], execute[key]);
  }
  assert.equal(f.sent.filter(frame => frame.kind === 'execute').length, 1);
});
