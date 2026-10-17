import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const main = readFileSync(process.env.QUIT_PREFLIGHT_MAIN_SOURCE || new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.on'
    && node.arguments[0]?.getText(ast) === "'before-quit'") callback = node.arguments[1].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const declaration = name => ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === name).getText(ast);
const tick = () => new Promise(resolve => setImmediate(resolve));

// Verbatim main callbacks; explicit Fake app, Runtime count and resource ports.
function fixture({count = 0, startup = 'ready', voiceFailure = false, liveUnknown = false} = {}) {
  const calls = [];
  let exited = false, voiceUnavailable = false, wakeUnavailable = false, context, beforeQuit;
  const voiceInput = {hasActive: () => false, async beginCapture() {
    if (voiceUnavailable) throw Error('disposed voice'); return {status: 'listening'};
  }, async dispose() {calls.push('voice-dispose');voiceUnavailable = true;
    if (voiceFailure) throw Error('unknown voice release');}};
  const wakeVoice = {hasActive: () => false, async enable() {
    if (wakeUnavailable) throw Error('disposed wake');return {phase: 'listening'};
  }, async dispose() {calls.push('wake-dispose');wakeUnavailable = true;}};
  const app = {isQuitting: false, quit() {
    calls.push('app-quit');const event = {prevented: false, preventDefault() {this.prevented = true;}};
    beforeQuit(event);if (!event.prevented) exited = true;
  }};
  const optional = ['referenceHost','proactiveHost','todoHost','notepadHost','mailHost','localLaya','mailConfig',
    'p5DeviceNotificationHost','notificationApplicationHost','p5Cognition','p5SystemObservationSource','knowledgeWatchHost','wikiSourceMonitor','modelApiHost',
    'privateConsumption','installedSkillsHost','privateMemory','learningStore','knowledgeSourceConfig','obsidianPairing','goalCloudHost','calendarMeetingHost',
    'mailAnalysisHost','competitionFactBridge','runtime','competitionCatalog','productTools','codingWorkspace',
    'publicReferenceConsent','feedsHost','syntheticRepairHost','microphonePermissionGate','runtimeConnection','tray'];
  context = vm.createContext({...Object.fromEntries(optional.map(key => [key, undefined])),
    Promise, Error, setTimeout, clearTimeout, clearInterval, console, app, voiceInput, wakeVoice,
    runtimeStartup: {snapshot: () => ({state: startup})}, runtimeApplication: {activeTaskCount: count,
      close() {calls.push('runtime-close');}}, runtimeError: '', runtimeClosed: false,
    wakeQuitHandled: false, wakeQuitUnknown: false, wakeDisposal: undefined,
    voiceDisposed: false, voiceDisposal: undefined, voiceDisposalFailed: false,
    microphoneCaptureHost: {snapshot: () => ({busy: false})},
    liveVoice: liveUnknown ? {hasActive: () => true, async stop() {
      calls.push('live-stop');return {active: true, reason: 'Live 音频资源释放未确认'};
    }} : undefined,
    localServicesStopped: false, localServicesStopping: false, referenceClosed: false,
    todoClosed: false, notepadClosed: false, coordinationWatchInputs: new Map(), publicSkillSources: new Map(),
    poll: undefined, eventPoll: undefined, stopP5DeviceTelemetry() {calls.push('telemetry-stop');},
    globalShortcut: {unregisterAll() {calls.push('unregister-shortcuts');}},
    publish() {calls.push('publish');},
  });
  for (const name of ['stopWakeVoice','disposeWakeForQuit','reportPanelVoiceFailure']) {
    vm.runInContext(declaration(name), context);
  }
  beforeQuit = vm.runInContext(callback, context);
  return {context, calls, app, get exited() {return exited;}, voiceInput, wakeVoice};
}

test('an already active task refuses quit before permanent voice or wake disposal', async () => {
  const f = fixture({count: 1});f.app.quit();await tick();await tick();
  assert.equal(f.exited, false);assert.match(f.context.runtimeError, /Runtime 仍有活动任务/);
  assert.equal(f.context.app.isQuitting, false);
  assert.equal(f.calls.includes('voice-dispose'), false);assert.equal(f.calls.includes('wake-dispose'), false);
  assert.equal(f.calls.includes('telemetry-stop'), false);assert.equal(f.calls.includes('runtime-close'), false);
  assert.equal((await f.voiceInput.beginCapture()).status, 'listening');
  assert.equal((await f.wakeVoice.enable()).phase, 'listening');
});

