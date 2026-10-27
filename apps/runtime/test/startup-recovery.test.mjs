import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRuntimeStartupRecovery} from '../dist/application/startup-recovery.js';
import {advanceExecutionCapacity,createExecutionCapacity,EXECUTION_CAPACITY_CHECKPOINT,
  selectContinuationContext} from '../dist/application/execution-capacity.js';
import {TOOL_DISCOVERY_DESCRIPTOR,TOOL_DISCOVERY_NAME,TOOL_DISCOVERY_VERSION} from '../dist/application/tool-discovery.js';

const clock=new Date('2026-10-20T13:00:00.000Z'),deadline='2026-10-20T14:00:00.000Z';
function fixture({state='running',effect='read',record=false,unknown=false,active=false,expired=false,cancelled=false}={}){
  const task={taskId:'original',goal:'public goal',conversationId:'panel',revision:3,state,...(cancelled?{cancelRequested:true}:{})};
  const values=new Map([['application-profile','huawei_ict_agentarts'],['application-goal',task.goal],['application-deadline',expired?'2026-10-20T12:00:00.000Z':deadline],['competition-configuration-binding','configuration'],['competition-max-steps',6]]);
  const records=record?[{taskId:task.taskId,evidenceId:'competition-tool-original-1',toolName:'fixture.operation',toolVersion:'1.0.0',
    state:unknown?'unknown':'confirmed',executionStarted:true,policyDecision:'allow',inputDigest:'original'}]:[];
  if(record){values.set('tool-result-competition-tool-original-1',{result:{public:true}});
    values.set('competition-loop',{step:2,continuation:{proposalId:'original-proposal',state:'confirmed',result:{public:true}},
      receipts:[{runId:'competition-tool-original-1',proposal:{proposalId:'original-proposal',toolName:'fixture.operation',toolVersion:'1.0.0',arguments:{}},
        continuation:{proposalId:'original-proposal',state:'confirmed',result:{public:true}}}]});}
  const resumed=[],runtime={
    getTask:id=>{assert.equal(id,'original');return structuredClone(task);},listTasks:()=>({items:[structuredClone(task)],snapshotSequence:1}),
    listCheckpointKeys:()=>[...values.keys()].sort(),loadCheckpoint:(_id,key)=>structuredClone(values.get(key)),
    saveCheckpoint:(_id,key,value)=>values.set(key,structuredClone(value)),readToolExecutions:()=>structuredClone(records),
    readToolDescriptors:()=>[{name:'fixture.operation',version:'1.0.0',sideEffect:effect}],isTaskActive:()=>active,
    findTaskByIdempotencyKey:()=>undefined,matchesToolExecutionInput:(_record,input)=>JSON.stringify(input.arguments)==='{}'&&input.scopeRef==='competition-tool-original-1',
    recoverInterruptedTasks:()=>{if(active||!['planning','running','waiting_external','verifying','cancelling'].includes(task.state))return [];
      values.set('runtime-interruption:v1',{version:'1.0',taskId:task.taskId,originalState:task.state,originalRevision:task.revision,recoveredRevision:task.revision+1});
      task.state='waiting_reconciliation';task.revision++;return [structuredClone(task)];},
    transitionTask:(_id,next)=>{task.state=next;task.revision++;return structuredClone(task);},
    requestCancel:()=>{task.cancelRequested=true;task.state='cancelling';task.revision++;},
    confirmCancellation:()=>{task.state='cancelled';task.revision++;return structuredClone(task);},
  };
  const options={runtime,configurationRef:'configuration',durableCloudDispatch:true,exclusiveOwner:true,now:()=>clock,
    resumeOriginalTask:request=>{request.assertUnchanged();resumed.push({taskId:request.taskId,mode:request.mode,revision:request.expectedRevision});task.state='running';task.revision++;return {accepted:true};}};
  return {task,values,records,resumed,options,runtime};
}
test('startup adopts an inactive pre-send task and hands the same identity to the original worker once',async()=>{
  const f=fixture(),host=createRuntimeStartupRecovery(f.options),first=host.recover(),second=host.recover();
  assert.equal(first,second);const result=await first;
  assert.deepEqual(f.resumed,[{taskId:'original',mode:'before_first_send',revision:4}]);assert.equal(result.items[0].outcome,'resumed');
  assert.equal(f.values.get('runtime-interruption:v1').originalState,'running');
});
test('only confirmed read caches may resume; confirmed writes and unknown tools preserve their records',async()=>{
  for(const [effect,unknown,classification] of [['read',false,'confirmed_read'],['local_write',false,'confirmed_write'],['read',true,'unknown']]){
    const f=fixture({effect,record:true,unknown}),before=structuredClone(f.records),cache=structuredClone(f.values.get('tool-result-competition-tool-original-1'));
    const result=await createRuntimeStartupRecovery(f.options).recover();assert.equal(result.items[0].classification,classification);
    assert.equal(f.resumed.length,classification==='confirmed_read'?1:0);assert.deepEqual(f.records,before);
    assert.deepEqual(f.values.get('tool-result-competition-tool-original-1'),cache);
  }
});
test('cloud unknown, old receipt, unsupported checkpoint and HTTPS absence never imply a safe resend',async()=>{
  for(const change of [f=>f.values.set('competition-cloud-inflight',{requestId:'original'}),f=>f.values.set('competition-cloud-received',{requestId:'original'}),
    f=>f.values.set('private-memory:consumption:v1',{}),f=>{f.options.durableCloudDispatch=false;},
    f=>f.values.set('competition-cloud-request-identity',{requests:[]})]){
    const f=fixture();change(f);await createRuntimeStartupRecovery(f.options).recover();assert.equal(f.resumed.length,0);
  }
});
test('live workers and original approvals are not adopted or dispatched by startup',async()=>{
  for(const options of [{active:true},{state:'waiting_approval'}]){
    const f=fixture(options),before=structuredClone(f.task),result=await createRuntimeStartupRecovery(f.options).recover();
    assert.deepEqual(f.task,before);assert.equal(f.resumed.length,0);assert.ok(['active','approval_required'].includes(result.items[0].classification));
  }
});
test('safe cancelled/expired tasks end locally, while an unknown cancelled operation remains recoverable',async()=>{
  for(const options of [{cancelled:true},{expired:true},{cancelled:true,record:true,unknown:true}]){
    const f=fixture(options),result=await createRuntimeStartupRecovery(f.options).recover();assert.equal(f.resumed.length,0);
    assert.equal(result.items[0].outcome,options.unknown?'retained':options.cancelled?'cancelled':'expired');
  }
});
test('the handoff guard rejects a changed original loop or task revision',async()=>{
  const f=fixture({record:true});f.options.resumeOriginalTask=request=>{f.task.revision++;request.assertUnchanged();throw Error('unreachable');};
  const result=await createRuntimeStartupRecovery(f.options).recover();assert.equal(result.items[0].outcome,'retained');assert.equal(f.resumed.length,0);
});
test('startup refuses to inspect/adopt a database without exclusive host ownership',async()=>{
  const f=fixture();f.options.exclusiveOwner=false;
  await assert.rejects(createRuntimeStartupRecovery(f.options).recover(),{code:'REVISION_CONFLICT'});assert.equal(f.task.state,'running');
});
test('an atomically accepted event root resumes the same task only through its current original native fence',async()=>{
  for(const valid of [true,false]){
    const f=fixture({state:'created'}),origin={deliveryId:'delivery',eventDigest:'a'.repeat(64),sourceTaskId:'source',originalParentTaskId:'parent'};
    f.values.clear();f.values.set('harness-event-origin',origin);
    f.runtime.findTaskByIdempotencyKey=key=>key==='harness-event-root:delivery'?structuredClone(f.task):undefined;
    f.options.canResumeHarnessEvent=query=>{assert.equal(query.taskId,'original');assert.equal(query.phase,'created_root');
      assert.deepEqual(query.origin,origin);return valid?{deadline,configurationRef:'configuration',fence:'original-current-fence',assertCurrent:()=>{}}:undefined;};
    let handed;
    f.options.resumeOriginalTask=request=>{request.assertUnchanged();handed=request;return {accepted:true};};
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].outcome,valid?'resumed':'retained');assert.equal(f.task.state,'created');
    if(valid){assert.equal(handed.taskId,'original');assert.deepEqual(handed.harnessEventOrigin,origin);}
    else assert.equal(handed,undefined);
  }
});
test('revoking the event lease before original enqueue prevents recovery without creating another root',async()=>{
  const f=fixture({state:'created'}),origin={deliveryId:'delivery',eventDigest:'a'.repeat(64),sourceTaskId:'source',originalParentTaskId:'parent'};
  f.values.clear();f.values.set('harness-event-origin',origin);
  f.runtime.findTaskByIdempotencyKey=key=>key==='harness-event-root:delivery'?structuredClone(f.task):undefined;
  let authorized=true,started=false;
  f.options.canResumeHarnessEvent=()=>authorized?{deadline,configurationRef:'configuration',fence:'same-original-lease',assertCurrent:()=>{}}:undefined;
  f.options.resumeOriginalTask=request=>{authorized=false;request.assertUnchanged();started=true;return {accepted:true};};
  assert.equal((await createRuntimeStartupRecovery(f.options).recover()).items[0].outcome,'retained');assert.equal(started,false);
  assert.equal(f.task.taskId,'original');assert.equal(f.task.state,'created');
});

