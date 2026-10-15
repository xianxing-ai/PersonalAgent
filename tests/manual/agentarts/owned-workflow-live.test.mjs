import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {TaskRuntime} from '@personal-agent/runtime';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {parseOwnedWorkflowInvocationBody,ownedWorkflowInvocationTarget,ownedWorkflowPublicFixture,ownedWorkflowFixtureInput,
  ownedApiDocCandidate,ownedApiDocCompletion,checkOwnedPublicApiDocs,runOwnedWorkflowParent,ownedWorkflowLiveConfiguration,ownedWorkflowLayaLogs} from './owned-workflow-live.mjs';

const require=createRequire(import.meta.url),hash=value=>createHash('sha256').update(value).digest('hex');
const publicDoc='# Greeting\nPOST /v1/public/greeting\nname: string; language?: zh-CN | en-US; response.message: string.\nSource: owned-workflow-public-fixture.txt\n';

const graph={workflowVersion:'1.0.0',verification:'unverified',workflowId:'F20',state:'awaiting_host',nodes:{},checkpoint:'test'};
const events=[{event:'message',data:{text:JSON.stringify(graph)}},{event:'task_end'},{event:'end'}];

test('F20 public fixture contains source, contract/schema and a real documentation difference instead of a read-only banner',()=>{
  const fixture=ownedWorkflowPublicFixture('F20'),source=JSON.parse(fixture.content),input=ownedWorkflowFixtureInput('F20');
  assert.equal(fixture.name,'owned-workflow-public-fixture.txt');
  assert.match(source.contractTypeScript,/GreetingRequest/);assert.match(source.implementationTypeScript,/buildGreeting/);
  assert.equal(source.jsonSchema.additionalProperties,false);
  assert.deepEqual(source.jsonSchema.properties.language.enum,['zh-CN','en-US']);
  assert.equal(source.documentedFields.includes('language'),false);assert.equal(source.expectedDifference.field,'language');
  assert.deepEqual(Object.keys(source.exampleArguments).sort(),['language','name']);
  assert.equal(input.schemaFile,fixture.name);assert.equal(input.codeFile,fixture.name);assert.equal(input.field,'language');
  assert.equal(input.targetDoc,'owned-api-final-doc.md');
  assert.equal(input.docTemplate,fixture.name+'#docTemplate');assert.deepEqual(input.expectedOutputFields,['diffFields','docMarkdown','exampleArguments']);
  assert.match(input.goal,/actual source and validation receipts/);
  assert.match(input.goal,/Do not claim it was written, published or synchronized externally/);
  assert.match(ownedWorkflowPublicFixture('F15').content,/synthetic/);
});

