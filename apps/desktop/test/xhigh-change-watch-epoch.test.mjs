import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {FakeMailProvider,register as registerMail} from '@personal-agent/mail';
import {createConnectorReadOrigin} from '../electron/connector-read-origin.js';
import {createDesktopConnectorChangeHost} from '../electron/connector-change-host.js';

// Actual SQLite, Runtime, Policy, ToolGateway and MailService; explicit synthetic
// mailbox, local chooser and notification receipt ports. No remote or OS calls.
async function fixture(t) {
  const root=resolve('.cache/xhigh-change-watch-20261026/tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'epoch-')),namespace='synthetic-change-epoch';
  let clock=Date.now(),epoch=17,sequence=0,application,host,origin,choice='notify',heldFetch;
  const choices=[],notifications=[],batches=new Map(),inbox=[];
  const message=uid=>({uid,folder:'INBOX',from:'synthetic@example.invalid',to:'fixture@example.invalid',
    subject:'Synthetic epoch '+epoch+' mail '+uid,sentAt:new Date(clock).toISOString(),
    messageId:'<epoch-'+epoch+'-'+uid+'@example.invalid>',seen:false});
  inbox.push(message(1));
  const provider=new FakeMailProvider({inbox:[],sent:[]});
  provider.fetchPage=async(account,input)=>{
    const held=heldFetch;if(held){heldFetch=undefined;held.enter();await held.gate;}
    return new FakeMailProvider({inbox,sent:[]},{inboxUidValidity:epoch,pageSize:100}).fetchPage(account,input);
  };
  const selected=()=>({state:'selected',eligibleForRuntime:true,selected:{id:'notify',revision:1},reason:'Explicit synthetic notify',
    receipt:{id:createHash('sha256').update('synthetic-'+choices.length).digest('hex')}});
  function open(){
    const tools=[];registerMail({register(tool){tools.push(tool);return()=>{};}},{provider,accountRef:'synthetic-mail',now:()=>clock});
    application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
      tools,automaticTools:[{toolName:'mail.inbox',toolVersion:tools.find(tool=>tool.descriptor.name==='mail.inbox').descriptor.version}],now:()=>new Date(clock)});
    origin=createConnectorReadOrigin({getApplication:()=>application,readSourceAuthorization:()=>({available:true,configurationRef:'synthetic-config'})});
    host=createDesktopConnectorChangeHost({application,namespace,now:()=>clock,
      readSourceAuthorization:()=>({available:true,configurationRef:'synthetic-config'}),resolveUserConversation:()=> 'desktop:synthetic',
      readOriginalSourceBinding:id=>origin.read(id),
      chooser:{snapshot:()=>({ready:true}),async choose(input){choices.push(JSON.parse(input.context));return typeof choice==='function'?choice(input):selected();}},
      notifications:{getInterruptionPolicy:()=>({effective:{mode:'banner'}}),
        ingest(items){for(const item of items)batches.set(item.externalId,{id:'batch-'+item.externalId,itemRefs:[item.externalId]});},
        drain:()=>({batches:[...batches.values()]}),
        async deliverBatch(input){notifications.push(structuredClone(input));return {attempts:{banner:{state:'delivered'}}};}}});
  }
  async function close(){await host.close();assert.equal(application.activeTaskCount,0);application.close();}
  open();t.after(async()=>{await close();assert.ok(directory.startsWith(root));rmSync(directory,{recursive:true,force:true});});
  const state=()=>createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes')
    .read(createHash('sha256').update(JSON.stringify(namespace)).digest('hex'))?.value;
  async function read({observe=true,args={},advanceMs=1000}={}){
    clock+=advanceMs;
    const commandId='synthetic-mail-'+(++sequence),toolVersion=application.tools.list().find(tool=>tool.name==='mail.inbox').version;
    const task=application.prepareHostToolTask({commandId,toolName:'mail.inbox',toolVersion,deadline:new Date(clock+60000).toISOString()});
    origin.bind({taskId:task.taskId,conversationId:'desktop:synthetic'});
    application.finalizeHostToolTask({taskId:task.taskId,commandId,expectedTaskRevision:task.revision,arguments:{account:'synthetic-mail',...args}});
    await application.waitForHostToolTask(task.taskId);
    const result=application.readHostToolTask(task.taskId);assert.equal(result.task.state,'succeeded');assert.ok(result.confirmed);
    if(observe)host.observeTask(task.taskId);return result;
  }
  return {get host(){return host;},get application(){return application;},read,state,choices,notifications,
    add:uid=>inbox.push(message(uid)),rotate(nextEpoch=epoch+1){epoch=nextEpoch;inbox.splice(0,inbox.length,message(1));},
    stripEpochPointer(){const atomic=createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes');
      const key=createHash('sha256').update(JSON.stringify(namespace)).digest('hex'),saved=atomic.read(key);
      delete saved.value.mailEpochs;assert.equal(atomic.compareAndSet(key,saved.revision,saved.value),true);},
    holdNextFetch(){let release,enter;const entered=new Promise(resolve=>{enter=resolve;});
      const gate=new Promise(resolve=>{release=resolve;});heldFetch={gate,enter};return {entered,release};},
    choose:callback=>{choice=callback;},selected,async reopen(){await close();open();}};
}

