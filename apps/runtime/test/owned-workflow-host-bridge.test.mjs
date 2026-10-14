import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createWorkspaceReadTool} from '@personal-agent/coding-tools';
import {OwnedWorkflowEngine,OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';

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
    const bridge=new OwnedWorkflowHostBridge({receiptSecret,
      host:{submitHostToolTask:request=>app.submitHostToolTask(request),readHostToolTask:id=>app.readHostToolTask(id)},
      checkpoints:{read:(id,key)=>app.runtime.loadCheckpoint(id,key),writeOnce:(id,key,value)=>app.runtime.saveCheckpointOnce(id,key,value)},
      assertActive:(id,revision)=>{const task=app.runtime.getTask(id);assert.equal(revision,1);assert.equal(task.cancelRequested??false,false);assert.equal(task.state,'created');}});
    let last=await runtime.advance(original);const proposal=last.proposals[0];
    assert.equal(last.nodes.F20_N01.state,'waiting_receipt');assert.equal(executionCount,0);
    const submitted=bridge.submit(original,proposal);
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
    const receipt=bridge.readReceipt(original,proposal);assert.equal(receipt.state,'confirmed');
    assert.equal(receipt.result.content,'Public workflow fixture. No private data.\n');
    assert.equal(receipt.proof.runId,receipt.evidenceRefs[0]);
    assert.equal(app.runtime.readToolExecutions(submitted.localTaskId)[0].policyDecision,'allow');
    assert.equal(app.runtime.readEvidence(submitted.localTaskId).length,1);
    await assert.rejects(runtime.advance({...original,checkpoint:last.checkpoint,receipts:[{...receipt,result:{content:'client forgery'}}]}),{code:'INVALID_ARGUMENT'});
    last=await runtime.advance({...original,checkpoint:last.checkpoint,receipts:[receipt]});
    assert.equal(last.nodes.F20_N01.state,'completed');assert.equal(last.nodes.F20_N02.state,'completed');
    app.runtime.saveCheckpoint(parent.taskId,'owned-workflow:cloud-checkpoint',last.checkpoint);
    assert.equal(bridge.submit(original,proposal).localTaskId,submitted.localTaskId);assert.equal(executionCount,1);
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();app=createRuntimeApplication(config);
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