test('completion requires every F20 node, both original tool evidences and the exact source-supported candidate document',()=>{
  const candidate={diffFields:['language'],docMarkdown:publicDoc,exampleArguments:{name:'Public fixture',language:'zh-CN'}};
  assert.deepEqual(ownedApiDocCandidate(candidate),candidate);
  assert.throws(()=>ownedApiDocCandidate({docMarkdown:'',exampleArguments:{}}));
  const binding={sourceSha256:'1'.repeat(64),candidateSha256:'2'.repeat(64),docSha256:hash(publicDoc)};
  const check={state:'passed',compiler:{exitCode:0},checks:{typeCheckPassed:true,noPhantomFields:true,sourceDifferenceMatched:true},
    source:{sha256:binding.sourceSha256},candidate:{sha256:binding.candidateSha256,docSha256:binding.docSha256}};
  const graph={workflowId:'F20',state:'settled',proposals:[],unavailable:[],nodes:{
    F20_N01:{state:'completed',evidenceRefs:['original-read']},F20_N02:{state:'completed',value:candidate},
    F20_N03:{state:'completed',evidenceRefs:['original-check']},F20_N04:{state:'completed',value:{docMarkdown:publicDoc,
      docVersion:'public-fixture-1',synchronized:false,sourceRefs:['owned-workflow-public-fixture.txt','owned-api-check-result.json']}}}};
  const options={...binding,check,sourceEvidenceRefs:['original-read'],checkEvidenceRefs:['original-check']};
  assert.deepEqual(ownedApiDocCompletion(graph,options).evidenceRefs,['original-read','original-check']);
  for(const nodeId of ['F20_N01','F20_N02','F20_N03','F20_N04']) {
    assert.throws(()=>ownedApiDocCompletion({...graph,nodes:{...graph.nodes,[nodeId]:{state:'unknown'}}},options));
  }
  assert.throws(()=>ownedApiDocCompletion({...graph,state:'progress'},options));
  assert.throws(()=>ownedApiDocCompletion(graph,{...options,checkEvidenceRefs:['invented-check']}));
  assert.throws(()=>ownedApiDocCompletion(graph,{...options,check:{...check,source:{sha256:'wrong'}}}));
  assert.throws(()=>ownedApiDocCompletion(graph,{...options,check:{...check,checks:{...check.checks,sourceDifferenceMatched:false}}}));
  assert.throws(()=>ownedApiDocCompletion({...graph,nodes:{...graph.nodes,F20_N04:{state:'completed',value:{docMarkdown:publicDoc,written:true}}}},options));
  assert.throws(()=>ownedApiDocCompletion({...graph,nodes:{...graph.nodes,F20_N04:{state:'completed',value:{docMarkdown:publicDoc+'changed'}}}},options));
  assert.throws(()=>ownedApiDocCompletion({...graph,nodes:{...graph.nodes,F20_N04:{state:'completed',value:{...graph.nodes.F20_N04.value,synchronized:true}}}},options));
});

test('fixed public checker runs the installed real TypeScript compiler and rejects phantom parameters and changed artifact binding',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'checker-test-')),fixture=ownedWorkflowPublicFixture('F20');
  await writeFile(join(directory,fixture.name),fixture.content);
  const candidate={diffFields:['language'],docMarkdown:publicDoc,exampleArguments:{name:'Public fixture',language:'zh-CN'}};
  const stage=async(value)=>{const encoded=JSON.stringify(value,null,2)+'\n';await writeFile(join(directory,'owned-api-selected-candidate.json'),encoded);
    await writeFile(join(directory,'owned-api-validation-binding.json'),JSON.stringify({sourceSha256:hash(fixture.content),
      candidateSha256:hash(encoded),docSha256:hash(value.docMarkdown)}));};
  await stage(candidate);
  const compiler=require.resolve('typescript/bin/tsc'),deadline=new Date(Date.now()+120_000).toISOString();
  const valid=await checkOwnedPublicApiDocs(directory,compiler,deadline);
  assert.equal(valid.state,'passed');assert.equal(valid.compiler.exitCode,0);assert.equal(valid.checks.typeCheckPassed,true);
  assert.equal(valid.checks.noPhantomFields,true);assert.equal(valid.source.sha256,hash(fixture.content));
  assert.equal(valid.candidate.docMarkdown,publicDoc);assert.match(valid.compiler.version,/^\d+\.\d+\.\d+$/);
  assert.equal(valid.checks.sourceDifferenceMatched,true);assert.deepEqual(valid.candidate.diffFields,['language']);
  assert.match(await readFile(join(directory,'owned-api-example.ts'),'utf8'),/buildGreeting\(example\)/);
  await stage({...candidate,exampleArguments:{...candidate.exampleArguments,phantom:true}});
  const invalid=await checkOwnedPublicApiDocs(directory,compiler,deadline);
  assert.equal(invalid.state,'failed');assert.notEqual(invalid.compiler.exitCode,0);assert.equal(invalid.checks.noPhantomFields,false);
  await stage({...candidate,diffFields:[]});
  const missed=await checkOwnedPublicApiDocs(directory,compiler,deadline);
  assert.equal(missed.compiler.exitCode,0);assert.equal(missed.state,'failed');assert.equal(missed.checks.sourceDifferenceMatched,false);
  await writeFile(join(directory,'owned-api-selected-candidate.json'),JSON.stringify(candidate));
  await assert.rejects(checkOwnedPublicApiDocs(directory,compiler,deadline),{code:'PUBLIC_ARTIFACT_BINDING_MISMATCH'});
  await assert.rejects(checkOwnedPublicApiDocs(directory,compiler,new Date(0).toISOString()),{code:'TIMEOUT'});
});

