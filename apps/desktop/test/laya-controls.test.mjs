import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {mountLayaControls} from '../src/app/laya-controls.js';
import {createLocalLayaHost} from '../electron/laya-local-host.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};

async function fixture(t, {reply = async (_action, value) => value, readback,
  killExits = true, health} = {}) {
  const previous = globalThis.document;
  t.after(() => {if (previous === undefined) delete globalThis.document; else globalThis.document = previous;});
  const nodes = Object.fromEntries(['start', 'stop', 'status'].map(name => [name, {disabled: false, textContent: ''}]));
  const element = {hidden: false, querySelector: selector => nodes[selector.match(/"([^"]+)"/)[1]]};
  globalThis.document = {createElement: () => element};
  const cache = new URL('../../../.cache/laya-controls-tests/', import.meta.url);
  await mkdir(cache, {recursive: true});
  const directory = await mkdtemp(new URL('case-', cache));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const model = path.join(directory, 'model'), script = path.join(directory, 'batch-server.py');
  await mkdir(model);
  await writeFile(path.join(model, 'model.safetensors'), 'synthetic weights');
  await writeFile(path.join(model, 'config.json'), '{"synthetic":true}');
  await writeFile(script, '# synthetic server');
  let controls, child, clock = Date.now(), launches = 0;
  const calls = [];
  const host = createLocalLayaHost({projectRoot: directory,
    discover: () => ({model, script, python: 'synthetic-python'}), freeMemory: () => 8 * 1024 ** 3,
    launch() {
      launches++; child = new EventEmitter();
      const owned = child;
      owned.kill = () => {if (killExits) queueMicrotask(() => owned.emit('exit', 0)); return true;};
      return owned;
    },
    request: async () => {
      await health?.();
      return {ok: true, json: async () => ({status: 'ok', model: 'multilingual', capabilities: ['multi_state'], maxStates: 4})};
    },
    createService: () => ({classify: async () => []}), now: () => clock,
    sleep: async () => {clock += 50; await new Promise(resolve => setImmediate(resolve));},
    onUpdate: () => controls?.render(host.snapshot()),
  });
  controls = mountLayaControls({querySelector: () => ({before() {}})}, async action => {
    calls.push(action);
    if (action === 'snapshot') return readback ? readback(host) : {laya: host.snapshot()};
    const value = await host[action.slice(5)]();
    return reply(action, value);
  });
  controls.render(host.snapshot());
  t.after(async () => {child?.emit('exit', 0); await host.stop();});
  return {host, controls, nodes, calls, start: () => nodes.start.onclick(), stop: () => nodes.stop.onclick(),
    exit: () => child.emit('exit', 0), launches: () => launches,
    changeArtifact: () => writeFile(path.join(model, 'config.json'), '{"synthetic":"changed after loading"}')};
}

test('a delayed start receipt cannot undo a newer completed stop', async t => {
  const ready = deferred(), late = deferred();
  const f = await fixture(t, {reply: async (action, value) => {
    if (action === 'laya.start') {ready.resolve(); await late.promise;} return value;
  }});
  const starting = f.start(); await ready.promise;
  assert.equal(f.host.snapshot().state, 'ready');
  assert.equal(f.nodes.stop.disabled, false);
  await f.stop();
  assert.equal(f.host.snapshot().state, 'stopped');
  late.resolve(); await starting;
  assert.equal(f.nodes.status.textContent, '本地模型已停止');
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(f.nodes.stop.disabled, true);
  assert.equal(f.launches(), 1);
  assert.deepEqual(f.calls, ['laya.start', 'laya.stop', 'snapshot']);
});

test('explicit stop can cancel the actual host while its initial health check is pending', async t => {
  const checking = deferred(), release = deferred();
  const f = await fixture(t, {health: async () => {checking.resolve(); await release.promise;}});
  const starting = f.start(); await checking.promise;
  assert.equal(f.host.snapshot().state, 'starting');
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  await f.stop();
  assert.equal(f.host.snapshot().state, 'stopped');
  release.resolve(); await starting;
  assert.equal(f.host.snapshot().state, 'stopped');
  assert.equal(f.nodes.status.textContent, '本地模型已停止');
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(f.nodes.stop.disabled, true);
  assert.equal(f.launches(), 1);
  assert.deepEqual(f.calls, ['laya.start', 'laya.stop', 'snapshot']);
});

test('an old start rejection and finally cannot unlock a more recent pending operation', async t => {
  const oldReady = deferred(), oldReply = deferred(), newerReady = deferred(), newerReply = deferred();
  let starts = 0;
  const f = await fixture(t, {reply: async (action, value) => {
    if (action === 'laya.start') {
      if (++starts === 1) {oldReady.resolve(); await oldReply.promise;}
      else {newerReady.resolve(); await newerReply.promise;}
    }
    return value;
  }});
  const original = f.start(); await oldReady.promise;
  await f.stop();
  const newer = f.start(); await newerReady.promise;
  oldReply.reject(new Error('private-old-start-canary')); await original;
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  assert.doesNotMatch(f.nodes.status.textContent, /private|未获确认/);
  newerReply.resolve(); await newer;
  assert.equal(f.host.snapshot().state, 'ready');
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.launches(), 2, 'only the two explicit starts launch children');
});

