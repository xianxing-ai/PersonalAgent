import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {stateNames} from '../src/features/conversation/state.js';

const source=await readFile(new URL('../src/features/workspace/view.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('view.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=[];let projection;
function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='mountWorkspace'){
    for(const statement of node.body.statements){
      const text=statement.getText(ast);
      if(/^(let feedbackRevision=|let preferenceEditing=|const report=|const reportPreference=|const preferenceRequests=|const syncPreferenceBusy=|const projectPreferenceControls=|const requestPreference=|const editThinking=|depth\.oninput=|fast\.oninput=|const saveThinking=|depth\.onchange=|fast\.onchange=)/.test(text))declarations.push(text);
      if(ts.isFunctionDeclaration(statement)&&statement.name?.text==='update'){
        const end=statement.body.statements.findIndex(part=>part.getText(ast).startsWith('orb.setLevel('));assert.ok(end>0);
        projection=statement.body.statements.slice(0,end).map(part=>part.getText(ast)).join('\n');
      }
    }
  }
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(declarations.length,14);
const observed=(depth=1,fast=false)=>({tasks:[],modelChoices:[],conversationPreference:{depth,fast},thinking:{depth,fast}});
function fixture(){
  const control=value=>({value,checked:false,attrs:{},setAttribute(name,value){this.attrs[name]=value;},replaceChildren(...options){this.options=options;}});
  const modelChoice=control(''),depth=control(''),fast=control(''),error={textContent:''},calls=[],children={hidden:true,items:[]},label={hidden:true};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const subagents={update(items){children.items=items;children.hidden=items.length===0;}};
  const context=vm.createContext({subagents,sessionControls:{update(){}},nativeReasoning:{update(){},setBusy(){}},children,escape,stateNames,current:{tasks:[]},updateRevision:0,preferenceSignature:undefined,
    modelChoice,depth,fast,preferences:{querySelector:()=>label},root:{querySelector:()=>error},
    Option:function(text,value){this.text=text;this.value=value;},invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
  vm.runInContext(declarations.join('\n'),context);const update=vm.runInContext(`data=>{${projection}}`,context);update(observed());
  return {context,children,modelChoice,depth,fast,error,calls,update,report:vm.runInContext('report',context)};
}
const pair=f=>[f.depth.value,f.fast.checked];
test('workspace budget rejection restores full observed pair without changing native strength',async()=>{
  const f=fixture();f.depth.value='5';const pending=f.depth.onchange();f.calls[0].reject(Error('disk failed'));await pending;
  assert.deepEqual(pair(f),['1',false]);assert.match(f.error.textContent,/disk failed/);assert.equal(f.depth.attrs['aria-busy'],'false');
  assert.equal(f.calls[0].name,'thinking.update');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload)),{depth:5,fast:false});
});
test('workspace depth and Fast keep latest pair across old rejection, snapshot and success',async()=>{
  const f=fixture();f.depth.value='4';const old=f.depth.onchange();f.fast.checked=true;const next=f.fast.onchange();
  f.update({...observed(),audioLevel:.3});assert.deepEqual(pair(f),['4',true]);f.calls[0].reject(Error('old'));await old;assert.equal(f.error.textContent,'');
  f.update(observed(4,true));f.calls[1].resolve();await next;assert.deepEqual(pair(f),['4',true]);assert.equal(f.fast.attrs['aria-busy'],'false');
});
test('workspace held budget survives unrelated snapshots and current failure restores latest observed pair',async()=>{
  const f=fixture();f.depth.value='5';f.depth.oninput();f.update({...observed(),audioLevel:.4});assert.equal(f.depth.value,'5');
  const pending=f.depth.onchange();f.update(observed(2,true));f.calls[0].reject(Error('failed'));await pending;assert.deepEqual(pair(f),['2',true]);
});
test('subtask rendering does not replace pending step preferences or issue preference IPC',async()=>{
  const f=fixture();f.depth.value='4';const pending=f.depth.onchange();f.update({...observed(),subagentTasks:[{parentTaskId:'parent-1',taskId:'child-1',role:'<worker>',modelId:'cloud-child',reasoningEffort:'high',state:'running',resultSummary:'<untrusted>',evidenceRefs:['evidence-1']}]});
  assert.equal(f.children.hidden,false);assert.equal(f.children.items[0].parentTaskId,'parent-1');assert.equal(f.children.items[0].taskId,'child-1');assert.equal(f.children.items[0].resultSummary,'<untrusted>');
  assert.equal(f.depth.value,'4');assert.equal(f.calls.length,1);f.calls[0].reject(Error('failed'));await pending;f.update(observed());assert.equal(f.children.hidden,true);
});
test('explicit step retry preserves unrelated newer feedback',async()=>{
  for(const newer of [false,true]){const f=fixture();const pending=f.depth.onchange();f.calls[0].reject(Error('failed'));await pending;const retry=f.depth.onchange();if(newer)f.report('new failure');f.calls[1].resolve();await retry;assert.equal(f.error.textContent,newer?'new failure':'');}
});

test('an unchanged audio snapshot preserves native range input before its change commit and emits no write',()=>{
  const f=fixture();f.depth.value='4';f.depth.oninput();f.update({...observed(),audioLevel:.4});
  assert.deepEqual(pair(f),['4',false]);assert.equal(f.calls.length,0);
});

test('a previous preference rejection preserves newer native range input before its change commit',async()=>{
  const f=fixture();f.depth.value='5';const previous=f.depth.onchange();f.depth.value='4';f.depth.oninput();
  f.update(observed(2,false));f.calls[0].reject(Error('Previous request rejected'));await previous;
  assert.deepEqual(pair(f),['4',false]);
  const committed=f.depth.onchange();assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].payload)),{depth:4,fast:false});
  f.update(observed(4,false));f.calls[1].resolve();await committed;assert.deepEqual(pair(f),['4',false]);
});
