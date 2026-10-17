import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime,createRuntimeAtomicStatePort} from '../dist/index.js';
import {createRuntimeApplication,createRuntimeProactiveImageAdapter,createProactiveWorkflowSession} from '../dist/application.js';
import {createProactiveHostProofs,proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {createProactiveWorkflowController} from '@personal-agent/agentarts-runtime/proactive-controller';

// Actual HTTP controller/adapter + TaskRuntime/SQLite session. No account, model or device call.
const secret='public-proactive-image-fixture-proof-key-123456';
const outer='Bearer public-proactive-image-gateway-fixture-123456';
const inner='Bearer public-proactive-image-host-fixture-123456789';
const contract={id:'fixture-observed-contract',version:'fixture-v1',criteria:'Public fixture only',qualifiedForMain:false,batchIndependent:true,
  candidates:[{id:'keep',description:'Keep original responsibility',action:'continue'},{id:'defer',description:'Defer without execution',action:'defer'}]};
const context=extra=>({taskId:'fixture-task',sessionId:'fixture-session',controlRevision:0,requestId:'fixture-request',
  taskDeadline:new Date(Date.now()+60000).toISOString(),deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,...extra});
const request=extra=>({...context(),hostAvailability:{localDevice:true,cloudPersistentHost:false},availableCapabilities:[],...extra});
test('proactive describe and advance retain the original fixed deployment and refuse a changed binding before credentials',async()=>{
  for(const config of [{gatewayUrl:'https://fixture.example',runtimeName:'fixture',transport:'wss',websocketUrl:'wss://fixture.example/runtimes/fixture/ws?endpoint=v5.release-1'},
    {gatewayUrl:'https://fixture.example',runtimeName:'fixture',deploymentVersion:'v5.release-1'}]){
    const calls=[];let current=true,credentials=0;
    const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[contract]});
    const adapter=createRuntimeProactiveImageAdapter({config,receiptSecret:secret,assertDeploymentBinding:()=>{if(!current)throw Error('changed');},authorizationProvider:{read:async()=>{credentials++;return outer;}},
      fetchImpl:async(url,init)=>{calls.push(url);const value=JSON.parse(JSON.parse(init.body).query);const result=await controller({value,sessionId:init.headers['x-hw-agentarts-session-id'],requestId:init.headers['X-Request-Id'],deadline:init.headers['X-PA-Deadline'],signal:init.signal});
        return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});}});
    await adapter.describe(context());await adapter.advancePort(request());
    assert.equal(calls.length,2);for(const url of calls)assert.equal(new URL(url).searchParams.get('endpoint'),'v5.release-1');
    current=false;await assert.rejects(adapter.describe(context()),{code:'REVISION_CONFLICT'});assert.equal(calls.length,2);assert.equal(credentials,2);
  }
  assert.throws(()=>createRuntimeProactiveImageAdapter({config:{gatewayUrl:'https://fixture.example',runtimeName:'fixture',deploymentVersion:'different',websocketUrl:'wss://fixture.example/runtimes/fixture/ws?endpoint=v5'},receiptSecret:secret,authorizationProvider:{read:async()=>outer}}),/mismatch/);
});
test('deployment change while credentials are pending prevents the HTTP send',async()=>{
  let current=true,fetches=0,started,release;
  const entered=new Promise(resolve=>{started=resolve;}),credential=new Promise(resolve=>{release=resolve;});
  const adapter=createRuntimeProactiveImageAdapter({config:{gatewayUrl:'https://fixture.example',runtimeName:'fixture',deploymentVersion:'v5'},receiptSecret:secret,
    assertDeploymentBinding:()=>{if(!current)throw Error('changed');},authorizationProvider:{read:()=>{started();return credential;}},fetchImpl:async()=>{fetches++;throw Error('must not send');}});
  const pending=adapter.describe(context());await entered;current=false;release(outer);
  await assert.rejects(pending,{code:'REVISION_CONFLICT'});assert.equal(fetches,0);
});
async function fixture(t,{sse=false,mutateResult,mutateEvents,dropResponse=false,workflowGoalInput}={}) {
  const proofs=createProactiveHostProofs(secret),controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[contract]});
  const calls=[];
  const server=createServer(async(req,res)=>{
    try {
      if(req.headers.authorization!==outer||req.headers['x-pa-agent-token']!==inner){res.writeHead(401);res.end('credential MUST NOT enter errors');return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const envelope=JSON.parse(Buffer.concat(chunks).toString()),value=JSON.parse(workflowGoalInput?envelope.inputs[workflowGoalInput]:envelope.query);
      const binding={taskId:value.taskId,sessionId:req.headers['x-hw-agentarts-session-id'],controlRevision:value.controlRevision,taskDeadline:value.taskDeadline};
      const signal=new AbortController().signal,invocation={value,sessionId:binding.sessionId,requestId:req.headers['x-request-id'],deadline:req.headers['x-pa-deadline'],signal};
      calls.push({url:req.url,headers:req.headers,value});
      let result=await controller(invocation);if(mutateResult)result=mutateResult(result,{binding,value,proofs});
      if(dropResponse){req.socket.destroy();return;}
      let events=[{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}];if(mutateEvents)events=mutateEvents(events);
      res.writeHead(200,{'content-type':sse?'text/event-stream':'application/json'});
      res.end(sse?events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n':JSON.stringify(events));
    }catch {res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'fixture rejected'}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+server.address().port+'/invocations';
  const options={endpoint,receiptSecret:secret,authorizationProvider:{read:async()=>outer},hostAuthorizationProvider:{read:async()=>inner},
    ...(workflowGoalInput?{workflowGoalInput}:{})};
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {calls,endpoint,options,proofs,adapter:createRuntimeProactiveImageAdapter(options)};
}
test('shared proofs preserve the original image HMAC algorithm and bind every result field plus task/session/revision/deadline',()=>{
  const binding=context(),value={proactiveVersion:1,requestId:binding.requestId,payload:{version:'original',items:['source-a']}},proofs=createProactiveHostProofs(secret);
  const identity={taskId:binding.taskId,sessionId:binding.sessionId,controlRevision:binding.controlRevision,taskDeadline:binding.taskDeadline};
  const expected=createHmac('sha256',secret).update('proactive-host-v1:'+digest({kind:'advance_result',binding:identity,value})).digest('base64url');
  const signed=proofs.sign('advance_result',value,binding);assert.equal(signed.proof,expected);assert.equal(proofs.verify('advance_result',signed,binding),true);
  assert.equal(proofs.verify('advance_result',{...signed,payload:{version:'changed',items:['source-a']}},binding),false);
  for(const extra of [{taskId:'other'},{sessionId:'other'},{controlRevision:1},{taskDeadline:new Date(0).toISOString()}])
    assert.equal(proofs.verify('advance_result',signed,{...binding,...extra}),false);
});
test('actual HTTP consumes existing proactiveVersion envelope, original headers/frame and verified result; catalog stays unverified',async t=>{
  const f=await fixture(t),input=request(),result=await f.adapter.advancePort(input);
  assert.equal(result.profileAddon,'proactive.responsibility.v1');assert.equal(f.adapter.verifyAdvance(result,input),true);
  assert.equal(result.requestId,input.requestId);assert.equal(result.taskDeadline,input.taskDeadline);assert.equal(f.calls.length,1);
  const sent=f.calls[0];assert.equal(sent.url,'/invocations');assert.equal(sent.headers['x-request-id'],input.requestId);
  assert.equal(sent.headers['x-hw-agentarts-session-id'],input.sessionId);assert.equal(sent.value.hostFrame.requestId,input.requestId);
  assert.equal(f.proofs.verify('frame',sent.value.hostFrame,input),true);assert.equal(sent.value.operation,'advance');
  const description=await f.adapter.describe(context({requestId:'describe-request'}));
  assert.equal(description.verification,'unverified');assert.deepEqual(description.contracts,[{id:contract.id,version:contract.version,qualifiedForMain:false}]);
  assert.equal(f.calls[1].value.operation,'describe');assert.equal('proof' in description,false,'Existing catalog observation never becomes an execution grant');
});
test('actual signed source produces only a proposal bound to the advertised original host capability and arguments',async t=>{
  const f=await fixture(t),input=request({availableCapabilities:[{kind:'retrieve_context',ref:'fixture.retrieve',location:'local_device',effect:'read'}]});
  input.events=[f.adapter.sign('event',{eventId:'fixture-event',entry:'connector',conversationId:'fixture',sourceId:'fixture-source',entityRef:'fixture-entity',
    sourceVersion:'v1',observedAt:new Date(Date.now()-1000).toISOString(),change:'upsert',payloadRef:'fixture:original-payload',payloadDigest:digest('public fixture'),
    anchorRefs:[],responsibilityRefs:[],goalRefs:[],contractRef:contract.id,priority:'normal',evidenceRefs:['fixture-original-event']},input)];
  const result=await f.adapter.advancePort(input);assert.equal(result.proposals.length,1);const proposal=result.proposals[0];
  assert.equal(proposal.capabilityRef,'fixture.retrieve');assert.equal(proposal.argumentsDigest,digest(proposal.arguments));
  const forged=f.proofs.sign('advance_result',{...result,proposals:[{...proposal,capabilityRef:'unadvertised.tool'}]},input);
  assert.equal(f.adapter.verifyAdvance(forged,input),false);
  const changed=f.proofs.sign('advance_result',{...result,proposals:[{...proposal,arguments:{changed:true}}]},input);
  assert.equal(f.adapter.verifyAdvance(changed,input),false);
});
test('current SSE and workflow inputs envelope are parsed without a CoordinationResult/model fallback',async t=>{
  const f=await fixture(t,{sse:true,workflowGoalInput:'workflow_query'}),input=request();
  assert.equal((await f.adapter.advancePort(input)).advanceRevision,1);assert.equal(f.calls.length,1);
});
test('existing public transport config derives the same runtime endpoint and never permits request endpoint injection',async t=>{
  const f=await fixture(t);let configuredUrl;
  const {endpoint:ignored,...options}=f.options;
  const adapter=createRuntimeProactiveImageAdapter({...options,config:{gatewayUrl:'https://fixture-gateway.example',runtimeName:'configured-runtime',invokeMode:'debug'},
    fetchImpl:(url,init)=>{configuredUrl=url;assert.equal(init.headers['X-Invoke-Mode'],'debug');return fetch(f.endpoint,init);}});
  await adapter.advancePort(request());assert.equal(configuredUrl,'https://fixture-gateway.example/runtimes/configured-runtime/invocations');
  await assert.rejects(adapter.advancePort({...request(),endpoint:'https://injected.example/invocations'}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createRuntimeProactiveImageAdapter({...f.options,config:{gatewayUrl:'https://fixture.example',runtimeName:'runtime'}}),{code:'INVALID_ARGUMENT'});
  for(const endpoint of ['http://remote.example/invocations','https://user:secret@fixture.example/invocations','https://fixture.example/invocations?key=secret'])
    assert.throws(()=>createRuntimeProactiveImageAdapter({...f.options,endpoint}),{code:'INVALID_ARGUMENT'});
});
test('tampered payload, wrong signed identity, unexpected fields and legacy response cannot pass the complete response proof',async t=>{
  for(const [name,mutate] of [
    ['body',result=>({...result,mode:'paused'})],
    ['request',(result,{proofs,binding})=>proofs.sign('advance_result',{...result,requestId:'other-request'},binding)],
    ['session',(result,{proofs,binding})=>proofs.sign('advance_result',result,{...binding,sessionId:'other-session'})],
    ['revision',(result,{proofs,binding})=>proofs.sign('advance_result',result,{...binding,controlRevision:binding.controlRevision+1})],
    ['deadline',(result,{proofs,binding})=>proofs.sign('advance_result',{...result,taskDeadline:new Date(Date.now()+120000).toISOString()},binding)],
    ['field',(result,{proofs,binding})=>proofs.sign('advance_result',{...result,authority:'tool_grant'},binding)],
    ['legacy',()=>({kind:'text',text:'This is not a proactive frontier'})],
  ])await t.test(name,async t=>{const f=await fixture(t,{mutateResult:mutate});await assert.rejects(f.adapter.advancePort(request()),{code:'UNAUTHORIZED'});assert.equal(f.calls.length,1);});
});
test('event array is strict about terminal order, truncation, unknown metadata and unexpected event types',async t=>{
  for(const [name,mutate] of [
    ['truncated',events=>events.slice(0,-1)],['order',events=>[events[1],events[0],events[2]]],
    ['extra',events=>[...events,{event:'end'}]],['unknown',events=>[{...events[0],privatePayload:'untrusted'},...events.slice(1)]],
    ['error',()=>[{event:'error',data:{text:inner}}]],
  ])await t.test(name,async t=>{const f=await fixture(t,{mutateEvents:mutate});await assert.rejects(f.adapter.advancePort(request()),{code:'PROTOCOL_MISMATCH'});});
});
test('cancel and original deadline cover authorization/body reads; credential provider errors are redacted',async t=>{
  const f=await fixture(t);let fetches=0,started;
  const waiting=new Promise(resolve=>{started=resolve;}),stop=new AbortController();
  const adapter=createRuntimeProactiveImageAdapter({...f.options,authorizationProvider:{read:async()=>{started();return new Promise(()=>{});}},fetchImpl:async()=>{fetches++;throw Error(inner);}});
  const pending=adapter.advancePort(request({signal:stop.signal}));await waiting;stop.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(fetches,0);
  const timeout=createRuntimeProactiveImageAdapter({...f.options,authorizationProvider:{read:()=>new Promise(()=>{})}});
  await assert.rejects(timeout.advancePort(request({taskDeadline:new Date(Date.now()+20).toISOString()})),{code:'TIMEOUT'});
  const redacted=createRuntimeProactiveImageAdapter({...f.options,authorizationProvider:{read:async()=>{throw Error(inner);}}});
  await assert.rejects(redacted.advancePort(request()),error=>error.code==='UNAUTHORIZED'&&!error.message.includes(inner));
  const transportSecret=createRuntimeProactiveImageAdapter({...f.options,fetchImpl:async()=>{throw new ProtocolError('EXTERNAL_FAILURE',inner);}});
  await assert.rejects(transportSecret.advancePort(request()),error=>error.code==='RESULT_UNKNOWN'&&!error.message.includes(inner));
  const bodyStop=new AbortController(),bodyStarted=new Promise(resolve=>{started=resolve;});
  const blocked=createRuntimeProactiveImageAdapter({...f.options,fetchImpl:async()=>({status:200,headers:new Headers({'content-type':'application/json'}),
    body:{getReader:()=>({read:()=>{started();return new Promise(()=>{});},cancel:()=>new Promise(()=>{}),releaseLock:()=>{}})}})});
  const reading=blocked.advancePort(request({signal:bodyStop.signal}));await bodyStarted;bodyStop.abort();await assert.rejects(reading,{code:'CANCELLED'});
});
test('request identity and payload stay frozen while trusted authorization awaits',async t=>{
  const f=await fixture(t);let release,started;
  const waiting=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const adapter=createRuntimeProactiveImageAdapter({...f.options,authorizationProvider:{read:async()=>{started();await gate;return outer;}}});
  const input=request(),originalRequest=input.requestId,originalTask=input.taskId;
  const pending=adapter.advancePort(input);await waiting;input.requestId='changed-request';input.taskId='changed-task';release();
  const result=await pending;assert.equal(result.requestId,originalRequest);assert.equal(f.calls[0].value.taskId,originalTask);
  assert.equal(f.calls[0].headers['x-request-id'],originalRequest);
});
test('actual Runtime host pause/resume control traverses the HTTP adapter using safe original request identities',async t=>{
  const f=await fixture(t),directory=await mkdtemp(join(tmpdir(),'pa-proactive-http-control-'));
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'fixture-http-control',proactiveWorkflows:true});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  const task=app.runtime.submitTask({goal:'Public proactive control fixture',conversationId:'fixture-control',idempotencyKey:'original'});
  const source=app.runtime.submitTask({goal:'Fixture original user pause and resume commands',conversationId:'fixture-control',idempotencyKey:'source'});
  const deadline=new Date(Date.now()+60000).toISOString(),signal=new AbortController().signal;
  const {advancePort,verifyAdvance,sign}=f.adapter;
  const host=app.createProactiveWorkflowHost({taskId:task.taskId,sessionId:'fixture-control-session',taskDeadline:deadline,contractRef:contract.id,
    advancePort,verifyAdvance,sign,localDeviceAvailable:()=>true,
    verifyControlCommand:async(_command,actual)=>actual.taskId===source.taskId});
  const paused=await host.control({commandId:'fixture-pause',action:'pause',sourceTaskId:source.taskId,expectedControlRevision:0},{deadline,signal});
  assert.equal(paused.mode,'paused');assert.equal(host.binding.controlRevision,1);
  const resumed=await host.control({commandId:'fixture-resume',action:'resume',sourceTaskId:source.taskId,expectedControlRevision:1},{deadline,signal});
  assert.equal(resumed.mode,'attended');assert.equal(host.binding.controlRevision,2);assert.equal(f.calls.length,2);
  for(const call of f.calls) {
    assert.match(call.headers['x-request-id'],/^[A-Za-z0-9_-]{1,128}$/u);assert.equal(call.headers['x-hw-agentarts-session-id'],'fixture-control-session');
    assert.equal(call.value.taskId,task.taskId);assert.equal(call.value.taskDeadline,deadline);
  }
  assert.equal(app.runtime.getTask(task.taskId).state,'created','Image controls do not manufacture a wire task terminal state');
});
test('lost HTTP response remains one pending original request across SQLite restart without automatic resend or deadline renewal',async t=>{
  const f=await fixture(t,{dropResponse:true}),directory=await mkdtemp(join(tmpdir(),'pa-proactive-http-')),path=join(directory,'runtime.sqlite');
  let runtime=new TaskRuntime(path);const task=runtime.submitTask({goal:'Public HTTP frontier fixture',conversationId:'fixture',idempotencyKey:'http-original'});
  const input=request({taskId:task.taskId,requestId:'original-http-request'});input.deadline=input.taskDeadline;
  const binding={taskId:input.taskId,sessionId:input.sessionId,controlRevision:input.controlRevision,taskDeadline:input.taskDeadline};
  const session=()=>createProactiveWorkflowSession({binding,atomicState:createRuntimeAtomicStatePort(runtime,'http-image-fixture'),
    assertActive:()=>{runtime.getTask(task.taskId);},advancePort:f.adapter.advancePort,verifyAdvance:f.adapter.verifyAdvance});
  t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  await assert.rejects(session().advance(input),{code:'RESULT_UNKNOWN'});assert.equal(f.calls.length,1);
  runtime.close();runtime=new TaskRuntime(path);
  await assert.rejects(session().advance(input),{code:'EXTERNAL_FAILURE'});assert.equal(f.calls.length,1);
  await assert.rejects(session().advance({...input,requestId:'new-request'}),{code:'REVISION_CONFLICT'});assert.equal(f.calls.length,1);
  await assert.rejects(session().advance({...input,taskDeadline:new Date(Date.now()+120000).toISOString()}),{code:'INVALID_ARGUMENT'});assert.equal(f.calls.length,1);
  await assert.rejects(session().recoverPendingRequest(input.requestId,{signal:input.signal}),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(f.calls.length,1);
});
