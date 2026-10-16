import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createVoicePcmFrameSourcePort} from '@personal-agent/voice';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createMicrophoneCaptureHost} from '../electron/microphone-capture-host.js';
import {createDesktopVoiceInput} from '../electron/voice-input.js';
import {createDesktopWakeVoiceHost} from '../electron/wake-voice-host.js';

// Exercise the actual main-process consumers without booting Electron or real services.
const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let recordRoute, stopRoute, wakeBusy, toggleLiveSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'toggleLive') toggleLiveSource = node.getText(ast);
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "name.startsWith('voice.record.') || name === 'voice.play'") recordRoute = node.getText(ast);
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "name === 'voice.stop'") stopRoute = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createDesktopWakeVoiceHost') {
    wakeBusy = node.arguments[0].properties.find(p => p.name?.getText(ast) === 'isBusy')?.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(recordRoute && stopRoute && wakeBusy && toggleLiveSource);

function fixture({playbackReleaseFails = false, recognitionStopFails} = {}) {
  let live, microphoneHost, physicalStarts = 0, gatewayCloses = 0, interrupts = 0, captureToken;
  const taskCalls = [], drafts = [];
  const contents = {id:9, mainFrame:{}, isDestroyed:()=>false, send(channel, message) {
    const event = {sender:contents, senderFrame:contents.mainFrame};
    if (channel === 'desktop:live-command') {
      if (message.type === 'stop' && playbackReleaseFails) throw Error('synthetic playback stop delivery failure');
      if (['start','stop'].includes(message.type)) queueMicrotask(()=>live.receive(event,
        {token:message.token, type:message.type === 'start' ? 'ready' : 'stopped'}));
    }
    if (channel === 'desktop:microphone-command') {
      if (message.type === 'start') {physicalStarts++; captureToken = message.token;}
      // Explicit Fake track receipts exercise the real capture host, not hardware.
      queueMicrotask(()=>microphoneHost.receive(event, {token:message.token,
        type:message.type === 'start' ? 'ready' : 'stopped', trackLive:true, sampleRate:16000, tracksStopped:true}));
    }
  }};
  const panel = {webContents:contents, isDestroyed:()=>false, isVisible:()=>true};
  microphoneHost = createMicrophoneCaptureHost({getPanel:()=>panel, permissionGate:{grant:()=>()=>{}}});
  live = createLiveVoiceHost({getPanel:()=>panel, config:{snapshot:()=>({configured:true}), current:()=>({})}, microphoneHost,
    createSource:()=>createVoicePcmFrameSourcePort(microphoneHost.binding),
    createGateway:()=>({async connect(){return {sendAudio(){}, interrupt(){interrupts++;}, async close(){gatewayCloses++;}};}}),
    createConsumer:()=>({}), client:{}, readContext:()=>'', onTranscript(){}});
  const voice = createDesktopVoiceInput({source:createVoicePcmFrameSourcePort(microphoneHost.binding), microphoneHost,
    client:{call(operation){taskCalls.push(operation); assert.fail('dictation must not call Runtime');}},
    onTranscript:value=>drafts.push(value), enabled:true, inputMode:'dictation', speechPorts:{
      recognition:{recognize(){
        if (recognitionStopFails === undefined) assert.fail('recording alone must not call ASR');
        return {result:Promise.resolve({text:'合成听写',locale:'zh-CN'}), async stop(){
          if (recognitionStopFails) throw Error('synthetic ASR release failure');
        }};
      }},
      output:{speak(){assert.fail('recording alone must not speak');}}, async dispose(){}}});
  const context = vm.createContext({liveVoice:live, panel, voiceInput:voice, voiceConfigurationPending:false,
    panelHiding:false, wakeQuitUnknown:false, wakeVoice:undefined, Boolean, Error,
    liveToggleRevision:0, liveShortcut:{}, liveShortcutError:undefined, pinned:false,
    openPanel(){}, publish(){}, stopWakeVoice:()=>wake.disable()});
  const route = vm.runInContext(`(async function(sender,name){${recordRoute}})`, context);
  const stop = vm.runInContext(`(async function(sender,name){${stopRoute}})`, context);
  const isBusy = vm.runInContext(`(${wakeBusy})`, context);
  const toggleLive = vm.runInContext(`(${toggleLiveSource})`, context);
  const wake = createDesktopWakeVoiceHost({getPanel:()=>panel, microphoneHost, voiceInput:voice, isBusy,
    createDetector:()=>({start(){
      let resolve;
      const closed = new Promise(yes=>resolve=yes);
      return {ready:Promise.resolve(), closed, accept(){}, async stop(){resolve();}};
    }, async dispose(){}})});
  return {live, voice, wake, microphoneHost, isBusy, record:()=>route(panel,'voice.record.start'),
    requestStop:()=>stop(panel,'voice.stop'), toggleLive, taskCalls, drafts,
    feed:()=>microphoneHost.receive({sender:contents,senderFrame:contents.mainFrame},
      {token:captureToken,type:'frame',data:new Uint8Array(3200)}),
    get interrupts(){return interrupts;},
    get physicalStarts(){return physicalStarts;}, get gatewayCloses(){return gatewayCloses;}};
}

