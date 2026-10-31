import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtimeModule from '@personal-agent/runtime/application';
import {calendarSnapshotVersion} from '@personal-agent/calendar';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';

// Explicit offline fixtures verify the production composition boundaries, not a cloud/account acceptance.
const descriptor=(name,sideEffect='read')=>({name,version:'1.0.0',sideEffect,requiredScopes:[name.split('.')[0]+':'+(sideEffect==='read'?'read':'write')],
  inputSchema:{type:'object'},outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false,requiresPresence:false});
function setup(options={}){
  const checkpoints=new Map(),controller=new AbortController(),time=Date.now(),deadline=new Date(time+60000).toISOString();
  let ready=true,bindingId='original-account';
  const scope={taskId:'parent',deadline,signal:controller.signal};
  const input={title:'Original event',slot:{startUtc:'2026-11-01T09:00:00.000Z',endUtc:'2026-11-01T10:00:00.000Z'},
    calendarReadArguments:{fromUtc:'2026-11-01T00:00:00.000Z',toUtc:'2026-11-02T00:00:00.000Z'}};
  const bound={sessionId:'session',deadline,input:{...input,businessBindingId:bindingId},confirmedOperations:[]};
  const app={runtime:{getTask:()=>({state:'running'}),loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpointOnce:(id,key,value)=>{if(!checkpoints.has(id+key))checkpoints.set(id+key,structuredClone(value));}},
    readConfiguredWorkflowBinding:()=>bound};
  const businessTools=['calendar.events','calendar.create'].map(name=>({descriptor:descriptor(name,name.endsWith('.create')?'external_write':'read')}));
  const exports=[],composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,
    competitionToolExports:businessTools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,accepts:()=>true,project:({result})=>result})),
    prepareCompetitionToolExport:async()=>{},authorizeExport:async request=>{exports.push(request);return true;},
    readBusinessAvailability:()=>({ready,bindingId}),now:()=>time,...options});
  return {composition,app,bound,input,scope,controller,exports,checkpoints,
    worker:composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F07'),
    setReady:value=>{ready=value;},setBinding:value=>{bindingId=value;}};
}
test('business factories assemble before Runtime initialization and never advertise missing dependencies',()=>{
  const f=setup({getApplication:()=>undefined});assert.equal(f.composition.tools.length,2);assert.ok(f.worker);
  assert.equal(f.worker.available(f.scope),false);
  const missing=setup({businessTools:[]});assert.deepEqual(missing.composition.configuredWorkflowWorkerPorts,[]);
  assert.ok(missing.composition.unavailable.includes('f07_business_dependencies_unavailable'));
  assert.equal(setup({authorizeExport:undefined}).composition.configuredWorkflowWorkerPorts.length,0);
  assert.equal(setup({competitionToolExports:[]}).composition.configuredWorkflowWorkerPorts.length,0);
});
test('F07 fixed input, account generation, cancellation and exact export consent remain required',async()=>{
  const f=setup();assert.equal(f.worker.available(f.scope),true);
  assert.deepEqual(await f.worker.resolveInput(f.input,f.scope),f.bound.input);
  await assert.rejects(f.worker.resolveInput({...f.input,workflowId:'F08'},f.scope));
  await assert.rejects(f.worker.resolveInput({...f.input,slot:{...f.input.slot,endUtc:'2026-11-03T00:00:00Z'}},f.scope),{code:'INVALID_ARGUMENT'});
  assert.equal(await f.worker.authorizeExport({...f.scope,stage:'initial',value:f.bound.input}),true);
  assert.equal(f.exports[0].workflowId,'F07');
  f.setBinding('replacement-account');assert.throws(()=>f.worker.assertCurrent(f.scope),{code:'REVISION_CONFLICT'});
  f.setBinding('original-account');f.setReady(false);assert.equal(f.worker.available(f.scope),false);
  f.setReady(true);f.controller.abort();assert.throws(()=>f.worker.assertCurrent(f.scope),{code:'CANCELLED'});
});
test('F07 frontier rejects substitute reads, stale versions, overlap and unconfirmed creation',async()=>{
  const f=setup(),state={sessionId:'session',result:{nodes:Object.fromEntries([1,2,3,4].map(n=>['F07_N0'+n,{state:'completed'}]))}};
  const frontier=(nodeId,toolName,args)=>f.worker.assertFrontier({...f.scope,input:f.bound.input,state,proposal:{nodeId,toolName,arguments:args}});
  assert.equal(await frontier('F07_N02','calendar.events',f.input.calendarReadArguments),true);
  assert.equal(await frontier('F07_N02','calendar.events',{...f.input.calendarReadArguments,limit:1}),false);
  const result={window:f.input.calendarReadArguments,items:[],hasMore:false,nextCursor:'',sourceVersion:calendarSnapshotVersion(f.input.calendarReadArguments,[])};
  f.bound.confirmedOperations.push({nodeId:'F07_N02',toolName:'calendar.events',result});
  const freshArguments={calendarVersionAtRead:result.sourceVersion,calendarVersionNow:result.sourceVersion};
  assert.equal(await frontier('F07_N04','workflow.host.f07_n04',freshArguments),false,'cloud completed decision is not an original decision receipt');
  f.bound.confirmedOperations.push({nodeId:'F07_N03',toolName:'decision.choose_candidate',result:{selected:true}});
  assert.equal(await frontier('F07_N04','workflow.host.f07_n04',freshArguments),true);
  assert.equal(await frontier('F07_N04','workflow.host.f07_n04',{calendarVersionAtRead:result.sourceVersion,calendarVersionNow:'stale'}),false);
  const args={title:f.input.title,slot:f.input.slot};assert.equal(await frontier('F07_N05','workflow.host.f07_n05',args),false);
  f.bound.confirmedOperations.push({nodeId:'F07_N04',toolName:'workflow.host.f07_n04',result:{versionConsistent:true,sourceVersion:result.sourceVersion}});
  assert.equal(await frontier('F07_N05','workflow.host.f07_n05',args),true);
  assert.equal(await frontier('F07_N05','calendar.create',{summary:f.input.title,...f.input.slot}),false);
  result.items=[{validFor:'2026-11-01T09:30:00Z/2026-11-01T10:30:00Z'}];result.sourceVersion=calendarSnapshotVersion(result.window,result.items);
  f.bound.confirmedOperations.find(op=>op.nodeId==='F07_N04').result.sourceVersion=result.sourceVersion;
  assert.equal(await frontier('F07_N05','workflow.host.f07_n05',args),false);
  await assert.rejects(f.worker.verifyCompletion({...f.scope,input:f.bound.input,state,readbacks:[]}),{code:'RESULT_UNKNOWN'});
});
test('F06 future reminders retain explicit time and require the trusted guard without advancing a clock',async()=>{
  const businessTools=[{descriptor:descriptor('todo.create','local_write')},{descriptor:descriptor('workflow.host.f06_n04')}];
  const f=setup({businessTools,competitionToolExports:businessTools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',accepts:()=>true,project:({result})=>result})),
    todoHost:{snapshot:()=>({items:[],notifications:[]})},notificationHost:{reconcileDelivery(){}}});
  const worker=f.composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F06');assert.ok(worker);
  const input={todoTitle:'Future task',remindUtc:new Date(Date.now()+120000).toISOString()};
  assert.deepEqual(await worker.resolveInput(input,f.scope),{...input,businessBindingId:'original-account'});
  assert.equal(worker.configurationVersion,'business-20261031-f06-v2');
  assert.ok(worker.requiredTools.some(tool=>tool.name==='workflow.guard.f06_n05'));
  assert.equal(f.checkpoints.size,1);
});
test('business exports refuse a confirmed-looking receipt without original execution proof',async()=>{
  const f=setup();f.app.readHostToolTask=()=>({task:{state:'succeeded'},confirmed:{result:{items:[]}}});
  f.app.runtime.readToolExecutions=()=>[];
  await assert.rejects(f.worker.authorizeExport({...f.scope,stage:'receipt',localTaskId:'foreign',
    proposal:{toolName:'calendar.events'},value:{state:'confirmed',result:{items:[]}}}),{code:'UNAUTHORIZED'});
  assert.deepEqual(f.exports,[]);
});
