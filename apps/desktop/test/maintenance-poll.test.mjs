import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createMaintenancePoll} from '../electron/maintenance-poll.js';
import {createResourcePolicy} from '../electron/resource-policy.js';

const settle=()=>new Promise(setImmediate);

test('the actual Main poll keeps task events and reminders responsive while admitting maintenance independently',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const initializer=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='initializeRuntime');
  let callback;
  function visit(node){
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='eventPoll'&&ts.isCallExpression(node.right)
      &&node.right.expression.getText(ast)==='setInterval')callback=node.right.arguments[0].getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(initializer);assert.ok(callback,'actual Runtime maintenance poll');
  let clock=0,release;
  const counts={events:0,todos:0,proactive:0,mail:0,notepad:0,knowledge:0,watch:0,runtime:0,wiki:0};
  const blocked=new Promise(resolve=>{release=resolve;});
  const context=vm.createContext({runtimeClosed:false,
    maintenancePoll:createMaintenancePoll({now:()=>clock}),
    pumpEvents:()=>{counts.events++;},todoHost:{tick:()=>{counts.todos++;}},
    tickProactiveP5:()=>{counts.proactive++;},refreshMail:()=>{counts.mail++;},
    notepadHost:{refresh:()=>{counts.notepad++;}},tickKnowledgeSchedules:()=>{counts.knowledge++;},
    connectorWatchHost:{tick:()=>{counts.watch++;return Promise.resolve();}},
    proactiveRuntimePump:{tick:()=>{counts.runtime++;return blocked;}},
    wikiSourceMonitor:{tick:()=>{counts.wiki++;return Promise.resolve(false);}},
    proactiveMaintenanceFailure:'',publish:()=>assert.fail('unchanged maintenance cannot publish a snapshot')});
  const poll=vm.runInContext('('+callback+')',context);
  for(let index=0;index<9;index++){clock=index*120;poll();await settle();}
  assert.equal(counts.events,9);assert.equal(counts.todos,9);
  for(const name of ['proactive','mail','notepad','knowledge','watch','runtime','wiki'])assert.equal(counts[name],1,name);
  clock=1080;poll();await settle();
  assert.equal(counts.events,10);assert.equal(counts.todos,10);
  assert.equal(counts.runtime,1,'no listener or work backlog behind a slow original maintenance promise');
  for(const name of ['proactive','mail','notepad','knowledge','watch','wiki'])assert.equal(counts[name],2,name);
  release({state:'processed',sessions:[]});await settle();
});

test('a slow maintenance host does not hold another host, and completion starts a fresh quiet interval',async()=>{
  let clock=0,release,calls=0,other=0;
  const poll=createMaintenancePoll({now:()=>clock});
  const pending=poll.run('slow',()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  await settle();clock=5000;
  for(let index=0;index<100;index++)assert.equal(poll.run('slow',()=>{calls++;}),undefined);
  await poll.run('other',()=>{other++;});
  assert.equal(other,1);assert.equal(calls,1);
  release();await pending;
  assert.equal(poll.run('slow',()=>{calls++;}),undefined);
  clock=6000;await poll.run('slow',()=>{calls++;});assert.equal(calls,2);
});

test('synchronous and asynchronous failures release the host without retrying or exposing uncaught rejections',async()=>{
  let clock=0;const errors=[],poll=createMaintenancePoll({now:()=>clock,onError:(name,error)=>errors.push([name,error.message])});
  await poll.run('sync',()=>{throw Error('Synthetic synchronous failure');});
  await poll.run('async',()=>Promise.reject(Error('Synthetic asynchronous failure')));
  assert.deepEqual(errors,[['sync','Synthetic synchronous failure'],['async','Synthetic asynchronous failure']]);
  let calls=0;assert.equal(poll.run('sync',()=>{calls++;}),undefined);
  clock=1000;await poll.run('sync',()=>{calls++;});assert.equal(calls,1);
});

test('resource pressure lengthens maintenance admission while the poll itself adds no timer',async()=>{
  let clock=0,calls=0;const policy=createResourcePolicy(),poll=createMaintenancePoll({now:()=>clock,
    interval:()=>policy.snapshot().maintenanceIntervalMs});
  assert.equal(policy.snapshot().maintenanceIntervalMs,1000);
  await poll.run('host',()=>{calls++;});
  policy.sample({freeBytes:5,totalBytes:100,cores:8});
  clock=1000;await poll.run('host',()=>{calls++;});
  clock=5999;assert.equal(poll.run('host',()=>{calls++;}),undefined);
  clock=6000;await poll.run('host',()=>{calls++;});assert.equal(calls,3);
});