test('real public compiler recipe keeps local_write Policy approval, actual ToolGateway Evidence and legal parent Runtime completion',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'policy-check-test-')),fixture=ownedWorkflowPublicFixture('F20'),candidate={diffFields:['language'],docMarkdown:publicDoc,
    exampleArguments:{name:'Public fixture',language:'en-US'}},candidateText=JSON.stringify(candidate,null,2)+'\n';
  await writeFile(join(directory,fixture.name),fixture.content);
  await writeFile(join(directory,'owned-api-selected-candidate.json'),candidateText);
  await writeFile(join(directory,'owned-api-validation-binding.json'),JSON.stringify({sourceSha256:hash(fixture.content),candidateSha256:hash(candidateText),docSha256:hash(publicDoc)}));
  const deadline=new Date(Date.now()+120_000).toISOString(),script=fileURLToPath(new URL('./owned-workflow-live.mjs',import.meta.url));
  const command=createWorkspaceCommandTool({rootPath:directory,recipes:[{id:'validate-public-api-docs',executable:process.execPath,
    args:[script,'--check-public-api-docs',require.resolve('typescript/bin/tsc'),deadline]}]});
  assert.equal(command.descriptor.sideEffect,'local_write');let executions=0;
  const database=join(directory,'runtime.sqlite'),app=createRuntimeApplication({path:database,profile:'huawei_ict_agentarts',
    hostUserNamespace:'synthetic-unit-public-checker',
    tools:[{descriptor:command.descriptor,execute:async(...args)=>{executions++;return command.execute(...args);}}]});
  const parent=app.runtime.submitTask({goal:'Public isolated compiler fixture',conversationId:'synthetic-unit-only',idempotencyKey:directory});
  let childId,receipt;
  const wait=async(states)=>{while(Date.now()<Date.parse(deadline)){const task=app.runtime.getTask(childId);if(states.includes(task.state))return task;
    await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('PUBLIC_TEST_DEADLINE');};
  try {
    const secret='synthetic-unit-only-receipt-secret-at-least-32-bytes',request={taskId:parent.taskId,sessionId:'public-policy-test',workflowId:'F20',controlRevision:1,deadline};
    const proposal={kind:'tool_proposal',nodeId:'F20_N03',proposalId:'public-policy-op',operationId:'public-policy-op',
      inputDigest:'1'.repeat(64),originControlRevision:1,toolSchemaDigest:hash(JSON.stringify(command.descriptor.inputSchema)),
      toolName:command.descriptor.name,toolVersion:command.descriptor.version,arguments:{recipeId:'validate-public-api-docs'},resourceKeys:[],effect:'write'};
    const bridge=new OwnedWorkflowHostBridge({host:app,receiptSecret:secret,
      checkpoints:{read:(task,key)=>app.runtime.loadCheckpoint(task,key),writeOnce:(task,key,value)=>app.runtime.saveCheckpointOnce(task,key,value)},
      assertActive:(task,revision)=>{assert.equal(task,parent.taskId);assert.equal(revision,1);assert.equal(app.runtime.getTask(task).state,'running');}});
    const completed=await app.runtime.runTask(parent.taskId,async()=>{
      childId=bridge.submit(request,proposal).localTaskId;
      const pending=await wait(['waiting_approval','failed','succeeded','waiting_reconciliation']);
      assert.equal(pending.state,'waiting_approval');assert.equal(executions,0);
      const approval=app.readHostToolTask(childId).approval,client=new Client(app);await client.connect();
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      assert.equal((await wait(['succeeded','failed','waiting_reconciliation'])).state,'succeeded');
      receipt=bridge.readReceipt(request,proposal);assert.equal(receipt.state,'confirmed');
      const payload=JSON.parse(receipt.result.stdout);assert.equal(payload.state,'passed');assert.equal(payload.compiler.exitCode,0);
      assert.equal(executions,1);assert.equal(app.runtime.readToolExecutions(childId)[0].policyDecision,'allow');
      assert.equal(app.runtime.readEvidence(childId).length,1);
      assert.equal(await createOwnedWorkflowReceiptVerifier({secret}).verify(receipt,proposal,request),true);
      return {resultSummary:'Actual compiler receipt verified in an isolated local fixture; no cloud/model was invoked.',evidenceRefs:receipt.evidenceRefs};
    },{deadline,sideEffect:'local_write'});
    assert.equal(completed.state,'succeeded',JSON.stringify(completed.error));assert.deepEqual(completed.evidenceRefs,receipt.evidenceRefs);
    assert.ok(app.runtime.readEvents().some(event=>event.taskId===parent.taskId&&event.type==='task.completed'));
  }finally{while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));app.close();}
  const reopened=new TaskRuntime(database);try{
    assert.equal(reopened.getTask(parent.taskId).state,'succeeded');assert.equal(reopened.getTask(childId).state,'succeeded');
    assert.equal(reopened.readToolExecutions(childId).length,1);assert.equal(reopened.readEvidence(childId).length,1);
  }finally{reopened.close();}
});

