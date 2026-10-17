import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentArtsRunLogs, readAgentArtsTraceObservation} from './read-platform-trace.mjs';
import {createAgentArtsTraceAuthorizer,createAgentArtsObservationAuthorizer} from './sdk-trace-authorizer.mjs';

const query = {agentRunId:'synthetic-run',startTime:'1792020000000',endTime:'1792020060000',limit:10};
const body = {count:1,is_query_complete:false,scroll_id:'private-cursor',logs:[{content:'PRIVATE',line_num:'1',labels:{message:'PRIVATE'}}]};
const json = value => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const options = extra => ({query,deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,
  authorize: async request => ({...request.headers,'X-Sdk-Date':'20261015T000000Z',Authorization:'SDK-HMAC-SHA256 synthetic'}),
  fetchImpl:async()=>json(body),...extra});
// Explicit SDK-shaped Fake. No real HMAC, credentials or cloud traffic.
function sdk(mutate = () => {}) {
  return {
    HttpRequest:class {constructor(method,url,headers,body) {
      const parsed = new URL(url);
      Object.assign(this,{method,host:parsed.host,uri:parsed.pathname,query:Object.fromEntries([...parsed.searchParams].map(([k,v])=>[k,[v]])),headers,body});
    }},
    Signer:class {Sign(request) {
      request.headers['X-Sdk-Date']='20261015T000000Z';
      request.headers.Authorization='SDK-HMAC-SHA256 Access=fake, SignedHeaders='+Object.keys(request.headers).map(k=>k.toLowerCase()).sort().join(';')+', Signature=fake';
      const result={hostname:request.host,method:request.method,path:request.uri+'?'+new URLSearchParams(Object.entries(request.query).map(([k,v])=>[k,v[0]])),headers:request.headers};
      mutate(request,result); return result;
    }},
  };
}

test('one signed scoped GET returns a timestamped, redacted log observation with incomplete-page markers',async()=>{
  let calls=0,signed;
  const authorize=createAgentArtsObservationAuthorizer({sdk:sdk(),readCredentials:request=>{signed=request;return {accessKey:'fake',secretKey:'PRIVATE'};}});
  const result=await readAgentArtsRunLogs(options({authorize,fetchImpl:async(url,init)=>{
    calls++; assert.equal(url,signed.url);assert.equal(init.redirect,'error');assert.equal(init.signal,signed.signal);
    assert.match(url,/\/synthetic-run\/log\?end_time=1792020060000&limit=10&log_type=agent&start_time=1792020000000$/);
    return json(body);
  }}));
  assert.equal(calls,1);assert.equal(result.surface,'ListOpsAgentRunLog');assert.equal(result.httpStatus,200);
  assert.equal(result.queryComplete,false);assert.ok(Number.isFinite(Date.parse(result.observedAt)));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private-cursor/);
});

test('old signer remains trace-only; expanded signer rejects query changes before using credentials',async()=>{
  let reads=0;
  const settings={sdk:sdk(),readCredentials:()=>{reads++;return {accessKey:'fake',secretKey:'PRIVATE'};}};
  // Reader deliberately sanitizes errors from an injected authorizer.
  await assert.rejects(readAgentArtsRunLogs(options({authorize:createAgentArtsTraceAuthorizer(settings)})),{code:'EXTERNAL_FAILURE'});
  assert.equal(reads,0);
  const authorize=createAgentArtsObservationAuthorizer(settings);
  const descriptor={url:'https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/observation/agent-run/synthetic-run/log?end_time=1792020060000&limit=10&log_type=agent&start_time=1792020000000',method:'GET',body:'',
    headers:{Host:'agentarts.cn-southwest-2.myhuaweicloud.com','Content-Type':'application/json',Accept:'application/json'},deadline:options().deadline,signal:options().signal};
  for(const tail of ['&keyword=PRIVATE','&limit=10','#fragment']) await assert.rejects(authorize({...descriptor,url:descriptor.url+tail}),{code:'INVALID_ARGUMENT'});
  assert.equal(reads,0);
});

test('SDK query/path mutation is rejected without transport and private errors stay redacted',async()=>{
  for(const mutate of [(r)=>{r.query.limit=['999'];},(_,out)=>{out.path+='&keyword=PRIVATE';}]) {
    let sent=0;
    const authorize=createAgentArtsObservationAuthorizer({sdk:sdk(mutate),readCredentials:()=>({accessKey:'fake',secretKey:'PRIVATE'})});
    await assert.rejects(readAgentArtsRunLogs(options({authorize,fetchImpl:()=>{sent++;}})),{code:'EXTERNAL_FAILURE'});
    assert.equal(sent,0);
  }
});

test('new surfaces share one deadline/cancel boundary and never retry errors or oversized bodies',async()=>{
  let calls=0;
  await assert.rejects(readAgentArtsRunLogs(options({fetchImpl:async()=>{calls++;return new Response('PRIVATE',{status:403});}})),{code:'UNAUTHORIZED',httpStatus:403});
  assert.equal(calls,1);
  await assert.rejects(readAgentArtsRunLogs(options({fetchImpl:async()=>json({...body,padding:'x'.repeat(1024*1024)})})),{code:'EXTERNAL_FAILURE'});
  const controller=new AbortController();
  const pending=readAgentArtsRunLogs(options({signal:controller.signal,authorize:()=>{controller.abort();return new Promise(()=>{});},fetchImpl:()=>{calls++;}}));
  await assert.rejects(pending,{code:'CANCELLED'});assert.equal(calls,1);
  await assert.rejects(readAgentArtsRunLogs(options({deadline:new Date(Date.now()+30).toISOString(),authorize:()=>new Promise(()=>{})})),{code:'TIMEOUT'});
});

test('trace consumer checks actual identities, not HTTP success or similar timestamps',async()=>{
  const {query:_,...base}=options();
  const invocation={requestId:'trace-1',sessionId:'session-1',resourceId:'app-1'};
  const response={total:1,span_list:[{trace_id:'trace-1',span_id:'span-1',session_id:'session-1',resource_id:'app-1',input:'PRIVATE'}]};
  const result=await readAgentArtsTraceObservation({...base,traceId:'trace-1',invocation,fetchImpl:async()=>json(response)});
  assert.equal(result.requestCorrelation.status,'exact_id_match');
  const mismatch=await readAgentArtsTraceObservation({...base,traceId:'trace-1',invocation:{...invocation,requestId:'other'},fetchImpl:async()=>json(response)});
  assert.equal(mismatch.requestCorrelation.status,'mismatch');
  assert.equal(mismatch.deploymentVersion,'unavailable');
  let signed=0;
  await assert.rejects(readAgentArtsTraceObservation({...base,traceId:'trace-1',invocation:{runtimeVersion:'Latest'},authorize:()=>{signed++;}}),{code:'INVALID_ARGUMENT'});
  assert.equal(signed,0);
});
