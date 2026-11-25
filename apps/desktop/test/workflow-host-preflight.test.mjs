import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';

function fixture(nested=false){
  const records=new Map(),calls=[],key=(id,name)=>JSON.stringify([id,name]),put=(id,name,value)=>records.set(key(id,name),value);
  const deadline=new Date(Date.now()+60000).toISOString(),taskId=nested?'business':'source',parentId=nested?'source':'graph';
  const pending={toolName:nested?'todo.create':'workflow.host.f06_n03',toolVersion:'1.0.0',arguments:{title:'Synthetic'},argumentsDigest:'digest',deadline};
  const scope={...pending,taskId,runId:'host-tool-'+taskId,signal:new AbortController().signal};
  const commandId=nested?'business-op':'graph-op';
  put(taskId,'coding-repair:parent',{taskId:parentId,operationId:commandId});
  put(parentId,'coding-repair:host:'+commandId,{localTaskId:taskId,request:{commandId,...pending}});
  put('graph','owned-workflow:intent:graph-op',{taskId:'graph',deadline,workflowId:'F06',proposal:{operationId:'graph-op'}});
  if(nested){put('business','workflow-business-tool:source',{sourceTaskId:'source',sourceRunId:'host-tool-source',commandId});
    put('source','coding-repair:parent',{taskId:'graph',operationId:'graph-op'});}
  const owner={state:'running',cancelRequested:false};
  const application={runtime:{loadCheckpoint:(id,name)=>structuredClone(records.get(key(id,name))),getTask:()=>owner},
    readPendingToolInvocation:()=>structuredClone(pending),readHostToolTask:()=>({commandId})};
  return {application,scope,pending,owner,put,calls,prepareExport:async value=>{calls.push(value);}};
}

for(const nested of [false,true])test(`original ${nested?'business':'graph'} child uses its own exact preflight identity`,async()=>{
  const f=fixture(nested);await prepareWorkflowHostPreflight(f);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].taskId,f.scope.taskId);assert.equal(f.calls[0].runId,f.scope.runId);
  assert.equal(f.calls[0].proposal.proposalId,nested?'business-op':'graph-op');assert.deepEqual(f.calls[0].proposal.arguments,f.pending.arguments);
});

for(const mode of ['arguments','deadline','parent','marker','cancel'])test(`preflight ${mode} change cannot reach the subsequent approval`,async()=>{
  const f=fixture(true);f.prepareExport=async()=>{
    if(mode==='arguments')f.pending.arguments={title:'Changed'};if(mode==='deadline')f.pending.deadline=new Date().toISOString();
    if(mode==='parent')f.put('source','coding-repair:parent',{taskId:'other',operationId:'graph-op'});
    if(mode==='marker')f.put('business','workflow-business-tool:source',{sourceTaskId:'other'});
    if(mode==='cancel')f.owner.cancelRequested=true;
  };await assert.rejects(prepareWorkflowHostPreflight(f),{code:'UNAUTHORIZED'});
});

test('ordinary host operations and non-host runs acquire no graph export preparation',async()=>{
  const f=fixture();f.scope.runId='ordinary-run';await prepareWorkflowHostPreflight(f);assert.deepEqual(f.calls,[]);
  f.scope.runId='host-tool-source';f.put('graph','owned-workflow:intent:graph-op',undefined);
  await prepareWorkflowHostPreflight(f);assert.deepEqual(f.calls,[]);
});
