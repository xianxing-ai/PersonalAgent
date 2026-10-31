import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF07CalendarFreshnessHost} from '../dist/application/workflow-f07-calendar-graph-host.js';

function fixture(){
  const deadline=new Date(Date.now()+60000).toISOString(),args={calendarVersionAtRead:'v1',calendarVersionNow:'v1'};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',deadline,signal:new AbortController().signal,scopes:['calendar:read']};
  const data=new Map(),put=(id,key,value)=>data.set(id+':'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'op'});
  put('child','host-tool-intent',{commandId:'op',toolName:'workflow.host.f07_n04',arguments:args,deadline});
  put('parent','owned-workflow:intent:op',{taskId:'parent',workflowId:'F07',sessionId:'session',deadline,
    proposal:{nodeId:'F07_N04',operationId:'op',toolName:'workflow.host.f07_n04',arguments:args}});
  let source='v1',bound=true,allowed=true;
  let result={versionConsistent:true,sourceVersion:'v1'};
  const application={runtime:{loadCheckpoint:(id,key)=>data.get(id+':'+key),getTask:()=>({state:'running',cancelRequested:false})},
    readHostToolTask:()=>({commandId:'op',toolName:'workflow.host.f07_n04',task:{state:'succeeded'},confirmed:{runId:context.runId,evidenceRefs:[context.runId],result}})};
  const host=createRuntimeF07CalendarFreshnessHost({application,requiredScopes:['calendar:read'],readSourceVersion:async()=>source,
    verifyReadBinding:async()=>bound,assertCurrent:()=>{},authorizeExport:async()=>allowed,now:()=>new Date()});
  return {host,context,args,setSource:value=>{source=value;},setBound:value=>{bound=value;},setAllowed:value=>{allowed=value;},setResult:value=>{result=value;}};
}
test('F07 freshness stays unavailable without trusted version, binding, or receipt ports',()=>{
  assert.equal(createRuntimeF07CalendarFreshnessHost().tools.length,0);
  assert.equal(createRuntimeF07CalendarFreshnessHost({application:{runtime:{}}}).tools.length,0);
});
test('F07 freshness binds original request and confirmed receipt, rejects stale or forged versions',async()=>{
  const f=fixture(),tool=f.host.tools[0];
  assert.deepEqual(await tool.execute(f.args,f.context),{versionConsistent:true,sourceVersion:'v1'});
  await assert.rejects(tool.execute({...f.args,calendarVersionNow:'v2'},f.context),{code:'UNAUTHORIZED'});
  await f.host.authorizeReceipt({context:f.context,result:{versionConsistent:true,sourceVersion:'v1'}});
  await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{versionConsistent:false,sourceVersion:'v1'}}),{code:'UNAUTHORIZED'});
  f.setSource('v2');await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{versionConsistent:true,sourceVersion:'v1'}}),{code:'REVISION_CONFLICT'});
  f.setSource('v1');f.setBound(false);await assert.rejects(tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
  f.setBound(true);f.setAllowed(false);await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{versionConsistent:true,sourceVersion:'v1'}}),{code:'UNAUTHORIZED'});
});
