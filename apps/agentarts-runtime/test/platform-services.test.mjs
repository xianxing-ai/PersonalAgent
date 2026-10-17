import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformServices,createPlatformMcpService,createPlatformKnowledgeRouter,createAgentArtsObservationReader,createPlatformReadbacks} from '../src/platform-services.mjs';

const control=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
const inputSchema={type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false};
const descriptor={name:'platform.fixture.search',version:'1.0.0',inputSchema,outputSchema:{type:'object'},
  sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
const toolContext=()=>({...control(),taskId:'fixture-task',runId:'fixture-run',authorizationRef:'original-runtime-fixture-grant',scopes:['fixture:read']});
function mcpFixture(overrides={}) {
  const calls=[];let invoked=0;
  const config={endpoint:'https://fixture.invalid/mcp',serverIdentity:{name:'fixture-mcp',version:'1.0.0'},protocolVersions:['2025-11-25'],
    bindings:[{remoteName:'search',descriptor}],getCredentialHeaders:async()=>({authorization:'Bearer fixture-only-token'}),authorize:async()=>true,
    fetch:async(url,init)=>{
      assert.equal(String(url),'https://fixture.invalid/mcp');assert.equal(init.redirect,'error');
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-only-token');
      if(init.method==='GET')return new Response(null,{status:405});
      const message=JSON.parse(init.body);calls.push(message);
      if(message.method==='notifications/initialized')return new Response(null,{status:202});
      let result;
      if(message.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture-mcp',version:'1.0.0'}};
      else if(message.method==='tools/list')result={tools:[{name:'search',inputSchema}]};
      else if(message.method==='tools/call'){invoked++;assert.deepEqual(message.params,{name:'search',arguments:{query:'fixture'}});result={content:[{type:'text',text:'fixture reply'}]};}
      else throw Error('Unexpected fixture MCP method');
      return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,result}),{headers:{'content-type':'application/json'}});
    },...overrides};
  return {service:createPlatformMcpService(config),calls,invoked:()=>invoked};
}

