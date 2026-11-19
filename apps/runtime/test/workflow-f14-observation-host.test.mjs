import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF14ObservationHost} from '../dist/application/workflow-f14-observation-host.js';

// Synthetic Runtime records and browser output; no real browser or device is used.
function fixture(){
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),args={url:'https://example.org/page'};
  const records=new Map(),put=(id,key,value)=>records.set(id+'|'+key,value);
  put('graph-child','coding-repair:parent',{taskId:'parent',operationId:'op'});
  put('graph-child','host-tool-intent',{commandId:'op',toolName:'workflow.host.f14_n01',arguments:args,deadline});
  put('parent','owned-workflow:intent:op',{taskId:'parent',workflowId:'F14',sessionId:'session',deadline,
    proposal:{nodeId:'F14_N01',operationId:'op',toolName:'workflow.host.f14_n01',arguments:args}});
  put('browser-child','coding-repair:parent',{taskId:'graph-child',operationId:'browser-op'});
  put('graph-child','coding-repair:host:browser-op',{localTaskId:'browser-child',request:{commandId:'browser-op',toolName:'browser.observe',
    toolVersion:'1.0.0',arguments:{},deadline}});
  const observation={source:'playwright',state:'observed',goalVerified:false,url:args.url,observedAt:new Date(now-100).toISOString(),
    expiresAt:new Date(now+10000).toISOString(),targetRef:'browser-task-only',controls:[{ref:'r1'},{ref:'r2'}]};
  const read={commandId:'browser-op',toolName:'browser.observe',toolVersion:'1.0.0',task:{taskId:'browser-child',state:'succeeded'},
    confirmed:{runId:'host-tool-browser-child',result:observation,evidenceRefs:['host-tool-browser-child']}};
  const graphRead={commandId:'op',toolName:'workflow.host.f14_n01',toolVersion:'1.0.0',task:{taskId:'graph-child',state:'succeeded'},
    confirmed:{runId:'host-tool-graph-child',result:{elementsFound:2},evidenceRefs:['host-tool-graph-child']}};
  const runtime={loadCheckpoint:(id,key)=>records.get(id+'|'+key),getTask:()=>({state:'running',cancelRequested:false}),
    saveCheckpointOnce:(id,key,value)=>{const k=id+'|'+key;if(records.has(k))return false;records.set(k,structuredClone(value));return true;}};
  const context={taskId:'graph-child',runId:'host-tool-graph-child',authorizationRef:'approved',scopes:['browser:control'],
    deadline,signal:new AbortController().signal};
  const browserObserve={descriptor:{name:'browser.observe',version:'1.0.0',sideEffect:'read',requiredScopes:['browser:control']}};
  let permitted=true,exportAllowed=true,calls=0,clock=now;
  const options={application:{runtime,readHostToolTask:id=>structuredClone(id==='graph-child'?graphRead:read)},browserObserve,
    invokeObservation:async()=>{calls++;return {localTaskId:'browser-child',operationId:'browser-op'};},
    assertCurrent:()=>{if(!permitted)throw Error('expired');},authorizeExport:async()=>exportAllowed,now:()=>new Date(clock)};
  return {args,context,options,read,graphRead,put,stop:()=>{permitted=false;},deny:()=>{exportAllowed=false;},advance:ms=>{clock+=ms;},calls:()=>calls};
}
test('F14 browser observation unavailable without original trusted ports',()=>{
  assert.deepEqual(createRuntimeF14ObservationHost().tools,[]);
  const f=fixture();delete f.options.invokeObservation;
  assert.equal(createRuntimeF14ObservationHost(f.options).unavailable,'f14_observation_trusted_ports_unavailable');
});
test('F14 observes only the original confirmed browser task and exports a bounded count',async()=>{
  const f=fixture(),host=createRuntimeF14ObservationHost(f.options);
  assert.equal(host.tools[0].descriptor.name,'workflow.host.f14_n01');
  assert.deepEqual(await host.tools[0].execute(f.args,f.context),{elementsFound:2});
  await host.authorizeReceipt({context:f.context,result:{elementsFound:2}});
  assert.equal(f.calls(),1);
  f.deny();await assert.rejects(host.authorizeReceipt({context:f.context,result:{elementsFound:2}}),{code:'UNAUTHORIZED'});
});
test('F14 rejects missing scope, changed original page, evidence and authority',async()=>{
  const f=fixture(),host=createRuntimeF14ObservationHost(f.options),tool=host.tools[0];
  await assert.rejects(tool.execute(f.args,{...f.context,scopes:[]}),{code:'SCOPE_DENIED'});assert.equal(f.calls(),0);
  f.read.confirmed.result.url='https://example.org/other';await assert.rejects(tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
  f.read.confirmed.result.url=f.args.url;f.read.confirmed.evidenceRefs=[];await assert.rejects(tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
  f.read.confirmed.evidenceRefs=['host-tool-browser-child'];f.stop();await assert.rejects(tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
});
test('F14 rejects forged host receipt and never repeats observation',async()=>{
  const f=fixture(),host=createRuntimeF14ObservationHost(f.options);await host.tools[0].execute(f.args,f.context);
  await assert.rejects(host.authorizeReceipt({context:f.context,result:{elementsFound:3}}),{code:'UNAUTHORIZED'});
  f.graphRead.confirmed.evidenceRefs=[];
  await assert.rejects(host.authorizeReceipt({context:f.context,result:{elementsFound:2}}),{code:'UNAUTHORIZED'});
  f.graphRead.confirmed.evidenceRefs=['host-tool-graph-child'];f.graphRead.task.state='running';
  await assert.rejects(host.authorizeReceipt({context:f.context,result:{elementsFound:2}}),{code:'UNAUTHORIZED'});
  assert.equal(f.calls(),1);
});
test('F14 rejects stale observation and source changes during receipt export',async()=>{
  const f=fixture(),host=createRuntimeF14ObservationHost(f.options);await host.tools[0].execute(f.args,f.context);
  f.advance(10001);await assert.rejects(host.authorizeReceipt({context:f.context,result:{elementsFound:2}}),{code:'UNAUTHORIZED'});
  const g=fixture(),host2=createRuntimeF14ObservationHost(g.options);await host2.tools[0].execute(g.args,g.context);
  g.options.authorizeExport=async()=>{g.read.confirmed.result.controls.pop();return true;};
  await assert.rejects(host2.authorizeReceipt({context:g.context,result:{elementsFound:2}}),{code:'REVISION_CONFLICT'});
  assert.equal(g.calls(),1);
});
