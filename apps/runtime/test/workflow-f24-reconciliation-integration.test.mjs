import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,workflowShadowReleaseDigest as digest} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeF24ReconciliationHost} from '../dist/application/workflow-f24-reconciliation-host.js';

// Real Runtime/HostBridge/Policy/ToolGateway and SQLite; all target data and
// the independent readback verifier are synthetic, not a real business source.
test('F24 original unknown is held, then independent readback can be observed without retry',async()=>{
  const scopes=['synthetic:readback'],deadline=new Date(Date.now()+60000).toISOString();
  let app,host,binding,capturedContext,businessCalls=0;
  const business={descriptor:{name:'synthetic.business.write',version:'1.0.0',sideEffect:'local_write',
    inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object'},
    requiredScopes:['synthetic:write'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(){businessCalls++;throw new ProtocolError('RESULT_UNKNOWN','Synthetic write outcome unknown');}};
  const graphTool=createOwnedWorkflowAdapter({nodeId:'F24_N09',kind:'host',sideEffect:'read',requiredScopes:scopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['state','taskId','taskRevision','runId','evidenceRefs'],properties:{
      state:{type:'string',enum:['applied','not_applied']},taskId:{type:'string'},taskRevision:{type:'integer'},runId:{type:'string'},
      evidenceRefs:{type:'array',items:{type:'string'}}}},
    async execute(input,context){capturedContext=context;return host.tools[0].execute(input,context);}});
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-user',tools:[business,graphTool]});
  const client=new Client(app,Date.now);await client.connect();
  const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.fail('Synthetic Runtime operation did not settle');};
  const approve=async taskId=>{
    await wait(()=>app.readHostToolTask(taskId).task.state==='waiting_approval');
    const approval=app.readHostToolTask(taskId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  };
  try {
    host=createRuntimeF24ReconciliationHost({application:app,hostUserNamespace:'synthetic-user',driverCheckpointKey:'f24-driver',
      requiredScopes:scopes,now:()=>new Date(),assertCurrent:()=>{},resolveOriginalEffect:async()=>binding,
      verifyReadback:async({binding:source,record,observations})=>source.taskId===binding.taskId
        &&record.evidenceId===binding.runId&&observations.length===1&&observations[0].evidenceId==='fixture-observation',
      authorizeExport:async()=>true});
    const original=app.submitHostToolTask({commandId:'synthetic-business-operation',toolName:business.descriptor.name,
      toolVersion:'1.0.0',arguments:{},deadline});
    await approve(original.task.taskId);
    await wait(()=>app.readHostToolTask(original.task.taskId).task.state==='waiting_reconciliation');
    const record=app.runtime.readToolExecutions(original.task.taskId)[0];
    assert.equal(record.state,'unknown');assert.equal(businessCalls,1);
    binding={taskId:original.task.taskId,runId:record.evidenceId,toolName:record.toolName,toolVersion:record.toolVersion,
      inputDigest:record.inputDigest,readbackEvidenceId:'fixture-observation'};
    async function submitGraph(id) {
      const parent=app.runtime.submitTask({goal:'Synthetic F24 readback',conversationId:'fixture',idempotencyKey:'graph-'+id});
      app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
      const operationId='f24-operation-'+id;
      const proposal={kind:'tool_proposal',nodeId:'F24_N09',operationId,proposalId:operationId,
        inputDigest:digest({arguments:{}}),originControlRevision:1,toolName:graphTool.descriptor.name,
        toolVersion:'1.0.0',toolSchemaDigest:digest(graphTool.descriptor.inputSchema),arguments:{},resourceKeys:[],effect:'read'};
      app.runtime.saveCheckpoint(parent.taskId,'f24-driver',{sessionId:'session-'+id,controlRevision:1,
        result:{state:'awaiting_host',proposals:[proposal],nodes:{F24_N09:{state:'waiting_receipt'}}}});
      app.runtime.saveCheckpoint(parent.taskId,'f24-driver:driver-binding',{taskId:parent.taskId,workflowId:'F24',sessionId:'session-'+id,deadline});
      const bridge=app.createOwnedWorkflowHost({parentTaskId:parent.taskId,receiptSecret:'synthetic-receipt-secret-at-least-32-bytes',assertActive:()=>{}});
      const request={taskId:parent.taskId,sessionId:'session-'+id,workflowId:'F24',controlRevision:1,deadline,taskDeadline:deadline};
      const submitted=bridge.submit(request,proposal);await approve(submitted.localTaskId);
      await wait(()=>['succeeded','failed','waiting_reconciliation'].includes(app.readHostToolTask(submitted.localTaskId).task.state));
      return {bridge,request,proposal,taskId:submitted.localTaskId};
    }
    const unresolved=await submitGraph('unresolved');
    assert.equal(app.readHostToolTask(unresolved.taskId).task.state,'waiting_reconciliation');
    assert.equal(businessCalls,1);
    // Simulate a separate trusted readback producer, explicitly synthetic.
    app.runtime.saveCheckpoint(original.task.taskId,'trusted-readback-evidence:fixture-observation',{
      evidenceId:'fixture-observation',kind:'observation',sourceRef:'fixture-source',capturedAt:new Date().toISOString(),
      summary:'Synthetic independent readback',verification:'verified',sensitivity:'internal'});
    app.runtime.reconcileToolExecution(original.task.taskId,record.evidenceId,'applied',{fixture:true},['fixture-observation']);
    const resolved=await submitGraph('resolved'),readback=app.readHostToolTask(resolved.taskId);
    assert.equal(readback.task.state,'succeeded');assert.equal(readback.confirmed.result.state,'applied');
    const receipt=resolved.bridge.readReceipt(resolved.request,resolved.proposal);
    assert.equal(receipt.state,'confirmed');assert.deepEqual(receipt.result.evidenceRefs,['fixture-observation']);
    await host.authorizeReceipt({context:capturedContext,result:receipt.result});
    assert.equal(businessCalls,1);
  } finally {while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();}
});
