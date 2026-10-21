import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {TaskRuntime} from '../dist/index.js';

const base=path.resolve('.cache/approval-lifecycle-tests');
const descriptor={name:'fixture.write',version:'1.0.0',sideEffect:'external_write',
  inputSchema:{type:'object'},outputSchema:{type:'object'},requiredScopes:['fixture:write'],
  idempotencySupport:true,recoverySupport:true,requiresPresence:false};
const digest='a'.repeat(64),start=Date.parse('2026-10-21T12:00:00Z');

function fixture(t) {
  mkdirSync(base,{recursive:true});const directory=mkdtempSync(path.join(base,'case-'));
  let time=start,sequence=0,runtime;
  const options={now:()=>new Date(time),idFactory:()=>`expiry-${++sequence}`};
  const open=()=>runtime=new TaskRuntime(path.join(directory,'runtime.sqlite'),options);
  open();
  t.after(()=>{runtime.close();assert.equal(path.dirname(directory),base);rmSync(directory,{recursive:true,force:true});});
  return {get runtime(){return runtime;},options,setNow:value=>{time=value;},
    reopen(){runtime.close();return open();},
    pending(ttl=1000){const task=runtime.submitTask({goal:'Synthetic bounded write',conversationId:'fixture',idempotencyKey:'one'});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      const approval=runtime.requestToolApproval('original-approval',task.taskId,descriptor,new Date(start+ttl).toISOString(),digest);
      return {taskId:task.taskId,approval};}};
}

test('pending approval expires atomically into a visible task failure and private system audit',t=>{
  const f=fixture(t),{taskId,approval}=f.pending();f.setNow(start+1000);
  assert.throws(()=>f.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision),{code:'TIMEOUT'});
  const settled=f.runtime.getApproval(approval.approvalId),task=f.runtime.getTask(taskId);
  assert.equal(settled.state,'denied');assert.equal(settled.revision,2);
  assert.deepEqual(settled.resolution,{actor:'system',reason:'expired',resolvedAt:new Date(start+1000).toISOString()});
  assert.equal(task.state,'failed');assert.equal(task.error.code,'TIMEOUT');assert.match(task.error.message,/授权已过期/);
  assert.equal(f.runtime.policy.get(approval.approvalId),undefined);
  const publicItem=f.runtime.listApprovals({taskId}).items[0];
  assert.equal(publicItem.state,'denied');assert.equal('resolution' in publicItem,false,'frozen public shape does not expand');
  const events=f.runtime.readEvents().filter(event=>event.type==='task.failed');
  assert.equal(events.length,1);assert.equal(events[0].payload.error.code,'TIMEOUT');
  const record=f.runtime.readToolExecutions(taskId).find(value=>value.evidenceId===approval.approvalId+'-expiration');
  assert.equal(record.executionStarted,false);assert.equal(record.errorCode,'TIMEOUT');
  assert.deepEqual(f.runtime.expirePendingApprovals(),[]);assert.equal(f.runtime.getTask(taskId).revision,task.revision);
  for(const decision of ['allow_once','deny'])assert.throws(()=>f.runtime.respondApproval(approval.approvalId,decision,approval.revision),{code:'TIMEOUT'});
  assert.equal(f.runtime.readEvents().filter(event=>event.type==='task.failed').length,1);
});

test('a nearest-deadline Runtime timer resolves waiting approval without a UI read or response',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t),{taskId}=f.pending(20);f.setNow(start+20);t.mock.timers.tick(20);
  assert.equal(f.runtime.getTask(taskId).state,'failed');
  assert.equal(f.runtime.getApproval('original-approval').resolution.reason,'expired');
});

test('reopen resolves old pending approvals and keeps the resolved audit stable on another reopen',t=>{
  const f=fixture(t),{taskId}=f.pending();f.setNow(start+1000);f.reopen();
  const task=f.runtime.getTask(taskId),approval=f.runtime.getApproval('original-approval');
  assert.equal(task.state,'failed');assert.equal(approval.resolution.actor,'system');
  f.reopen();assert.deepEqual(f.runtime.getTask(taskId),task);assert.deepEqual(f.runtime.getApproval('original-approval'),approval);
});