test('unconfigured platform services report exact missing adapter/configuration rather than fake success',async()=>{
  const services=createPlatformServices();
  assert.equal(services.status().mcp.state,'unavailable');assert.equal(services.status().knowledge.state,'unavailable');
  assert.equal(services.status().evaluation.state,'unavailable');
  await assert.rejects(services.mcp.connect(control()),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(services.knowledge.search({...control(),query:'fixture',limit:1}),{code:'UNSUPPORTED_CAPABILITY'});
  await services.close();
});

test('real pinned MCP SDK negotiates/discovers/calls a fixture protocol through explicit Runtime-bound tool',async()=>{
  const f=mcpFixture();try {
    await f.service.connect(control());
    assert.equal(f.service.status().protocolVersion,'2025-11-25');assert.equal(f.service.tools().length,1);
    const tool=f.service.tools()[0];assert.deepEqual(tool.descriptor,descriptor);
    const result=await tool.execute({query:'fixture'},toolContext());
    assert.equal(result.content[0].text,'fixture reply');assert.equal(f.invoked(),1);
    await assert.rejects(tool.execute({query:'fixture',endpoint:'https://attacker.invalid'},toolContext()),{code:'INVALID_ARGUMENT'});
    await assert.rejects(tool.execute({query:'fixture'},{...toolContext(),authorizationRef:''}),{code:'UNAUTHORIZED'});
    assert.equal(f.invoked(),1);
  }finally{await f.service.close();}
  assert.deepEqual(f.service.tools(),[]);
});

test('MCP identity/schema mismatches do not publish tools or execute remote calls',async()=>{
  for(const overrides of [{serverIdentity:{name:'other',version:'1.0.0'}},
    {bindings:[{remoteName:'search',descriptor:{...descriptor,inputSchema:{type:'object'}}}]}]) {
    const f=mcpFixture(overrides);
    try{await assert.rejects(f.service.connect(control()),{code:'PROTOCOL_MISMATCH'});assert.equal(f.invoked(),0);assert.equal(f.service.tools().length,0);}
    finally{await f.service.close();}
  }
});

test('MCP host refusal, cancellation and credential errors never become successful calls or expose secrets',async()=>{
  const f=mcpFixture({authorize:async request=>request.operation==='discover_mcp'});
  try{await f.service.connect(control());await assert.rejects(f.service.tools()[0].execute({query:'fixture'},toolContext()),{code:'UNAUTHORIZED'});assert.equal(f.invoked(),0);}
  finally{await f.service.close();}
  const cancelled=mcpFixture(),abort=new AbortController();abort.abort();
  await assert.rejects(cancelled.service.connect({...control(),signal:abort.signal}),{code:'CANCELLED'});assert.equal(cancelled.calls.length,0);await cancelled.service.close();
  const broken=mcpFixture({getCredentialHeaders:async()=>{throw Error('synthetic-secret-not-to-echo');}});
  try{await assert.rejects(broken.service.connect(control()),error=>!error.message.includes('synthetic-secret'));}
  finally{await broken.service.close();}
  const lateAbort=new AbortController(),late=mcpFixture({authorize:async request=>{
    if(request.operation==='discover_mcp')return true;lateAbort.abort();throw Error('synthetic-secret');}});
  try{await late.service.connect(control());
    await assert.rejects(late.service.tools()[0].execute({query:'fixture'},{...toolContext(),signal:lateAbort.signal}),{code:'CANCELLED'});
    assert.equal(late.invoked(),0);
  }finally{await late.service.close();}
});

test('KnowledgePort router keeps original excerpts/source revisions and never falls back from missing platform',async()=>{
  const result={hits:[{source:{vaultId:'fixture',path:'source.md',line:2,revision:'source-r7'},excerpt:'Original source excerpt'}],truncated:false};
  let reads=0;const local={search:async()=>{reads++;return result;}};
  const port=createPlatformKnowledgeRouter({route:'local',local,authorize:async()=>true});
  assert.deepEqual(await port.search({...control(),query:'source',limit:2}),result);assert.equal(reads,1);
  const missing=createPlatformKnowledgeRouter({route:'platform',local,authorize:async()=>true});
  await assert.rejects(missing.search({...control(),query:'source',limit:2}),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(reads,1);
  await assert.rejects(port.search({...control(),query:'source',limit:2,endpoint:'https://attacker.invalid'}),{code:'INVALID_ARGUMENT'});
});

test('known regional observation HTTP reader uses trusted signing, no redirects, and preserves actual raw body for public projection',async()=>{
  const body={total:0,span_list:[]};let requests=0;
  const reader=createAgentArtsObservationReader({origin:'https://agentarts.cn-southwest-2.myhuaweicloud.com',
    authorizeRequest:async request=>{assert.equal(request.method,'GET');assert.ok(request.url.endsWith('/v1/ops/observation/traces/fixture-trace'));
      return {authorization:'SDK-HMAC-SHA256 fixture-signature','x-sdk-date':'20261015T000000Z'};},
    fetch:async(url,request)=>{requests++;assert.equal(request.redirect,'error');return new Response(JSON.stringify(body));}});
  const raw=await reader.read({surface:'trace',traceId:'fixture-trace'},control(),{buildRunLogPath(){throw Error('unused');}});
  assert.deepEqual(raw,body);assert.equal(requests,1);
  const unsupported=createAgentArtsObservationReader({origin:'https://unconfirmed.invalid',authorizeRequest:async()=>({})});
  await assert.rejects(unsupported.read({surface:'trace',traceId:'fixture-trace'},control(),{}),{code:'UNSUPPORTED_CAPABILITY'});
});

test('observation consumes injected public projection; evaluation requires an explicit read/validation adapter',async()=>{
  let projected=0,read=0;
  const readbacks=createPlatformReadbacks({observation:{reader:{read:async()=>({fixture:'actual raw body'}),status:()=>({state:'fixture'})}},
    loadProjectors:async()=>({projectTraceObservation:(body,id,invocation)=>{projected++;assert.equal(body.fixture,'actual raw body');return {fixtureProjection:id,invocation};}}),
    evaluation:{authorize:async()=>true,readResult:async input=>{read++;return {id:input.evaluationId,revision:input.revision,result:'fixture'};},
      validateResult:(body,input)=>body.id===input.evaluationId&&body.revision===input.revision?body:undefined}});
  assert.equal((await readbacks.observe({surface:'trace',traceId:'fixture'},control())).fixtureProjection,'fixture');assert.equal(projected,1);
  const result=await readbacks.readEvaluation({evaluationId:'fixture',revision:'v1'},control());assert.equal(result.result,'fixture');assert.equal(read,1);
  await assert.rejects(readbacks.readEvaluation({evaluationId:'fixture',revision:'v1',endpoint:'https://attacker.invalid'},control()),{code:'INVALID_ARGUMENT'});
  await assert.rejects(createPlatformReadbacks().readEvaluation({evaluationId:'fixture',revision:'v1'},control()),{code:'UNSUPPORTED_CAPABILITY'});
});

test('public operation list/call delegates to the original Runtime and never directly executes discovered tools',async()=>{
  let invoked=0;
  const calls=[];const config={endpoint:'https://fixture.invalid/mcp',serverIdentity:{name:'fixture-mcp',version:'1.0.0'},protocolVersions:['2025-11-25'],
    bindings:[{remoteName:'search',descriptor}],getCredentialHeaders:async()=>({}),authorize:async()=>true,
    fetch:async(url,init)=>{
      if(init.method==='GET')return new Response(null,{status:405});
      const message=JSON.parse(init.body);calls.push(message.method);
      if(message.method==='notifications/initialized')return new Response(null,{status:202});
      assert.notEqual(message.method,'tools/call','public route must delegate rather than call SDK directly');
      const result=message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture-mcp',version:'1.0.0'}}:{tools:[{name:'search',inputSchema}]};
      return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,result}),{headers:{'content-type':'application/json'}});
    }};
  const services=createPlatformServices({mcp:config,toolExecutionPort:{list:()=>[descriptor],invoke:async request=>{
    invoked++;assert.equal(request.taskId,'actual-runtime-task');assert.equal(request.authorizationRef,'actual-runtime-grant');
    return {state:'unknown',result:{original:'retained'},evidenceRefs:['actual-runtime-evidence']};
  }},getToolInvocationContext:async()=>({...control(),taskId:'actual-runtime-task',runId:'actual-runtime-run',authorizationRef:'actual-runtime-grant'})});
  try {
    await services.execute({operation:'mcp.discover'},control());
    assert.equal(services.list().mcpTools.length,1);
    const result=await services.execute({operation:'mcp.call',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{query:'fixture'}},control());
    assert.equal(result.state,'unknown');assert.equal(invoked,1);
    await assert.rejects(services.execute({operation:'mcp.call',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{query:'fixture'},authorizationRef:'forged'},control()),{code:'INVALID_ARGUMENT'});
    const unavailable=createPlatformServices({mcp:config});
    try{await unavailable.execute({operation:'mcp.discover'},control());
      await assert.rejects(unavailable.execute({operation:'mcp.call',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{query:'fixture'}},control()),{code:'UNSUPPORTED_CAPABILITY'});
    }finally{await unavailable.close();}
  }finally{await services.close();}
});

