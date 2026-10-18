import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReferenceToolsControls} from '../src/app/reference-tools-controls.js';

function harness(t,invoke) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const fields=Object.fromEntries(['state','result','path','mcp','skill','run'].map(name=>[name,
    {textContent:'',value:name==='path'?'reference.md':'',disabled:false,dataset:{reference:name}}]));
  const listeners=new Map();
  const host={isConnected:true,hidden:false,
    addEventListener:(event,handler)=>listeners.set(event,handler),
    querySelector(selector){
      const action=/\[data-reference="([^"]+)"\]/u.exec(selector)?.[1];
      return fields[action??/\[data-reference-([^\]]+)\]/u.exec(selector)?.[1]];
    }};
  globalThis.document={createElement:()=>host};
  const controls=mountReferenceToolsControls({append(){}},invoke);
  const render=state=>controls.render({mcp:{connected:state==='ready',state:state==='ready'?'connected':'unavailable'},
    skill:{health:{enabled:state==='ready',state}}});
  return {controls,fields,host,render,click:action=>listeners.get('click')({target:{closest:()=>fields[action]}})};
}

test('reference run stays pending across snapshots and a late receipt respects stopped service',async t=>{
  const calls=[];let resolve;
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise(done=>{resolve=done;});});
  ui.render('ready');const pending=ui.click('run');
  ui.render('ready');assert.equal(ui.fields.run.disabled,true);
  await ui.click('run');assert.equal(calls.length,1,'a refreshed pending action cannot submit another task');
  ui.render('disabled');resolve({taskId:'accepted-original'});await pending;
  assert.equal(ui.fields.run.disabled,true);
  await ui.click('run');assert.equal(calls.length,1,'an unavailable Skill cannot submit a task');
  ui.render('ready');assert.equal(ui.fields.run.disabled,false);
  const fresh=ui.click('run');assert.equal(calls.length,2);
  resolve({taskId:'fresh-task'});await fresh;
  assert.equal(ui.fields.run.disabled,false);assert.match(ui.fields.result.textContent,/fresh-task/);
  assert.deepEqual(calls.map(call=>call.input),[{path:'reference.md'},{path:'reference.md'}]);
});

test('reference failures unlock available actions and detached late responses leave controls inactive',async t=>{
  const calls=[];let resolve,reject;
  const ui=harness(t,action=>{calls.push(action);return new Promise((done,fail)=>{resolve=done;reject=fail;});});
  ui.render('ready');const pending=ui.click('run');ui.render('ready');reject(Error('synthetic-only'));await pending;
  assert.equal(ui.fields.run.disabled,false);assert.match(ui.fields.result.textContent,/操作未完成/);
  const next=ui.click('run');ui.host.isConnected=false;resolve({taskId:'late-detached'});await next;
  assert.equal(ui.fields.run.disabled,true);assert.equal(ui.fields.result.textContent,'');
  await ui.click('run');assert.equal(calls.length,2);
});

test('reference Skill enables only after connection and late receipts keep stopped controls disabled',async t=>{
  const calls=[];let resolve;
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise(done=>{resolve=done;});});
  const render=(connected,enabled)=>ui.controls.render({mcp:{connected,state:connected?'connected':'unavailable'},
    skill:{health:{enabled,state:enabled?'ready':'disabled'}}});
  assert.equal(ui.fields.skill.disabled,true,'an initial unavailable service cannot enable the Skill');
  render(false,false);await ui.click('skill');assert.equal(calls.length,0);
  render(true,false);assert.equal(ui.fields.skill.disabled,false);
  const enabling=ui.click('skill');render(true,false);assert.equal(ui.fields.skill.disabled,true);
  await ui.click('skill');assert.equal(calls.length,1,'pending snapshots cannot submit a second enable');
  render(false,false);resolve({});await enabling;
  assert.equal(ui.fields.skill.disabled,true,'a late enable receipt cannot revive a stopped service');
  render(false,true);assert.equal(ui.fields.skill.disabled,false,'an enabled Skill can still be stopped after disconnection');
  const disabling=ui.click('skill');render(false,false);resolve({});await disabling;
  assert.equal(ui.fields.skill.disabled,true);
  assert.deepEqual(calls,[{action:'reference.skill',input:{enabled:true}},
    {action:'reference.skill',input:{enabled:false}}]);
});

test('reference Skill failures restore an available action but disconnected and detached actions stay disabled',async t=>{
  const calls=[];let resolve,reject;
  const ui=harness(t,action=>{calls.push(action);return new Promise((done,fail)=>{resolve=done;reject=fail;});});
  const render=connected=>ui.controls.render({mcp:{connected,state:connected?'connected':'unavailable'},
    skill:{health:{enabled:false,state:'disabled'}}});
  render(true);const failing=ui.click('skill');reject(Error('synthetic-only'));await failing;
  assert.equal(ui.fields.skill.disabled,false);assert.match(ui.fields.result.textContent,/操作未完成/);
  const disconnected=ui.click('skill');render(false);reject(Error('synthetic-only'));await disconnected;
  assert.equal(ui.fields.skill.disabled,true,'failure must respect a newer disconnected snapshot');
  await ui.click('skill');assert.equal(calls.length,2);
  render(true);const detached=ui.click('skill');ui.host.isConnected=false;resolve({});await detached;
  assert.equal(ui.fields.skill.disabled,true);assert.equal(ui.fields.result.textContent,'');
  await ui.click('skill');assert.equal(calls.length,3);
});

test('reference stop receipt pending blocks new summary runs across stale snapshots',async t=>{
  const calls=[];let resolve;
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise(done=>{resolve=done;});});
  ui.render('ready');const stopping=ui.click('mcp');
  assert.equal(ui.fields.run.disabled,true,'stopping service must make the summary unavailable before its next snapshot');
  ui.render('ready');await ui.click('run');assert.equal(calls.length,1,'a stale ready snapshot cannot submit a summary while stop is pending');
  ui.render('disabled');resolve({});await stopping;assert.equal(ui.fields.run.disabled,true);
  assert.deepEqual(calls,[{action:'reference.mcp',input:{enabled:false}}]);
});

test('reference Skill changes pause summary runs but failure restores ready service and run never blocks stop',async t=>{
  const calls=[];let resolve,reject;
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise((done,fail)=>{resolve=done;reject=fail;});});
  ui.render('ready');const changing=ui.click('skill');
  assert.equal(ui.fields.run.disabled,true,'pending Skill transition must stop new summary submission');
  ui.render('ready');await ui.click('run');assert.equal(calls.length,1);
  reject(Error('synthetic Skill transition failed'));await changing;assert.equal(ui.fields.run.disabled,false);
  const running=ui.click('run');assert.equal(ui.fields.mcp.disabled,false,'an in-flight read cannot block the user stop action');
  const runResolve=resolve;const stopping=ui.click('mcp');assert.equal(calls.length,3);ui.render('disabled');resolve({});await stopping;
  runResolve({taskId:'accepted-original'});await running;assert.equal(ui.fields.run.disabled,true);
});
