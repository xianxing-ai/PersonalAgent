import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Optional immutable patched-copy import supports reviewing an existing Owner patch before applying it.
// Normal repository runs consume the production build.
const moduleUrl=process.env.PA_TEST_PROACTIVE_ADAPTER_PATH
  ?pathToFileURL(process.env.PA_TEST_PROACTIVE_ADAPTER_PATH):new URL('../dist/application/proactive-image-adapter.js',import.meta.url);
const {createRuntimeProactiveImageAdapter}=await import(moduleUrl);
const gateway='https://synthetic-agentarts.invalid',runtimeName='synthetic-runtime';
const response=()=>new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify({
  proactiveVersion:1,verification:'unverified',descriptor:{id:'proactive.responsibility.v1',profile:'huawei_ict_agentarts'},
  adapters:[],contracts:[]})}},{event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});
const context=()=>({taskId:'synthetic-task',sessionId:'synthetic-session',requestId:'synthetic-describe',controlRevision:0,
  deadline:new Date(Date.now()+60_000).toISOString(),taskDeadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
const options=extra=>({receiptSecret:'synthetic-public-signing-key-at-least-32',authorizationProvider:{read:async()=>'Bearer synthetic'},...extra});

for(const [label,config,expected] of [
  ['HTTPS fixed version',{gatewayUrl:gateway,runtimeName,deploymentVersion:'2026.10.18.1'},gateway+'/runtimes/'+runtimeName+'/invocations?endpoint=2026.10.18.1'],
  ['WSS fixed version',{gatewayUrl:gateway,runtimeName,websocketUrl:`wss://synthetic-agentarts.invalid/runtimes/${runtimeName}/ws?endpoint=build.v1`},gateway+'/runtimes/'+runtimeName+'/invocations?endpoint=build.v1'],
  ['legacy config',{gatewayUrl:gateway,runtimeName},gateway+'/runtimes/'+runtimeName+'/invocations'],
])test('Synthetic proactive deployment adapter preserves '+label,async()=>{
  const requests=[];const adapter=createRuntimeProactiveImageAdapter(options({config,fetchImpl:async(url,init)=>{requests.push({url,init});return response();}}));
  await adapter.describe(context());assert.equal(requests.length,1);assert.equal(requests[0].url,expected);
  assert.equal(requests[0].init.redirect,'error');
});

test('Synthetic proactive deployment adapter keeps explicit local mirror endpoint compatibility',async()=>{
  let called=0;const endpoint='http://127.0.0.1:18765/invocations?endpoint=public-fixture';
  const adapter=createRuntimeProactiveImageAdapter(options({endpoint,fetchImpl:async url=>{called++;assert.equal(url,endpoint);return response();}}));
  await adapter.describe(context());assert.equal(called,1);
});

test('Synthetic conflicting, cross-origin and unknown WSS query bindings reject before credentials or fetch',()=>{
  for(const websocketUrl of [
    `wss://synthetic-agentarts.invalid/runtimes/${runtimeName}/ws?endpoint=other`,
    `wss://foreign.invalid/runtimes/${runtimeName}/ws?endpoint=build.v1`,
    `wss://synthetic-agentarts.invalid/runtimes/${runtimeName}/ws?endpoint=build.v1&other=1`,
  ])assert.throws(()=>createRuntimeProactiveImageAdapter(options({config:{gatewayUrl:gateway,runtimeName,deploymentVersion:'build.v1',websocketUrl},
    authorizationProvider:{read:async()=>assert.fail('No credentials for invalid binding')},fetchImpl:async()=>assert.fail('No send for invalid binding')})),{code:'INVALID_ARGUMENT'});
});

test('Synthetic deployment guard rejects changes before credentials and after a credential wait',async()=>{
  for(const phase of ['before_credentials','during_credentials']) {
    let changed=phase==='before_credentials',reads=0,sends=0;
    const adapter=createRuntimeProactiveImageAdapter(options({config:{gatewayUrl:gateway,runtimeName,deploymentVersion:'build.v1'},
      assertDeploymentBinding:()=>{if(changed)throw Error('Synthetic new deployment');},
      authorizationProvider:{read:async()=>{reads++;changed=true;return 'Bearer synthetic';}},
      fetchImpl:async()=>{sends++;return response();}}));
    await assert.rejects(adapter.describe(context()),{code:'REVISION_CONFLICT'});
    assert.equal(reads,phase==='before_credentials'?0:1);assert.equal(sends,0);
  }
});
