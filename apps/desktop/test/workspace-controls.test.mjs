import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkspaceControls} from '../src/app/workspace-controls.js';

function harness(t, invoke = async () => undefined) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;});
  const names = ['name','capabilities','select','node-status','select-node','select-file','project-status',
    'select-npm','cloud','write','command','project-code','project-label','authorize','revoke','status'];
  const fields = Object.fromEntries(names.map(name => [name, {checked: false, disabled: false, textContent: '',
    listeners: new Map(), attributes: new Map(), addEventListener(event, handler) {this.listeners.set(event, handler);},
    setAttribute(key, value) {this.attributes.set(key, value);}}]));
  const body={},documentListeners=new Map();
  const section = {isConnected:true,hidden:false,getClientRects(){return this.hidden?[]:[{}];},
    contains:target=>Object.values(fields).includes(target),setAttribute() {}, querySelector(selector) {return fields[/data-workspace="([^"]+)"/u.exec(selector)[1]];}};
  for (const field of Object.values(fields)) Object.assign(field,{isConnected:true,focus(){globalThis.document.activeElement=this;}});
  globalThis.document = {body,activeElement:body,createElement: () => section,
    addEventListener:(name,listener)=>documentListeners.set(name,listener),
    removeEventListener:(name,listener)=>{if(documentListeners.get(name)===listener)documentListeners.delete(name);}};
  const controls = mountWorkspaceControls({append() {}}, invoke);
  const render = (coding = {}) => controls.render({coding: {configured: true, displayName: 'project',
    authorizationAvailable: true, projectScriptsAvailable: true, projectCommands: ['build','test'], ...coding}});
  const change = (name, checked) => {fields[name].checked = checked; fields[name].listeners.get('change')?.();};
  return {fields, render, change, controls,section,
    blur:()=>{globalThis.document.activeElement=body;},
    focusElsewhere:()=>{const target={};globalThis.document.activeElement=target;documentListeners.get('focusin')?.({target});},
    click: name => fields[name].listeners.get('click')()};
}

test('native workspace form can authorize local reads with cloud export unchecked',async t=>{
  const calls=[];
  const ui=harness(t,async(action,input)=>{
    calls.push({action,input});
    return {coding:{configured:true,displayName:'project',authorizationAvailable:true,
      readAvailable:true,cloudExportAllowed:false,writeAllowed:false,commandAllowed:false}};
  });
  ui.render();
  assert.equal(ui.fields.cloud.checked,false);
  assert.equal(ui.fields.authorize.disabled,false);
  await ui.click('authorize');
  assert.deepEqual(calls,[{action:'coding.authorize',input:{cloudExportAllowed:false,
    writeAllowed:false,commandAllowed:false,projectCodeAllowed:false}}]);
  assert.equal(ui.fields.cloud.checked,false);
  assert.match(ui.fields.capabilities.textContent,/读取：可用/);
});

test('workspace settled actions restore keyboard position only while origin remains valid and undisturbed', async t => {
  let resolve,reject;const calls=[];
  const ui=harness(t,action=>{calls.push(action);return new Promise((done,fail)=>{resolve=done;reject=fail;});});
  const coding={configured:true,displayName:'project',authorizationAvailable:true,cloudExportAllowed:true};
  for(const name of ['select','authorize','revoke'])for(const mode of ['success','failure','invalid']) {
    ui.render(coding);ui.fields[name].focus();const pending=ui.click(name);ui.blur();
    if(mode==='failure')reject(Error('synthetic-only'));else resolve(mode==='invalid'?{coding:[]}:{coding});
    await pending;assert.equal(globalThis.document.activeElement,ui.fields[name]);
  }
  for(const departure of ['external-focus','external-then-body','hidden-and-return','removed-origin','removed-section']) {
    ui.render(coding);ui.fields.select.focus();const pending=ui.click('select');ui.blur();
    if(departure.startsWith('external')) {ui.focusElsewhere();if(departure==='external-then-body')ui.blur();}
    if(departure==='hidden-and-return') {ui.controls.show(false);ui.controls.show(true);}
    if(departure==='removed-origin')ui.fields.select.isConnected=false;
    if(departure==='removed-section')ui.section.isConnected=false;
    const expected=globalThis.document.activeElement;
    resolve({coding});
    await pending;
    assert.equal(globalThis.document.activeElement,expected);
    ui.fields.select.isConnected=true;ui.section.isConnected=true;
  }
  ui.render(coding);ui.fields.authorize.focus();const revoking=ui.click('authorize');ui.blur();
  resolve({coding:{...coding,cloudExportAllowed:false,authorizationAvailable:false}});await revoking;
  assert.equal(globalThis.document.activeElement,globalThis.document.body,'a final disabled authorizer cannot regain focus');
  assert.equal(calls.length,15,'focus changes must never invoke another operation');
});

