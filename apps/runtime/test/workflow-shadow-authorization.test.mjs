import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {createOwnedWorkflowAdapter,workflowShadowReleaseDigest as digest} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeWorkflowShadowAuthorization} from '../dist/application/workflow-shadow-authorization.js';
import {createRuntimeWorkflowShadowConfigurationPort} from '../dist/application/workflow-shadow-configuration.js';
import {createRuntimeWorkflowShadowAcceptanceHost} from '../dist/application/workflow-shadow-acceptance.js';
import {TaskRuntime} from '../dist/index.js';

// Synthetic branch data and acceptance; HostBridge, approval, Policy, ToolGateway,
// running execution record, and Runtime SQLite are real. No external model or service.
test('F23 authorization resolves the actual HostBridge intent and current policy, never changed input or revoked grants',async()=>{
  const root=join(process.cwd(),'.cache','workflow-shadow-authorization');mkdirSync(root,{recursive:true});
  const path=join(mkdtempSync(join(root,'run-')),'runtime.sqlite'),requiredScopes=['configuration:release'];
  const old={threshold:1},next={threshold:2};
  const acceptance={policyId:'synthetic-policy',revision:1,configurationId:'synthetic-config',taskClass:'synthetic',
    validFrom:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    baseline:{revision:1,version:'v1',parametersDigest:digest(old),resultBaselineSha256:digest('fixture-baseline')},
    candidate:{version:'v2',parametersDigest:digest(next)},conditionsDigest:digest('fixture-conditions'),qualityMetricId:'fixture-quality',
    metricRules:[{metric:'qualityScore',bound:'min_delta',value:0}],requiredChecks:['fixture-check']};
  const args={action:'promote',operationId:'release-operation',configurationId:'synthetic-config',
    main:{branch:'main'},shadow:{branch:'shadow'},testEvidence:{kind:'synthetic'},candidateParameters:next};
  const body={operationId:args.operationId,configurationId:args.configurationId,action:'promote',
    expected:{configurationId:args.configurationId,revision:1,version:'v1',parameters:old,parametersDigest:digest(old)},
    next:{configurationId:args.configurationId,version:'v2',parameters:next,parametersDigest:digest(next)},
    sourceDigest:digest({acceptance,main:args.main,shadow:args.shadow,testEvidence:args.testEvidence})};
  const write={...body,requestDigest:digest(body)};
  let authorization,app,seen=0;
  const tool=createOwnedWorkflowAdapter({nodeId:'F23_N04',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:true},outputSchema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}}},
    execute:async(input,context)=>{
      seen++;
      const original=authorization.resolveOriginal(context);
      assert.equal(original.toolName,'workflow.host.f23_n04');assert.equal(original.argumentsDigest,toolArgumentsDigest(input));
      assert.equal(await authorization.authorize(context,'read',args.configurationId),true);
      assert.equal(await authorization.authorize(context,'read','different-config'),false);
      assert.equal(await authorization.authorize(context,'readOperation',args.operationId),true);
      assert.equal(await authorization.authorize(context,'write',write),true);
      assert.equal(await authorization.authorize(context,'write',{...write,operationId:'substituted'}),false);
      const parentIntent=app.runtime.loadCheckpoint(original.parentTaskId,'owned-workflow:intent:'+original.hostOperationId);
      app.runtime.saveCheckpoint(original.parentTaskId,'owned-workflow:intent:'+original.hostOperationId,
        {...parentIntent,proposal:{...parentIntent.proposal,arguments:{...input,configurationId:'substituted'}}});
      assert.throws(()=>authorization.resolveOriginal(context),{code:'UNAUTHORIZED'});
      app.runtime.saveCheckpoint(original.parentTaskId,'owned-workflow:intent:'+original.hostOperationId,parentIntent);
      app.runtime.policy.revoke(context.authorizationRef);
      assert.throws(()=>authorization.resolveOriginal(context),{code:'UNAUTHORIZED'});
      return {ok:true};
    }});
  app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-user',tools:[tool]});
  const client=new Client(app,Date.now);await client.connect();
  try {
    authorization=createRuntimeWorkflowShadowAuthorization({runtime:app.runtime,hostUserNamespace:'synthetic-user',
      driverCheckpointKey:'synthetic-driver',requiredScopes,now:()=>new Date(),readAcceptance:()=>acceptance});
    const parent=app.runtime.submitTask({goal:'Synthetic F23 binding',conversationId:'synthetic',idempotencyKey:'synthetic-parent'});
    const deadline=new Date(Date.now()+30000).toISOString(),operationId='synthetic-f23-host-operation';
    const proposal={kind:'tool_proposal',nodeId:'F23_N04',operationId,proposalId:operationId,inputDigest:digest({arguments:args}),
      originControlRevision:1,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      toolSchemaDigest:digest(tool.descriptor.inputSchema),arguments:args,resourceKeys:[],effect:'write'};
    app.runtime.saveCheckpoint(parent.taskId,'synthetic-driver',{sessionId:'synthetic-session',controlRevision:1,
      result:{state:'awaiting_host',proposals:[proposal]}});
    app.runtime.saveCheckpoint(parent.taskId,'synthetic-driver:driver-binding',{taskId:parent.taskId,workflowId:'F23',
      sessionId:'synthetic-session',deadline});
    const bridge=app.createOwnedWorkflowHost({parentTaskId:parent.taskId,receiptSecret:'synthetic-workflow-receipt-secret-32',assertActive:()=>{}});
    const submitted=bridge.submit({taskId:parent.taskId,sessionId:'synthetic-session',workflowId:'F23',controlRevision:1,deadline},proposal);
    const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
      assert.fail('synthetic HostTask did not reach expected state');};
    await wait(()=>app.readHostToolTask(submitted.localTaskId).task.state==='waiting_approval');assert.equal(seen,0);
    const approval=app.readHostToolTask(submitted.localTaskId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await wait(()=>['succeeded','failed'].includes(app.readHostToolTask(submitted.localTaskId).task.state));
    const readback=app.readHostToolTask(submitted.localTaskId);
    assert.equal(readback.task.state,'succeeded');assert.equal(readback.confirmed.result.ok,true);assert.equal(seen,1);
    assert.equal(app.runtime.readToolExecutions(submitted.localTaskId)[0].policyDecision,'allow');
  } finally {while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();}
});