test('a task finishing does not resume a refused quit; the next explicit quit closes normally', async () => {
  const f = fixture({count: 1});f.app.quit();await tick();f.context.runtimeApplication.activeTaskCount = 0;
  await tick();assert.equal(f.exited, false);assert.equal(f.calls.includes('voice-dispose'), false);
  f.app.quit();await tick();await tick();await tick();assert.equal(f.exited, true);
  assert.equal(f.calls.filter(call => call === 'wake-dispose').length, 1);
  assert.equal(f.calls.filter(call => call === 'voice-dispose').length, 1);
  assert.equal(f.calls.filter(call => call === 'runtime-close').length, 1);
});

test('a zero-task quit retains the original cleanup sequence', async () => {
  const f = fixture();f.context.installedSkillsHost={close(){f.calls.push('installed-skills-close');}};
  f.app.quit();await tick();await tick();await tick();
  assert.equal(f.exited, true);assert.equal(f.context.voiceDisposed, true);
  assert.equal(f.context.wakeQuitHandled, true);assert.equal(f.context.runtimeClosed, true);
  assert.ok(f.calls.indexOf('wake-dispose') < f.calls.indexOf('voice-dispose'));
  assert.ok(f.calls.indexOf('voice-dispose') < f.calls.indexOf('runtime-close'));
  assert.equal(f.calls.filter(call=>call==='installed-skills-close').length,1);
  assert.ok(f.calls.indexOf('installed-skills-close') < f.calls.indexOf('runtime-close'));
});

test('a bound NotificationHost survives refused quit and disposes once before Runtime on the next allowed quit',async()=>{
  const f=fixture({count:1});
  f.context.notificationApplicationHost={dispose(){f.calls.push('notification-dispose');}};
  f.app.quit();await tick();await tick();
  assert.equal(f.exited,false);assert.equal(f.context.app.isQuitting,false);
  assert.match(f.context.runtimeError,/Runtime 仍有活动任务/);
  assert.equal(f.calls.includes('notification-dispose'),false);
  assert.equal(f.calls.includes('runtime-close'),false);
  f.context.runtimeApplication.activeTaskCount=0;
  await tick();assert.equal(f.exited,false);assert.equal(f.calls.includes('notification-dispose'),false);
  f.app.quit();await tick();await tick();await tick();
  assert.equal(f.exited,true);assert.equal(f.context.runtimeClosed,true);
  assert.equal(f.calls.filter(call=>call==='notification-dispose').length,1);
  assert.equal(f.calls.filter(call=>call==='runtime-close').length,1);
  assert.ok(f.calls.indexOf('notification-dispose')<f.calls.indexOf('runtime-close'));
});

test('accepted quit closes Wiki, pairing and installed Skills before Runtime; an active task refuses it',async()=>{
  const f=fixture({count:1});f.context.wikiSourceMonitor={close(){f.calls.push('wiki-monitor-close');}};
  f.context.obsidianPairing={close(){f.calls.push('obsidian-pairing-close');}};
  f.context.installedSkillsHost={close(){f.calls.push('installed-skills-close');}};
  f.app.quit();await tick();assert.equal(f.calls.includes('wiki-monitor-close'),false);
  assert.equal(f.calls.includes('obsidian-pairing-close'),false);
  assert.equal(f.calls.includes('installed-skills-close'),false);
  f.context.runtimeApplication.activeTaskCount=0;f.app.quit();await tick();await tick();await tick();
  assert.equal(f.exited,true);assert.equal(f.calls.filter(call=>call==='wiki-monitor-close').length,1);
  assert.ok(f.calls.indexOf('wiki-monitor-close')<f.calls.indexOf('runtime-close'));
  assert.equal(f.calls.filter(call=>call==='obsidian-pairing-close').length,1);
  assert.equal(f.calls.filter(call=>call==='installed-skills-close').length,1);
  assert.ok(f.calls.indexOf('installed-skills-close')<f.calls.indexOf('runtime-close'));
  assert.ok(f.calls.indexOf('wiki-monitor-close')<f.calls.indexOf('obsidian-pairing-close'));
  assert.ok(f.calls.indexOf('obsidian-pairing-close')<f.calls.indexOf('runtime-close'));
});