function progressiveFixture({step=8,maxSteps,...options}={}) {
  const f=fixture({...options,record:true}),originalDeadline=f.values.get('application-deadline'),receipts=[];
  f.records.splice(0);f.values.delete('tool-result-competition-tool-original-1');
  for(let index=1;index<step;index++) {
    const runId=`competition-tool-original-${index}`,proposal={kind:'tool_proposal',proposalId:`read-${index}`,
      toolName:'fixture.operation',toolVersion:'1.0.0',arguments:{index},verification:'unverified'};
    const continuation={proposalId:proposal.proposalId,state:'confirmed',result:{body:`PRIVATE_ORIGINAL_READ_BODY_${index}`}};
    receipts.push({runId,proposal,continuation});f.values.set('tool-result-'+runId,{result:continuation.result});
    f.records.push({taskId:'original',evidenceId:runId,toolName:proposal.toolName,toolVersion:proposal.toolVersion,
      state:'confirmed',executionStarted:true,policyDecision:'allow',inputDigest:`original-${index}`});
  }
  f.values.set('competition-loop',{step,continuation:receipts.at(-1).continuation,receipts});
  f.runtime.matchesToolExecutionInput=(record,input)=>{
    const receipt=receipts.find(item=>item.runId===record.evidenceId);
    return !!receipt&&input.scopeRef===receipt.runId&&JSON.stringify(input.arguments)===JSON.stringify(receipt.proposal.arguments);
  };
  const seeded=createExecutionCapacity({enabled:true,initialWindowSteps:6,windowSteps:4,deadline:originalDeadline,
    ...(maxSteps===undefined?{}:{maxSteps})});
  const decision=advanceExecutionCapacity(seeded,{step:6,deadline:originalDeadline,signal:new AbortController().signal,
    nowMs:Date.parse(originalDeadline)-1,receipts:receipts.slice(0,5)});
  assert.equal(decision.extended,true);f.values.set(EXECUTION_CAPACITY_CHECKPOINT,decision.state);
  return f;
}

