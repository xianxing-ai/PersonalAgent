import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {OwnedAgentOrchestrator,OwnedWorkflowEngine} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {digestAgentArtsPayload,parseAgentArtsTransportFrame,MAX_AGENTARTS_RESULT_BYTES} from '@personal-agent/contracts/agentarts-transport';
import {createAgentServer} from '../src/server.mjs';

const token='synthetic-workflow-budget-secret-32-chars';
async function fixture(t,options={}) {
  const seen=[];
  const engine=new OwnedWorkflowEngine({checkpointSecret:token,selector:{select:async()=> 'accept'},
    prepareCandidates:async context=>{seen.push(context);if(options.prepareCandidates)return options.prepareCandidates(context);return [
      {id:'accept',description:'synthetic selected candidate',value:options.output??{selected:true}},
      {id:'review',description:'synthetic abstention',value:{},abstain:true},
    ];},...options.engine});
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider([])]));
  const orchestrator=new OwnedAgentOrchestrator(models,1024,undefined,undefined,engine);
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,orchestrator});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}`;
  const socket=new WebSocket(url.replace('http:','ws:')+'/ws',{headers:{'x-pa-agent-token':`Bearer ${token}`,'x-hw-agentarts-session-id':'budget-session'}});
  const queue=[],waiters=[];
  socket.on('error',()=>{});
  socket.on('message',bytes=>{
    const value=parseAgentArtsTransportFrame(JSON.parse(bytes.toString()));
    const waiter=waiters.shift();if(waiter){clearTimeout(waiter.timer);waiter.resolve(value);}else queue.push(value);
  });
  const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
    const waiter={resolve,timer:setTimeout(()=>reject(Error('Missing workflow transport result')),3000)};waiters.push(waiter);
  });
  t.after(()=>socket.terminate());await once(socket,'open');assert.equal((await next()).type,'ready');
  let sequence=0;
  const invoke=async (value,errorCode)=>{
    const payload={query:JSON.stringify(value)},id=String(++sequence);
    socket.send(JSON.stringify({protocolVersion:'0.1.0',type:'invoke',sessionId:'budget-session',requestId:'budget-'+id,
      idempotencyKey:'budget-'+id,payloadDigest:digestAgentArtsPayload(payload),deadline:new Date(Date.now()+10000).toISOString(),payload}));
    assert.equal((await next()).type,'accepted');const frame=await next();
    if(errorCode){assert.equal(frame.type,'error');assert.equal(frame.code,errorCode);return frame;}
    assert.equal(frame.type,'result',JSON.stringify(frame));
    assert.ok(Buffer.byteLength(JSON.stringify(frame.events))<=MAX_AGENTARTS_RESULT_BYTES);
    return JSON.parse(frame.events[0].data.text);
  };
  return {url,engine,seen,invoke};
}
const request=(input,extra={})=>({workflowVersion:'1.0.0',operation:'advance',workflowId:'F01',taskId:'budget-task',controlRevision:1,
  input,availableTools:[],taskDeadline:new Date(Date.now()+60000).toISOString(),...extra});

test('real WS F01 28k input delivers a resumable checkpoint instead of post-execution EXTERNAL_FAILURE',async t=>{
  const seen=[];
  const f=await fixture(t,{engine:{host:{capabilities:['memory.query','responsibility.snapshot','model.capabilities'],read:async context=>{seen.push(context);return {state:'completed',value:{facts:[]}};}}}});
  const original=request('x'.repeat(28000));
  const first=await f.invoke(original);assert.equal(first.nodes.F01_N01.state,'completed');assert.equal(first.state,'progress');
  const second=await f.invoke({...original,checkpoint:first.checkpoint});assert.equal(second.nodes.F01_N02.state,'completed');
  assert.equal(seen[0].predecessorOutputs.F01_N01,original.input,'The original complete input reaches the next real node');
  assert.equal(first.nodes.F01_N01.value.kind,'workflow_input_reference');
  assert.equal(first.nodes.F01_N01.value.valueDigest,sha(original.input));
  await f.invoke({...original,input:'substituted',checkpoint:first.checkpoint},'INVALID_ARGUMENT');
});
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hostCapabilities=['memory.query','responsibility.snapshot','model.capabilities'];

test('UTF8 and JSON-escaped 28k-class inputs resume through the complete event envelope limit',async t=>{
  const seen=[];
  const f=await fixture(t,{engine:{host:{capabilities:hostCapabilities,read:async context=>{seen.push(context);return {state:'completed',value:{ok:true}};}}}});
  for(const input of ['悟'.repeat(9300),'\n"\\'.repeat(4600)]) {
    const original=request(input),first=await f.invoke(original);
    assert.equal(first.nodes.F01_N01.value.kind,'workflow_input_reference');
    assert.equal(first.nodes.F01_N01.value.valueDigest,sha(input));
    const second=await f.invoke({...original,checkpoint:first.checkpoint});
    assert.equal(second.nodes.F01_N02.state,'completed');assert.equal(seen.at(-1).predecessorOutputs.F01_N01,input);
  }
});

test('cumulative outputs halt an undeliverable new node with the preceding checkpoint intact',async t=>{
  let reads=0;
  const f=await fixture(t,{output:{decision:'d'.repeat(19000)},engine:{host:{capabilities:hostCapabilities,read:async()=>{reads++;return {state:'completed',value:{data:'h'.repeat(13000)}};}}}});
  const original=request('small'),first=await f.invoke(original),second=await f.invoke({...original,checkpoint:first.checkpoint});
  assert.equal(second.nodes.F01_N02.state,'completed');
  const third=await f.invoke({...original,checkpoint:second.checkpoint});
  assert.equal(third.nodes.F01_N03.state,'unavailable');assert.equal(third.nodes.F01_N02.value.data.length,13000);
  assert.match(third.nodes.F01_N03.reason,/Artifact\/reference/);assert.equal(third.proposals.length,0);
  const fourth=await f.invoke({...original,checkpoint:third.checkpoint});
  assert.equal(fourth.nodes.F01_N02.state,'completed');assert.equal(reads,1);assert.equal(f.seen.length,1,'No implicit replay of the rejected candidate');
});

test('escaped host output is checked after the outer message JSON serialization',async t=>{
  const f=await fixture(t,{engine:{host:{capabilities:hostCapabilities,read:async()=>({state:'completed',value:{data:'"'.repeat(13000)}})}}});
  const original=request('small'),first=await f.invoke(original),second=await f.invoke({...original,checkpoint:first.checkpoint});
  assert.equal(second.nodes.F01_N02.state,'unavailable');assert.equal(second.nodes.F01_N01.state,'completed');
  assert.match(second.nodes.F01_N02.reason,/Artifact\/reference/);
});

const readTool={name:'workspace.read_text',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false}};
const receipt=(proposal,result,state='confirmed')=>({...proposal,state,result,evidenceRefs:state==='confirmed'?['actual-host-evidence']:[],proof:'synthetic-host-proof'});
const readCandidates=context=>[
  {id:'accept',description:'synthetic selected candidate',value:context.node.kind==='tool'
    ?{toolName:readTool.name,toolVersion:readTool.version,arguments:{}}:{decision:'d'.repeat(20000)}},
  {id:'review',description:'synthetic abstention',value:{},abstain:true},
];
test('signed host result and Evidence survive compaction and exact restoration without repeating an operation',async t=>{
  const f=await fixture(t,{prepareCandidates:readCandidates,engine:{receiptVerifier:{verify:async receipt=>receipt.proof==='synthetic-host-proof'}}});
  const original=request({task:'read original result'},{workflowId:'F20',availableTools:[readTool]}),first=await f.invoke(original);
  const proposal=first.proposals[0],value={content:'r'.repeat(28000)};
  const second=await f.invoke({...original,checkpoint:first.checkpoint,receipts:[receipt(proposal,value)]});
  assert.equal(second.nodes.F20_N01.state,'completed');assert.equal(second.nodes.F20_N01.value.kind,'trusted_tool_result_reference');
  assert.equal(second.nodes.F20_N01.value.valueDigest,sha(value));assert.deepEqual(second.nodes.F20_N01.evidenceRefs,['actual-host-evidence']);
  assert.equal(second.nodes.F20_N01.proposal.operationId,proposal.operationId);assert.equal(second.nodes.F20_N02.state,'pending');
  await f.invoke({...original,checkpoint:second.checkpoint,resolvedValues:{F20_N01:{content:'substitution'}}},'INVALID_ARGUMENT');
  const third=await f.invoke({...original,checkpoint:second.checkpoint,resolvedValues:{F20_N01:value}});
  assert.equal(third.nodes.F20_N02.state,'completed');assert.deepEqual(f.seen.at(-1).predecessorOutputs.F20_N01,value);
  assert.equal(third.nodes.F20_N01.proposal.operationId,proposal.operationId);assert.equal(third.proposals.length,0);
  assert.equal(f.seen.filter(context=>context.node.id==='F20_N01').length,1);
});

test('unknown host effect keeps its original identity and unknown state when its large result is referenced',async t=>{
  const f=await fixture(t,{prepareCandidates:readCandidates,engine:{receiptVerifier:{verify:async()=>true}}});
  const original=request('read',{workflowId:'F20',availableTools:[readTool]}),first=await f.invoke(original),proposal=first.proposals[0];
  const second=await f.invoke({...original,checkpoint:first.checkpoint,receipts:[receipt(proposal,{detail:'u'.repeat(28000)},'unknown')]});
  assert.equal(second.nodes.F20_N01.state,'unknown');assert.equal(second.nodes.F20_N01.value.kind,'trusted_tool_result_reference');
  assert.equal(second.nodes.F20_N01.proposal.operationId,proposal.operationId);assert.equal(second.proposals.length,0);
  const third=await f.invoke({...original,checkpoint:second.checkpoint});
  assert.equal(third.nodes.F20_N01.state,'unknown');assert.equal(third.proposals.length,0);assert.equal(f.seen.length,1);
});

test('workflow JSON cannot supply the trusted result-bound callback',async t=>{
  const f=await fixture(t);await f.invoke({...request('small'),resultFits:true},'INVALID_ARGUMENT');assert.equal(f.seen.length,0);
});

test('user input which resembles an input reference remains ordinary data',async t=>{
  const seen=[];
  const f=await fixture(t,{engine:{host:{capabilities:hostCapabilities,read:async context=>{seen.push(context);return {state:'completed',value:{ok:true}};}}}});
  const original=request({kind:'workflow_input_reference',valueDigest:'a'.repeat(64)}),first=await f.invoke(original);
  assert.deepEqual(first.nodes.F01_N01.value,original.input);assert.equal(first.nodes.F01_N01.inputReference,undefined);
  const second=await f.invoke({...original,checkpoint:first.checkpoint});assert.equal(second.nodes.F01_N02.state,'completed');
  assert.deepEqual(seen[0].predecessorOutputs.F01_N01,original.input);
});

test('HTTP keeps its existing large workflow result capacity and small result shape',async t=>{
  const f=await fixture(t),original=request('x'.repeat(28000));
  const response=await fetch(f.url+'/invocations',{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':`Bearer ${token}`},body:JSON.stringify({query:JSON.stringify(original)})});
  assert.equal(response.status,200);const events=await response.json();
  assert.ok(Buffer.byteLength(JSON.stringify(events))>MAX_AGENTARTS_RESULT_BYTES);
  const result=JSON.parse(events[0].data.text);assert.equal(result.nodes.F01_N01.value,original.input);
  const small=await f.invoke(request('small'));assert.equal(small.nodes.F01_N01.value,'small');
});
