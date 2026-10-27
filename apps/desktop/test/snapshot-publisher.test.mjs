import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createSnapshotPublisher} from '../electron/snapshot-publisher.js';
import {createSnapshotReceiver} from '../src/shared/snapshot-receiver.js';

function fixture() {
  let value=0,time=0;const jobs=[],sent=[],built=[];
  const publisher=createSnapshotPublisher({project:(surface,topics)=>{built.push([surface,topics]);return {tasks:[{state:value}],surface};},
    schedule:callback=>{jobs.push(callback);return jobs.length;},cancel:()=>{},now:()=>time});
  const window=surface=>{
    const win=new EventEmitter();win.visible=true;win.destroyed=false;
    win.webContents=new EventEmitter();win.webContents.send=(channel,data)=>sent.push({win,channel,data});
    win.isVisible=()=>win.visible;win.isMinimized=()=>false;win.isDestroyed=()=>win.destroyed;
    publisher.attach(win,surface);return win;
  };
  const flush=()=>{while(jobs.length)jobs.shift()();};
  return {publisher,window,flush,sent,built,setValue:next=>value=next,setTime:next=>time=next};
}

test('a progress storm retains one outstanding projection and only latest dirty state for each window',()=>{
  const f=fixture(),slow=f.window('panel'),fast=f.window('workspace');f.flush();
  const first=f.sent[0].data.delivery;
  for(let i=1;i<=10000;i++){f.setValue(i);f.publisher.mark(['tasks']);}
  f.flush();assert.equal(f.sent.length,2);assert.equal(f.built.length,2);
  assert.deepEqual(f.publisher.stats().pending.map(x=>x.dirtyTopics),[1,1]);
  f.publisher.ack(fast,f.sent[1].data.delivery);f.flush();
  assert.equal(f.sent.length,3);assert.equal(f.sent[2].win,fast);assert.equal(f.sent[2].data.tasks[0].state,10000);
  f.setTime(60000);f.flush();assert.equal(f.sent.length,3,'an ACK timeout never accumulates more IPC snapshots');
  assert.equal(f.publisher.ack(slow,{...first,revision:first.revision+1}),false);
  assert.equal(f.publisher.ack(slow,first),true);f.flush();
  assert.equal(f.sent.at(-1).data.tasks[0].state,10000);assert.equal(f.sent.at(-1).data.snapshotPatch,true);
  f.publisher.close();
});

test('hidden windows do not project; restore resyncs once and old ACKs cannot release the new generation',()=>{
  const f=fixture(),win=f.window('panel');f.flush();const old=f.sent[0].data.delivery;
  win.visible=false;win.emit('hide');
  f.publisher.mark(['approvals']);f.flush();assert.equal(f.sent.length,1);
  win.visible=true;win.emit('show');f.flush();assert.equal(f.sent.length,2);
  const current=f.sent[1].data.delivery;
  assert.ok(current.generation>old.generation);assert.equal(f.sent[1].data.snapshotPatch,false);
  assert.equal(f.publisher.ack(win,old),false);assert.equal(f.publisher.ack(win,current),true);
  win.destroyed=true;win.emit('closed');f.publisher.mark();f.flush();
  assert.equal(f.publisher.stats().windows,0);assert.equal(win.webContents.listenerCount('did-finish-load'),0);
  f.publisher.close();
});

for(const lifecycle of ['closed-event','destroyed-before-flush','publisher-close'])
  test(`a destroyed Electron window detaches without accessing webContents again: ${lifecycle}`,()=>{
    const f=fixture(),win=f.window('workspace'),contents=win.webContents;f.flush();
    const delivery=f.sent[0].data.delivery;
    Object.defineProperty(win,'webContents',{get(){
      if(win.destroyed)throw new TypeError('Object has been destroyed');return contents;
    }});
    win.destroyed=true;
    assert.doesNotThrow(()=>{
      if(lifecycle==='closed-event')win.emit('closed');
      else if(lifecycle==='destroyed-before-flush'){f.publisher.mark();f.flush();}
      else f.publisher.close();
    });
    assert.equal(f.publisher.stats().windows,0);
    assert.equal(contents.listenerCount('did-finish-load'),0);
    for(const name of ['show','restore','hide','closed'])assert.equal(win.listenerCount(name),0);
    assert.equal(f.publisher.ack(win,delivery),false);
    contents.emit('did-finish-load');f.publisher.mark();f.flush();
    assert.equal(f.sent.length,1,'A detached destroyed window cannot receive or revive a projection');
    assert.doesNotThrow(()=>f.publisher.close());
  });

test('receiver merges only contiguous patches and preserves approvals, failure and unknown state',()=>{
  const rendered=[],acks=[];let resync=0;
  const receiver=createSnapshotReceiver({render:value=>rendered.push(value),ack:token=>acks.push(token),resync:()=>resync++});
  receiver.receive({tasks:[],approvals:[{state:'pending'}],delivery:{generation:1,revision:1}});
  receiver.receive({snapshotPatch:true,tasks:[{state:'waiting_reconciliation'}],delivery:{generation:1,revision:2}});
  assert.deepEqual(rendered.at(-1).approvals,[{state:'pending'}]);
  assert.equal(rendered.at(-1).tasks[0].state,'waiting_reconciliation');
  receiver.receive({snapshotPatch:true,tasks:[{state:'failed'}],delivery:{generation:1,revision:4}});
  assert.equal(resync,1);assert.equal(rendered.length,2);assert.equal(acks.length,2);
  receiver.receive({tasks:[{state:'failed'}],approvals:[],delivery:{generation:2,revision:1}});
  receiver.receive({snapshotPatch:true,tasks:[{state:'running'}],delivery:{generation:1,revision:3}});
  assert.equal(rendered.at(-1).tasks[0].state,'failed');assert.equal(rendered.length,3);
});

test('a failed render rejects its delivery without acknowledging a committed projection',()=>{
  const acks=[];
  const receiver=createSnapshotReceiver({render:()=>{throw Error('synthetic render failure');},ack:token=>acks.push(token)});
  assert.throws(()=>receiver.receive({tasks:[],delivery:{generation:1,revision:1}}),/synthetic/);
  assert.deepEqual(acks,[{generation:1,revision:1,applied:false}]);
  assert.equal(acks.some(token=>token.applied!==false),false,'no success ACK may commit a failed render');
});
