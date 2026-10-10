import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {orbState,visualOrbState,orbStatusLabel,stateNames} from '../src/features/conversation/state.js';

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let render,motion;const registrations=[];
function visit(node){
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&node.right.getText(ast).includes("button.setAttribute('aria-label'"))render=node.right.getText(ast);
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='syncMotion')motion=node.getText(ast);
  if(ts.isExpressionStatement(node)&&node.getText(ast).includes('syncMotion')&&/^(window|document)\.addEventListener/.test(node.getText(ast)))registrations.push(node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(render&&motion);
function fixture(){
  const attributes={},events=new Map(),document={hidden:false,documentElement:{dataset:{calm:'false'}}};
  const orb={running:true,calm:false,setLevel(value){this.level=value;},setState(value){this.state=value;},setCalm(value){this.calm=value;this.running=!value;},stop(){this.running=false;}};
  for(const [name,target] of [['window',{}],['document',document]]){
    target.addEventListener=(event,callback)=>events.set(`${name}:${event}`,callback);
    target.removeEventListener=event=>events.delete(`${name}:${event}`);
    if(name==='window')document.window=target;
  }
  const context=vm.createContext({orb,document,window:document.window,visualOrbState,orbStatusLabel,button:{setAttribute:(key,value)=>attributes[key]=value}});
  vm.runInContext(`const ${motion};`,context);for(const statement of registrations)vm.runInContext(statement,context);
  return {orb,document,attributes,events,render:vm.runInContext(`(${render})`,context),sync:()=>vm.runInContext('syncMotion()',context)};
}
test('actual compact Orb consumer projects each Live status and keeps its snapshot untouched',()=>{
  const f=fixture(),names={connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'正在处理任务',stopping:'正在关闭',error:'连接失败'};
  for(const [status,label] of Object.entries(names)){const data={tasks:[],live:{active:true,status},audioLevel:0.7},before=JSON.stringify(data);f.render(data);assert.equal(f.attributes['aria-label'],`PersonalAgent · ${label}`);assert.equal(f.orb.state,visualOrbState(data));assert.equal(f.orb.level,0.7);assert.equal(JSON.stringify(data),before);}
});
test('real Task waits, cancellation, planning, execution and failure retain priority over Live',()=>{
  const f=fixture();for(const state of ['created','planning','running','verifying','waiting_approval','waiting_external','waiting_reconciliation','cancelling','failed'])for(const status of ['connecting','reconnecting','listening','speaking','working','stopping','error']){
    const data={tasks:[{taskId:'synthetic-task',state}],live:{active:true,status}};f.render(data);assert.equal(f.attributes['aria-label'],`PersonalAgent · ${stateNames[state]}`);assert.equal(data.tasks[0].state,state);if(state!=='created')assert.equal(f.orb.state,orbState(data.tasks[0]));
  }
});
test('historical completed and cancelled turns do not mask current Live and regain labels when Live closes',()=>{
  const f=fixture(),names={connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'正在处理任务',stopping:'正在关闭',error:'连接失败'};
  for(const state of ['succeeded','cancelled'])for(const [status,label] of Object.entries(names)){f.render({tasks:[{taskId:'done',state}],live:{active:true,status}});assert.equal(f.attributes['aria-label'],`PersonalAgent · ${label}`);f.render({tasks:[{taskId:'done',state}],live:{active:false,status}});assert.equal(f.attributes['aria-label'],`PersonalAgent · ${stateNames[state]}`);}f.render({tasks:[],live:{active:false}});assert.equal(f.attributes['aria-label'],'PersonalAgent · 待机');
  f.render({tasks:[{taskId:'pending',state:'waiting_approval'},{taskId:'done',state:'succeeded'}],live:{active:true,status:'speaking'}});assert.equal(f.attributes['aria-label'],'PersonalAgent · 等待授权');
});
test('preferences use the existing effective calm dataset and can resume without bridge calls',()=>{
  const f=fixture();f.document.documentElement.dataset.calm='true';f.events.get('window:preferences-changed')();assert.equal(f.orb.calm,true);assert.equal(f.orb.running,false);f.document.documentElement.dataset.calm='false';f.events.get('window:preferences-changed')();assert.equal(f.orb.calm,false);assert.equal(f.orb.running,true);
});
test('hidden Orb stays stopped across preference changes and reveal reads the current preference',()=>{
  const f=fixture();f.document.hidden=true;f.events.get('document:visibilitychange')();assert.equal(f.orb.running,false);f.events.get('window:preferences-changed')();assert.equal(f.orb.running,false);f.document.documentElement.dataset.calm='true';f.document.hidden=false;f.events.get('document:visibilitychange')();assert.equal(f.orb.calm,true);assert.equal(f.orb.running,false);f.document.documentElement.dataset.calm='false';f.sync();assert.equal(f.orb.running,true);
});
test('a snapshot can update hidden Task truth without restarting the animation dependency',()=>{
  const f=fixture();f.document.hidden=true;f.orb.setState=value=>{f.orb.state=value;f.orb.running=true;};f.render({tasks:[{taskId:'synthetic-task',state:'waiting_approval'}],live:{active:true,status:'speaking'}});assert.equal(f.orb.running,false);assert.equal(f.orb.state,'waiting');assert.equal(f.attributes['aria-label'],'PersonalAgent · 等待授权');
});
test('unload releases both local compact Orb preference and visibility subscriptions',()=>{
  const f=fixture();f.events.get('window:unload')();assert.equal(f.events.has('window:preferences-changed'),false);assert.equal(f.events.has('document:visibilitychange'),false);
});