function addProgressMetadata(f) {
  const loop=f.values.get('competition-loop'),capacity=f.values.get(EXECUTION_CAPACITY_CHECKPOINT);
  const selected=selectContinuationContext({receipts:loop.receipts,current:loop.continuation,queryBase:{goal:f.task.goal}});
  f.values.set('competition-capacity-decision:v1',{reason:'extended',step:6,windowEndStep:capacity.windowEndStep});
  f.values.set('competition-continuation-window:v1',{version:'1.0',currentProposalId:loop.continuation.proposalId,
    originalReceiptCount:loop.receipts.length,priorCount:selected.priorContinuations.length,omitted:selected.omitted});
  f.values.set('competition-sent-continuation-window:v1',{version:'1.0',currentProposalId:loop.continuation.proposalId,
    priorCount:selected.priorContinuations.length,queryBytes:selected.queryBytes,additionallyOmitted:{count:0,
      digest:createHash('sha256').digest('hex'),tools:[],unlisted:{count:0,digest:createHash('sha256').digest('hex')}}});
}

function discoveryFixture({record=false}={}) {
  const f=fixture({state:record?'running':'created',record});
  const read={name:'fixture.operation',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false}};
  const discovery={name:TOOL_DISCOVERY_NAME,version:TOOL_DISCOVERY_VERSION,inputSchema:TOOL_DISCOVERY_DESCRIPTOR.inputSchema};
  const entries=[discovery,read],digest=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const pool={version:'1.0',revision:3,deadline,digest,entries};
  f.values.set('competition-tool-discovery-pool:v1',structuredClone(pool));
  f.values.set('competition-tool-catalog',{revision:3,deadline,entries:structuredClone(entries)});
  f.runtime.readToolDescriptors=()=>[{...read,sideEffect:'read'},TOOL_DISCOVERY_DESCRIPTOR];
  if(record) {
    const runId=f.records[0].evidenceId,args={query:'fixture'},result={catalogRef:digest,query:args.query,
      totalMatches:1,offset:0,hasMore:false,groups:[{namespace:'fixture',count:1}],groupsTruncated:false,
      matches:[{name:read.name,version:read.version,state:'selected'}],selectedTools:[{name:read.name,version:read.version}],
      authorization:'checked_on_invocation'};
    f.records[0].toolName=discovery.name;f.records[0].toolVersion=discovery.version;
    const continuation={proposalId:'original-proposal',state:'confirmed',result};
    f.values.set('tool-result-'+runId,{result});
    f.values.set('competition-loop',{step:2,continuation,receipts:[{runId,
      proposal:{proposalId:continuation.proposalId,toolName:discovery.name,toolVersion:discovery.version,arguments:args},continuation}]});
    f.values.set('competition-tool-discovery-selection:'+runId,{version:'1.0',poolDigest:digest,arguments:args,entries:structuredClone(entries),result});
    f.values.set('competition-tool-catalog',{revision:3,deadline,entries:structuredClone(entries),discoveryRunId:runId});
    f.runtime.matchesToolExecutionInput=(_record,input)=>input.scopeRef===runId&&JSON.stringify(input.arguments)===JSON.stringify(args);
  }
  return f;
}

