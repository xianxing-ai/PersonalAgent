import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createProactiveHostProofs} from '@personal-agent/agentarts';
import {feedItemContentSha256} from '@personal-agent/feeds';
import {createDesktopProactiveConfirmedSourceRouter} from '../electron/proactive-confirmed-source-router.js';
import {createDesktopProactiveRuntimePump} from '../electron/proactive-runtime-pump.js';

// Actual Runtime/SQLite/Policy/Evidence and original proactive sink. Feed body, native observation
// and native classification/grant ports are explicit Synthetic fixtures; no real provider is invoked.
const until=async predicate=>{for(let n=0;n<300;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic confirmed source did not settle');};
async function fixture() {
  const cache=resolve('.cache/wiring-20261018/core');mkdirSync(cache,{recursive:true});const folder=mkdtempSync(join(cache,'confirmed-source-'));
  const path=join(folder,'runtime.sqlite'),namespace='synthetic-public-user',sourceId='synthetic-public-feed',configurationRef='c'.repeat(64);
  const deadline=new Date(Date.now()+60_000).toISOString(),timestamp=new Date().toISOString();
  const record={source:'rss',accountRef:sourceId,externalId:'public-one',dedupeKey:'synthetic-public-one',contentRef:'https://example.org/public-one',
    occurredAt:timestamp,fetchedAt:timestamp,sensitivity:'public'};
  const item={record,title:'Synthetic public pelican source',summary:'Synthetic public update',dedupeKeyKind:'item_guid',occurredAtKind:'item_published'};
  const citation={externalId:record.externalId,contentRef:record.contentRef,sourceRevision:'a'.repeat(64),contentSha256:feedItemContentSha256(item)};
  const result={items:[item],collection:{state:'fetched',subscriptionId:sourceId,fetchedAt:timestamp,validators:{etag:null,lastModified:null}},
    nextCursor:'synthetic-original-cursor',hasMore:false,sourceReceipt:{version:1,providerId:'http-feed-provider-v1',source:'rss',subscriptionId:sourceId,
      configBinding:configurationRef,sensitivity:'public',publicFetch:true,sourceRevision:citation.sourceRevision,
      contentSha256:createHash('sha256').update(JSON.stringify([citation.contentSha256])).digest('hex'),
      transport:{providerId:'http-feed-provider-v1',nativeFetch:true,credentialFree:true,state:'fetched',transportFetchedAt:timestamp,
        requestBinding:'b'.repeat(64),decodedBodySha256:citation.sourceRevision},citations:[citation]}};
  let app,host,workflow,router,source,responsibilitySource,original,providerCalls=0,granted=true;
  const tool={descriptor:{name:'feeds.collect',version:'1.0.0',inputSchema:{type:'object',properties:{subscriptionId:{type:'string'},limit:{type:'integer'}},
    required:['subscriptionId'],additionalProperties:false},outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['synthetic:feed:read'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async()=>{providerCalls++;return structuredClone(result);}};
  const grant=query=>({state:granted&&query.taskId===source.taskId?'granted':'revoked',id:'synthetic-native-grant',revision:1,
    namespace,sourceId,configurationRef,taskId:source.taskId,conversationId:'desktop-panel',
    purposeDigest:createHash('sha256').update(JSON.stringify(source.goal)).digest('hex'),publicLowRiskTracking:true,expiresAt:deadline});
  const open=()=>{
    app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',proactiveWorkflows:true,hostUserNamespace:namespace,tools:[tool],
      competitionToolExports:[{toolName:'feeds.collect',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-public-feed-v1',accepts:()=>true,project:({result})=>result}],
      automaticTools:[{toolName:'feeds.collect',toolVersion:'1.0.0'}],coordination:{execute:async input=>input.continuation
        ?{kind:'text',text:'Synthetic source read complete',verification:'unverified'}
        :{kind:'tool_proposal',proposalId:'synthetic-feed-read',toolName:'feeds.collect',toolVersion:'1.0.0',arguments:{subscriptionId:sourceId},verification:'unverified'}}});
    source??=app.runtime.submitTask({goal:'Track this selected public source',conversationId:'desktop-panel',idempotencyKey:'source-instruction'});
    responsibilitySource??=source;
    original??=app.runtime.submitTask({goal:source.goal,conversationId:'desktop-panel',idempotencyKey:'original-responsibility'});
    const proofs=createProactiveHostProofs('synthetic-public-source-sink-key-32');
    host=app.createProactiveWorkflowHost({taskId:original.taskId,sessionId:'synthetic-source-session',taskDeadline:deadline,contractRef:'synthetic-contract',
      advancePort:async()=>assert.fail('No network/model/frontier in source persistence test'),verifyAdvance:()=>false,sign:proofs.sign,localDeviceAvailable:()=>true});
    host.ingestUserInstruction({sourceTaskId:source.taskId},{deadline,signal:new AbortController().signal});
    const binding=()=>({taskId:original.taskId,sourceTaskId:responsibilitySource.taskId,taskDeadline:deadline,imageBinding:'synthetic-public-source-image'});
    workflow={snapshot:()=>({state:'configured_not_verified'}),maintenancePage:()=>({items:[{binding:binding(),
      state:app.runtime.getTask(original.taskId).state,conversationId:'desktop-panel'}]}),acquireMaintenance:async id=>{
      assert.equal(id,original.taskId);return {host,binding:binding()};}};
    router=createDesktopProactiveConfirmedSourceRouter({getApplication:()=>app,getWorkflow:()=>workflow,namespace,
      resolveUserConversation:id=>id===responsibilitySource.taskId?'desktop-panel':app.runtime.getTask(id).conversationId,
      readSourceBinding:()=>({namespace,sourceId,subscriptionId:sourceId,configurationRef,sensitivity:'public',available:true,containsCredentials:false}),readTrackingGrant:grant});
  };
  open();
  const read=async id=>{const client=new Client(app);await client.connect();const {taskId}=await client.call('task.submit',
    {goal:'Read the explicitly Synthetic public feed',conversationId:'desktop-panel'},{idempotencyKey:id});
    await until(()=>['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state));
    assert.equal(app.runtime.getTask(taskId).state,'succeeded',JSON.stringify(app.runtime.getTask(taskId).error));
    const execution=app.runtime.readToolExecutions(taskId).find(item=>item.toolName==='feeds.collect');
    assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');
    return {workflowTaskId:original.taskId,taskId,runId:execution.evidenceId,toolVersion:'1.0.0',arguments:{subscriptionId:sourceId},scopeRef:execution.evidenceId};};
  const hostRead=async(id,bind=true)=>{
    const commandId='synthetic-host-feed:'+id,arguments_={subscriptionId:sourceId};
    const prepared=app.prepareHostToolTask({commandId,toolName:'feeds.collect',toolVersion:'1.0.0',deadline});
    const invocation={taskId:prepared.taskId,expectedTaskRevision:prepared.revision,trackingTaskId:source.taskId,
      commandId,toolVersion:'1.0.0',arguments:arguments_};
    if(bind)router.bindPreparedFeedRead(invocation);
    app.finalizeHostToolTask({taskId:prepared.taskId,commandId,expectedTaskRevision:prepared.revision,arguments:arguments_});
    await until(()=>['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(prepared.taskId).state));
    const readback=app.readHostToolTask(prepared.taskId);assert.equal(readback.task.state,'succeeded');assert.ok(readback.confirmed);
    return {invocation,input:{workflowTaskId:original.taskId,taskId:prepared.taskId,runId:readback.confirmed.runId,
      toolVersion:readback.toolVersion,arguments:arguments_,scopeRef:readback.confirmed.runId,trackingTaskId:source.taskId}};
  };
  return {get app(){return app;},get host(){return host;},get router(){return router;},result,deadline,read,
    hostRead,get source(){return source;},get workflow(){return workflow;},get original(){return original;},
    childSource(){
      // Explicit Synthetic original structural fixture; public production reader validates it.
      const subtaskId='synthetic-user-work',child=app.runtime.submitTask({goal:'[任务执行] '+source.goal,
        conversationId:'desktop-subtask:'+source.taskId,idempotencyKey:'subagent-dispatch-'+source.taskId+'-'+subtaskId});
      for(const [key,value]of Object.entries({'subtask-parent':{parentTaskId:source.taskId,parentDeadline:deadline,
        subtaskId,role:'coder',roleLabel:'任务执行',goal:source.goal},'subtask-execution-binding':{kind:'competition'},
        'subtask-coordination-binding':{profile:'huawei_ict_agentarts',configurationRef:'synthetic-original-configuration'},
        'subtask-tools-binding':[],'competition-max-steps':1}))app.runtime.saveCheckpoint(child.taskId,key,value);
      app.readSubagentConversation({parentTaskId:source.taskId,taskId:child.taskId});responsibilitySource=child;return child;
    },
    context:()=>({deadline,signal:new AbortController().signal}),providerCalls:()=>providerCalls,
    revoke:()=>{granted=false;},reopen(){app.close();open();},
    close(){app.close();assert.ok(folder.startsWith(cache));rmSync(folder,{recursive:true,force:true});}};
}

test('Synthetic original confirmed feed Evidence reaches durable sink; repeated receipt and unchanged item never duplicate events',async()=>{
  const f=await fixture();try {
    const input=await f.read('first-read');
    const first=await f.router.routeConfirmedFeed(input,f.context());assert.equal(first.state,'persisted');assert.equal(first.eventCount,1);
    const repeated=await f.router.routeConfirmedFeed(input,f.context());assert.equal(repeated.state,'already_persisted');assert.equal(repeated.batchId,first.batchId);
    const observed=new Date(Date.parse(f.result.collection.fetchedAt)+1).toISOString();
    f.result.collection.fetchedAt=observed;f.result.items[0].record.fetchedAt=observed;
    f.result.sourceReceipt.transport.transportFetchedAt=observed;
    const next=await f.read('second-read');
    const unchanged=await f.router.routeConfirmedFeed(next,f.context());assert.equal(unchanged.state,'persisted');assert.equal(unchanged.eventCount,0);
    const entries=Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector');
    assert.equal(entries.length,1);assert.equal(entries[0].event.sourceId,'synthetic-public-feed');assert.equal(f.providerCalls(),2);
  }finally{f.close();}
});

test('Synthetic SQLite reopen plus ordinary maintenance tick recovers exact lost ack without another collection',async()=>{
  const f=await fixture();try {
    const {input}=await f.hostRead('poll-recovery'),persist=f.host.eventSink.persist;
    f.host.eventSink.persist=async(...args)=>{await persist(...args);throw Error('Synthetic lost acknowledgement');};
    await assert.rejects(f.router.routeConfirmedFeed(input,f.context()),/lost acknowledgement/);
    f.app.runtime.transitionTask(f.original.taskId,'planning');f.app.runtime.transitionTask(f.original.taskId,'running');
    f.reopen();
    const pump=createDesktopProactiveRuntimePump({getApplication:()=>f.app,getWorkflow:()=>f.workflow,
      resolveUserConversation:()=> 'desktop-panel',recoverSources:(taskId,context)=>f.router.recoverPending(taskId,context)});
    const tick=await pump.tick();assert.equal(tick.sessions[0].sourceRecovery.state,'recovered');
    assert.equal(tick.sessions[0].sourceRecovery.deliveries,1);
    assert.equal((await pump.tick()).sessions[0].sourceRecovery.deliveries,0);
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,1);
    assert.equal(f.providerCalls(),1);
  }finally{f.close();}
});

test('Synthetic original tracking-parent erasure denies a bound child source even when child and actual read remain',async()=>{
  const f=await fixture();try {
    const {input}=await f.hostRead('erased-parent'),child=f.childSource();
    assert.equal(f.router.matchesTrackingTask(child.taskId,f.source.taskId),true);
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'private-copy-erasure'),undefined);
    f.app.runtime.saveCheckpoint(f.source.taskId,'private-copy-erasure',{withheld:true});
    await assert.rejects(f.router.routeConfirmedFeed(input,f.context()),{code:'SCOPE_DENIED'});
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,0);
  }finally{f.close();}
});

test('Synthetic pending readback holds after native grant revocation without delivering or collecting again',async()=>{
  const f=await fixture();try {
    const {input}=await f.hostRead('revoked-pending');let deliveries=0;
    f.host.eventSink.persist=async()=>{deliveries++;throw Error('Synthetic transport unavailable before commit');};
    await assert.rejects(f.router.routeConfirmedFeed(input,f.context()),/before commit/);
    f.revoke();const recovered=await f.router.recoverPending(f.original.taskId,f.context());
    assert.equal(recovered.state,'unavailable');assert.equal(recovered.deliveries[0].code,'UNSUPPORTED_CAPABILITY');
    assert.equal(deliveries,1);assert.equal(f.providerCalls(),1);
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,0);
  }finally{f.close();}
});

test('Synthetic native-interest host read requires its original prepared tracking binding; background and same-UI substitution deny',async()=>{
  const f=await fixture();try {
    const {input,invocation}=await f.hostRead('bound');
    assert.equal(f.router.matchesTrackingTask(f.source.taskId,f.source.taskId),true);
    const other=f.app.runtime.submitTask({goal:'Another source interest in same UI',conversationId:'desktop-panel',idempotencyKey:'other-interest'});
    assert.equal(f.router.matchesTrackingTask(f.source.taskId,other.taskId),false);
    await assert.rejects(f.router.routeConfirmedFeed({...input,trackingTaskId:other.taskId},f.context()),{code:'SCOPE_DENIED'});
    assert.throws(()=>f.router.bindPreparedFeedRead(invocation),{code:'SCOPE_DENIED'});
    const unscoped=await f.hostRead('background',false);
    await assert.rejects(f.router.routeConfirmedFeed(unscoped.input,f.context()),{code:'SCOPE_DENIED'});
    assert.equal((await f.router.routeConfirmedFeed(input,f.context())).state,'persisted');
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,1);
    assert.equal(f.providerCalls(),2);
  }finally{f.close();}
});

test('Synthetic lost sink acknowledgement recovers exact persisted batch after SQLite reopen without another provider call',async()=>{
  const f=await fixture();try {
    const input=await f.read('lost-ack-read'),persist=f.host.eventSink.persist;
    f.host.eventSink.persist=async(...args)=>{await persist(...args);throw Error('Synthetic acknowledgement lost after commit');};
    await assert.rejects(f.router.routeConfirmedFeed(input,f.context()),/acknowledgement lost/);
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,1);
    f.reopen();
    assert.equal((await f.router.routeConfirmedFeed(input,f.context())).state,'already_persisted');
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,1);
    assert.equal(f.providerCalls(),1);
  }finally{f.close();}
});

test('Synthetic missing native grant, changed arguments, expiry and foreign read cannot enqueue a source event',async()=>{
  const f=await fixture();try {
    const input=await f.read('rejected-read');
    assert.equal((await f.router.routeConfirmedFeed({...input,arguments:{...input.arguments,limit:1}},f.context())).state,'unavailable');
    const foreign=f.app.runtime.submitTask({goal:'Other UI source',conversationId:'foreign-ui',idempotencyKey:'foreign'});
    await assert.rejects(f.router.routeConfirmedFeed({...input,taskId:foreign.taskId},f.context()),{code:'SCOPE_DENIED'});
    await assert.rejects(f.router.routeConfirmedFeed(input,{...f.context(),deadline:'2020-01-01T00:00:00.000Z'}),{code:'TIMEOUT'});
    f.revoke();await assert.rejects(f.router.routeConfirmedFeed(input,f.context()),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(Object.values(f.host.inspect().application.state.entries).filter(entry=>entry.event.entry==='connector').length,0);
  }finally{f.close();}
});
