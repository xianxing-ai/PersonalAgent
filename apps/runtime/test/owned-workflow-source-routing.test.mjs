import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeOwnedWorkflowImageAdapter} from '../dist/application.js';

const source=readFileSync(new URL('../dist/application/agentarts.js',import.meta.url),'utf8');
const begin=source.indexOf('const ownedImage ='),end=source.indexOf('const f09FromPorts =',begin);
assert.ok(begin>=0&&end>begin,'actual Competition factory must compose its shared image');
function compose({ports=[],f20,authorizationRead=async()=> 'Bearer synthetic',workflowId='F05'}={}){
  let sends=0;
  const context=Object.fromEntries(['fetchHandlesHostAuthorization','transport','websocketUrl','allowHttpsFallback',
    'websocketAuthorizationProvider','websocketFactory','invokeMode','workflowGoalInput','assertDeploymentBinding',
    'onTransportState','readOwnedWorkflowReceiptSecret'].map(key=>[key,undefined]));
  Object.assign(context,{ProtocolError,createRuntimeOwnedWorkflowImageAdapter,initialRequestMode:'goal-with-tools-json',
    gatewayUrl:'https://fixture.invalid',runtimeName:'fixture-runtime',deploymentVersion:'v-fixed',
    configuredWorkflowWorkerPorts:ports,f20WorkflowWorkerPorts:f20,authorizationProvider:{read:authorizationRead},
    fetchImpl:async()=>{sends++;const result={workflowVersion:'1.0.0',workflowId,state:'progress',verification:'unverified',
      checkpoint:'synthetic-seal',nodes:{},proposals:[],unavailable:[],feedback:[]};
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});}});
  const adapter=runInNewContext(source.slice(begin,end)+'\nownedImage;',context);
  const request={workflowId,taskId:'original-task',sessionId:'original-session',controlRevision:1,requestId:'original-request',
    input:{goal:'Public fixture'},availableTools:[],deadline:new Date(Date.now()+10000).toISOString(),
    taskDeadline:new Date(Date.now()+20000).toISOString(),signal:new AbortController().signal};
  return {adapter,request,sends:()=>sends};
}
test('actual Competition composition rechecks only the configured original graph after reading credentials',async()=>{
  let current=true,checks=0,otherChecks=0;
  const f=compose({ports:[{workflowId:'F05',assertCurrent:scope=>{
    checks++;assert.equal(scope.taskId,'original-task');assert.equal(scope.deadline,f.request.taskDeadline);
    assert.equal(scope.signal,f.request.signal);if(!current)throw new ProtocolError('REVISION_CONFLICT','Original citation changed');}},
    {workflowId:'F11',assertCurrent:()=>{otherChecks++;}}],authorizationRead:async()=>{current=false;return 'Bearer synthetic';}});
  try{await assert.rejects(f.adapter.advance(f.request),/Original citation changed/);assert.ok(checks>=2);
    assert.equal(otherChecks,0);assert.equal(f.sends(),0);}finally{f.adapter.close();}
});
test('shared image preserves the original F20 source guard alongside configured graphs',async()=>{
  let current=true,configuredChecks=0,checks=0;
  const f=compose({workflowId:'F20',ports:[{workflowId:'F05',assertCurrent:()=>{configuredChecks++;}}],
    f20:{assertCurrent:()=>{checks++;if(!current)throw Error('Original F20 changed');}},
    authorizationRead:async()=>{current=false;return 'Bearer synthetic';}});
  try{await assert.rejects(f.adapter.advance(f.request),/Original F20 changed/);assert.ok(checks>=2);
    assert.equal(configuredChecks,0);assert.equal(f.sends(),0);}finally{f.adapter.close();}
});
test('ambiguous or asynchronous configured guards cannot reach the transport',async()=>{
  for(const ports of [[{workflowId:'F05',assertCurrent:()=>{}},{workflowId:'F05',assertCurrent:()=>{}}],
    [{workflowId:'F05',assertCurrent:async()=>{}}]]){
    const f=compose({ports});try{await assert.rejects(f.adapter.advance(f.request),/ambiguous|synchronous/);
      assert.equal(f.sends(),0);}finally{f.adapter.close();}
  }
});
test('an unchanged configured source still sends the original graph once',async()=>{
  let checks=0;const f=compose({ports:[{workflowId:'F05',assertCurrent:()=>{checks++;}}]});
  try{assert.equal((await f.adapter.advance(f.request)).workflowId,'F05');assert.ok(checks>=2);assert.equal(f.sends(),1);}
  finally{f.adapter.close();}
});
