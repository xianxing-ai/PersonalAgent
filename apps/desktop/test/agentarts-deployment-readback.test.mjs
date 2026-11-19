import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentArtsDeploymentRequestAuth,createAgentArtsObservationRequestAuth} from '../electron/agentarts-observation-auth.js';
import {readAgentArtsDeployment} from '../electron/agentarts-deployment-readback.js';

test('fixed deployment reads validate both original versions without exporting secrets or equating READY to execution',async()=>{
  const binding={runtimeId:'11111111-1111-1111-1111-111111111111',runtimeName:'original-runtime',endpointId:'22222222-2222-2222-2222-222222222222',
    endpointName:'fixed-api',version:'fixed-v1',imageReference:'swr.cn-southwest-2.myhuaweicloud.com/fixture/owned@sha256:'+'a'.repeat(64)};
  const credentials={accessKey:'fixtureaccesskey',secretKey:'fixture-private-secret-key'},auth=createAgentArtsDeploymentRequestAuth(credentials,binding),
    context={deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal};
  const runtime={id:binding.runtimeId,name:binding.runtimeName,status:'READY',arch:'arm64',version_detail:{version:binding.version,
    artifact_source:{url:binding.imageReference},environment_variables:[{key:'PRIVATE',value:'never-export-this-secret'}]}};
  const endpoint={runtime_id:binding.runtimeId,id:binding.endpointId,name:binding.endpointName,target_version_name:binding.version,
    routing_config:{version_weights:[{version_name:binding.version,weight:100}]}};
  const calls=[];let drift=false,readCount=0;
  const input={...binding,...context,authorize:request=>auth.authorize(request),assertCurrent(){},fetchImpl:async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.method,'GET');
    const body=structuredClone(url.includes('/endpoints/')?endpoint:runtime);
    if(url.includes('/endpoints/')&&++readCount===2&&drift)body.routing_config.version_weights[0].weight=50;
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});}};
  const result=await readAgentArtsDeployment(input);assert.equal(calls.length,4);assert.equal(result.runtimeReady,true);
  assert.equal(result.containerExecution,'unverified');assert.equal(result.readinessProbe,'unverified');
  assert.doesNotMatch(JSON.stringify(result),/never-export|secret|environment_variables/);
  drift=true;readCount=0;await assert.rejects(readAgentArtsDeployment(input),{code:'REVISION_CONFLICT'});
  const request={method:'GET',body:'',url:calls[0],headers:{Host:'agentarts.cn-southwest-2.myhuaweicloud.com','Content-Type':'application/json',Accept:'application/json'},...context};
  await assert.rejects(createAgentArtsObservationRequestAuth(credentials).authorize(request),/outside/);
  await assert.rejects(auth.authorize({...request,url:request.url.replace('fixed-v1','other-v2')}),/outside/);
  await assert.rejects(auth.authorize({...request,method:'PUT'}),/outside/);
  drift=false;readCount=0;runtime.version_detail.artifact_source.url=binding.imageReference.split('@')[0]+':release-v1';
  await assert.rejects(readAgentArtsDeployment(input),{code:'REVISION_CONFLICT'});
  let resolves=0;
  const tagged={...input,resolveImageReference:async request=>{
    assert.equal(request.imageReference,runtime.version_detail.artifact_source.url);resolves++;return binding.imageReference;
  }};
  assert.equal((await readAgentArtsDeployment(tagged)).imageReference,binding.imageReference);assert.equal(resolves,2);
  await assert.rejects(readAgentArtsDeployment({...tagged,resolveImageReference:async()=>binding.imageReference.replace(/a{64}$/,'b'.repeat(64))}),{code:'REVISION_CONFLICT'});
  resolves=0;await assert.rejects(readAgentArtsDeployment({...tagged,resolveImageReference:async()=>++resolves===1?binding.imageReference:binding.imageReference+'0'}),{code:'REVISION_CONFLICT'});
  runtime.version_detail.artifact_source.url='swr.cn-southwest-2.myhuaweicloud.com/other/owned:release-v1';
  await assert.rejects(readAgentArtsDeployment(tagged),{code:'REVISION_CONFLICT'});
});
