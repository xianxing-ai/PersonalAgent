import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeStartupRecovery} from '../dist/application/startup-recovery.js';

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