test('workspace operations tolerate document harnesses without focus APIs', async t => {
  const ui=harness(t,async()=>({coding:{configured:true,displayName:'project'}}));
  delete globalThis.document.activeElement;
  delete globalThis.document.addEventListener;
  delete globalThis.document.removeEventListener;
  ui.render();await ui.click('select');
  assert.equal(ui.fields.select.disabled,false);
});

test('project execution consent requires separate command consent and clears when commands are deselected', t => {
  const ui = harness(t); ui.render();
  assert.equal(ui.fields['project-code'].disabled, true);
  ui.change('command', true);
  assert.equal(ui.fields['project-code'].disabled, false);
  assert.equal(ui.fields['project-code'].checked, false, 'command consent never implies project consent');
  ui.change('project-code', true); ui.change('command', false);
  assert.equal(ui.fields['project-code'].disabled, true);
  assert.equal(ui.fields['project-code'].checked, false);
});

test('project consent describes only the validated registered command subset', t => {
  const ui = harness(t); ui.change('command', true);
  for (const [projectCommands, description] of [[['build'],'构建'],[['test'],'测试'],[['build','test'],'构建/测试']]) {
    ui.render({projectCommands}); ui.change('command', true);
    assert.match(ui.fields['project-status'].textContent, new RegExp(`项目${description}：可授权`));
    assert.match(ui.fields['project-label'].textContent, new RegExp(`执行项目${description}（`));
    assert.equal(ui.fields['project-code'].disabled, false);
    if (projectCommands.length === 1) {
      const absent = projectCommands[0] === 'build' ? '测试' : '构建';
      assert.equal(ui.fields['project-label'].textContent.includes(absent), false);
    }
  }
  for (const projectCommands of [[], undefined, ['build','build'], ['build','unknown'], ['build',,], 'build']) {
    ui.change('project-code', true);
    ui.render({projectCommands});
    assert.doesNotMatch(ui.fields['project-status'].textContent, /可授权/);
    assert.match(ui.fields['project-status'].textContent, /项目命令信息待读回/);
    assert.match(ui.fields['project-label'].textContent, /执行项目命令/);
    assert.equal(ui.fields['project-code'].disabled, false, 'the host availability boolean remains authoritative');
    assert.equal(ui.fields['project-code'].checked, true, 'missing command details cannot erase deliberate consent drafts');
  }
  ui.render({projectCommands: ['build'], projectScriptsAvailable: false});
  assert.equal(ui.fields['project-code'].disabled, true);
  assert.doesNotMatch(ui.fields['project-status'].textContent, /可授权/);
});

test('missing project command details do not change the existing authorization payload', async t => {
  const calls = [];
  const ui = harness(t, async (action, input) => {calls.push({action,input}); return {coding:{configured:true}};});
  for (const projectCommands of [undefined, [], ['build','unknown']]) {
    ui.render({projectCommands}); ui.change('cloud', true); ui.change('command', true); ui.change('project-code', true);
    await ui.click('authorize');
    assert.equal(calls.at(-1).input.projectCodeAllowed, true);
  }
  ui.render({projectCommands:['build'],projectScriptsAvailable:false});
  ui.change('cloud',true);ui.change('command',true);await ui.click('authorize');
  assert.equal(calls.at(-1).input.projectCodeAllowed, false);
});

