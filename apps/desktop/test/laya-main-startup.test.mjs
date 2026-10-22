import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createLocalLayaHost} from '../electron/laya-local-host.js';
import {createDeferredRuntimeStartup} from '../electron/runtime-startup.js';
import {mountLayaControls} from '../src/app/laya-controls.js';
import {readDeveloperSettingsDiagnostic} from '../shared/developer-settings-diagnostics.js';
import {createRuntimeApplication,AuthorizationQuestions} from '@personal-agent/runtime/application';
import {EventCursor} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {register} from '../electron/runtime.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';

const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = main.indexOf('async function initializeRuntime() {');
const end = main.indexOf('\nasync function confirmDeveloperExport(', start);
assert.ok(start >= 0 && end > start, 'actual Main startup must be present');
// Replace only the module-loading boundary with explicit Synthetic public ports.
// The original complete initializer still executes, including its cloud refusal.
const initialize = main.slice(start, end).replaceAll('await import(', 'await load(');
const localInitialize = main.slice(main.indexOf('async function initializeLocalLaya() {'), start)
  .replaceAll('await import(', 'await load(');
const authorizationInitialize = main.slice(main.indexOf('function initializeAuthorizationHosts('),main.indexOf('async function initializeLocalLaya() {'))
  .replaceAll('await import(', 'await load(');