test('Runtime startup guard keeps precedence over active-task preflight', async () => {
  const f = fixture({count: 1, startup: 'starting'});f.app.quit();await tick();
  assert.equal(f.exited, false);assert.equal(f.context.runtimeError, 'Runtime 正在连接，请稍后退出');
  assert.equal(f.calls.includes('wake-dispose'), false);assert.equal(f.calls.includes('voice-dispose'), false);
});

test('the original final task guard still catches work that appears during cleanup', async () => {
  const f = fixture();f.context.wakeVoice = undefined;f.context.voiceInput = undefined;
  f.context.stopP5DeviceTelemetry = () => {f.context.runtimeApplication.activeTaskCount = 1;};
  f.app.quit();await tick();assert.equal(f.exited, false);
  assert.match(f.context.runtimeError, /Runtime 仍有活动任务/);assert.equal(f.calls.includes('runtime-close'), false);
});

test('unknown Live release still blocks quit without recursively retrying it', async () => {
  const f = fixture({liveUnknown: true});f.context.wakeVoice = undefined;f.context.voiceInput = undefined;
  f.app.quit();await tick();assert.equal(f.exited, false);
  assert.equal(f.calls.filter(call => call === 'app-quit').length, 1);
  assert.equal(f.context.liveVoice.hasActive(), true);assert.equal(f.context.runtimeError, 'Live 音频资源释放未确认');
});

test('unknown SIS release stays blocked and does not repeat permanent disposal', async () => {
  const f = fixture({voiceFailure: true});f.context.wakeVoice = undefined;
  f.app.quit();await tick();assert.equal(f.exited, false);assert.equal(f.context.voiceDisposalFailed, true);
  f.app.quit();await tick();assert.equal(f.exited, false);
  assert.equal(f.calls.filter(call => call === 'voice-dispose').length, 1);
  assert.equal(f.context.runtimeError, '语音资源释放未确认');
});

// Original initialization/config/record functions; replace only dynamic imports with explicit Fake factories.
function reconfigurationFixture() {
  const f = fixture(), inputs = [], asr = [], panel = {isVisible: () => true, webContents: {id: 9}}, admin = {};
  const oldDispose = f.voiceInput.dispose;
  let oldDisposed = false;
  f.voiceInput.dispose = async () => {if (oldDisposed) return;oldDisposed = true;
    await oldDispose();f.context.runtimeApplication.activeTaskCount = 1;};
  f.wakeVoice.disable = async () => {};
  let configuration = {region: 'cn-north-4', projectId: 'synthetic-old'}, failInitialization = false;
  Object.assign(f.context, {panel, admin, competitionMode: true, client: {}, voiceConfigurationPending: false,
    voicePcmSource: undefined, sisPlaybackHost: undefined, panelHiding: false, voiceInitializationFailure: null,
    sisConfigHost: {snapshot: () => ({configured: true}), currentAccessKey:()=>undefined, current: () => configuration,
      configure(value) {configuration = value;f.calls.push('configure');}},
    desktopHost: {logVoicePlayback() {}}, taskGoals: new Map(), conversations: {add() {assert.fail('No Task');}},
    createDesktopSisPlaybackHost: () => ({async dispose() {f.calls.push('new-playback-dispose');}}),
    createDesktopWakeVoiceHost: () => ({hasActive: () => false, snapshot: () => ({phase: 'disabled'}), async disable() {},
      async dispose() {f.calls.push('new-wake-dispose');}}),
    fakeVoiceImport: async () => ({createVoicePcmFrameSourcePort: () => ({async dispose() {f.calls.push('new-source-dispose');}}),
      createHuaweiSisRecognitionPort: () => ({}), createHuaweiSisOutputPort: () => ({})}),
    fakeInputImport: async () => ({createDesktopVoiceInput() {
      if (failInitialization) throw Error('synthetic voice initialization failure');
      const controller = new AbortController();asr.push(controller);
      let active = false;
      const input = {hasActive: () => active, async beginCapture() {active = true;return {status: 'listening'};},
        async finishCapture() {return {status: 'recognizing'};},
        async dispose() {f.calls.push('new-voice-dispose');controller.abort();active = false;}};
      inputs.push(input);return input;
    }}),
  });
  const initialization = declaration('initializeSisVoice')
    .replace("await import('@personal-agent/voice')", 'await fakeVoiceImport()')
    .replace("await import('./voice-input.js')", 'await fakeInputImport()');
  vm.runInContext(initialization, f.context);
  let configure, record;
  const find = node => {
    if (ts.isIfStatement(node)) {
      const expression = node.expression.getText(ast);
      if (expression === "name === 'voice.configure' || name === 'voice.login'") configure = node.getText(ast);
      if (expression === "name.startsWith('voice.record.') || name === 'voice.play'") record = node.getText(ast);
    }
    ts.forEachChild(node, find);
  };
  find(ast);assert.ok(configure && record);
  const action = vm.runInContext(`(async function(sender,name,payload){${configure}\n${record}})`, f.context);
  return {...f, get exited() {return f.exited;}, inputs, asr,
    invoke: (name, payload) => action(['voice.configure','voice.login'].includes(name) ? admin : panel, name, payload),
    fail(value) {failInitialization = value;},
    async refuseLateQuit() {
      f.app.quit();await tick();await tick();await tick();
      assert.equal(f.exited, false);assert.match(f.context.runtimeError, /活动任务/);
      f.context.runtimeApplication.activeTaskCount = 0;
    },
  };
}

