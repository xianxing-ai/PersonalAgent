import test from 'node:test';
import assert from 'node:assert/strict';
import {QQMailProvider,register} from '../dist/index.js';

// Explicit offline IMAP/SMTP fixtures: no account login, socket, or real recipient.
const archiveInput={folder:'INBOX',uid:3,uidValidity:19,messageId:'<original@example.invalid>',idempotencyKey:'original-archive'};
function fixture({missingMap=false,wrongDestination=false}={}) {
  const provider=new QQMailProvider({user:'fixture@qq.com',authCode:'offline-unused'});
  let moved=false,moves=0,selected='INBOX';
  const client={usable:true,capabilities:new Map([['MOVE',true],['UIDPLUS',true]]),mailbox:{uidValidity:19n},list:async()=>[{path:'Archive',specialUse:'\\Archive'}],
    async getMailboxLock(folder){selected=folder;client.mailbox={uidValidity:folder==='INBOX'?19n:20n};return {release(){}};},
    async fetchOne(uid){if(selected==='INBOX')return moved?false:{uid:3,envelope:{messageId:archiveInput.messageId}};
      return {uid:Number(uid),envelope:{messageId:wrongDestination?'<other@example.invalid>':archiveInput.messageId}};},
    async messageMove(uid,destination,options){moves++;assert.equal(uid,'3');assert.equal(destination,'Archive');assert.deepEqual(options,{uid:true});moved=true;
      return {path:'INBOX',destination,uidValidity:20n,...(missingMap?{}:{uidMap:new Map([[3,41]])})};},close(){}};
  provider.client=client;
  return {provider,client,moves:()=>moves};
}

test('actual archive port moves once and verifies source absence plus exact destination identity',async()=>{
  const f=fixture(),result=await f.provider.archive('fixture',archiveInput);
  assert.deepEqual(result,{actionId:'mail-archive:original-archive',state:'confirmed',externalId:'Archive:41',evidenceRefs:[]});
  assert.deepEqual(await f.provider.archive('fixture',archiveInput),result);assert.equal(f.moves(),1);
  await assert.rejects(f.provider.archive('fixture',{...archiveInput,uid:4}),{code:'INVALID_ARGUMENT'});
});

test('archive unknown never repeats MOVE and changed epoch/cancellation never starts it',async()=>{
  for(const config of [{missingMap:true},{wrongDestination:true}]){
    const f=fixture(config);assert.equal((await f.provider.archive('fixture',archiveInput)).state,'unknown');
    assert.equal((await f.provider.archive('fixture',archiveInput)).state,'unknown');assert.equal(f.moves(),1);
  }
  const f=fixture();await assert.rejects(f.provider.archive('fixture',{...archiveInput,uidValidity:18}),{code:'CURSOR_EXPIRED'});
  assert.equal(f.moves(),0);await assert.rejects(f.provider.archive('fixture',{...archiveInput,idempotencyKey:'cancelled'},
    {signal:AbortSignal.abort()}),{code:'CANCELLED'});assert.equal(f.moves(),0);
  f.client.capabilities.delete('MOVE');await assert.rejects(f.provider.archive('fixture',{...archiveInput,idempotencyKey:'no-native-move'}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.moves(),0);
});

test('SMTP cancellation after dispatch retains original Message-ID and never sends again',async()=>{
  const f=fixture(),controller=new AbortController();let sends=0;
  f.provider.transporter={sendMail(){sends++;queueMicrotask(()=>controller.abort());return new Promise(()=>{});},close(){}};
  const input={to:'recipient@example.invalid',subject:'Fixture',text:'Never leaves fixture',timeoutMs:1000,idempotencyKey:'send-original'};
  const result=await f.provider.send('fixture',input,{signal:controller.signal});
  assert.equal(result.state,'unknown');assert.match(result.messageId,/^<pa-/);
  assert.deepEqual(await f.provider.send('fixture',input),result);assert.equal(sends,1);
  await assert.rejects(f.provider.send('fixture',{...input,idempotencyKey:'cancelled'}, {signal:AbortSignal.abort()}),{code:'CANCELLED'});
  assert.equal(sends,1);
});

test('public send/archive descriptors require their own scopes and bind idempotency to the actual run',async()=>{
  const f=fixture(),tools=new Map();let sendKey;
  f.provider.send=async(_account,input)=>{sendKey=input.idempotencyKey;return {state:'confirmed',messageId:'<fixture@example.invalid>'};};
  const release=register({register(tool){tools.set(tool.descriptor.name,tool);return ()=>tools.delete(tool.descriptor.name);}},
    {provider:f.provider,accountRef:'fixture'});
  const context={taskId:'task',runId:'original-run',signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()};
  assert.deepEqual(tools.get('mail.send').descriptor.requiredScopes,['mail:send']);
  assert.deepEqual(tools.get('mail.archive').descriptor.requiredScopes,['mail:archive']);
  assert.equal(tools.get('mail.send').descriptor.recoverySupport,false);
  const sent=await tools.get('mail.send').execute({to:'recipient@example.invalid',subject:'Fixture',text:'Fixture'},context);
  assert.equal(sendKey,'original-run');assert.equal(sent.state,'confirmed');
  await assert.rejects(tools.get('mail.send').execute({to:'recipient@example.invalid',subject:'Fixture',text:'Fixture'},
    {...context,signal:AbortSignal.abort()}),{code:'CANCELLED'});
  release();assert.equal(tools.size,0);
});
