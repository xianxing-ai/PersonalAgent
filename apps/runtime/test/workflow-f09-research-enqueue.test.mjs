import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createRuntimeF09ResearchEnqueue,readF09ResearchLaunch} from '../dist/application.js';

const toolName='workflow.host.f09_n04';
const signalPayload={sourceOperationId:'original-feed-operation',signalId:'selected-signal'};
const arguments_={signalPayload};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function waitFor(read) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const value=read();
    if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('Original host task did not reach the expected state');
}

test('F09 admits one bound F10 task through Runtime approval and recovers the original receipt',async()=>{
  const fixtureRoot=fileURLToPath(new URL('../../../.cache/owned-workflow-host-fixtures/',import.meta.url));
  await mkdir(fixtureRoot,{recursive:true});
  const directory=await mkdtemp(join(fixtureRoot,'research-'));
  let app;
  let expectedParent;
  let original={...signalPayload,inputRef:'approved-f10-config'};
  const [tool]=createRuntimeF09ResearchEnqueue({
    getRuntime:()=>app.runtime,
    assertCurrent:scope=>{assert.equal(scope.parentTaskId,expectedParent);},
    resolveLaunch:()=>original,
  });
  assert.deepEqual(createRuntimeF09ResearchEnqueue(),[]);
  assert.equal(tool.descriptor.name,toolName);
  const config={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'synthetic-public-user',tools:[tool],riskAutonomy:false};
  app=createRuntimeApplication(config);
  const client=new Client(app,Date.now);
  try {
    await client.connect();
    const parent=app.runtime.submitTask({goal:'Collect an approved public feed',conversationId:'public-feed',
      idempotencyKey:'f09-parent'});
    expectedParent=parent.taskId;
    app.runtime.transitionTask(parent.taskId,'planning');
    app.runtime.transitionTask(parent.taskId,'running');
    const request={taskId:parent.taskId,workflowId:'F09',sessionId:'f09-session',controlRevision:1,
      deadline:new Date(Date.now()+60000).toISOString()};
    const bridge=()=>app.createOwnedWorkflowHost({parentTaskId:parent.taskId,
      receiptSecret:'synthetic-private-receipt-key-32-chars',assertActive:(id,revision)=>{
        assert.equal(id,parent.taskId);assert.equal(revision,1);
      }});
    const proposal={kind:'tool_proposal',nodeId:'F09_N04',proposalId:'selected-proposal',operationId:'original-enqueue',
      originControlRevision:1,inputDigest:digest(arguments_),toolSchemaDigest:digest(tool.descriptor.inputSchema),
      toolName,toolVersion:tool.descriptor.version,arguments:arguments_};
    const launchTasks=()=>app.runtime.listTasks({conversationId:'public-feed'}).items
      .filter(task=>readF09ResearchLaunch(app.runtime,task.taskId));

    // Without a HostBridge's original intent, even a locally made context cannot queue F10.
    await assert.rejects(tool.execute(arguments_,{taskId:parent.taskId,runId:'host-tool-'+parent.taskId,
      scopes:['runtime:enqueue_research'],authorizationRef:'test-grant',deadline:request.deadline,
      signal:new AbortController().signal}),{code:'UNAUTHORIZED'});

    const host=bridge();
    const child=host.submit(request,proposal);
    const approval=await waitFor(()=>app.readHostToolTask(child.localTaskId).approval);
    assert.equal(launchTasks().length,0);
    assert.equal(host.readReceipt(request,proposal),undefined);
    await client.call('authorization.respond',{approvalId:approval.approvalId,
      expectedRevision:approval.revision,decision:'allow_once'});
    const receipt=await waitFor(()=>host.readReceipt(request,proposal));
    assert.equal(receipt.state,'confirmed');
    const [researchTask]=launchTasks();
    assert.ok(researchTask);
    assert.equal(researchTask.state,'created');
    assert.deepEqual(receipt.result,{researchTaskSpawned:{taskId:researchTask.taskId,state:'accepted'}});
    assert.deepEqual(readF09ResearchLaunch(app.runtime,researchTask.taskId),{
      workflowId:'F10',...original,parentTaskId:parent.taskId,sessionId:request.sessionId,
      operationId:proposal.operationId,deadline:request.deadline,
    });

    // Altering source selection or minting another operation may never produce a second task.
    const context={taskId:child.localTaskId,runId:'host-tool-'+child.localTaskId,authorizationRef:approval.approvalId,
      scopes:['runtime:enqueue_research'],deadline:request.deadline,signal:new AbortController().signal};
    const selected=original;
    original=undefined;
    await assert.rejects(tool.execute(arguments_,context),{code:'UNSUPPORTED_CAPABILITY'});
    original={...selected,signalId:'different-signal'};
    await assert.rejects(tool.execute(arguments_,context),{code:'UNAUTHORIZED'});
    original={...selected,inputRef:'another-f10-config'};
    await assert.rejects(tool.execute(arguments_,context),{code:'REVISION_CONFLICT'});
    original=selected;
    const duplicate={...proposal,proposalId:'other-proposal',operationId:'other-enqueue'};
    const other=host.submit(request,duplicate);
    const otherApproval=await waitFor(()=>app.readHostToolTask(other.localTaskId).approval);
    await client.call('authorization.respond',{approvalId:otherApproval.approvalId,
      expectedRevision:otherApproval.revision,decision:'allow_once'});
    await app.waitForHostToolTask(other.localTaskId);
    assert.notEqual(app.runtime.getTask(other.localTaskId).state,'succeeded');
    assert.equal(launchTasks().length,1);

    await waitFor(()=>app.activeTaskCount===0);
    app.close();
    app=createRuntimeApplication(config);
    assert.equal(bridge().submit(request,proposal).localTaskId,child.localTaskId);
    assert.deepEqual(bridge().readReceipt(request,proposal),receipt);
    assert.equal(launchTasks()[0].taskId,researchTask.taskId);
    assert.equal(launchTasks().length,1);
  } finally {
    await waitFor(()=>app.activeTaskCount===0);
    app.close();
    await rm(directory,{recursive:true,force:true});
  }
});