test('only explicit selector cancellation preserves permission drafts', async t => {
  let result;
  const coding = {configured:true,displayName:'project',authorizationAvailable:true,
    projectScriptsAvailable:true,projectCommands:['build','test'],cloudExportAllowed:false};
  const ui = harness(t, async () => result);
  for (const action of ['select','select-node','select-file','select-npm']) {
    ui.render(coding);ui.change('cloud',true);ui.change('write',true);
    result={coding,codingSelectionCancelled:true};await ui.click(action);
    assert.equal(ui.fields.cloud.checked,true);assert.equal(ui.fields.write.checked,true);
    assert.match(ui.fields.status.textContent,/尚未生效/);
  }
  for (const flag of [undefined,false,'true']) {
    ui.render(coding);ui.change('cloud',true);ui.change('write',true);
    result={coding,codingSelectionCancelled:flag};await ui.click('select');
    assert.equal(ui.fields.cloud.checked,false,'same-name successful or legacy receipts retain existing clearing');
    assert.equal(ui.fields.write.checked,false);
  }
  for (const action of ['authorize','revoke']) {
    ui.render(coding);ui.change('cloud',true);ui.change('write',true);
    result={coding,codingSelectionCancelled:true};await ui.click(action);
    assert.equal(ui.fields.cloud.checked,false,'a cancellation flag cannot change authorization receipt semantics');
    assert.equal(ui.fields.write.checked,false);
  }
});

test('selector cancellation cannot revive drafts cleared by host revocation or configuration loss', async t => {
  let resolve;
  const ui=harness(t,()=>new Promise(done=>{resolve=done;}));
  for (const configured of [true,false]) {
    ui.render({cloudExportAllowed:true,writeAllowed:true});ui.change('write',false);ui.change('command',true);
    const pending=ui.click('select');
    const coding={configured,displayName:'project',cloudExportAllowed:false,writeAllowed:false,commandAllowed:false};
    ui.render(coding);resolve({coding,codingSelectionCancelled:true});await pending;
    assert.equal(ui.fields.command.checked,false);assert.equal(ui.fields.cloud.checked,false);
    assert.doesNotMatch(ui.fields.status.textContent,/尚未生效/);
  }
});

test('host readback projects current consent while preserving deliberate unsaved changes', t => {
  const ui = harness(t);
  ui.render({cloudExportAllowed: true, writeAllowed: true, commandAllowed: true, projectCodeAllowed: true});
  assert.equal(ui.fields.write.checked, true); assert.equal(ui.fields.command.checked, true);
  assert.equal(ui.fields['project-code'].checked, true);
  ui.change('write', false);
  ui.render({cloudExportAllowed: true, writeAllowed: true, commandAllowed: true, projectCodeAllowed: true});
  assert.equal(ui.fields.write.checked, false);
  ui.render({cloudExportAllowed: false, writeAllowed: false, commandAllowed: false, projectCodeAllowed: false});
  assert.equal(ui.fields.command.checked, false); assert.equal(ui.fields['project-code'].checked, false);
});

test('saved workspace awaiting trusted assembly cannot authorize or claim malformed host readback', async t => {
  const calls = [];
  const ui = harness(t, async (action, input) => {calls.push({action, input}); return {coding: []};});
  ui.render({authorizationAvailable: false}); ui.change('cloud', true);
  assert.equal(ui.fields.authorize.disabled, true);
  await ui.click('authorize'); assert.equal(calls.length, 0);
  ui.render(); ui.change('cloud', true); await ui.click('authorize');
  assert.equal(calls.length, 1); assert.match(ui.fields.status.textContent, /未获确认/);
});

test('workspace controls retain pending feedback across host snapshots and accept settled readback', async t => {
  let resolve;
  const ui = harness(t, () => new Promise(done => {resolve = done;}));
  ui.render({reason: 'saved host state'});
  const pending = ui.click('select');
  assert.match(ui.fields.status.textContent, /等待本机宿主/);
  ui.render({displayName: 'new host name', nodeConfigured: true, reason: 'background host state'});
  assert.equal(ui.fields.name.textContent, '当前工作区：new host name', 'host fields still refresh while waiting');
  assert.match(ui.fields['node-status'].textContent, /Node：已选择/);
  assert.match(ui.fields.status.textContent, /等待本机宿主/);
  assert.equal(ui.fields.select.disabled, true);
  assert.equal(ui.fields.revoke.disabled, true);
  resolve({coding: {configured: true, displayName: 'confirmed workspace', reason: 'confirmed selection'}});
  await pending;
  assert.equal(ui.fields.status.textContent, 'confirmed selection');
  assert.equal(ui.fields.select.disabled, false);
  ui.render({reason: 'fresh host state'});
  assert.equal(ui.fields.status.textContent, 'fresh host state');
});

