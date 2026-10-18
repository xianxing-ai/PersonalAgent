import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {notificationDigest as digest} from '@personal-agent/notifications';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopVoiceCommandHost} from '../electron/voice-command-host.js';

// Synthetic trusted final receipts exercise the real Runtime/Policy consumer.
// These are not ASR, microphone, replay-detection or physical echo evidence.
const scope={kind:'global'},policy={mode:'normal',maxInterruptions:null,windowMinutes:19,silentUntilUtc:null,
  preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null};
async function fixture(t){
  const directory=new URL('../../../.cache/voice-command-host-tests/',import.meta.url);mkdirSync(directory,{recursive:true});
  let time=Date.now(),writes=0,commandNumber=0,responses=0,loseReply=false;
  const notifications=createDesktopNotificationApplicationHost({namespace:'voice-fixture',now:()=>time,
    channel:{async sendAdvisoryNotification(){throw Error('No fixture device');},readDeliveryOutcome(){}}});
  const tool={descriptor:{name:'fixture.write',version:'1',inputSchema:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}},
    outputSchema:{type:'object'},sideEffect:'local_write',requiredScopes:['fixture:write'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
    async execute(){writes++;return {written:true};}};
  const app=createRuntimeApplication({path:path.join(mkdtempSync(new URL('run-',directory)),'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'voice-fixture',
    now:()=>new Date(time),tools:[...notifications.tools,tool]});
  const client=new Client(app,()=>time);await client.connect();notifications.bindApplication(app,client);
  const voice=createDesktopVoiceCommandHost({notifications,now:()=>time,readApproval:approvalId=>{
    const approval=app.runtime.getApproval(approvalId);return {...approval,taskState:app.runtime.getTask(approval.taskId).state};
  },respondApproval:async input=>{responses++;const result=await client.call('authorization.respond',input);if(loseReply)throw Error('Synthetic lost response');return result;}});
  t.after(async()=>{while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));notifications.dispose();app.close();});
  const settings=(operationId,expectedRevision,patch)=>({operationId,expectedRevision,scope,patch});
  const prepare=settings=>voice.prepareSettings(settings,{expiresAt:new Date(time+30_000).toISOString(),summary:'是否确认当前通知参数？'});
  const final=(question,text='同意',extra={})=>({source:'live_input_audio',phase:'final',origin:'user',echo:false,sessionId:'fixture-live',utteranceId:'final-'+(++commandNumber),
    text,transcriptDigest:digest(text),startedAt:new Date(time).toISOString(),completedAt:new Date(time).toISOString(),expiresAt:question.expiresAt,
    questionId:question.questionId,questionRevision:question.revision,argumentsDigest:question.argumentsDigest,signal:new AbortController().signal,...extra});
  return {app,client,voice,notifications,settings,prepare,final,writes:()=>writes,responses:()=>responses,advance:ms=>{time+=ms;},loseReply:()=>{loseReply=true;},
    async pendingApproval(value='Original'){
      const commandId=crypto.randomUUID(),task=app.prepareHostToolTask({commandId,toolName:tool.descriptor.name,toolVersion:'1',deadline:new Date(time+30_000).toISOString()});
      app.finalizeHostToolTask({taskId:task.taskId,commandId,expectedTaskRevision:task.revision,arguments:{value}});
      while(app.runtime.getTask(task.taskId).state!=='waiting_approval')await new Promise(resolve=>setTimeout(resolve,5));
      const approval=app.runtime.getApproval('host-tool-'+task.taskId);return {task,approval};
    }};
}

test('partial, model, echo, silence, old question and substituted parameters cannot change notification settings',async t=>{
  const f=await fixture(t),settings=f.settings('settings',0,policy),question=f.prepare(settings);
  for(const extra of [{phase:'partial'},{origin:'model'},{echo:true},{source:'renderer'},
    {questionRevision:question.revision-1},{argumentsDigest:digest('changed')},{startedAt:new Date(Date.parse(question.issuedAt)-1).toISOString()}]) {
    assert.equal((await f.voice.consumeFinal(f.final(question,'同意',extra))).consumed,false);
    assert.equal(f.notifications.snapshot().policy.state,'unconfigured');
  }
  for(const text of ['   ','如果只是预览就同意','把次数改成三次再确认','可能可以']) {
    assert.equal((await f.voice.consumeFinal(f.final(question,text))).consumed,false);
  }
  const current=f.prepare(f.settings('new-settings',0,policy));
  assert.equal((await f.voice.consumeFinal(f.final(question))).consumed,false);
  const receipt=f.final(current,'可以');assert.equal((await f.voice.consumeFinal(receipt)).state,'confirmed');
  assert.equal(f.notifications.snapshot().policy.revision,1);
  assert.equal((await f.voice.consumeFinal(receipt)).consumed,false);
});

