import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,getOwnedWorkflowBindings,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createAgentServer} from '../src/server.mjs';
import {ownedRequestPath} from '../src/request-path.mjs';

const token='synthetic-f09-route-credential-at-least-32-chars';

async function host(t) {
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:token,
    selector:{select:async()=>'review'},
    prepareCandidates:async()=>[{id:'review',description:'Explicit F09 fixture refuses unverified work',value:null,abstain:true}],
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:token})});
  const calls=[];
  const orchestrator={
    invoke:async()=>{throw Error('Plain model invoke must not run on /invocations/f09');},
    getBindings:()=>[],
    invokeWorkflow:async()=>{throw Error('Legacy workflow must not run');},
    invokeController:async()=>{throw Error('Legacy controller must not run');},
    getOwnedWorkflowCatalog:getOwnedWorkflowBindings,
    getOwnedWorkflowTemplate,
    invokeOwnedWorkflow:async request=>{calls.push(request);return engine.advance(request);},
  };
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,orchestrator});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {calls,url:`http://127.0.0.1:${server.address().port}`};
}

test('/invocations/f09 resolves in ownedRequestPath and preserves ?endpoint=vN while rejecting query tokens',()=>{
  assert.equal(ownedRequestPath('/invocations/f09'),'/invocations/f09');
  assert.equal(ownedRequestPath('/invocations/f09?endpoint=v4'),'/invocations/f09');
  assert.equal(ownedRequestPath('/invocations/f09?token=leak'),undefined);
  assert.equal(ownedRequestPath('/invocations/f10'),undefined);
});

test('POST /invocations/f09 supports F09 catalog (explicit or omitted workflowId) and F09 advance with valid credentials',async t=>{
  const {url,calls}=await host(t);
  const auth={'content-type':'application/json','x-pa-agent-token':`Bearer ${token}`};

  const catalogOmitted=await fetch(url+'/invocations/f09?endpoint=v4',{method:'POST',headers:auth,
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog'})})});
  assert.equal(catalogOmitted.status,200);
  const catalogOmittedBody=JSON.parse((await catalogOmitted.json())[0].data.text);
  assert.equal(catalogOmittedBody.template.workflowId,'F09');
  assert.ok(catalogOmittedBody.workflowBindings.some(item=>item.workflowId==='F09'));

  const catalogExplicit=await fetch(url+'/invocations/f09',{method:'POST',headers:auth,
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog',workflowId:'F09'})})});
  assert.equal(catalogExplicit.status,200);
  const catalogExplicitBody=JSON.parse((await catalogExplicit.json())[0].data.text);
  assert.equal(catalogExplicitBody.template.workflowId,'F09');
  assert.ok(catalogExplicitBody.workflowBindings.some(item=>item.workflowId==='F09'));

  const taskDeadline=new Date(Date.now()+120_000).toISOString();
  const advance=await fetch(url+'/invocations/f09',{method:'POST',headers:auth,
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'advance',workflowId:'F09',taskId:'f09-task-1',controlRevision:1,input:{fixture:true},availableTools:[],taskDeadline})})});
  assert.equal(advance.status,200);
  const advanceBody=JSON.parse((await advance.json())[0].data.text);
  assert.equal(advanceBody.workflowId,'F09');
  assert.equal(calls.length,1);
  assert.equal(calls[0].workflowId,'F09');
});

test('POST /invocations/f09 enforces authorization and rejects non-F09, non-workflow and query-token requests',async t=>{
  const {url,calls}=await host(t);
  const auth={'content-type':'application/json','x-pa-agent-token':`Bearer ${token}`};

  const unauth=await fetch(url+'/invocations/f09',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog'})})});
  assert.equal(unauth.status,401);

  const wrongToken=await fetch(url+'/invocations/f09',{method:'POST',
    headers:{'content-type':'application/json','x-pa-agent-token':'Bearer wrong-credential-at-least-32-chars'},
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog'})})});
  assert.equal(wrongToken.status,401);

  for (const payload of [
    {query:'plain hello'},
    {query:JSON.stringify({platformVersion:1,operation:'list'})},
    {query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog',workflowId:'F10'})},
    {query:JSON.stringify({workflowVersion:'1.0.0',operation:'advance',workflowId:'F20',taskId:'t1',controlRevision:1,input:{},availableTools:[],taskDeadline:new Date(Date.now()+120_000).toISOString()})},
    {query:JSON.stringify({workflowVersion:'1.0.0',operation:'advance',taskId:'t1',controlRevision:1,input:{},availableTools:[],taskDeadline:new Date(Date.now()+120_000).toISOString()})},
    {query:JSON.stringify({bindingVersion:'1.0.0',type:'agent',id:'fast',query:'x'})},
  ]) {
    const rejected=await fetch(url+'/invocations/f09',{method:'POST',headers:auth,body:JSON.stringify(payload)});
    assert.equal(rejected.status,400);
  }

  assert.equal((await fetch(url+'/invocations/f09?token=leak',{method:'POST',headers:auth,body:JSON.stringify({query:'x'})})).status,404);
  assert.equal((await fetch(url+'/invocations/f10',{method:'POST',headers:auth,body:JSON.stringify({query:'x'})})).status,404);
  assert.equal((await fetch(url+'/invocations/f09',{method:'GET',headers:auth})).status,404);
  assert.equal(calls.length,0);
});