test('an original confirmed read beyond the initial window resumes without rewriting its original budget or receipts',async()=>{
  const f=progressiveFixture();addProgressMetadata(f);
  const records=structuredClone(f.records),loop=structuredClone(f.values.get('competition-loop')),
    capacity=structuredClone(f.values.get(EXECUTION_CAPACITY_CHECKPOINT));
  const result=await createRuntimeStartupRecovery(f.options).recover();
  assert.equal(result.items[0].classification,'confirmed_read');assert.equal(result.items[0].outcome,'resumed');
  assert.deepEqual(f.resumed,[{taskId:'original',mode:'confirmed_read',revision:4}]);
  assert.equal(f.values.get('competition-max-steps'),6);assert.deepEqual(f.values.get(EXECUTION_CAPACITY_CHECKPOINT),capacity);
  assert.deepEqual(f.records,records);assert.deepEqual(f.values.get('competition-loop'),loop);
  for(const receipt of loop.receipts)assert.deepEqual(f.values.get('tool-result-'+receipt.runId),{result:receipt.continuation.result});
  assert.doesNotMatch(JSON.stringify(f.values.get('competition-continuation-window:v1').omitted),/PRIVATE_ORIGINAL_READ_BODY/);
});

test('a pre-send progressive task keeps its admitted identity and original unexpanded capacity',async()=>{
  const f=fixture({state:'created'}),capacity=createExecutionCapacity({enabled:true,initialWindowSteps:6,deadline});
  f.values.set(EXECUTION_CAPACITY_CHECKPOINT,capacity);
  const result=await createRuntimeStartupRecovery(f.options).recover();
  assert.equal(result.items[0].classification,'before_first_send');assert.equal(result.items[0].outcome,'resumed');
  assert.equal(f.records.length,0);assert.deepEqual(f.values.get(EXECUTION_CAPACITY_CHECKPOINT),capacity);
});

test('an old task without capacity never acquires a larger step limit during startup',async()=>{
  const f=progressiveFixture();f.values.delete(EXECUTION_CAPACITY_CHECKPOINT);
  const result=await createRuntimeStartupRecovery(f.options).recover();
  assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');
  assert.equal(f.resumed.length,0);assert.equal(f.values.get('competition-max-steps'),6);
  assert.equal(f.values.has(EXECUTION_CAPACITY_CHECKPOINT),false);
});

