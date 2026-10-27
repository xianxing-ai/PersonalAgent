import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import test from 'node:test';
import {ProtocolError, ToolNotStartedError, validateContract, validateToolValue} from '@personal-agent/contracts';
import {createWindowsNativeDesktopControlHost, NATIVE_DESKTOP_VERSION} from '../dist/index.js';
import {createDesktopWindowsControlHost} from '../../../apps/desktop/electron/windows-control-host.js';
import {nativeDesktopResponseError} from '../dist/native-desktop-transport.js';

// Explicit synthetic transport fixture. source remains windows-native because that
// is this adapter's protocol identity; these tests prove no real Windows input.
const evidence = 'syntheticfixture';
const clock = Date.parse('2026-10-24T08:00:00.000Z');
const scope = 'computer:desktop:control';
const canonical = value => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const context = (input = {}, extra = {}) => ({taskId:'native-task', runId:randomUUID(), authorizationRef:'native-grant',
  scopes:[scope], argumentsDigest:digest(input), signal:new AbortController().signal,
  deadline:new Date(clock + 60000).toISOString(), ...extra});
const deferred = () => {let resolvePromise; const promise = new Promise(resolve => {resolvePromise = resolve;}); return {promise, resolve:resolvePromise};};
const tick = () => new Promise(resolve => setImmediate(resolve));
const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');

function fixture(t, options = {}) {
  let time = clock, ready = false, presence = true;
  const windowRef = randomUUID(), calls = [], records = [], lifecycle = [], deviceWrites = [];
  const snapshot = () => ({targetRef:randomUUID(), windowRef, observedAt:new Date(time).toISOString(),
    expiresAt:new Date(time + 30000).toISOString(), window:{title:'Synthetic fixture window', processName:'SyntheticFixture',
      bounds:{x:0, y:0, width:800, height:600}, dpi:96},
    controls:[{ref:randomUUID(), role:'Edit', name:'Synthetic editor', patterns:['value'], bounds:{left:10, top:10, width:200, height:30}}], truncated:false});
  const transport = {
    async start(ctx) {lifecycle.push('start'); await options.start?.(ctx); ready = true;},
    async request(method, params, ctx) {
      calls.push({method, params:structuredClone(params), taskId:ctx.taskId});
      if (options.request) return options.request(method, params, ctx, f);
      if (method === 'list_windows') return {windows:[{windowRef, title:'Synthetic fixture window', processName:'SyntheticFixture'}]};
      if (method === 'screenshot') return {targetRef:params.targetRef,mimeType:'image/png', data:png.toString('base64'), width:800, height:600};
      if (['action', 'activate'].includes(method)) {deviceWrites.push({method, params}); return {snapshot:snapshot(), verification:{state:'observed', kind:'syntheticfixture'}};}
      return snapshot();
    },
    async stop() {lifecycle.push('stop'); ready = false; await options.stop?.();},
    async close() {lifecycle.push('close'); ready = false;}, isReady:() => ready,
  };
  const host = createWindowsNativeDesktopControlHost({transport, now:() => time,
    attempts:{async record(identity, execution) {
      if (records.some(item => item.identity.runId === identity.runId)) throw new ProtocolError('REVISION_CONFLICT', 'Synthetic duplicate attempt');
      await options.record?.(identity, execution);
      records.push({identity:structuredClone(identity), arguments:structuredClone(execution.arguments)});
    }},
    authorizePresence:async input => options.authorizePresence ? options.authorizePresence(input) : presence,
    ...(options.artifactDirectory ? {artifactDirectory:options.artifactDirectory} : {}),
  });
  const f = {host, calls, records, lifecycle, deviceWrites, snapshot, windowRef, evidence,
    setTime(value) {time = value;}, revoke() {presence = false;},
    tool(name) {return host.tools.find(tool => tool.descriptor.name === `computer.desktop.${name}`);},
    async execute(name, input = {}, extra = {}) {return f.tool(name).execute(input, context(input, extra));},
    async observe(extra = {}) {return f.execute('observe', {}, extra);}};
  t.after(() => host.dispose());
  return f;
}