test('current host readback wins when the process exits before the start reply arrives', async t => {
  const ready = deferred(), late = deferred();
  const f = await fixture(t, {reply: async (_action, value) => {ready.resolve(); await late.promise; return value;}});
  const starting = f.start(); await ready.promise;
  f.exit();
  assert.equal(f.host.snapshot().state, 'error');
  late.resolve(); await starting;
  assert.match(f.nodes.status.textContent, /进程已退出/);
  assert.doesNotMatch(f.nodes.status.textContent, /已连接/);
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(f.launches(), 1);
});

test('a host publication during readback prevents its older ready snapshot from replacing the error', async t => {
  const reading = deferred(), release = deferred();
  const f = await fixture(t, {readback: async host => {
    const captured = {laya: host.snapshot()}; reading.resolve(); await release.promise; return captured;
  }});
  const starting = f.start(); await reading.promise;
  f.exit(); release.resolve(); await starting;
  assert.equal(f.host.snapshot().state, 'error');
  assert.match(f.nodes.status.textContent, /进程已退出/);
  assert.equal(f.nodes.start.disabled, false);
});

test('a lost operation receipt uses current readback without claiming that the operation did not take effect', async t => {
  const f = await fixture(t, {reply: async () => {throw new Error('private-lost-receipt-canary');}});
  await f.start();
  assert.equal(f.host.snapshot().state, 'ready');
  assert.match(f.nodes.status.textContent, /回执未获确认.*当前已读回状态.*已连接/);
  assert.doesNotMatch(f.nodes.status.textContent, /private|操作未完成/);
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  assert.equal(f.launches(), 1);
});

test('artifact identity changes require explicit stop before another start', async t => {
  const f = await fixture(t);
  await f.start();
  await f.changeArtifact();
  f.controls.render(f.host.snapshot());
  assert.equal(f.host.snapshot().state, 'identity_changed');
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  await f.start();
  assert.equal(f.launches(), 1, 'changed artifacts do not trigger a restart');
  await f.stop();
  assert.equal(f.host.snapshot().state, 'stopped');
  assert.equal(f.nodes.start.disabled, false);
  await f.start();
  assert.equal(f.host.snapshot().state, 'ready');
  assert.equal(f.launches(), 2, 'restart occurs only after the explicit stop and start');
  assert.deepEqual(f.calls, ['laya.start', 'snapshot', 'laya.stop', 'snapshot', 'laya.start', 'snapshot']);
});

test('lost receipt feedback follows the current host publication after its process exits', async t => {
  const f = await fixture(t, {reply: async () => {throw new Error('private-lost-receipt-canary');}});
  await f.start();
  assert.equal(f.host.snapshot().state, 'ready');
  assert.match(f.nodes.status.textContent, /回执未获确认.*当前已读回状态.*已连接/);
  f.exit();
  assert.equal(f.host.snapshot().state, 'error');
  assert.match(f.nodes.status.textContent, /回执未获确认.*当前已读回状态.*进程已退出/);
  assert.doesNotMatch(f.nodes.status.textContent, /已连接|private/);
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(f.nodes.stop.disabled, true);
  assert.equal(f.launches(), 1);
});

test('unconfirmed readback blocks a new start and allows explicit stop and another readback', async t => {
  let reads = 0;
  const f = await fixture(t, {readback: async host => {
    if (++reads === 1) throw new Error('private-readback-canary');
    return {laya: host.snapshot()};
  }});
  await f.start();
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  assert.match(f.nodes.status.textContent, /当前状态未获确认/);
  await f.start();
  assert.equal(f.launches(), 1);
  await f.stop();
  assert.equal(f.host.snapshot().state, 'stopped');
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(reads, 2);
  assert.doesNotMatch(f.nodes.status.textContent, /private/);
});

test('disabled handlers prevent duplicate actions while stop can supersede a pending start', async t => {
  const ready = deferred(), release = deferred(), stopping = deferred(), stopReply = deferred();
  const f = await fixture(t, {reply: async (action, value) => {
    if (action === 'laya.start') {ready.resolve(); await release.promise;}
    else {stopping.resolve(); await stopReply.promise;}
    return value;
  }});
  const start = f.start(); await ready.promise;
  await f.start();
  const stop = f.stop(); await stopping.promise;
  await f.stop(); await f.start();
  release.resolve(); await start;
  assert.equal(f.nodes.start.disabled, true, 'old finally cannot unlock the pending stop');
  assert.equal(f.nodes.stop.disabled, true);
  stopReply.resolve(); await stop;
  assert.deepEqual(f.calls, ['laya.start', 'laya.stop', 'snapshot']);
  assert.equal(f.nodes.start.disabled, false);
});

test('an actual host unknown exit retains the stop_unconfirmed start gate', async t => {
  const f = await fixture(t, {killExits: false});
  await f.start(); await f.stop();
  assert.equal(f.host.snapshot().state, 'stop_unconfirmed');
  assert.equal(f.nodes.start.disabled, true);
  assert.equal(f.nodes.stop.disabled, false);
  assert.match(f.nodes.status.textContent, /退出尚未确认/);
  await f.start();
  assert.equal(f.launches(), 1);
});