test('capacity rejects wrong initial limits, deadline binding, malformed state and unsupported fields',async()=>{
  for(const patch of [{initialWindowSteps:7},{deadline:'2026-10-20T15:00:00.000Z'},
    {deadline:'2026-10-20T12:00:00.000Z'},{version:'2.0'},{windowEndStep:11},
    {windowEndStep:Number.MAX_SAFE_INTEGER+1},{extensions:-1},{maxSteps:0},
    {evaluatedReceiptCount:99},{evaluatedReceiptCount:4},{evaluatedReceiptCount:0},
    {evaluatedReceiptCount:0,evaluatedReceiptDigest:createHash('sha256').digest('hex')},
    {evaluatedReceiptDigest:'b'.repeat(64)},{evaluatedReceiptDigest:'raw-private-value'},{authorizationGranted:true},null]) {
    const f=progressiveFixture(),original=structuredClone(f.records);
    f.values.set(EXECUTION_CAPACITY_CHECKPOINT,patch===null?null:{...f.values.get(EXECUTION_CAPACITY_CHECKPOINT),...patch});
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');
    assert.equal(f.resumed.length,0);assert.deepEqual(f.records,original);assert.equal(f.values.get('competition-max-steps'),6);
  }
});

test('extended capacity remains bound to the exact confirmed Runtime action prefix',async()=>{
  for(const change of [
    f=>{f.values.get('competition-loop').receipts[0].proposal.proposalId='replacement-id';
      f.values.get('competition-loop').receipts[0].continuation.proposalId='replacement-id';},
    f=>{f.values.get('competition-loop').receipts[0].proposal.arguments={index:999};},
    f=>{f.values.get('competition-loop').receipts[0].proposal.verification='mock';},
    f=>{f.values.get('competition-loop').receipts[0].continuation.state='unknown';},
    f=>{f.values.get('competition-loop').receipts.splice(0,3);},
    f=>{f.values.get('competition-loop').receipts[0].runId='competition-tool-original-999';},
    f=>{f.runtime.matchesToolExecutionInput=()=>false;},
  ]){
    const f=progressiveFixture();change(f);const records=structuredClone(f.records);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');
    assert.equal(f.resumed.length,0);assert.deepEqual(f.records,records);
  }
});

test('an explicit total step ceiling permits its current continuation but never a step beyond it',async()=>{
  for(const [step,outcome] of [[8,'resumed'],[9,'retained']]){
    const f=progressiveFixture({step,maxSteps:8}),result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].outcome,outcome);assert.equal(f.resumed.length,outcome==='resumed'?1:0);
    assert.equal(f.values.get(EXECUTION_CAPACITY_CHECKPOINT).windowEndStep,8);assert.equal(f.values.get('competition-max-steps'),6);
  }
});

test('progressive tasks retain original expiry, cancellation, unknown results and confirmed-write boundaries',async()=>{
  for(const [change,classification,outcome] of [
    [f=>{f.task.cancelRequested=true;},'confirmed_read','cancelled'],
    [f=>{f.options.now=()=>new Date('2026-10-20T15:00:00.000Z');},'confirmed_read','expired'],
    [f=>{f.records[0].state='unknown';},'unknown','retained'],
    [f=>{f.runtime.readToolDescriptors=()=>[{name:'fixture.operation',version:'1.0.0',sideEffect:'local_write'}];},'confirmed_write','retained'],
    [f=>{f.task.state='waiting_approval';},'approval_required','retained'],
  ]){
    const f=progressiveFixture();addProgressMetadata(f);change(f);const records=structuredClone(f.records);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,classification);assert.equal(result.items[0].outcome,outcome);
    assert.equal(f.resumed.length,0);assert.deepEqual(f.records,records);
  }
});

test('only bounded progress metadata attached to original receipts is recognized',async()=>{
  for(const change of [
    f=>{f.values.get('competition-capacity-decision:v1').reason='model_requests_more';},
    f=>{f.values.get('competition-capacity-decision:v1').windowEndStep=999;},
    f=>{f.values.get('competition-continuation-window:v1').currentProposalId='not-an-original-read';},
    f=>{f.values.get('competition-continuation-window:v1').priorCount=33;},
    f=>{f.values.get('competition-continuation-window:v1').omitted.text='PRIVATE_BODY';},
    f=>{f.values.get('competition-continuation-window:v1').omitted.count=1;},
    f=>{f.values.get('competition-sent-continuation-window:v1').queryBytes=1_100_001;},
    f=>{f.values.get('competition-sent-continuation-window:v1').version='future';},
    f=>{f.values.delete(EXECUTION_CAPACITY_CHECKPOINT);},
  ]){
    const f=progressiveFixture();addProgressMetadata(f);change(f);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');assert.equal(f.resumed.length,0);
  }
});

