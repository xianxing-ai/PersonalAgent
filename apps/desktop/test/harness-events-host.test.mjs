import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesktopHarnessEventsHost} from '../electron/harness-events-host.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
  const deadline=new Date(Date.now()+60000).toISOString(),conversationId='desktop-panel';
  const tasks=new Map([
    ['root',{taskId:'root',conversationId,goal:'Synthetic original user responsibility',state:'succeeded',revision:1}],
    ['owner',{taskId:'owner',conversationId:'desktop-subtask:root',goal:'Synthetic original user responsibility',state:'succeeded',revision:1}],
    ['workflow',{taskId:'workflow',conversationId,goal:'Synthetic original user responsibility',state:'waiting_approval',revision:1}],
    ['event-root',{taskId:'event-root',conversationId,goal:'Synthetic event',state:'created',revision:1}],
  ]);
  const responsibility={id:'instruction:owner',revision:1,conversationId,authority:'explicit_instruction',goalRefs:[],scopeRefs:[],
    sourceQuotes:[{messageId:'owner',conversationId:'desktop-subtask:root',quoteRef:'runtime:task:owner:goal',
      sha256:createHash('sha256').update(tasks.get('owner').goal).digest('hex')}]};
  const event={eventId:'event',entry:'connector',sourceId:'public-feed',entityRef:'item',sourceVersion:'version',
    conversationId,contractRef:'contract',observedAt:new Date().toISOString(),change:'upsert',payloadRef:'original-batch-ref',
    payloadDigest:'original-digest',responsibilityRefs:[responsibility.id],evidenceRefs:['original-confirmed-read'],anchorRefs:[],goalRefs:[],priority:'normal'};
  const binding={taskId:'workflow',sessionId:'original-session',sourceTaskId:'owner',taskDeadline:deadline,contractRef:'contract'};
  const snapshot={application:{revision:1,state:{binding:{...binding,controlRevision:0},conversationId,contractRef:'contract',
    entries:{event:{event}},responsibilities:{[responsibility.id]:responsibility},schedules:{}}},session:{state:{proposals:{}}}};
  let grant=true,config={revision:'setting-1',enabled:true,events:{enabled:true,quiet:false}},captured,consumerStarted=0,ledgerRevision=1;
  const parentReads=[],runtime={getTask:id=>structuredClone(tasks.get(id)),
    loadCheckpoint:(id,key)=>id==='owner'&&key==='subtask-parent'?{parentTaskId:'root'}:undefined};
  const application={runtime,coordinationConfigurationRef:'original-runtime-config',
    readSubagentConversation:value=>parentReads.push(value),submitHarnessEventTask:()=>{throw Error('Fake must not submit');}};
  const manager=createDesktopHarnessEventsHost({application,readConfiguration:()=>structuredClone(config),
    readDeveloperHarnessConfiguration:()=>({workspaceRef:'original-workspace',maxExecutorSteps:7,configurationRef:config.revision,assertCurrent(){}}),
    resolveUserConversation:()=>conversationId,readSourceOrigin:()=>({selection:{grantExpiresAt:deadline}}),
    readSourceAuthorization:()=>grant?{expiresAt:deadline,fence:'original-confirmed-public-source'}:undefined,
    createDelivery:()=>({}),createEvents:options=>{captured=options;return {start(){consumerStarted++;},flush(){},stop(){},inspect(){return {};}};},
    readOriginalDelivery:(_session,origin,options)=>({origin,ledgerState:'pending',ledgerRevision,event,
      anchor:options.resolveAnchor(event),control:options.readControl(),deadline,assertCurrent(){
        if(!grant)throw Error('Original source grant revoked');}}),
  });
  const session={binding,host:{taskId:'workflow',sessionId:binding.sessionId,binding:{...binding,controlRevision:0},
    inspect:()=>structuredClone(snapshot),subscribe:()=>()=>{}}};
  manager.attach(session);
  return {manager,event,captured,tasks,parentReads,get started(){return consumerStarted;},
    revoke(){grant=false;},change(){config={...config,revision:'setting-2'};},changeLedger(){ledgerRevision++;}};
}

test('Synthetic native event adapter resolves actual user-work parent and starts only after startup classification',()=>{
  const f=fixture();assert.equal(f.started,0);f.manager.start();assert.equal(f.started,1);
  const anchor=f.captured.resolveAnchor(f.event);assert.equal(anchor.parentTaskId,'root');assert.equal(anchor.sourceTaskId,'owner');
  assert.deepEqual(f.parentReads[0],{parentTaskId:'root',taskId:'owner'});
  f.captured.assertCurrentAuthorization(anchor,f.event,{deadline:anchor.deadline,signal:new AbortController().signal},'dispatch');
  f.revoke();assert.throws(()=>f.captured.assertCurrentAuthorization(anchor,f.event,
    {deadline:anchor.deadline,signal:new AbortController().signal},'dispatch'),error=>error.code==='SCOPE_DENIED');
});

test('Synthetic original created event fence rejects configuration, ledger and source revocation',()=>{
  for(const change of ['change','changeLedger','revoke']) {
    const f=fixture(),origin={deliveryId:'delivery',eventDigest:hash(f.event),sourceTaskId:'owner',originalParentTaskId:'root'};
    const scope=f.manager.canResumeHarnessEvent({taskId:'event-root',expectedRevision:1,conversationId:'desktop-panel',origin,phase:'created_root'});
    assert.ok(scope);scope.assertCurrent();f[change]();assert.throws(()=>scope.assertCurrent());
  }
});
