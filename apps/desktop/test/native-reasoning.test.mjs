import test from 'node:test';
import assert from 'node:assert/strict';
import {mountNativeReasoning,nativeReasoningState} from '../src/features/conversation/native-reasoning.js';
const revision='a'.repeat(64);
const selection=(modelId='a',reasoningEffort='high')=>({catalogRevision:revision,modelId,...(reasoningEffort?{reasoningEffort}:{})});
const snapshot=(preference={modelId:'a',executionModel:selection()},activeId='desktop-panel')=>({
  conversationState:{activeId},conversationPreference:{depth:0,fast:true,...preference},
  modelChoices:[{id:'a',displayName:'A',available:true},{id:'b',displayName:'B',available:true},{id:'default-only',displayName:'Default only',available:true}],
  agentArtsModels:{catalog:{revision,defaultModelId:'a',models:[
    {id:'a',displayName:'A',type:'text',reasoningEfforts:['high','low','medium'],availability:'unverified'},
    {id:'b',displayName:'B',type:'text',reasoningEfforts:['max'],availability:'unverified'},
    {id:'default-only',type:'text',reasoningEfforts:[],availability:'unverified'},
    {id:'off',type:'text',reasoningEfforts:['high'],available:false},
  ]},preferences:{catalogRevision:revision,defaultModelId:'b',reasoningEffort:'max'}},
});
const tick=()=>new Promise(setImmediate);
function fixture(t){
  class Element{
    constructor(){this.children=[];this.attrs={};this.value='';this.style={setProperty(){}};}
    append(...elements){this.children.push(...elements);}
    setAttribute(key,value){this.attrs[key]=value;}
  }
  const prior=globalThis.document;globalThis.document={createElement:tag=>{assert.notEqual(tag,'select');return new Element();}};
  t.after(()=>{globalThis.document=prior;});
  const root=new Element(),slider=new Element(),output=new Element(),modelChoice=new Element(),modelOutput=new Element(),calls=[],errors=[];
  let revision=0,cleared=0;
  const control=mountNativeReasoning(root,(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject})),error=>{errors.push(error.message);revision++;},
    {slider,output,modelChoice,modelOutput,readFeedbackRevision:()=>revision,clearFeedback:()=>{cleared++;revision++;}});
  control.update(snapshot());
  return {control,slider,output,modelChoice,modelOutput,status:root.children[0],calls,errors,
    drag(value){slider.value=String(value);return slider.oninput();},
    model(value){modelChoice.value=String(value);return modelChoice.oninput();},
    newerError(){revision++;},cleared:()=>cleared};
}
test('legal catalog enums drive native range and Chinese label independently from step budget and Fast',async t=>{
  const f=fixture(t);assert.equal(f.slider.max,'3');assert.equal(f.slider.value,'3');assert.equal(f.output.textContent,'高');
  assert.deepEqual(nativeReasoningState(snapshot()).efforts,['low','medium','high']);
  const pending=f.drag(1);assert.equal(f.output.textContent,'低');assert.deepEqual(f.calls[0].payload,{conversationId:'desktop-panel',executionModel:selection('a','low')});
  f.calls[0].resolve({modelId:'a',executionModel:selection('a','low'),depth:0,fast:true});await pending;
  f.control.update(snapshot());assert.equal(f.slider.value,'1','late pre-save snapshot cannot replace acknowledgement');
  f.control.update(snapshot({modelId:'a',executionModel:selection('a','low')}));assert.equal(f.output.textContent,'低');
});
test('provider default omits effort and an explicit provider default never inherits global max',async t=>{
  const f=fixture(t);f.control.update(snapshot({}));assert.equal(f.output.textContent,'最高');assert.equal(f.slider.max,'1');
  f.control.update(snapshot({executionModel:selection('a','')}));assert.equal(f.output.textContent,'供应商默认');assert.equal(f.slider.value,'0');
  const pending=f.drag(0);assert.deepEqual(f.calls[0].payload.executionModel,selection('a',''));f.calls[0].resolve();await pending;
});
test('unsupported, unavailable and stale models disable native adjustment with no request',t=>{
  const f=fixture(t);
  for(const preference of [{modelId:'default-only'},{modelId:'missing'},{modelId:'off'},{executionModel:{...selection(),catalogRevision:'b'.repeat(64)}}]){
    f.control.update(snapshot(preference));assert.equal(f.slider.disabled,true);f.drag(1);
  }
  assert.equal(f.calls.length,0);assert.match(f.slider.title,/目录已改变/);
});
test('rapid input serializes and coalesces writes; old errors and snapshots never replace the latest choice',async t=>{
  const f=fixture(t),pending=f.drag(1);f.drag(2);f.drag(3);assert.equal(f.calls.length,1);
  f.control.update(snapshot());assert.equal(f.output.textContent,'高');assert.equal(f.slider.attrs['aria-busy'],'true');
  f.calls[0].reject(Error('old'));await tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.executionModel.reasoningEffort,'high');assert.deepEqual(f.errors,[]);
  f.calls[1].resolve();await pending;await f.control.flush();assert.equal(f.slider.attrs['aria-busy'],'false');
});
test('latest save failure restores confirmed choice, blocks sending and explicit retry clears only its own error',async t=>{
  for(const newer of [false,true]){
    const f=fixture(t),pending=f.drag(1),flush=f.control.flush();f.calls[0].reject(Error('disk failed'));await pending;await assert.rejects(flush,/未保存/);
    assert.equal(f.output.textContent,'高');assert.deepEqual(f.errors,['disk failed']);const retry=f.drag(2);if(newer)f.newerError();f.calls[1].resolve();await retry;await f.control.flush();
    assert.equal(f.output.textContent,'平衡');assert.equal(f.cleared(),newer?0:1);
  }
});
test('model range and native range share a writer and use the new model own enums/default',async t=>{
  const f=fixture(t),pending=f.drag(1);f.model(2);assert.equal(f.modelOutput.textContent,'B');assert.equal(f.slider.max,'1');assert.equal(f.output.textContent,'供应商默认');
  f.drag(1);f.calls[0].resolve();await tick();assert.deepEqual(f.calls[1].payload.executionModel,selection('b','max'));f.calls[1].resolve();await pending;
  assert.equal(f.modelChoice.value,'2');assert.equal(f.output.textContent,'最高');
  const defaults=f.model(0);assert.equal(f.modelOutput.textContent,'默认 · B');f.calls[2].resolve();await defaults;assert.deepEqual(f.calls[2].payload,{modelId:'',conversationId:'desktop-panel'});
});
test('current model failure restores both sliders and current native value',async t=>{
  const f=fixture(t),pending=f.model(2);assert.equal(f.slider.max,'1');f.calls[0].reject(Error('model failed'));await pending;
  assert.equal(f.modelChoice.value,'1');assert.equal(f.modelOutput.textContent,'A');assert.equal(f.output.textContent,'高');assert.equal(f.slider.max,'3');
});
test('session switch discards queued old intent and late errors, and flush rejects the changed owner',async t=>{
  const f=fixture(t),pending=f.drag(1);f.drag(2);const flush=f.control.flush();
  f.control.update(snapshot({modelId:'b'},'desktop-panel:other'));f.calls[0].reject(Error('old owner'));await pending;await assert.rejects(flush,/已切换/);
  assert.equal(f.calls.length,1);assert.deepEqual(f.errors,[]);assert.equal(f.modelChoice.value,'2');assert.equal(f.output.textContent,'供应商默认');
  const next=f.drag(1);assert.equal(f.calls[1].payload.conversationId,'desktop-panel:other');f.calls[1].resolve();await next;
});
test('catalog replacement invalidates old binding until an explicit model choice',async t=>{
  const f=fixture(t),pending=f.drag(1),changed=snapshot();changed.agentArtsModels.catalog.revision='b'.repeat(64);f.control.update(changed);
  f.calls[0].resolve();await pending;assert.equal(f.slider.disabled,true);assert.equal(f.output.textContent,'不可用');
  const next=f.model(2);f.calls[1].resolve();await next;assert.equal(f.slider.disabled,false);assert.equal(f.output.textContent,'供应商默认');
});