test('allow before expiry keeps the original one-use grant; duplicate allow never replenishes it',t=>{
  const f=fixture(t),{taskId,approval}=f.pending();f.setNow(start+999);
  assert.deepEqual(f.runtime.respondApproval(approval.approvalId,'allow_once',1),{accepted:true,approvalState:'allowed'});
  const request={authorizationRef:approval.approvalId,taskId,toolName:descriptor.name,
    requiredScopes:descriptor.requiredScopes,argumentsDigest:digest,now:start+999};
  assert.throws(()=>f.runtime.policy.authorize({...request,argumentsDigest:'b'.repeat(64)}),{code:'SCOPE_DENIED'});
  assert.deepEqual(f.runtime.policy.authorize(request).scopes,['fixture:write']);
  f.runtime.respondApproval(approval.approvalId,'allow_once',1);
  assert.equal(f.runtime.policy.get(approval.approvalId).usesRemaining,0);
  assert.throws(()=>f.runtime.policy.authorize(request),{code:'UNAUTHORIZED'});
  f.setNow(start+1000);assert.deepEqual(f.runtime.expirePendingApprovals(),[]);
  assert.equal(f.runtime.getApproval(approval.approvalId).state,'allowed','historical user approval is not rewritten');
  assert.throws(()=>f.runtime.policy.authorize({...request,now:start+1000}),{code:'UNAUTHORIZED'});
});

test('stale revision never grants and a later expiry cannot become an accepted user denial',t=>{
  const f=fixture(t),{approval}=f.pending();
  assert.throws(()=>f.runtime.respondApproval(approval.approvalId,'allow_once',0),{code:'REVISION_CONFLICT'});
  assert.equal(f.runtime.getApproval(approval.approvalId).state,'pending');
  f.setNow(start+1000);
  assert.throws(()=>f.runtime.respondApproval(approval.approvalId,'deny',1),{code:'TIMEOUT'});
  assert.equal(f.runtime.getApproval(approval.approvalId).resolution.actor,'system');
});

test('expiry preserves a cancelled task and a late allow never creates authority',t=>{
  const f=fixture(t),{taskId,approval}=f.pending();
  assert.equal(f.runtime.requestCancel(taskId).state,'cancelled');
  assert.throws(()=>f.runtime.respondApproval(approval.approvalId,'allow_once',1),{code:'REVISION_CONFLICT'});
  f.setNow(start+1000);f.runtime.expirePendingApprovals();
  assert.equal(f.runtime.getTask(taskId).state,'cancelled');
  assert.equal(f.runtime.policy.get(approval.approvalId),undefined);
  assert.throws(()=>f.runtime.respondApproval(approval.approvalId,'allow_once',1),{code:'TIMEOUT'});
});

for(const hold of ['unknown-tool','cloud-inflight','cloud-unknown'])test('expiry preserves '+hold+' for reconciliation without replay',t=>{
  const f=fixture(t),{taskId}=f.pending();
  if(hold==='unknown-tool')f.runtime.saveToolExecution({protocolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,
    inputDigest:'b'.repeat(64),evidenceId:'original-unknown-write',requestId:'original-run',taskId,
    toolName:descriptor.name,toolVersion:descriptor.version,startedAt:new Date(start).toISOString(),state:'unknown'});
  else f.runtime.saveCheckpoint(taskId,'competition-'+hold,{original:true});
  f.setNow(start+1000);f.runtime.expirePendingApprovals();
  const task=f.runtime.getTask(taskId);assert.equal(task.state,'waiting_reconciliation');assert.equal(task.error.code,'RESULT_UNKNOWN');
  assert.equal(f.runtime.getApproval('original-approval').resolution.reason,'expired');
  if(hold==='unknown-tool')assert.equal(f.runtime.readToolExecutions(taskId).find(value=>value.evidenceId==='original-unknown-write').state,'unknown');
  assert.equal(f.runtime.policy.get('original-approval'),undefined);
});

test('expiry aborts an in-process waiting worker and its late result cannot reopen the terminal task',async t=>{
  const f=fixture(t),runtime=f.runtime;
  const task=runtime.submitTask({goal:'Synthetic pending consent',conversationId:'fixture',idempotencyKey:'active'});
  let signal;
  const execution=runtime.runTask(task.taskId,async context=>{
    signal=context.signal;runtime.requestToolApproval('active-approval',task.taskId,descriptor,new Date(start+1000).toISOString(),digest);
    await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));
    return {resultSummary:'Late synthetic worker return'};
  },{deadline:new Date(start+60_000).toISOString(),sideEffect:'external_write'});
  assert.equal(runtime.getTask(task.taskId).state,'waiting_approval');
  f.setNow(start+1000);runtime.expirePendingApprovals();
  assert.equal(signal.aborted,true);assert.equal((await execution).state,'failed');
  assert.equal(runtime.getTask(task.taskId).error.code,'TIMEOUT');
});
