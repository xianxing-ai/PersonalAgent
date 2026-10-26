import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createSnapshotPublisher} from '../electron/snapshot-publisher.js';
import {createSnapshotReceiver} from '../src/shared/snapshot-receiver.js';

const text = readFileSync(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('renderer.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let subscriber;
(function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'bridge.subscribe'
    && node.arguments[0]?.getText(ast).includes('receiver.receive(data)')) subscriber = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
})(ast);
assert.ok(subscriber, 'use the production renderer recovery handler');

function fixture() {
  let value = {tasks:[{taskId:'original',state:'running'}],approvals:[]}, fail = false;
  let nextId = 0, now = 0, resyncs = 0;
  const jobs = new Map(), messages = [], sent = [], rendered = [], failures = [], receipts = [];
  const win = Object.assign(new EventEmitter(), {isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false});
  win.webContents = Object.assign(new EventEmitter(), {send(channel,data){sent.push({channel,data});messages.push(data);}});
  const publisher = createSnapshotPublisher({project:()=>structuredClone(value),now:()=>now,
    schedule(callback){const id=++nextId;jobs.set(id,callback);return id;},cancel:id=>jobs.delete(id)});
  const receiver = createSnapshotReceiver({render(data){
    if (fail) throw Error('explicit synthetic rendering failure');
    rendered.push(structuredClone(data));
  },ack:token=>{receipts.push(token);publisher.ack(win,token);},resync:()=>{resyncs++;publisher.resync(win);}});
  const context = vm.createContext({closed:false,receivedUpdate:false,recoveringSnapshot:false,receiver,
    reportSnapshotFailure:error=>failures.push(error.message),
    invoke:async action=>{assert.equal(action,'snapshot.resync');resyncs++;publisher.resync(win);}});
  const receive = vm.runInContext(`(${subscriber})`, context);
  function drain() {
    let steps = 0;
    while (jobs.size || messages.length) {
      assert.ok(++steps < 50, 'one source change cannot cause a snapshot resend hot loop');
      for (const [id,callback] of [...jobs]) {jobs.delete(id);now+=16;callback();}
      while (messages.length) receive(messages.shift());
    }
  }
  publisher.attach(win,'panel');
  return {publisher,win,drain,sent,rendered,failures,receipts,jobs,
    get resyncs(){return resyncs;},set failure(value){fail=value;},
    change(next){value=next;publisher.mark(['tasks','approvals']);}};
}

test('Local/Synthetic two renderer failures cannot starve later valid task and approval updates', t => {
  const f = fixture();
  try {
    f.drain();
    f.failure = true;
    f.change({tasks:[{taskId:'original',state:'waiting_approval'}],approvals:[{approvalId:'original',state:'pending'}]});
    f.drain();
    assert.equal(f.failures.length,2, 'the original renderer permits one immediate full resync');
    assert.equal(f.resyncs,1);
    assert.equal(f.jobs.size,0,'a persistent rendering failure must remain quiescent');
    f.failure = false;
    f.change({tasks:[{taskId:'original',state:'waiting_reconciliation'}],approvals:[]});
    f.drain();
    assert.equal(f.rendered.at(-1).tasks[0].state,'waiting_reconciliation',
      'a later authoritative change must recover the visible window without hiding or reloading it');
    assert.deepEqual(f.rendered.at(-1).approvals,[]);
    assert.equal(f.sent.at(-1).data.snapshotPatch,false,'recovery must replace the failed render with a full snapshot');
    assert.equal(f.publisher.stats().pending[0].inFlight,false);
    assert.equal(f.publisher.stats().pending[0].dirtyTopics,0);
    t.diagnostic(JSON.stringify({sent:f.sent.length,renderFailures:f.failures.length,rendered:f.rendered.length,
      immediateResyncs:f.resyncs,scheduledWhileIdle:f.jobs.size,pending:f.publisher.stats().pending[0]}));
  } finally {f.publisher.close();}
});

