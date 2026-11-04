import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {HttpFeedProvider} from '@personal-agent/feeds';
import {createProactiveHostProofs} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createCloudRuntimeFeeds} from './cloud-runtime-feeds.mjs';

const until=async predicate=>{for(let n=0;n<100;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Fixture source worker did not settle');};
function fixture({empty=false}={}) {
  mkdirSync('.cache',{recursive:true});const directory=resolve(mkdtempSync(join('.cache','cloud-feeds-'))),namespace='cloud-feeds-fixture';
  let app,calls=0,clock=Date.now();const provider=new HttpFeedProvider({fetchImpl:async()=>{
    calls++;return {status:empty&&calls>1?304:200,headers:{get:()=>null},body:null,text:async()=>
      '<rss version="2.0"><channel><title>Fixture</title>'+ (empty?'':'<item><guid>one</guid><title>Public fixture</title><link>https://example.org/one</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>')+'</channel></rss>'};
  }});
  const feeds=createCloudRuntimeFeeds({getApplication:()=>app,namespace,assertCurrent(){},provider,now:()=>clock,
    subscriptions:[{id:'public-feed',title:'Explicit offline public feed',url:'https://example.org/feed',intervalSeconds:60}]});
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
    proactiveWorkflows:true,tools:feeds.tools,hostOnlyTools:['feeds.collect'],now:()=>new Date(clock)});
  const source=app.runtime.submitTask({goal:'Track this public fixture',conversationId:'cloud-user:fixture',idempotencyKey:'source'});
  const task=app.runtime.submitTask({goal:source.goal,conversationId:source.conversationId,idempotencyKey:'responsibility'});
  const deadline=new Date(Date.now()+300_000).toISOString(),binding={taskId:task.taskId,sourceTaskId:source.taskId,sessionId:'fixture-session',
    taskDeadline:deadline,goalDigest:createHash('sha256').update(source.goal).digest('hex')};
  const proofs=createProactiveHostProofs('explicit-offline-public-source-proof-32');
  const host=app.createProactiveWorkflowHost({...binding,contractRef:'fixture-contract',advancePort:async()=>assert.fail('No cloud calls in source fixture'),
    verifyAdvance:()=>false,sign:proofs.sign,localDeviceAvailable:()=>false});
  const context={deadline,signal:new AbortController().signal};host.ingestUserInstruction({sourceTaskId:source.taskId},context);
  feeds.bindWorkflow({snapshot:()=>({state:'configured_not_verified'}),readBinding:id=>{assert.equal(id,task.taskId);return binding;},
    acquireMaintenance:async()=>({host,binding})});
  return {app,feeds,binding,context,source,task,host,namespace,calls:()=>calls,advance:()=>{clock+=60_001;},close(){feeds.close();app.close();}};
}
test('cloud feed tracking preserves original manual Policy, original scheduled read and unverified transport boundary',async()=>{
  const f=fixture(),{app,feeds,binding,context,source,task,namespace}=f;
  try {
    const choice=feeds.snapshot(binding)[0];
    assert.equal((await feeds.maintain(binding,context)).state,'unavailable');assert.equal(f.calls(),0);
    feeds.configure(binding,{action:'track',sourceId:choice.sourceId,configurationRef:choice.configurationRef,expectedRevision:0,readAndCloudConsent:true},'native-choice');
    await feeds.maintain(binding,context);
    const readTaskId=feeds.approvalTaskIds(binding)[0];
    await until(()=>app.readHostToolTask(readTaskId).task.state==='waiting_approval');
    assert.equal(f.calls(),0,'Tracking does not automatically approve a tool');
    feeds.restrict(binding,'pause');assert.equal(app.runtime.getTask(readTaskId).state,'waiting_approval');
    await feeds.maintain(binding,context);assert.deepEqual(feeds.approvalTaskIds(binding),[readTaskId]);
    assert.equal(app.runtime.listSchedules('host-tool:'+namespace).length,1);
    assert.throws(()=>feeds.assertReadCurrent(binding,source.taskId),{code:'UNAUTHORIZED'});
    const read=app.readHostToolTask(readTaskId);app.runtime.respondApproval(read.approval.approvalId,'allow_once',read.approval.revision);
    app.resumeHostToolTask(readTaskId);await until(()=>app.runtime.getTask(readTaskId).state==='succeeded');
    assert.equal(f.calls(),1);
    feeds.restrict(binding,'pause');assert.notEqual(app.runtime.getTask(readTaskId).cancelRequested,true,'Pause preserves the confirmed original result');
    assert.equal((await feeds.maintain(binding,context)).state,'unavailable','Injected HTTP is never a verified native public source');
    await feeds.maintain(binding,context);assert.equal(f.calls(),1,'An unconfirmed ingress never creates another read');
    assert.equal(feeds.snapshot(binding)[0].state,'waiting_reconciliation');
    assert.equal(app.runtime.listSchedules('host-tool:'+namespace).length,1);
    feeds.configure(binding,{action:'revoke',sourceId:choice.sourceId,configurationRef:choice.configurationRef,expectedRevision:1},'native-revoke');
    assert.equal(feeds.snapshot(binding)[0].state,'revoked');assert.equal(app.runtime.getTask(task.taskId).cancelRequested,true);
    assert.deepEqual(feeds.approvalTaskIds(binding),[readTaskId],'Historical child remains available for readback');
  }finally{f.close();}
});

test('confirmed empty and 304 reads advance the original cursor; pause keeps an unsent scheduled identity',async()=>{
  const f=fixture({empty:true}),{app,feeds,binding,context,host,namespace}=f;
  try {
    const choice=feeds.snapshot(binding)[0];
    feeds.configure(binding,{action:'track',sourceId:choice.sourceId,configurationRef:choice.configurationRef,expectedRevision:0,readAndCloudConsent:true},'empty-choice');
    await feeds.maintain(binding,context);
    const first=feeds.approvalTaskIds(binding)[0];
    const approve=async id=>{await until(()=>app.readHostToolTask(id).task.state==='waiting_approval'&&app.activeTaskCount===0);
      const read=app.readHostToolTask(id);app.runtime.respondApproval(read.approval.approvalId,'allow_once',read.approval.revision);
      app.resumeHostToolTask(id);await until(()=>app.runtime.getTask(id).state==='succeeded');};
    await approve(first);assert.equal((await feeds.maintain(binding,context)).state,'no_changes');
    assert.equal((await feeds.maintain(binding,context)).state,'scheduled');
    const next=feeds.approvalTaskIds(binding)[0],schedule=app.runtime.listSchedules('host-tool:'+namespace).find(value=>value.status==='pending');
    assert.notEqual(next,first);assert.equal(app.runtime.getTask(next).state,'created');assert.ok(schedule);
    feeds.restrict(binding,'pause');
    assert.equal(app.runtime.getTask(next).state,'created');assert.equal(app.runtime.getSchedule(schedule.scheduleId).status,'pending');
    assert.equal((await feeds.maintain(binding,context)).state,'scheduled');assert.deepEqual(feeds.approvalTaskIds(binding),[next]);
    assert.equal(f.calls(),1);f.advance();await feeds.maintain(binding,context);
    const intent=app.runtime.loadCheckpoint(next,'host-tool-intent');assert.ok(intent.arguments.cursor,'Original nextCursor reaches the next exact read');
    await approve(next);assert.equal((await feeds.maintain(binding,context)).state,'no_changes');assert.equal(f.calls(),2);
    assert.equal(Object.values(host.inspect().application.state.entries).filter(value=>value.event.entry==='connector').length,0,
      'Empty and 304 observations do not manufacture source.changed evidence');
  }finally{f.close();}
});
