import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestImageModelProvider} from './test-image-model-provider.mjs';
import {ModelGateway,StructuredToolProvider,FakeModelProvider} from '@personal-agent/models';
import {createAgentServer} from '../../../apps/agentarts-runtime/src/server.mjs';
import {createTestVersionController} from '../../../apps/agentarts-runtime/src/test-version-controller.mjs';
import {pelicanAcceptanceContract,pelicanAcceptanceInput,minimalEdit,observeModelStage,summarizeModelCalls,recordBranchFailure,readOnlyToolFailureFeedback,createTestPatchReconciliation} from './pelican-test-version.mjs';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWorkspacePatchPreviewTool,createWorkspacePatchApplyTool} from '@personal-agent/coding-tools';
import {runAgent} from '@personal-agent/agents';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {Client} from '@personal-agent/client';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '@personal-agent/runtime';
const deployment={provider:'fake',deployment:'offline-image-fixture',model:'fixture',verification:'mock',
  capabilities:{text:true,toolCalling:false,structuredOutput:false,streaming:false,vision:false,audioInput:false,audioOutput:false}};
const envelope=value=>({ok:true,json:async()=>([{data:{text:JSON.stringify({testVersion:1,...value})}}])});
const deadline=()=>new Date(Date.now()+10000).toISOString();
test('offline image fixture uses authenticated invocations and structured proposal through ModelGateway',async()=>{
  const calls=[];
  const provider=await createTestImageModelProvider({url:'http://127.0.0.1:8080/invocations',token:'fixture-secret',deadline:deadline(),fetchImpl:async(url,options)=>{
    const value=JSON.parse(JSON.parse(options.body).query);calls.push({url:String(url),options,value});
    return value.operation==='capabilities'?envelope({models:[{ref:'plan',deployment}]}):envelope({result:{deployment,latencyMs:1,response:{kind:'final',text:JSON.stringify({kind:'final',text:'offline fixture'})}}});
  }});
  const result=await new ModelGateway(new StructuredToolProvider(provider)).complete({messages:[{role:'user',content:'fixture'}],
    tools:[{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object'}}],signal:new AbortController().signal,deadline:deadline()});
  assert.equal(result.response.text,'offline fixture');
  assert.equal(calls[1].options.headers['x-pa-agent-token'],'Bearer fixture-secret');
  assert.equal(calls[1].value.modelRef,'plan');assert.equal(calls[1].value.messages[0].role,'system');
  assert.equal('tools' in calls[1].value,false);assert.equal('apiKey' in calls[1].value,false);
});

test('both runners persist attempted and failed model outcomes without treating failure as returned usage',async()=>{
  for(const runner of ['./pelican-test-version.mjs','./wukong-test-version.mjs']) {
    const {observeModelStage,summarizeModelCalls}=await import(runner),calls=[],events=[];
    let rejectCall;
    const provider={deployment:{provider:'explicit-offline-fixture',model:'fixture'},complete:()=>new Promise((resolve,reject)=>{rejectCall=reject;})};
    const pending=observeModelStage(provider,'branch_execution',calls,undefined,row=>events.push(structuredClone(row))).complete({messages:[],tools:[]});
    assert.equal(calls[0].status,'attempted');assert.equal(events[0].event,'model_attempt_started');
    assert.equal(summarizeModelCalls(calls).modelCallOutcomes.pending,1);
    const failure=Object.assign(Error('private fixture error must not be logged'),{code:'EXTERNAL_FAILURE'});
    rejectCall(failure);await assert.rejects(pending,error=>error===failure);
    const summary=summarizeModelCalls(calls);
    assert.equal(summary.modelCalls,1);assert.equal(summary.branchExecutionCalls,1);
    assert.deepEqual([summary.modelCallOutcomes.attempted,summary.modelCallOutcomes.succeeded,summary.modelCallOutcomes.failed,summary.modelCallOutcomes.pending],[1,0,1,0]);
    assert.equal(summary.modelCallOutcomes.failedWallMs,calls[0].wallMs);assert.ok(calls[0].wallMs>=0);
    assert.equal('usage' in calls[0],false);assert.equal('response' in calls[0],false);
    assert.equal(events.at(-1).event,'model_attempt_finished');assert.equal(events.at(-1).status,'failed');
    assert.ok(Date.parse(events.at(-1).endedAt)>=Date.parse(events[0].startedAt));
    assert.equal(JSON.stringify(events).includes('private fixture'),false);
  }
});
test('disabled or missing image role fails closed',async()=>{
  await assert.rejects(createTestImageModelProvider({url:'http://localhost:8080/invocations',token:'x',deadline:deadline(),fetchImpl:async()=>envelope({models:[]})}),/unavailable/);
});
test('transport and malformed envelopes never echo response secrets',async()=>{
  await assert.rejects(createTestImageModelProvider({url:'http://localhost:8080/invocations',token:'x',deadline:deadline(),fetchImpl:async()=>{throw Error('sensitive');}}),error=>!error.message.includes('sensitive'));
  await assert.rejects(createTestImageModelProvider({url:'http://localhost:8080/invocations',token:'x',deadline:deadline(),fetchImpl:async()=>({ok:true,json:async()=>({secret:'sensitive'})})}),/Invalid image model envelope/);
});
test('expired deadline and non-loopback plaintext fail before network',async()=>{
  await assert.rejects(createTestImageModelProvider({url:'http://example.com/invocations',token:'x',deadline:deadline()}),/loopback/);
  await assert.rejects(createTestImageModelProvider({url:'http://localhost:8080/invocations',token:'x',deadline:'2000-01-01T00:00:00Z'}),/expired/);
});
test('delivery edit preserves unchanged surroundings and supports exact CAS text patch',()=>{
  const before='<svg begin="indefinite">geometry</svg>',after='<svg begin="0s">geometry</svg>';
  const edits=minimalEdit(before,after);assert.equal(edits.length,1);
  assert.equal(before.replace(edits[0].oldText,edits[0].newText),after);
  assert.deepEqual(minimalEdit(before,before),[]);
});
test('real HTTP server authenticates inner Bearer token and returns event arrays to image provider',async t=>{
  const validProposal={kind:'tool_proposal',proposal:{toolName:'fixture.read',toolVersion:'1.0.0',arguments:{path:'pelican.svg'}}};
  const token='explicit-public-fixture-token-123456789',upstream=new ModelGateway(new FakeModelProvider([
    {kind:'final',text:'actual HTTP fixture'},{kind:'final',text:JSON.stringify(validProposal)},
  ]));
  const server=createAgentServer({mode:'standalone-validation',authToken:'different-outer-fixture-token-123456789',wssAuthToken:token,
    orchestrator:{invoke:async()=>{throw Error('Must not fall through');}},testVersionController:createTestVersionController({models:{plan:upstream}})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/invocations';
  const provider=await createTestImageModelProvider({url,token,deadline:deadline()});
  const result=await new ModelGateway(provider).complete({tools:[],messages:[{role:'user',content:'fixture'}],deadline:deadline(),signal:new AbortController().signal});
  assert.equal(result.response.text,'actual HTTP fixture');assert.equal(result.deployment.verification,'mock');
  const calls=[],structured=new ModelGateway(new StructuredToolProvider(observeModelStage(provider,'branch_execution',calls)));
  const parsed=await structured.complete({tools:[{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}],
    messages:[{role:'user',content:'Read fixture'}],deadline:deadline(),signal:new AbortController().signal});
  assert.deepEqual(parsed.response,validProposal,'legal proposal survives actual image HTTP and strict parser');
  assert.equal(calls[0].response.text,JSON.stringify(validProposal));assert.equal(calls[0].stopReason,'fixture');
  assert.equal(calls[0].requestSummary.toolCount,0);assert.equal('messages' in calls[0],false);
  const invalid=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':token},body:JSON.stringify({query:JSON.stringify({testVersion:1,operation:'capabilities'})})});
  assert.equal(invalid.status,401);
});
test('raw rejected model proposal and actual Runtime error survive branch failure reporting',async()=>{
  const runtime=new TaskRuntime(':memory:'),calls=[],raw={kind:'tool_proposal',proposal:{toolName:'fixture.read',toolVersion:'1.0.0',arguments:{},authorization:'not-authorized'}};
  try {
    const gateway=new ModelGateway(new StructuredToolProvider(observeModelStage(new FakeModelProvider([{kind:'final',text:JSON.stringify(raw)}]),'branch_execution',calls)));
    const task=runtime.submitTask({conversationId:'diagnostic-fixture',goal:'strict malformed proposal fixture',idempotencyKey:'diagnostic'});
    const outcome=await runtime.runTask(task.taskId,async worker=>gateway.complete({messages:[{role:'user',content:'fixture'}],
      tools:[{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object'}}],deadline:worker.deadline,signal:worker.signal}),{deadline:deadline()});
    assert.equal(outcome.state,'failed');const branch={};
    recordBranchFailure(branch,runtime.getTask(task.taskId),new Error('generic trailing assertion'));
    assert.equal(branch.taskError.code,'UNAUTHORIZED');assert.equal(branch.error,'Tool proposal contains fields outside the tool contract');
    assert.equal(branch.runnerError.message,'generic trailing assertion');assert.deepEqual(JSON.parse(calls[0].response.text),raw);
  }finally {runtime.close();}
});
test('fixed host stages separate planning, escalation and structured branch execution with explicit Laya rejection counts',async()=>{
  const calls=[],provider=new FakeModelProvider([
    {kind:'final',text:'candidate planning'}, {kind:'final',text:'escalated decision'},
    {kind:'final',text:JSON.stringify({kind:'final',text:'branch result'})},
  ]),request={messages:[{role:'user',content:'fixture'}],tools:[],signal:new AbortController().signal,deadline:deadline()};
  await new ModelGateway(observeModelStage(provider,'candidate_planning',calls)).complete(request);
  await new ModelGateway(observeModelStage(provider,'escalated_decision',calls)).complete(request);
  const branch=new ModelGateway(new StructuredToolProvider(observeModelStage(provider,'branch_execution',calls)));
  await branch.complete({...request,tools:[{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object'}}]});
  assert.ok(provider.requests.every(item=>item.tools.length===0),'upstream tools cannot identify branch execution');
  const summary=summarizeModelCalls(calls,[{event:'laya_choice'},{event:'laya_rejected'}],[{decided_by:'deepseek'}]);
  assert.equal(summary.modelCalls,3);assert.equal(summary.candidatePlanningCalls,1);assert.equal(summary.escalatedDecisionCalls,1);
  assert.equal(summary.branchExecutionCalls,1);assert.equal(summary.layaSuccessfulChoiceCalls,1);assert.equal(summary.layaRejectedCalls,1);
  assert.equal('teacherCalls' in summary,false);assert.equal(summary.trainingPerformed,false);
});
test('actual ambiguous read-only preview failure reaches existing agent loop and permits a unique new preview',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-preview-feedback-')),source='alpha marker\nbeta marker\n';
  await writeFile(join(directory,'fixture.txt'),source);
  const sha=createHash('sha256').update(source).digest('hex'),preview=createWorkspacePatchPreviewTool({rootPath:directory}),failures=[];
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'preview-feedback-fixture',tools:[preview],
    automaticTools:[{toolName:preview.descriptor.name,toolVersion:preview.descriptor.version}]});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  const propose=oldText=>({kind:'tool_proposal',proposal:{toolName:preview.descriptor.name,toolVersion:preview.descriptor.version,
    arguments:{path:'fixture.txt',expectedSha256:sha,edits:[{oldText,newText:'updated'}]}}});
  const gateway=new ModelGateway(new FakeModelProvider([propose('marker'),request=>{
    const feedback=JSON.parse(request.messages.at(-1).content).result;
    assert.equal(feedback.toolStatus,'failed');assert.match(feedback.error.message,/ambiguous/);
    return propose('alpha marker');
  },request=>{assert.equal(JSON.parse(request.messages.at(-1).content).result.changed,true);return {kind:'final',text:'unique preview succeeded; no write claimed'};} ]));
  const parent=app.runtime.submitTask({conversationId:'preview-fixture',goal:'preview only',idempotencyKey:'preview'});
  const port={list:()=>[preview.descriptor],invoke:async invocation=>{
    const submitted=app.submitHostToolTask({commandId:invocation.runId,toolName:invocation.toolName,toolVersion:invocation.toolVersion,arguments:invocation.arguments,deadline:invocation.deadline});
    while(true) {
      const actual=app.readHostToolTask(submitted.task.taskId);
      if(actual.task.state==='succeeded')return {state:'confirmed',...actual.confirmed};
      if(actual.task.state==='failed')return readOnlyToolFailureFeedback(app,invocation,actual,failures,preview.descriptor);
      if(Date.now()>Date.parse(invocation.deadline))throw Error('test deadline');
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  }};
  const outcome=await app.runtime.runTask(parent.taskId,async worker=>runAgent(worker,{goal:'inspect and preview',model:gateway,tools:port,maxSteps:4}),{deadline:deadline()});
  assert.equal(outcome.state,'succeeded',JSON.stringify(outcome.error));assert.equal(failures.length,1);assert.equal(failures[0].taskState,'failed');assert.equal(failures[0].feedbackToAgent,true);
  assert.ok(failures[0].evidenceRefs.length);assert.equal(app.runtime.getTask(failures[0].taskId).state,'failed');
  assert.equal(await readFile(join(directory,'fixture.txt'),'utf8'),source);
});
test('failed apply and unknown read results cannot become successful agent feedback',()=>{
  const failures=[],runtime={readToolExecutions:()=>[{state:'failed',errorCode:'INVALID_ARGUMENT',evidenceId:'actual-failed',executionStarted:true}],readEvidence:()=>[{evidenceId:'actual-failed'}]};
  const writeApp={runtime},writeDescriptor={name:'workspace.apply_text_patch',version:'1.0.0',sideEffect:'local_write'};
  assert.equal(readOnlyToolFailureFeedback(writeApp,{toolName:'workspace.apply_text_patch',toolVersion:'1.0.0',taskId:'parent'},
    {task:{taskId:'write',state:'failed',error:{code:'INVALID_ARGUMENT',message:'CAS mismatch'}}},failures,writeDescriptor),null);
  const unknownApp={runtime:{...runtime,readToolExecutions:()=>[{state:'unknown',errorCode:'RESULT_UNKNOWN',evidenceId:'unknown'}]},
    },readDescriptor={name:'workspace.read_text',version:'1.0.0',sideEffect:'read'};
  assert.equal(readOnlyToolFailureFeedback(unknownApp,{toolName:'workspace.read_text',toolVersion:'1.0.0',taskId:'parent'},
    {task:{taskId:'read',state:'waiting_reconciliation',error:{code:'RESULT_UNKNOWN',message:'needs readback'}}},failures,readDescriptor),null);
  assert.ok(failures.every(failure=>!failure.feedbackToAgent));
});
test('Windows actual host patch task awaits approval then writes once with real recovery binding and Evidence',{skip:process.platform!=='win32'},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-bound-apply-')),root=join(directory,'workspace'),recovery=join(directory,'recovery');
  await mkdir(root);await mkdir(recovery);await writeFile(join(root,'fixture.txt'),'before fixture\n');
  const powerShellPath='C:/Program Files/PowerShell/7/pwsh.exe';
  const workspacePatchReconciliation=await createTestPatchReconciliation({rootPath:root,recoveryRootPath:recovery,powerShellPath});
  assert.match(workspacePatchReconciliation.bindingId,/^[a-f0-9]{64}$/);
  const apply=createWorkspacePatchApplyTool({rootPath:root,recoveryRootPath:recovery,powerShellPath});
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'actual-bound-apply-fixture',tools:[apply],workspacePatchReconciliation});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();const expires=Date.now()+60000;
  const task=app.submitHostToolTask({commandId:'actual-apply-fixture',toolName:apply.descriptor.name,toolVersion:apply.descriptor.version,
    arguments:{path:'fixture.txt',expectedSha256:createHash('sha256').update('before fixture\n').digest('hex'),edits:[{oldText:'before fixture',newText:'after fixture'}]},deadline:new Date(expires).toISOString()});
  let approved=false,actual;
  while(Date.now()<expires) {
    actual=app.readHostToolTask(task.task.taskId);
    if(actual.task.state==='waiting_approval') {
      assert.equal(await readFile(join(root,'fixture.txt'),'utf8'),'before fixture\n');
      await client.call('authorization.respond',{approvalId:actual.approval.approvalId,expectedRevision:actual.approval.revision,decision:'allow_once'});approved=true;
    }
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(actual.task.state))break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(approved,true);assert.equal(actual.task.state,'succeeded',JSON.stringify(actual.task.error));
  assert.equal(await readFile(join(root,'fixture.txt'),'utf8'),'after fixture\n');
  const records=app.runtime.readToolExecutions(task.task.taskId);assert.equal(records.length,1);assert.equal(records[0].state,'confirmed');assert.equal(records[0].executionStarted,true);
  assert.ok(app.runtime.readEvidence(task.task.taskId).some(item=>actual.confirmed.evidenceRefs.includes(item.evidenceId)));
});

test('planner, selection context and executor inputs carry the identical begin-only acceptance contract',async()=>{
  const captured=[],provider=new FakeModelProvider([{kind:'final',text:'fixture planning'},{kind:'final',text:'fixture execution'}]);
  const model=new ModelGateway(provider),request={tools:[],deadline:deadline(),signal:new AbortController().signal};
  const plannerMessage={role:'user',content:pelicanAcceptanceInput({goal:'fixture planning',source:'explicit fixture'})};
  await model.complete({...request,messages:[plannerMessage]});
  const selectionPort={decide:async value=>{captured.push(value);return {selectedId:'fixture-candidate'};}};
  await selectionPort.decide({context:pelicanAcceptanceInput({goal:'fixture selection'}),candidates:[{id:'fixture-candidate'}]});
  const executorMessage={role:'system',content:pelicanAcceptanceInput({instructions:'fixture execution with actual failure feedback'})};
  await model.complete({...request,messages:[executorMessage]});
  const inputs=[JSON.parse(provider.requests[0].messages[0].content),JSON.parse(captured[0].context),JSON.parse(provider.requests[1].messages[0].content)];
  for(const input of inputs)assert.deepEqual(input.acceptanceContract,pelicanAcceptanceContract);
  assert.match(pelicanAcceptanceContract.allowedChange,/three existing animateTransform/);
  assert.match(pelicanAcceptanceContract.allowedChange,/removed.*default 0s/);
  assert.match(pelicanAcceptanceContract.preserve,/every other attribute/);
  assert.match(pelicanAcceptanceContract.forbidden,/trigger elements/);
  assert.match(pelicanAcceptanceContract.failureRecovery,/abandon that strategy/);
  assert.equal('selectedId' in inputs[0],false,'contract does not inject a winning plan');
});