test('a legitimate reconfiguration after late refused quit disposes the new voice and aborts its pending recognition', async () => {
  const f = reconfigurationFixture();await f.refuseLateQuit();
  await f.invoke('voice.configure', {region: 'cn-north-4', projectId: 'synthetic-new'});
  await f.invoke('voice.record.start');await f.invoke('voice.record.finish');
  assert.equal(f.inputs[0].hasActive(), true);assert.equal(f.asr[0].signal.aborted, false);
  f.app.quit();await tick();await tick();await tick();
  assert.equal(f.exited, true);assert.equal(f.asr[0].signal.aborted, true);
  assert.equal(f.inputs[0].hasActive(), false);
  assert.equal(f.calls.filter(call => call === 'voice-dispose').length, 1);
  assert.equal(f.calls.filter(call => call === 'new-voice-dispose').length, 1);
  assert.ok(f.calls.indexOf('new-voice-dispose') < f.calls.indexOf('runtime-close'));
});

test('failed reinitialization retains the old quit cleanup receipt and permits only a later successful new host cleanup', async () => {
  const f = reconfigurationFixture();await f.refuseLateQuit();
  const oldReceipt = f.context.voiceDisposal;f.fail(true);
  await assert.rejects(() => f.invoke('voice.configure', {region: 'cn-north-4', projectId: 'synthetic-new'}),
    /SIS 配置已保存，但语音适配器启动失败/);
  assert.equal(f.context.voiceInput, undefined);assert.equal(f.inputs.length, 0);
  assert.equal(f.context.voiceDisposal, oldReceipt);assert.equal(f.context.voiceDisposed, true);
  assert.equal(f.calls.filter(call => call === 'new-source-dispose').length, 1);
  assert.equal(f.exited, false);
  f.fail(false);await f.invoke('voice.configure', {region: 'cn-north-4', projectId: 'synthetic-retry'});
  await f.invoke('voice.record.start');await f.invoke('voice.record.finish');
  f.app.quit();await tick();await tick();await tick();
  assert.equal(f.asr[0].signal.aborted, true);assert.equal(f.exited, true);
  assert.equal(f.calls.filter(call => call === 'new-voice-dispose').length, 1);
});

test('unknown old voice cleanup still refuses reconfiguration and never publishes a replacement', async () => {
  const f = reconfigurationFixture();f.context.wakeVoice = undefined;
  f.context.voiceInput = undefined;f.context.sisPlaybackHost = {};
  f.context.voiceDisposalFailed = true;
  await assert.rejects(() => f.invoke('voice.configure', {region: 'cn-north-4', projectId: 'synthetic-new'}), /释放未确认/);
  assert.equal(f.inputs.length, 0);assert.equal(f.calls.includes('configure'), false);
  assert.equal(f.context.voiceDisposalFailed, true);
});
