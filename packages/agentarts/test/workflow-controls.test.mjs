import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OwnedWorkflowEngine,workflowJoinReady,workflowHostToolName,workflowGuardToolName} from '../dist/owned-workflows.js';
import {OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '../dist/owned-workflow-host-bridge.js';
import {getOwnedWorkflowTemplates,getOwnedWorkflowTemplate} from '../dist/owned-workflow-templates.js';

const secret='fixture-control-and-receipt-key-at-least-32-chars';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schema={type:'object',additionalProperties:true};
function fixture(template,{missing=false,readRetryAttestation=false}={}) {
  const tasks=new Map(),checkpoints=new Map(),calls=[];let count=0;
  const descriptorNames=[...new Set(template.nodes.flatMap(node=>[
    ...node.capabilities.filter(cap=>cap.kind==='tool').map(cap=>cap.name),
    ...(node.kind==='host'?[workflowHostToolName(node.id)]:[]),...(node.condition?[workflowGuardToolName(node.id)]:[])]))];
  const availableTools=missing?[]:descriptorNames.map(name=>({name,version:'1.0.0',inputSchema:schema}));
  const host={submitHostToolTask:request=>{
    calls.push(structuredClone(request));const taskId='fixture-local-'+(++count);
    const node=template.nodes.find(node=>workflowGuardToolName(node.id)===request.toolName);
    const result=node?{state:node.hostGuard?'skipped':'selected'}:{fixture:true,tool:request.toolName};
    const task={taskId,state:'succeeded'};
    tasks.set(taskId,{...request,task,confirmed:{runId:'host-tool-'+taskId,result,evidenceRefs:['host-tool-'+taskId]}});
    return {...request,task};
  },readHostToolTask:id=>structuredClone(tasks.get(id))};
  const bridge=new OwnedWorkflowHostBridge({host,receiptSecret:secret,assertActive(){},
    canRetryReadFailure:()=>readRetryAttestation,
    checkpoints:{read:(taskId,key)=>checkpoints.get(taskId+':'+key),writeOnce:(taskId,key,value)=>{
      const id=taskId+':'+key;if(checkpoints.has(id))return false;checkpoints.set(id,structuredClone(value));return true;}}});
  const engine=new OwnedWorkflowEngine({checkpointSecret:secret,receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),externalHost:true,
    selector:{select:async()=> 'fixture'},prepareCandidates:async context=>[
      {id:'fixture',description:'Explicit synthetic candidate, not a real service',value:context.node.kind==='tool'
        ?{toolName:context.node.capabilities[0].name,toolVersion:'1.0.0',arguments:{}}:context.node.kind==='host'?{arguments:{}}:{fixtureNode:context.node.id}},
      {id:'review',description:'Do not execute',value:null,abstain:true}]});
  const request={workflowId:template.workflowId,taskId:'fixture-parent',sessionId:'fixture-session',requestId:'fixture-request',
    input:{fixture:true},controlRevision:1,deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,availableTools};
  return {engine,bridge,request,calls,tasks};
}
async function command(f,last,action,id=action) {
  const request={...f.request,checkpoint:last.checkpoint};
  return f.engine.advance({...request,hostControl:f.bridge.control(request,{commandId:id,action,reason:'Explicit fixture control'})});
}

