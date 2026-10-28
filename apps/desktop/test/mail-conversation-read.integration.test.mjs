import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {AuthorizationQuestions,createQQMailTriageHost,createRuntimeApplication} from '@personal-agent/runtime/application';
import {FakeMailProvider,QQMailProvider} from '@personal-agent/mail';
import {LayaTriageService} from '@personal-agent/cognition';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createEncryptedModuleStorage} from '../electron/encrypted-module-storage.js';
import {createMailConfig} from '../electron/mail-config.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';

const cache=new URL('../../../.cache/mail-conversation-read-integration/',import.meta.url);
mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const wait=async check=>{for(let index=0;index<400;index++){
  const result=check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,5));
}assert.fail('Synthetic mailbox conversation did not settle');};
const CONVERSATION='Synthetic mail conversation';

/** Only the mailbox and classifier are Synthetic; authorization, storage and execution are production code. */
async function composition(t){
  const directory=mkdtempSync(new URL('run-',cache)),fetches=[],prepared=[];
  let application,clock=Date.now(),conversationReads=0;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,namespace:'synthetic-mailbox-user',resolveConversation:()=>CONVERSATION,
    now:()=>clock,available:()=>true,
    profiles:[{ref:'application',label:'Application tools; no external process',mode:'workspace-write',revision:1,available:true}],
    defaultProfileRef:'application'});
  const config=createMailConfig({userData:directory,safeStorage,namespace:'synthetic-mailbox-user',question,now:()=>clock});
  await config.configure({user:'synthetic@qq.com',authCode:'SyntheticOnlyAuthCode'});
  config.markBound(config.current().revision);
  const mailbox=new FakeMailProvider({inbox:Array.from({length:101},(_,index)=>({uid:index+1,folder:'INBOX',from:'synthetic@example.invalid',
    to:'synthetic@qq.com',subject:'Synthetic meeting '+index,sentAt:'2026-10-21T00:00:00Z',seen:false})),sent:[]},{pageSize:100});
  t.mock.method(QQMailProvider.prototype,'fetchPage',async(account,input)=>{
    fetches.push({account,folder:input.folder,limit:input.limit,cursor:structuredClone(input.cursor)});
    return mailbox.fetchPage(account,input);
  });
  const classifier=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
    ['category_'+index,{choice:'meeting',probabilities:{meeting:.9,other:.1},answer_confidence:.9,confidence:.9}],
    ['impact_'+index,{choice:'routine',probabilities:{routine:.9,high_impact:.1},answer_confidence:.9,confidence:.9}],
  ]))};}});
  const host=createQQMailTriageHost({user:'synthetic@qq.com',authCode:'SyntheticOnlyAuthCode',accountRef:'desktop-qq-inbox',
    namespace:'synthetic-mailbox-user',storage:createEncryptedModuleStorage({userData:directory,safeStorage,filename:'classification.json'}),
    triage:classifier,labels:{meeting:'Synthetic meeting',other:'Other'},isSessionAllowed:()=>false,
    batchAuthorization:{...config.batchAuthorization,preparePage(scope,batch,parent){
      prepared.push({scope,batch:structuredClone(batch),parent});
      return config.batchAuthorization.preparePage(scope,batch,parent);
    }}});
  const connector=createConnectorConversationTools({mail:config,localInbox:host.tools[0],
    getApplication:()=>application,resolveConversation:taskId=>{
      try {const task=application.runtime.getTask(taskId);return task.conversationId===CONVERSATION?CONVERSATION:undefined;}
      catch{return undefined;}
    },question});
  const inboxVersion=host.tools[0].descriptor.version;
  application=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'synthetic-mailbox-user',now:()=>new Date(clock),tools:connector.tools,
    competitionToolAvailability:connector.competitionToolAvailability,competitionToolExports:connector.competitionToolExports,
    prepareCompetitionToolExport:scope=>connector.prepareExport(scope),
    requiresToolAuthorization:scope=>question.requiresAuthorization(scope),
    requestToolAuthorization:scope=>{host.prepareAuthorization(scope);return question.requestToolAuthorization(scope);},
    coordination:{async execute(request){
      if(request.continuation)return {kind:'text',text:'Synthetic conversation summary',verification:'mock'};
      conversationReads++;
      return {kind:'tool_proposal',proposalId:'proposal-'+request.taskId+'-'+conversationReads,toolName:'mail.inbox',
        toolVersion:inboxVersion,arguments:{account:'desktop-qq-inbox',folder:'INBOX',limit:20},verification:'unverified'};
    }}});
  host.bindApplication(application);
  const client=new Client(application);
  await client.connect();
  const fixture={application,question,config,host,connector,client,fetches,prepared,
    deadline:new Date(clock+60_000).toISOString(),
    async completeBatch(){
      host.startBatch({expiresAt:fixture.deadline});
      const card=await wait(()=>question.snapshot().find(item=>item.state==='pending'));
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
      await wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(application.runtime.getTask(card.taskId).state));
      assert.equal(application.runtime.getTask(card.taskId).state,'succeeded',JSON.stringify(application.runtime.getTask(card.taskId).error));
      await host.refresh();
      await wait(()=>prepared.length===2&&application.runtime.getTask(prepared[1].scope.taskId).state==='succeeded');
      const completed=await host.refresh();
      assert.equal(completed.status,'complete');
      assert.equal(fetches.length,2,'the batch itself reads its two pages');
      return card;
    },
    async ask(goal,key){
      return client.call('task.submit',{goal,conversationId:CONVERSATION},{idempotencyKey:key,timeoutMs:120_000});
    }};
  t.after(async()=>{await host.close();question.close();connector.close();await wait(()=>application.activeTaskCount===0);application.close();});
  return fixture;
}