test('default discovery pool and its exact confirmed read selection remain resumable without granting tools',async()=>{
  for(const record of [false,true]){
    const f=discoveryFixture({record}),before=structuredClone(f.records),values=structuredClone([...f.values]);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,record?'confirmed_read':'before_first_send');
    assert.equal(result.items[0].outcome,'resumed');assert.equal(f.resumed.length,1);assert.deepEqual(f.records,before);
    for(const [key,value] of values)assert.deepEqual(f.values.get(key),value);
    assert.equal(f.values.has(EXECUTION_CAPACITY_CHECKPOINT),false,'Discovery metadata cannot enable progressive execution');
  }
});

test('discovery snapshots require the original pool, deadline, schema, confirmed cache, run and arguments',async()=>{
  for(const change of [
    f=>{f.values.get('competition-tool-discovery-pool:v1').digest='b'.repeat(64);},
    f=>{f.values.get('competition-tool-discovery-pool:v1').deadline='2026-10-20T15:00:00.000Z';},
    f=>{f.values.get('competition-tool-discovery-pool:v1').revision=999;},
    f=>{f.values.get('competition-tool-discovery-pool:v1').extraPermission=true;},
    f=>{f.values.delete('competition-tool-catalog');},
    f=>{f.values.get('competition-tool-catalog').entries=[];},
    f=>{f.values.delete('competition-tool-discovery-pool:v1');},
    f=>{f.values.get('competition-tool-discovery-selection:competition-tool-original-1').arguments={query:'replacement'};},
    f=>{f.values.get('competition-tool-discovery-selection:competition-tool-original-1').poolDigest='b'.repeat(64);},
    f=>{f.values.get('competition-tool-discovery-selection:competition-tool-original-1').entries[1].inputSchema={type:'string'};},
    f=>{f.values.get('tool-result-competition-tool-original-1').result={unrelated:true};},
    f=>{const value=f.values.get('competition-tool-discovery-selection:competition-tool-original-1');
      f.values.delete('competition-tool-discovery-selection:competition-tool-original-1');
      f.values.set('competition-tool-discovery-selection:competition-tool-other-1',value);},
  ]){
    const f=discoveryFixture({record:true});change(f);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');assert.equal(f.resumed.length,0);
  }
});

test('confirmed discovery never overrides unknown execution or original write readback requirements',async()=>{
  for(const [change,classification] of [
    [f=>{f.records[0].state='unknown';},'unknown'],
    [f=>{f.runtime.readToolDescriptors=()=>[{...TOOL_DISCOVERY_DESCRIPTOR,sideEffect:'local_write'}];},'confirmed_write'],
  ]){
    const f=discoveryFixture({record:true});change(f);const records=structuredClone(f.records);
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,classification);assert.equal(result.items[0].outcome,'retained');
    assert.equal(f.resumed.length,0);assert.deepEqual(f.records,records);
  }
});

test('new snapshots never authorize private, team, repair or unsupported recovery hosts',async()=>{
  for(const key of ['private-memory:consumption:v1','subagent-conversation-message:v1','competition-repair-candidate',
    'competition-export-withheld','competition-tool-discovery-unknown:v1','competition-capacity-future:v1']){
    const f=progressiveFixture();f.values.set(key,{});
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].classification,'manual');assert.equal(result.items[0].outcome,'retained');assert.equal(f.resumed.length,0);
  }
  const f=progressiveFixture();f.values.set('subtask-parent',{parentTaskId:'another-owner',parentDeadline:deadline,
    subtaskId:'user-work',goal:f.task.goal,role:'coordinator'});
  assert.equal((await createRuntimeStartupRecovery(f.options).recover()).items[0].classification,'manual');assert.equal(f.resumed.length,0);
});

test('the original handoff fence also binds new capacity and bounded diagnostics',async()=>{
  for(const mutate of [f=>{f.values.get(EXECUTION_CAPACITY_CHECKPOINT).extensions++;},
    f=>{f.values.get('competition-sent-continuation-window:v1').queryBytes++;}]){
    const f=progressiveFixture();addProgressMetadata(f);let started=false;
    f.options.resumeOriginalTask=request=>{mutate(f);request.assertUnchanged();started=true;return {accepted:true};};
    const result=await createRuntimeStartupRecovery(f.options).recover();
    assert.equal(result.items[0].outcome,'retained');assert.equal(started,false);assert.equal(f.resumed.length,0);
  }
});
