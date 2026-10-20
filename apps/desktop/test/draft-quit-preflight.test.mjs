import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftQuitPreflight} from '../electron/draft-quit-preflight.js';
const settle=()=>new Promise(setImmediate);
function fixture(options={}){
  const calls=[],pending=[];
  const window=()=>({isDestroyed:()=>false,webContents:{isDestroyed:()=>false,executeJavaScript(script){
    calls.push(script);return script.includes('pa:prepare-quit')?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve();
  }}});
  const guard=createDraftQuitPreflight({windows:()=>[window(),window()],retry:()=>calls.push('quit'),onFailure:e=>calls.push(e.message),...options});
  return {guard,calls,pending};
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
  const failures=[];const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,executeJavaScript(){throw Error('renderer crashed');}}};
  const guard=createDraftQuitPreflight({windows:()=>[win],retry:()=>assert.fail('must not quit'),onFailure:error=>failures.push(error.message)});
  assert.equal(guard.allow(),false);await settle();assert.deepEqual(failures,['renderer crashed']);
});
