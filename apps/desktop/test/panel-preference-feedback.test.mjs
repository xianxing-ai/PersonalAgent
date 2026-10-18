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
    if(/^(const panelPreferenceRequests=|const syncPanelPreferenceBusy=|const projectPanelPreferences=|const requestPanelPreference=|budget\.addEventListener\('input'|fastBtn\.onclick=)/.test(text))declarations.push(text);
    if(node.pos>source.indexOf('render=(data,')&&text==='projectPanelPreferences();')projection.push(text);
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(declarations.length,6);assert.equal(projection.length,1);
const observed=(depth=1,fast=false)=>({conversationPreference:{depth,fast},thinking:{depth,fast}});
function fixture(){
  const control=value=>({value,attrs:{},handlers:{},setAttribute(name,value){this.attrs[name]=value;},getAttribute(name){return this.attrs[name];},addEventListener(name,handler){this.handlers[name]=handler;}});
  const budget=control('1'),fastBtn=control(''),classes=new Map(),calls=[];
  const context=vm.createContext({budget,fastBtn,modelMenu:{classList:{toggle(name,value){classes.set(name,value);}}},current:observed(),errorFeedbackRevision:0,hostFeedback:'',hostFeedbackRevision:-1,
    invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
  vm.runInContext("let feedback='';const setFeedback=value=>{errorFeedbackRevision++;feedback=value;};const report=error=>setFeedback(typeof error==='string'?error:error.message);",context);
  vm.runInContext(declarations.join('\n'),context);
  const update=vm.runInContext(`data=>{current=data;${projection.join('\n')}}`,context);update(observed());
  return {context,budget,fastBtn,classes,calls,update,error:()=>vm.runInContext('feedback',context),report:vm.runInContext('report',context)};
}
const pair=f=>[f.budget.value,f.fastBtn.attrs['aria-pressed']];
const payload=call=>JSON.parse(JSON.stringify(call.payload));

test('step budget failure restores observed pair without touching native effort',async()=>{
  const f=fixture();f.budget.value='5';const pending=f.budget.handlers.input();
  f.calls[0].reject(Error('budget failed'));await pending;assert.deepEqual(pair(f),['1','false']);assert.equal(f.error(),'budget failed');
  assert.equal(f.budget.attrs['aria-busy'],'false');assert.equal(f.calls[0].name,'thinking.update');assert.deepEqual(payload(f.calls[0]),{depth:5,fast:false});
});
test('ordinary snapshots and old failure preserve latest full step/fast intent',async()=>{
  const f=fixture();f.budget.value='5';const old=f.budget.handlers.input();f.budget.value='4';const next=f.budget.handlers.input();f.update(observed());
  f.calls[0].reject(Error('old failure'));await old;assert.deepEqual(pair(f),['4','false']);assert.equal(f.error(),'');
  f.update(observed(4));f.calls[1].resolve();await next;assert.equal(f.budget.attrs['aria-busy'],'false');
});
test('Fast keeps step depth independent from native strength and restores latest snapshot on failure',async()=>{
  const f=fixture();f.budget.value='5';const old=f.budget.handlers.input();const fast=f.fastBtn.onclick();assert.deepEqual(payload(f.calls[1]),{depth:5,fast:true});
  f.update(observed(3,true));f.calls[0].reject(Error('old'));await old;assert.deepEqual(pair(f),['5','true']);
  f.calls[1].reject(Error('fast failed'));await fast;assert.deepEqual(pair(f),['3','true']);assert.equal(f.classes.get('fast'),true);
});
test('successful explicit budget retry clears only its own error',async()=>{
  for(const newer of [false,true]){const f=fixture();const first=f.fastBtn.onclick();f.calls[0].reject(Error('failed'));await first;
    const retry=f.fastBtn.onclick();if(newer)f.report('new failure');f.calls[1].resolve();await retry;assert.equal(f.error(),newer?'new failure':'');}
});
