import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentServer} from '../src/server.mjs';
import {createImageServices} from '../src/image-services.mjs';

const token='public-fixture-inner-credential-at-least-32-bytes';
const deployment={runtimeId:'runtime-1',runtimeName:'pa-owned',endpointId:'endpoint-1',endpointName:'v1',version:'v1',imageDigest:'sha256:'+'a'.repeat(64)};
const output={id:'case-1',branch:'main',outputDigest:'b'.repeat(64)};
const planInput={sourceRevision:'c'.repeat(40),sourceDigest:'d'.repeat(64),recipeId:'f26-owned-image-release',imageTag:'pr531-fixture',
  registryRepository:'swr.example.com/org/pa',scriptDigest:'e'.repeat(64),architecture:'arm64'};
function services() {
  let cloud=0,local=0;
  const image=createImageServices({trustedPlatformPorts:{
    pinnedReadonly:{deployment,allowedTool:{name:'research.search',version:'0.1.0'},authorize:async()=>true,
      readDeployment:async()=>({...deployment,runtimeReady:true}),
      invokeCloud:async()=>{cloud++;return {requestId:'fixture-request',kind:'tool_proposal',toolName:'research.search',toolVersion:'0.1.0',arguments:{query:'public'}};},
      executeLocalReadonly:async()=>{local++;return {evidenceId:'evidence-1',state:'succeeded'};}},
    evaluationBinding:{deployment,readOriginalOutputs:async()=>[output],
      readPlatformResult:async()=>({evaluationId:'eval-1',revision:'r1',deploymentVersion:'v1',items:[{...output,score:1}]}),
      readConsumer:async()=>undefined},
    imageBuild:{planInput,expectedDeployment:deployment,readControlPlane:async()=>({...deployment,imageTag:planInput.imageTag,architecture:'arm64',runtimeReady:true,readinessProbe:'passed'})}}});
  return {image,counts:()=>({cloud,local})};
}
const context=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString(),requestId:'fixture-request',sessionId:'fixture-session'});
test('unconfigured pinned, evaluation and build operations stay unavailable',async()=>{
  const image=createImageServices();
  await assert.rejects(image.controllers.platformVersion({value:{platformVersion:1,operation:'pinned_readonly.correlate',arguments:{query:'public'}},...context()}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(image.controllers.platformVersion({value:{platformVersion:1,operation:'evaluation.bind'},...context()}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(image.controllers.platformVersion({value:{platformVersion:1,operation:'deployment.build_plan'},...context()}),{code:'UNSUPPORTED_CAPABILITY'});
  await image.close();
});
test('injected ports correlate one read, bind scores, and refuse to treat READY as a probe or a publish',async()=>{
  const f=services();
  try {
    const listed=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'list'},...context()});
    assert.equal(listed.verification,'unverified');
    assert.ok(listed.operations.includes('pinned_readonly.correlate'));assert.ok(listed.operations.includes('evaluation.bind'));
    const correlated=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'pinned_readonly.correlate',arguments:{query:'public'}},...context()});
    assert.equal(correlated.result.localTaskCompleted,false);assert.equal(correlated.result.localEvidenceId,'evidence-1');
    assert.equal(correlated.result.surfaces.knowledge.verified,false);assert.equal(correlated.result.modelProxy.verified,false);
    assert.equal(correlated.result.realEnvironmentAcceptance,'not_performed');
    const bound=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'evaluation.bind'},...context()});
    assert.equal(bound.result.state,'bound');assert.equal(bound.result.published,false);
    const published=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'publish.record'},...context()});
    assert.equal(published.result.published,false);assert.equal(published.result.reason,'consumer_readback_required');
    const build=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'deployment.build_plan'},...context()});
    assert.equal(build.result.state,'planned_not_built');assert.equal(build.result.imageDigest,null);
    const readback=await f.image.controllers.platformVersion({value:{platformVersion:1,operation:'deployment.correlate_readback'},...context()});
    assert.equal(readback.result.state,'control_plane_matched');assert.equal(readback.result.readinessProbe,'unverified');
    assert.deepEqual(f.counts(),{cloud:1,local:1});
    await assert.rejects(f.image.controllers.platformVersion({value:{platformVersion:1,operation:'evaluation.bind',score:1},...context()}),{code:'INVALID_ARGUMENT'});
  } finally {await f.image.close();}
});
test('HTTP service credential reaches the pinned loop and a request cannot supply its own deployment',async t=>{
  const f=services();t.after(()=>f.image.close());
  const server=createAgentServer({orchestrator:{invoke:async()=>{throw Error('No model fallback');}},mode:'standalone-validation',authToken:token,serviceControllers:f.image.controllers});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/invocations';
  const post=(value,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token,...headers},body:JSON.stringify({query:JSON.stringify(value)})});
  const response=await post({platformVersion:1,operation:'pinned_readonly.correlate',arguments:{query:'public'}},{'x-request-id':'fixture-request','x-hw-agentarts-session-id':'fixture-session'});
  assert.equal(response.status,200);
  const body=await response.json();
  const result=JSON.parse(body[0].data.text).result;
  assert.equal(result.platformRequestId,'fixture-request');assert.equal(result.localTaskCompleted,false);assert.equal(f.counts().local,1);
  const injected=await post({platformVersion:1,operation:'pinned_readonly.correlate',arguments:{query:'public'},deployment:{version:'latest'}});
  assert.equal(injected.status,400);
});
