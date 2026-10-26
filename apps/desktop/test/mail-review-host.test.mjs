import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopMailReviewHost} from '../electron/mail-review-host.js';
const ref=item=>({workKey:item.workKey,sourceRevision:item.sourceRevision,projectionDigest:item.projectionDigest,receiptId:item.receipt.id});
function fixture(){
  let clock=Date.now(),configuration='configuration-a',host,submits=0,cancels=0,deliveries=0,applied=0,retries=0,consent=true,
    notificationState='delivered',readbacks=0;
  const states=new Map(),tasks=new Map(),checkpoints=new Map(),scopes=new Map(),records=new Map(),prepared=[];
  const items=['old','legacy','new','selected'].map(workKey=>({workKey,sourceRevision:'revision-1',projectionDigest:'digest-'+workKey,
    receipt:{id:'receipt-'+workKey},state:'pending',observedAt:workKey==='legacy'?undefined:new Date(clock-1000).toISOString(),
    projection:{headersOnly:true,sensitivity:'private',text:'PRIVATE HEADER '+workKey}}));
  const runtime={bindTrustedHostState:()=>({get:key=>structuredClone(states.get(key)),set:(key,value)=>states.set(key,structuredClone(value))}),
    findTaskByIdempotencyKey:key=>[...tasks.values()].find(task=>key===`host-tool:${JSON.stringify(['fixture',checkpoints.get(task.taskId+'host-tool-intent')?.commandId])}`),
    loadCheckpoint:(id,key)=>checkpoints.get(id+key),readToolExecutions:id=>records.get(id)??[],getTask:id=>tasks.get(id),requestCancel:id=>{cancels++;tasks.get(id).state='cancelled';}};
  const app={runtime,submitHostToolTask(request){submits++;const task={taskId:'task-'+submits,state:'running'};tasks.set(task.taskId,task);
    checkpoints.set(task.taskId+'host-tool-intent',{...request,namespace:'fixture'});
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
      deliveries++;return {attempts:{banner:{state:notificationState}}};},
    reconcileDelivery(roundId){assert.match(roundId,/^desktop-batch-[a-f0-9]{64}$/u);readbacks++;
      return {attempts:{banner:{state:notificationState}}};}};
  const createHost=()=>createDesktopMailReviewHost({getApplication:()=>app,mail,question,readConfigurationRef:()=>configuration,
    confirmConsent:async()=>consent,getNotifications:()=>notifications,namespace:'fixture',now:()=>clock});
  host=createHost();
  return {host,items,states,tasks,checkpoints,scopes,records,prepared,runtime,counts:()=>({submits,cancels,deliveries,applied,retries,readbacks}),
    setConfiguration:value=>configuration=value,setConsent:value=>consent=value,setNotificationState:value=>notificationState=value,
    advance:(duration=1000)=>clock+=duration,reopen:()=>host=createHost(),
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

test('orphan submitting entries settle unknown across restart and expiry without replay, allowing new mail',async()=>{
  const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
  const [key,saved]=[...f.states.entries()][0];
  delete saved.entries.old.taskId;saved.entries.old.state='submitting';f.states.set(key,saved);
  f.tasks.clear(); // Crash before Runtime committed the original command.
  const reopened=f.reopen();await reopened.tick();
  assert.equal([...f.states.values()][0].entries.old.state,'unknown');
  assert.equal(f.counts().submits,1,'unknown original command is never resubmitted');
  f.advance(24*60*60_000);f.items[2].observedAt=new Date(Date.now()+25*60*60_000).toISOString();
  const afterExpiry=f.reopen();await afterExpiry.tick();await afterExpiry.tick();
  assert.equal(f.counts().submits,2,'a later new message proceeds after restart and expiry');
  assert.equal(f.items[2].state,'accepted');
  assert.equal([...f.states.values()][0].entries.old.state,'unknown');await afterExpiry.close();
});

test('orphan submitting restores only the original matching committed task and applies its result once',async()=>{
  const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
  const [key,saved]=[...f.states.entries()][0];
  delete saved.entries.old.taskId;saved.entries.old.state='submitting';f.states.set(key,saved);
  f.items[0].state='pending';delete f.items[0].taskId; // Crash before cache acceptance.
  const reopened=f.reopen();await reopened.tick();
  assert.equal([...f.states.values()][0].entries.old.taskId,'task-1');
  assert.equal(f.items[0].taskId,'task-1');assert.equal(f.counts().submits,1);
  f.finish('task-1');await reopened.tick();await reopened.tick();
  assert.equal(f.counts().submits,1);assert.equal(f.counts().applied,1);
  assert.equal(reopened.snapshot().reviewed,1);await reopened.close();
});

test('orphan recovery rejects a mismatched original intent and never replays the command',async()=>{
  for(const change of [{namespace:'other'},{toolName:'mail.send'},{toolVersion:'2.0.0'},
    {arguments:{}},{deadline:'2000-01-01T00:00:00.000Z'}]){
    const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
    const [key,saved]=[...f.states.entries()][0];delete saved.entries.old.taskId;saved.entries.old.state='submitting';f.states.set(key,saved);
    Object.assign(f.checkpoints.get('task-1host-tool-intent'),change);
    const reopened=f.reopen();await reopened.tick();await reopened.tick();
    assert.equal([...f.states.values()][0].entries.old.state,'unknown');assert.equal(f.counts().submits,1);
    await reopened.close();
  }
});

test('orphan recovery only reads expired or cancelled original tasks and survives lookup failures',async()=>{
  for(const mode of ['expired','cancelled','unreadable']){
    const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
    const [key,saved]=[...f.states.entries()][0];delete saved.entries.old.taskId;saved.entries.old.state='submitting';f.states.set(key,saved);
    if(mode==='expired')f.advance(24*60*60_000);
    if(mode==='cancelled')f.tasks.get('task-1').state='cancelled';
    if(mode==='unreadable')f.runtime.findTaskByIdempotencyKey=()=>{throw new Error('Unavailable');};
    const reopened=f.reopen();await reopened.tick();await reopened.tick();
    assert.equal(f.counts().submits,1);assert.equal(f.counts().applied,0);assert.equal(f.counts().deliveries,0);
    if(mode==='unreadable')assert.equal([...f.states.values()][0].entries.old.state,'unknown');
    await reopened.close();
  }
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

test('explicit retry of a bound terminal INVALID_ARGUMENT keeps sent history and rejects unknown or mismatched receipts',async()=>{
  const f=fixture(),selected=ref(f.items[0]);
  await f.host.configure({enabled:true,selectedBindings:[selected]});await f.host.tick();
  Object.assign(f.tasks.get('task-1'),{state:'failed',error:{code:'EXTERNAL_FAILURE',message:'AgentArts terminal failure'}});
  f.records.set('task-1',[{taskId:'task-1',evidenceId:'host-tool-task-1',toolName:'mail.review',toolVersion:'1.0.0',
    state:'failed',executionStarted:true,policyDecision:'allow'}]);
  const deadline=f.checkpoints.get('task-1host-tool-intent').deadline,
    identity={sessionId:'session',requestId:'request',idempotencyKey:'request',payloadDigest:'a'.repeat(64),serverInstanceId:'server'},
    receipt={...identity,accepted:true},configurationRef='cloud-config',diagnostic={version:'1.0',phase:'initial',kind:'agentarts_terminal',code:'EXTERNAL_FAILURE',remoteCode:'INVALID_ARGUMENT'};
  for(const [key,value] of Object.entries({'mail-review-attempt:v1':{version:1,binding:selected,deadline,configurationRef},
    'competition-cloud-inflight':receipt,'competition-cloud-received':receipt,'competition-coordination-failure':diagnostic,
    'competition-cloud-dispatch-binding':{bindingVersion:'1.0',configurationRef,invocation:identity},
    'competition-cloud-dispatch-context':{snapshotVersion:'1.0',taskId:'task-1',configurationRef,invocation:identity,request:{phase:'initial',deadline,revision:1}},
    'competition-cloud-request-identity':{formatVersion:'1.0.0',conflicts:[],requests:[{sessionId:identity.sessionId,requestId:identity.requestId,
      payloadDigest:identity.payloadDigest,revision:1,attempts:1,recordedAt:new Date().toISOString()}]},
    'application-profile':'huawei_ict_agentarts','application-deadline':deadline,'competition-max-steps':1}))f.checkpoints.set('task-1'+key,value);
  await f.host.tick();await f.host.tick();assert.equal(f.counts().submits,1);
  for(const [key,value] of [['competition-cloud-received',{...receipt,requestId:'different'}],['competition-cloud-unknown',null],
    ['competition-coordination-failure',{...diagnostic,remoteCode:'EXTERNAL_FAILURE'}],['competition-cloud-dispatch-binding',{}],['mail-review-result:v1',{}]]){
    const original=f.checkpoints.get('task-1'+key);f.checkpoints.set('task-1'+key,value);
    await assert.rejects(f.host.configure({enabled:true,selectedBindings:[selected]}),{code:'UNAUTHORIZED'});
    if(original===undefined)f.checkpoints.delete('task-1'+key);else f.checkpoints.set('task-1'+key,original);
  }
  f.setConsent(false);await assert.rejects(f.host.configure({enabled:true,selectedBindings:[selected]}),{code:'UNAUTHORIZED'});
  assert.equal(f.counts().retries,0);f.setConsent(true);
  await f.host.configure({enabled:true,selectedBindings:[selected]});await f.host.tick();
  assert.equal(f.counts().retries,1);assert.equal(f.items[0].taskId,'task-2');
  assert.equal([...f.states.values()][0].retryHistory['task-1'].reason,'mail-review-remote-invalid-argument');
  assert.deepEqual(f.checkpoints.get('task-1competition-cloud-inflight'),receipt);assert.equal(f.tasks.get('task-1').state,'failed');
  await f.host.close();
});

test('unknown notification reads its original late receipt across generations and deadlines without another send',async()=>{
  const f=fixture();await f.host.configure({enabled:true,selectedBindings:[ref(f.items[0])]});await f.host.tick();
  f.setNotificationState('unknown');
  f.finish('task-1',{version:1,label:'meeting',impact:'high_impact',notificationRecommendation:'notify',reasonCode:'meeting_change'});
  await f.host.tick();assert.equal(f.counts().deliveries,1);
  assert.equal([...f.states.values()][0].entries.old.notificationSettled,false);
  await f.host.close();
  const [key,saved]=[...f.states.entries()][0];saved.entries.old.notificationSettled=true;f.states.set(key,saved);
  const reopened=f.reopen();await reopened.configure({enabled:true});f.advance(31*60_000);
  await reopened.tick();assert.equal(f.counts().readbacks,1);assert.equal(f.counts().deliveries,1);
  assert.equal([...f.states.values()][0].entries.old.notificationState,'unknown');
  f.setNotificationState('delivered');await reopened.tick();
  const settled=[...f.states.values()][0].entries.old;
  assert.equal(settled.notificationState,'delivered');assert.equal(settled.notificationSettled,true);
  await reopened.tick();assert.equal(f.counts().readbacks,2);assert.equal(f.counts().deliveries,1);
  assert.equal(f.counts().submits,1);assert.equal(f.counts().applied,1);await reopened.close();
});
