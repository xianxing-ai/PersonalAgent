import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=await readFile(new URL('../src/features/workspace/view.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('view.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let handler,revision,increment;
function visit(node){
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==="root.querySelector('#connectors-refresh').onclick")handler=node.right.getText(ast);
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='updateRevision')revision=node.getText(ast);
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='update')increment=node.body.statements[0].getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler&&revision&&increment,'actual refresh handler and update revision');
function fixture(){
  const button={disabled:false},calls=[],updates=[],errors=[];
  const context=vm.createContext({root:{querySelector:()=>button},invoke:name=>new Promise((resolve,reject)=>calls.push({name,resolve,reject})),report:error=>errors.push(error.message)});
  vm.runInContext(`let ${revision};`,context);context.update=data=>{vm.runInContext(increment,context);updates.push(data);};
  return{button,calls,updates,errors,update:context.update,run:()=>vm.runInContext(`(${handler})`,context)({currentTarget:button})};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function reading(f){const run=f.run();f.calls[0].resolve();await tick();return {run};}
test('current refresh accepts readback and releases its busy button',async()=>{
  const f=fixture(),{run}=await reading(f);assert.equal(f.button.disabled,true);f.calls[1].resolve('current');await run;assert.deepEqual(f.updates,['current']);assert.equal(f.button.disabled,false);
});
test('a delayed snapshot cannot replace a newer subscribed terminal state',async()=>{
  const f=fixture(),{run}=await reading(f);f.update('succeeded');f.calls[1].resolve('running');await run;assert.deepEqual(f.updates,['succeeded']);assert.equal(f.button.disabled,false);
});
test('updates during discovery do not block the subsequently issued current readback',async()=>{
  const f=fixture(),run=f.run();f.update('during discovery');f.calls[0].resolve();await tick();f.calls[1].resolve('fresh readback');await run;assert.deepEqual(f.updates,['during discovery','fresh readback']);
});
test('stale discovery or snapshot errors cannot replace newer feedback and always release busy',async()=>{
  for(const stage of ['discovery','snapshot']){const f=fixture(),run=f.run();if(stage==='snapshot'){f.calls[0].resolve();await tick();}f.update('new state');f.calls.at(-1).reject(Error('old error'));await run;assert.deepEqual(f.errors,[]);assert.equal(f.button.disabled,false);}
});
test('current errors remain visible and allow an explicit retry',async()=>{
  const f=fixture(),run=f.run();f.calls[0].reject(Error('current error'));await run;assert.deepEqual(f.errors,['current error']);assert.equal(f.button.disabled,false);const retry=f.run();assert.equal(f.button.disabled,true);f.calls[1].reject(Error('retry error'));await retry;assert.equal(f.button.disabled,false);
});
