import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeWorkflowShadowAcceptanceHost} from '../dist/application/workflow-shadow-acceptance.js';

// Synthetic configured criteria, real Runtime SQLite: this never creates a test pass.
const context=()=>({taskId:'synthetic-config',runId:'synthetic-run',authorizationRef:'synthetic-grant',
  scopes:['configuration:release'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
const policy=(revision=1)=>({policyId:'synthetic-policy',revision,configurationId:'synthetic-config',taskClass:'synthetic-task-class',
  validFrom:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
  baseline:{revision:1,version:'v1',parametersDigest:'a'.repeat(64),resultBaselineSha256:'b'.repeat(64)},
  candidate:{version:'v2',parametersDigest:'c'.repeat(64)},conditionsDigest:'d'.repeat(64),qualityMetricId:'synthetic-quality',
  metricRules:[{metric:'qualityScore',bound:'min_delta',value:0.1}],requiredChecks:['unit']});
function fixture() {const dir=join(process.cwd(),'.cache','workflow-shadow-acceptance');mkdirSync(dir,{recursive:true});
  return join(mkdtempSync(join(dir,'run-')),'runtime.sqlite');}
const options=runtime=>({runtime,namespace:'acceptance',stateKey:'policies',requiredScopes:['configuration:release'],
  authorize:async ctx=>ctx.authorizationRef==='synthetic-grant'});
test('authorized acceptance versions are immutable, read back, idempotent, durable and CAS protected',async()=>{
  const file=fixture();let a=new TaskRuntime(file),b=new TaskRuntime(file);
  try {
    const first=createRuntimeWorkflowShadowAcceptanceHost(options(a)),second=createRuntimeWorkflowShadowAcceptanceHost(options(b));
    const v1=policy(),v2={...v1,revision:2},v2other={...v2,qualityMetricId:'other'};
    assert.deepEqual(await first.configure('op-1',v1,context()),v1);
    assert.deepEqual(await second.configure('op-1',v1,context()),v1);
    await assert.rejects(second.configure('op-1',v2,context()),{code:'REVISION_CONFLICT'});
    const settled=await Promise.allSettled([first.configure('op-2',v2,context()),second.configure('op-3',v2other,context())]);
    assert.equal(settled.filter(item=>item.status==='fulfilled').length,1);
    assert.equal(settled.filter(item=>item.status==='rejected'&&item.reason.code==='REVISION_CONFLICT').length,1);
    assert.deepEqual(await first.read(v1.policyId,context(),1),v1);
    a.close();b.close();a=undefined;b=undefined;
    const reopened=new TaskRuntime(file);
    try {
      const restored=createRuntimeWorkflowShadowAcceptanceHost(options(reopened));
      assert.deepEqual(await restored.read(v1.policyId,context(),1),v1);
      assert.equal((await restored.read(v1.policyId,context())).revision,2);
      assert.deepEqual((await restored.readOperation('op-1',context())).acceptance,v1);
      assert.equal(await restored.readOperation('not-started',context()),undefined);
    } finally {reopened.close();}
  } finally {a?.close();b?.close();}
});
test('incomplete, expired, modified, unauthorized and cancelled acceptance cannot be stored',async()=>{
  const runtime=new TaskRuntime(fixture());
  try {
    const host=createRuntimeWorkflowShadowAcceptanceHost(options(runtime)),v1=policy();
    for(const invalid of [{...v1,requiredChecks:[]},{...v1,validFrom:'yesterday'},
      {...v1,expiresAt:new Date(Date.now()-500).toISOString()}, {...v1,metricRules:[{metric:'qualityScore',bound:'min_delta',value:NaN}]},
      {...v1,baseline:{...v1.baseline,parametersDigest:'not-a-digest'}}, {...v1,extra:'not-allowed'}])
      await assert.rejects(host.configure('bad',invalid,context()),{code:'INVALID_ARGUMENT'});
    await assert.rejects(host.configure('bad',v1,{...context(),authorizationRef:'forged'}),{code:'SCOPE_DENIED'});
    const controller=new AbortController(),revoked=createRuntimeWorkflowShadowAcceptanceHost({...options(runtime),authorize:async()=>{controller.abort();return true;}});
    await assert.rejects(revoked.configure('bad',v1,{...context(),signal:controller.signal}),{code:'CANCELLED'});
    assert.equal(await host.read(v1.policyId,context()),undefined);
  } finally {runtime.close();}
});