for(const scenario of ['allowed','revoked','expired','grant-expired','acceptance-changed']) test(`F23 same-SQLite Policy/acceptance CAS: ${scenario}`,async()=>{
  const root=join(process.cwd(),'.cache','workflow-shadow-authorization');mkdirSync(root,{recursive:true});
  const path=join(mkdtempSync(join(root,'atomic-')),'runtime.sqlite'),scopes=['configuration:release'];
  let now=Date.now(),app,other,authorization,port,setupPort,seen=0;
  const old={threshold:1},next={threshold:2},observedAt=new Date(now-1000).toISOString(),expiresAt=new Date(now+60000).toISOString();
  const acceptance={policyId:'policy',revision:1,configurationId:'config',taskClass:'fixture',validFrom:observedAt,expiresAt,
    baseline:{revision:1,version:'v1',parametersDigest:digest(old),resultBaselineSha256:digest('baseline')},
    candidate:{version:'v2',parametersDigest:digest(next)},conditionsDigest:digest('conditions'),qualityMetricId:'fixture',
    metricRules:[{metric:'qualityScore',bound:'min_delta',value:0}],requiredChecks:['fixture']};
  const args={action:'promote',operationId:'promotion',configurationId:'config',candidateParameters:next,
    main:{branch:'main',observedAt,expiresAt},shadow:{branch:'shadow',observedAt,expiresAt},testEvidence:{observedAt,expiresAt}};
  const body={operationId:args.operationId,configurationId:'config',action:'promote',
    expected:{configurationId:'config',revision:1,version:'v1',parameters:old,parametersDigest:digest(old)},
    next:{configurationId:'config',version:'v2',parameters:next,parametersDigest:digest(next)},
    sourceDigest:digest({acceptance,main:args.main,shadow:args.shadow,testEvidence:args.testEvidence})};
  const write={...body,requestDigest:digest(body)};
  const setupContext={taskId:'synthetic-setup',runId:'synthetic-setup',authorizationRef:'synthetic-setup',scopes,
    signal:new AbortController().signal,deadline:new Date(now+120000).toISOString()};
  const acceptanceBinding={namespace:'synthetic-acceptance',stateKey:'policies',policyId:'policy'};
  const tool=createOwnedWorkflowAdapter({nodeId:'F23_N04',kind:'host',sideEffect:'local_write',requiredScopes:scopes,
    inputSchema:{type:'object',additionalProperties:true},outputSchema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}}},
    execute:async(_input,context)=>{
      seen++;
      if(scenario==='allowed') {
        assert.equal((await port.compareAndSet(write,context)).state,'applied');
      } else {
        await assert.rejects(port.compareAndSet(write,context),{code:'UNAUTHORIZED'});
      }
      return {ok:true};
    }});
  app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-user',tools:[tool]});
  other=new TaskRuntime(path);const client=new Client(app,Date.now);await client.connect();
  try {
    const acceptanceHost=createRuntimeWorkflowShadowAcceptanceHost({runtime:app.runtime,namespace:acceptanceBinding.namespace,
      stateKey:acceptanceBinding.stateKey,requiredScopes:scopes,authorize:async()=>true});
    await acceptanceHost.configure('acceptance-v1',acceptance,setupContext);
    const base={runtime:app.runtime,namespace:'synthetic-configuration',stateKey:'ledger',requiredScopes:scopes,acceptanceBinding};
    setupPort=createRuntimeWorkflowShadowConfigurationPort({...base,authorize:async()=>true,
      initializeGuard:{runtime:app.runtime,assertCurrent:()=>{}},commitGuard:{runtime:app.runtime,assertCurrent:()=>{}}});
    await setupPort.initialize([body.expected],setupContext);
    authorization=createRuntimeWorkflowShadowAuthorization({runtime:app.runtime,hostUserNamespace:'synthetic-user',
      driverCheckpointKey:'driver',requiredScopes:scopes,now:()=>new Date(now),readAcceptance:()=>acceptance});
    port=createRuntimeWorkflowShadowConfigurationPort({...base,authorize:async(context,action,value)=>{
      const allowed=await authorization.authorize(context,action,value);
      // The second real Runtime connection revokes AFTER the async precheck and BEFORE CAS begins.
      if(scenario==='revoked'&&action==='write'&&allowed)other.policy.revoke(context.authorizationRef);
      if(scenario==='expired'&&action==='write'&&allowed)now=Date.parse(expiresAt);
      if(scenario==='grant-expired'&&action==='write'&&allowed)now=Date.parse(context.deadline);
      if(scenario==='acceptance-changed'&&action==='write'&&allowed) {
        const host=createRuntimeWorkflowShadowAcceptanceHost({runtime:other,namespace:acceptanceBinding.namespace,
          stateKey:acceptanceBinding.stateKey,requiredScopes:scopes,authorize:async()=>true});
        await host.configure('acceptance-v2',{...acceptance,revision:2},setupContext);
      }
      return allowed;
    },commitGuard:authorization.commitGuard});
    const parent=app.runtime.submitTask({goal:'Synthetic F23 atomic',conversationId:'synthetic',idempotencyKey:'parent'});
    const deadline=new Date(now+120000).toISOString(),operationId='synthetic-atomic-operation';
    const proposal={kind:'tool_proposal',nodeId:'F23_N04',operationId,proposalId:operationId,inputDigest:digest({arguments:args}),
      originControlRevision:1,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      toolSchemaDigest:digest(tool.descriptor.inputSchema),arguments:args,resourceKeys:[],effect:'write'};
    app.runtime.saveCheckpoint(parent.taskId,'driver',{sessionId:'session',controlRevision:1,result:{state:'awaiting_host',proposals:[proposal]}});
    app.runtime.saveCheckpoint(parent.taskId,'driver:driver-binding',{taskId:parent.taskId,workflowId:'F23',sessionId:'session',deadline});
    const bridge=app.createOwnedWorkflowHost({parentTaskId:parent.taskId,receiptSecret:'synthetic-workflow-receipt-secret-32',assertActive:()=>{}});
    const submitted=bridge.submit({taskId:parent.taskId,sessionId:'session',workflowId:'F23',controlRevision:1,deadline},proposal);
    const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('HostTask did not settle');};
    await wait(()=>app.readHostToolTask(submitted.localTaskId).task.state==='waiting_approval');
    const approval=app.readHostToolTask(submitted.localTaskId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await wait(()=>['succeeded','failed'].includes(app.readHostToolTask(submitted.localTaskId).task.state));
    assert.equal(app.readHostToolTask(submitted.localTaskId).task.state,'succeeded');assert.equal(seen,1);
    const readback=await setupPort.read('config',setupContext),operation=await setupPort.readOperation('promotion',setupContext);
    assert.equal(readback.revision,scenario==='allowed'?2:1);
    assert.equal(operation.state,scenario==='allowed'?'applied':'not_started');
  } finally {while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));other.close();app.close();}
});