test('syntheticfixture: stable catalog validates contracts and never claims fixture identity is Windows acceptance', async t => {
  const f = fixture(t);
  const names = ['list_windows','observe','screenshot','activate','click','type','set_value','invoke','select','focus','scroll','move','drag','shortcut','press','wait'];
  const before = f.host.tools.map(tool => tool.descriptor.name);
  assert.deepEqual(before, names.map(name => `computer.desktop.${name}`));
  await f.host.start(context());
  assert.deepEqual(f.host.tools.map(tool => tool.descriptor.name), before);
  for (const {descriptor} of f.host.tools) {
    validateContract('tool', descriptor);
    assert.equal(descriptor.version, NATIVE_DESKTOP_VERSION);
    assert.deepEqual(descriptor.requiredScopes, [scope]);
    assert.equal(descriptor.requiresPresence, true);
    assert.equal(descriptor.idempotencySupport, false);
    assert.equal(descriptor.recoverySupport, false);
  }
  assert.equal(f.evidence, 'syntheticfixture');
  assert.equal(f.host.health().source, 'windows-native');
  const observed = await f.observe();
  validateToolValue(f.tool('observe').descriptor.outputSchema, observed);
  assert.equal(observed.source, 'windows-native');
  assert.equal(observed.goalVerified, false);
  for (const [name, args] of [['observe',{shell:'must reject'}], ['click',{targetRef:randomUUID(), loc:[1,2], command:'must reject'}]]) {
    await assert.rejects(f.execute(name, args), {code:'INVALID_ARGUMENT'});
  }
  assert.equal(f.calls.length, 1);
});

test('syntheticfixture: unavailable and stopped providers reject writes as not started', async t => {
  const absent = createWindowsNativeDesktopControlHost({now:() => clock,
    attempts:{record:async () => {}}, authorizePresence:async () => true});
  t.after(() => absent.dispose());
  await assert.rejects(absent.start(context()), {code:'UNSUPPORTED_CAPABILITY'});
  const f = fixture(t), input = {targetRef:randomUUID(), loc:[1,2]};
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError);
  assert.equal(f.calls.length, 0); assert.equal(f.host.health().state, 'disconnected');
});

test('syntheticfixture: task-bound once target consumption returns a fresh ref and a create-only exact attempt', async t => {
  const f = fixture(t); await f.host.start(context());
  const seen = await f.observe(), input = {targetRef:seen.snapshot.targetRef, loc:[30,40], text:'synthetic-private-text'};
  const execution = context(input), output = await f.tool('type').execute(input, execution);
  validateToolValue(f.tool('type').descriptor.outputSchema, output);
  assert.equal(output.state, 'action_observed'); assert.equal(output.goalVerified, false);
  assert.notEqual(output.snapshot.targetRef, seen.snapshot.targetRef);
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.records[0].identity, {taskId:execution.taskId, runId:execution.runId, toolName:'computer.desktop.type',
    toolVersion:NATIVE_DESKTOP_VERSION, authorizationRef:execution.authorizationRef, argumentsDigest:digest(input),
    targetRef:input.targetRef, observationDigest:digest(seen.snapshot)});
  assert.deepEqual(f.records[0].arguments, input);
  assert.doesNotMatch(JSON.stringify(output), /synthetic-private-text/);
  await assert.rejects(f.execute('type', input), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  assert.equal(f.deviceWrites.length, 1);
  await f.execute('click', {targetRef:output.snapshot.targetRef, loc:[2,3]});
  assert.equal(f.deviceWrites.length, 2);
});