test('real public MOD32 projectors consume signed-reader fixture responses without exposing raw logs or claiming cost/version',async()=>{
  const services=createPlatformServices({observation:{origin:'https://agentarts.cn-southwest-2.myhuaweicloud.com',
    authorizeRequest:async()=>({authorization:'SDK-HMAC-SHA256 fixture-signature','x-sdk-date':'20261015T000000Z'}),
    fetch:async url=>new Response(JSON.stringify(String(url).includes('/traces/')?{total:0,span_list:[]}:
      {count:1,is_query_complete:true,logs:[{content:'private-fixture-log-content',line_num:'1',labels:{source:'fixture'}}]}))}});
  try {
    const trace=await services.execute({operation:'observation.read',request:{surface:'trace',traceId:'fixture'}},control());
    assert.equal(trace.surface,'ShowOpsTrace');assert.equal(trace.cost,'unavailable');assert.equal(trace.deploymentVersion,'unavailable');
    assert.equal(trace.requestCorrelation.status,'not_checked');
    const log=await services.execute({operation:'observation.read',request:{surface:'log',query:{agentRunId:'fixture',startTime:'1792020000000',endTime:'1792020060000',limit:1}}},control());
    assert.equal(log.returnedLogCount,1);assert.equal(log.requestCorrelation,'not_checked');
    assert.equal(JSON.stringify(log).includes('private-fixture-log-content'),false);
  }finally{await services.close();}
});