test('a confirmed replacement mailbox epoch supersedes pending changes from the removed mailbox',async t=>{
  const f=await fixture(t);await f.read();f.add(2);const old=await f.read();
  const original=f.application.runtime.getTask(old.task.taskId),evidence=f.application.runtime.readEvidence(old.task.taskId);
  assert.equal(f.host.snapshot().pending,1);f.rotate();await f.read();await f.host.flush();
  assert.equal(f.choices.length,0,'old-epoch headers must not enter local inference after confirmed epoch replacement');
  assert.equal(f.notifications.length,0);assert.equal(f.host.snapshot().superseded,1);
  assert.deepEqual(f.application.runtime.getTask(old.task.taskId),original);
  assert.deepEqual(f.application.runtime.readEvidence(old.task.taskId),evidence);
  f.add(2);await f.read();await f.host.flush();
  assert.equal(f.choices.length,1);assert.match(f.choices[0].data.header,/Synthetic epoch 18 mail 2/);
  assert.equal(f.notifications.length,1,'the same UID in the new epoch remains an independent new change');
});

test('a delayed confirmed old result cannot switch the mailbox back after a newer epoch baseline',async t=>{
  const f=await fixture(t);await f.read();f.add(2);const delayed=await f.read({observe:false});
  f.rotate();await f.read();f.host.observeTask(delayed.task.taskId);await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.notifications.length,0);
  f.add(2);const fresh=await f.read();await f.host.flush();assert.equal(f.notifications.length,1);
  await f.reopen();f.host.observeTask(delayed.task.taskId);f.host.observeTask(fresh.task.taskId);await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.notifications.length,1,'reopen and replay retain the new epoch and exact dedupe');
});

test('mailbox replacement during local inference prevents late notification without altering source receipts',async t=>{
  const f=await fixture(t);await f.read();f.add(2);const source=await f.read();
  let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());f.choose(async()=>{entered();await gate;return f.selected();});
  const flushing=f.host.flush();await ready;f.rotate();await f.read();release();await flushing;
  assert.equal(f.notifications.length,0,'a choice for the previous mailbox epoch cannot reach notification delivery');
  assert.equal(f.host.snapshot().superseded,1);
  assert.equal(f.application.runtime.getTask(source.task.taskId).state,'succeeded');
  const decisions=f.application.runtime.listTasks({limit:100}).items.filter(task=>f.host.ownsDecisionTask(task.taskId));
  assert.equal(decisions.length,1);assert.equal(decisions[0].state,'failed');
  assert.equal(decisions[0].error.code,'REVISION_CONFLICT');
});

test('an older persisted host state loses stale pending work when the next confirmed epoch is lower',async t=>{
  const f=await fixture(t);await f.read();f.add(2);const old=await f.read();
  f.stripEpochPointer();f.rotate(3);await f.read();await f.host.flush();
  assert.equal(f.host.snapshot().superseded,1);assert.equal(f.choices.length,0);assert.equal(f.notifications.length,0);
  f.host.observeTask(old.task.taskId);await f.reopen();await f.host.flush();
  assert.equal(f.notifications.length,0,'replayed old receipt cannot restore the previous epoch');
  f.add(2);await f.read();await f.host.flush();
  assert.equal(f.notifications.length,1);
  assert.match(f.choices[0].data.header,/Synthetic epoch 3 mail 2/);
});

