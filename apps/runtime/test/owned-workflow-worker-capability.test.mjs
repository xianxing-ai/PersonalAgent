import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeOwnedWorkflowWorkerCapability,OWNED_WORKFLOW_WORKER_TOOL} from '../dist/application/owned-workflow-worker-capability.js';

// Synthetic host ports and fixed case: these tests do not assert production F20 readiness.
const input={schemaFile:'schema.json',codeFile:'api.ts',recipeId:'check-api',docTemplate:'fixed-template',targetDoc:'docs/api.md',sourceVersion:'fixture-v1'};
const deadline=()=>new Date(Date.now()+60000).toISOString();
function setup({result,configured=true,badSource=false}={}) {
  const registered=['workspace.read_text','workspace.run_allowed_command'].map(name=>({descriptor:{name,version:'1.0.0',
    sideEffect:name==='workspace.read_text'?'read':'local_write',requiredScopes:['synthetic:f20'],
    inputSchema:{type:'object',properties:name==='workspace.read_text'?{path:{type:'string'}}:{recipeId:{type:'string'}},
      required:name==='workspace.read_text'?['path']:['recipeId'],additionalProperties:false},outputSchema:{type:'object'},
    idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async args=>
      name==='workspace.read_text'?{path:badSource&&args.path==='api.ts'?'wrong.ts':args.path,content:'synthetic'}:{recipeId:args.recipeId,exitCode:0}}));
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f20',tools:registered,
    automaticTools:[{toolName:'workspace.read_text',toolVersion:'1.0.0'}]});
  const calls=[];
  const options={image:{bindingId:'synthetic-image',receiptSecret:async()=> 'synthetic-receipt-secret-at-least-32-chars',
    advance:async()=>{calls.push('advance');return result;}},
    available:()=>true,resolveInput:async()=>input,assertCurrent:()=>{},assertFrontier:()=>{},authorizeExport:async()=>{},verifyCompletion:async()=>{calls.push('verify');return {additionalSourceTaskIds:[]};}};
  if(!configured)delete options.verifyCompletion;
  const tools={list:()=>registered.map(tool=>tool.descriptor)};
  const capability=createRuntimeOwnedWorkflowWorkerCapability(app,options,()=>tools);
  const task=app.runtime.submitTask({goal:'Synthetic F20',conversationId:'synthetic',idempotencyKey:'synthetic-f20'}),end=deadline();
  app.runtime.saveCheckpoint(task.taskId,'application-deadline',end);
  const proposal={kind:'tool_proposal',proposalId:'synthetic-f20-proposal',toolName:OWNED_WORKFLOW_WORKER_TOOL,toolVersion:'1.0.0',
    arguments:{workflowId:'F20',inputRef:'registered-case'},verification:'unverified'};
  const run=(request=proposal)=>app.runtime.runTask(task.taskId,worker=>capability.dispatch(request,{...worker,revision:0}),{deadline:end,sideEffect:'local_write'});
  return {app,task,proposal,run,calls,capability};
}
test('F20 fails closed when its trusted verifier is unavailable',async()=>{
  const f=setup({configured:false});try{const task=await f.run();
    assert.equal(task.state,'failed');assert.equal(task.error.code,'UNSUPPORTED_CAPABILITY');assert.deepEqual(f.calls,[]);
  }finally{f.app.close();}
});
test('model arguments cannot supply paths, commands, receipts or a different graph',async()=>{
  for(const extra of [{schemaFile:'secret.txt'},{recipeId:'arbitrary'},{receipt:{}},{workflowId:'F21'}]){
    const f=setup();try{const task=await f.run({...f.proposal,arguments:{...f.proposal.arguments,...extra}});
      assert.equal(task.state,'failed');assert.deepEqual(f.calls,[]);
    }finally{f.app.close();}
  }
});
test('image cannot submit a source outside the fixed case',async()=>{
  const f=setup({result:{workflowId:'F20',workflowVersion:'1.0.0',state:'awaiting_host',checkpoint:'synthetic',nodes:{F20_N01:{state:'waiting_receipt'}},
    proposals:[{kind:'tool_proposal',nodeId:'F20_N01',operationId:'synthetic-op',toolName:'workspace.read_text',toolVersion:'1.0.0',
      arguments:{path:'unapproved-secret.txt'}}]}});
  try{const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.deepEqual(f.calls,['advance']);assert.equal(f.app.runtime.listTasks({limit:20}).items.length,3);
  }finally{f.app.close();}
});
test('a settled image cannot submit a command',async()=>{
  const f=setup({result:{workflowId:'F20',workflowVersion:'1.0.0',state:'settled',checkpoint:'synthetic',nodes:{},
    proposals:[{kind:'tool_proposal',nodeId:'F20_N03',operationId:'forged',toolName:'workspace.run_allowed_command',toolVersion:'1.0.0',
      arguments:{recipeId:'check-api'}}]}});
  try{const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'PROTOCOL_MISMATCH');
    assert.equal(f.app.runtime.listTasks({limit:20}).items.length,3);
  }finally{f.app.close();}
});
test('a command frontier without the original N01 graph receipt fails before submit',async()=>{
  const f=setup({result:{workflowId:'F20',workflowVersion:'1.0.0',state:'awaiting_host',checkpoint:'synthetic',
    nodes:{F20_N01:{state:'completed'},F20_N02:{state:'completed'},F20_N03:{state:'waiting_receipt'}},
    proposals:[{kind:'tool_proposal',nodeId:'F20_N03',operationId:'forged',toolName:'workspace.run_allowed_command',toolVersion:'1.0.0',
      arguments:{recipeId:'check-api'}}]}});
  try{const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.match(task.error.message,/predecessor/);assert.equal(f.app.runtime.listTasks({limit:20}).items.length,3);
  }finally{f.app.close();}
});
test('image settled without locally confirmed operations cannot produce a worker receipt',async()=>{
  const nodes=Object.fromEntries(['F20_N01','F20_N02','F20_N03','F20_N04'].map(id=>[id,{state:'completed'}]));
  const f=setup({result:{workflowId:'F20',workflowVersion:'1.0.0',state:'settled',checkpoint:'synthetic',proposals:[],nodes}});
  try{const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.deepEqual(f.calls,['advance']);
  }finally{f.app.close();}
});
test('a changed second-source readback stops before the graph advances',async()=>{
  const f=setup({badSource:true});
  try{const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.match(task.error.message,/source readback is invalid/);assert.deepEqual(f.calls,[]);
  }finally{f.app.close();}
});
