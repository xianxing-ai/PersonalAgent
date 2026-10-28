import test from 'node:test';
import assert from 'node:assert/strict';
import {mountGoalCloudControls} from '../src/app/goal-cloud-controls.js';
import {createGoalHost} from '../electron/goal-host.js';
import {createDesktopGoalCloudHost} from '../electron/goal-cloud-host.js';

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function fixture(t,invoke) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const fields=Object.fromEntries(['open','disable','status'].map(key=>[key,{
    disabled:false,textContent:'',attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value);},
  }]));
  const section={setAttribute(){},querySelector(selector){return fields[/data-goal-cloud="([^"]+)"/.exec(selector)[1]];}};
  globalThis.document={createElement:()=>section};
  const host=createDesktopGoalCloudHost({goalHost:createGoalHost('synthetic-cloud-ui'),namespace:'synthetic-cloud-ui'});
  host.bindApplication({profile:'huawei_ict_agentarts',runtime:{}});
  const calls=[];
  const controls=mountGoalCloudControls({append(){}},async(name,payload)=>{calls.push({name,payload});return invoke(name,payload,host);});
  controls.render(host.snapshot());
  const grant=()=>controls.render(host.authorize({goalCloudConsent:true}));
  return {controls,host,fields,calls,grant,section};
}

test('settings opens the existing conversation instead of requesting the removed session grant',async t=>{
  const ui=fixture(t,async()=>({opened:true}));
  assert.doesNotMatch(ui.section.innerHTML,/goal-cloud="enable"|goalCloud\.authorize/);
  await ui.fields.open.onclick();
  assert.deepEqual(ui.calls,[{name:'conversation.open',payload:undefined}]);
  assert.equal(ui.fields.disable.disabled,true);
});

test('lost revoke reply remains unknown and allows a deliberate retry of revocation',async t=>{
  const ui=fixture(t,async(_name,_payload,host)=>{host.revoke();throw Error('private synthetic transport detail');});
  ui.grant();await ui.fields.disable.onclick();
  assert.equal(ui.host.snapshot().sessionAllowed,false);
  assert.match(ui.fields.status.textContent,/撤销结果未获确认/);
  assert.doesNotMatch(ui.fields.status.textContent,/private/);
  assert.equal(ui.fields.status.attributes.get('role'),'alert');
  assert.equal(ui.fields.disable.disabled,false);
  ui.controls.render(ui.host.snapshot());
  assert.equal(ui.fields.disable.disabled,true);
  assert.equal(ui.fields.status.attributes.get('role'),'status');
});

test('a newer host publication wins over a failed or stale revoke reply',async t=>{
  const reply=deferred(),ui=fixture(t,()=>reply.promise);
  ui.grant();const revocation=ui.fields.disable.onclick();
  const revoked=ui.host.revoke();ui.controls.render(revoked);
  reply.reject(Error('synthetic late failure'));await revocation;
  assert.equal(ui.fields.status.textContent,revoked.reason);
  assert.equal(ui.fields.disable.disabled,true);
});

test('an unchanged publication cannot hide a lost revoke reply',async t=>{
  const reply=deferred(),ui=fixture(t,()=>reply.promise);
  ui.grant();const revocation=ui.fields.disable.onclick();
  ui.controls.render(ui.host.snapshot()); // A publication before the host has revoked anything.
  reply.reject(Error('synthetic lost reply'));await revocation;
  assert.match(ui.fields.status.textContent,/撤销结果未获确认/);
  assert.equal(ui.fields.disable.disabled,false);
  assert.equal(ui.fields.status.attributes.get('role'),'alert');
});

test('an unchanged publication cannot make an invalid revoke reply look confirmed',async t=>{
  const reply=deferred(),ui=fixture(t,()=>reply.promise);
  ui.grant();const revocation=ui.fields.disable.onclick();
  ui.controls.render(ui.host.snapshot());
  reply.resolve({});await revocation;
  assert.match(ui.fields.status.textContent,/撤销结果未获确认/);
  assert.equal(ui.fields.disable.disabled,false);
});

test('invalid revoke replies do not claim that permission was removed',async t=>{
  let result;const ui=fixture(t,()=>result);ui.grant();
  for(result of [undefined,{}, {available:false,sessionAllowed:true,reason:'invalid'},ui.host.snapshot()]) {
    await ui.fields.disable.onclick();
    assert.match(ui.fields.status.textContent,/撤销结果未获确认/);
    assert.equal(ui.fields.disable.disabled,false);
  }
});

test('an in-flight revoke cannot be submitted twice',async t=>{
  const reply=deferred(),ui=fixture(t,()=>reply.promise);ui.grant();
  const first=ui.fields.disable.onclick();await ui.fields.disable.onclick();
  assert.equal(ui.calls.length,1);
  reply.resolve(ui.host.revoke());await first;
  assert.equal(ui.fields.disable.disabled,true);
});
