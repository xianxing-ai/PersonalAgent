import test from 'node:test';
import assert from 'node:assert/strict';
import {mountModelApiControls} from '../src/app/model-api-controls.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function fixture(t,invoke){
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const names=['defaultExecution','saved','provider','displayName','baseUrl','model','key','enabled','default',
    'reasoningConfirmed','capabilities','save','remove','status','nativeThinking','nativeEffort','outputTokenParameter'];
  const fields=Object.fromEntries(names.map(name=>[name,{value:'',checked:false,disabled:false,listeners:new Map(),
    addEventListener(type,listener){this.listeners.set(type,listener);},replaceChildren(){this.options=[];},
    append(option){this.options.push(option);}}]));
  const efforts=['none','minimal','low','medium','high','xhigh','max'].map(value=>({dataset:{modelEffort:value},checked:false,disabled:false,
    listeners:new Map(),addEventListener(type,listener){this.listeners.set(type,listener);}}));
  const controls=[...['saved','provider','displayName','baseUrl','model','key','enabled','default','reasoningConfirmed','save','remove',
    'nativeThinking','nativeEffort','outputTokenParameter']
    .map(name=>fields[name]),...efforts];
  const settings={attributes:new Map(),querySelector:selector=>fields[/data-model-api="([^"]+)"/.exec(selector)[1]],
    querySelectorAll:selector=>selector==='[data-model-effort]'?efforts:controls,
    setAttribute(name,value){this.attributes.set(name,value);},remove(){this.removed=true;}};
  let first=true;
  globalThis.document={createElement(){if(first){first=false;return settings;}return {value:'',textContent:''};}};
  const ui=mountModelApiControls({append(){}},invoke);
  return {fields,efforts,controls,settings,ui,save:()=>fields.save.onclick(),remove:()=>fields.remove.onclick()};
}

function model(){return {id:'synthetic',provider:'openai-compatible',displayName:'Synthetic',baseUrl:'https://synthetic.invalid/v1',
  model:'synthetic-model',configurationRef:'synthetic-ref',enabled:true,available:true,reasoningEfforts:['low']};}

test('native controls restore and submit the exact configuration, then invalidate it on destination edits',async t=>{
  const calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload:structuredClone(payload)});return {models:[]};});
  const nativeReasoning={thinking:'enabled',effort:'max',supportedEfforts:['low','max'],outputTokenParameter:'max_completion_tokens'};
  f.ui.render({models:[{...model(),reasoningEfforts:[],nativeReasoning}]});
  f.fields.saved.value='synthetic';f.fields.saved.onchange();
  assert.equal(f.fields.nativeThinking.value,'enabled');assert.equal(f.fields.nativeEffort.value,'max');
  assert.equal(f.fields.outputTokenParameter.value,'max_completion_tokens');
  assert.equal(f.fields.reasoningConfirmed.checked,true);
  await f.save();
  assert.deepEqual(calls[0].payload.nativeReasoning,nativeReasoning);
  assert.deepEqual(calls[0].payload.reasoningEfforts,[]);
  f.ui.render({models:[{...model(),reasoningEfforts:[],nativeReasoning}]});
  f.fields.saved.value='synthetic';f.fields.saved.onchange();
  f.fields.nativeEffort.listeners.get('input')();assert.equal(f.fields.reasoningConfirmed.checked,false);
  f.fields.baseUrl.listeners.get('input')();
  assert.equal(f.fields.nativeThinking.value,'');assert.equal(f.fields.nativeEffort.value,'');
  assert.equal(f.fields.outputTokenParameter.value,'max_tokens');
  assert.ok(f.efforts.every(input=>!input.checked));
});

test('pending model save disables every parameter and repeated save/remove callbacks cannot submit another request',async t=>{
  const pending=deferred(),calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload});return pending.promise;});
  f.ui.render({models:[model()],defaultId:'synthetic'});f.fields.saved.value='synthetic';f.fields.saved.onchange();
  f.fields.key.value='synthetic-secret';const saving=f.save();
  assert.equal(f.fields.key.value,'');
  for(const control of f.controls)assert.equal(control.disabled,true);
  assert.equal(f.settings.attributes.get('aria-busy'),'true');
  const repeated=f.save(),removing=f.remove();assert.equal(calls.length,1);
  assert.equal(calls[0].payload.expectedConfigurationRef,'synthetic-ref');
  assert.equal(calls[0].payload.apiKey,'synthetic-secret');
  pending.resolve({models:[model()],defaultId:'synthetic'});await Promise.all([saving,repeated,removing]);
  for(const control of f.controls)assert.equal(control.disabled,false);
  assert.equal(f.settings.attributes.get('aria-busy'),'false');
  assert.equal(calls[0].payload.apiKey,'');
});

test('save failure preserves non-secret draft fields and restores input without retrying',async t=>{
  const pending=deferred();let calls=0;
  const f=fixture(t,()=>{calls++;return pending.promise;});
  f.fields.displayName.value='Draft';f.fields.baseUrl.value='https://synthetic.invalid/v1';f.fields.model.value='draft-model';
  f.fields.key.value='synthetic-secret';const saving=f.save();pending.reject(Error('synthetic storage error'));await saving;
  assert.equal(f.fields.displayName.value,'Draft');assert.equal(f.fields.model.value,'draft-model');
  assert.equal(f.fields.baseUrl.value,'https://synthetic.invalid/v1');assert.equal(f.fields.key.value,'');
  assert.equal(f.fields.save.disabled,false);assert.equal(f.fields.key.disabled,false);
  assert.equal(f.fields.remove.disabled,true,'an unsaved model cannot be removed');
  assert.match(f.fields.status.textContent,/配置操作未完成/);assert.equal(calls,1);
});

test('model removal shares the same form lock and restores the add-model state',async t=>{
  const pending=deferred(),calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload});return pending.promise;});
  f.ui.render({models:[model()]});f.fields.saved.value='synthetic';f.fields.saved.onchange();const removing=f.remove();
  for(const control of f.controls)assert.equal(control.disabled,true);
  const saving=f.save();assert.deepEqual(calls,[{operation:'modelApi.remove',payload:{id:'synthetic'}}]);
  pending.resolve({models:[]});await Promise.all([removing,saving]);
  assert.equal(f.fields.saved.value,'');assert.equal(f.fields.remove.disabled,true);assert.equal(f.fields.save.disabled,false);
});

test('closed model controls ignore queued actions and late readback while clearing submitted secrets',async t=>{
  const pending=deferred();let calls=0,payload;
  const f=fixture(t,(_operation,input)=>{calls++;payload=input;return pending.promise;});
  f.fields.key.value='synthetic-secret';const saving=f.save();f.ui.close();
  const queuedSaving=f.save(),queuedRemoving=f.remove();assert.equal(calls,1);
  pending.resolve({models:[model()]});await Promise.all([saving,queuedSaving,queuedRemoving]);
  assert.equal(f.settings.removed,true);assert.equal(f.fields.saved.value,'');assert.equal(payload.apiKey,'');
});