test('syntheticfixture: foreign tasks, wrong windows, changed digests and expired refs cause zero new sends', async t => {
  const f = fixture(t); await f.host.start(context());
  const seen = await f.observe(), input = {targetRef:seen.snapshot.targetRef, loc:[1,2]};
  const before = f.calls.length;
  for (const [name, args, extra] of [
    ['click', input, {taskId:'foreign-task'}],
    ['activate', {windowRef:randomUUID()}, {}],
    ['click', input, {argumentsDigest:'a'.repeat(64)}],
    ['click', input, {authorizationRef:''}],
    ['click', input, {scopes:[]}],
  ]) await assert.rejects(f.execute(name, args, extra), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  assert.equal(f.calls.length, before); assert.equal(f.records.length, 0);
  f.setTime(clock + 30001);
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  assert.equal(f.calls.length, before); assert.equal(f.host.health().state, 'ready');
});

test('syntheticfixture: listed window handles are task-bound and activate returns an observation without inventing goal success', async t => {
  const f = fixture(t); await f.host.start(context());
  const listed = await f.execute('list_windows'), input = {windowRef:listed.windows[0].windowRef};
  await assert.rejects(f.execute('activate', input, {taskId:'foreign'}), error => error instanceof ToolNotStartedError);
  const output = await f.execute('activate', input);
  assert.equal(f.calls.at(-1).method, 'activate');
  assert.equal(output.goalVerified, false);
  assert.equal(f.records[0].identity.targetRef, input.windowRef);
});

test('syntheticfixture: revoking presence prevents every further read and write without transport sends', async t => {
  const f = fixture(t); await f.host.start(context()); const seen = await f.observe();
  f.revoke(); const before = f.calls.length;
  await assert.rejects(f.observe(), {code:'UNAUTHORIZED'});
  await assert.rejects(f.execute('click', {targetRef:seen.snapshot.targetRef, loc:[1,2]}), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  await assert.rejects(f.execute('list_windows'), {code:'UNAUTHORIZED'});
  assert.equal(f.calls.length, before); assert.equal(f.records.length, 0);
});

test('syntheticfixture: expired and cancelled calls make zero sends, including cancellation during durable recording', async t => {
  const controller = new AbortController();
  const f = fixture(t, {record:async () => {controller.abort();}}); await f.host.start(context());
  const seen = await f.observe(), before = f.calls.length, input = {targetRef:seen.snapshot.targetRef, loc:[1,2]};
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.observe({signal:cancelled.signal}), {code:'CANCELLED'});
  await assert.rejects(f.observe({deadline:new Date(clock).toISOString()}), {code:'TIMEOUT'});
  await assert.rejects(f.execute('click', input, {signal:controller.signal}), error => error instanceof ToolNotStartedError && error.code === 'CANCELLED');
  assert.equal(f.calls.length, before); assert.equal(f.deviceWrites.length, 0);
  assert.equal(f.host.health().state, 'ready');
});

test('syntheticfixture: durable record failure and broker not-started errors do not quarantine or dispatch input', async t => {
  let rejectRecord = true;
  const f = fixture(t, {record:async () => {if (rejectRecord) throw new ProtocolError('REVISION_CONFLICT', 'duplicate');},
    request:async (method, _input, _ctx, host) => {
      if (method === 'action') throw new ToolNotStartedError('UNAUTHORIZED', 'Synthetic stale target rejected before device input');
      return host.snapshot();
    }});
  await f.host.start(context()); const seen = await f.observe(), input = {targetRef:seen.snapshot.targetRef, loc:[1,2]};
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError && error.code === 'REVISION_CONFLICT');
  assert.equal(f.calls.length, 1); assert.equal(f.host.health().state, 'ready');
  rejectRecord = false;
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  assert.equal(f.deviceWrites.length, 0); assert.equal(f.host.health().state, 'ready');
  const fresh = await f.observe(); assert.notEqual(fresh.snapshot.targetRef, input.targetRef);
});

