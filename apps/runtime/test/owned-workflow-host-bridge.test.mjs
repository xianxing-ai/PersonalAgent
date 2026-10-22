import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createWorkspaceReadTool} from '@personal-agent/coding-tools';
import {OwnedWorkflowEngine,OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeOwnedWorkflowTools} from '../dist/application.js';

test('Runtime registers F23 write and readback separately; missing real configuration remains unavailable after original Policy',async()=>{
  const fixtureRoot=fileURLToPath(new URL('../../../.cache/owned-workflow-host-fixtures/',import.meta.url));
  await mkdir(fixtureRoot,{recursive:true});const directory=await mkdtemp(join(fixtureRoot,'release-'));
  const configuration={requiredScopes:['configuration:test-only'],sideEffect:'local_write'};
  const descriptors=createRuntimeOwnedWorkflowTools({shadowRelease:configuration}).map(value=>value.descriptor);
  assert.deepEqual(descriptors.map(value=>[value.name,value.sideEffect]),[
    ['workflow.host.f23_n04','local_write'],['workflow.host.f23_n05','read']]);
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'synthetic-public-user',workflowShadowRelease:configuration});
  const client=new Client(app,Date.now);await client.connect();
  try {
    for(const descriptor of descriptors) {
      const submission=app.submitHostToolTask({commandId:'f23-'+descriptor.name,toolName:descriptor.name,toolVersion:descriptor.version,
        arguments:{...(descriptor.sideEffect==='read'?{}:{action:'promote'}),operationId:'fixture-operation',configurationId:'fixture'},
        deadline:new Date(Date.now()+30000).toISOString()});
      const wait=async predicate=>{const until=Date.now()+10000;while(Date.now()<until){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('original Runtime did not reach expected state');};
      await wait(()=>app.readHostToolTask(submission.task.taskId).task.state==='waiting_approval');
      assert.equal(app.runtime.readToolExecutions(submission.task.taskId).some(value=>value.executionStarted),false);
      const pending=app.readHostToolTask(submission.task.taskId).approval;
      await client.call('authorization.respond',{approvalId:pending.approvalId,expectedRevision:pending.revision,decision:'allow_once'});
      await wait(()=>app.readHostToolTask(submission.task.taskId).task.state==='succeeded');
      const readback=app.readHostToolTask(submission.task.taskId);
      assert.equal(readback.confirmed.result.state,'unavailable');assert.equal(readback.confirmed.result.promotionReady,false);
      assert.equal(app.runtime.readEvidence(submission.task.taskId).length,1);
    }
  }finally{while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();
    assert.ok(resolve(directory).startsWith(resolve(fixtureRoot)));await rm(directory,{recursive:true,force:true});}
});

