import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,createRuntimeConfiguredWorkflowCapability,runtimeConfiguredWorkflowConfigured,
  readConfiguredWorkflowBinding} from '../dist/application.js';

// Synthetic F13 probe/image/completion ports. This exercises the actual Runtime,
// Policy and HostBridge, and does not assert OS, cloud, quota or recovery acceptance.
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function setup({override={},image,unknown=false}={}) {
  const calls=[],exports=[],advances=[];
  const tool={descriptor:{name:'computer.system.observe',version:'1.0.0',inputSchema:schema({}),outputSchema:schema({observed:{type:'boolean'}}),
    sideEffect:'read',requiredScopes:['synthetic:probe'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    execute:async()=>{calls.push('probe');if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic original result unknown');return {observed:true};}};
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-configured-graph',tools:[tool],
    automaticTools:[{toolName:tool.descriptor.name,toolVersion:'1.0.0'}]});
  const options={workflowId:'F13',toolName:'workflow.system.diagnose',toolVersion:'1.0.0',configurationVersion:'synthetic-v1',
    requestSchema:schema({inputRef:{const:'synthetic-case'}}),inputSchema:schema({taskId:{const:'synthetic-target'}}),
    resultSchema:schema({diagnosed:{type:'boolean'}}),publicEnumPaths:['/inputRef'],requiredTools:[{name:tool.descriptor.name,version:'1.0.0'}],sideEffect:'read',
    image:{bindingId:'synthetic-image',receiptSecret:async()=> 'synthetic-secret-at-least-32-characters',advance:async request=>{
      advances.push(request);if(image)return image(request);
      return {workflowId:'F13',workflowVersion:'1.0.0',checkpoint:'synthetic-checkpoint-'+advances.length,
        state:request.receipts.length?'settled':'awaiting_host',nodes:{F13_N02:{state:request.receipts.length?'completed':'waiting_receipt'}},
        proposals:request.receipts.length?[]:[{kind:'tool_proposal',nodeId:'F13_N02',operationId:'synthetic-probe',
          proposalId:'synthetic-probe',originControlRevision:0,inputDigest:hash({}),toolSchemaDigest:hash(tool.descriptor.inputSchema),
          toolName:tool.descriptor.name,toolVersion:'1.0.0',arguments:{},resourceKeys:[],effect:'read'}]};}},
    available:()=>true,resolveInput:async()=>({taskId:'synthetic-target'}),assertCurrent:()=>{},assertFrontier:async()=>true,
    authorizeExport:async input=>{exports.push(input);return true;},
    verifyCompletion:async({readbacks})=>{assert.equal(readbacks.length,1);assert.deepEqual(readbacks[0].confirmed.result,{observed:true});
      return {result:{diagnosed:true},resultSummary:'Synthetic probe confirmed'};},...override};
  const capability=createRuntimeConfiguredWorkflowCapability(app,options,()=>({list:()=>[tool.descriptor]}));
  const task=app.runtime.submitTask({goal:'Synthetic configured graph',conversationId:'synthetic',idempotencyKey:'configured-probe'});
  const deadline=new Date(Date.now()+60000).toISOString();app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
  const proposal={kind:'tool_proposal',proposalId:'synthetic-proposal',toolName:options.toolName,toolVersion:'1.0.0',arguments:{inputRef:'synthetic-case'},verification:'unverified'};
  let returned;
  const run=(request=proposal)=>app.runtime.runTask(task.taskId,async context=>{
    returned=await capability.dispatch(request,{...context,revision:0});
    if(returned.state==='confirmed')capability.assertReceiptAllowed(request,returned.selection,returned.result,{...context,revision:0});
    return {resultSummary:returned.state,evidenceRefs:returned.evidenceRefs};
  },{deadline,sideEffect:'read'});
  return {app,task,proposal,run,calls,exports,advances,options,capability,tool,get returned(){return returned;}};
}

test('configured graph completes only with original local readback and exact export grants',async()=>{
  const f=setup();try{const result=await f.run();assert.equal(result.state,'succeeded',JSON.stringify(result.error));
    assert.deepEqual(f.calls,['probe']);assert.deepEqual(f.returned.result,{diagnosed:true});assert.ok(f.returned.evidenceRefs.length);
    assert.deepEqual(f.exports.map(item=>item.stage),['initial','receipt','completion']);assert.equal(f.advances.length,2);
    assert.equal(f.app.runtime.readToolExecutions(f.app.runtime.listTasks({limit:20}).items.find(task=>task.taskId!==f.task.taskId&&task.state==='succeeded').taskId)[0].policyDecision,'allow');
  }finally{f.app.close();}
});

test('missing verifier and reserved dedicated graphs cannot be configured',()=>{
  const f=setup();try{
    for(const key of ['assertFrontier','verifyCompletion','resolveInput','authorizeExport','available','assertCurrent'])
      assert.equal(runtimeConfiguredWorkflowConfigured({...f.options,[key]:undefined}),false,key);
    for(const workflowId of ['F09','F15','F20','F99'])assert.equal(runtimeConfiguredWorkflowConfigured({...f.options,workflowId}),false);
    assert.equal(runtimeConfiguredWorkflowConfigured({...f.options,requestSchema:{type:'object'}}),false);
    assert.equal(runtimeConfiguredWorkflowConfigured({...f.options,toolName:'workflow.image.execute'}),false);
  }finally{f.app.close();}
});

test('model cannot change the fixed graph, input source or tool directory',async()=>{
  for(const extra of [{workflowId:'F14'},{inputRef:'unregistered'},{requiredTools:[]},{path:'private.txt'}]){
    const f=setup();try{const result=await f.run({...f.proposal,arguments:{...f.proposal.arguments,...extra}});
      assert.equal(result.state,'failed');assert.deepEqual(f.calls,[]);assert.deepEqual(f.advances,[]);
    }finally{f.app.close();}
  }
});

test('only literal true availability, frontier and export decisions permit execution',async()=>{
  for(const override of [{available:()=>false},{available:()=>({allowed:true})},{authorizeExport:async()=>false},
    {assertFrontier:async()=>false},{assertFrontier:async()=>undefined}]){
    const f=setup({override});try{const result=await f.run();assert.equal(result.state,'failed');assert.deepEqual(f.calls,[]);
    }finally{f.app.close();}
  }
});

test('untrusted settled status cannot bypass local completion evidence',async()=>{
  let verified=0;const f=setup({image:()=>({workflowId:'F13',workflowVersion:'1.0.0',checkpoint:'forged',state:'settled',proposals:[],nodes:{}}),
    override:{verifyCompletion:async()=>{verified++;return {result:{diagnosed:true},resultSummary:'forged'};}}});
  try{const result=await f.run();assert.equal(result.state,'failed');assert.equal(result.error.code,'UNAUTHORIZED');assert.equal(verified,0);
  }finally{f.app.close();}
});

test('foreign node cannot submit a tool even when a trusted test frontier returns true',async()=>{
  const f=setup({image:()=>({workflowId:'F13',workflowVersion:'1.0.0',checkpoint:'forged',state:'awaiting_host',nodes:{F14_N01:{state:'waiting_receipt'}},
    proposals:[{kind:'tool_proposal',nodeId:'F14_N01',operationId:'forged',toolName:'computer.system.observe',toolVersion:'1.0.0',arguments:{}}]})});
  try{const result=await f.run();assert.equal(result.state,'failed');assert.equal(result.error.code,'UNAUTHORIZED');assert.deepEqual(f.calls,[]);
  }finally{f.app.close();}
});

test('unknown local result stays on the original child without completion or replay',async()=>{
  const f=setup({unknown:true});try{const result=await f.run();assert.equal(result.state,'waiting_reconciliation');
    assert.deepEqual(f.calls,['probe']);assert.equal(f.advances.length,1);assert.equal(f.returned.state,'unknown');
    assert.deepEqual(f.exports.map(item=>item.stage),['initial']);
  }finally{f.app.close();}
});

test('a changed result cannot reuse the original verified receipt',async()=>{
  const f=setup();try{await f.run();
    const records=f.app.runtime.listTasks({limit:20}).items;assert.ok(records.length>1);
    // Receipt tampering cannot supply a new result for the old verified operation.
    assert.throws(()=>f.capability.assertReceiptAllowed(f.proposal,f.returned.selection,{diagnosed:false},{taskId:f.task.taskId,
      deadline:f.app.runtime.loadCheckpoint(f.task.taskId,'application-deadline'),signal:new AbortController().signal,revision:0,
      loadCheckpoint:key=>f.app.runtime.loadCheckpoint(f.task.taskId,key)}),{code:'UNAUTHORIZED'});
  }finally{f.app.close();}
});

for(const [configured,unknown] of [[true,false],[false,false],[true,true]])test(`actual delegated worker ${!configured?'omits incomplete configuration':unknown?'retains unknown original child':'resumes original approval and confirms'}`,async()=>{
  const f=setup({unknown});f.app.close();let app;const cloud=[];
  const tools=[f.tool,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scoped)=>app.runDefaultSubagentWorker(subtask,worker,scoped)})];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-configured-worker',
    coordinationBinding:'synthetic-deployment',tools,configuredWorkflowWorkers:[{...f.options,verifyCompletion:configured?async input=>{
      const scope={taskId:input.taskId,workflowId:'F13',sessionId:input.state.sessionId,signal:input.signal};
      const original=readConfiguredWorkflowBinding(app,scope);assert.deepEqual(original.input,{taskId:'synthetic-target'});
      assert.equal(original.configurationVersion,'synthetic-v1');assert.equal(original.deadline,input.deadline);
      assert.equal(original.confirmedOperations.length,1);assert.equal(original.confirmedOperations[0].nodeId,'F13_N02');
      assert.equal(original.confirmedOperations[0].readback.task.state,'succeeded');
      assert.ok(Object.isFrozen(original));assert.ok(Object.isFrozen(original.confirmedOperations[0].readback));
      assert.throws(()=>{original.input.taskId='replaced';},TypeError);
      assert.equal(readConfiguredWorkflowBinding(app,{...scope,workflowId:'F07'}),undefined);
      assert.equal(readConfiguredWorkflowBinding(app,{...scope,sessionId:'foreign-session'}),undefined);
      const aborted=new AbortController();aborted.abort();assert.throws(()=>readConfiguredWorkflowBinding(app,{...scope,signal:aborted.signal}),{code:'CANCELLED'});
      const loop=app.runtime.loadCheckpoint(scope.taskId,'competition-loop');
      const namespace='owned-workflow:configured:'+hash([f.options.toolName,loop.pending.proposalId]);
      const bindingKey=namespace+':binding',graphKey=namespace+':graph';
      const binding=app.runtime.loadCheckpoint(scope.taskId,bindingKey),graph=app.runtime.loadCheckpoint(scope.taskId,graphKey);
      for(const changed of [{...binding,configurationVersion:'changed'}, {...binding,descriptors:[]}]){
        app.runtime.saveCheckpoint(scope.taskId,bindingKey,changed);
        assert.throws(()=>readConfiguredWorkflowBinding(app,scope),{code:'REVISION_CONFLICT'});
        app.runtime.saveCheckpoint(scope.taskId,bindingKey,binding);
      }
      app.runtime.saveCheckpoint(scope.taskId,graphKey,{...graph,input:{taskId:'replaced'}});
      assert.throws(()=>readConfiguredWorkflowBinding(app,scope),{code:'REVISION_CONFLICT'});
      app.runtime.saveCheckpoint(scope.taskId,graphKey,graph);
      const operation=original.confirmedOperations[0],parentKey='coding-repair:parent';
      const parent=app.runtime.loadCheckpoint(operation.localTaskId,parentKey);
      app.runtime.saveCheckpoint(operation.localTaskId,parentKey,{...parent,taskId:'foreign-parent'});
      assert.throws(()=>readConfiguredWorkflowBinding(app,scope),{code:'UNAUTHORIZED'});
      app.runtime.saveCheckpoint(operation.localTaskId,parentKey,parent);
      app.runtime.saveCheckpoint(scope.taskId,'competition-loop',{...loop,pending:{...loop.pending,proposalId:'different-proposal'}});
      assert.equal(readConfiguredWorkflowBinding(app,scope),undefined);
      app.runtime.saveCheckpoint(scope.taskId,'competition-loop',loop);
      assert.deepEqual(readConfiguredWorkflowBinding(app,scope),original);
      return f.options.verifyCompletion(input);
    }:undefined}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='synthetic-chat'||request.continuation)
        return {kind:'text',text:'Synthetic configured continuation',verification:'unverified'};
      return f.proposal;}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  try{
    const client=new Client(app);await client.connect();const root=await client.call('task.submit',
      {goal:'Synthetic fixed graph probe',conversationId:'synthetic-chat'},{idempotencyKey:'synthetic-fixed-graph',timeoutMs:60000});
    let child,approvals=0;
    for(let attempt=0;attempt<600;attempt++){
      const tasks=[app.runtime.getTask(root.taskId),...app.readSubagentTasks(root.taskId)];
      for(const task of [...tasks]){const host=app.readPendingOwnedWorkflowHostTask(task.taskId);if(host)tasks.push(host);}
      for(const task of tasks)for(const approval of app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
        approvals++;await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      [child]=app.readSubagentTasks(root.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.ok(child);assert.equal(child.state,!configured?'failed':unknown?'waiting_reconciliation':'succeeded',JSON.stringify(child.error));
    const requests=cloud.filter(request=>request.taskId===child.taskId);
    assert.equal(requests.some(request=>request.availableTools?.some(tool=>tool.name===f.options.toolName)),configured);
    if(unknown){const original=app.readPendingOwnedWorkflowHostTask(child.taskId);assert.ok(original);
      assert.throws(()=>app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});
      assert.equal(app.readPendingOwnedWorkflowHostTask(child.taskId).taskId,original.taskId);assert.deepEqual(f.calls,['probe']);
    }else if(configured){assert.ok(approvals>0);assert.deepEqual(f.calls,['probe']);
      assert.ok(requests.some(request=>request.continuation?.result?.diagnosed===true));
    }else assert.deepEqual(f.calls,[]);
  }finally{app.close();}
});