for(const template of getOwnedWorkflowTemplates())test(`${template.workflowId}: actual Engine/Bridge signed controls and checkpoint continuation with Fake external tools`,async()=>{
  const f=fixture(template);let last=await f.engine.advance(f.request);
  const before=structuredClone(last.nodes),callCount=f.calls.length;
  last=await command(f,last,'pause');assert.equal(last.state,'paused');assert.deepEqual(last.nodes,before);assert.deepEqual(last.proposals,[]);
  const held=await f.engine.advance({...f.request,checkpoint:last.checkpoint});assert.equal(held.state,'paused');assert.deepEqual(held.nodes,before);
  last=await command(f,held,'notify_controller');assert.equal(last.state,'paused');
  assert.equal(last.hostControl.events.at(-1).action,'notify_controller');
  last=await command(f,last,'resume');assert.equal(last.hostControl.status,'running');
  last=await command(f,last,'request_controller');assert.equal(last.state,'awaiting_controller');
  last=await command(f,last,'continue','controller-continue');
  last=await command(f,last,'request_user');assert.equal(last.state,'awaiting_user');
  last=await command(f,last,'continue','user-continue');
  assert.equal(f.calls.length,callCount,'controls never execute tools or acknowledge user permission');
  for(let step=0;step<template.nodes.length*5&&last.state!=='settled';step++) {
    const receipts=last.proposals.map(proposal=>{
      f.bridge.submit(f.request,proposal);return f.bridge.readReceipt(f.request,proposal);
    });
    last=await f.engine.advance({...f.request,checkpoint:last.checkpoint,receipts});
  }
  assert.equal(last.state,'settled',JSON.stringify({workflowId:template.workflowId,nodes:last.nodes}));
  assert.equal(last.verification,'unverified','Fake control proof never becomes real business acceptance');
  assert.ok(Object.values(last.nodes).every(node=>node.state==='completed'||node.state==='skipped'));
  assert.equal(new Set(f.calls.map(call=>call.commandId)).size,f.calls.length,'resume does not resubmit an original operation');
  const absent=fixture(template,{missing:true});let unavailable=await absent.engine.advance(absent.request);
  for(let step=0;step<template.nodes.length&&unavailable.state==='progress';step++)unavailable=await absent.engine.advance({...absent.request,checkpoint:unavailable.checkpoint});
  assert.notEqual(unavailable.state,'settled','missing public adapter cannot masquerade as completion');assert.equal(absent.calls.length,0);
});