const authorizationPort = main.slice(main.indexOf('const authorizationQuestionPort='),main.indexOf('\nlet syntheticRepairHost;'));
const startupStart = main.indexOf('  try {\n    conversations = new Conversations(dataPaths.conversations);');
const startupEnd = main.indexOf('\n\n  const area = screen.getPrimaryDisplay().workArea;', startupStart);
assert.ok(startupStart>=0 && startupEnd>startupStart, 'actual application startup must be present');
const startup = main.slice(startupStart, startupEnd);
const route = main.match(/  if \(name === 'laya.start' \|\| name === 'laya.stop'\) \{[\s\S]*?\n  \}/)?.[0];
const mailRoute = main.match(/  if \(\['mail.configure'[\s\S]*?\n  \}/)?.[0];
const handler = main.match(/ipcMain\.handle\('desktop:action', (async \(\.\.\.args\) => \{[\s\S]*?\n  \})\);/)?.[1];
const renderer = readFileSync(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
const invokeSource = renderer.match(/async function invoke\(action,payload\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(route && mailRoute && handler && invokeSource, 'actual Laya, mail, IPC and renderer callbacks must be present');

async function fixture(t, {memory = 8 * 1024 ** 3} = {}) {
  const base = path.resolve('.cache/laya-main-tests'); mkdirSync(base, {recursive:true});
  const directory = realpathSync(mkdtempSync(path.join(base, 'case-')));
  const model = path.join(directory, 'model'), script = path.join(directory, 'batch-server.py');
  mkdirSync(model); writeFileSync(path.join(model, 'model.safetensors'), 'Synthetic weights');
  writeFileSync(path.join(model, 'config.json'), '{"synthetic":true}'); writeFileSync(script, '# Synthetic server');
  let controls, child, launches = 0, clock = Date.now(), runtimeCreations = 0, localControlCreations = 0, currentMemory = memory;
  const nodes = Object.fromEntries(['start', 'stop', 'status'].map(name => [name, {disabled:false, textContent:''}]));
  const element = {querySelector:selector => nodes[selector.match(/"([^"]+)"/)[1]]};
  const previousDocument = globalThis.document;
  globalThis.document = {createElement:() => element};
  const admin = {}, calls = [];
  const context = vm.createContext({
    path, mkdirSync, Error, ProtocolError, dir:path.join(directory, 'apps/desktop/electron'),
    createDesktopAuthorizationQuestionHost,createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL,EventCursor,register,
    desktopHost:{userNamespace:'synthetic-laya'},authorizationQuestionHost:undefined,authorizationIntentHost:undefined,
    nativeExecutionHost:undefined,localAuthorizationOnly:false,runtime:undefined,runtimeConnection:undefined,client:undefined,eventCursor:undefined,
    panel:undefined,workspace:undefined,openPanel:()=>assert.fail('no authorization operation requested'),
    dataPaths:{runtime:path.join(directory, 'runtime.sqlite')},
    runtimeProfile:'huawei_ict_agentarts', competitionMode:true, fakeMode:false, fakeModelMode:false,
    syntheticMvp:false, agentArtsResponseMode:undefined, repairCandidateVersion:undefined,
    layaPort:undefined, layaKey:undefined, runtimeApplication:undefined, localLaya:undefined,
    mailConfig:undefined, mailHost:undefined, proactiveHost:undefined,
    runtimeBuildIdentityReader:undefined, conversationToolAccess:undefined, conversations:undefined,
    Conversations:class {activeConversationId(){return 'desktop-panel';}}, initializeInstalledSkills:async () => {}, runtimeError:'', connectionLabel:'',
    createConversationToolAccess:() => ({}), admin,
    localServicesStopped:true, stopP5DeviceTelemetry:async () => {}, startP5DeviceTelemetry:async () => {},
    agentArtsConfig:{runtimeBinding:() => undefined, snapshot:() => ({reason:'请先配置 AgentArts'})},
    publish() {controls?.render(context.localLaya?.snapshot());},
    createLocalLayaHost(options) {
      return createLocalLayaHost({...options, discover:() => ({model, script, python:'Synthetic-python'}),
        freeMemory:() => currentMemory,
        launch() {
          launches++; child = new EventEmitter(); const owned = child;
          owned.kill = () => {queueMicrotask(() => owned.emit('exit', 0)); return true;};
          return owned;
        },
        request:async () => ({ok:true, json:async () => ({status:'ok',model:'multilingual',capabilities:['multi_state'],maxStates:4})}),
        now:() => clock, sleep:async () => {clock += 50; await new Promise(setImmediate);},
      });
    },
    load:async name => {
      if(name==='@personal-agent/runtime/application') return {
        AuthorizationQuestions,
        createRuntimeApplication(options) {
          if(!options.hostOnlyTools?.includes(AUTHORIZATION_INTENT_TOOL)){
            runtimeCreations++;throw Error('No cloud Runtime may start without cloud binding');
          }
          // The documented local authorization control plane is not a cloud or Local Agent fallback.
          assert.equal(options.profile,'huawei_ict_agentarts');assert.equal(options.path,path.join(directory,'runtime.sqlite'));
          assert.equal(options.coordination,undefined);assert.equal(options.text,undefined);assert.equal(options.model,undefined);
          assert.deepEqual([...options.hostOnlyTools],[AUTHORIZATION_INTENT_TOOL]);
          assert.deepEqual(Array.from(options.tools,tool=>tool.descriptor.name),[AUTHORIZATION_INTENT_TOOL]);
          localControlCreations++;return createRuntimeApplication(options);
        },
        createLocalInboxClassifier:() => ({classify:async () => {throw Error('No inference in this test');}}),
      };
      if(name==='@personal-agent/runtime') return {readRuntimeBuildIdentity:() => undefined};
      if(name==='@personal-agent/cognition') return {LayaActionChoiceService:class {}, LocalLayaHttpTransport:class {}};
      throw Error('Unexpected public port: '+name);
    },
  });
  t.after(async () => {
    child?.emit('exit', 0); await context.localLaya?.stop();
    context.authorizationQuestionHost?.close();context.authorizationIntentHost?.close();
    context.runtimeConnection?.dispose();context.runtimeApplication?.close();
    if(previousDocument===undefined)delete globalThis.document; else globalThis.document=previousDocument;
    assert.equal(path.dirname(directory), realpathSync(base)); rmSync(directory,{recursive:true,force:true});
  });
  const boot = vm.runInContext(`${authorizationPort}\n${authorizationInitialize}\n${localInitialize}\n${initialize}\ninitializeRuntime`, context);
  context.runtimeStartup = createDeferredRuntimeStartup({isConfigured:() => false, initialize:boot});
  await vm.runInContext(`(async () => {${startup}})()`, context);
  assert.equal(context.runtimeStartup.snapshot().state,'configuration_required');
  assert.equal(context.runtimeError,'请先配置 AgentArts');assert.equal(context.localAuthorizationOnly,true);
  assert.equal(localControlCreations,1);assert.equal(runtimeCreations,0);assert.equal(context.runtimeApplication.activeTaskCount,0);
  const action = vm.runInContext(`(async function(event,name,payload){const sender=event.sender;
    if(name==='snapshot')return {laya:localLaya?.snapshot()};${route}${mailRoute}})`, context);
  context.action = action;
  const ipc = vm.runInContext(`(${handler})`, context);
  const invokeContext = vm.createContext({activeDesktopConversationId:undefined, readDeveloperSettingsDiagnostic,
    bridge:{invoke:(name,payload) => {calls.push(name); return ipc({sender:admin},name,payload);}}});
  const invoke = vm.runInContext(`(${invokeSource})`, invokeContext);
  controls = mountLayaControls({querySelector:() => ({before() {}})}, invoke);
  controls.render(context.localLaya?.snapshot());
  return {context, boot, action, controls, nodes, calls, launches:() => launches,
    runtimeCreations:() => runtimeCreations, localControlCreations:()=>localControlCreations,setMemory:value => {currentMemory=value;}};
}

test('actual Main without cloud binding or mail configuration still dispatches the explicit Laya button to its original host', async t => {
  const f = await fixture(t);
  assert.equal(f.context.mailConfig, undefined);
  assert.equal(f.context.localLaya.snapshot().state, 'stopped');
  assert.equal(f.nodes.start.disabled, false);
  await f.nodes.start.onclick();
  assert.equal(f.context.localLaya.snapshot().state, 'ready');
  assert.match(f.nodes.status.textContent, /本机 Laya 已连接/);
  assert.equal(f.launches(), 1);
  const originalHost = f.context.localLaya;
  await assert.rejects(f.boot(), /请先配置 AgentArts/);
  assert.equal(f.context.localLaya, originalHost, 'retrying cloud setup cannot orphan the owned model process');
  await f.nodes.stop.onclick();
  assert.equal(f.context.localLaya.snapshot().state, 'stopped');
  assert.equal(f.nodes.status.textContent, '本地模型已停止');
  assert.equal(f.runtimeCreations(), 0, 'no cloud task or Local Agent fallback starts');
  assert.equal(f.localControlCreations(),1,'cloud setup retry must not create another local authorization Runtime');
  assert.deepEqual(f.calls, ['laya.start','snapshot','laya.stop','snapshot']);
});

test('the actual Laya settings action keeps admin and Competition guards without granting mail access', async t => {
  const f = await fixture(t);
  await assert.rejects(f.action({sender:{}}, 'laya.start'), /本项目设置/);
  await assert.rejects(f.action({sender:f.context.admin}, 'mail.enable'), /本项目设置/);
  f.context.competitionMode = false;
  await assert.rejects(f.action({sender:f.context.admin}, 'laya.start'), /本项目设置/);
  assert.equal(f.launches(), 0);
  assert.equal(f.context.localLaya.snapshot().state, 'stopped');
});

test('the actual Main and original host report the memory refusal in the button status with zero model launches', async t => {
  const f = await fixture(t, {memory:0});
  await f.nodes.start.onclick();
  assert.equal(f.context.localLaya.snapshot().state, 'memory_insufficient');
  assert.match(f.nodes.status.textContent, /可用内存不足 2 GB/);
  assert.equal(f.launches(), 0);
  assert.equal(f.nodes.start.disabled, false);
  assert.equal(f.nodes.stop.disabled, true);
  f.setMemory(8 * 1024 ** 3);
  await f.nodes.start.onclick();
  assert.equal(f.context.localLaya.snapshot().state, 'ready');
  assert.equal(f.launches(), 1, 'only a later explicit click starts the Synthetic child');
});
