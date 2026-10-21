import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {QQMailProvider,FakeMailProvider} from '@personal-agent/mail';
import {LayaTriageService} from '@personal-agent/cognition';
import {createQQMailTriageHost} from '../dist/application.js';
import {createEncryptedModuleStorage} from '../../desktop/electron/encrypted-module-storage.js';

test('Synthetic original mail triage separates readiness from per-page receipt, retains one batch and stops derivation after completion/cancel',async t=>{
  const cache=new URL('../../../.cache/mail-batch-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(new URL('run-',cache)),records=new Map(),prepared=[],consumed=[],active=new Set(),live=new Set();
  let batch,first,fetches=0,sequence=0,session,selectedTask;
  const fakeProvider=new FakeMailProvider({inbox:Array.from({length:200},(_,index)=>({uid:index+1,folder:'INBOX',from:'synthetic@example.invalid',
    to:'synthetic@qq.com',subject:'Synthetic meeting '+index,sentAt:'2026-10-21T00:00:00Z',seen:false})),sent:[]},{pageSize:100});
  t.mock.method(QQMailProvider.prototype,'fetchPage',async(...args)=>{fetches++;return fakeProvider.fetchPage(...args);});
  const triage=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
    ['category_'+index,{choice:'meeting',probabilities:{meeting:.9,other:.1},answer_confidence:.9,confidence:.9}],
    ['impact_'+index,{choice:'routine',probabilities:{routine:.9,high_impact:.1},answer_confidence:.9,confidence:.9}]]))};}});
  const deadline=new Date(Date.now()+60_000).toISOString(),authorization={canRequest:()=>true,
    preparePage(scope,current,parent){assert.equal(current.batchId,session);batch=current;live.add(current.batchId);prepared.push({scope,parent});},
    assertCurrent(current){assert.equal(current,batch??current);if(batch&&!live.has(current.batchId))throw Error('Synthetic batch ended');},
    assertPage(scope,current){assert.equal(current,batch);assert.ok(active.has(current.batchId));assert.equal(scope.taskId,selectedTask);},
    assertConsumed(scope,current){assert.equal(current,batch);assert.ok(active.has(current.batchId));assert.ok(records.has(scope.taskId));consumed.push(scope.taskId);},
    finish(current){active.delete(current.batchId);live.delete(current.batchId);}};
  const host=createQQMailTriageHost({user:'synthetic@qq.com',authCode:'SyntheticOnly',accountRef:'desktop-qq-inbox',namespace:'Synthetic',triage,
    storage:createEncryptedModuleStorage({userData:directory,safeStorage:{isEncryptionAvailable:()=>true,
      encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()},filename:'triage.json'}),
    labels:{meeting:'Synthetic meeting',other:'Other'},isSessionAllowed:()=>false,batchAuthorization:authorization});
  t.after(()=>host.close());
  host.bindApplication({startMailReadSession(){session=randomUUID();sequence=0;return {sessionId:session,accountRef:'desktop-qq-inbox',folder:'INBOX',limit:100,expiresAt:deadline};},
    nextMailReadSession(){if(sequence===2)return {state:'done'};selectedTask='page-'+(++sequence);return {state:'submitted',page:{task:{taskId:selectedTask}}};},
    stopMailReadSession(){},readHostToolTask:taskId=>({task:{state:records.has(taskId)?'succeeded':'waiting_approval'},
      ...(records.has(taskId)?{confirmed:{result:records.get(taskId)}}:{})})});
  host.startBatch({expiresAt:deadline});assert.equal(fetches,0);
  const tool=host.tools[0],scope=index=>({taskId:'page-'+index,runId:'original-run-'+index,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    deadline,signal:new AbortController().signal,authorizationRef:'Synthetic original Policy grant',scopes:['mail:read']});
  const firstScope=scope(1);host.prepareAuthorization(firstScope);assert.equal(prepared[0].parent,undefined);
  await assert.rejects(tool.execute({account:'desktop-qq-inbox',folder:'INBOX',limit:100},firstScope));assert.equal(fetches,0);
  assert.equal((await host.refresh()).status,'waiting_approval','readiness keeps the original question pending, without executing or cancelling it');
  active.add(batch.batchId);first=batch.batchId;
  const page1=await tool.execute({account:'desktop-qq-inbox',folder:'INBOX',limit:100},firstScope);records.set('page-1',page1);
  await host.refresh();assert.equal(selectedTask,'page-2');const secondScope=scope(2);host.prepareAuthorization(secondScope);
  assert.equal(prepared[1].parent.runId,firstScope.runId);assert.equal(batch.batchId,first);assert.equal(batch.limit,100);
  const page2=await tool.execute({account:'desktop-qq-inbox',folder:'INBOX',limit:100,cursor:page1.nextCursor},secondScope);records.set('page-2',page2);
  assert.equal((await host.refresh()).status,'complete');assert.equal(fetches,2);assert.ok(consumed.includes('page-1')&&consumed.includes('page-2'));
  await assert.rejects(tool.execute({account:'desktop-qq-inbox',folder:'INBOX',limit:100},firstScope));assert.equal(fetches,2);
  assert.throws(()=>host.prepareAuthorization(secondScope));await host.cancel();assert.equal(active.size,0);
});