test('parent deadline does not close Runtime while the original worker is still settling or convert late results to success',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'deadline-test-')),clock=new Date('2030-01-01T00:00:00Z');
  const runtime=new TaskRuntime(join(directory,'runtime.sqlite'),{now:()=>clock});
  const task=runtime.submitTask({goal:'Synthetic local deadline lifecycle only',conversationId:'unit-deadline',idempotencyKey:'unit-deadline'});
  let settled=false;
  try {
    const result=await runOwnedWorkflowParent(runtime,task.taskId,async context=>{
      await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));
      await new Promise(resolve=>setImmediate(resolve));
      context.saveCheckpoint('original-worker-settled',{aborted:context.signal.aborted});
      settled=true;return {resultSummary:'Late callback cannot make this task succeed.'};
    },{deadline:new Date(clock.getTime()+40).toISOString(),sideEffect:'local_write'});
    assert.equal(settled,true);assert.equal(result.state,'waiting_reconciliation');
    assert.deepEqual(runtime.loadCheckpoint(task.taskId,'original-worker-settled'),{aborted:true});
    assert.equal(runtime.getTask(task.taskId).state,'waiting_reconciliation');
  }finally{runtime.close();}
});

test('already expired parent deadline returns without waiting for a worker that Runtime never started',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'expired-deadline-test-')),runtime=new TaskRuntime(join(directory,'runtime.sqlite'));
  const task=runtime.submitTask({goal:'Synthetic expired parent lifecycle only',conversationId:'unit-expired',idempotencyKey:'unit-expired'});
  let calls=0,timer;
  try {
    const result=await Promise.race([runOwnedWorkflowParent(runtime,task.taskId,async()=>{calls++;return {resultSummary:'must never run'};},
      {deadline:new Date(0).toISOString(),sideEffect:'local_write'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WRAPPER_DID_NOT_RETURN')),300);})]);
    assert.equal(calls,0);assert.equal(result.state,'waiting_reconciliation');
  }finally{clearTimeout(timer);runtime.close();}
});

test('manual live receipt target preserves actual configured invoke mode without exporting credentials',()=>{
  for(const invokeMode of ['published','debug']) {
    const value=ownedWorkflowInvocationTarget({runtime:'public-runtime',version:'Latest',invokeMode,
      inboundAuthorization:'private',innerAuthorization:'private',receiptSecret:'private'});
    assert.equal(value.invokeMode,invokeMode);assert.equal(value.runtime,'public-runtime');
    assert.equal(value.requestedVersion,'Latest');assert.equal(value.requestedVersionVerified,false);
    assert.deepEqual(Object.keys(value).sort(),['expectedSourceRevision','invokeMode','platformDeploymentReadback',
      'requestedVersion','requestedVersionVerified','runtime','validationSurface','kind'].sort());
    assert.equal(JSON.stringify(value).includes('private'),false);
  }
});

test('image-live is explicitly admitted only for one strict loopback HTTP invocation endpoint and never replaces cloud mode',()=>{
  const input={operation:'image-live',invocationUrl:'http://127.0.0.1:18080/invocations',runtimeName:'public-owned-image',version:'local-image',
    inboundAuthorization:'Bearer synthetic-unit-only-inbound',innerAuthorization:'Bearer synthetic-unit-only-owned-token-at-least-32-bytes',
    deadline:new Date(Date.now()+120_000).toISOString(),workflowId:'F20'};
  const config=ownedWorkflowLiveConfiguration(input),target=ownedWorkflowInvocationTarget(config);
  assert.equal(config.operation,'image-live');assert.equal(config.url,input.invocationUrl);
  assert.equal(target.validationSurface,'local_owned_image');assert.equal(target.platformDeploymentReadback,'not_applicable_local_execution');
  assert.equal(target.requestedVersionVerified,false);
  for(const invocationUrl of ['http://localhost:18080/invocations','http://127.0.0.1/invocations',
    'http://127.0.0.1:65536/invocations','http://127.0.0.1:18080/invocations?endpoint=Latest',
    'http://user:pass@127.0.0.1:18080/invocations','http://127.0.0.1:18080/other','http://192.168.1.2:18080/invocations',
    'https://127.0.0.1:18080/invocations'])assert.throws(()=>ownedWorkflowLiveConfiguration({...input,invocationUrl}),{code:'INVALID_TRUSTED_ENDPOINT'});
  assert.throws(()=>ownedWorkflowLiveConfiguration({...input,gatewayUrl:'https://public.example.invalid'}),{code:'INVALID_TRUSTED_ENDPOINT'});
  assert.throws(()=>ownedWorkflowLiveConfiguration({...input,operation:'live'}),{code:'INVALID_TRUSTED_ENDPOINT'});
  const native=ownedWorkflowLiveConfiguration({...input,operation:'runtime-live'}),nativeTarget=ownedWorkflowInvocationTarget(native);
  assert.equal(native.operation,'runtime-live');assert.equal(nativeTarget.kind,'local_owned_source_runtime');
  assert.equal(nativeTarget.validationSurface,'local_owned_source_runtime');assert.equal(nativeTarget.requestedVersionVerified,false);
});

test('explicit owned-image log projection keeps real token accounting without filling missing historical telemetry',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'log-test-')),path=join(directory,'public-events.jsonl');
  const window={formatVersion:'1.0.0',truncated:false,droppedTokens:0,encoderMaxTokens:8192,maxLength:2001,headMaxLength:512,
    stateTokens:[1890],requiredSequenceTokens:[2001],expectedInputTokens:[2001],headerTokens:[110],encodedTokens:2001};
  await writeFile(path,[{event:'laya_choice',model:'multilingual',requestId:'public-request',candidateId:'candidate-001',durationMs:100,
    tokenWindow:window,queueWaitMs:9,fullCriterionDescriptions:'included_in_selector_state',privateState:'must not leave the input file'},
    {event:'laya_choice',model:'multilingual',requestId:'old-request',candidateId:'old-candidate',durationMs:50}].map(value=>JSON.stringify(value)).join('\n'));
  const value=await ownedWorkflowLayaLogs(path,['public-request','old-request'],'local_owned_image');
  assert.equal(value.status,'correlated_supplied_image_log');assert.equal(value.records[0].tokenWindow.encodedTokens,2001);
  assert.equal(value.records[0].queueWaitMs,9);assert.equal(value.records[0].tokenWindowValidated,true);
  assert.equal(value.records[1].tokenWindowStatus,'not_recorded');assert.equal(Object.hasOwn(value.records[1],'queueWaitMs'),false);
  assert.equal(JSON.stringify(value).includes('must not leave'),false);
});

