import test from 'node:test';
import assert from 'node:assert/strict';
import {readReconciliationStatus} from '../electron/reconciliation-status.js';

const task={taskId:'held-task',state:'waiting_reconciliation',cancelRequested:true};
const deadline='2026-10-21T12:23:53.000Z';
const now=()=>Date.parse('2026-10-21T12:30:00.000Z');
function fixture(checkpoints={}) {
  const calls=[];
  const application={runtime:{readToolExecutions:()=>[],loadCheckpoint(taskId,name){calls.push({taskId,name});return checkpoints[name];}}};
  return {application,calls};
}

test('cancelled request and expired deadline leave cloud UNKNOWN blocked without mutating Runtime facts',()=>{
  const checkpoints={'application-deadline':deadline,'competition-cloud-inflight':{privateReceipt:'secret'},'competition-cloud-unknown':{privateReceipt:'secret'}};
  const before=structuredClone({task,checkpoints});
  const {application,calls}=fixture(checkpoints);
  const status=readReconciliationStatus(application,task,now);
  assert.deepEqual({...status,blockedReason:undefined},{deadline,deadlineExpired:true,blockedReason:undefined});
  assert.equal(status.blockedReason,'当前没有该操作的自动核查入口。');
  assert.equal(JSON.stringify(status).includes('secret'),false);
  assert.deepEqual({task,checkpoints},before);
  assert.deepEqual(calls.map(item=>item.name),['application-deadline','competition-cloud-inflight','competition-cloud-unknown']);
});

test('inflight alone has a distinct explanation and an unexpired deadline',()=>{
  const {application}=fixture({'application-deadline':deadline,'competition-cloud-inflight':{accepted:true}});
  const status=readReconciliationStatus(application,task,()=>Date.parse(deadline)-1);
  assert.equal(status.deadlineExpired,false);
  assert.equal(status.blockedReason,'当前没有该操作的自动核查入口。');
  assert.doesNotMatch(status.blockedReason,/期限已过/);
});

test('non-waiting tasks do not read checkpoints or suggest recovery',()=>{
  const {application,calls}=fixture();
  for(const state of ['running','cancelling','succeeded','failed','cancelled'])
    assert.deepEqual(readReconciliationStatus(application,{...task,state},now),{});
  assert.deepEqual(readReconciliationStatus(application,undefined,now),{});
  assert.equal(calls.length,0);
});

test('native Harness readback remains available despite cloud markers and expiration',()=>{
  const {application}=fixture({'application-deadline':deadline,'competition-cloud-inflight':{},'competition-cloud-unknown':{}});
  application.readHarnessCandidateRecoveryAvailable=taskId=>{assert.equal(taskId,task.taskId);return true;};
  application.runtime.readReceivedCloudFailureBinding=()=>{throw Error('must not inspect another recovery path');};
  assert.deepEqual(readReconciliationStatus(application,task,now),{deadline,deadlineExpired:true,actionLabel:'核对原编码操作'});
});

test('trusted received-failure binding remains available despite an inflight marker',()=>{
  const {application}=fixture({'application-deadline':deadline,'competition-cloud-inflight':{}});
  application.readHarnessCandidateRecoveryAvailable=()=>false;
  application.runtime.readReceivedCloudFailureBinding=taskId=>{assert.equal(taskId,task.taskId);return 'trusted-binding';};
  assert.deepEqual(readReconciliationStatus(application,task,now),{deadline,deadlineExpired:true,actionLabel:'按已有回执尝试结束'});
});

test('absence of a cloud marker does not copy Runtime reconciliation authorization into Desktop',()=>{
  const {application}=fixture({'application-deadline':deadline});
  const status=readReconciliationStatus(application,task,now);
  assert.equal(status.actionLabel,undefined);assert.match(status.blockedReason,/没有该操作的自动核查入口/);
  assert.equal(status.deadline,deadline);assert.equal(status.deadlineExpired,true);
});

test('checkpoint failures and malformed deadlines fail closed without leaking errors',()=>{
  const {application}=fixture();
  application.runtime.loadCheckpoint=()=>{throw Error('private token');};
  for(const candidate of [application,undefined,fixture({'application-deadline':{token:'private token'}}).application]) {
    const status=readReconciliationStatus(candidate,task,now);
    assert.match(status.notice,/暂时无法读取/);assert.equal(status.actionLabel,'按已有回执尝试结束');assert.equal(status.blockedReason,undefined);
    assert.equal(JSON.stringify(status).includes('private token'),false);
    assert.equal(status.deadline,undefined);
  }
});

test('exceptions from trusted recovery reads do not claim reconciliation is available',()=>{
  const {application}=fixture({'competition-cloud-unknown':{}});
  application.readHarnessCandidateRecoveryAvailable=()=>{throw Error('private receipt');};
  const status=readReconciliationStatus(application,task,now);
  assert.match(status.notice,/暂时无法读取/);assert.equal(status.actionLabel,'按已有回执尝试结束');
  assert.equal(JSON.stringify(status).includes('private receipt'),false);
});

test('confirmed original child receipts preserve an attempt even with export-withheld while ordinary writes do not',()=>{
  for(const name of ['subagent.dispatch','coding.repair.workflow']){
    const {application}=fixture({'competition-export-withheld':{synthetic:true}});
    application.runtime.readToolExecutions=()=>[{executionStarted:true,policyDecision:'allow',state:'confirmed',toolName:name}];
    const status=readReconciliationStatus(application,task,now);
    assert.equal(status.actionLabel,'按已有回执尝试结束');assert.equal(status.blockedReason,undefined);
  }
  for(const record of [{executionStarted:true,policyDecision:'allow',state:'unknown',toolName:'subagent.dispatch'},
    {executionStarted:true,policyDecision:'allow',state:'confirmed',toolName:'mail.send'},
    {executionStarted:false,policyDecision:'deny',state:'confirmed',toolName:'subagent.dispatch'}]){
    const {application}=fixture();application.runtime.readToolExecutions=()=>[record];
    const status=readReconciliationStatus(application,task,now);assert.equal(status.actionLabel,undefined);assert.match(status.blockedReason,/没有该操作的自动核查入口/);
  }
});

test('execution record read failures preserve only an honest attempt, never a false no-entry claim or private error',()=>{
  for(const read of [()=>{throw Error('private receipt token');},()=>({private:'receipt'})]){
    const {application}=fixture();application.runtime.readToolExecutions=read;
    const status=readReconciliationStatus(application,task,now);
    assert.equal(status.actionLabel,'按已有回执尝试结束');assert.equal(status.blockedReason,undefined);
    assert.match(status.notice,/暂时无法读取/);assert.doesNotMatch(JSON.stringify(status),/private receipt token/);
  }
});
