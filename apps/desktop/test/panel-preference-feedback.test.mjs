import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=[],projection=[];
function visit(node){
  if(ts.isStatement(node)){
    const text=node.getText(ast);
    if(/^(const syncSlider=|const panelPreferenceRequests=|const syncPanelPreferenceBusy=|const projectPanelPreferences=|const requestPanelPreference=|modelChoice\.onchange=|slider\.addEventListener\('input'|fastBtn\.onclick=)/.test(text))declarations.push(text);
    if(node.pos>source.indexOf('render=(data,')&&(text.startsWith('const nextModelChoiceSignature=')||text.startsWith('if(modelChoiceSignature!==nextModelChoiceSignature)')||text==='projectPanelPreferences();'))projection.push(text);
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(declarations.length,8);
assert.equal(projection.length,3);
const observed=(modelId='fake-A',depth=1,fast=false)=>({conversationPreference:{modelId,depth,fast},thinking:{depth,fast},modelChoices:[{id:'fake-A',displayName:'Fake A',available:true},{id:'fake-B',displayName:'Fake B',available:true}]});
function fixture(){
  const control=value=>({value,attrs:{},handlers:{},style:{setProperty(name,value){this[name]=value;}},setAttribute(name,value){this.attrs[name]=value;},getAttribute(name){return this.attrs[name];},addEventListener(name,handler){this.handlers[name]=handler;},replaceChildren(...options){this.options=options;}});
  const modelChoice=control(''),slider=control('1'),fastBtn=control(''),depthLabel={},classes=new Map(),calls=[];
  const context=vm.createContext({nativeReasoning:{setBusy(){}},modelChoice,slider,fastBtn,depthLabel,modelMenu:{classList:{toggle(name,value){classes.set(name,value);}}},current:observed(),modelChoiceSignature:undefined,errorFeedbackRevision:0,hostFeedback:'',hostFeedbackRevision:-1,
    Option:function(text,value){this.text=text;this.value=value;},invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
  vm.runInContext("let feedback='';const setFeedback=value=>{errorFeedbackRevision++;feedback=value;};const report=error=>setFeedback(typeof error==='string'?error:error.message);",context);
  vm.runInContext(declarations.join('\n'),context);
  const update=vm.runInContext(`data=>{current=data;${projection.join('\n')}}`,context);update(observed());
  return {context,modelChoice,slider,fastBtn,depthLabel,classes,calls,update,error:()=>vm.runInContext('feedback',context),report:vm.runInContext('report',context)};
}
const pair=f=>[f.slider.value,f.fastBtn.attrs['aria-pressed']];
const payload=call=>JSON.parse(JSON.stringify(call.payload));

test('current model and thinking failures restore observed values without extra IPC',async()=>{
  const f=fixture();f.modelChoice.value='fake-B';const model=f.modelChoice.onchange();assert.equal(f.modelChoice.attrs['aria-busy'],'true');f.calls[0].reject(Error('Fake model failure'));await model;assert.equal(f.modelChoice.value,'fake-A');
  f.slider.value='5';const thinking=f.slider.handlers.input();assert.equal(f.depthLabel.textContent,'最高');assert.equal(f.classes.get('maxed'),true);f.calls[1].reject(Error('Fake thinking failure'));await thinking;
  assert.deepEqual(pair(f),['1','false']);assert.equal(f.depthLabel.textContent,'低');assert.equal(f.classes.get('maxed'),false);assert.equal(f.slider.attrs['aria-busy'],'false');assert.equal(f.error(),'Fake thinking failure');assert.deepEqual(f.calls.map(c=>c.name),['conversation.model','thinking.update']);assert.deepEqual(payload(f.calls[1]),{depth:5,fast:false});
});
test('ordinary snapshots preserve pending model and full thinking intent and visual state',async()=>{
  const f=fixture();f.modelChoice.value='fake-B';const model=f.modelChoice.onchange();f.slider.value='5';const thinking=f.slider.handlers.input();f.update(observed());
  assert.equal(f.modelChoice.value,'fake-B');assert.deepEqual(pair(f),['5','false']);assert.equal(f.depthLabel.textContent,'最高');assert.equal(f.slider.style['--fill'],'94%');assert.equal(f.classes.get('maxed'),true);assert.equal(f.slider.attrs['aria-busy'],'true');assert.equal(f.calls.length,2);
  f.update(observed('fake-B',5));f.calls[0].resolve();f.calls[1].resolve();await Promise.all([model,thinking]);f.update(observed('fake-B',5));assert.equal(f.modelChoice.attrs['aria-busy'],'false');assert.deepEqual(pair(f),['5','false']);
});
test('older model rejection cannot roll back newer pending or successful model selection',async()=>{
  for(const accepted of [false,true]){const f=fixture();f.modelChoice.value='fake-B';const old=f.modelChoice.onchange();f.modelChoice.value='';const next=f.modelChoice.onchange();if(accepted){f.update(observed(''));f.calls[1].resolve();await next;}f.calls[0].reject(Error('Old model failure'));await old;assert.equal(f.modelChoice.value,'');assert.equal(f.error(),'');if(!accepted){f.calls[1].resolve();await next;}}
});
test('range input submits each latest full pair and old rejection cannot discard newer held input',async()=>{
  const f=fixture();f.slider.value='5';const old=f.slider.handlers.input();f.slider.value='4';const latest=f.slider.handlers.input();f.update(observed());f.calls[0].reject(Error('Old range failure'));await old;
  assert.deepEqual(pair(f),['4','false']);assert.equal(f.error(),'');assert.equal(f.depthLabel.textContent,'高');assert.deepEqual(f.calls.map(payload),[{depth:5,fast:false},{depth:4,fast:false}]);f.calls[1].resolve();await latest;
});
test('fast and depth share a request generation and failure restores the latest observed whole pair',async()=>{
  const f=fixture();f.slider.value='5';const old=f.slider.handlers.input();const fast=f.fastBtn.onclick();assert.deepEqual(payload(f.calls[1]),{depth:5,fast:true});f.update(observed('fake-A',3,true));f.calls[0].reject(Error('Old depth failure'));await old;assert.deepEqual(pair(f),['5','true']);assert.equal(f.error(),'');f.calls[1].reject(Error('Current fast failure'));await fast;assert.deepEqual(pair(f),['3','true']);assert.equal(f.classes.get('fast'),true);assert.equal(f.depthLabel.textContent,'深入');
});
test('thinking failure leaves an independent pending model and model failure leaves newer thinking intact',async()=>{
  const f=fixture();f.modelChoice.value='fake-B';const model=f.modelChoice.onchange();f.slider.value='4';const thinking=f.slider.handlers.input();f.calls[0].reject(Error('Model failure'));await model;assert.deepEqual(pair(f),['4','false']);assert.equal(f.slider.attrs['aria-busy'],'true');f.calls[1].reject(Error('Thinking failure'));await thinking;assert.equal(f.modelChoice.value,'fake-A');assert.deepEqual(pair(f),['1','false']);
});
test('only an explicit current retry clears its own error and preserves current Host feedback',async()=>{
  for(const newer of ['none','workspace','thinking','host']){const f=fixture();f.modelChoice.value='fake-B';const first=f.modelChoice.onchange();f.calls[0].reject(Error('Model failure'));await first;f.modelChoice.value='fake-B';const retry=f.modelChoice.onchange();if(newer==='workspace')f.report('New workspace failure');if(newer==='thinking'){const think=f.fastBtn.onclick();f.calls[2].reject(Error('New thinking failure'));await think;}if(newer==='host')f.context.hostFeedback='Current Host failure';f.calls[1].resolve();await retry;assert.equal(f.error(),newer==='workspace'?'New workspace failure':newer==='thinking'?'New thinking failure':newer==='host'?'Current Host failure':'');}
});
