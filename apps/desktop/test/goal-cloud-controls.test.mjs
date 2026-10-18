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
  t.after(()=>{if(original) Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const fields=Object.fromEntries(['consent','enable','disable','status'].map(key=>[key,{
    checked:false,disabled:false,textContent:'',attributes:new Map(),
    setAttribute(name,value){this.attributes.set(name,value);},
  }]));
  const section={setAttribute(){},querySelector(selector){return fields[/data-goal-cloud="([^"]+)"/.exec(selector)[1]];}};
  globalThis.document={createElement:()=>section};
  // Real public Goal host/tool composition, with an explicit Fake application.
  // These tests change only the cloud session grant, never Runtime data or cloud.
  const host=createDesktopGoalCloudHost({goalHost:createGoalHost('synthetic-cloud-ui'),namespace:'synthetic-cloud-ui'});
  host.bindApplication({profile:'huawei_ict_agentarts',runtime:{}});
  const calls=[];
  const controls=mountGoalCloudControls({append(){}},async(name,payload)=>{
    calls.push({name,payload});
    return invoke(name,payload,host);
  });
  controls.render(host.snapshot());
  const consent=()=>{fields.consent.checked=true;fields.consent.onchange();};
  return {controls,host,fields,calls,consent};
}

test('accepted grant with a lost Fake IPC reply stays unknown, blocks repeated authorization, and permits explicit revoke',async t=>{
  const ui=fixture(t,async(name,payload,host)=>{
    if(name==='goalCloud.authorize'){host.authorize(payload);throw Error('private synthetic transport detail');}
    return host.revoke();
  });
  ui.consent();await ui.fields.enable.onclick();
  assert.equal(ui.host.snapshot().sessionAllowed,true);
  assert.match(ui.fields.status.textContent,/结果未获确认/);
  assert.doesNotMatch(ui.fields.status.textContent,/未生效|private/);
  assert.equal(ui.fields.status.attributes.get('role'),'alert');
  assert.equal(ui.fields.enable.disabled,true);
  assert.equal(ui.fields.disable.disabled,false);
  await ui.fields.enable.onclick();
  assert.equal(ui.calls.length,1);
  await ui.fields.disable.onclick();
  assert.equal(ui.host.snapshot().sessionAllowed,false);
  assert.equal(ui.fields.disable.disabled,true);
  assert.equal(ui.fields.enable.disabled,false);
  assert.equal(ui.fields.status.attributes.get('role'),'status');
});

test('lost revoke reply never claims the permission remains active or allows reauthorization before readback',async t=>{
  const ui=fixture(t,async(name,payload,host)=>{
    if(name==='goalCloud.authorize') return host.authorize(payload);
    host.revoke();throw Error('synthetic revoke reply lost');
  });
  ui.consent();await ui.fields.enable.onclick();
  await ui.fields.disable.onclick();
  assert.equal(ui.host.snapshot().sessionAllowed,false);
  assert.match(ui.fields.status.textContent,/结果未获确认/);
  assert.equal(ui.fields.enable.disabled,true);
  assert.equal(ui.fields.disable.disabled,false);
  ui.controls.render(undefined);
  ui.controls.render({});
  assert.match(ui.fields.status.textContent,/结果未获确认/);
  assert.equal(ui.fields.enable.disabled,true);
  ui.controls.render(ui.host.snapshot());
  assert.doesNotMatch(ui.fields.status.textContent,/结果未获确认/);
  assert.equal(ui.fields.disable.disabled,true);
  assert.equal(ui.fields.consent.checked,false);
});

test('host publication before the authorize or revoke reply confirms state even when that reply fails',async t=>{
  const replies=[deferred(),deferred()];
  let index=0;
  const ui=fixture(t,()=>replies[index++].promise);
  ui.consent();
  const authorization=ui.fields.enable.onclick();
  ui.controls.render(ui.host.authorize({goalCloudConsent:true}));
  assert.equal(ui.fields.enable.disabled,true);
  assert.equal(ui.fields.disable.disabled,true);
  replies[0].reject(Error('synthetic late authorize failure'));
  await authorization;
  assert.equal(ui.fields.status.textContent,ui.host.snapshot().reason);
  assert.equal(ui.fields.disable.disabled,false);
  const revocation=ui.fields.disable.onclick();
  ui.controls.render(ui.host.revoke());
  replies[1].reject(Error('synthetic late revoke failure'));
  await revocation;
  assert.equal(ui.fields.status.textContent,ui.host.snapshot().reason);
  assert.equal(ui.fields.disable.disabled,true);
});

test('an older successful grant reply cannot replace a newer revoked host snapshot',async t=>{
  const reply=deferred();
  const ui=fixture(t,()=>reply.promise);
  ui.consent();
  const authorization=ui.fields.enable.onclick();
  const oldGrant=ui.host.authorize({goalCloudConsent:true});
  ui.controls.render(oldGrant);
  const revoked=ui.host.revoke();ui.controls.render(revoked);
  reply.resolve(oldGrant);await authorization;
  assert.equal(ui.fields.status.textContent,revoked.reason);
  assert.equal(ui.fields.disable.disabled,true);
  assert.equal(ui.fields.consent.checked,false);
  assert.equal(ui.fields.enable.disabled,true);
  assert.equal(ui.host.snapshot().sessionAllowed,false);
});

test('operation replies must confirm the requested permission using a legal host snapshot',async t=>{
  let response;
  const ui=fixture(t,()=>response);
  for(response of [undefined,{}, {available:true,sessionAllowed:false,reason:'synthetic authorize mismatch'},
    {available:false,sessionAllowed:true,reason:'synthetic impossible grant'}]) {
    ui.controls.render(ui.host.snapshot());ui.consent();
    await ui.fields.enable.onclick();
    assert.match(ui.fields.status.textContent,/结果未获确认/);
    assert.equal(ui.fields.enable.disabled,true);
    assert.equal(ui.fields.disable.disabled,false);
  }
  ui.controls.render(ui.host.snapshot());ui.consent();
  response=ui.host.authorize({goalCloudConsent:true});
  await ui.fields.enable.onclick();
  response=ui.host.snapshot();
  await ui.fields.disable.onclick();
  assert.match(ui.fields.status.textContent,/结果未获确认/);
  assert.equal(ui.fields.enable.disabled,true);
});

test('pending operation prevents another invoke and does not accept invalid publication as confirmation',async t=>{
  const reply=deferred();
  const ui=fixture(t,()=>reply.promise);
  ui.consent();
  const operation=ui.fields.enable.onclick();
  await ui.fields.enable.onclick();await ui.fields.disable.onclick();
  assert.equal(ui.calls.length,1);
  ui.controls.render({});
  reply.reject(Error('synthetic failed operation'));await operation;
  assert.match(ui.fields.status.textContent,/结果未获确认/);
  assert.equal(ui.fields.enable.disabled,true);
});
