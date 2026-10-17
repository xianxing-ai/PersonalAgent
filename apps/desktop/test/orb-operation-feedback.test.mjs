import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let declarations,operation,sync,render,unload;
function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='operationGeneration'))declarations=node.getText(ast);
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='orbOperation')operation=node.initializer.getText(ast);
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='syncOperationFeedback')sync=node.initializer.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&node.right.getText(ast).includes('orbLabel='))render=node.right.getText(ast);
  if(ts.isExpressionStatement(node)&&node.getText(ast).includes("window.addEventListener('unload'")&&node.getText(ast).includes('operationClosed=true'))unload=node.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(declarations&&operation&&sync&&render&&unload);
function fixture(){
  const attributes=new Map(),requests=[];let onUnload;
  const button={setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),set title(v){attributes.set('title',v)}};
  const orb={state:'idle',setLevel(){},setState(state){this.state=state},stop(){}};
  const context=vm.createContext({button,orb,document:{hidden:false},window:{addEventListener:(_e,fn)=>{onUnload=fn}},
    invoke:action=>new Promise((resolve,reject)=>requests.push({action,resolve,reject})),orbStatusLabel:data=>data.label,visualOrbState:data=>data.state});
  vm.runInContext(`${declarations}const syncOperationFeedback=${sync};const orbOperation=${operation};${unload}`,context);
  const run=vm.runInContext('orbOperation',context),update=vm.runInContext(`(${render})`,context);
  update({label:'等待授权',state:'waiting'});
  return{run,update,requests,attributes,orb,unload:()=>onUnload()};
}
test('operation rejection is caught and remains beside the true state across passive snapshots',async()=>{
  for(const action of ['orb.open','orb.dragStart','orb.dragEnd']){
    const f=fixture(),pending=f.run(action);f.requests[0].reject(Error('Fake failed receipt'));await pending;
    assert.equal(f.attributes.get('title'),'操作失败：Fake failed receipt');
    f.update({label:'正在聆听',state:'listening'});
    assert.equal(f.attributes.get('aria-label'),'PersonalAgent · 正在聆听 · 操作失败：Fake failed receipt');assert.equal(f.orb.state,'listening');
  }
});
test('current explicit open or start success clears its older feedback',async()=>{
  for(const action of ['orb.open','orb.dragStart']){const f=fixture(),old=f.run('orb.open');f.requests[0].reject(Error('old'));await old;
    const next=f.run(action);f.requests[1].resolve();await next;assert.equal(f.attributes.get('title'),undefined);assert.equal(f.attributes.get('aria-label'),'PersonalAgent · 等待授权');}
});
test('old operation receipts cannot overwrite a newer gesture feedback',async()=>{
  for(const success of [true,false]){const f=fixture(),old=f.run('orb.dragStart'),next=f.run('orb.open');f.requests[1].reject(Error('new'));await next;
    if(success)f.requests[0].resolve();else f.requests[0].reject(Error('old'));await old;assert.equal(f.attributes.get('title'),'操作失败：new');}
});
test('release success cannot clear a failed or still pending start',async()=>{
  for(const late of [false,true]){const f=fixture(),start=f.run('orb.dragStart');if(!late){f.requests[0].reject(Error('start failed'));await start;}
    const end=f.run('orb.dragEnd');f.requests[1].resolve();await end;if(late){f.requests[0].reject(Error('start failed'));await start;}
    assert.equal(f.attributes.get('title'),'操作失败：start failed');}
});
test('late start success or failure cannot erase a newer release failure',async()=>{
  for(const success of [true,false]){const f=fixture(),start=f.run('orb.dragStart'),end=f.run('orb.dragEnd');f.requests[1].reject(Error('end failed'));await end;
    if(success)f.requests[0].resolve();else f.requests[0].reject(Error('old start'));await start;assert.equal(f.attributes.get('title'),'操作失败：end failed');}
});
test('unload ignores late failed and successful operation receipts',async()=>{
  for(const success of [true,false]){const f=fixture(),pending=f.run('orb.open');f.unload();if(success)f.requests[0].resolve();else f.requests[0].reject(Error('late'));await pending;
    assert.equal(f.attributes.get('title'),undefined);assert.equal(f.attributes.get('aria-label'),'PersonalAgent · 等待授权');}
});