test('a current UI change invalidates the old voice question and expired finals never authorize',async t=>{
  const f=await fixture(t);await f.notifications.configureSettings(f.settings('initial',0,policy));
  const question=f.prepare(f.settings('silence',1,{mode:'silent'}));
  await f.notifications.configureSettings(f.settings('changed',1,{maxInterruptions:0}));
  assert.equal((await f.voice.consumeFinal(f.final(question))).reason,'current_parameters_changed');
  assert.equal(f.notifications.snapshot().policy.effective.mode,'normal');
  const expired=f.prepare(f.settings('expired',2,{mode:'silent'}));f.advance(30_001);
  assert.equal((await f.voice.consumeFinal(f.final(expired))).consumed,false);
  assert.equal(f.notifications.snapshot().policy.effective.mode,'normal');
});

test('voice questions validate both exclusive settings shapes and natural confirmation applies the actual legacy digest without a new global policy',async t=>{
  const f=await fixture(t),legacyScope={kind:'connector',connectorId:'productivity'};
  const legacy={operationId:'spoken-legacy',expectedRevision:0,scope:legacyScope,legacyPolicy:{digest:{windowMs:60000,maxItems:2,sources:['productivity']}}};
  for(const input of [{operationId:'neither',expectedRevision:0,scope:legacyScope},{...legacy,patch:{mode:'silent'}},
    {...legacy,legacyPolicy:{quietHours:{startLocal:'22:00',endLocal:'22:00',timeZone:'UTC'}}},
    {...legacy,legacyPolicy:{digest:{windowMs:1,maxItems:2}}}]) assert.throws(()=>f.prepare(input));
  const typed=f.prepare(f.settings('typed-question',0,policy));assert.match(typed.summary,/"patch"/);
  const question=f.prepare(legacy);assert.match(question.summary,/"legacyPolicy"/);assert.match(question.summary,/"maxItems":2/);
  assert.equal((await f.voice.consumeFinal(f.final(typed))).consumed,false);
  assert.equal((await f.voice.consumeFinal(f.final(question,'可以'))).state,'confirmed');
  assert.deepEqual(f.notifications.getLegacyPolicy(legacyScope).policy,legacy.legacyPolicy);
  assert.equal(f.notifications.snapshot().policy.state,'unconfigured');
  assert.equal((await f.voice.consumeFinal(f.final(question))).consumed,false);
});

test('changing old Todo settings invalidates its prior voice question and typed-to-legacy digest replacement never authorizes',async t=>{
  const f=await fixture(t),legacyScope={kind:'connector',connectorId:'productivity'};
  f.notifications.restoreLegacySettings({digest:{windowMs:60000,maxItems:3}});
  const legacy={operationId:'old-legacy-question',expectedRevision:1,scope:legacyScope,legacyPolicy:{digest:{windowMs:60000,maxItems:2}}};
  const original=f.prepare(legacy);
  await f.notifications.configureLegacySettings({digest:{windowMs:60000,maxItems:1}});
  assert.equal((await f.voice.consumeFinal(f.final(original))).reason,'current_parameters_changed');
  assert.equal(f.notifications.getLegacyPolicy(legacyScope).policy.digest.maxItems,1);
  const typed=f.prepare(f.settings('typed-question',0,policy));
  const replacement=f.final(typed,'同意',{argumentsDigest:digest(legacy)});
  assert.equal((await f.voice.consumeFinal(replacement)).reason,'stale_or_untrusted_final');
  assert.equal(f.notifications.snapshot().policy.state,'unconfigured');
});

test('natural final confirmation consumes the current original Runtime approval and exact digest once',async t=>{
  const f=await fixture(t),{task,approval}=await f.pendingApproval();
  const question=f.voice.prepareApproval({approvalId:approval.approvalId,expectedRevision:approval.revision});
  const result=await f.voice.consumeFinal(f.final(question,'确认'));
  assert.equal(result.state,'confirmed');
  while(f.app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.responses(),1);assert.equal(f.writes(),1);assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');
  assert.equal(f.app.runtime.getApproval(approval.approvalId).argumentsDigest,digest({value:'Original'}));
});

test('changed approval revisions reject old final; an explicit no uses original deny and never executes',async t=>{
  const f=await fixture(t),first=await f.pendingApproval('First');
  const question=f.voice.prepareApproval({approvalId:first.approval.approvalId,expectedRevision:1});
  await f.client.call('authorization.respond',{approvalId:first.approval.approvalId,expectedRevision:1,decision:'deny'});
  assert.equal((await f.voice.consumeFinal(f.final(question))).consumed,false);assert.equal(f.writes(),0);
  const second=await f.pendingApproval('Second');const current=f.voice.prepareApproval({approvalId:second.approval.approvalId,expectedRevision:1});
  assert.equal((await f.voice.consumeFinal(f.final(current,'不同意'))).state,'confirmed');
  assert.equal(f.app.runtime.getApproval(second.approval.approvalId).state,'denied');assert.equal(f.writes(),0);
});

test('lost authorization response stays unknown until original approval readback; it is not resent',async t=>{
  const f=await fixture(t),{approval}=await f.pendingApproval();f.loseReply();
  const question=f.voice.prepareApproval({approvalId:approval.approvalId,expectedRevision:1}),receipt=f.final(question);
  assert.equal((await f.voice.consumeFinal(receipt)).state,'unknown');
  assert.equal((await f.voice.consumeFinal(receipt)).consumed,false);assert.equal(f.responses(),1);
  assert.equal(f.voice.reconcile().state,'confirmed');
});
