import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,F09_WORKFLOW_WORKER_TOOL} from '../dist/application.js';
import {createF09FeedGraphHost} from '../../desktop/electron/f09-feed-graph-host.js';

// Synthetic source and image; original TaskRuntime, Policy, Gateway and Desktop F09 adapter are real.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture({sourceAllowed=true,configured=true,realEngine=false}={}) {
  let app,authorized=false;const calls=[],exports=[],cloud=[],advances=[],predecessors=[];
  const collect={descriptor:{name:'feeds.collect',version:'1.0.0',sideEffect:'read',requiredScopes:['feeds:read'],
    inputSchema:{type:'object',additionalProperties:false,required:['subscriptionId'],properties:{subscriptionId:{type:'string'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['items','hasMore','nextCursor'],properties:{
      items:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'}}}},
      hasMore:{type:'boolean'},nextCursor:{type:'string'}}},idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async args=>{calls.push(['collect',args]);return {items:[{id:'synthetic-a'},{id:'synthetic-a'}],hasMore:false,nextCursor:''};}};
  const graph=createF09FeedGraphHost({getApplication:()=>app,collectTool:collect,assertFeedAccess:()=>authorized});
  const tools=[collect,...graph.tools];
  tools.unshift(createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scoped)=>app.runDefaultSubagentWorker(subtask,worker,scoped)}));
  const secret='synthetic-receipt-secret-at-least-32-chars';
  const engine=realEngine?new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-engine-checkpoint-secret-32-chars',
    selector:{select:async()=> 'supported'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let value;if(context.node.id==='F09_N01')value={toolName:'feeds.collect',toolVersion:'1.0.0',arguments:{subscriptionId:'synthetic-feed'}};
      else if(context.node.id==='F09_N02'){
        predecessors.push(context.predecessorOperations?.F09_N01);
        value={arguments:{sourceOperationId:context.predecessorOperations?.F09_N01?.operationId}};
      }else value={highValueSignal:'synthetic',discardedJunk:[],forwardToFeature:'F10'};
      return [{id:'supported',description:'Synthetic candidate',value},{id:'review',description:'Synthetic abstention',value:null,abstain:true}];
    }}):undefined;
  const options={image:{bindingId:'synthetic-f09-image',receiptSecret:async()=>secret,advance:async request=>{
    advances.push(request.requestId);if(engine)return engine.advance(request);
    const phase=request.checkpoint?Number(request.checkpoint):0;
    if(phase===2)return {workflowId:'F09',workflowVersion:'1.0.0',state:'unavailable',checkpoint:'3',proposals:[],
      nodes:{F09_N04:{state:'unavailable'}},unavailable:[{nodeId:'F09_N04',capabilities:[],reason:'synthetic'}]};
    const name=phase===0?'feeds.collect':'workflow.host.f09_n02',nodeId=phase===0?'F09_N01':'F09_N02';
    const args=phase===0?{subscriptionId:'synthetic-feed'}:{sourceOperationId:request.receipts[0].operationId};
    const descriptor=request.availableTools.find(tool=>tool.name===name),operationId=`synthetic-f09-${request.taskId}-${phase}`;
    return {workflowId:'F09',workflowVersion:'1.0.0',state:'awaiting_host',checkpoint:String(phase+1),
      nodes:{[nodeId]:{state:'waiting_receipt'}},unavailable:[],proposals:[{kind:'tool_proposal',nodeId,operationId,
        proposalId:operationId,inputDigest:hash(args),originControlRevision:0,toolName:name,toolVersion:'1.0.0',
        toolSchemaDigest:hash(descriptor.inputSchema),arguments:args,resourceKeys:[],effect:'read'}]};}},
    available:()=>true,resolveInput:async()=>({subscriptionId:'synthetic-feed'}),assertCurrent:()=>{},
    authorizeInput:async()=>true,assertFrontier:()=>true,
    authorizeSource:async value=>{exports.push(['source',value.sourceOperationId]);authorized=sourceAllowed;return sourceAllowed;},
    authorizeReceipt:async value=>{exports.push(['receipt',value.proposal.nodeId]);return true;}};
  if(!configured)delete options.authorizeSource;
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f09-owner',
    coordinationBinding:'synthetic-deployment',tools,f09WorkflowWorker:options,
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='user-chat')return {kind:'text',text:'Synthetic parent',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'synthetic-f09',toolName:F09_WORKFLOW_WORKER_TOOL,toolVersion:'1.0.0',
        arguments:{workflowId:'F09',inputRef:'synthetic-case'},verification:'unverified'};}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  return {app,calls,exports,cloud,advances,predecessors};
}
async function drive(f,client,root){
  for(let n=0;n<600;n++){
    const tasks=[f.app.runtime.getTask(root),...f.app.readSubagentTasks(root)];
    for(const task of [...tasks]){const host=f.app.readPendingOwnedWorkflowHostTask(task.taskId);if(host)tasks.push(host);}
    for(const task of tasks)for(const approval of f.app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    const [child]=f.app.readSubagentTasks(root);
    if(child&&f.app.activeTaskCount===0&&['failed','succeeded','cancelled','waiting_reconciliation'].includes(child.state))return child;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic F09 did not settle: '+JSON.stringify(f.app.runtime.listTasks({limit:30}).items));
}
async function submit(f){const client=new Client(f.app);await client.connect();const task=await client.call('task.submit',
  {goal:'Read synthetic feed',conversationId:'user-chat'},{idempotencyKey:'synthetic-f09-runtime',timeoutMs:60000});return {client,task};}
test('F09 original feed and dedup receipts advance before unavailable F10 enqueue',async()=>{
  const f=fixture(),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'failed');assert.equal(child.error.code,'UNSUPPORTED_CAPABILITY');
    assert.match(child.error.message,/F09_N04/);assert.equal(f.calls.length,1);assert.equal(f.advances.length,3);
    assert.deepEqual(f.exports.map(item=>item[0]),['source','receipt','receipt']);
    assert.ok(f.cloud.some(request=>request.taskId===child.taskId&&request.availableTools?.some(tool=>tool.name===F09_WORKFLOW_WORKER_TOOL)));
    const hostTasks=f.app.runtime.listTasks({limit:30}).items.filter(item=>item.conversationId?.startsWith('host-tool:'));
    assert.equal(hostTasks.length,2);assert.ok(hostTasks.every(item=>item.state==='succeeded'));
  }finally{f.app.close();}
});
test('denied exact source export does not advance or run dedup',async()=>{
  const f=fixture({sourceAllowed:false}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'failed');assert.equal(child.error.code,'UNAUTHORIZED');
    assert.equal(f.calls.length,1);assert.equal(f.advances.length,1);assert.deepEqual(f.exports.map(item=>item[0]),['source']);
  }finally{f.app.close();}
});
test('missing exact feed authorization provider does not publish F09 worker',async()=>{
  const f=fixture({configured:false}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'failed');assert.equal(f.calls.length,0);assert.equal(f.advances.length,0);
    assert.ok(f.cloud.filter(request=>request.taskId===child.taskId).every(request=>!request.availableTools?.some(tool=>tool.name===F09_WORKFLOW_WORKER_TOOL)));
  }finally{f.app.close();}
});
test('real Engine passes the confirmed N01 operation to N02 before unavailable F10',async()=>{
  const f=fixture({realEngine:true}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'failed');assert.equal(child.error.code,'UNSUPPORTED_CAPABILITY');
    assert.match(child.error.message,/F09_N04/);assert.equal(f.calls.length,1);
    const source=f.exports.find(item=>item[0]==='source');assert.ok(source);
    assert.ok(f.predecessors.some(value=>value?.operationId===source[1]&&value.toolName==='feeds.collect'&&value.toolVersion==='1.0.0'));
    assert.deepEqual(f.exports.map(item=>item[0]),['source','receipt','receipt']);
  }finally{f.app.close();}
});