test('different epochs within one trusted clock tick fence both until a later confirmed read',async t=>{
  const f=await fixture(t);await f.read();f.add(2);await f.read({advanceMs:0});
  f.rotate(3);await f.read({advanceMs:0});await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.notifications.length,0);
  assert.equal(f.host.snapshot().superseded,1);
  await f.read();f.add(2);await f.read();await f.host.flush();
  assert.equal(f.notifications.length,1);
  assert.match(f.choices[0].data.header,/Synthetic epoch 3 mail 2/);
});

test('an earlier confirmed page observed after a newer nonfinal page still fills the first baseline',async t=>{
  const f=await fixture(t);f.add(2);f.add(3);
  const first=await f.read({observe:false,args:{limit:1}});
  const second=await f.read({args:{cursor:first.confirmed.result.nextCursor,limit:1}});
  assert.equal(first.confirmed.result.hasMore,true);assert.equal(second.confirmed.result.hasMore,true);
  f.host.observeTask(first.task.taskId);
  await f.read({args:{cursor:second.confirmed.result.nextCursor,limit:1}});
  await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,0,'baseline page one was already confirmed before the final page');
  f.add(4);await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,1);assert.match(f.choices[0].data.header,/Synthetic epoch 17 mail 4/);
});

test('a final page observed first cannot turn a delayed earlier page into new mail',async t=>{
  const f=await fixture(t);f.add(2);
  const first=await f.read({observe:false,args:{limit:1}});
  await f.read({args:{cursor:first.confirmed.result.nextCursor,limit:1}});
  f.host.observeTask(first.task.taskId);await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,0);
  f.add(3);await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,1);assert.match(f.choices[0].data.header,/Synthetic epoch 17 mail 3/);
});

test('same-millisecond page disorder remains a baseline across SQLite reopen',async t=>{
  const f=await fixture(t);f.add(2);
  const first=await f.read({observe:false,args:{limit:1}});
  await f.read({args:{cursor:first.confirmed.result.nextCursor,limit:1},advanceMs:0});
  f.host.observeTask(first.task.taskId);await f.reopen();
  await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.notifications.length,0);
});

test('a pre-pointer host state still accepts a delayed same-epoch baseline page',async t=>{
  const f=await fixture(t);f.add(2);f.add(3);
  const first=await f.read({observe:false,args:{limit:1}});
  const second=await f.read({args:{cursor:first.confirmed.result.nextCursor,limit:1}});
  f.stripEpochPointer();f.host.observeTask(first.task.taskId);
  await f.read({args:{cursor:second.confirmed.result.nextCursor,limit:1}});
  await f.read({args:{limit:100}});await f.host.flush();
  assert.equal(f.choices.length,0);
});

test('a slow earlier read carrying a higher UID still nominates that new mail',async t=>{
  const f=await fixture(t);await f.read();
  const hold=f.holdNextFetch();t.after(()=>hold.release());
  const slow=f.read({observe:false});await hold.entered;
  f.add(2);await f.read();f.add(3);hold.release();
  const late=await slow;f.host.observeTask(late.task.taskId);await f.host.flush();
  assert.deepEqual(f.choices.map(item=>item.data.header).sort(),[
    'synthetic@example.invalid → fixture@example.invalid｜未读｜Synthetic epoch 17 mail 2',
    'synthetic@example.invalid → fixture@example.invalid｜未读｜Synthetic epoch 17 mail 3']);
  assert.equal(f.notifications.length,2);
});

test('an empty read with a caller cursor cannot raise the seen-UID watermark',async t=>{
  const f=await fixture(t);await f.read();
  const empty=await f.read({args:{cursor:'17:999'}});
  assert.equal(empty.confirmed.result.items.length,0);
  assert.equal(empty.confirmed.result.nextCursor,'17:999');
  f.add(2);await f.read();await f.host.flush();
  assert.equal(f.choices.length,1);
  assert.match(f.choices[0].data.header,/Synthetic epoch 17 mail 2/);
});

test('an empty cursor-only read cannot initialize an unread mailbox baseline',async t=>{
  const f=await fixture(t);
  const empty=await f.read({args:{cursor:'17:999'}});
  assert.equal(empty.confirmed.result.items.length,0);
  await f.read();await f.host.flush();
  assert.equal(f.choices.length,0,'the first from-start read is still the baseline');
  f.add(2);await f.read();await f.host.flush();
  assert.equal(f.choices.length,1);
  assert.match(f.choices[0].data.header,/Synthetic epoch 17 mail 2/);
});
