import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {workflowShadowReleaseDigest as digest} from '@personal-agent/agentarts';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeWorkflowShadowConfigurationPort} from '../dist/application/workflow-shadow-configuration.js';
import {createRuntimeWorkflowShadowAcceptanceHost} from '../dist/application/workflow-shadow-acceptance.js';

// Real Runtime SQLite and CAS. Authorization inputs and configuration values are synthetic.
const context=()=>({taskId:'synthetic-task',runId:'synthetic-run',authorizationRef:'synthetic-policy-grant',
  scopes:['workflow:configuration'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
const snapshot=(configurationId,version,parameters,revision=1)=>({configurationId,version,parameters,revision,parametersDigest:digest(parameters)});
const write=(operationId,expected,next,extra={})=>{
  const body={operationId,configurationId:expected.configurationId,action:'promote',expected,
    next:{configurationId:expected.configurationId,version:next.version,parameters:next.parameters,parametersDigest:next.parametersDigest},
    sourceDigest:digest({source:'synthetic'}),...extra};
  return {...body,requestDigest:digest(body)};
};
const opts=runtime=>({runtime,namespace:'shadow',stateKey:'configuration-ledger',requiredScopes:['workflow:configuration'],
  authorize:async ctx=>ctx.authorizationRef==='synthetic-policy-grant',
  acceptanceBinding:{namespace:'shadow-acceptance',stateKey:'policies',policyId:'synthetic-policy'},
  // Synthetic test-only gates; production requires the real original Policy/intent guard.
  initializeGuard:{runtime,assertCurrent:()=>{}},commitGuard:{runtime,assertCurrent:()=>{}}});
async function setupAcceptance(runtime) {
  const host=createRuntimeWorkflowShadowAcceptanceHost({runtime,namespace:'shadow-acceptance',stateKey:'policies',
    requiredScopes:['workflow:configuration'],authorize:async()=>true});
  await host.configure('fixture-acceptance',{policyId:'synthetic-policy',revision:1,configurationId:'config-a',taskClass:'fixture',
    validFrom:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    baseline:{revision:1,version:'v1',parametersDigest:'a'.repeat(64),resultBaselineSha256:'b'.repeat(64)},
    candidate:{version:'v2',parametersDigest:'c'.repeat(64)},conditionsDigest:'d'.repeat(64),qualityMetricId:'fixture',
    metricRules:[{metric:'qualityScore',bound:'min_delta',value:0}],requiredChecks:['fixture']},context());
}
function fixture() {
  const root=join(process.cwd(),'.cache','shadow-configuration');mkdirSync(root,{recursive:true});
  return join(mkdtempSync(join(root,'run-')),'runtime.sqlite');
}
test('SQLite CAS persists configuration and original operations across competing writers and restart',async()=>{
  const file=fixture();let a=new TaskRuntime(file),b=new TaskRuntime(file);
  const old=snapshot('config-a','v1',{threshold:1}),next=snapshot('config-a','v2',{threshold:2});
  try {
    await setupAcceptance(a);
    const first=createRuntimeWorkflowShadowConfigurationPort(opts(a));
    const second=createRuntimeWorkflowShadowConfigurationPort(opts(b));
    await first.initialize([old,snapshot('config-b','v1',{threshold:3})],context());
    await assert.rejects(second.initialize([old],context()),{code:'REVISION_CONFLICT'});
    const one=write('operation-1',old,next),two=write('operation-2',old,snapshot('config-a','v3',{threshold:4}));
    const results=await Promise.all([first.compareAndSet(one,context()),second.compareAndSet(two,context())]);
    assert.deepEqual(results.map(value=>value.state).sort(),['applied','rejected']);
    const applied=results.find(value=>value.state==='applied'),rejected=results.find(value=>value.state==='rejected');
    assert.equal(rejected.reason,'configuration_revision_changed');
    assert.deepEqual(await first.compareAndSet(applied.request,context()),applied);
    const collision=write(applied.request.operationId,snapshot('config-b','v1',{threshold:3}),snapshot('config-b','v2',{threshold:5}));
    await assert.rejects(second.compareAndSet(collision,context()),{code:'REVISION_CONFLICT'});
    assert.deepEqual(await second.read('config-a',context()),applied.after);
    a.close();b.close();a=undefined;b=undefined;
    const reopened=new TaskRuntime(file);
    try {
      const port=createRuntimeWorkflowShadowConfigurationPort(opts(reopened));
      assert.deepEqual(await port.readOperation(applied.request.operationId,context()),applied);
      assert.deepEqual(await port.readOperation(rejected.request.operationId,context()),rejected);
      assert.deepEqual(await port.read('config-a',context()),applied.after);
      assert.deepEqual(await port.readOperation('never-written',context()),{state:'not_started'});
      const rollback=write('rollback-1',applied.after,applied.before,{action:'rollback',promotionOperationId:applied.request.operationId});
      const result=await port.compareAndSet(rollback,context());
      assert.equal(result.state,'applied');assert.equal(result.after.revision,3);
      assert.deepEqual(result.after.parameters,old.parameters);
      const forged=write('rollback-2',result.after,applied.before,{action:'rollback',promotionOperationId:applied.request.operationId});
      assert.equal((await port.compareAndSet(forged,context())).reason,'rollback_anchor_invalid');
    } finally {reopened.close();}
  } finally {a?.close();b?.close();}
});
test('uncertain committed CAS is reconciled by the same durable operation without replay',async()=>{
  const runtime=new TaskRuntime(fixture());
  try {
    await setupAcceptance(runtime);
    const old=snapshot('config-a','v1',{value:1});
    let failAfterCommit=false,writes=0;
    const original=runtime.compareAndSetTrustedHostStateGuarded.bind(runtime);
    runtime.compareAndSetTrustedHostStateGuarded=(namespace,key,expected,value,guard)=>{
        const result=original(namespace,key,expected,value,guard);
        if(failAfterCommit&&result){writes++;throw new Error('synthetic lost response after commit');}
        return result;
      };
    const port=createRuntimeWorkflowShadowConfigurationPort(opts(runtime));
    await port.initialize([old],context());failAfterCommit=true;
    const request=write('uncertain-1',old,snapshot('config-a','v2',{value:2}));
    await assert.rejects(port.compareAndSet(request,context()),/lost response/);
    const reconciled=await port.readOperation('uncertain-1',context());
    assert.equal(reconciled.state,'applied');assert.equal(writes,1);
    assert.deepEqual(await port.compareAndSet(request,context()),reconciled);assert.equal(writes,1);
  } finally {runtime.close();}
});
test('a definite failed CAS rereads and reauthorizes before retrying',async()=>{
  const runtime=new TaskRuntime(fixture());
  try {
    await setupAcceptance(runtime);
    let failOnce=false,authorizations=0;
    const original=runtime.compareAndSetTrustedHostStateGuarded.bind(runtime);
    runtime.compareAndSetTrustedHostStateGuarded=(namespace,key,expected,value,guard)=>{
        if(failOnce){failOnce=false;return false;}
        return original(namespace,key,expected,value,guard);
      };
    const port=createRuntimeWorkflowShadowConfigurationPort({...opts(runtime),authorize:async(_context,action)=>{
      if(action==='write')authorizations++;return true;
    }});
    const old=snapshot('config-a','v1',{value:1});await port.initialize([old],context());failOnce=true;
    const result=await port.compareAndSet(write('retry-1',old,snapshot('config-a','v2',{value:2})),context());
    assert.equal(result.state,'applied');assert.equal(authorizations,2);
    assert.deepEqual(await port.readOperation('retry-1',context()),result);
  } finally {runtime.close();}
});
test('host rejects uninitialized, substituted, unauthorized, cancelled and expired requests',async()=>{
  const runtime=new TaskRuntime(fixture());
  try {
    await setupAcceptance(runtime);
    const port=createRuntimeWorkflowShadowConfigurationPort(opts(runtime));
    const old=snapshot('config-a','v1',{value:1}),request=write('op',old,snapshot('config-a','v2',{value:2}));
    await assert.rejects(port.compareAndSet(request,context()),{code:'UNSUPPORTED_CAPABILITY'});
    await assert.rejects(port.read('config-a',context()),{code:'UNSUPPORTED_CAPABILITY'});
    await assert.rejects(port.readOperation('op',context()),{code:'UNSUPPORTED_CAPABILITY'});
    await port.initialize([old],context());
    await assert.rejects(port.compareAndSet({...request,next:{...request.next,version:'substituted'}},context()),{code:'INVALID_ARGUMENT'});
    await assert.rejects(port.read('config-a',{...context(),authorizationRef:'forged'}),{code:'SCOPE_DENIED'});
    await assert.rejects(port.read('config-a',{...context(),scopes:[]}),{code:'SCOPE_DENIED'});
    const controller=new AbortController();controller.abort();
    await assert.rejects(port.read('config-a',{...context(),signal:controller.signal}),{code:'CANCELLED'});
    await assert.rejects(port.read('config-a',{...context(),deadline:'2000-01-01T00:00:00Z'}),{code:'TIMEOUT'});
    const controllerAfterAuth=new AbortController(),revoked=createRuntimeWorkflowShadowConfigurationPort({
      ...opts(runtime),authorize:async()=>{controllerAfterAuth.abort();return true;}});
    await assert.rejects(revoked.compareAndSet(request,{...context(),signal:controllerAfterAuth.signal}),{code:'CANCELLED'});
    assert.deepEqual(await port.readOperation('op',context()),{state:'not_started'});
    assert.deepEqual(await port.read('config-a',context()),old);
  } finally {runtime.close();}
});
test('missing or asynchronous transactional guard cannot write or create an operation',async()=>{
  const file=fixture(),runtime=new TaskRuntime(file),other=new TaskRuntime(file);
  try {
    await setupAcceptance(runtime);
    const old=snapshot('config-a','v1',{value:1}),request=write('guarded',old,snapshot('config-a','v2',{value:2}));
    const port=createRuntimeWorkflowShadowConfigurationPort(opts(runtime));await port.initialize([old],context());
    const missing=createRuntimeWorkflowShadowConfigurationPort({...opts(runtime),commitGuard:undefined});
    await assert.rejects(missing.compareAndSet(request,context()),{code:'UNSUPPORTED_CAPABILITY'});
    const differentRuntime=createRuntimeWorkflowShadowConfigurationPort({...opts(runtime),commitGuard:{runtime:other,assertCurrent:()=>{}}});
    await assert.rejects(differentRuntime.compareAndSet(request,context()),{code:'UNSUPPORTED_CAPABILITY'});
    const asynchronous=createRuntimeWorkflowShadowConfigurationPort({...opts(runtime),commitGuard:{runtime,assertCurrent:async()=>{}}});
    await assert.rejects(asynchronous.compareAndSet(request,context()),{code:'UNAUTHORIZED'});
    assert.deepEqual(await port.readOperation('guarded',context()),{state:'not_started'});
    assert.deepEqual(await port.read('config-a',context()),old);
  } finally {other.close();runtime.close();}
});
