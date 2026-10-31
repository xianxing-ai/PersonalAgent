import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';
import {runRuntimeOwnedWorkflowDriver} from '../dist/application/owned-workflow-driver.js';

// Synthetic API-documentation data/candidates/tools only. The real existing F20
// template, Engine, SQLite TaskRuntime, Policy, Gateway and signed HostBridge run.
// No MOD-37 production adapter, model, command, source file or graph entry is added.
const KEY='synthetic-owned-graph',secret='synthetic-receipt-secret-at-least-32-chars';
function fixture({path=':memory:',unknown=false,waitCommand=false}={}){
  let app;const calls=[],advances=[],exports=[];
  const tool=(name,sideEffect,inputSchema,execute)=>({descriptor:{name,version:'1.0.0',sideEffect,inputSchema,outputSchema:{type:'object'},
    requiredScopes:['synthetic:graph'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async(args,context)=>{calls.push({name,args,taskId:context.taskId,runId:context.runId});return execute(context);}});
  const read=tool('workspace.read_text','read',{type:'object',properties:{path:{const:'synthetic-contract.json'}},required:['path'],additionalProperties:false},
    ()=>({content:'Synthetic public contract: answer(number)',source:'synthetic'}));
  const check=tool('coding.repair.trial','local_write',{type:'object',properties:{candidateId:{const:'supported'},patches:{type:'array'},
    recipeIds:{type:'array',items:{const:'synthetic-doc-check'}}},required:['candidateId','patches','recipeIds'],additionalProperties:false},
    async context=>{if(waitCommand)await new Promise((resolve,reject)=>{
      const cancel=()=>reject(new ProtocolError('CANCELLED','Synthetic command received original cancellation'));
      if(context.signal.aborted)cancel();else context.signal.addEventListener('abort',cancel,{once:true});});
      if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic command result is unknown');return {exitCode:0,source:'synthetic'};});
  const tools=[read,check],catalog=tools.map(({descriptor:d})=>({name:d.name,version:d.version,inputSchema:d.inputSchema}));
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-engine-checkpoint-secret-32-chars',
    selector:{select:async()=> 'supported'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>[
      {id:'supported',description:'Fixed Synthetic supported candidate',value:context.node.id==='F20_N01'
        ?{toolName:read.descriptor.name,toolVersion:'1.0.0',arguments:{path:'synthetic-contract.json'}}:context.node.id==='F20_N03'
          ?{toolName:check.descriptor.name,toolVersion:'1.0.0',arguments:{candidateId:'supported',recipeIds:['synthetic-doc-check'],
            patches:[{path:'synthetic-code.ts.f20-sample.ts',expectedSha256:null,edits:[],createText:'export const sample=1;'}]}}
          :{version:1,docMarkdown:'Synthetic candidate only',sampleSnippet:'export const sample=1;'}},
      {id:'recheck',description:'Fixed Synthetic abstention',value:{},abstain:true},
    ]});
  const image={bindingId:'synthetic-fixed-image',advance:async request=>{advances.push(request.requestId);return engine.advance(request);}};
  const open=()=>{app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-graph-owner',tools});return app;};open();
  const deadline=new Date(Date.now()+60000).toISOString();
  function create(){const task=app.runtime.submitTask({goal:'Synthetic F20 consumption',conversationId:'synthetic-graph-ui',idempotencyKey:'synthetic-driver'});
    app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
    app.runtime.saveCheckpoint(task.taskId,KEY,{version:1,sessionId:'synthetic-graph-session',controlRevision:0,bindingId:image.bindingId,sequence:0,
      input:{schemaFile:'synthetic-contract.json',codeFile:'synthetic-code.ts'},receipts:[],resolvedValues:{},confirmedHost:{},evidenceRefs:[],timings:[]});return task;}
  async function run(taskId,{resume=false,options={}}={}){
    return app.runtime.runTask(taskId,async worker=>{
      const state=worker.loadCheckpoint(KEY);
      const bridge=app.createOwnedWorkflowHost({receiptSecret:secret,parentTaskId:taskId,assertActive:(id,revision)=>{
        assert.equal(id,worker.taskId);assert.equal(revision,state.controlRevision);assert.equal(app.runtime.getTask(id).state,'running');}});
      return runRuntimeOwnedWorkflowDriver(app,worker,state,{workflowId:'F20',checkpointKey:KEY,mode:'main',image,bridge,catalog,
        requestId:sequence=>'synthetic-f20-'+taskId+'-'+sequence,
        authorizeReceipt:async({receipt})=>{assert.equal(receipt.state,'confirmed');exports.push(receipt.result);},
        validateSettled:state=>{
          assert.deepEqual(Object.values(state.result.nodes).map(node=>node.state),['completed','completed','completed','completed']);
          for(const name of [read.descriptor.name,check.descriptor.name]){
            const original=state.confirmedHost[name];assert.ok(original);
            const actual=app.readHostToolTask(original.localTaskId);assert.equal(actual.commandId,original.operationId);
            assert.equal(actual.task.state,'succeeded');assert.deepEqual(actual.confirmed.result,original.result);assert.ok(actual.confirmed.evidenceRefs.length);
          }
          assert.equal(state.confirmedHost[check.descriptor.name].result.exitCode,0);
          return {resultSummary:'Synthetic F20 candidate checked; never published',evidenceRefs:state.evidenceRefs};
        },...options});
    },{deadline,sideEffect:'local_write',resume});
  }
  async function approve(taskId){const state=app.runtime.loadCheckpoint(taskId,KEY),host=app.readHostToolTask(state.waiting.localTaskId);
    const before=calls.length,client=new Client(app);await client.connect();
    await client.call('authorization.respond',{approvalId:host.approval.approvalId,expectedRevision:host.approval.revision,decision:'allow_once'});
    await app.waitForHostToolTask(host.task.taskId);assert.equal(calls.length,before+1);return host;}
  return {get app(){return app;},calls,advances,exports,catalog,create,run,approve,reopen(){app.close();open();}};
}

test('real second graph completes all four nodes through the same Runtime task, original approvals and SQLite restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'personal-agent-synthetic-owned-driver-'));
  const f=fixture({path:join(directory,'runtime.sqlite')}),task=f.create();
  try{
    assert.equal((await f.run(task.taskId)).state,'waiting_approval');assert.equal(f.calls.length,0);
    const original=f.app.runtime.loadCheckpoint(task.taskId,KEY),firstHost=original.waiting.localTaskId;
    f.reopen();assert.equal(f.app.runtime.loadCheckpoint(task.taskId,KEY).waiting.localTaskId,firstHost);
    await f.approve(task.taskId);
    assert.equal((await f.run(task.taskId,{resume:true})).state,'waiting_approval');assert.equal(f.calls.length,1);
    const secondHost=f.app.runtime.loadCheckpoint(task.taskId,KEY).waiting.localTaskId;assert.notEqual(secondHost,firstHost);
    await f.approve(task.taskId);
    const result=await f.run(task.taskId,{resume:true});assert.equal(result.taskId,task.taskId);assert.equal(result.state,'succeeded',JSON.stringify(result.error));
    assert.equal(f.calls.length,2);assert.ok(f.advances.length>=3);assert.equal(new Set(f.advances).size,f.advances.length);
    assert.equal(f.exports.length,2);assert.ok(f.exports.every(result=>result.source==='synthetic'));
    assert.equal(f.app.readSubagentTasks(task.taskId).length,0);assert.match(result.resultSummary,/never published/);
    for(const call of f.calls){const execution=f.app.runtime.readToolExecutions(call.taskId)[0];assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');}
  }finally{f.app.close();await rm(directory,{recursive:true,force:true});}
});
test('unknown second-graph host write stays on its original operation and is never replayed',async()=>{
  const f=fixture({unknown:true}),task=f.create();
  try{
    await f.run(task.taskId);await f.approve(task.taskId);await f.run(task.taskId,{resume:true});await f.approve(task.taskId);
    assert.equal((await f.run(task.taskId,{resume:true})).state,'waiting_reconciliation');
    const waiting=f.app.runtime.loadCheckpoint(task.taskId,KEY).waiting,advances=f.advances.length;
    await assert.rejects(f.run(task.taskId,{resume:true}),{code:'REVISION_CONFLICT'});
    assert.deepEqual(f.app.runtime.loadCheckpoint(task.taskId,KEY).waiting,waiting);assert.equal(f.advances.length,advances);
    assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,1);
  }finally{f.app.close();}
});
test('changed trusted workflow identity/catalog cannot resume an original driver task',async()=>{
  for(const options of [{workflowId:'F01'},{catalog:[]}]){
    const f=fixture(),task=f.create();try{await f.run(task.taskId);const before=f.advances.length;
      const result=await f.run(task.taskId,{resume:true,options});assert.equal(result.state,'failed');assert.equal(result.error.code,'REVISION_CONFLICT');
      assert.equal(f.calls.length,0);assert.equal(f.advances.length,before);
    }finally{f.app.close();}
  }
});
test('a persisted unknown image send is read only and cannot trigger another advance',async()=>{
  const f=fixture(),task=f.create();try{
    const state=f.app.runtime.loadCheckpoint(task.taskId,KEY);state.pendingSend={requestId:'original-unknown-send',digest:'0'.repeat(64)};
    f.app.runtime.saveCheckpoint(task.taskId,KEY,state);
    assert.equal((await f.run(task.taskId)).state,'waiting_reconciliation');assert.equal(f.advances.length,0);assert.equal(f.calls.length,0);
  }finally{f.app.close();}
});
test('unavailable nodes expose structured diagnostics from the local template and original catalog',async()=>{
  const f=fixture(),task=f.create();try{
    const result=await f.run(task.taskId,{options:{catalog:[],image:{bindingId:'synthetic-fixed-image',advance:async()=>({
      workflowId:'F20',workflowVersion:'1.0.0',state:'unavailable',checkpoint:'synthetic-checkpoint',proposals:[],nodes:{},
      unavailable:[{nodeId:'F20_N01',capabilities:['host:untrusted-secret'],reason:'untrusted-secret'},
        {nodeId:'F99_N01',capabilities:[],reason:'untrusted-secret'}]})}}});
    assert.equal(result.state,'failed');assert.equal(result.error.code,'UNSUPPORTED_CAPABILITY');
    const diagnostic=JSON.parse(result.error.message.slice('Graph unavailable: '.length));
    assert.deepEqual(diagnostic,{workflowId:'F20',nodes:[{nodeId:'F20_N01',requiredCapabilities:['tool:workspace.read_text'],
      missingPublishedTools:['workspace.read_text']}]});
    assert.deepEqual(f.app.runtime.loadCheckpoint(task.taskId,KEY).unavailable,diagnostic.nodes);
    assert.doesNotMatch(result.error.message,/untrusted-secret|F99_N01/);assert.equal(f.calls.length,0);
  }finally{f.app.close();}
});
test('real engine missing a published tool reports its node without executing a host',async()=>{
  const f=fixture(),task=f.create();try{
    const result=await f.run(task.taskId,{options:{catalog:[]}});
    assert.equal(result.state,'failed');assert.equal(result.error.code,'UNSUPPORTED_CAPABILITY');
    const diagnostic=JSON.parse(result.error.message.slice('Graph unavailable: '.length));
    assert.ok(diagnostic.nodes.some(node=>node.nodeId==='F20_N01'&&node.missingPublishedTools.includes('workspace.read_text')));
    assert.equal(f.calls.length,0);
  }finally{f.app.close();}
});
test('confirmed operations retain both receipts when the same tool is used twice',async()=>{
  const f=fixture(),task=f.create();let advance=0;
  const proposals=['first','second'].map(id=>({kind:'tool_proposal',nodeId:'F20_N01',operationId:id,toolName:'workspace.read_text',toolVersion:'1.0.0'}));
  try{
    const result=await f.run(task.taskId,{options:{image:{bindingId:'synthetic-fixed-image',advance:async()=>++advance===1
      ?{workflowId:'F20',workflowVersion:'1.0.0',state:'awaiting_host',checkpoint:'one',nodes:{},proposals}
      :{workflowId:'F20',workflowVersion:'1.0.0',state:'settled',checkpoint:'two',nodes:{},proposals:[]}},
      bridge:{submit:(_binding,proposal)=>({localTaskId:proposal.operationId,state:'succeeded'}),
        readReceipt:async(_binding,proposal)=>({state:'confirmed',result:{source:proposal.operationId},evidenceRefs:[proposal.operationId]})},
      authorizeReceipt:async()=>{},validateSettled:state=>{
        assert.deepEqual(Object.keys(state.confirmedOperations).sort(),['first','second']);
        assert.deepEqual(state.confirmedOperations.first.result,{source:'first'});
        assert.deepEqual(state.confirmedOperations.second.result,{source:'second'});
        return {resultSummary:'Synthetic receipts retained',evidenceRefs:state.evidenceRefs};
      }}});
    assert.equal(result.state,'succeeded',JSON.stringify(result.error));
  }finally{f.app.close();}
});
test('cloud settled without original local receipts cannot complete the second graph',async()=>{
  const f=fixture(),task=f.create();try{
    const result=await f.run(task.taskId,{options:{image:{bindingId:'synthetic-fixed-image',advance:async()=>({workflowId:'F20',workflowVersion:'1.0.0',
      state:'settled',checkpoint:'synthetic-forged-checkpoint',proposals:[],nodes:Object.fromEntries(['F20_N01','F20_N02','F20_N03','F20_N04'].map(id=>[id,{state:'completed'}]))})}}});
    assert.equal(result.state,'failed');assert.equal(f.calls.length,0);assert.equal(result.evidenceRefs?.length??0,0);
  }finally{f.app.close();}
});
test('original Runtime worker cancellation reaches only its original running host operation',async()=>{
  const f=fixture({waitCommand:true}),task=f.create();
  try{
    await f.run(task.taskId);await f.approve(task.taskId);await f.run(task.taskId,{resume:true});
    const state=f.app.runtime.loadCheckpoint(task.taskId,KEY),host=f.app.readHostToolTask(state.waiting.localTaskId);
    const client=new Client(f.app);await client.connect();
    await client.call('authorization.respond',{approvalId:host.approval.approvalId,expectedRevision:host.approval.revision,decision:'allow_once'});
    const running=f.run(task.taskId,{resume:true});
    for(let n=0;n<100&&f.calls.length<2;n++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(f.calls.length,2);f.app.runtime.requestCancel(task.taskId,'Synthetic original user cancellation');
    const result=await running;assert.equal(result.state,'cancelled');
    assert.equal(f.app.runtime.getTask(host.task.taskId).cancelRequested,true);
    assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,1);
  }finally{f.app.close();}
});