test('workspace controls preserve unconfirmed feedback until explicit successful retry', async t => {
  let resolve, reject;
  const ui = harness(t, () => new Promise((done, fail) => {resolve = done; reject = fail;}));
  ui.render();
  const failed = ui.click('select');
  reject(Error('synthetic private host detail'));
  await failed;
  const failure = ui.fields.status.textContent;
  assert.match(failure, /操作未完成/);
  ui.render({displayName: 'updated host', reason: 'background success claim'});
  assert.equal(ui.fields.name.textContent, '当前工作区：updated host');
  assert.equal(ui.fields.status.textContent, failure);
  assert.doesNotMatch(ui.fields.status.textContent, /private|background success/);
  assert.equal(ui.fields.select.disabled, false);
  const retry = ui.click('select');
  assert.match(ui.fields.status.textContent, /等待本机宿主/);
  resolve({coding: []});
  await retry;
  assert.match(ui.fields.status.textContent, /结果未获确认/);
  ui.render({reason: 'another background success claim'});
  assert.match(ui.fields.status.textContent, /结果未获确认/);
  const confirmed = ui.click('select');
  resolve({coding: {configured: true, displayName: 'confirmed', reason: 'confirmed retry'}});
  await confirmed;
  assert.equal(ui.fields.status.textContent, 'confirmed retry');
  ui.render({reason: 'fresh host after retry'});
  assert.equal(ui.fields.status.textContent, 'fresh host after retry');
});

test('permission drafts explain unchanged host authority without invoking until explicit readback', async t => {
  const calls = [];
  let resolve;
  const ui = harness(t, (action, input) => {
    calls.push({action, input}); return new Promise(done => {resolve = done;});
  });
  const current = {cloudExportAllowed: true, writeAllowed: true, writeAvailable: true,
    reason: '当前工作区已授权'};
  ui.render(current);
  ui.change('write', false);
  assert.match(ui.fields.status.textContent, /权限选择尚未生效/);
  assert.match(ui.fields.status.textContent, /当前工作区已授权/);
  assert.match(ui.fields.capabilities.textContent, /写入：可用/);
  assert.equal(calls.length, 0);
  ui.render(current);
  assert.equal(ui.fields.write.checked, false);
  assert.match(ui.fields.status.textContent, /权限选择尚未生效/);
  ui.change('cloud', false);
  assert.equal(ui.fields.authorize.disabled, false);
  assert.match(ui.fields.status.textContent, /撤销授权/);
  assert.equal(calls.length, 0);
  ui.change('cloud', true);
  const pending = ui.click('authorize');
  assert.match(ui.fields.status.textContent, /等待本机宿主/);
  assert.doesNotMatch(ui.fields.status.textContent, /尚未生效/);
  ui.render(current);
  assert.match(ui.fields.status.textContent, /等待本机宿主/);
  resolve({coding: []}); await pending;
  ui.change('command', true); ui.render(current);
  assert.match(ui.fields.status.textContent, /未获确认/);
  assert.doesNotMatch(ui.fields.status.textContent, /尚未生效/);
  const retry = ui.click('authorize');
  resolve({coding: {configured: true, displayName: 'project', authorizationAvailable: true,
    cloudExportAllowed: true, writeAllowed: false, commandAllowed: true, reason: '更新授权已确认'}});
  await retry;
  assert.equal(ui.fields.status.textContent, '更新授权已确认');
  assert.equal(ui.fields.write.checked, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input.writeAllowed, false);
  ui.change('write', true);
  assert.match(ui.fields.status.textContent, /权限选择尚未生效/);
  assert.match(ui.fields.status.textContent, /更新授权已确认/);
  assert.equal(calls.length, 2);
});
