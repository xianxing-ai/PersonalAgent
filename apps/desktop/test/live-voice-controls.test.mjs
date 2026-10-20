import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLiveVoiceControls,liveAudioFailureText,liveWorkFeedbackText} from '../src/app/live-voice-controls.js';

test('work feedback distinguishes unknown acceptance, accepted requests and returned receipts',()=>{
  assert.match(liveWorkFeedbackText({workRequests:[{state:'failed'}]}),/受理未确认.*避免重复派发/);
  const accepted=liveWorkFeedbackText({workRequests:[{state:'accepted',taskId:'task-1'}]});
  assert.match(accepted,/task-1.*等待结果/);
  assert.match(accepted,/不代表已派发子任务/);
  const returned=liveWorkFeedbackText({workRequests:[{state:'result_returned',taskId:'task-1'}]});
  assert.match(returned,/回执已返回/);
  assert.match(returned,/不代表子任务成功或已独立验证/);
});

test('saved startup opt-in is displayed and sent through the original Live configure action',async t=>{
  const calls=[],f=fixture(t,async(name,payload)=>calls.push({name,payload}));
  f.controls.render({configured:true,workspaceId:'fixture',hotkey:'F8',audioConsent:true,
    startupGreeting:true,continuousListening:true,startup:{greeting:'failed'}});
  assert.equal(f.fields['live-startup-greeting'].checked,true);
  assert.equal(f.fields['live-continuous-listening'].checked,true);
  assert.match(f.status.textContent,/启动问候未完成/);
  await f.save();assert.equal(calls[0].name,'live.configure');
  assert.equal(calls[0].payload.startupGreeting,true);assert.equal(calls[0].payload.continuousListening,true);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture(t, invoke) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  const fields = Object.fromEntries(['live-key', 'live-workspace', 'live-hotkey', 'live-consent', 'live-save', 'live-config-result', 'summary',
    'live-startup-greeting','live-continuous-listening']
    .map(name => [name, {value: '', checked: false, textContent: '',insertAdjacentHTML(){}}]));
  // Model select value against the options actually mounted by the control.
  // HTML option text is its value when no explicit value attribute is present.
  let selectedIndex = -1;
  fields['live-hotkey'].options = [];
  Object.defineProperty(fields['live-hotkey'], 'value', {
    get: () => fields['live-hotkey'].options[selectedIndex]?.value ?? '',
    set: value => {selectedIndex = fields['live-hotkey'].options.findIndex(option => option.value === value);},
  });
  const listeners = new Map();
  const settings = {open: false, querySelector: selector => fields[selector.replace(/^#/, '')],
    addEventListener: (type, listener) => listeners.set(type, listener)};
  Object.defineProperty(settings, 'innerHTML', {set: markup => {
    fields['live-hotkey'].options = [...markup.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(match => {
      const explicit = match[1].match(/\bvalue="([^"]*)"/)?.[1];
      return {textContent: match[2], disabled: /\bdisabled\b/.test(match[1]),
        get value() {return explicit ?? this.textContent;}};
    });
    selectedIndex = [...markup.matchAll(/<option\b([^>]*)>/g)].findIndex(match => /\bselected\b/.test(match[1]));
    if (selectedIndex === -1 && fields['live-hotkey'].options.length) selectedIndex = 0;
  }});
  const status = {setAttribute() {}};
  let created = 0;
  globalThis.document = {createElement: () => created++ ? status : settings};
  const controls = mountLiveVoiceControls({querySelector: () => ({before() {}})}, invoke);
  return {fields, settings, status, controls, edit(name, value) {
    fields[name].value = value; listeners.get('input')();
  }, save: () => fields['live-save'].onclick()};
}

test('edits made during a pending save survive success and later host refresh', async t => {
  const pending = deferred(), calls = [];
  const f = fixture(t, (name, payload) => {calls.push({name, payload}); return pending.promise;});
  f.controls.render({workspaceId: 'before', hotkey: 'F8'});
  f.edit('live-workspace', 'submitted'); f.edit('live-key', 'synthetic-first-key');
  f.fields['live-consent'].checked = true; f.settings.open = true;
  const saving = f.save();
  assert.equal(f.fields['live-key'].value, '');
  f.edit('live-workspace', 'next-draft'); f.edit('live-key', 'synthetic-next-key');
  f.edit('live-hotkey', 'F6');
  pending.resolve(); await saving;
  f.controls.render({configured: true, workspaceId: 'submitted', hotkey: 'F8'});
  assert.equal(f.fields['live-workspace'].value, 'next-draft');
  assert.equal(f.fields['live-hotkey'].value, 'F6');
  assert.equal(f.fields['live-key'].value, 'synthetic-next-key');
  assert.equal(f.settings.open, true);
  assert.match(f.fields['live-config-result'].textContent, /新修改尚未保存/);
  assert.equal(calls[0].payload.apiKey, '', 'submitted credential is released when the request settles');
});

test('settled save with no later edits accepts host refresh and closes settings', async t => {
  const f = fixture(t, async () => {});
  f.edit('live-workspace', 'submitted'); f.settings.open = true;
  await f.save();
  f.controls.render({configured: true, workspaceId: 'host-readback', hotkey: 'F7'});
  assert.equal(f.fields['live-workspace'].value, 'host-readback');
  assert.equal(f.settings.open, false);
  assert.equal(f.fields['live-save'].disabled, false);
});

test('pending saves cannot be duplicated and retain their editing fields during refresh', async t => {
  const pending = deferred(); let calls = 0;
  const f = fixture(t, () => {calls++; return pending.promise;});
  f.controls.render({workspaceId: 'initial', hotkey: 'F8'});
  const saving = f.save(), repeated = f.save();
  f.controls.render({workspaceId: 'stale-readback', hotkey: 'F5'});
  assert.equal(calls, 1);
  assert.equal(f.fields['live-workspace'].value, 'initial');
  pending.resolve(); await Promise.all([saving, repeated]);
});

test('save failure keeps new edits and restores the save button without automatic retry', async t => {
  const pending = deferred(); let calls = 0;
  const f = fixture(t, () => {calls++; return pending.promise;});
  f.edit('live-workspace', 'submitted');
  const saving = f.save(); f.edit('live-workspace', 'retry-draft');
  pending.reject(Error('synthetic configuration error')); await saving;
  f.controls.render({workspaceId: 'old-host-value'});
  assert.equal(f.fields['live-workspace'].value, 'retry-draft');
  assert.equal(f.fields['live-save'].disabled, false);
  assert.equal(calls, 1);
});

test('concurrent toggle clicks submit one action and settle cleanly after failure', async t => {
  const pending = deferred(); let calls = 0;
  const f = fixture(t, () => {calls++; return calls === 1 ? pending.promise : Promise.resolve();});
  const toggling = f.controls.toggle(), repeated = f.controls.toggle();
  assert.equal(calls, 1);
  pending.reject(Error('synthetic connection error')); await Promise.all([toggling, repeated]);
  assert.equal(f.settings.open, true);
  assert.match(f.fields['live-config-result'].textContent, /synthetic connection error/);
  await f.controls.toggle(); assert.equal(calls, 2);
});

test('restored supported F13 and F24 remain selected in ordinary blank-key saves', async t => {
  const calls = [];
  const f = fixture(t, async (name, payload) => {calls.push({name, payload: {...payload}});});
  for (const hotkey of ['F13', 'F24']) {
    f.controls.render({configured: true, workspaceId: 'restored-workspace', hotkey});
    assert.equal(f.fields['live-hotkey'].value, hotkey);
    assert.equal(f.fields['live-key'].value, '');
    await f.save();
    assert.deepEqual(calls.at(-1), {name: 'live.configure', payload: {
      workspaceId: 'restored-workspace', apiKey: '', hotkey, audioConsent: true,startupGreeting:false,continuousListening:false,
    }});
    assert.equal(f.fields['live-save'].disabled, false);
  }
});

test('default F8 remains selected and reserved F9 keeps its stable disabled value', t => {
  const f = fixture(t, async () => {});
  assert.equal(f.fields['live-hotkey'].value, 'F8');
  const reserved = f.fields['live-hotkey'].options.find(option => option.value === 'F9');
  assert.ok(reserved);
  assert.equal(reserved.disabled, true);
  assert.match(reserved.textContent, /记事本写入确认/);
});


test('a host-published active session permits explicit stop while its start receipt is pending',async t=>{
  const operations=[];const f=fixture(t,()=>{const op=deferred();operations.push(op);return op.promise;});
  f.controls.render({configured:true,active:false,status:'idle'});const starting=f.controls.toggle();
  await f.controls.toggle();assert.equal(operations.length,1,'duplicate start before active publication stays gated');
  f.controls.render({configured:true,active:true,status:'connecting'});const stopping=f.controls.toggle();
  assert.equal(operations.length,2,'a host-published connecting session can be stopped');
  await f.controls.toggle();assert.equal(operations.length,2,'duplicate stop stays gated');
  f.controls.render({configured:true,active:false,status:'idle'});await f.controls.toggle();assert.equal(operations.length,2,'stop receipt still pending cannot begin another session');
  operations[0].reject(Error('older start was cancelled'));await starting;
  assert.equal(f.settings.open,false,'cancelled old start cannot reopen newer stop UI');assert.equal(f.fields['live-config-result'].textContent,'');
  await f.controls.toggle();assert.equal(operations.length,2,'old start finally cannot unlock pending stop');
  operations[1].resolve();await stopping;const retry=f.controls.toggle();assert.equal(operations.length,3);operations[2].resolve();await retry;
});

test('current stop failure stays visible and permits only explicit retry after settlement',async t=>{
  const operations=[];const f=fixture(t,()=>{const op=deferred();operations.push(op);return op.promise;});
  f.controls.render({configured:true,active:false});const starting=f.controls.toggle();
  f.controls.render({configured:true,active:true,status:'connecting'});const stopping=f.controls.toggle();assert.equal(operations.length,2);
  operations[1].reject(Error('current stop failed'));await stopping;
  assert.equal(f.settings.open,true);assert.equal(f.fields['live-config-result'].textContent,'current stop failed');
  operations[0].reject(Error('older cancelled start'));await starting;assert.equal(f.fields['live-config-result'].textContent,'current stop failed');
  const retry=f.controls.toggle();assert.equal(operations.length,3);operations[2].resolve();await retry;
});

test('successful explicit retry clears its old toggle error and preserves open settings and draft', async t => {
  const retry = deferred(); let calls = 0;
  const f = fixture(t, () => ++calls === 1 ? Promise.reject(Error('first connection failed')) : retry.promise);
  await f.controls.toggle();
  const toggling = f.controls.toggle();
  f.settings.open = false; f.settings.open = true;
  f.edit('live-workspace', 'new-draft'); f.edit('live-key', 'synthetic-new-draft-key');
  retry.resolve(); await toggling;
  assert.equal(f.fields['live-config-result'].textContent, '');
  assert.equal(f.settings.open, true);
  f.controls.render({configured: true, active: true, status: 'listening', workspaceId: 'host-value'});
  assert.equal(f.fields['live-workspace'].value, 'new-draft');
  assert.equal(f.fields['live-key'].value, 'synthetic-new-draft-key');
  assert.equal(calls, 2);
});

test('failed explicit retries replace their own error and only later success clears it', async t => {
  let calls = 0;
  const f = fixture(t, async () => {if (++calls < 3) throw Error(`connection failure ${calls}`);});
  await f.controls.toggle(); await f.controls.toggle();
  assert.equal(f.fields['live-config-result'].textContent, 'connection failure 2');
  await f.controls.toggle();
  assert.equal(f.fields['live-config-result'].textContent, '');
  assert.equal(calls, 3);
});

for (const outcome of ['pending', 'success', 'failure']) {
  test(`successful retry preserves newer configure ${outcome} feedback`, async t => {
    const retry = deferred(), save = deferred(); let toggles = 0;
    const f = fixture(t, name => name === 'live.configure' ? save.promise
      : ++toggles === 1 ? Promise.reject(Error('old toggle failure')) : retry.promise);
    await f.controls.toggle(); const toggling = f.controls.toggle();
    f.edit('live-workspace', 'submitted'); const saving = f.save();
    if (outcome === 'success') {save.resolve(); await saving;}
    if (outcome === 'failure') {save.reject(Error('new configuration failure')); await saving;}
    const feedback = f.fields['live-config-result'].textContent;
    assert.ok(feedback); assert.notEqual(feedback, 'old toggle failure');
    retry.resolve(); await toggling;
    assert.equal(f.fields['live-config-result'].textContent, feedback);
    if (outcome === 'pending') {save.resolve(); await saving;}
    assert.equal(f.fields['live-save'].disabled, false);
  });
}

test('configure completion retakes feedback ownership after an intervening toggle failure', async t => {
  for (const fails of [false, true]) {
    const save = deferred(), retry = deferred(); let toggles = 0;
    const f = fixture(t, name => name === 'live.configure' ? save.promise
      : ++toggles === 1 ? Promise.reject(Error('toggle failed during save')) : retry.promise);
    const saving = f.save(); await f.controls.toggle(); const toggling = f.controls.toggle();
    if (fails) save.reject(Error('configuration failed later')); else save.resolve();
    await saving; const feedback = f.fields['live-config-result'].textContent;
    retry.resolve(); await toggling;
    assert.equal(f.fields['live-config-result'].textContent, feedback);
    assert.match(feedback, fails ? /configuration failed later/ : /已保存/);
  }
});

test('an older successful start cannot clear the current stop error', async t => {
  const operations = [];
  const f = fixture(t, () => {const op = deferred(); operations.push(op); return op.promise;});
  const starting = f.controls.toggle();
  f.controls.render({configured: true, active: true, status: 'connecting'});
  const stopping = f.controls.toggle();
  operations[1].reject(Error('current stop failure')); await stopping;
  operations[0].resolve(); await starting;
  assert.equal(f.fields['live-config-result'].textContent, 'current stop failure');
  assert.equal(f.settings.open, true);
});

test('current audio-send failure shows its existing safe cause/code instead of only generic connection failure',t=>{const f=fixture(t,async()=>({}));for(const code of ['PCM_FRAME_INVALID','CONNECTION_CLOSED','SEND_BACKPRESSURE','SEND_FAILED']){f.controls.render({configured:true,status:'error',reason:'音频发送失败，已停止录音',audioSendFailure:{code}});assert.match(f.status.textContent,/音频发送失败/);assert.ok(f.status.textContent.includes(code));}assert.equal(liveAudioFailureText({audioSendFailure:{code:'private raw secret'}}),'');});

test('compact render exposes safe audio failure and fixed Live conversation',t=>{const previous=globalThis.document;t.after(()=>{globalThis.document=previous;});const status={},button={};globalThis.document={createElement:()=>({querySelector:selector=>selector==='#live-runtime-status'?status:button})};const control=mountLiveVoiceControls({querySelector:()=>({before(){}})},async()=>{},{compact:true});for(const code of ['PCM_FRAME_INVALID','SEND_BACKPRESSURE']){control.render({configured:true,active:true,status:'error',reason:'音频发送失败，已停止录音',conversationTitle:'原对话',audioSendFailure:{code}});assert.ok(status.textContent.includes(code));assert.ok(status.textContent.includes('原对话'));}control.render({configured:true,status:'error',audioSendFailure:{code:'private-raw-secret'}});assert.equal(status.textContent.includes('private-raw-secret'),false);});
