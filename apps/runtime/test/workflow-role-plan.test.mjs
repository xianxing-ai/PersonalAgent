import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TaskRuntime,RuntimeError} from '../dist/index.js';
import {ProtocolError} from '@personal-agent/contracts';
import {DEFAULT_ROLE_LABELS} from '@personal-agent/agents';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import {createRuntimeWorkflowRolePlanHost} from '../dist/application/workflow-role-plan-host.js';
const intent=(plan,revision)=>({operationId:'synthetic-operation',requestDigest:workflowShadowReleaseDigest({plan,expectedRevision:revision})});

// Synthetic Policy, catalog and tasks; SQLite transactions are real Runtime operations.
function fixture(clock=()=>new Date()) {
  const root=join(process.cwd(),'.cache','workflow-role-plan');mkdirSync(root,{recursive:true});
  const file=join(mkdtempSync(join(root,'run-')),'runtime.sqlite'),a=new TaskRuntime(file,{now:clock}),b=new TaskRuntime(file,{now:clock});
  const parent=a.submitTask({goal:'Synthetic parent',conversationId:'synthetic',idempotencyKey:'parent'});
  const deadline=new Date(clock().getTime()+60000).toISOString();a.saveCheckpoint(parent.taskId,'application-deadline',deadline);
  const context={taskId:parent.taskId,runId:'synthetic',authorizationRef:'synthetic',scopes:['role:configure'],
    deadline,signal:new AbortController().signal};
  const roles=[['research','researcher'],['analysis','planner'],['coder','coder']].map(([role,dispatchRole])=>({role,
    definition:{subtaskId:role,role:dispatchRole,goal:`Synthetic ${role}`,model:`model-${role}`,reasoningEffort:'low',thinkingDepth:2},
    selection:{catalogRevision:'a'.repeat(64),modelId:`model-${role}`,reasoningEffort:'low'},maxSteps:6,verificationPolicyRef:`policy-${role}`}));
  const plan={version:1,parentTaskId:parent.taskId,deadline,roles};let allowed=true,stale=false;
  const options={runtime:a,requiredScopes:['role:configure'],now:clock,authorize:async()=>allowed,
    resolveSelection:async selection=>stale?{...selection,catalogRevision:'b'.repeat(64)}:selection,
    resolveBindIntent:async()=>({parentTaskId:parent.taskId,operationId:'synthetic-operation',requestDigest:workflowShadowReleaseDigest({plan,expectedRevision:parent.revision})}),
    assertCurrent:()=>{if(!allowed)throw Error('revoked');}};
  const data=role=>{const d=roles.find(item=>item.role===role).definition,label=DEFAULT_ROLE_LABELS[d.role];return {
    input:{conversationId:`desktop-subtask:${parent.taskId}`,goal:`[${label}] ${d.goal}`,
      idempotencyKey:`subagent-dispatch-${parent.taskId}-${d.subtaskId}`},
    binding:{...d,roleLabel:label,parentTaskId:parent.taskId,parentDeadline:deadline}};};
  return {file,a,b,parent,deadline,context,plan,options,data,deny:()=>{allowed=false;},stale:()=>{stale=true;}};
}
test('atomic prebind does not create or start a child without a pre-execution model gate',async()=>{
  const f=fixture();try {
    const host=createRuntimeWorkflowRolePlanHost(f.options);
    await assert.rejects(host.bind(f.plan,f.parent.revision+1,f.context),{code:'REVISION_CONFLICT'});
    assert.equal(f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1'),undefined);
    await host.bind(f.plan,f.parent.revision,f.context);
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});
    assert.equal((await host.read(f.context)).state,'unavailable');
    const data=f.data('research');
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,data.binding),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(f.a.findTaskByIdempotencyKey(data.input.idempotencyKey),undefined);
    assert.equal((await host.read(f.context)).roles.find(item=>item.role==='research').reason,'original_child_not_dispatched');
    const changed={...data.binding,model:'different'};
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,changed),{code:'REVISION_CONFLICT'});
    f.stale();await assert.rejects(host.read(f.context),{code:'UNSUPPORTED_CAPABILITY'});
    f.deny();await assert.rejects(host.read(f.context),{code:'SCOPE_DENIED'});
  } finally {f.a.close();f.b.close();}
});
test('child-first blocks binding and a pre-existing unmarked child cannot be retroactively bound',()=>{
  const f=fixture();try {
    const data=f.data('coder');f.b.submitTaskWithSubagentBinding(data.input,data.binding);
    assert.throws(()=>f.a.beginWorkflowRolePlanAttempt(f.plan,f.parent.revision,intent(f.plan,f.parent.revision)),{code:'REVISION_CONFLICT'});
    assert.equal(f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1'),undefined);
  } finally {f.a.close();f.b.close();}
});
test('revocation immediately after plan commit cannot create a child or invoke a model or tool',async()=>{
  const f=fixture();try {
    let calls=0;const host=createRuntimeWorkflowRolePlanHost({...f.options,assertCurrent:()=>{
      if(++calls===3)throw Error('synthetic revocation');
    }});
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});
    assert.ok(f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1'));
    const data=f.data('research');
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,data.binding),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(f.a.findTaskByIdempotencyKey(data.input.idempotencyKey),undefined);
    assert.deepEqual(f.a.readToolExecutions(f.parent.taskId),[]);
  } finally {f.a.close();f.b.close();}
});
test('post-commit timeout or cancellation reports RESULT_UNKNOWN and only independently authorized readback is permitted',async()=>{
  for(const cause of ['timeout','cancel']) {
    let time=Date.parse('2020-01-01T00:00:00.000Z');const clock=()=>new Date(time),f=fixture(clock);
    try {
      const controller=new AbortController(),original={...f.context,signal:controller.signal};let calls=0,auditAllowed=true;
      const expected=workflowShadowReleaseDigest(f.plan),binding={parentTaskId:f.parent.taskId,operationId:'synthetic-operation',
        requestDigest:workflowShadowReleaseDigest({plan:f.plan,expectedRevision:f.parent.revision}),expectedPlanSha256:expected};
      const host=createRuntimeWorkflowRolePlanHost({...f.options,assertCurrent:()=>{
        if(++calls===3){if(cause==='timeout')time=Date.parse(f.deadline);else controller.abort();}
      },reconciliation:{requiredScopes:['role:audit'],resolveOriginal:async()=>binding,
        authorize:async()=>auditAllowed,assertCurrent:()=>{}}});
      await assert.rejects(host.bind(f.plan,f.parent.revision,original),{code:'RESULT_UNKNOWN'});
      const data=f.data('research');assert.throws(()=>f.a.submitTaskWithSubagentBinding(data.input,data.binding),{code:'UNSUPPORTED_CAPABILITY'});
      assert.equal(f.a.findTaskByIdempotencyKey(data.input.idempotencyKey),undefined);
      time=Date.parse(f.deadline)+1000;
      const audit={taskId:'trusted-audit-task',runId:'audit',authorizationRef:'audit-grant',scopes:['role:audit'],
        signal:new AbortController().signal,deadline:new Date(time+60000).toISOString()};
      assert.deepEqual(await host.reconcile(audit),{state:'matched'});
      await assert.rejects(host.reconcile({...audit,scopes:[]}),{code:'SCOPE_DENIED'});
      auditAllowed=false;await assert.rejects(host.reconcile(audit),{code:'SCOPE_DENIED'});
      const noAudit=createRuntimeWorkflowRolePlanHost(f.options);
      await assert.rejects(noAudit.reconcile(audit),{code:'UNSUPPORTED_CAPABILITY'});
    } finally {f.a.close();f.b.close();}
  }
});
test('lost write response reconciles the original plan without a second write; conflicts and missing records never authorize retry',async()=>{
  const f=fixture();try {
    let attempts=0,originalBinding={parentTaskId:f.parent.taskId,operationId:'synthetic-operation',
      requestDigest:workflowShadowReleaseDigest({plan:f.plan,expectedRevision:f.parent.revision}),expectedPlanSha256:workflowShadowReleaseDigest(f.plan)};
    const wrapper={getTask:id=>f.a.getTask(id),loadCheckpoint:(id,key)=>f.a.loadCheckpoint(id,key),
      beginWorkflowRolePlanAttempt:(plan,revision,original)=>f.a.beginWorkflowRolePlanAttempt(plan,revision,original),
      findTaskByIdempotencyKey:id=>f.a.findTaskByIdempotencyKey(id),freezeWorkflowRolePlan:(plan,revision,original)=>{
        attempts++;f.a.freezeWorkflowRolePlan(plan,revision,original);throw new RuntimeError('REVISION_CONFLICT','synthetic lost response');}};
    const host=createRuntimeWorkflowRolePlanHost({...f.options,runtime:wrapper,reconciliation:{requiredScopes:['role:audit'],
      resolveOriginal:async()=>originalBinding,authorize:async()=>true,assertCurrent:()=>{}}});
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});
    const audit={...f.context,taskId:'audit-task',scopes:['role:audit']};
    assert.deepEqual(await host.reconcile(audit),{state:'matched'});assert.equal(attempts,1);
    originalBinding={...originalBinding,expectedPlanSha256:'b'.repeat(64)};
    assert.deepEqual(await host.reconcile(audit),{state:'conflict'});assert.equal(attempts,1);
    const other=f.a.submitTask({goal:'other',conversationId:'synthetic',idempotencyKey:'other-parent'});
    originalBinding={...originalBinding,parentTaskId:other.taskId};
    assert.deepEqual(await host.reconcile(audit),{state:'not_found'});assert.equal(attempts,1);
    const failing=createRuntimeWorkflowRolePlanHost({...f.options,runtime:{...wrapper,loadCheckpoint:()=>{throw Error('read failure');}},
      reconciliation:{requiredScopes:['role:audit'],resolveOriginal:async()=>originalBinding,authorize:async()=>true,assertCurrent:()=>{}}});
    await assert.rejects(failing.reconcile(audit),{code:'RESULT_UNKNOWN'});assert.equal(attempts,1);
  } finally {f.a.close();f.b.close();}
});
test('missing or substituted trusted original bind intent fails before any checkpoint write',async()=>{
  const f=fixture();try {
    const missing=createRuntimeWorkflowRolePlanHost({...f.options,resolveBindIntent:undefined});
    await assert.rejects(missing.bind(f.plan,f.parent.revision,f.context),{code:'UNSUPPORTED_CAPABILITY'});
    const altered=createRuntimeWorkflowRolePlanHost({...f.options,resolveBindIntent:async()=>({parentTaskId:f.parent.taskId,
      operationId:'synthetic-operation',requestDigest:'0'.repeat(64)})});
    await assert.rejects(altered.bind(f.plan,f.parent.revision,f.context),{code:'REVISION_CONFLICT'});
    assert.equal(f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1'),undefined);
    assert.deepEqual(f.a.readToolExecutions(f.parent.taskId),[]);
  } finally {f.a.close();f.b.close();}
});
test('a crash after durable reservation and before plan commit prevents both replay and unbound child creation',async()=>{
  const f=fixture();try {
    let writes=0;
    const wrapper={getTask:id=>f.a.getTask(id),loadCheckpoint:(id,key)=>f.a.loadCheckpoint(id,key),
      findTaskByIdempotencyKey:id=>f.a.findTaskByIdempotencyKey(id),
      beginWorkflowRolePlanAttempt:(plan,revision,original)=>f.a.beginWorkflowRolePlanAttempt(plan,revision,original),
      freezeWorkflowRolePlan:()=>{writes++;throw Error('synthetic crash before plan commit');}};
    const binding={parentTaskId:f.parent.taskId,operationId:'synthetic-operation',
      requestDigest:workflowShadowReleaseDigest({plan:f.plan,expectedRevision:f.parent.revision}),expectedPlanSha256:workflowShadowReleaseDigest(f.plan)};
    const host=createRuntimeWorkflowRolePlanHost({...f.options,runtime:wrapper,reconciliation:{requiredScopes:['role:audit'],
      resolveOriginal:async()=>binding,authorize:async()=>true,assertCurrent:()=>{}}});
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});
    await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),{code:'RESULT_UNKNOWN'});assert.equal(writes,1);
    const data=f.data('research');
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,{...data.binding,model:'substituted'}),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,data.binding),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(f.a.findTaskByIdempotencyKey(data.input.idempotencyKey),undefined);
    assert.deepEqual(await host.reconcile({...f.context,taskId:'audit-task',scopes:['role:audit']}),{state:'not_found'});
    assert.equal(writes,1);
  } finally {f.a.close();f.b.close();}
});
test('host callback failures use fixed messages and never expose sensitive callback text',async()=>{
  const f=fixture(),secret='synthetic-credential-must-not-appear';
  const noLeak=expected=>error=>error.code===expected&&!String(error.message).includes(secret)&&!String(error.stack).includes(secret);
  try {
    for(const options of [
      {...f.options,authorize:async()=>{throw Error(secret);}},
      {...f.options,resolveSelection:async()=>{throw new ProtocolError('SCOPE_DENIED',secret);}},
      {...f.options,resolveBindIntent:async()=>{throw Error(secret);}},
      {...f.options,assertCurrent:()=>{throw Error(secret);}},
    ]) {
      const host=createRuntimeWorkflowRolePlanHost(options);
      await assert.rejects(host.bind(f.plan,f.parent.revision,f.context),noLeak(options.resolveSelection!==f.options.resolveSelection?'SCOPE_DENIED':'EXTERNAL_FAILURE'));
    }
    const auditHost=createRuntimeWorkflowRolePlanHost({...f.options,reconciliation:{requiredScopes:['role:audit'],
      resolveOriginal:async()=>{throw Error(secret);},authorize:async()=>true,assertCurrent:()=>{}}});
    await assert.rejects(auditHost.reconcile({...f.context,scopes:['role:audit']}),noLeak('EXTERNAL_FAILURE'));
    assert.equal(f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1'),undefined);
  } finally {f.a.close();f.b.close();}
});
test('freeze checks the injected Runtime clock inside the transaction including the expiry boundary',()=>{
  const f=fixture();f.a.close();f.b.close();
  let now=Date.parse('2020-01-01T00:00:00.000Z');const runtime=new TaskRuntime(f.file,{now:()=>new Date(now)});
  try {
    const deadline='2020-01-01T00:01:00.000Z',parent=runtime.submitTask({goal:'clock',conversationId:'clock',idempotencyKey:'clock-one'});
    runtime.saveCheckpoint(parent.taskId,'application-deadline',deadline);
    const plan={...f.plan,parentTaskId:parent.taskId,deadline},original=intent(plan,parent.revision);
    runtime.beginWorkflowRolePlanAttempt(plan,parent.revision,original);
    assert.equal(runtime.freezeWorkflowRolePlan(plan,parent.revision,original).deadline,deadline);
    now=Date.parse(deadline);
    assert.throws(()=>runtime.freezeWorkflowRolePlan(plan,parent.revision,original),{code:'REVISION_CONFLICT'});
    now=Date.parse('2020-01-01T00:00:00.000Z');
    const later=runtime.submitTask({goal:'clock',conversationId:'clock',idempotencyKey:'clock-two'});
    runtime.saveCheckpoint(later.taskId,'application-deadline',deadline);now=Date.parse(deadline);
    const latePlan={...f.plan,parentTaskId:later.taskId,deadline};
    assert.throws(()=>runtime.beginWorkflowRolePlanAttempt(latePlan,later.revision,intent(latePlan,later.revision)),{code:'REVISION_CONFLICT'});
    assert.equal(runtime.loadCheckpoint(later.taskId,'workflow-f28-native-role-plan:v1'),undefined);
  } finally {runtime.close();}
});
test('idempotent role-plan replay rejects parent revision drift and cancellation',()=>{
  const f=fixture();try {
    const original=intent(f.plan,f.parent.revision);f.a.beginWorkflowRolePlanAttempt(f.plan,f.parent.revision,original);
    f.a.freezeWorkflowRolePlan(f.plan,f.parent.revision,original);
    const changed=f.a.recordProgress(f.parent.taskId,{stepId:'synthetic',label:'synthetic'});
    assert.throws(()=>f.b.freezeWorkflowRolePlan(f.plan,f.parent.revision,original),{code:'REVISION_CONFLICT'});
    f.a.requestCancel(f.parent.taskId,'synthetic cancellation');
    const cancelled=f.a.getTask(f.parent.taskId);
    assert.ok(cancelled.cancelRequested||cancelled.state==='cancelled');
    assert.throws(()=>f.b.freezeWorkflowRolePlan(f.plan,changed.revision,intent(f.plan,changed.revision)),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.b.freezeWorkflowRolePlan(f.plan,cancelled.revision,intent(f.plan,cancelled.revision)),{code:'REVISION_CONFLICT'});
  } finally {f.a.close();f.b.close();}
});
test('host bind and read use the same injected Runtime clock instead of wall time',async()=>{
  const f=fixture();f.a.close();f.b.close();
  let now=Date.parse('2020-01-01T00:00:00.000Z');const clock=()=>new Date(now),runtime=new TaskRuntime(f.file,{now:clock});
  try {
    const deadline='2020-01-01T00:01:00.000Z',parent=runtime.submitTask({goal:'clock-host',conversationId:'clock',idempotencyKey:'clock-host'});
    runtime.saveCheckpoint(parent.taskId,'application-deadline',deadline);
    const plan={...f.plan,parentTaskId:parent.taskId,deadline},context={...f.context,taskId:parent.taskId,deadline};
    const host=createRuntimeWorkflowRolePlanHost({...f.options,runtime,now:clock,
      resolveBindIntent:async()=>({parentTaskId:parent.taskId,operationId:'clock-operation',
        requestDigest:workflowShadowReleaseDigest({plan,expectedRevision:parent.revision})})});
    await host.bind(plan,parent.revision,context);
    assert.equal((await host.read(context)).state,'unavailable');
    now=Date.parse(deadline);
    await assert.rejects(host.read(context),{code:'TIMEOUT'});
    await assert.rejects(host.bind(plan,parent.revision,context),{code:'TIMEOUT'});
  } finally {runtime.close();}
});
test('ordinary non-F28 subagent creation remains idempotent and rejects altered or missing original binding',()=>{
  const f=fixture();try {
    const data=f.data('analysis'),first=f.a.submitTaskWithSubagentBinding(data.input,data.binding);
    assert.deepEqual(f.b.submitTaskWithSubagentBinding(data.input,data.binding),first);
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(data.input,{...data.binding,thinkingDepth:3}),{code:'REVISION_CONFLICT'});
    const other={...data.input,idempotencyKey:`subagent-dispatch-${f.parent.taskId}-legacy`};
    f.a.submitTask(other);
    assert.throws(()=>f.b.submitTaskWithSubagentBinding(other,{...data.binding,subtaskId:'legacy'}),{code:'REVISION_CONFLICT'});
    const historical=f.data('research');
    const saved=f.a.submitTaskWithCheckpoint({...historical.input,attachmentRefs:['synthetic-historical-attachment']},'subtask-parent',historical.binding);
    assert.deepEqual(f.b.submitTaskWithSubagentBinding(historical.input,historical.binding),saved);
  } finally {f.a.close();f.b.close();}
});
test('two independent processes cannot create a child before a role plan and later claim an atomic binding',async()=>{
  const f=fixture();try {
    const script=fileURLToPath(new URL('./fixtures/workflow-role-race.mjs',import.meta.url));
    const start=()=>fork(script,[f.file],{stdio:['ignore','ignore','ignore','ipc']});
    const left=start(),right=start();
    const ready=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',resolve);});
    await Promise.all([ready(left),ready(right)]);
    const outcome=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',resolve);});
    const leftResult=outcome(left),rightResult=outcome(right),data=f.data('research');
    left.send({kind:'bind',plan:f.plan,parentRevision:f.parent.revision,intent:intent(f.plan,f.parent.revision)});
    right.send({kind:'child',input:data.input,binding:data.binding});
    const results=await Promise.all([leftResult,rightResult]);
    assert.ok(results.some(value=>value.state==='completed'));
    const plan=f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-plan:v1');
    const reservation=f.a.loadCheckpoint(f.parent.taskId,'workflow-f28-native-role-attempt:v1');
    const child=f.a.findTaskByIdempotencyKey(data.input.idempotencyKey);
    assert.equal(Boolean(plan&&child),false,'F28 plan and child cannot both exist before a pre-execution gate');
    assert.equal(Boolean(reservation&&child),false,'An attempt and an unbound child cannot both exist');
    if(!plan&&child)assert.equal(f.a.loadCheckpoint(child.taskId,'workflow-f28-native-role-child:v1'),undefined);
  } finally {f.a.close();f.b.close();}
});
