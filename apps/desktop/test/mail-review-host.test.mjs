import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopMailReviewHost} from '../electron/mail-review-host.js';
const ref=item=>({workKey:item.workKey,sourceRevision:item.sourceRevision,projectionDigest:item.projectionDigest,receiptId:item.receipt.id});
function fixture(){
  let clock=Date.now(),configuration='configuration-a',host,submits=0,cancels=0,deliveries=0,applied=0,retries=0,consent=true;
  const states=new Map(),tasks=new Map(),checkpoints=new Map(),scopes=new Map(),records=new Map(),prepared=[];
  const items=['old','legacy','new','selected'].map(workKey=>({workKey,sourceRevision:'revision-1',projectionDigest:'digest-'+workKey,
    receipt:{id:'receipt-'+workKey},state:'pending',observedAt:workKey==='legacy'?undefined:new Date(clock-1000).toISOString(),
    projection:{headersOnly:true,sensitivity:'private',text:'PRIVATE HEADER '+workKey}}));
  const runtime={bindTrustedHostState:()=>({get:key=>structuredClone(states.get(key)),set:(key,value)=>states.set(key,structuredClone(value))}),
    loadCheckpoint:(id,key)=>checkpoints.get(id+key),readToolExecutions:id=>records.get(id)??[],getTask:id=>tasks.get(id),requestCancel:id=>{cancels++;tasks.get(id).state='cancelled';}};
  const app={runtime,submitHostToolTask(request){submits++;const task={taskId:'task-'+submits,state:'running'};tasks.set(task.taskId,task);
    checkpoints.set(task.taskId+'host-tool-intent',request);
    const scope={taskId:task.taskId,runId:'run-'+submits,toolName:request.toolName,toolVersion:request.toolVersion,
      argumentsDigest:'args',deadline:request.deadline,signal:new AbortController().signal};scopes.set(task.taskId,scope);host.prepareAuthorization(scope);return {task};},
    readHostToolTask:id=>({task:tasks.get(id)})};
  const mail={pendingReviewAnalyses:()=>items.filter(item=>item.state==='pending'),readReviewAnalysis:key=>structuredClone(items.find(item=>item.workKey===key)),
    confirmCachedAnalysisAccepted(input){const item=items.find(item=>item.workKey===input.workKey);item.state='accepted';item.taskId=input.taskId;},
    retryCachedAnalysis(input){const item=items.find(item=>item.workKey===input.workKey);assert.equal(item.taskId,input.previousTaskId);
      retries++;item.state='pending';delete item.taskId;return structuredClone(item);},
    applyCachedAnalysisReview(input){assert.equal(input.sessionId,undefined);assert.equal(tasks.get(input.taskId).state,'succeeded');applied++;return {};}};
  const question={prepare:(...args)=>prepared.push(args),prepareExport:(...args)=>prepared.push(args),currentRequirement:()=>{},authorizeExport:()=>{},authorizeConsumedExport:()=>{}};
  let notificationId;
  const notifications={ingest(rows){notificationId=rows[0].externalId;assert.equal(JSON.stringify(rows).includes('PRIVATE HEADER'),false);},
    drain:()=>({batches:[{id:'batch',itemRefs:[notificationId]}]}),deliverBatch:async input=>{
      assert.equal(input.source,'mail-cloud-review');assert.equal(JSON.stringify(input).includes('PRIVATE HEADER'),false);
      deliveries++;return {attempts:{banner:{state:'delivered'}}};}};
  const createHost=()=>createDesktopMailReviewHost({getApplication:()=>app,mail,question,readConfigurationRef:()=>configuration,
    confirmConsent:async()=>consent,getNotifications:()=>notifications,namespace:'fixture',now:()=>clock});
  host=createHost();
  return {host,items,states,tasks,checkpoints,scopes,records,prepared,runtime,counts:()=>({submits,cancels,deliveries,applied,retries}),
    setConfiguration:value=>configuration=value,setConsent:value=>consent=value,advance:()=>clock+=1000,reopen:()=>host=createHost(),
    finish(id,result={version:1,label:'work',impact:'routine',notificationRecommendation:'none',reasonCode:'work'}){
      tasks.get(id).state='succeeded';const request=checkpoints.get(id+'host-tool-intent');checkpoints.set(id+'mail-review-result:v1',{binding:request.arguments,result});}};
}
test('explicit public selection plus finite new watermark admit only scoped original tasks and apply fixed checkpoint once',async()=>{
  const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[3])]});
  f.advance();f.items[2].observedAt=new Date(Date.now()+2000).toISOString();
  await f.host.tick();assert.equal(f.counts().submits,1);assert.equal(f.items[2].state,'accepted');
  await f.host.tick();assert.equal(f.counts().submits,1,'one original review at a time');
  const {toolName:_name,toolVersion:_version,...scope}=f.scopes.get('task-1'),binding=f.checkpoints.get('task-1host-tool-intent').arguments;
  const envelope=await f.host.readEnvelope(binding,scope);assert.equal(envelope.headers.headersOnly,true);
  f.host.assertExport(binding,envelope,scope);
  assert.throws(()=>f.host.assertExport(binding,envelope,{...scope,runId:'different-run'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.assertExport(binding,envelope,{...scope,argumentsDigest:'different-args'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.assertExport(binding,{...envelope,headers:{headersOnly:true,text:'changed'}},scope),{code:'UNAUTHORIZED'});
  assert.equal(JSON.stringify([...f.states]).includes('PRIVATE HEADER'),false);
  f.finish('task-1',{version:1,label:'work',impact:'high_impact',notificationRecommendation:'notify',reasonCode:'deadline_change'});
  await f.host.tick();assert.equal(f.counts().applied,1);assert.equal(f.counts().deliveries,1);
  await f.host.tick();assert.equal(f.counts().submits,2);assert.equal(f.items[3].state,'accepted');
  await f.host.tick();assert.equal(f.counts().applied,1);
  assert.equal(f.counts().deliveries,1,'same original NotificationHost round is not sent twice');
  assert.equal(f.items[0].state,'pending');assert.equal(f.items[1].state,'pending');
  await f.host.revoke();assert.equal(f.counts().cancels,1);
  assert.throws(()=>f.host.assertExport(binding,envelope,scope),{code:'UNAUTHORIZED'});
});

test('default enabled policy initializes on the first available source and exports only subsequent observations',async()=>{
  const f=fixture();f.setConfiguration(undefined);
  assert.deepEqual(f.host.snapshot(),{enabled:true,watermark:null,pending:0,reviewed:0,failed:0});
  await f.host.tick();assert.equal(f.counts().submits,0);
  f.advance();f.setConfiguration('configuration-a');const initialized=f.host.snapshot();
  assert.ok(Number.isFinite(Date.parse(initialized.watermark)));
  await f.host.tick();assert.equal(f.counts().submits,0,'historical and missing observedAt do not become new');
  f.items[2].observedAt=initialized.watermark;
  await f.host.tick();assert.equal(f.counts().submits,1);assert.equal(f.items[2].state,'accepted');
  assert.equal(f.items[0].state,'pending');assert.equal(f.items[1].state,'pending');
  await f.host.close();
  const restored=f.reopen();assert.equal(restored.snapshot().enabled,true,'normal shutdown preserves the policy');
  await restored.tick();assert.equal(f.counts().submits,1,'cancelled original work is not dispatched again');
  await restored.revoke();const disabled=f.reopen();assert.equal(disabled.snapshot().enabled,false);
  f.advance();f.items[3].observedAt=new Date(Date.now()+10000).toISOString();
  await disabled.tick();assert.equal(f.counts().submits,1,'explicit disable survives recreation');
  await disabled.close();
});

test('temporarily unavailable configuration waits while a changed bound configuration revokes',async()=>{
  const f=fixture(),initial=f.host.snapshot();
  f.setConfiguration(undefined);await f.host.tick();assert.equal(f.host.snapshot().enabled,true);
  f.setConfiguration('configuration-a');assert.equal(f.host.snapshot().watermark,initial.watermark);
  f.items[2].observedAt=initial.watermark;await f.host.tick();assert.equal(f.counts().submits,1);
  f.setConfiguration(undefined);await f.host.tick();assert.equal(f.counts().cancels,0);
  const scope=f.scopes.get('task-1'),binding=f.checkpoints.get('task-1host-tool-intent').arguments;
  await assert.rejects(f.host.readEnvelope(binding,scope),{code:'UNAUTHORIZED'});
  f.setConfiguration('configuration-b');await f.host.tick();assert.equal(f.host.snapshot().enabled,false);
  assert.equal(f.counts().cancels,1);await f.host.close();
});
test('configuration revocation and unknown failure never redispatch original work or accept old bindings',async()=>{
  const f=fixture();await assert.rejects(f.host.configure({enabled:true,selectedBindings:[{...ref(f.items[0]),sourceRevision:'wrong'}]}),{code:'UNAUTHORIZED'});
  await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
  f.setConfiguration('configuration-b');await f.host.tick();assert.equal(f.counts().cancels,1);assert.equal(f.host.snapshot().enabled,false);
  await f.host.tick();assert.equal(f.counts().submits,1);await f.host.close();
});
test('failed tasks and stale successful sources settle without repeated cloud dispatch or metadata application',async()=>{
  for(const stale of [false,true]){
    const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
    if(stale){f.finish('task-1');f.items[0].sourceRevision='changed';}
    else f.tasks.get('task-1').state='failed';
    await f.host.tick();await f.host.tick();assert.equal(f.counts().submits,1);assert.equal(f.counts().applied,0);
    assert.equal(f.host.snapshot().failed,1);await f.host.close();
  }
});

test('explicit selection alone may retry the exact legacy before-dispatch failure after renewed consent',async()=>{
  const f=fixture(),selected=ref(f.items[0]);
  await f.host.configure({enabled:true,selectedBindings:[selected]});await f.host.tick();
  Object.assign(f.tasks.get('task-1'),{state:'failed',error:{code:'EXTERNAL_FAILURE',message:'Cloud coordination failed'}});
  f.records.set('task-1',[{taskId:'task-1',evidenceId:'host-tool-task-1',toolName:'mail.review',toolVersion:'1.0.0',
    state:'failed',executionStarted:true,policyDecision:'allow'}]);
  f.checkpoints.set('task-1mail-review-attempt:v1',{version:1,binding:selected});
  f.checkpoints.set('task-1competition-cloud-inflight',{accepted:false});
  await f.host.tick();await f.host.tick();assert.equal(f.counts().submits,1,'default ticks never retry');
  for(const [key,value] of [['competition-cloud-inflight',{accepted:true}],['competition-cloud-request-identity',null],
    ['competition-cloud-received',null],['application-profile','huawei_ict_agentarts'],['mail-review-result:v1',{}]]){
    const original=f.checkpoints.get('task-1'+key);f.checkpoints.set('task-1'+key,value);
    await assert.rejects(f.host.configure({enabled:true,selectedBindings:[selected]}),{code:'UNAUTHORIZED'});
    if(original===undefined)f.checkpoints.delete('task-1'+key);else f.checkpoints.set('task-1'+key,original);
  }
  f.setConsent(false);await assert.rejects(f.host.configure({enabled:true,selectedBindings:[selected]}),{code:'UNAUTHORIZED'});
  assert.equal(f.counts().retries,0);assert.equal(f.items[0].taskId,'task-1');
  f.setConsent(true);await f.host.configure({enabled:true,selectedBindings:[selected]});
  assert.equal(f.counts().retries,1);assert.equal(f.items[0].state,'pending');
  const history=[...f.states.values()][0].retryHistory['task-1'];
  assert.equal(history.state,'released');assert.equal(history.entry.taskId,'task-1');
  assert.equal(JSON.stringify(history).includes('PRIVATE HEADER'),false);
  await f.host.tick();await f.host.tick();assert.equal(f.counts().submits,2);
  assert.equal(f.items[0].taskId,'task-2');assert.equal(f.tasks.get('task-1').state,'failed');
  await f.host.close();
});