test('a conversation mail.inbox read inside the retained batch binding gets its own card and executes after the batch completes',async t=>{
  const f=await composition(t);await f.completeBatch();
  const submitted=await f.ask('看看邮箱里的新邮件','conversation-1');
  const card=await wait(()=>f.question.snapshot().find(item=>item.state==='pending'&&item.taskId===submitted.taskId));
  assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export'],
    'the conversation read asks its own connector-session card; it never derives a batch page');
  assert.match(card.requirements[1].summary,/访问本任务所需的已配置邮箱范围/);
  f.question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  await wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(f.application.runtime.getTask(submitted.taskId).state));
  assert.equal(f.application.runtime.getTask(submitted.taskId).state,'succeeded',
    JSON.stringify(f.application.runtime.getTask(submitted.taskId).error));
  assert.equal(f.fetches.length,3,'the conversation read fetched its own page without disturbing the finished batch');
  assert.deepEqual(f.fetches[2],{account:'desktop-qq-inbox',folder:'INBOX',limit:20,cursor:undefined});
  const record=f.application.runtime.readToolExecutions(submitted.taskId).find(item=>item.toolName==='mail.inbox');
  assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  assert.equal((await f.host.refresh()).status,'complete','completed batches still do not continue polling');
});

test('revoking the batch refuses a conversation read with its true cause instead of the generic revision-conflict mask',async t=>{
  const f=await composition(t);await f.completeBatch();
  await f.config.revoke();
  const submitted=await f.ask('看看邮箱里的新邮件','conversation-2');
  await wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(f.application.runtime.getTask(submitted.taskId).state));
  const task=f.application.runtime.getTask(submitted.taskId);
  assert.equal(task.state,'failed');
  assert.equal(task.error.code,'REVISION_CONFLICT','the code stays the runtime invalidation; the message carries the true cause');
  assert.equal(task.error.message,'Mail conversation read is outside the active manual batch',
    'the fixed host refusal is reported instead of the misleading re-ask instruction');
  assert.equal(f.fetches.length,2,'a refused conversation read never reaches the provider');
});

test('authorization invalidation does not expose arbitrary private host errors',async t=>{
  const f=await composition(t);await f.completeBatch();
  const submitted=await f.ask('看看邮箱里的新邮件','conversation-private-cause');
  const card=await wait(()=>f.question.snapshot().find(item=>item.state==='pending'&&item.taskId===submitted.taskId));
  f.application.runtime.invalidatePendingApproval(card.sourceApprovalId,'stale',new Error('Synthetic private credential and mailbox detail'));
  const task=f.application.runtime.getTask(submitted.taskId);
  assert.equal(task.state,'failed');
  assert.equal(task.error.message,'原授权请求已失效，本次操作未执行；请在当前对话重新提出。');
  assert.equal(f.fetches.length,2);
});