test('workflow log projection retains one shared batch identity across independently correlated request rows',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/owned-workflow-live/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'batch-log-test-')),path=join(directory,'public-events.jsonl');
  const batchId='11111111-2222-4333-8444-555555555555';
  await writeFile(path,['public-first','public-second'].map((requestId,index)=>JSON.stringify({event:'laya_choice',model:'multilingual',
    requestId,candidateId:'candidate-'+index,durationMs:30+index,batchId,batchSize:2,submittedBatchSize:2,
    batchItemId:`11111111-2222-4333-8444-55555555555${index}`,sharedForwardScope:'sdk_heterogeneous_forward',
    inferenceMetrics:{forwardScope:'sdk_heterogeneous_forward',forwardMs:25},privateState:'never export batch state'})).join('\n'));
  const value=await ownedWorkflowLayaLogs(path,['public-first','public-second'],'local_owned_source_runtime');
  assert.equal(value.status,'correlated_supplied_runtime_log');assert.equal(value.records.length,2);
  assert.ok(value.records.every(item=>item.batchId===batchId&&item.batchSize===2&&item.sharedForwardScope==='sdk_heterogeneous_forward'));
  assert.equal(new Set(value.records.map(item=>item.batchId)).size,1);
  assert.equal(new Set(value.records.map(item=>item.batchItemId)).size,2);assert.ok(value.records.every(item=>item.submittedBatchSize===2));
  assert.equal(JSON.stringify(value).includes('forwardMs'),false);assert.equal(JSON.stringify(value).includes('never export'),false);
});

