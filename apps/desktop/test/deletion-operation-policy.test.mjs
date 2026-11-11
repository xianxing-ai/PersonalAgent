import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {assertDeletionOperationSupported,createDeletionConfirmationGate} from '../electron/deletion-operation-policy.js';
import {createPrivateMemoryErasureHost} from '../electron/private-memory-erasure-host.js';
import {createMemoryLearningHost} from '../electron/memory-learning-host.js';

function fixture(){
 const values=new Map();let turn={conversationId:'conversation',turnId:'human-1',createdAt:'2026-11-02T00:00:00Z'};
 const store={get:key=>structuredClone(values.get(key)),compareAndSet(key,before,next){
  if(!isDeepStrictEqual(values.get(key),before))return false;values.set(key,structuredClone(next));return true;}};
 const ports={getStore:()=>store,readUserTurn:()=>turn};
 return {values,ports,gate:()=>createDeletionConfirmationGate(ports),next(value={}){turn={...turn,turnId:'human-2',createdAt:'2026-11-02T00:00:01Z',...value};}};
}
const target={id:'fact',revision:2};

test('irreversible deletion waits for a later human turn, then executes the exact original only once',async()=>{
 const f=fixture();let calls=0;const perform=async()=>{calls++;return {state:'deleted'};};
 assert.equal((await f.gate().run('memory.erase',target,perform)).phase,'deletion_user_turn');
 assert.equal((await f.gate().run('memory.erase',target,perform)).phase,'deletion_user_turn');assert.equal(calls,0);
 f.next();assert.equal((await f.gate().run('memory.erase',target,perform)).state,'deleted');
 assert.equal((await f.gate().run('memory.erase',target,perform)).state,'deleted');assert.equal(calls,1);
 await assert.rejects(f.gate().run('memory.erase',{...target,revision:3},perform),/原对象已有删除回执/);
});

test('version changes restart pending confirmation; another conversation or non-newer turn never deletes',async()=>{
 const f=fixture(),perform=()=>assert.fail('no deletion before the later exact confirmation');
 await f.gate().run('memory.erase',target,perform);
 f.next({conversationId:'other'});await assert.rejects(f.gate().run('memory.erase',target,perform),/原对话/);
 f.next({conversationId:'conversation',createdAt:'2026-11-02T00:00:00Z'});
 assert.equal((await f.gate().run('memory.erase',target,perform)).phase,'deletion_user_turn');
 f.next();assert.equal((await f.gate().run('memory.erase',{...target,revision:3},perform)).phase,'deletion_user_turn');
 assert.equal((await f.gate().run('memory.erase',{...target,revision:3},perform)).phase,'deletion_user_turn');
 f.next({turnId:'human-3',createdAt:'2026-11-02T00:00:02Z'});
 assert.equal((await f.gate().run('memory.erase',{...target,revision:3},async()=>({state:'deleted'}))).state,'deleted');
});

test('missing trusted ports, invalid target, and stale source reject before storing a deletion intent',async()=>{
 const f=fixture(),perform=()=>assert.fail('must not erase');
 await assert.rejects(createDeletionConfirmationGate().run('memory.erase',target,perform),/可信/);
 await assert.rejects(f.gate().run('memory.erase',{...target,permanent:true},perform),/可信/);
 await assert.rejects(f.gate().run('memory.erase',target,perform,()=>{throw Error('stale source');}),/stale source/);
 assert.equal(f.values.size,0);
});

test('in-flight and unknown original deletion survive reconnect without repeating the native operation',async()=>{
 const f=fixture();let reject,started=0;const perform=()=>{started++;return new Promise((_,no)=>{reject=no;});};
 await f.gate().run('memory.erase',target,perform);f.next();
 const original=f.gate().run('memory.erase',target,perform);
 assert.equal((await f.gate().run('memory.erase',target,perform)).phase,'deletion_result_unknown');
 reject(Error('Synthetic lost receipt'));await assert.rejects(original,/lost receipt/);
 f.next({turnId:'human-3',createdAt:'2026-11-02T00:00:02Z'});
 assert.equal((await f.gate().run('memory.erase',target,perform)).phase,'deletion_result_unknown');assert.equal(started,1);
});

test('declining the later native dialog is known no-effect and does not consume an erase',async()=>{
 const f=fixture();await f.gate().run('memory.erase',target,()=>assert.fail());f.next();
 assert.equal((await f.gate().run('memory.erase',target,async()=>({state:'declined'}))).state,'declined');
 assert.equal((await f.gate().run('memory.erase',target,async()=>({state:'deleted'}))).state,'deleted');
});

test('generic deletion refuses without a real recovery port; caller-supplied recoverability is no proof',()=>{
 for(const toolName of ['filesystem.delete','calendar.cancel','memory.erase','shell.unlink'])
  assert.throws(()=>assertDeletionOperationSupported({toolName,arguments:{recoverable:true,permanent:false}}),/可信/);
 for(const toolName of ['mail.archive','calendar.create','todo.update'])assertDeletionOperationSupported({toolName});
});

test('actual private erasure host preserves source/copies on first turn and retains its original marker cleanup after later consent',async()=>{
 const f=fixture(),effects=[],markers=[];
 const privateMemory={assertEraseTarget:ref=>assert.deepEqual(ref,target),
  async delete(ref){assert.deepEqual(ref,target);effects.push('native-delete');markers.push({factId:ref.id,expectedRevision:ref.revision,phase:'completed'});return {state:'deleted'};},
  listErasureMarkers:()=>markers};
 const host=createPrivateMemoryErasureHost({privateMemory,deletionGate:f.gate(),consumptionHost:{releaseTask:()=>effects.push('release')},
  listBindings:()=>({items:[]}),cancelTask:()=>effects.push('cancel'),eraseTaskCopies:()=>effects.push('purge'),readCopyErasureReceipt:()=>null});
 assert.equal((await host.erase(target)).phase,'deletion_user_turn');assert.deepEqual(effects,[]);
 f.next();assert.equal((await host.erase(target)).state,'deleted');assert.deepEqual(effects,['native-delete']);
 assert.equal((await host.erase(target)).state,'deleted');assert.deepEqual(effects,['native-delete']);
});

for(const [name,payload] of [['memory.delete',{ref:target}],['memory.boundErase',{ref:target}],['learning.erase',{workflowId:target.id,expectedRevision:target.revision}]])
 test(name+' production admin consumer routes through the two-turn gate',async()=>{
  const f=fixture();let calls=0;const erase=async()=>{calls++;return {state:'deleted'};};
  const host=createMemoryLearningHost({profile:'huawei_ict_agentarts',deletionGate:f.gate(),managedPrivateCopies:[],
   privateMemory:{prepareWrite(){},assertEraseTarget:ref=>assert.deepEqual(ref,target),delete:erase},publicErasure:{erase},learningApplication:{erase}});
  assert.equal((await host.invoke(name,payload)).phase,'deletion_user_turn');assert.equal(calls,0);
  f.next();assert.equal((await host.invoke(name,payload)).state,'deleted');assert.equal(calls,1);
 });