for (const recognitionStopFails of [true, false]) {
  test(`ASR release ${recognitionStopFails ? 'failure blocks' : 'confirmation permits'} switching to manual, Wake and Live`, async () => {
    const f = fixture({recognitionStopFails});
    try {
      await f.record(); f.feed();
      if (recognitionStopFails) {
        await assert.rejects(f.voice.finishCapture(9), /释放未确认/);
        assert.equal(f.microphoneHost.snapshot().lastRelease.verified, true);
        await assert.rejects(f.record(), /释放未确认/);
        await assert.rejects(f.wake.enable(9), /请先结束当前语音/);
        await assert.rejects(f.toggleLive(), /请先结束语音/);
        assert.equal(f.voice.hasActive(), true);
        await assert.rejects(f.voice.cancelCapture(9), /释放未确认/);
        assert.equal(f.voice.hasActive(), true, 'repeated stop must not erase failed ownership');
        assert.equal(f.physicalStarts, 1, 'no consumer reacquires capture after failed ASR release');
        assert.equal(f.drafts.length, 0);
      } else {
        await f.voice.finishCapture(9);
        assert.equal(f.voice.hasActive(), false);
        await f.record(); await f.voice.cancelCapture(9);
        await f.wake.enable(9); await f.wake.disable();
        await f.toggleLive(); await f.live.stop();
        assert.equal(f.physicalStarts, 4);
        assert.equal(f.drafts.length, 1);
      }
      assert.deepEqual(f.taskCalls, []);
    } finally {await f.wake.dispose(); await f.voice.dispose(); await f.live.dispose();}
  });
}

test('unconfirmed Live playback release blocks manual recording and Wake even after confirmed microphone release', async () => {
  const f = fixture({playbackReleaseFails:true});
  try {
    await f.live.start();
    const stopped = await f.live.stop();
    assert.equal(f.gatewayCloses,1);
    assert.equal(f.microphoneHost.snapshot().lastRelease.verified,true);
    assert.equal(f.microphoneHost.snapshot().busy,false);
    assert.equal(stopped.status,'error');
    assert.match(stopped.reason,/释放未确认/);
    assert.equal(stopped.active,true);
    assert.equal(f.live.hasActive(),true);
    await assert.rejects(f.record(),/请先关闭 Live/);
    assert.equal(f.isBusy(),true);
    await assert.rejects(f.wake.enable(9),/请先结束当前语音/);
    await assert.rejects(f.live.start(),/释放未确认/);
    await f.live.stop();
    assert.equal(f.live.hasActive(),true,'repeating stop cannot clear an unconfirmed release');
    assert.equal(f.physicalStarts,1,'neither consumer reacquires the microphone');
  } finally {await f.wake.dispose(); await f.voice.dispose(); await f.live.dispose();}
});

test('confirmed Live release permits manual recording and Wake through the same main-process guards', async () => {
  const f = fixture();
  try {
    await f.live.start();
    const stopped = await f.live.stop();
    assert.equal(stopped.active,false);
    assert.equal(f.live.hasActive(),false);
    assert.equal(f.microphoneHost.snapshot().lastRelease.verified,true);
    await f.record();
    assert.equal(f.voice.hasActive(),true);
    await f.voice.cancelCapture(9);
    assert.equal(f.isBusy(),false);
    assert.equal((await f.wake.enable(9)).phase,'listening');
    await f.wake.disable();
    assert.equal(f.physicalStarts,3);
  } finally {await f.wake.dispose(); await f.voice.dispose(); await f.live.dispose();}
});

test('Live interrupt remains available during a session but cannot claim stopped after unconfirmed release', async () => {
  const f = fixture({playbackReleaseFails:true});
  try {
    await f.live.start();
    assert.equal((await f.requestStop()).stopped,true);
    assert.equal(f.interrupts,1);
    assert.equal(f.live.snapshot().status,'listening');
    await f.live.stop();
    await assert.rejects(f.requestStop(),/释放未确认/);
    assert.equal(f.interrupts,1,'failed release cannot issue a new interrupt on the closed session');
    assert.equal(f.live.snapshot().status,'error');
    assert.equal(f.physicalStarts,1);
  } finally {await f.wake.dispose(); await f.voice.dispose(); await f.live.dispose();}
});