test('host control rejects forgery/stale checkpoint, remains idempotent, and cannot extend original deadline',async()=>{
  const f=fixture(getOwnedWorkflowTemplate('F20'));const first=await f.engine.advance(f.request);
  const request={...f.request,checkpoint:first.checkpoint},pause=f.bridge.control(request,{commandId:'pause',action:'pause'});
  await assert.rejects(f.engine.advance({...request,hostControl:{...pause,action:'resume'}}),{code:'INVALID_ARGUMENT'});
  const paused=await f.engine.advance({...request,hostControl:pause});
  const repeated=await f.engine.advance({...f.request,checkpoint:paused.checkpoint,hostControl:pause});
  assert.deepEqual(repeated.nodes,paused.nodes);assert.equal(repeated.hostControl.events.length,1);
  const stale=f.bridge.control(request,{commandId:'old-resume',action:'resume'});
  await assert.rejects(f.engine.advance({...f.request,checkpoint:paused.checkpoint,hostControl:stale}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.engine.advance({...f.request,checkpoint:paused.checkpoint,taskDeadline:new Date(Date.parse(f.request.deadline)+1000).toISOString()}),{code:'INVALID_ARGUMENT'});
  const newWindow=await f.engine.advance({...f.request,checkpoint:paused.checkpoint,deadline:new Date(Date.parse(f.request.deadline)+1000).toISOString()});
  assert.equal(newWindow.state,'paused','sliding HTTP windows do not change the fixed task lifetime');
});

test('trusted original task deadline is distinct from each transport window and survives pause',async()=>{
  const f=fixture(getOwnedWorkflowTemplate('F20'));
  const taskDeadline=new Date(Date.now()+120_000).toISOString();
  const first=await f.engine.advance({...f.request,taskDeadline});
  const paused=await command({...f,request:{...f.request,taskDeadline}},first,'pause');
  const resumed=await f.engine.advance({...f.request,taskDeadline,deadline:new Date(Date.now()+90_000).toISOString(),checkpoint:paused.checkpoint});
  assert.equal(resumed.state,'paused');
  await assert.rejects(f.engine.advance({...f.request,taskDeadline:new Date(Date.parse(taskDeadline)+1).toISOString(),checkpoint:paused.checkpoint}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.engine.advance({...f.request,taskDeadline:'invalid'}),{code:'INVALID_ARGUMENT'});
});

test('all/selected joins require actual completed or skipped branches; any requires one completed branch',()=>{
  const node={dependencies:[{nodeId:'a',required:true},{nodeId:'b',required:false}]};
  for(const joinMode of ['all','selected']) {
    assert.equal(workflowJoinReady({...node,joinMode},{a:'completed',b:'pending'}),false);
    assert.equal(workflowJoinReady({...node,joinMode},{a:'completed',b:'unknown'}),false);
    assert.equal(workflowJoinReady({...node,joinMode},{a:'completed',b:'failed'}),false);
    assert.equal(workflowJoinReady({...node,joinMode},{a:'completed',b:'skipped'}),true);
  }
  assert.equal(workflowJoinReady({...node,joinMode:'any'},{a:'completed',b:'pending'}),true);
  assert.equal(workflowJoinReady({...node,joinMode:'any'},{a:'unknown',b:'failed'}),false);
});

test('failed Runtime read returns original error/Evidence; migration never invents a repair or repeats it',async()=>{
  const template=getOwnedWorkflowTemplate('F20'),f=fixture(template,{readRetryAttestation:true});
  let last=await f.engine.advance(f.request);const proposal=last.proposals[0];
  const submitted=f.bridge.submit(f.request,proposal),readback=f.tasks.get(submitted.localTaskId);
  delete readback.confirmed;readback.task.state='failed';
  readback.task.error={code:'EXTERNAL_FAILURE',message:'Original fixture read failure',retryable:false};
  readback.task.evidenceRefs=['original-failure-evidence'];
  const receipt=f.bridge.readReceipt(f.request,proposal);
  assert.deepEqual(receipt.result.failure.error,readback.task.error);
  assert.deepEqual(receipt.evidenceRefs,['original-failure-evidence']);
  last=await f.engine.advance({...f.request,checkpoint:last.checkpoint,receipts:[receipt]});
  assert.equal(last.state,'failed');
  const next={...f.request,controlRevision:2};
  const identity=request=>({taskId:request.taskId,sessionId:request.sessionId,workflowId:request.workflowId,
    templateDigest:template.templateDigest,controlRevision:request.controlRevision,inputDigest:digest(request.input),catalogDigest:digest(request.availableTools)});
  last=await f.engine.advance({...next,checkpoint:last.checkpoint,migration:f.bridge.migration(identity(f.request),identity(next),[proposal.nodeId])});
  assert.equal(last.state,'failed');assert.equal(last.nodes[proposal.nodeId].proposal.operationId,proposal.operationId);
  assert.deepEqual(last.nodes[proposal.nodeId].value.failure.error,readback.task.error);
  assert.match(last.nodes[proposal.nodeId].reason,/Repair algorithm unavailable/);
  assert.equal(f.calls.length,1);assert.deepEqual(last.proposals,[]);
});

test('paused in-flight host operation accepts actual receipt but never emits another operation',async()=>{
  const f=fixture(getOwnedWorkflowTemplate('F20'));let last=await f.engine.advance(f.request);
  const proposal=last.proposals[0];f.bridge.submit(f.request,proposal);
  last=await command(f,last,'pause');
  last=await f.engine.advance({...f.request,checkpoint:last.checkpoint,receipts:[f.bridge.readReceipt(f.request,proposal)]});
  assert.equal(last.state,'paused');assert.equal(last.nodes.F20_N01.state,'completed');
  assert.equal(last.nodes.F20_N02.state,'pending');assert.deepEqual(last.proposals,[]);assert.equal(f.calls.length,1);
});