test('manual live parser accepts native owned-image JSON message/task_end/end without invoking anything',()=>{
  assert.deepEqual(parseOwnedWorkflowInvocationBody(JSON.stringify(events),'application/json; charset=utf-8'),graph);
});
test('manual live parser accepts native data-event SSE and event-named SSE with CRLF framing',()=>{
  const dataFrames=events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('');
  assert.deepEqual(parseOwnedWorkflowInvocationBody(dataFrames,'text/event-stream'),graph);
  const namedFrames=events.map(({event,...value})=>'event: '+event+'\r\ndata: '+JSON.stringify(value)+'\r\n\r\n').join('');
  assert.deepEqual(parseOwnedWorkflowInvocationBody(namedFrames,'text/event-stream; charset=utf-8'),graph);
});
test('manual live parser respects current native null metadata and indexed-message deduplication',()=>{
  const message={event:'message',data:{text:JSON.stringify(graph),index:0}};
  assert.deepEqual(parseOwnedWorkflowInvocationBody(JSON.stringify([{event:'message',data:{text:null,index:-10}},message,message,...events.slice(1)]),'application/json'),graph);
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify([message,{...message,data:{text:'replacement',index:0}},...events.slice(1)]),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify([{...message,data:{...message.data,status:'UPSTREAM_FAILED'}},...events.slice(1)]),'application/json'));
});
test('manual live parser rejects incomplete, reordered, provider-failed and wrong application envelopes',()=>{
  const invalids=[events.slice(0,-1),[events[0],events[2],events[1]],
    [events[0],{event:'error',data:{error_code:'secret-provider-data'}},...events.slice(1)],
    [{event:'message',data:{text:JSON.stringify({...graph,verification:'verified'})}},...events.slice(1)],
    [{event:'message',data:{text:JSON.stringify({...graph,workflowVersion:'999'})}},...events.slice(1)]];
  for(const value of invalids)assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify(value),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify(graph),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody('data: [DONE]\n\n','text/event-stream'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody('data: not-json\n\n','text/event-stream'));
});
