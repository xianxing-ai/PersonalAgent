import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDraftQuitPreflight} from '../electron/draft-quit-preflight.js';
const settle=()=>new Promise(setImmediate);
function fixture(options={}){
  const calls=[],pending=[];
  const window=()=>Object.assign(new EventEmitter(),{isDestroyed:()=>false,webContents:Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,executeJavaScript(script){
    calls.push(script);return script.includes('pa:prepare-quit')?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve();
  }})});
  const windows=[window(),window()];
  const guard=createDraftQuitPreflight({windows:()=>windows,retry:()=>calls.push('quit'),onFailure:e=>calls.push(e.message),...options});
  return {guard,calls,pending,windows,window};
}
test('app.quit waits for every renderer draft receipt before allowing host cleanup',async()=>{
  const f=fixture();assert.equal(f.guard.allow(),false);assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,2);
  f.pending[0].resolve(true);await settle();assert.equal(f.calls.includes('quit'),false);
  f.pending[1].resolve(true);await settle();assert.equal(f.calls.filter(x=>x==='quit').length,1);assert.equal(f.guard.allow(),true);
});
test('a failed draft write vetoes quit, resumes both windows and can be explicitly retried',async()=>{
  const f=fixture();f.guard.allow();f.pending[0].resolve(false);f.pending[1].resolve(true);await settle();
  assert.equal(f.calls.includes('quit'),false);assert.equal(f.calls.filter(x=>x.includes('pa:cancel-quit')).length,2);
  assert.equal(f.guard.allow(),false);f.pending[2].resolve(true);f.pending[3].resolve(true);await settle();assert.equal(f.guard.allow(),true);
});
test('a renderer crash rejects preflight without a stale receipt later resuming quit',async()=>{
  const f=fixture();f.guard.allow();f.pending[0].reject(Error('renderer gone'));await settle();f.pending[1].resolve(true);await settle();assert.equal(f.calls.includes('quit'),false);
});
test('later cleanup failure unlocks the retained drafts and requires a fresh receipt',async()=>{
  const f=fixture();f.guard.allow();f.pending.forEach(p=>p.resolve(true));await settle();assert.equal(f.guard.allow(),true);
  f.guard.cancel();assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,4);
});

test('an unresponsive renderer times out, resumes peers and ignores late receipts before an explicit retry',async()=>{
  const f=fixture({timeoutMs:20});f.guard.allow();
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(f.calls.filter(value=>value.includes('草稿保存超时')).length,1);
  assert.equal(f.calls.filter(value=>value.includes('pa:cancel-quit')).length,2);
  f.pending.forEach(item=>item.resolve(true));await settle();assert.equal(f.calls.includes('quit'),false);
  assert.equal(f.guard.allow(),false);f.pending[2].resolve(true);f.pending[3].resolve(true);await settle();
  assert.equal(f.calls.filter(value=>value==='quit').length,1);assert.equal(f.guard.allow(),true);
});

test('a synchronous renderer failure reports failure even when resuming that renderer also throws',async()=>{
  const failures=[];const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,webContents:Object.assign(new EventEmitter(),{isDestroyed:()=>false,executeJavaScript(){throw Error('renderer crashed');}})});
  const guard=createDraftQuitPreflight({windows:()=>[win],retry:()=>assert.fail('must not quit'),onFailure:error=>failures.push(error.message)});
  assert.equal(guard.allow(),false);await settle();assert.deepEqual(failures,['renderer crashed']);
});

test('same-window same-frame navigation invalidates ready receipts and removes listeners before a fresh preflight',async()=>{
  const f=fixture(),contents=f.windows[0].webContents,frame=contents.mainFrame;
  f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();assert.equal(f.guard.allow(),true);
  contents.emit('did-start-navigation',{},'file:///same-page',false,true);
  assert.equal(contents.mainFrame,frame);assert.equal(contents.listenerCount('did-start-navigation'),0);
  assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,4);
  f.pending.slice(2).forEach(value=>value.resolve(true));await settle();assert.equal(f.guard.allow(),true);
  f.guard.cancel();
});

test('replacing a window without a navigation event cannot reuse its ready receipt',async()=>{
  const f=fixture(),old=f.windows[0];f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();
  f.windows[0]=f.window();assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,4);
  assert.equal(old.webContents.listenerCount('destroyed'),0);f.guard.cancel();
});

test('navigation during pending preflight rejects late success and repeated cancel clears timers/listeners',async()=>{
  const f=fixture({timeoutMs:20});f.guard.allow();
  f.windows[0].webContents.emit('did-start-navigation',{},'file:///replacement',false,true);
  const failureCount=f.calls.filter(value=>value.includes('页面已变化')).length;
  f.guard.cancel();f.guard.cancel();f.pending.forEach(value=>value.resolve(true));await settle();
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(failureCount,1);assert.equal(f.calls.includes('quit'),false);
  assert.equal(f.calls.some(value=>value.includes('草稿保存超时')),false);
  for(const win of f.windows){assert.equal(win.eventNames().length,0);assert.equal(win.webContents.eventNames().length,0);}
});

test('same-document and subframe navigation preserve receipts; renderer loss invalidates them',async()=>{
  const f=fixture();f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();
  const contents=f.windows[0].webContents;
  contents.emit('did-start-navigation',{},'file:///page#anchor',true,true);
  contents.emit('did-start-navigation',{},'file:///subframe',false,false);assert.equal(f.guard.allow(),true);
  contents.emit('render-process-gone',{},{});assert.equal(contents.eventNames().length,0);
  assert.equal(f.guard.allow(),false);f.guard.cancel();
});

test('a loading replacement page cannot obtain a receipt until loading finishes',async()=>{
  const f=fixture();f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();
  assert.equal(f.guard.allow(),true);f.windows[0].webContents.isLoadingMainFrame=()=>true;
  assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,2,'old ready cannot admit a loading document');
  f.windows[0].webContents.isLoadingMainFrame=()=>false;assert.equal(f.guard.allow(),false);assert.equal(f.pending.length,4);
  f.guard.cancel();
});

test('final commit detaches lifecycle listeners while explicit cleanup failure can still resume drafts',async()=>{
  const f=fixture();f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();
  assert.equal(f.guard.commit(),true);const failures=f.calls.filter(value=>value.includes('页面已变化')).length;
  for(const win of f.windows){win.webContents.emit('destroyed');win.emit('closed');assert.equal(win.webContents.eventNames().length,0);}
  assert.equal(f.calls.filter(value=>value.includes('页面已变化')).length,failures);
  f.guard.cancel();assert.equal(f.calls.some(value=>value.includes('pa:cancel-quit')),true);
});

test('navigation before final commit refuses cleanup and no-window exit can commit',async()=>{
  const f=fixture();f.guard.allow();f.pending.forEach(value=>value.resolve(true));await settle();
  f.windows[0].webContents.emit('did-start-navigation',{},'file:///replacement',false,true);
  assert.equal(f.guard.commit(),false);
  const empty=createDraftQuitPreflight({windows:()=>[],retry(){assert.fail('no asynchronous retry needed');},onFailure(){assert.fail('no page failed');}});
  assert.equal(empty.allow(),true);assert.equal(empty.commit(),true);empty.cancel();
});
