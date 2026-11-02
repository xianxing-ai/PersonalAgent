import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createF03MailReviewWorkflowPorts} from '../electron/f03-mail-review-workflow-ports.js';

// Actual Runtime native delegation/Policy/SQLite; private source and failing image transport are explicit fixtures.
test('F08 lost native admission acknowledgement reads the original F03 task and never submits a replacement',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'f03-native-'));let app,ports,imageCalls=0,submissions=0;const cloudTasks=[];
  const source={graphTaskId:'',readRunId:'synthetic-original-mail-read'},deadline=new Date(Date.now()+30_000).toISOString();
  const review={sourceDigest:'a'.repeat(64),graphNamespace:'native-f03',graphRevision:0,evaluatedAt:new Date().toISOString(),affected:[],allowedDependencies:[]};
  const original={reference:source,review,plan:{id:'synthetic-plan',revision:1},conversationId:'native-f03-chat',effects:[],privateContext:[],originalDeadline:deadline,requiresReview:true};
  const open=()=>{
    ports=createF03MailReviewWorkflowPorts({getApplication:()=>app,sourceChanges:{readReviewSource:ref=>{assert.deepEqual(ref,source);return structuredClone(original);}},
      assertCurrent:()=>{},authorizeExport:async()=>true});
    const [worker]=ports.configuredWorkflowWorkerPorts,decision=createWorkflowDecisionTool({selector:{select:async()=> 'unused'}});
    const tools=[...ports.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
      runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
    app=runtimeModule.createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
      hostUserNamespace:'native-f03',coordinationBinding:'synthetic-native-deployment',assertCoordinationBinding:()=>{},tools,
      coordination:{execute:syntheticCoordinationExecution(async request=>{cloudTasks.push(request.taskId);return {kind:'text',text:'Original image result is unknown; no retry.',verification:'unverified'};})},
      configuredWorkflowWorkers:[{...worker,image:{bindingId:'synthetic-f03-native-image',receiptSecret:async()=> 'synthetic-original-secret-at-least32',
        advance:async request=>{imageCalls++;assert.deepEqual(request.input.source,source);throw new ProtocolError('RESULT_UNKNOWN','Synthetic image transport lost after original request');}}}],
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'native-fixture',
        accepts:()=>true,project:({result})=>result}))});
    return app;
  };
  open();app.runtime.provisionCoordinationStore('native-f03');
  source.graphTaskId=app.runtime.submitTask({goal:'Synthetic original F08 source',conversationId:original.conversationId,idempotencyKey:'original-source'}).taskId;
  const originalPlan=app.runtime.submitTask({goal:'Synthetic original Plan',conversationId:original.conversationId,idempotencyKey:'original-plan'});
  const changed={graphTaskId:source.graphTaskId,readRunId:source.readRunId,planSource:{rootTaskId:originalPlan.taskId,sourceDigest:'b'.repeat(64)},effects:[{state:'unknown',runId:'original-effect'}]};
  app.runtime.saveCheckpoint(source.graphTaskId,'f08:mail-source-change:'+source.readRunId,changed);
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    for(let n=0;n<100&&app.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));app.close();await rm(directory,{recursive:true,force:true});});
  const scope={parentTaskId:source.graphTaskId,deadline,signal:new AbortController().signal},change={reviewReference:source,change:{readRunId:source.readRunId}};
  const submit=app.submitF03MailReviewTask.bind(app);
  app.submitF03MailReviewTask=(request,context)=>{
    assert.equal(app.runtime.readExecutionEpoch(source.graphTaskId),1);
    assert.equal(app.runtime.readExecutionEpoch(originalPlan.taskId),1);
    submissions++;const reviewTask=submit(request,context);
    assert.equal(app.runtime.readExecutionEpoch(reviewTask.taskId),0);
    throw new ProtocolError('RESULT_UNKNOWN','Synthetic lost admission acknowledgement');
  };
  await assert.rejects(ports.submitChange(scope,change),{code:'RESULT_UNKNOWN'});
  const marker=app.runtime.loadCheckpoint(source.graphTaskId,'f08:competition-review:'+source.readRunId);
  const admitted=app.readF03MailReviewTask(marker.request.idempotencyKey);assert.ok(admitted);
  app.submitF03MailReviewTask=(request,context)=>{submissions++;return submit(request,context);};
  assert.equal((await ports.submitChange(scope,change)).taskId,admitted.taskId);assert.equal(submissions,1);
  assert.equal(app.runtime.readExecutionEpoch(source.graphTaskId),1);assert.equal(app.runtime.readExecutionEpoch(originalPlan.taskId),1);
  assert.deepEqual(app.runtime.loadCheckpoint(source.graphTaskId,'f08:mail-source-change:'+source.readRunId),changed);
  assert.throws(()=>app.submitF03MailReviewTask({...marker.request,arguments:{source:{...source,readRunId:'substituted'}}},scope),{code:'REVISION_CONFLICT'});
  const client=new Client(app);await client.connect();
  for(let n=0;n<500&&!imageCalls;n++){
    for(const task of app.runtime.listTasks({limit:100}).items){const page=await client.call('approval.list',{taskId:task.taskId});
      for(const item of page.items.filter(item=>item.state==='pending'))await client.call('authorization.respond',{approvalId:item.approvalId,expectedRevision:item.revision,decision:'allow_once'});}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(imageCalls,1);assert.ok(cloudTasks.every(taskId=>taskId===admitted.taskId),'only the root may summarize; cloud never chooses the native child source');
  app.runtime.requestCancel(admitted.taskId);for(let n=0;n<100&&app.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));
  const state=app.runtime.getTask(admitted.taskId).state;app.close();open();
  const restored=await ports.submitChange(scope,change);assert.equal(restored.taskId,admitted.taskId);assert.equal(restored.reviewState,state);
  assert.equal(app.runtime.readExecutionEpoch(source.graphTaskId),1);assert.equal(app.runtime.readExecutionEpoch(originalPlan.taskId),1);
  assert.equal(imageCalls,1,'SQLite reopen does not dispatch another image request');
});