test('owned graph uses actual SQLite Runtime/Policy/ToolGateway/workspace read and signs only original confirmed readback',async()=>{
  const fixtureRoot=fileURLToPath(new URL('../../../.cache/owned-workflow-host-fixtures/',import.meta.url));
  await mkdir(fixtureRoot,{recursive:true});const directory=await mkdtemp(join(fixtureRoot,'read-'));
  await writeFile(join(directory,'public-example.txt'),'Public workflow fixture. No private data.\n');
  const receiptSecret='synthetic-private-host-receipt-key-32-chars';
  const tool=createWorkspaceReadTool({rootPath:directory});
  let executionCount=0;
  const actualTool={descriptor:tool.descriptor,execute:async(...args)=>{executionCount++;return tool.execute(...args);}};
  const config={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-public-user',tools:[actualTool]};
  let app=createRuntimeApplication(config);
  try {
    const parent=app.runtime.submitTask({goal:'Read public fixture for graph development',conversationId:'workflow-test',idempotencyKey:'owned-parent'});
    const original={workflowId:'F20',taskId:parent.taskId,controlRevision:1,sessionId:'workflow-test',requestId:'workflow-test',
      input:{goal:'Read public-example.txt'},deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,
      availableTools:[{name:tool.descriptor.name,version:tool.descriptor.version,inputSchema:tool.descriptor.inputSchema}]};
    const runtime=new OwnedWorkflowEngine({checkpointSecret:'synthetic-cloud-checkpoint-key-32-chars',
      selector:{select:async()=> 'read'},prepareCandidates:async context=>[
        {id:'read',description:'Read exact public path',value:context.node.kind==='tool'
          ?{toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public-example.txt'}}:{answer:'candidate'}},
        {id:'recheck',description:'Do not execute if source missing',value:{},abstain:true}],
      receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret})});
    let bridge=app.createOwnedWorkflowHost({receiptSecret,
      assertActive:(id,revision)=>{const task=app.runtime.getTask(id);assert.equal(revision,1);assert.equal(task.cancelRequested??false,false);assert.equal(task.state,'created');}});
    let last=await runtime.advance(original);const proposal=last.proposals[0];
    assert.equal(last.nodes.F20_N01.state,'waiting_receipt');assert.equal(executionCount,0);
    const submitted=await bridge.submitWithShadow(original,proposal);
    const waitFor=async(state)=>{
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){if(app.runtime.getTask(submitted.localTaskId).state===state)return;await new Promise(resolve=>setTimeout(resolve,5));}
      throw Error(`actual host task did not reach ${state}`);
    };
    await waitFor('waiting_approval');assert.equal(executionCount,0);assert.equal(bridge.readReceipt(original,proposal),undefined);
    const approval=app.readHostToolTask(submitted.localTaskId).approval;
    const client=new Client(app,Date.now);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await waitFor('succeeded');assert.equal(executionCount,1);
    const receipt=await bridge.readReceiptWithShadow(original,proposal);assert.equal(receipt.state,'confirmed');
    assert.equal(receipt.result.content,'Public workflow fixture. No private data.\n');
    assert.equal(receipt.proof.runId,receipt.evidenceRefs[0]);
    assert.equal(app.runtime.readToolExecutions(submitted.localTaskId)[0].policyDecision,'allow');
    assert.equal(app.runtime.readEvidence(submitted.localTaskId).length,1);
    const projection={source:'Synthetic fixed metadata',read:true},authorization={policyVersion:'synthetic-projection-v1',
      schemaDigest:'a'.repeat(64),leaseRef:'synthetic-original-export-lease',stage:'receipt'};
    const projected=bridge.projectReceiptResult(original,proposal,receipt,projection,authorization);
    assert.deepEqual(projected.result,projection);
    assert.equal(projected.proof.originalResultDigest,receipt.proof.resultDigest);
    assert.deepEqual(bridge.readReceipt(original,proposal),receipt,'local signed receipt and raw result are never replaced');
    assert.deepEqual(bridge.projectReceiptResult(original,proposal,receipt,projection,authorization),projected);
    assert.throws(()=>bridge.projectReceiptResult(original,proposal,{...receipt,result:{content:'forged'}},projection,authorization));
    assert.throws(()=>bridge.projectReceiptResult(original,proposal,receipt,{...projection,read:false},authorization));
    assert.throws(()=>bridge.projectReceiptResult(original,proposal,receipt,projection,{...authorization,leaseRef:'another-lease'}));
    await assert.rejects(runtime.advance({...original,checkpoint:last.checkpoint,receipts:[{...receipt,result:{content:'client forgery'}}]}),{code:'INVALID_ARGUMENT'});
    last=await runtime.advance({...original,checkpoint:last.checkpoint,receipts:[projected]});
    assert.equal(last.nodes.F20_N01.state,'completed');assert.equal(last.nodes.F20_N02.state,'completed');
    app.runtime.saveCheckpoint(parent.taskId,'owned-workflow:cloud-checkpoint',last.checkpoint);
    assert.equal(bridge.submit(original,proposal).localTaskId,submitted.localTaskId);assert.equal(executionCount,1);
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();app=createRuntimeApplication(config);
    bridge=app.createOwnedWorkflowHost({receiptSecret,assertActive:(id,revision)=>{assert.equal(id,parent.taskId);assert.equal(revision,1);}});
    assert.equal(bridge.submit(original,proposal).localTaskId,submitted.localTaskId);assert.equal(executionCount,1);
    const restored=app.runtime.loadCheckpoint(parent.taskId,'owned-workflow:cloud-checkpoint');
    const continued=await runtime.advance({...original,checkpoint:restored});
    assert.equal(continued.nodes.F20_N01.state,'completed');assert.equal(executionCount,1);
  } finally {
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();
    assert.ok(resolve(directory).startsWith(resolve(fixtureRoot)),'cleanup remains in the owned fixture root');
    await rm(directory,{recursive:true,force:true});
  }
});