test('syntheticfixture: native preflight preserves the safe mapped cause and trusted zero-dispatch identity',async t=>{
  const refusal=nativeDesktopResponseError({code:'USER_TAKEOVER',dispatched:false,message:'synthetic-private-provider-message'});
  const f=fixture(t,{request:async(method,_input,_ctx,host)=>{
    if(method==='action')throw refusal;
    return host.snapshot();
  }});
  await f.host.start(context());const observed=await f.observe();
  await assert.rejects(f.execute('click',{targetRef:observed.snapshot.targetRef,loc:[1,2]}),error=>{
    assert.equal(error,refusal);assert(error instanceof ToolNotStartedError);assert.equal(error.code,'REVISION_CONFLICT');
    assert.match(error.message,/native=USER_TAKEOVER/);assert.match(error.message,/非本组件的输入变化/);
    assert.doesNotMatch(error.message,/synthetic-private-provider-message/);return true;
  });
  assert.equal(f.host.health().state,'ready');assert.equal(f.deviceWrites.length,0);
});

test('syntheticfixture: disconnection after a write request blocks new input and neither stop nor start clears unknown', async t => {
  const f = fixture(t, {request:async (method, _input, _ctx, host) => {
    if (method === 'action') throw Error('synthetic-private-transport-error');
    return host.snapshot();
  }});
  await f.host.start(context()); const seen = await f.observe();
  await assert.rejects(f.execute('click', {targetRef:seen.snapshot.targetRef, loc:[1,2]}), error => error.code === 'RESULT_UNKNOWN' && !error.message.includes('synthetic-private'));
  assert.equal(f.host.health().state, 'blocked'); const sends = f.calls.length;
  await f.host.stop(); assert.equal(f.host.health().state, 'blocked');
  await assert.rejects(f.host.start(context()), {code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(f.observe(), {code:'CANCELLED'});
  assert.equal(f.calls.length, sends); assert.ok(f.lifecycle.includes('stop'));
});

test('syntheticfixture: cancellation after device dispatch produces unknown rather than a safe retry', async t => {
  const controller = new AbortController();
  const f = fixture(t, {request:async (method, _input, _ctx, host) => {
    if (method === 'action') {controller.abort(); return {snapshot:host.snapshot()};}
    return host.snapshot();
  }});
  await f.host.start(context()); const seen = await f.observe();
  await assert.rejects(f.execute('click', {targetRef:seen.snapshot.targetRef, loc:[1,2]}, {signal:controller.signal}), {code:'RESULT_UNKNOWN'});
  assert.equal(f.host.health().state, 'blocked');
});

test('syntheticfixture: confirmed ordinary stop clears task refs and a new start requires a new observation', async t => {
  const f = fixture(t); await f.host.start(context()); const seen = await f.observe();
  await f.host.stop(); assert.equal(f.host.health().state, 'stopped');
  await f.host.start(context()); assert.equal(f.host.health().state, 'ready');
  const input = {targetRef:seen.snapshot.targetRef, loc:[1,2]};
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError && error.code === 'UNAUTHORIZED');
  const fresh = await f.observe(); assert.notEqual(fresh.snapshot.targetRef, input.targetRef);
  await f.execute('click', {...input, targetRef:fresh.snapshot.targetRef});
  assert.equal(f.deviceWrites.length, 1);
});

test('syntheticfixture: screenshots return artifact metadata only and keep encoded pixels and absolute paths local', async t => {
  const cache = resolve('.cache/native-desktop-tests'); await mkdir(cache, {recursive:true});
  const directory = await mkdtemp(join(cache, 'syntheticfixture-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const f = fixture(t, {artifactDirectory:directory}); await f.host.start(context()); const seen = await f.observe();
  const output = await f.execute('screenshot', {targetRef:seen.snapshot.targetRef});
  validateToolValue(f.tool('screenshot').descriptor.outputSchema, output);
  assert.equal(output.state, 'screenshot'); assert.equal(output.goalVerified, false);
  assert.deepEqual(Object.keys(output.artifact).sort(), ['artifactId','height','mimeType','modelVisionAvailable','sha256','width']);
  assert.equal(output.artifact.modelVisionAvailable, false);
  assert.equal(output.artifact.sha256, createHash('sha256').update(png).digest('hex'));
  assert.doesNotMatch(JSON.stringify(output), /base64|[A-Za-z]:\\|syntheticfixture-|"data"|"path"/);
  assert.deepEqual(await readdir(directory), [`${output.artifact.artifactId}.png`]);
  assert.deepEqual(await readFile(join(directory, `${output.artifact.artifactId}.png`)), png);
  assert.equal(f.records.length, 0);
});

test('syntheticfixture: expired observations and oversized invalid replies never create a target write capability', async t => {
  for (const malformed of [snapshot => ({...snapshot, expiresAt:new Date(clock).toISOString()}),
    snapshot => ({...snapshot, controls:Array(513).fill({})})]) {
    const f = fixture(t, {request:async (_method, _params, _ctx, host) => malformed(host.snapshot())});
    await f.host.start(context()); await assert.rejects(f.observe(), {code:'EXTERNAL_FAILURE'});
    assert.equal(f.records.length, 0); assert.equal(f.deviceWrites.length, 0);
  }
});

test('syntheticfixture: asynchronous presence authorization cannot admit two simultaneous transport operations', async t => {
  const admission = deferred(), requestDone = deferred();
  const f = fixture(t, {authorizePresence:async () => {await admission.promise; return true;},
    request:async (_method, _input, _ctx, host) => {await requestDone.promise; return host.snapshot();}});
  await f.host.start(context());
  const first = f.observe().then(value => ({value}), error => ({error}));
  const second = f.observe({runId:'second-run'}).then(value => ({value}), error => ({error}));
  admission.resolve(); await tick();
  const sendsWhileFirstPending = f.calls.length;
  requestDone.resolve(); const results = await Promise.all([first, second]);
  assert.equal(sendsWhileFirstPending, 1, 'presence await must not allow simultaneous operations');
  assert.equal(results.filter(item => item.value).length, 1);
  assert.equal(results.find(item => item.error)?.error.code, 'REVISION_CONFLICT');
});

test('syntheticfixture: disposing during asynchronous startup cannot replace disposed with unavailable or ready', async t => {
  const opening = deferred();
  const f = fixture(t, {start:async () => opening.promise});
  const starting = f.host.start(context()).then(value => ({value}), error => ({error}));
  await tick(); await f.host.dispose(); opening.resolve();
  assert.equal((await starting).error?.code, 'CANCELLED');
  assert.equal(f.host.health().state, 'disposed');
  await assert.rejects(f.host.start(context()), {code:'UNSUPPORTED_CAPABILITY'});
});

test('syntheticfixture: caller mutation during durable recording cannot replace already authorized arguments', async t => {
  const recorded = deferred(), release = deferred();
  const f = fixture(t, {record:async () => {recorded.resolve(); await release.promise;}});
  await f.host.start(context()); const seen = await f.observe();
  const input = {targetRef:seen.snapshot.targetRef, loc:[1,2], text:'authorized synthetic text'}, expected = structuredClone(input);
  const operation = f.execute('type', input).then(value => ({value}), error => ({error}));
  await recorded.promise;
  input.text = 'replaced after authorization'; input.loc[0] = 999;
  release.resolve(); const result = await operation;
  if (result.error) {
    assert.ok(result.error instanceof ToolNotStartedError, 'changed arguments may only be refused before device dispatch');
    assert.equal(f.calls.filter(call => call.method === 'action').length, 0);
  } else assert.deepEqual(f.calls.find(call => call.method === 'action').params, {...expected, action:'type'});
});

test('syntheticfixture: deadline expiry while recording and revocation during admission make no new device send', async t => {
  const f = fixture(t, {record:async () => {f.setTime(clock + 60001);}});
  await f.host.start(context()); const seen = await f.observe(), input = {targetRef:seen.snapshot.targetRef, loc:[1,2]};
  await assert.rejects(f.execute('click', input), error => error instanceof ToolNotStartedError && error.code === 'TIMEOUT');
  assert.equal(f.calls.length, 1); assert.equal(f.host.health().state, 'ready');
  const admission = deferred(); let allowed = true;
  const revoked = fixture(t, {authorizePresence:async () => {await admission.promise; return allowed;}});
  await revoked.host.start(context());
  const operation = revoked.observe().then(value => ({value}), error => ({error}));
  await tick(); allowed = false; admission.resolve();
  assert.equal((await operation).error?.code, 'UNAUTHORIZED'); assert.equal(revoked.calls.length, 0);
});

test('syntheticfixture: a persistent duplicate run refuses a fresh target before sending and does not burn that target', async t => {
  const f = fixture(t); await f.host.start(context()); const seen = await f.observe();
  const first = await f.execute('click', {targetRef:seen.snapshot.targetRef, loc:[1,2]}, {runId:'same-durable-run'});
  const input = {targetRef:first.snapshot.targetRef, loc:[2,3]}, sends = f.calls.length;
  await assert.rejects(f.execute('click', input, {runId:'same-durable-run'}), error => error instanceof ToolNotStartedError && error.code === 'REVISION_CONFLICT');
  assert.equal(f.calls.length, sends); assert.equal(f.records.length, 1);
  await f.execute('click', input, {runId:'different-durable-run'});
  assert.equal(f.records.length, 2); assert.equal(f.deviceWrites.length, 2);
});

test('syntheticfixture: wait uses no transport input and cancellation releases its ownership', async t => {
  const controller = new AbortController(), f = fixture(t); await f.host.start(context());
  const waiting = f.execute('wait', {milliseconds:5000}, {signal:controller.signal}).then(value => ({value}), error => ({error}));
  await tick(); assert.deepEqual(f.host.activeTasks(), ['native-task']);
  controller.abort(); assert.equal((await waiting).error?.code, 'CANCELLED');
  assert.deepEqual(f.host.activeTasks(), []); assert.equal(f.calls.length, 0);
  assert.equal(f.host.health().state, 'ready'); await f.observe(); assert.equal(f.calls.length, 1);
});

test('syntheticfixture: an unconfirmed native stop seals the provider and start cannot clear it', async t => {
  const f = fixture(t, {stop:async () => {throw new ProtocolError('EXTERNAL_FAILURE', 'Synthetic stop acknowledgement lost');}});
  await f.host.start(context()); await f.observe();
  await assert.rejects(f.host.stop());
  assert.equal(f.host.health().state, 'blocked');
  const sends = f.calls.length;
  await assert.rejects(f.host.start(context()), {code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(f.observe());
  assert.equal(f.calls.length, sends);
});

test('syntheticfixture: Desktop wrapper publishes a failed stop as blocked and revokes presence and exports', async t => {
  let blocked = false, starts = 0;
  const provider = {tools:[{descriptor:{name:'computer.desktop.observe', version:'1.0.0', outputSchema:{type:'object'}}}],
    async start() {starts++;}, async stop() {throw new ProtocolError('EXTERNAL_FAILURE', 'Synthetic wrapper stop failure');},
    block() {blocked = true;}, health:() => ({state:blocked ? 'blocked' : 'ready', source:'syntheticfixture'}), async dispose() {}};
  const host = createDesktopWindowsControlHost({createControlHost:() => provider,
    isFullAccess:() => true, allowObservationExport:true, now:() => clock});
  t.after(() => host.close());
  host.bind({runtime:{listTasks:() => ({items:[]}), getTask:() => ({state:'running'})}});
  await host.start(context()); await host.preparePresence(context());
  assert.equal(host.hasPresence('native-task'), true);
  const policy = host.competitionToolExports.find(item => item.toolName === 'computer.desktop.observe');
  assert.equal(policy.accepts({taskId:'native-task'}), true);
  await assert.rejects(host.stop());
  const snapshot = host.snapshot();
  assert.equal(snapshot.state, 'blocked'); assert.equal(snapshot.available, false);
  assert.equal(snapshot.providerAvailable, false); assert.equal(snapshot.waitingConfirmation, false);
  assert.equal(host.hasPresence('native-task'), false); assert.deepEqual(host.tools, []);
  assert.equal(policy.accepts({taskId:'native-task'}), false);
  await host.start(context()); assert.equal(starts, 1, 'prepare cannot restart an unconfirmed stop');
});

async function screenshotFixture(t,options={}) {
  const base=resolve('.cache/native-desktop-reader-tests');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'syntheticfixture-'));
  const f=fixture(t,{...options,artifactDirectory:directory});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await f.host.start(context());const observed=await f.observe();
  const arguments_={targetRef:observed.snapshot.targetRef},scope_=context(arguments_);
  const result=await f.tool('screenshot').execute(arguments_,scope_);
  return {...f,directory,observed,scope_,result,file:join(directory,result.artifact.artifactId+'.png'),
    readInput:{taskId:scope_.taskId,artifactId:result.artifact.artifactId,sha256:result.artifact.sha256,
      signal:new AbortController().signal,deadline:scope_.deadline}};
}

test('syntheticfixture: trusted artifact reader binds original screenshot run and target without publishing paths or pixels',async t=>{
  const f=await screenshotFixture(t),sends=f.calls.length;
  const metadata=await f.host.readScreenshotArtifactMetadata(f.readInput);
  assert.equal(metadata.taskId,f.scope_.taskId);assert.equal(metadata.runId,f.scope_.runId);
  assert.equal(metadata.authorizationRef,f.scope_.authorizationRef);assert.equal(metadata.argumentsDigest,f.scope_.argumentsDigest);
  assert.equal(metadata.toolName,'computer.desktop.screenshot');assert.equal(metadata.toolVersion,NATIVE_DESKTOP_VERSION);
  assert.equal(metadata.targetRef,f.observed.snapshot.targetRef);assert.equal(metadata.windowRef,f.observed.snapshot.windowRef);
  assert.equal(metadata.byteLength,png.length);assert.equal(metadata.deadline,f.scope_.deadline);
  assert.deepEqual(metadata.windowRect,f.observed.snapshot.window.bounds);
  f.observed.snapshot.window.bounds.x=999;assert.equal((await f.host.readScreenshotArtifactMetadata(f.readInput)).windowRect.x,0,
    'reader uses the copied capture-time physical rect, not a mutable exported snapshot');
  assert.equal(metadata.expiresAt,f.observed.snapshot.expiresAt);assert.equal(metadata.mimeType,'image/png');
  assert.equal(metadata.bytes,undefined);assert.equal(metadata.file,undefined);assert.equal(metadata.path,undefined);
  const read=await f.host.readScreenshotArtifact(f.readInput);assert.deepEqual(read.bytes,png);
  assert.equal(read.sha256,f.result.artifact.sha256);assert.equal(f.calls.length,sends,'the reader never captures or observes again');
  read.bytes.fill(0);assert.deepEqual((await f.host.readScreenshotArtifact(f.readInput)).bytes,png,'returned buffers do not mutate stored content');
  const moved=f.file+'.held';await rename(f.file,moved);
  assert.deepEqual(await f.host.readScreenshotArtifactMetadata(f.readInput),metadata,'metadata reads do not touch image pixels or files');
  await assert.rejects(f.host.readScreenshotArtifact(f.readInput),error=>error.code==='EXTERNAL_FAILURE'&&!error.message.includes(f.directory));
  await rename(moved,f.file);
});

test('syntheticfixture: cross-task, wrong SHA, arbitrary path and extended original deadline cannot read screenshot bytes',async t=>{
  const f=await screenshotFixture(t);
  for(const input of [{...f.readInput,taskId:'foreign-task'},{...f.readInput,sha256:'a'.repeat(64)},
    {...f.readInput,artifactId:randomUUID()},{...f.readInput,deadline:new Date(clock+60001).toISOString()}]) {
    await assert.rejects(f.host.readScreenshotArtifactMetadata(input),{code:'UNAUTHORIZED'});
    await assert.rejects(f.host.readScreenshotArtifact(input),{code:'UNAUTHORIZED'});
  }
  await assert.rejects(f.host.readScreenshotArtifact({...f.readInput,path:f.file}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.host.readScreenshotArtifact({...f.readInput,sha256:'not-a-sha'}),{code:'INVALID_ARGUMENT'});
});

test('syntheticfixture: changed screenshot bytes or size fail hash-bound bounded reads',async t=>{
  const f=await screenshotFixture(t),changed=Buffer.from(png);changed[changed.length-1]^=1;
  await writeFile(f.file,changed);await assert.rejects(f.host.readScreenshotArtifact(f.readInput),{code:'REVISION_CONFLICT'});
  await writeFile(f.file,Buffer.concat([png,Buffer.from([0])]));
  await assert.rejects(f.host.readScreenshotArtifact(f.readInput),{code:'REVISION_CONFLICT'});
});

test('syntheticfixture: old target replacement, expiry, stop, block and dispose invalidate artifact scope',async t=>{
  for(const mode of ['observe','expiry','stop','block','dispose']) {
    const f=await screenshotFixture(t);
    if(mode==='observe')await f.observe();
    if(mode==='expiry')f.setTime(clock+30001);
    if(mode==='stop'){await f.host.stop();await f.host.start(context());}
    if(mode==='block')f.host.block();
    if(mode==='dispose')await f.host.dispose();
    await assert.rejects(f.host.readScreenshotArtifactMetadata(f.readInput),{code:'UNAUTHORIZED'});
    await assert.rejects(f.host.readScreenshotArtifact(f.readInput),{code:'UNAUTHORIZED'});
  }
});

test('syntheticfixture: caller cancellation and presence revocation before/after artifact I/O never release bytes',async t=>{
  const entered=deferred(),release=deferred();let gate=false,readChecks=0,revokeAfterRead=false;
  const f=await screenshotFixture(t,{authorizePresence:async()=>{
    if(gate){entered.resolve();await release.promise;}
    if(revokeAfterRead)return ++readChecks===1;
    return true;
  }});
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(f.host.readScreenshotArtifact({...f.readInput,signal:cancelled.signal}),{code:'CANCELLED'});
  const during=new AbortController();gate=true;
  const pending=f.host.readScreenshotArtifact({...f.readInput,signal:during.signal});
  const rejected=assert.rejects(pending,{code:'CANCELLED'});await entered.promise;during.abort();release.resolve();await rejected;
  gate=false;revokeAfterRead=true;
  await assert.rejects(f.host.readScreenshotArtifact(f.readInput),{code:'UNAUTHORIZED'});assert.equal(readChecks,2,'presence rechecked after file I/O');
});

test('syntheticfixture: Desktop trusted reader forwards only while original task presence is current',async t=>{
  const artifactId=randomUUID();let metadataReads=0,pixelReads=0;
  const provider={tools:[{descriptor:{name:'computer.desktop.observe',version:NATIVE_DESKTOP_VERSION,outputSchema:{type:'object'}}}],
    start:async()=>{},dispose:async()=>{},health:()=>({state:'ready'}),
    async readScreenshotArtifactMetadata(input){metadataReads++;return {artifactId:input.artifactId,taskId:input.taskId,runId:'original-shot'};},
    async readScreenshotArtifact(input){pixelReads++;return {artifactId:input.artifactId,taskId:input.taskId,bytes:png};}};
  const wrapper=createDesktopWindowsControlHost({createControlHost:()=>provider,isFullAccess:()=>true,now:()=>clock});
  t.after(()=>wrapper.close());wrapper.bind({runtime:{listTasks:()=>({items:[]}),getTask:()=>({state:'running'})}});
  await wrapper.start(context());await wrapper.preparePresence(context());
  const input={taskId:'native-task',artifactId,signal:new AbortController().signal,deadline:context().deadline};
  assert.equal((await wrapper.readScreenshotArtifactMetadata(input)).runId,'original-shot');
  assert.deepEqual((await wrapper.readScreenshotArtifact(input)).bytes,png);
  wrapper.invalidatePresence(input.taskId);
  await assert.rejects(wrapper.readScreenshotArtifactMetadata(input),{code:'UNAUTHORIZED'});
  await assert.rejects(wrapper.readScreenshotArtifact(input),{code:'UNAUTHORIZED'});
  assert.equal(metadataReads,1);assert.equal(pixelReads,1);
});
