import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {ModelGateway,FakeModelProvider} from '@personal-agent/models';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createPelicanAdaptiveSelector,assertPelicanGraphCompletion,assertPelicanMainAndIsolated,
  assertPelicanBeginOnly,verifyPelicanOperation,pelicanWorkflowConfiguration} from './pelican-repair-live.mjs';
import {createTestImageModelProvider} from './test-image-model-provider.mjs';
import {runOwnedWorkflowParent} from './owned-workflow-live.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const deadline=()=>new Date(Date.now()+60_000).toISOString();
const template=getOwnedWorkflowTemplate('F15'),ids=template.nodes.map(node=>node.id);
const schema={type:'object',properties:{},required:[],additionalProperties:false};
const deployment={provider:'fake',deployment:'explicit-offline-f15-fixture',model:'fixture',verification:'mock',
  capabilities:{text:true,toolCalling:false,structuredOutput:false,streaming:false,vision:false,audioInput:false,audioOutput:false}};
const events=value=>[{event:'message',data:{text:JSON.stringify({testVersion:1,...value})}},{event:'task_end'},{event:'end'}];
const native=value=>new Response(JSON.stringify(events(value)),{headers:{'content-type':'application/json'}});

// Explicit gate-unit fixture. Real Runtime provenance is checked separately below; this data is never a cloud receipt.
function completionFixture() {
  const sourceSha256='1'.repeat(64),currentSha256='2'.repeat(64),operations=[];
  const identity={taskId:'fixture-parent',sessionId:'fixture-session',controlRevision:1,taskDeadline:deadline(),requestedVersion:'fixture-v4'};
  const tools={F15_N01:'workspace.read_text',F15_N04:'workflow.host.f15_n04',F15_N05:'workflow.host.f15_n05',F15_N06:'workflow.host.f15_n06'};
  const graph={workflowId:'F15',workflowVersion:'1.0.0',templateVersion:template.version,templateDigest:template.templateDigest,
    state:'settled',verification:'unverified',proposals:[],unavailable:[],nodes:{}};
  for(const nodeId of ids) {
    const refs=[];
    for(const name of ['decision.choose_candidate',...(tools[nodeId]?[tools[nodeId]]:[])]) {
      const operationId=nodeId+'-'+name.replaceAll('.','-'),ref='evidence-'+operationId;
      const result=name===tools.F15_N06?{patchReadyForReview:true,autoPushBlocked:true,baselineSha256:sourceSha256,currentSha256}
        :name==='decision.choose_candidate'?{selectedId:'explicit-fixture'}:{fixture:true,nodeId};
      operations.push({requestId:'fixture-advance-1',proposal:{nodeId,operationId,toolName:name},
        receipt:{state:'confirmed',result,evidenceRefs:[ref]},verified:{record:{state:'confirmed'}}});refs.push(ref);
      if(name!=='decision.choose_candidate')graph.nodes[nodeId]={state:'completed',value:result};
    }
    graph.nodes[nodeId]={state:'completed',...graph.nodes[nodeId],evidenceRefs:refs};
  }
  const stage={surface:'workflow_advance',operation:'advance',workflowVersion:'1.0.0',...identity,status:'returned',httpStatus:200,
    startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),wallMs:1};
  const stages=[{...stage,requestId:'fixture-advance-1',graphState:'awaiting_host',proposedNodeIds:ids,receiptOperationIds:[]},
    {...stage,requestId:'fixture-advance-2',graphState:'settled',proposedNodeIds:[],receiptOperationIds:operations.map(op=>op.proposal.operationId)}];
  return {graph,binding:{identity,stages,operations,sourceSha256,currentSha256,
    validation:{passed:true,geometryPreserved:true,baselineSha256:sourceSha256,currentSha256,activeAnimations:['back-spin','front-spin','pedal-spin']}}};
}
test('F15 gate requires actual advance records, all six required nodes, settled state and original node Evidence',()=>{
  const original=completionFixture();assert.equal(assertPelicanGraphCompletion(original.graph,original.binding).operationCount,10);
  const mutations=[
    value=>{value.binding.stages[0].operation='model_turn';},
    value=>{value.binding.stages[0].workflowVersion=undefined;},
    value=>{value.binding.stages=[];},
    value=>{delete value.graph.nodes.F15_N06;},
    value=>{value.graph.nodes.F15_N05.state='unknown';},
    value=>{value.graph.state='awaiting_host';},
    value=>{value.graph.proposals=[{nodeId:'F15_N06'}];},
    value=>{value.graph.templateDigest='3'.repeat(64);},
    value=>{value.graph.nodes.F15_N01.evidenceRefs=[];},
    value=>{value.binding.operations[0].receipt.state='unknown';},
    value=>{value.binding.operations[0].verified=undefined;},
    value=>{value.binding.stages[1].receiptOperationIds=[];},
    value=>{value.binding.stages[0].sessionId='other-session';},
    value=>{value.binding.stages[0].requestedVersion='latest';},
    value=>{value.binding.currentSha256='4'.repeat(64);},
    value=>{value.graph.nodes.F15_N06.value={patchReadyForReview:true};},
  ];
  for(const mutate of mutations){const copy=structuredClone(original);mutate(copy);assert.throws(()=>assertPelicanGraphCompletion(copy.graph,copy.binding));}
});
test('a single graph, pending isolated parent or failed persistence cannot pass the two-branch gate',()=>{
  const graphCompletion=assertPelicanGraphCompletion(...(()=>{const value=completionFixture();return [value.graph,value.binding];})());
  const run=mode=>({mode,status:'passed_real_workflow',parentState:'succeeded',graphCompletion,
    persistence:{parentState:'succeeded',allOperationsVerified:true}});
  const report={runs:[run('main'),run('isolated')],comparison:{sameBaseline:true,rootsSeparate:true,mainSourceUnaffectedByShadow:true}};
  assert.doesNotThrow(()=>assertPelicanMainAndIsolated(report));
  for(const change of [copy=>copy.runs.pop(),copy=>{copy.runs[1].parentState='waiting_reconciliation';},
    copy=>{copy.runs[1].persistence.allOperationsVerified=false;},copy=>{copy.comparison.mainSourceUnaffectedByShadow=false;}]) {
    const copy=structuredClone(report);change(copy);assert.throws(()=>assertPelicanMainAndIsolated(copy));
  }
});
test('begin-only scope check rejects unrelated formatting even when XML geometry would be equivalent',async()=>{
  const source=await readFile(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url),'utf8');
  assert.doesNotThrow(()=>assertPelicanBeginOnly(source,source.replaceAll('begin="indefinite"','begin="0s"')));
  assert.doesNotThrow(()=>assertPelicanBeginOnly(source,source.replaceAll(' begin="indefinite"','')));
  assert.throws(()=>assertPelicanBeginOnly(source,source.replaceAll('begin="indefinite"','begin="0s"').replace('  <g','    <g')));
});
test('unqualified Laya upgrades to the existing teacher and completed checkpoint replay never calls a model again',async()=>{
  const runtime=new TaskRuntime(':memory:');let localCalls=0;const records=[];
  try {
    const task=runtime.submitTask({conversationId:'offline-f15',goal:'fixture candidate gate',idempotencyKey:'f15-adaptive'});
    const teacherProvider=new FakeModelProvider([{kind:'final',text:JSON.stringify({selectedId:'teacher-choice',rationale:'original candidate matches fixture'})}]);
    const selector=createPelicanAdaptiveSelector({runtime,taskId:task.taskId,laya:{select:async()=>{localCalls++;return 'local-choice';}},
      teacher:new ModelGateway(teacherProvider),modelRevision:'explicit-unqualified-offline-fixture',onRecord:record=>records.push(record)});
    const request={requestId:'offline-choice',context:JSON.stringify({workflowId:'F15',nodeId:'F15_N03',nodeContract:{outputFields:['patchDiff']},
      candidateValues:[{id:'local-choice',value:{}},{id:'teacher-choice',value:{}}]}),
      candidates:[{id:'local-choice',description:'offline local candidate'},{id:'teacher-choice',description:'offline teacher candidate'}],
      deadline:deadline(),signal:new AbortController().signal};
    assert.deepEqual(await selector.select(request),{selectedId:'teacher-choice'});assert.deepEqual(await selector.select(request),{selectedId:'teacher-choice'});
    assert.equal(localCalls,1);assert.equal(teacherProvider.requests.length,1);assert.equal(records[0].decided_by,'deepseek');
    assert.equal(records[0].reason,'unvalidated_decision_site');assert.equal(records[0].teacher.verification,'mock');
    assert.equal(runtime.loadCheckpoint(task.taskId,'adaptive:request:offline-choice').selectedId,'teacher-choice');
    assert.ok(runtime.loadCheckpoint(task.taskId,'adaptive:request:offline-choice:intent'));
    await assert.rejects(selector.select({...request,candidates:[{id:'local-choice',description:'changed original candidate'},{id:'teacher-choice',description:'original'}]}),{code:'REVISION_CONFLICT'});
  }finally{runtime.close();}
});
test('invalid teacher choice is rejected and its original pending intent prevents a retry',async()=>{
  const runtime=new TaskRuntime(':memory:');let calls=0;
  try {
    const task=runtime.submitTask({conversationId:'offline-f15',goal:'reject malformed teacher',idempotencyKey:'bad-choice'});
    const selector=createPelicanAdaptiveSelector({runtime,taskId:task.taskId,laya:{select:async()=> 'first'},modelRevision:'fixture',
      teacher:{deployment,complete:async()=>{calls++;return {deployment,response:{kind:'final',text:'{"selectedId":"invented","rationale":"bad fixture"}'}};}}});
    const request={requestId:'bad-choice',context:JSON.stringify({workflowId:'F15',nodeId:'F15_N02'}),
      candidates:[{id:'first',description:'original first'},{id:'second',description:'original second'}],signal:new AbortController().signal,deadline:deadline()};
    await assert.rejects(selector.select(request),/original candidate/);await assert.rejects(selector.select(request),{code:'RESULT_UNKNOWN'});assert.equal(calls,1);
  }finally{runtime.close();}
});
test('trusted versioned cloud teacher adapter uses exact endpoint, two auth layers, original deadline and separate request metadata',async()=>{
  const calls=[],records=[],originalDeadline=deadline(),url='https://fixture.invalid/runtimes/fixture-runtime/invocations?endpoint=fixture-v4';
  const provider=await createTestImageModelProvider({url,token:'explicit-inner-fixture',inboundAuthorization:'Bearer explicit-outer-fixture',
    deadline:originalDeadline,onRecord:record=>records.push(record),fetchImpl:async(endpoint,options)=>{
      const input=JSON.parse(JSON.parse(options.body).query);calls.push({endpoint:String(endpoint),options,input});
      return native(input.operation==='capabilities'?{models:[{ref:'plan',deployment}]}:{result:{deployment,response:{kind:'final',text:'fixture teacher text'}}});
    }});
  await provider.complete({tools:[],messages:[{role:'user',content:'explicit public offline fixture'}],deadline:new Date(Date.now()+120_000).toISOString()});
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.endpoint===url&&call.options.redirect==='error'));
  assert.equal(calls[1].options.headers.authorization,'Bearer explicit-outer-fixture');assert.equal(calls[1].options.headers['x-pa-agent-token'],'Bearer explicit-inner-fixture');
  assert.equal(calls[1].options.headers['x-pa-deadline'],originalDeadline);assert.equal(calls[1].input.operation,'model_turn');
  assert.ok(records.every(row=>row.surface==='auxiliary_test_version_model'&&row.requestedVersion==='fixture-v4'));
  assert.equal(records.at(-1).status,'returned');assert.ok(records.at(-1).wallMs>=0);
  assert.equal(JSON.stringify(records).includes('explicit-inner-fixture'),false);assert.equal(JSON.stringify(records).includes('explicit-outer-fixture'),false);
  let network=0;
  for(const bad of [url+'&token=forbidden',url+'&endpoint=second',url.replace('?endpoint=fixture-v4',''),url.replace('https:','http:')])
    await assert.rejects(createTestImageModelProvider({url:bad,token:'fixture',inboundAuthorization:'Bearer fixture',deadline:deadline(),fetchImpl:async()=>{network++;}}));
  assert.equal(network,0);
});
test('teacher envelope, cancellation and declared tools fail closed without promoting model text to graph evidence',async()=>{
  const token='explicit-public-fixture',endpoint='http://127.0.0.1:8080/invocations';
  await assert.rejects(createTestImageModelProvider({url:endpoint,token,deadline:deadline(),fetchImpl:async()=>new Response(JSON.stringify(events({models:[{ref:'plan',deployment}]}).slice(0,-1)))}),/envelope/);
  const cancelled=new AbortController();cancelled.abort();let calls=0;
  await assert.rejects(createTestImageModelProvider({url:endpoint,token,deadline:deadline(),signal:cancelled.signal,fetchImpl:async()=>{calls++;}}),{code:'CANCELLED'});assert.equal(calls,0);
  const provider=await createTestImageModelProvider({url:endpoint,token,deadline:deadline(),fetchImpl:async()=>native({models:[{ref:'plan',deployment}]})});
  await assert.rejects(provider.complete({tools:[{name:'not-advertised'}],messages:[],deadline:deadline()}),{code:'INVALID_ARGUMENT'});
});
test('launcher aliases retain trusted endpoint validation and explicit F15 version without exposing credentials',()=>{
  const config=pelicanWorkflowConfiguration({url:'https://fixture.invalid/runtimes/fixture-runtime/invocations?endpoint=fixture-v4',
    innerAuth:'explicit-inner-fixture-token-1234567890',inboundAuth:'explicit-outer-fixture',deadline:deadline(),
    localLaya:{modelPath:'C:/explicit-offline-fixture/model',python:'C:/explicit-offline-fixture/python.exe',port:18080,device:'cuda'}});
  assert.equal(config.runtime,'fixture-runtime');assert.equal(config.version,'fixture-v4');assert.equal(config.workflowId,'F15');
  assert.equal(config.innerAuthorization,'Bearer explicit-inner-fixture-token-1234567890');
});
test('actual Runtime Policy/ToolGateway receipt survives SQLite reopen and rejects absent cache or Evidence',async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'f15-operation-fixture-')),path=join(directory,'runtime.sqlite');
  const adapter=createOwnedWorkflowAdapter({nodeId:'F15_N05',kind:'host',inputSchema:schema,outputSchema:{type:'object'},
    sideEffect:'local_write',requiredScopes:['workspace:read','workspace:write'],execute:async()=>({publicFixture:true,performed:true})});
  const app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',hostUserNamespace:'explicit-f15-fixture',tools:[adapter]});
  const client=new Client(app);await client.connect();const secret='explicit-offline-receipt-secret-1234567890';let receipt,proposal,identity;
  const parent=app.runtime.submitTask({conversationId:'offline-f15',goal:'actual local fixture only',idempotencyKey:directory});
  try {
    const originalDeadline=deadline();identity={taskId:parent.taskId,workflowId:'F15',sessionId:'offline-f15-session',controlRevision:1,
      deadline:originalDeadline,taskDeadline:originalDeadline};
    const bridge=app.createOwnedWorkflowHost({receiptSecret:secret,assertActive:id=>assert.equal(app.runtime.getTask(id).state,'running')});
    proposal={kind:'tool_proposal',nodeId:'F15_N05',operationId:'offline-f15-write',proposalId:'offline-f15-write',inputDigest:hash({}),
      originControlRevision:1,toolSchemaDigest:hash(schema),toolName:adapter.descriptor.name,toolVersion:adapter.descriptor.version,
      arguments:{},resourceKeys:['explicit-public-fixture'],effect:'write'};
    const result=await runOwnedWorkflowParent(app.runtime,parent.taskId,async()=>{
      const local=await bridge.submitWithShadow(identity,proposal);let readback,approved=false;
      while(Date.now()<Date.parse(originalDeadline)) {
        readback=app.readHostToolTask(local.localTaskId);
        if(readback.task.state==='waiting_approval'&&readback.approval?.state==='pending') {
          await client.call('authorization.respond',{approvalId:readback.approval.approvalId,expectedRevision:readback.approval.revision,decision:'allow_once'});approved=true;
        }
        if(['succeeded','failed','waiting_reconciliation','cancelled'].includes(readback.task.state))break;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      assert.equal(approved,true);assert.equal(readback.task.state,'succeeded',JSON.stringify(readback.task.error));
      receipt=await bridge.readReceiptWithShadow(identity,proposal);
      const verified=await verifyPelicanOperation(app.runtime,identity,proposal,receipt,secret);
      assert.equal(verified.record.policyDecision,'allow');assert.equal(verified.record.executionStarted,true);
      return {resultSummary:'Explicit offline Runtime fixture only',evidenceRefs:receipt.evidenceRefs};
    },{deadline:originalDeadline});assert.equal(result.state,'succeeded');
  }finally{while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();}
  const restored=new TaskRuntime(path);
  try {
    const verified=await verifyPelicanOperation(restored,identity,proposal,receipt,secret);assert.equal(verified.record.state,'confirmed');
    await assert.rejects(verifyPelicanOperation({getTask:restored.getTask.bind(restored),readToolExecutions:restored.readToolExecutions.bind(restored),
      loadCheckpoint:restored.loadCheckpoint.bind(restored),matchesToolExecutionInput:restored.matchesToolExecutionInput.bind(restored),readEvidence:()=>[]},identity,proposal,receipt,secret),/Evidence/);
    await assert.rejects(verifyPelicanOperation({getTask:restored.getTask.bind(restored),readToolExecutions:restored.readToolExecutions.bind(restored),
      loadCheckpoint:(id,key)=>key.startsWith('tool-result-')?undefined:restored.loadCheckpoint(id,key),
      matchesToolExecutionInput:restored.matchesToolExecutionInput.bind(restored),readEvidence:restored.readEvidence.bind(restored)},identity,proposal,receipt,secret));
    await assert.rejects(verifyPelicanOperation(restored,identity,{...proposal,arguments:{tampered:true}},receipt,secret),/signed receipt/);
  }finally{restored.close();}
});
