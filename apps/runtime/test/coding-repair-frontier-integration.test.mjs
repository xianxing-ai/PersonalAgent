import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';
import {runRuntimeCodingRepairWorkflow} from '../dist/application/coding-repair-application.js';

// Real Engine, Runtime, Policy, Gateway and HostBridge; all models/files/tools below are Synthetic.
test('F15 real Engine preserves original receipts through preview and stops before unreviewed patch',async()=>{
  const source='synthetic source\n',sha=createHash('sha256').update(source).digest('hex'),secret='synthetic-receipt-secret-at-least-32-chars';
  const snapshot={snapshotId:'before',packages:[{id:'pkg',path:'',dependencies:[]}],files:[{path:'app.js',sha256:sha,packageId:'pkg',kind:'source'}]};
  const patch={path:'app.js',expectedSha256:sha,edits:[{oldText:'synthetic',newText:'replacement'}]},calls=[];
  const tool=(name,sideEffect,properties,required,execute)=>({descriptor:{name,version:'1.0.0',sideEffect,requiredScopes:['synthetic:f15'],
    inputSchema:{type:'object',properties,required,additionalProperties:false},outputSchema:{type:'object'},idempotencySupport:false,
    recoverySupport:false,requiresPresence:false},execute:async(args,context)=>{calls.push(name);return execute(args,context);}});
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[tool('coding.repair.start','local_write',{mode:{enum:['main','isolated']},allowedPaths:{type:'array',items:{type:'string'}}},['mode'],
    (args,context)=>({version:1,session:{version:1,sessionId:'synthetic-session',taskId:context.taskId,workspaceId:'synthetic-workspace',
      mode:args.mode,baselineSnapshotId:'before'},initialSnapshot:snapshot,recipes:[{recipeId:'test',packageIds:['pkg'],required:true}]})),
  tool('workspace.coding_snapshot','read',{sessionId:{type:'string'}},['sessionId'],()=>snapshot),
  tool('coding.repair.read','read',{sessionId:{type:'string'},path:{type:'string'}},['sessionId','path'],()=>({path:'app.js',sha256:sha,content:source})),
  tool('workflow.host.f15_n04','read',{sessionId:{type:'string'},patches:{type:'array',items:{type:'object'}}},['sessionId','patches'],
    ()=>({sessionId:'synthetic-session',approved:true,previewed:true,patches:[{path:'app.js',beforeSha256:sha,afterSha256:'a'.repeat(64),changed:true}]})),
  tool('workflow.host.f15_n05','local_write',{sessionId:{type:'string'},patches:{type:'array',items:{type:'object'}},recipeIds:{type:'array',items:{type:'string'}}},
    ['sessionId','patches','recipeIds'],()=>{throw Error('unreviewed check must never execute');}),decision];
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-engine-checkpoint-secret-32-chars',
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>{
      const id=context.node.id,coding=context.codingRepair,sessionId='synthetic-session';let value;
      if(id==='F15_N01')value={toolName:'workspace.coding_snapshot',toolVersion:'1.0.0',arguments:{sessionId}};
      else if(id==='F15_N02')value={scope:['app.js']};
      else if(id==='F15_N03'&&coding.readPath)value={toolName:'coding.repair.read',toolVersion:'1.0.0',arguments:{sessionId,path:coding.readPath}};
      else if(id==='F15_N03')value={diagnosis:'Synthetic repair',patches:[patch]};
      else if(id==='F15_N04')value={arguments:{sessionId,patches:[patch]}};
      else value={arguments:{sessionId,patches:[patch],recipeIds:['test']}};
      return [{id:'supported',description:'Synthetic fixed candidate',value},{id:'review',description:'Synthetic abstention',value:null,abstain:true}];
    }});
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-frontier',tools,
    automaticTools:tools.filter(tool=>tool.descriptor.sideEffect==='read').map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0'}))});
  const client=new Client(app);await client.connect();const deadline=new Date(Date.now()+60000).toISOString();
  const task=app.runtime.submitTask({goal:'Synthetic F15 frontier',conversationId:'synthetic',idempotencyKey:'synthetic-frontier'});
  app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
  const subtask={subtaskId:'repair',role:'coder',goal:'Synthetic repair'},request={version:1,mode:'main',subtasks:[subtask]};
  const options={image:{bindingId:'synthetic-image',advance:request=>engine.advance(request),receiptSecret:async()=>secret},
    authorizeMetadata:()=>undefined,projectSource:async input=>input.receipt.result};
  try {
    let current;
    for(let attempt=0;attempt<20;attempt++) {
      current=await app.runtime.runTask(task.taskId,worker=>runRuntimeCodingRepairWorkflow(app,subtask,worker,app.tools,options,request),
        {deadline,sideEffect:'local_write',resume:attempt>0});
      if(current.state!=='waiting_approval')break;
      const graph=app.runtime.loadCheckpoint(task.taskId,'coding-repair:graph');
      const target=graph.waiting?.localTaskId??task.taskId;
      for(const approval of app.runtime.listApprovals({taskId:target,state:'pending'}).items)
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      if(graph.waiting)await app.waitForHostToolTask(target);
    }
    assert.equal(current.state,'failed',JSON.stringify(current.error));
    assert.equal(current.error.code,'UNSUPPORTED_CAPABILITY');assert.match(current.error.message,/independent redline/);
    assert.ok(calls.includes('workspace.coding_snapshot'));assert.ok(calls.includes('coding.repair.read'));
    assert.ok(calls.includes('workflow.host.f15_n04'));assert.equal(calls.includes('workflow.host.f15_n05'),false);
  }finally{app.close();}
});