test('Local/Synthetic repeated render failures remain bounded and retain the latest authoritative state', () => {
  const f = fixture();
  try {
    f.drain();f.failure=true;
    f.change({tasks:[{taskId:'original',state:'waiting_approval'}],approvals:[{approvalId:'original',state:'pending'}]});
    f.drain();
    const sentBefore=f.sent.length;
    for(let i=0;i<10000;i++)f.change({tasks:[{taskId:'original',state:'waiting_reconciliation',revision:i}],
      approvals:[{approvalId:'original',state:'pending'}]});
    assert.equal(f.jobs.size,1,'source changes coalesce into one scheduled flush');
    f.drain();
    assert.equal(f.sent.length,sentBefore+1,'one changed source batch permits only one additional render attempt');
    assert.equal(f.resyncs,1,'a persistent error cannot cause repeated immediate full resyncs');
    assert.equal(f.jobs.size,0);
    assert.equal(f.publisher.stats().pending[0].inFlight,false,'an explicitly rejected delivery retains no in-flight slot');
    assert.equal(f.publisher.stats().pending[0].dirtyTopics,1,'the full state remains pending');
    f.failure=false;
    f.change({tasks:[{taskId:'original',state:'waiting_reconciliation',revision:10000}],
      approvals:[{approvalId:'original',state:'pending'}]});
    f.drain();
    assert.equal(f.rendered.at(-1).tasks[0].revision,10000);
    assert.equal(f.rendered.at(-1).tasks[0].state,'waiting_reconciliation');
    assert.equal(f.rendered.at(-1).approvals[0].state,'pending');
    assert.equal(f.sent.at(-1).data.snapshotPatch,false);
  } finally {f.publisher.close();}
});

test('Local/Synthetic a rejected slow delivery preserves newer dirty state and validates its exact token', () => {
  let nextId=0;
  const jobs=new Map(),sent=[];
  const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,
    webContents:Object.assign(new EventEmitter(),{send:(_channel,data)=>sent.push(data)})});
  const publisher=createSnapshotPublisher({project:()=>({tasks:[{state:'waiting_reconciliation'}],approvals:[{state:'pending'}]}),
    schedule:callback=>{const id=++nextId;jobs.set(id,callback);return id;},cancel:id=>jobs.delete(id)});
  const flush=()=>{for(const [id,callback] of [...jobs]){jobs.delete(id);callback();}};
  try {
    publisher.attach(win,'panel');flush();
    const first=sent[0].delivery;
    for(const token of [{...first,applied:true},{...first,applied:false,extra:true},
      {...first,revision:first.revision+1,applied:false},{...first,generation:first.generation+1,applied:false}]) {
      assert.equal(publisher.ack(win,token),false);
      assert.equal(publisher.stats().pending[0].inFlight,true);
    }
    publisher.mark(['approvals']);flush();
    assert.equal(sent.length,1,'slow receipt retains exactly one outstanding delivery');
    assert.equal(publisher.ack(win,{...first,applied:false}),true);flush();
    assert.equal(sent.length,2,'already-marked newer state can recover without an additional external change');
    assert.equal(sent[1].snapshotPatch,false);
    const second=sent[1].delivery;
    assert.equal(publisher.ack(win,{...first,applied:false}),false,'a duplicate rejection cannot release a newer delivery');
    publisher.resync(win);flush();
    assert.equal(publisher.ack(win,{...second,applied:false}),false,'an old generation cannot release the new baseline');
    assert.equal(publisher.stats().pending[0].inFlight,true);
    assert.equal(publisher.ack(win,sent[2].delivery),true);
    publisher.detach(win);
    assert.equal(publisher.ack(win,{...sent[2].delivery,applied:false}),false);
    assert.equal(publisher.stats().windows,0);
  } finally {publisher.close();}
});

test('Local/Synthetic failed rendering keeps its committed baseline and the original diagnostic', () => {
  let fail=false,resyncs=0;
  const rendered=[],receipts=[],original=Error('explicit original rendering failure');
  const receiver=createSnapshotReceiver({render:value=>{if(fail)throw original;rendered.push(value);},
    ack:token=>{receipts.push(token);if(token.applied===false)throw Error('explicit receipt transport failure');},
    resync:()=>resyncs++});
  receiver.receive({tasks:[{state:'waiting_approval'}],approvals:[{state:'pending'}],delivery:{generation:1,revision:1}});
  fail=true;
  assert.throws(()=>receiver.receive({snapshotPatch:true,tasks:[{state:'failed'}],approvals:[],
    delivery:{generation:1,revision:2}}),error=>error===original);
  fail=false;
  assert.equal(receiver.receive({snapshotPatch:true,tasks:[],delivery:{generation:1,revision:3}}),false);
  assert.equal(resyncs,1,'a failed revision cannot become a valid patch baseline');
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].approvals[0].state,'pending');
  receiver.receive({tasks:[{state:'waiting_reconciliation'}],approvals:[],delivery:{generation:2,revision:1}});
  assert.equal(rendered.at(-1).tasks[0].state,'waiting_reconciliation');
  assert.deepEqual(receipts.map(token=>token.applied),[undefined,false,undefined]);
});
