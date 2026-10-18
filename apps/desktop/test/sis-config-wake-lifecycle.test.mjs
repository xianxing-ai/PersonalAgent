import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import {createDesktopSisConfigHost} from '../electron/huawei-sis-config.js';

const main = readFileSync(process.env.SIS_CONFIG_MAIN_SOURCE || new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let route;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "name === 'voice.configure' || name === 'voice.login'") route = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(route);
const stopWake = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'stopWakeVoice').getText(ast);
const initial = {region: 'cn-north-4', projectId: 'synthetic-project', iamToken: 'synthetic-never-real'};

// Original main branch plus real configuration filesystem, explicit Fake lifecycle ports.
function fixture(t, {disableUnknown = false, disposeUnknown = false} = {}) {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'pa-sis-config-test-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));
  let secure = true, disposed = false, phase = 'listening';
  const calls = [];
  const config = createDesktopSisConfigHost({userData, env: {}, safeStorage: {
    isEncryptionAvailable: () => secure, encryptString: value => Buffer.from(value), decryptString: value => value.toString(),
  }});
  config.configure(initial);
  const configFile = path.join(userData, 'huawei-sis-config.json');
  const oldBytes = readFileSync(configFile);
  const wake = {hasActive: () => phase === 'listening' || phase === 'unknown',
    async disable() {calls.push('disable');phase = disableUnknown ? 'unknown' : 'disabled';
      if (disableUnknown) throw Error('Synthetic unknown disable');},
    async dispose() {calls.push('dispose');disposed = true;phase = disposeUnknown ? 'unknown' : 'disposed';
      if (disposeUnknown) throw Error('Synthetic unknown dispose');},
    async enable() {if (disposed || phase === 'unknown') throw Error('Cannot reopen');phase = 'listening';return {phase};},
    snapshot: () => ({phase}),
  };
  const panel = {},admin={};
  const context = vm.createContext({Object, Promise, Error, panel, admin, competitionMode: true,
    voiceConfigurationPending: false, wakeQuitUnknown: false, wakeVoice: wake,
    voiceInput: {hasActive: () => false, async dispose() {calls.push('voice-dispose');}},
    liveVoice: undefined, sisPlaybackHost: {}, voicePcmSource: {}, voiceInitializationFailure: null,
    sisConfigHost: {snapshot: config.snapshot, configure(value) {calls.push('save');return config.configure(value);}},
    acquireHuaweiSisToken: async payload => payload,
    async initializeSisVoice() {calls.push('initialize');context.voiceInput = {hasActive: () => false};}, publish() {},
  });
  vm.runInContext(stopWake, context);
  const action = vm.runInContext(`(async function(sender,name,payload){${route}})`, context);
  return {context, calls, wake, config, oldBytes, configFile, userData,
    setSecure(value) {secure = value;}, run: (payload, name = 'voice.configure', sender = admin) => action(sender, name, payload)};
}

for(const action of ['voice.configure','voice.login'])test(`${action} accepts only original Competition admin sender and rejects panel/other renderers`,async t=>{
  const f=fixture(t);
  await assert.rejects(f.run(initial,action,f.context.panel),/可信设置页/);
  await assert.rejects(f.run(initial,action,{}),/可信设置页/);
  assert.deepEqual(f.calls,[]);assert.deepEqual(readFileSync(f.configFile),f.oldBytes);
  f.context.competitionMode=false;await assert.rejects(f.run(initial,action),/可信设置页/);
  f.context.competitionMode=true;assert.equal((await f.run(initial,action)).connected,true);
});

for (const [name, invalid] of [['invalid fields', {...initial, region: 'invalid'}],
  ['expired token', {...initial, tokenExpiresAt: '2000-01-01T00:00:00.000Z'}]]) {
  test(`a rejected ${name} save leaves old Wake disabled and explicitly re-enableable`, async t => {
    const f = fixture(t);
    await assert.rejects(f.run(invalid));
    assert.deepEqual(readFileSync(f.configFile), f.oldBytes);
    assert.equal(f.config.snapshot().configured, true);
    assert.equal(f.context.wakeVoice, f.wake);
    assert.equal(f.wake.snapshot().phase, 'disabled');
    assert.equal((await f.wake.enable()).phase, 'listening');
    assert.deepEqual(f.calls, ['disable', 'save']);
    assert.equal(f.context.voiceConfigurationPending, false);
  });
}

for (const mode of ['secure storage', 'file write']) test(`a ${mode} failure preserves the old configured host`, async t => {
  const f = fixture(t);
  if (mode === 'secure storage') f.setSecure(false);
  else mkdirSync(`${f.configFile}.tmp-${process.pid}`);
  await assert.rejects(f.run({...initial, projectId: 'new-synthetic-project'}));
  assert.deepEqual(readFileSync(f.configFile), f.oldBytes);
  assert.equal(f.context.wakeVoice, f.wake);
  assert.equal(f.wake.snapshot().phase, 'disabled');
  assert.equal((await f.wake.enable()).phase, 'listening');
  assert.deepEqual(f.calls, ['disable', 'save']);
});

test('successful save keeps confirmed disable, permanent replacement and initialization order', async t => {
  const f = fixture(t);
  const result = await f.run({...initial, projectId: 'new-synthetic-project'});
  assert.deepEqual(f.calls, ['disable', 'save', 'dispose', 'voice-dispose', 'initialize']);
  assert.equal(result.connected, true);
  assert.equal(f.config.snapshot().projectId, 'new-synthetic-project');
  assert.equal(f.context.voiceConfigurationPending, false);
});

test('initial unknown release refuses save and permanent disposal', async t => {
  const f = fixture(t, {disableUnknown: true});
  await assert.rejects(f.run(initial));
  assert.deepEqual(f.calls, ['disable']);
  assert.deepEqual(readFileSync(f.configFile), f.oldBytes);
  await assert.rejects(f.wake.enable());
  assert.equal(f.context.voiceConfigurationPending, false);
});

test('a capture appearing during IAM acquisition is rejected before save', async t => {
  const f = fixture(t);
  f.context.acquireHuaweiSisToken = async payload => {
    f.context.voiceInput.hasActive = () => true;return payload;
  };
  await assert.rejects(f.run(initial, 'voice.login'), /当前语音会话/);
  assert.deepEqual(f.calls, ['disable']);
  assert.equal(f.context.wakeVoice, f.wake);
  assert.deepEqual(readFileSync(f.configFile), f.oldBytes);
});

test('unknown permanent disposal after saving keeps the saved side effect and blocks initialization', async t => {
  const f = fixture(t, {disposeUnknown: true});
  await assert.rejects(f.run({...initial, projectId: 'new-synthetic-project'}));
  assert.deepEqual(f.calls, ['disable', 'save', 'dispose']);
  assert.equal(f.config.snapshot().projectId, 'new-synthetic-project');
  assert.equal(f.context.wakeVoice, f.wake);
  assert.equal(f.wake.hasActive(), true);
  await assert.rejects(f.wake.enable());
  assert.equal(f.context.voiceConfigurationPending, false);
});
