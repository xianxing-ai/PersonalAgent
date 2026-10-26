import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailMonitorPreparation} from '../electron/mail-monitor-preparation.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('cancellation before preparation begins makes no call and releases the original waiter',async()=>{
  const host=createMailMonitorPreparation();let calls=0;
  const result=host.run(()=>{calls++;});host.cancel();await result;await turn();
  assert.equal(calls,0);assert.equal(host.hasPending(),false);host.close();
});

test('pending starts coalesce and the original approval fence outlives successful preparation',async()=>{
  const host=createMailMonitorPreparation(),work=deferred();let calls=0,valid;
  const result=host.run(context=>{calls++;valid=context.isCurrent;return work.promise;});
  assert.equal(host.run(()=>{throw Error('duplicate preparation');}),result);
  await turn();work.resolve();await result;
  assert.equal(calls,1);assert.equal(host.hasPending(),false);assert.equal(valid(),true);
  await host.run(()=>{});assert.equal(valid(),true,'Idempotent starts must not revoke the pending Runtime approval');
  host.cancel();assert.equal(valid(),false);const stopCurrent=host.capture();assert.equal(stopCurrent(),true);
  await host.run(()=>{});assert.equal(stopCurrent(),false,'A later start supersedes an older stop intent');host.close();
});

test('repeated Stop retains the original fence and configuration changes block starts without revoking a later Stop',async()=>{
  const host=createMailMonitorPreparation();let startCurrent;
  await host.run(context=>{startCurrent=context.isCurrent;});const finish=host.beginConfigurationChange();
  assert.equal(startCurrent(),false);assert.equal(host.configurationPending(),true);
  assert.throws(()=>host.run(()=>{}),/配置.*更新/);
  const stop=host.stop();host.stop();assert.equal(stop(),true);
  const finishOther=host.beginConfigurationChange();assert.equal(stop(),true);
  finish();finish();assert.equal(host.configurationPending(),true);finishOther();
  assert.equal(host.configurationPending(),false);assert.equal(stop(),true);
  await host.run(()=>{});assert.equal(stop(),false);host.close();
});

test('stopped preparation can fail late without clearing or rejecting a new start',async()=>{
  const host=createMailMonitorPreparation(),old=deferred(),fresh=deferred();let oldValid,newValid;
  const first=host.run(context=>{oldValid=context.isCurrent;return old.promise;});await turn();
  host.cancel();await first;
  const second=host.run(context=>{newValid=context.isCurrent;return fresh.promise;});await turn();
  old.reject(Error('synthetic stale failure'));await turn();
  assert.equal(oldValid(),false);assert.equal(newValid(),true);assert.equal(host.hasPending(),true);
  fresh.resolve();await second;assert.equal(host.hasPending(),false);host.close();
});

test('changed source replaces a stale pending preparation while close invalidates completed and pending fences',async()=>{
  const host=createMailMonitorPreparation(),old=deferred(),fresh=deferred();let source=true,oldValid,newValid,signal;
  const first=host.run(context=>{oldValid=context.isCurrent;return old.promise;},{isCurrent:()=>source});await turn();
  source=false;
  const second=host.run(context=>{newValid=context.isCurrent;signal=context.signal;return fresh.promise;});
  await first;await turn();assert.equal(oldValid(),false);assert.equal(newValid(),true);
  host.close();await second;assert.equal(signal.aborted,true);assert.equal(newValid(),false);assert.equal(host.hasPending(),false);
  assert.throws(()=>host.run(()=>{}),/已关闭/);assert.doesNotThrow(()=>host.close());old.resolve();fresh.resolve();await turn();
});
