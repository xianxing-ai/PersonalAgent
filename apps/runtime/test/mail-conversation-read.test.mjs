import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {QQMailProvider,FakeMailProvider} from '@personal-agent/mail';
import {LayaTriageService} from '@personal-agent/cognition';
import {createQQMailTriageHost} from '../dist/application.js';
import {createEncryptedModuleStorage} from '../../desktop/electron/encrypted-module-storage.js';

test('Conversation mail.inbox reads stay bound by the active manual batch and never consume page receipts',async t=>{
  const cache=new URL('../../../.cache/mail-batch-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(new URL('run-',cache)),records=new Map(),prepared=[],consumed=[],pageFinishes=[],active=new Set(),live=new Set();
  let batch,session,selectedTask,sequence=0;
  const fakeProvider=new FakeMailProvider({inbox:Array.from({length:20},(_,index)=>({uid:index+1,folder:'INBOX',from:'synthetic@example.invalid',
    to:'synthetic@qq.com',subject:'Synthetic meeting '+index,sentAt:'2026-10-21T00:00:00Z',seen:false})),sent:[]},{pageSize:100});
  t.mock.method(QQMailProvider.prototype,'fetchPage',async(...args)=>fakeProvider.fetchPage(...args));
  const triage=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
    ['category_'+index,{choice:'meeting',probabilities:{meeting:.9,other:.1},answer_confidence:.9,confidence:.9}],
    ['impact_'+index,{choice:'routine',probabilities:{routine:.9,high_impact:.1},answer_confidence:.9,confidence:.9}]]))};}});
  const batchDeadline=new Date(Date.now()+60_000).toISOString();
  const authorization={canRequest:()=>true,
    preparePage(scope,current,parent){assert.equal(current.batchId,session);batch=current;live.add(current.batchId);prepared.push({scope,parent});},
    assertCurrent(current){if(batch&&!live.has(current.batchId))throw Error('Synthetic batch ended');},
    assertPage(scope,current){assert.ok(active.has(current.batchId));assert.equal(scope.taskId,selectedTask);},
    assertConsumed(scope,current){assert.ok(active.has(current.batchId));assert.ok(records.has(scope.taskId));consumed.push(scope.taskId);},
    finishPages(current){active.delete(current.batchId);pageFinishes.push(current.batchId);},
    finish(current){active.delete(current.batchId);live.delete(current.batchId);}};
  const host=createQQMailTriageHost({user:'synthetic@qq.com',authCode:'SyntheticOnly',accountRef:'desktop-qq-inbox',namespace:'Synthetic',triage,
    storage:createEncryptedModuleStorage({userData:directory,safeStorage:{isEncryptionAvailable:()=>true,
      encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()},filename:'triage.json'}),
    labels:{meeting:'Synthetic meeting',other:'Other'},isSessionAllowed:()=>false,batchAuthorization:authorization});
  t.after(()=>host.close());
  host.bindApplication({startMailReadSession(){session=randomUUID();return {sessionId:session,accountRef:'desktop-qq-inbox',folder:'INBOX',limit:100,expiresAt:batchDeadline};},
    nextMailReadSession(){if(sequence===1)return {state:'done'};sequence++;selectedTask='page-1';return {state:'submitted',page:{task:{taskId:selectedTask}}};},
    stopMailReadSession(){},readHostToolTask:taskId=>({task:{state:records.has(taskId)?'succeeded':'waiting_approval'},
      ...(records.has(taskId)?{confirmed:{result:records.get(taskId)}}:{})})});
  const tool=host.tools[0];
  const conversationScope={taskId:'conversation-task',runId:'conversation-run',toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,deadline:new Date(Date.now()+5_000).toISOString(),
    signal:new AbortController().signal};
  assert.throws(()=>host.prepareAuthorization(conversationScope),{message:'Mail conversation read is outside the active manual batch'},
    'before any manual batch a conversation read has no binding to relax into');
  host.startBatch({expiresAt:batchDeadline});
  assert.equal(prepared.length,0);
  host.prepareAuthorization(conversationScope);
  assert.equal(prepared.length,0,'a conversation read never prepares a batch page card');
  const pageScope={taskId:'page-1',runId:'page-1-run',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    deadline:batchDeadline,signal:new AbortController().signal};
  host.prepareAuthorization(pageScope);
  assert.equal(prepared.length,1);
  active.add(session);
  const page=await tool.execute({account:'desktop-qq-inbox',folder:'INBOX',limit:100},pageScope);
  records.set('page-1',page);
  const completed=await host.refresh();
  assert.equal(completed.status,'complete');
  assert.deepEqual(pageFinishes,[session],'the page phase ends while the batch binding survives');
  host.prepareAuthorization(conversationScope);
  assert.equal(prepared.length,1,'after completion the retained binding still bounds conversation reads without preparing a page');
  await host.cancel();
  assert.throws(()=>host.prepareAuthorization(conversationScope),{message:'Mail conversation read is outside the active manual batch'},
    'an explicit cancel closes the conversation window immediately');
  assert.throws(()=>host.prepareAuthorization(pageScope),{message:'Mail page is outside the original manual batch'});
});
