import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication} from '../dist/application.js';
import {ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';

function fixture(mapped=true) {
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',proactiveWorkflows:true});
  const runtime=app.runtime,deadline=new Date(Date.now()+60_000).toISOString(),signal=new AbortController().signal;
  const create=(id,conversationId)=>runtime.submitTask({goal:'Synthetic public user instruction '+id,conversationId,idempotencyKey:id});
  const original=create('workflow','desktop-subtask:old-user-task'),source=create('current-user-command','desktop-subtask:new-user-task'),foreign=create('foreign','desktop-subtask:foreign');
  const known=new Set([original.taskId,source.taskId]);
  const proofs=createProactiveHostProofs('synthetic-public-signing-key-at-least-32');
  const contract={id:'synthetic-core',version:'1',criteria:'Synthetic source provenance only',qualifiedForMain:false,batchIndependent:true,
    candidates:[{id:'defer',description:'Defer',action:'defer'},{id:'continue',description:'Continue',action:'continue'}]};
  const engine=new ProactiveWorkflowEngine({checkpointSecret:'synthetic-public-checkpoint-key-at-least-32',decisionContracts:[contract],
    verifyEvent:async(value,binding)=>proofs.verify('event',value,binding),
    verifyResponsibility:async(value,binding)=>proofs.verify('responsibility',value,binding),
    verifyReceipt:async(value,_proposal,binding)=>proofs.verify('receipt',value,binding),
    verifyControl:async(value,binding)=>proofs.verify('control',value,binding)});
  const verified=[];
  const host=app.createProactiveWorkflowHost({taskId:original.taskId,sessionId:'synthetic-session',taskDeadline:deadline,
    contractRef:contract.id,localDeviceAvailable:()=>true,
    advancePort:async input=>proofs.sign('advance_result',{requestId:input.requestId,...await engine.advance(input)},input),
    verifyAdvance:async(result,input)=>result.requestId===input.requestId&&proofs.verify('advance_result',result,input),
    sign:(kind,value,binding)=>proofs.sign(kind,value,binding),
    ...(mapped?{resolveUserConversation:id=>known.has(id)?'desktop-panel:known-ui':undefined}:{}),
    verifyControlCommand:async(command,actual)=>{verified.push(actual);return command.sourceTaskId===actual.taskId;}});
  return {app,runtime,host,original,source,foreign,deadline,signal,verified};
}

test('Synthetic trusted provenance permits next delegated turn while retaining actual quote and control task identity',async()=>{
  const f=fixture();try {
    const context={deadline:f.deadline,signal:f.signal};
    f.host.ingestUserInstruction({sourceTaskId:f.source.taskId},context);
    const entry=Object.values(f.host.inspect().application.state.entries)[0];
    assert.equal(entry.payload.quote.messageId,f.source.taskId);
    assert.equal(entry.payload.quote.conversationId,f.source.conversationId);
    assert.equal(entry.event.entityRef,f.source.taskId);
    const result=await f.host.control({commandId:'synthetic-return',action:'return',expectedControlRevision:0,sourceTaskId:f.source.taskId},context);
    assert.equal(result.returnSummary.replayedNotifications,0);
    assert.equal(f.host.binding.controlRevision,1);
    assert.equal(f.verified[0].taskId,f.source.taskId);
    assert.notEqual(f.verified[0].conversationId,f.original.conversationId);
    await assert.rejects(f.host.control({commandId:'foreign',action:'cancel',expectedControlRevision:1,sourceTaskId:f.foreign.taskId},context),/another conversation/);
    await assert.rejects(f.host.control({commandId:'expired',action:'pause',expectedControlRevision:1,sourceTaskId:f.source.taskId},
      {...context,deadline:'2020-01-01T00:00:00.000Z'}),/expired/);
    f.runtime.requestCancel(f.original.taskId,'Synthetic cancellation');
    await assert.rejects(f.host.control({commandId:'cancelled',action:'pause',expectedControlRevision:1,sourceTaskId:f.source.taskId},context),/no longer active/);
  }finally{f.app.close();}
});

test('Synthetic absent provenance preserves original strict conversation boundary',()=>{
  const f=fixture(false);try {
    assert.throws(()=>f.host.ingestUserInstruction({sourceTaskId:f.source.taskId},{deadline:f.deadline,signal:f.signal}),/another conversation/);
  }finally{f.app.close();}
});
