import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {Client} from '@personal-agent/client';
import {LayaTriageService} from '@personal-agent/cognition';
import {FakeMailProvider,QQMailProvider} from '@personal-agent/mail';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createQQMailTriageHost} from '@personal-agent/runtime/application';
import {createDesktopConnectorWatchHost} from '../electron/connector-watch-host.js';
import {createDesktopConnectorChangeHost} from '../electron/connector-change-host.js';

const cache=resolve('.cache/sol-next-wiring-audit-20261026');
mkdirSync(cache,{recursive:true});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=async predicate=>{for(let i=0;i<500;i++){
  const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));
}throw Error('Synthetic watch/read session did not settle');};
const row=(uid,subject)=>({uid,folder:'INBOX',from:'synthetic@example.invalid',to:'synthetic@qq.com',
  subject,sentAt:'2026-10-26T00:00:00.000Z',messageId:`<${uid}@synthetic.invalid>`,seen:false});

test('persisted MailTriage cursor anchors the original watch so the next new UID is nominated',async t=>{
  const directory=mkdtempSync(join(cache,'watch-cursor-'));
  assert.ok(directory.startsWith(cache+sep));
  const namespace='audit-'+randomUUID(),conversationId='desktop:audit-user',configurationRef='mail-audit-config';
  const mailMetadataNamespace=namespace+':qq-inbox:synthetic@qq.com';
  let clock=Date.now(),application,watch,changes,mail,activeWatch,proposed,lastReadTaskId,fetches=[];
  let provider=new FakeMailProvider({inbox:[row(5,'Existing mail')],sent:[]},{pageSize:100,inboxUidValidity:91});
  t.mock.method(QQMailProvider.prototype,'fetchPage',async(account,input)=>{
    fetches.push({account,cursor:input.cursor?structuredClone(input.cursor):undefined});
    return provider.fetchPage(account,input);
  });
  const classifier=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(
    payload.state.events.flatMap((_,i)=>[
      [`category_${i}`,{choice:'other',probabilities:{other:.9,meeting:.1},answer_confidence:.9,confidence:.9}],
      [`impact_${i}`,{choice:'routine',probabilities:{routine:.9,high_impact:.1},answer_confidence:.9,confidence:.9}],
    ]))};}});
  const saved=new Map(),storage={get:key=>structuredClone(saved.get(key)),set:(key,value)=>saved.set(key,structuredClone(value))};
  const source=()=>({available:true,configurationRef});
  // Fake user decision, while Runtime still creates the original Approval and
  // one-use Policy/ToolGateway execution. prepareAuthorization binds taskId
  // before the asynchronous host read begins, as the production question host does.
  const batchAuthorization={canRequest:()=>true,preparePage(){},assertCurrent(){},assertPage(){},
    assertConsumed(){},finishPages(){},finish(){}};
  const rootConversation=id=>{try{return application.runtime.getTask(id).conversationId===conversationId?conversationId:undefined;}
    catch{return undefined;}};
  mail=createQQMailTriageHost({user:'synthetic@qq.com',authCode:'FakeOnly',accountRef:'desktop-qq-inbox',
    namespace:mailMetadataNamespace,storage,triage:classifier,labels:{other:'Other',meeting:'Meeting'},isSessionAllowed:()=>true,
    batchAuthorization,
    onReadTask:({taskId})=>{if(activeWatch){watch.bindMailRead(taskId,activeWatch);lastReadTaskId=taskId;}}});
  watch=createDesktopConnectorWatchHost({getApplication:()=>application,namespace,
    now:()=>clock,readSourceAuthorization:source,resolveUserConversation:rootConversation,
    startMailRead:input=>{
      activeWatch={watchId:input.watchId,sessionId:randomUUID()};
      mail.startBatch({expiresAt:input.expiresAt});return {sessionId:activeWatch.sessionId};
    },readMailStatus:scope=>scope.watchId===activeWatch?.watchId&&scope.sessionId===activeWatch?.sessionId
      ?{sessionId:scope.sessionId,state:mail.snapshot().status}:{state:'unavailable'},
    stopMailRead:scope=>{if(scope.sessionId===activeWatch?.sessionId){activeWatch=undefined;return mail.cancel();}},
    observeTask:taskId=>changes.observeTask(taskId)});
  application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:namespace,now:()=>new Date(clock),tools:[...mail.tools,...watch.tools],
    requiresToolAuthorization:scope=>scope.toolName==='mail.inbox',
    requestToolAuthorization:async scope=>{mail.prepareAuthorization(scope);return 'allow_once';},
    competitionToolAvailability:watch.competitionToolAvailability,competitionToolExports:watch.competitionToolExports,
    coordination:{execute:async input=>input.continuation
      ?{kind:'text',text:'Synthetic watch accepted',verification:'unverified'}
      :{kind:'tool_proposal',proposalId:'watch-start',toolName:proposed.descriptor.name,
        toolVersion:proposed.descriptor.version,arguments:proposed.arguments,verification:'unverified'}}});
  mail.bindApplication(application);
  changes=createDesktopConnectorChangeHost({application,namespace,readSourceAuthorization:source,
    resolveUserConversation:id=>rootConversation(id)??watch.resolveUserConversation(id),
    readWatchOrigin:id=>watch.readOrigin(id),chooser:{snapshot:()=>({ready:false}),choose:async()=>{throw Error('No choice expected');}}});
  const client=new Client(application,()=>clock);await client.connect();
  t.after(async()=>{await watch.close();await changes.close();await mail.close();await wait(()=>application.activeTaskCount===0);
    application.close();assert.ok(directory.startsWith(cache+sep));rmSync(directory,{recursive:true,force:true});});

  const expiresAt=new Date(clock+5*60_000).toISOString();
  mail.startBatch({expiresAt});
  const seededTask=await wait(()=>application.runtime.listTasks({limit:10}).items.find(item=>
    item.conversationId==='host-tool:'+namespace&&application.runtime.readToolExecutions(item.taskId).length));
  await wait(()=>['succeeded','failed','cancelled'].includes(application.runtime.getTask(seededTask.taskId).state));
  assert.equal(application.runtime.getTask(seededTask.taskId).state,'succeeded',JSON.stringify(application.runtime.getTask(seededTask.taskId).error));
  assert.equal((await mail.refresh()).status,'complete');
  assert.equal(fetches.length,1);
  assert.equal(fetches[0].cursor,undefined);

  proposed={descriptor:watch.tools.find(tool=>tool.descriptor.name==='connector.watch.start').descriptor,
    arguments:{source:'mail',intervalMs:1000,expiresAt}};
  const started=await client.call('task.submit',{goal:'持续关注这个邮箱的新邮件',conversationId},{idempotencyKey:'audit-mail-watch'});
  await wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(application.runtime.getTask(started.taskId).state));
  assert.equal(application.runtime.getTask(started.taskId).state,'succeeded',JSON.stringify(application.runtime.getTask(started.taskId).error));
  const startExecution=application.runtime.readToolExecutions(started.taskId).find(item=>item.toolName==='connector.watch.start');
  assert.equal(startExecution.state,'confirmed');

  async function poll({beforeObserve}={}){
    lastReadTaskId=undefined;
    await watch.tick();
    const readId=await wait(()=>lastReadTaskId);
    await wait(()=>['succeeded','failed','cancelled'].includes(application.runtime.getTask(readId).state));
    assert.equal(application.runtime.getTask(readId).state,'succeeded',JSON.stringify(application.runtime.getTask(readId).error));
    const intent=application.runtime.loadCheckpoint(readId,'host-tool-intent');
    assert.equal(intent.toolName,'mail.inbox');
    assert.equal(application.runtime.loadCheckpoint(readId,'mail-read-session')!==undefined,true);
    assert.equal(watch.readOrigin(readId)?.watchId,watch.snapshot().watches[0].watchId);
    beforeObserve?.({readId,intent,read:application.readHostToolTask(readId)});
    changes.observeTask(readId);
    assert.equal((await mail.refresh()).status,'complete');
    await watch.tick();
    return {readId,intent,read:application.readHostToolTask(readId)};
  }
  const empty=await poll({beforeObserve:({readId,intent,read})=>{
    const runtime=application.runtime,key='mail-triage-persisted-cursor-v1';
    const anchor=runtime.loadCheckpoint(readId,key);
    assert.equal(anchor.version,1);
    assert.equal(anchor.savedCursor,'91:5');
    assert.equal(anchor.firstPageTaskId,readId);
    assert.equal(anchor.runId,read.confirmed.runId);
    assert.equal(anchor.sessionId,runtime.loadCheckpoint(readId,'mail-read-session'));
    assert.equal(anchor.commandId,intent.commandId);
    assert.equal(anchor.argumentsDigest,intent.argumentsDigest);
    const origin=runtime.loadCheckpoint(readId,'desktop-connector-watch-origin');
    // A missing private attestation models a host path that never called
    // prepareAuthorization. Mismatched lease, watch and intent are also inert.
    for(const [checkpoint,value] of [
      [key,null],
      [key,{...anchor,sessionId:randomUUID()}],
      ['desktop-connector-watch-origin',{...origin,watchId:randomUUID()}],
      ['host-tool-intent',{...intent,commandId:'unrelated-read'}],
    ]) {
      runtime.saveCheckpoint(readId,checkpoint,value);
      changes.observeTask(readId);
      const state=createRuntimeAtomicStatePort(runtime,'desktop-connector-changes').read(digest(namespace)).value;
      assert.equal(Object.values(state.sources)[0]?.initialized,false);
      assert.equal(Object.values(state.sources)[0]?.maxUid??0,0);
      assert.equal(changes.snapshot().pending,0);
      runtime.saveCheckpoint(readId,checkpoint,checkpoint===key?anchor:
        checkpoint==='host-tool-intent'?intent:origin);
    }
  }});
  assert.equal(empty.intent.arguments.cursor,'91:5');
  assert.deepEqual(empty.read.confirmed.result.items,[]);
  assert.equal(empty.read.confirmed.result.nextCursor,'91:5');
  assert.equal(empty.read.confirmed.result.hasMore,false);
  const atomic=createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes');
  const first=atomic.read(digest(namespace)).value;
  assert.equal(Object.values(first.sources).length,1);
  assert.equal(Object.values(first.sources)[0].initialized,true);
  assert.equal(Object.values(first.sources)[0].maxUid,5);
  assert.equal(changes.snapshot().pending,0);

  clock+=1001;
  provider=new FakeMailProvider({inbox:[row(5,'Existing mail'),row(6,'New mail after empty watch poll')],sent:[]},
    {pageSize:100,inboxUidValidity:91});
  const later=await poll();
  assert.equal(later.intent.arguments.cursor,'91:5');
  assert.deepEqual(later.read.confirmed.result.items.map(item=>item.externalId),['INBOX:6']);
  const second=atomic.read(digest(namespace)).value;
  assert.equal(Object.values(second.sources)[0].initialized,true);
  assert.equal(changes.snapshot().pending,1,
    'A genuinely new UID after the empty initial watch poll should be nominated instead of becoming its baseline');
});
