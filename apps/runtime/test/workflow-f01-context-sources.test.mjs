import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeAtomicStatePort} from '../dist/atomic-host-state.js';
import {proactiveWorkflowDigest} from '@personal-agent/agentarts';
import {createF01ResponsibilitySource,createF01ModelGatewaySource} from '../dist/application/workflow-f01-context-sources.js';

// Real Runtime SQLite state; all user goals, model catalog and gateways are Synthetic.
function fixture({asyncGate=false}={}){
  const runtime=new TaskRuntime(':memory:'),deadline=new Date(Date.now()+60_000).toISOString();
  const source=runtime.submitTask({goal:'Synthetic user intent',conversationId:'synthetic-chat',idempotencyKey:'source'});
  const older=runtime.submitTask({goal:'Synthetic old instruction',conversationId:'synthetic-chat',idempotencyKey:'older'});
  const graph=runtime.submitTask({goal:'Synthetic graph worker',conversationId:'synthetic-worker',idempotencyKey:'graph'});
  const proactive=runtime.submitTask({goal:'Synthetic proactive',conversationId:'synthetic-chat',idempotencyKey:'proactive'});
  const sessionId='synthetic-session',contractRef='synthetic-contract';
  runtime.saveCheckpoint(proactive.taskId,'desktop-proactive-workflow-v1',{version:1,taskId:proactive.taskId,sessionId,
    sourceTaskId:older.taskId,taskDeadline:deadline,contractRef});
  const digest=createHash('sha256').update(source.goal).digest('hex');
  const quote={conversationId:source.conversationId,messageId:source.taskId,quoteRef:`runtime:task:${source.taskId}:goal`,sha256:digest};
  const state={version:1,binding:{taskId:proactive.taskId,sessionId,controlRevision:0,taskDeadline:deadline},
    conversationId:'synthetic-chat',contractRef,entries:{},batches:{},schedules:{},requests:{},
    responsibilities:{one:{id:'one',revision:1,authority:'explicit_instruction',sourceQuotes:[quote],goalRefs:[],scopeRefs:[]}}};
  const atomic=createRuntimeAtomicStatePort(runtime,'runtime-proactive-workflows');
  const key='application:'+proactiveWorkflowDigest([proactive.taskId,sessionId]);atomic.compareAndSet(key,undefined,state);
  const selected={catalogRevision:'a'.repeat(64),modelId:'synthetic-model',reasoningEffort:'low'};
  runtime.saveCheckpoint(graph.taskId,'execution-model',selected);
  const app={runtime,readDelegatedUserTaskParent:id=>id===graph.taskId?{taskId:source.taskId,conversationId:'synthetic-chat',deadline}:undefined};
  const scope={parentTaskId:graph.taskId,localTaskId:'synthetic-host',operationId:'synthetic-op',sessionId:'synthetic-f01',
    deadline,signal:new AbortController().signal};
  let responsibilityAllowed=true,configuration='synthetic-config',selectedCurrent=selected,endpoint='original';
  const responsibility=createF01ResponsibilitySource({application:app,resolveOriginalSession:()=>({taskId:proactive.taskId,sessionId}),
    resolveUserConversation:id=>[source.taskId,older.taskId].includes(id)?'synthetic-chat':undefined,
    verifyCurrentResponsibility:()=>responsibilityAllowed,assertCurrent:()=>asyncGate?Promise.resolve():undefined});
  const model=createF01ModelGatewaySource({application:app,resolveExecutionModel:()=>selectedCurrent,
    readModelConfiguration:()=>({configurationRef:configuration}),getModelGateway:()=>({deployment:{verification:'conditional',endpoint,
      credentials:'synthetic-secret-must-not-export',capabilities:{text:true,streaming:false,toolCalling:false,structuredOutput:true,vision:false}}}),
    verifyOriginalGateway:(_scope,_selection,_configurationRef,deployment)=>deployment.endpoint==='original',
    assertCurrent:()=>asyncGate?Promise.resolve():undefined});
  return {app,runtime,source,older,scope,responsibility,model,atomic,key,state,deny:()=>{responsibilityAllowed=false;},
    changeModel:()=>{selectedCurrent={...selected,catalogRevision:'b'.repeat(64)};},changeConfiguration:()=>{configuration='changed';},
    changeEndpoint:()=>{endpoint='another';}};
}
test('F01 reads real persisted responsibility provenance without exporting scopes or source text',async()=>{
  const f=fixture();try{
    const result=await f.responsibility(f.scope);assert.equal(result.items.length,1);
    assert.equal(result.items[0].sourceQuotes[0].messageId,f.source.taskId);
    assert.equal(JSON.stringify(result).includes('Synthetic user intent'),false);
    assert.equal(JSON.stringify(result).includes('scopeRefs'),false);
    f.deny();await assert.rejects(f.responsibility(f.scope),{code:'UNSUPPORTED_CAPABILITY'});
  }finally{f.runtime.close();}
});
test('F01 responsibility rejects a changed quote or erased source',async()=>{
  const f=fixture();try{
    const current=f.atomic.read(f.key),changed=structuredClone(f.state);changed.responsibilities.one.sourceQuotes[0].sha256='b'.repeat(64);
    assert.equal(f.atomic.compareAndSet(f.key,current.revision,changed),true);
    await assert.rejects(f.responsibility(f.scope),{code:'REVISION_CONFLICT'});
  }finally{f.runtime.close();}
  const g=fixture();try{
    g.runtime.saveCheckpoint(g.source.taskId,'private-copy-erasure',{state:'withheld'});
    await assert.rejects(g.responsibility(g.scope),{code:'UNAUTHORIZED'});
  }finally{g.runtime.close();}
  const h=fixture();try{
    h.runtime.saveCheckpoint(h.older.taskId,'private-copy-erasure-binding',{state:'withheld'});
    await assert.rejects(h.responsibility(h.scope),{code:'UNAUTHORIZED'});
  }finally{h.runtime.close();}
});
test('F01 model source preserves conditional gateway declarations and rejects stale catalog',async()=>{
  const f=fixture();try{
    const result=await f.model(f.scope);assert.equal(result.models[0].verification,'conditional');
    assert.equal(result.models[0].capabilities.structuredOutput,true);
    assert.equal(JSON.stringify(result).includes('synthetic-secret-must-not-export'),false);
    f.changeModel();await assert.rejects(f.model(f.scope),{code:'REVISION_CONFLICT'});
  }finally{f.runtime.close();}
});
test('F01 does not equate the same model ID on a different gateway endpoint',async()=>{
  const f=fixture();try{
    const missing=createF01ModelGatewaySource({application:f.app,resolveExecutionModel:()=>undefined,
      readModelConfiguration:()=>undefined,getModelGateway:()=>undefined,assertCurrent:()=>{}});
    await assert.rejects(missing(f.scope),{code:'UNSUPPORTED_CAPABILITY'});
    f.changeEndpoint();await assert.rejects(f.model(f.scope),{code:'UNSUPPORTED_CAPABILITY'});
  }finally{f.runtime.close();}
});
test('F01 sources reject asynchronous authorization gates before returning any snapshot',async()=>{
  const f=fixture({asyncGate:true});try{
    await assert.rejects(f.responsibility(f.scope),{code:'UNAUTHORIZED'});
    await assert.rejects(f.model(f.scope),{code:'UNAUTHORIZED'});
  }finally{f.runtime.close();}
});
