import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine} from '../dist/owned-workflows.js';
import {OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '../dist/owned-workflow-host-bridge.js';
import {getOwnedWorkflowTemplates,getOwnedWorkflowTemplate,getOwnedWorkflowBindings,getOwnedWorkflowDesignCoverage} from '../dist/owned-workflow-templates.js';

const secret='synthetic-workflow-checkpoint-secret-32-chars';
const emptySchema={type:'object',properties:{},required:[],additionalProperties:false};
const tools=names=>names.map(name=>({name,version:'1.0.0',inputSchema:emptySchema}));
const request=(workflowId,extra={})=>({workflowId,input:{goal:'synthetic public task'},taskId:'test-task',controlRevision:1,
  sessionId:'test-session',requestId:'test-request',deadline:new Date(Date.now()+10000).toISOString(),
  signal:new AbortController().signal,availableTools:[],...extra});
const candidates=context=>[
  {id:'candidate',description:'bounded synthetic candidate',value:context.node.kind==='tool'
    ?{toolName:context.node.capabilities[0].name,toolVersion:'1.0.0',arguments:{}}
    :context.node.kind==='host'?{arguments:{}}:{candidateFor:context.node.id}},
  {id:'recheck',description:'missing evidence; no operation',value:{},abstain:true},
];
const selector={select:async()=> 'candidate'};
const engine=options=>new OwnedWorkflowEngine({checkpointSecret:secret,selector,prepareCandidates:async context=>candidates(context),...options});
const next=async (runtime,original,last,extra={})=>runtime.advance({...original,checkpoint:last.checkpoint,...extra});
const receipt=(proposal,state='confirmed',extra={})=>({...proposal,state,result:{public:'readback'},evidenceRefs:['evidence-1'],proof:'synthetic-signed-host-readback',...extra});
const proofVerifier={verify:async value=>value.proof==='synthetic-signed-host-readback'};

test('all 28 compiled templates preserve 185 distinct detail nodes, dependencies, feedback and host boundaries',()=>{
  const all=getOwnedWorkflowTemplates();assert.equal(all.length,28);
  assert.equal(all.reduce((count,template)=>count+template.nodes.length,0),185);
  assert.equal(new Set(all.flatMap(template=>template.nodes.map(node=>node.id))).size,185);
  assert.equal(getOwnedWorkflowBindings().length,28);
  for(const template of all) {
    assert.match(template.templateDigest,/^[a-f0-9]{64}$/);
    const nodes=new Map(template.nodes.map(node=>[node.id,node]));
    for(const node of template.nodes) {
      assert.ok(node.inputFields&&node.outputFields&&node.resourceKeys);
      for(const dependency of node.dependencies) assert.ok(nodes.has(dependency.nodeId));
      if(['host','tool'].includes(node.kind)) assert.ok(node.capabilities.length,`${node.id} has explicit host/tool requirement`);
      if(node.effect==='write') assert.ok(['tool','host'].includes(node.kind),'No model issues an actual write');
    }
  }
  assert.ok(all.find(template=>template.workflowId==='F01').transitions.some(edge=>edge.feedback));
  assert.ok(all.find(template=>template.workflowId==='F05').transitions.some(edge=>edge.feedback));
  all[0].nodes[0].label='mutated';assert.notEqual(getOwnedWorkflowTemplates()[0].nodes[0].label,'mutated');
  assert.equal(getOwnedWorkflowTemplate('owned-F28').workflowId,'F28');
});

test('image workflow catalog retains every design requirement, model assignment and selected-branch join',async()=>{
  const source=JSON.parse(await readFile(new URL('../../../docs/design/workflow-architecture-20261013/source/src/data/architecture.json',import.meta.url),'utf8'));
  for(const feature of source) {
    const template=getOwnedWorkflowTemplate(feature.id);assert.ok(template);
    for(const field of ['category','summary','decisionPoints','designNotes','acceptance'])
      assert.deepEqual(template[field],feature[field]??[],feature.id+' '+field);
    for(const node of feature.nodes) {
      const compiled=template.nodes.find(item=>item.id===node.id);assert.ok(compiled);
      assert.deepEqual(compiled.modelAssignment,node.modelAssignment,node.id+' model assignment');
      assert.equal(compiled.joinMode,node.joinMode,node.id+' join mode');
    }
  }
  const coverage=getOwnedWorkflowDesignCoverage();assert.equal(coverage.workflowCount,28);assert.equal(coverage.nodeCount,185);
  assert.equal(coverage.workflows.length,source.length);assert.match(coverage.projectionSha256,/^[a-f0-9]{64}$/);
});

test('selector receives the current node contract, settled predecessor state and exact candidate values',async()=>{
  const seen=[];const runtime=engine({receiptVerifier:proofVerifier,selector:{select:async value=>{
    seen.push(JSON.parse(value.context));return 'candidate';
  }}});
  const original=request('F20',{availableTools:tools(['workspace.read_text'])});
  const first=await runtime.advance(original),source={content:'public contract data',sha256:'a'.repeat(64)};
  await next(runtime,original,first,{receipts:[receipt(first.proposals[0],'confirmed',{result:source})]});
  const context=seen.find(value=>value.nodeId==='F20_N02');
  assert.equal(context.nodeContract.kind,'executor');assert.equal(context.nodeContract.designKind,'execution_model');
  assert.equal(context.label,'执行模型生成文档补丁与示例');
  assert.deepEqual(context.nodeContract.inputFields,['field','docTemplate']);
  assert.deepEqual(context.nodeContract.outputFields,['docMarkdown']);assert.equal(context.nodeContract.effect,'none');
  assert.deepEqual(context.predecessorStates,{F20_N01:'completed'});
  assert.deepEqual(context.predecessors.F20_N01,source);assert.deepEqual(context.input,original.input);
  assert.deepEqual(context.candidateValues.find(value=>value.id==='candidate').value,{candidateFor:'F20_N02'});
  assert.equal(context.candidateValues.find(value=>value.id==='recheck').abstain,true);
  const firstContext=seen.find(value=>value.nodeId==='F20_N01');
  assert.equal(firstContext.label,'比对后端代码与契约文件');assert.equal(firstContext.nodeContract.kind,'tool');
  assert.deepEqual(firstContext.nodeContract.outputFields,['diffFields'],'Reviewed design output fields remain declarations until an actual host result');
  assert.equal(firstContext.currentCandidateBoundary.kind,'unexecuted_tool_request');
  assert.equal(firstContext.currentCandidateBoundary.selectionBasis,'published_schema_and_task_arguments');
  assert.equal(firstContext.currentCandidateBoundary.resultEvidenceStage,'after_actual_execution');
  assert.deepEqual(firstContext.publishedTools,original.availableTools);
  assert.deepEqual(firstContext.nodeContract.capabilities,getOwnedWorkflowTemplate('F20').nodes[0].capabilities);
  assert.deepEqual(context.publishedTools,[],'Only the current node precise tool capabilities are supplied');
});
test('F12 observes both optional delivery and query guards before settling silent or query paths',async()=>{
  const template=getOwnedWorkflowTemplate('F12'),availableTools=template.nodes.flatMap(node=>[
    ...(node.kind==='host'?[{name:'workflow.host.'+node.id.toLowerCase(),version:'1.0.0',inputSchema:{type:'object'}}]:[]),
    ...(node.condition?[{name:'workflow.guard.'+node.id.toLowerCase(),version:'1.0.0',inputSchema:{type:'object'}}]:[]),
  ]);
  for(const query of [false,true]) {
    const runtime=engine({externalHost:true,receiptVerifier:proofVerifier}),original=request('F12',{availableTools});
    let result=await runtime.advance(original);const seen=[];
    for(let step=0;step<20&&result.state!=='settled';step++) {
      if(result.nodes.F12_N03.state==='completed'&&result.nodes.F12_N05.state==='pending')assert.notEqual(result.state,'settled');
      const receipts=result.proposals.map(proposal=>{
        seen.push(proposal.toolName);
        const guard=proposal.toolName.startsWith('workflow.guard.');
        return receipt(proposal,'confirmed',{result:guard?{state:query&&proposal.nodeId==='F12_N05'?'selected':'skipped'}:{readback:true}});
      });
      result=await next(runtime,original,result,{receipts});
    }
    assert.equal(result.state,'settled');assert.equal(result.nodes.F12_N04.state,'skipped');
    assert.equal(result.nodes.F12_N05.state,query?'completed':'skipped');
    assert.ok(seen.includes('workflow.guard.f12_n04'));assert.ok(seen.includes('workflow.guard.f12_n05'));
    assert.equal(seen.includes('workflow.host.f12_n04'),false);assert.equal(seen.includes('workflow.host.f12_n05'),query);
  }
});

test('research branches run serially and the next branch waits for the original tool receipt',async()=>{
  let arrivals=0,active=0;
  const seen=[];
  const runtime=engine({prepareCandidates:async context=>{
    assert.equal(active++,0);seen.push(context.node.id);arrivals++;await new Promise(resolve=>setImmediate(resolve));active--;return candidates(context);
  },receiptVerifier:proofVerifier});
  const original=request('F10',{availableTools:tools(['research.search','knowledge.search'])});
  const first=await runtime.advance(original);assert.equal(first.nodes.F10_N01.state,'completed');assert.deepEqual(seen,[]);
  const second=await next(runtime,original,first);
  assert.deepEqual(seen,['F10_N02']);assert.equal(second.proposals.length,1);assert.equal(second.nodes.F10_N05.state,'pending');
  const held=await next(runtime,original,second);assert.equal(held.proposals.length,1);assert.equal(arrivals,1);
  const third=await next(runtime,original,held,{receipts:[receipt(held.proposals[0])]});
  assert.deepEqual(seen,['F10_N02','F10_N03']);assert.equal(third.proposals.length,1);assert.equal(third.nodes.F10_N04.state,'pending');
});

test('Laya alone selects prepared candidates and abstention emits no execution or false completion',async()=>{
  const runtime=engine({selector:{select:async()=> 'recheck'}}),original=request('F17');
  const first=await runtime.advance(original),second=await next(runtime,original,first);
  assert.equal(second.nodes.F17_N02.state,'unknown');assert.equal(second.nodes.F17_N03.state,'pending');
  assert.deepEqual(second.proposals,[]);assert.equal(second.state,'unknown');
});

test('missing tools are unavailable before any candidate or selector invocation',async()=>{
  let prepared=0;
  const runtime=engine({prepareCandidates:async context=>{prepared++;return candidates(context);}});
  const original=request('F17');let last=await runtime.advance(original);last=await next(runtime,original,last);
  assert.equal(prepared,1);last=await next(runtime,original,last);
  assert.equal(last.nodes.F17_N03.state,'unavailable');assert.equal(prepared,1);
  assert.deepEqual(last.unavailable[0].capabilities,['tool:workspace.run_allowed_command']);
});

test('an unknown original write keeps its exact operation identity and waits for trusted readback',async()=>{
  const caps=getOwnedWorkflowTemplate('F06').nodes.flatMap(node=>node.capabilities.map(cap=>cap.name));
  const runtime=engine({receiptVerifier:proofVerifier,host:{capabilities:caps,read:async()=>({state:'completed',value:{}})}});
  const original=request('F06');let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
  const proposal=last.proposals[0];assert.equal(proposal.effect,'write');
  last=await next(runtime,original,last,{receipts:[receipt(proposal,'unknown')]});
  assert.equal(last.nodes.F06_N03.state,'unknown');assert.equal(last.nodes.F06_N04.state,'pending');
  const held=await next(runtime,original,last);assert.equal(held.nodes.F06_N03.proposal.operationId,proposal.operationId);
  assert.deepEqual(held.proposals,[],'Unknown write never reissues a different operation');
  const checked=await next(runtime,original,held,{receipts:[receipt(proposal)]});
  assert.equal(checked.nodes.F06_N03.state,'completed');assert.deepEqual(checked.nodes.F06_N03.evidenceRefs,['evidence-1']);
  assert.equal(checked.nodes.F06_N04.state,'completed');
});

test('client claimed success is not admitted when production has no host receipt verifier',async()=>{
  const runtime=engine(),original=request('F17',{availableTools:tools(['workspace.run_allowed_command'])});
  let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
  const proposal=last.proposals[0];last=await next(runtime,original,last,{receipts:[receipt(proposal)]});
  assert.equal(last.state,'unavailable');assert.equal(last.nodes.F17_N03.state,'waiting_receipt');
  assert.equal(last.nodes.F17_N04.state,'pending');assert.equal(last.proposals[0].operationId,proposal.operationId);
});

test('receipt rejects a replaced operation, forged proof, empty evidence and stale checkpoint controls',async()=>{
  const runtime=engine({receiptVerifier:proofVerifier}),original=request('F17',{availableTools:tools(['workspace.run_allowed_command'])});
  let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
  const proposal=last.proposals[0];
  for(const changed of [{operationId:'replacement'},{proof:'client-claim'},{evidenceRefs:[]}]) {
    await assert.rejects(next(runtime,original,last,{receipts:[receipt(proposal,'confirmed',changed)]}),{code:'INVALID_ARGUMENT'});
  }
  for(const changed of [{controlRevision:2},{input:{goal:'changed'}},{sessionId:'other-session'},
    {availableTools:tools(['workspace.run_allowed_command','knowledge.search'])}]) {
    await assert.rejects(next(runtime,original,last,changed),{code:'INVALID_ARGUMENT'});
  }
  const rotated=engine({checkpointSecret:'rotated-synthetic-workflow-secret-32-chars'});
  await assert.rejects(next(rotated,original,last),{code:'INVALID_ARGUMENT'});
  const tampered=last.checkpoint.slice(0,-5)+'abcde';
  await assert.rejects(next(runtime,original,last,{checkpoint:tampered}),{code:'INVALID_ARGUMENT'});
});

test('selected shadow branch joins without executing skipped modes or future counterfactual data',async()=>{
  const template=getOwnedWorkflowTemplate('F22'),visited=[];
  const caps=template.nodes.flatMap(node=>node.capabilities.map(cap=>cap.name));
  const runtime=engine({host:{capabilities:caps,read:async context=>{visited.push(context.node.id);return {state:'completed',value:{source:'frozen-public-snapshot'}};}},
    prepareCandidates:async context=>candidates(context).map(candidate=>candidate.id==='candidate'&&context.node.id==='F22_N02'
      ?{...candidate,branches:[{nodeId:'F22_N03',state:'selected'},{nodeId:'F22_N04',state:'skipped'},{nodeId:'F22_N05',state:'skipped'}]}:candidate)});
  const original=request('F22');let last=await runtime.advance(original);
  for(let i=0;i<7;i++)last=await next(runtime,original,last);
  assert.equal(last.nodes.F22_N03.state,'completed');assert.equal(last.nodes.F22_N04.state,'skipped');
  assert.equal(last.nodes.F22_N05.state,'skipped');assert.equal(last.nodes.F22_N06.state,'skipped');
  assert.equal(last.nodes.F22_N07.state,'completed');assert.equal(last.nodes.F22_N08.state,'completed');
  assert.ok(!visited.includes('F22_N04')&&!visited.includes('F22_N05')&&!visited.includes('F22_N06'));
  assert.equal(last.nodes.F22_N07.value.states.F22_N05,'skipped');
});

test('shadow requires a frozen separate namespace and never emits real writes or consent',async()=>{
  const runtime=engine(),original=request('F06');
  await assert.rejects(runtime.advance({...original,mode:'isolated'}),{code:'INVALID_ARGUMENT'});
  const shadow={...original,mode:'isolated',snapshot:{namespace:'shadow-test',asOf:'2026-10-14T00:00:00Z',sourceVersions:{public:'v1'}}};
  let last=await runtime.advance(shadow);last=await next(runtime,shadow,last);last=await next(runtime,shadow,last);
  assert.equal(last.nodes.F06_N03.state,'unavailable');assert.deepEqual(last.proposals,[]);
  const replay=await runtime.advance({...shadow,mode:'trace_replay'});assert.equal(replay.nodes.F06_N01.state,'unknown');
  assert.equal(replay.state,'unknown');
});

test('cancellation preserves already occurred effects and marks in-flight outcomes unknown without replay',async()=>{
  const runtime=engine(),original=request('F17',{availableTools:tools(['workspace.run_allowed_command'])});
  let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
  const controller=new AbortController();controller.abort();
  const stopped=await next(runtime,original,last,{signal:controller.signal});
  assert.equal(stopped.state,'cancelled');assert.equal(stopped.nodes.F17_N03.state,'unknown');
  assert.equal(stopped.nodes.F17_N04.state,'cancelled');assert.equal(stopped.nodes.F17_N01.state,'completed');
  assert.equal(stopped.nodes.F17_N03.proposal.operationId,last.proposals[0].operationId);
});

test('temporarily busy semantic selection remains resumable without restarting the graph or replaying effects',async()=>{
  let calls=0;const runtime=engine({selector:{select:async()=>{if(calls++===0)throw new ProtocolError('RATE_LIMITED','synthetic busy');return 'candidate';}}});
  const original=request('F17');let last=await runtime.advance(original);last=await next(runtime,original,last);
  assert.equal(last.nodes.F17_N02.state,'pending');assert.match(last.nodes.F17_N02.reason,/DECISION_BUSY/);
  last=await next(runtime,original,last);assert.equal(last.nodes.F17_N02.state,'completed');assert.equal(calls,2);
});

test('a reviewed tool without an operation resumes only after trusted affected revision migration',async()=>{
  const receiptSecret='synthetic-reviewed-tool-migration-key-32-chars';
  const bridge=new OwnedWorkflowHostBridge({receiptSecret,
    host:{submitHostToolTask:()=>{throw Error('No diagnostic tool submission');},readHostToolTask:()=>{throw Error('No prior operation');}},
    checkpoints:{read:()=>undefined,writeOnce:()=>{throw Error('No operation checkpoint');}},assertActive:()=>{}});
  let prepared=0,selected=0;
  const runtime=engine({receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret}),
    prepareCandidates:async context=>{prepared++;return candidates(context);},
    selector:{select:async value=>{selected++;return JSON.parse(value.context).input.sourceRevision?'candidate':'recheck';}}});
  const original=request('F20',{availableTools:tools(['workspace.read_text'])});
  const reviewed=await runtime.advance(original);
  assert.equal(reviewed.nodes.F20_N01.state,'unknown');assert.equal(reviewed.nodes.F20_N01.proposal,undefined);
  assert.equal(prepared,1);assert.equal(selected,1);assert.deepEqual(reviewed.proposals,[]);
  let held=await next(runtime,original,reviewed);held=await next(runtime,original,held);
  assert.equal(held.nodes.F20_N01.state,'unknown');assert.equal(prepared,1);assert.equal(selected,1);
  const changed={...original,controlRevision:2,input:{...original.input,sourceRevision:'public-source-v2'}};
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,workflowId:value.workflowId,
    templateDigest:getOwnedWorkflowTemplate(value.workflowId).templateDigest,controlRevision:value.controlRevision,
    inputDigest:sha(value.input),catalogDigest:sha(value.availableTools)});
  const migration=bridge.migration(identity(original),identity(changed),['F20_N01']);
  await assert.rejects(next(runtime,changed,held),{code:'INVALID_ARGUMENT'});
  await assert.rejects(next(runtime,changed,held,{migration:{...migration,proof:{...migration.proof,signature:'forged'}}}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(next(engine(),changed,held,{migration}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(next(runtime,original,held,{migration}),{code:'INVALID_ARGUMENT'});
  assert.equal(prepared,1);assert.equal(selected,1,'Rejected migrations cannot rerun semantic selection');
  const unaffected=await next(runtime,changed,held,{migration:bridge.migration(identity(original),identity(changed),['F20_N02'])});
  assert.equal(unaffected.nodes.F20_N01.state,'unknown');assert.equal(prepared,1);assert.equal(selected,1);
  const resumed=await next(runtime,changed,held,{migration});
  assert.equal(resumed.nodes.F20_N01.state,'waiting_receipt');assert.equal(resumed.proposals.length,1);
  assert.equal(resumed.proposals[0].originControlRevision,2);assert.equal(prepared,2);assert.equal(selected,2);
  await next(runtime,changed,resumed);assert.equal(prepared,2);assert.equal(selected,2,'Pending operation does not repeat candidate selection');
});

test('affected tool migration preserves every existing write proposal and never prepares a replacement',async()=>{
  for(const receiptState of ['waiting_receipt','unknown','failed','confirmed']) {
    const receiptSecret='synthetic-original-write-migration-key-32-chars';
    const bridge=new OwnedWorkflowHostBridge({receiptSecret,
      host:{submitHostToolTask:()=>{throw Error('No write submission');},readHostToolTask:()=>{throw Error('No write readback');}},
      checkpoints:{read:()=>undefined,writeOnce:()=>{throw Error('No submission checkpoint');}},assertActive:()=>{}});
    const migrationVerifier=createOwnedWorkflowReceiptVerifier({secret:receiptSecret});
    let toolPreparations=0;
    const runtime=engine({receiptVerifier:{...proofVerifier,verifyMigration:migrationVerifier.verifyMigration},
      host:{capabilities:['github.bound_ci_failure'],read:async()=>({state:'completed',value:{sha:'public-commit-v1'}})},
      prepareCandidates:async context=>{if(context.node.id==='F16_N03')toolPreparations++;return candidates(context);}});
    const original=request('F16',{availableTools:tools(['workspace.apply_text_patch'])});
    let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
    const proposal=last.proposals[0];assert.equal(proposal.nodeId,'F16_N03');assert.equal(proposal.effect,'write');
    if(receiptState!=='waiting_receipt')last=await next(runtime,original,last,{receipts:[receipt(proposal,receiptState)]});
    const originalStep=structuredClone(last.nodes.F16_N03);
    const changed={...original,controlRevision:2,input:{...original.input,sourceRevision:'public-commit-v2'}};
    const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,workflowId:value.workflowId,
      templateDigest:getOwnedWorkflowTemplate(value.workflowId).templateDigest,controlRevision:value.controlRevision,
      inputDigest:sha(value.input),catalogDigest:sha(value.availableTools)});
    last=await next(runtime,changed,last,{migration:bridge.migration(identity(original),identity(changed),['F16_N03'])});
    for(let i=0;i<2;i++)last=await next(runtime,changed,last);
    const retained=last.nodes.F16_N03;
    assert.deepEqual(retained.proposal,proposal,receiptState);assert.equal(retained.proposal.originControlRevision,1);
    assert.equal(retained.state,receiptState==='waiting_receipt'?'unknown':originalStep.state,receiptState);
    assert.deepEqual(retained.value,originalStep.value);assert.deepEqual(retained.evidenceRefs,originalStep.evidenceRefs);
    assert.equal(last.proposals.length,0,receiptState);assert.equal(toolPreparations,1,receiptState);
    assert.throws(()=>bridge.submit(changed,proposal),{code:'REVISION_CONFLICT'});
  }
});

test('trusted revision migration preserves unknown operation/arguments and original receipt binding',async()=>{
  const receiptSecret='synthetic-host-receipt-source-key-32-chars',stored=new Map();
  let hostState='waiting_reconciliation',submits=0;
  const host={submitHostToolTask:input=>{submits++;return {commandId:input.commandId,toolName:input.toolName,toolVersion:input.toolVersion,
    task:{taskId:'original-local-task',state:hostState}};},readHostToolTask:()=>({commandId:proposal.operationId,
    toolName:proposal.toolName,toolVersion:proposal.toolVersion,task:{taskId:'original-local-task',state:hostState},
    ...(hostState==='succeeded'?{confirmed:{runId:'host-tool-original-local-task',result:{actual:'original readback'},evidenceRefs:['host-tool-original-local-task']}}:{})})};
  const bridge=new OwnedWorkflowHostBridge({receiptSecret,host,assertActive:()=>{},
    checkpoints:{read:(task,key)=>stored.get(task+key),writeOnce:(task,key,value)=>{if(stored.has(task+key))return false;stored.set(task+key,value);return true;}}});
  const runtime=engine({receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret})});
  const original=request('F20',{availableTools:tools(['workspace.read_text'])});let last=await runtime.advance(original);
  const proposal=last.proposals[0];bridge.submit(original,proposal);assert.equal(submits,1);
  const uncertain=bridge.readReceipt(original,proposal);last=await next(runtime,original,last,{receipts:[uncertain]});
  assert.equal(last.nodes.F20_N01.state,'unknown');
  const changed={...original,input:{goal:'Updated goal, preserve original unknown effect'},controlRevision:2};
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,workflowId:value.workflowId,
    templateDigest:getOwnedWorkflowTemplate(value.workflowId).templateDigest,controlRevision:value.controlRevision,
    inputDigest:sha(value.input),catalogDigest:sha(value.availableTools)});
  const migration=bridge.migration(identity(original),identity(changed),['F20_N02']);
  await assert.rejects(next(runtime,changed,last,{migration:{...migration,invalidatedNodeIds:['F20_N01']}}),{code:'INVALID_ARGUMENT'});
  const migrated=await next(runtime,changed,last,{migration});assert.equal(migrated.nodes.F20_N01.state,'unknown');
  assert.equal(migrated.nodes.F20_N01.proposal.operationId,proposal.operationId);
  assert.deepEqual(migrated.nodes.F20_N01.proposal.arguments,proposal.arguments);assert.equal(submits,1);
  hostState='succeeded';const confirmed=bridge.readReceipt(changed,proposal);
  const checked=await next(runtime,changed,migrated,{receipts:[confirmed]});
  assert.equal(checked.nodes.F20_N01.state,'completed');assert.equal(checked.nodes.F20_N02.state,'completed');
  assert.equal(checked.nodes.F20_N01.proposal.originControlRevision,1);assert.equal(submits,1);
});

test('large actual tool result preserves signed effect/checkpoint and requires exact original host result restoration',async()=>{
  const runtime=engine({receiptVerifier:proofVerifier}),original=request('F20',{availableTools:tools(['workspace.read_text'])});
  let last=await runtime.advance(original);const proposal=last.proposals[0],large={content:'public-data-'.repeat(25000)};
  last=await next(runtime,original,last,{receipts:[receipt(proposal,'confirmed',{result:large})]});
  assert.equal(last.nodes.F20_N01.state,'completed');assert.equal(last.nodes.F20_N01.value.kind,'trusted_tool_result_reference');
  assert.equal(last.nodes.F20_N02.state,'pending');assert.ok(Buffer.byteLength(JSON.stringify(last))<64000);
  await assert.rejects(next(runtime,original,last,{resolvedValues:{F20_N01:{content:'replaced data'}}}),{code:'INVALID_ARGUMENT'});
  const restored=await next(runtime,original,last,{resolvedValues:{F20_N01:large}});
  assert.equal(restored.nodes.F20_N02.state,'completed');assert.equal(restored.nodes.F20_N01.proposal.operationId,proposal.operationId);
});

test('revision migration never re-emits or first-submits stale write parameters, including a persisted old intent',async()=>{
  const receiptSecret='synthetic-stale-write-receipt-key-32-chars',stored=new Map();let submits=0;
  const host={submitHostToolTask:input=>{submits++;return {commandId:input.commandId,toolName:input.toolName,toolVersion:input.toolVersion,
    task:{taskId:'original-stale-local-task',state:'waiting_approval'}};},readHostToolTask:()=>({commandId:proposal.operationId,
    toolName:proposal.toolName,toolVersion:proposal.toolVersion,task:{taskId:'original-stale-local-task',state:'waiting_approval'}})};
  const checkpoints={read:(task,key)=>stored.get(task+key),writeOnce:(task,key,value)=>{if(stored.has(task+key))return false;stored.set(task+key,value);return true;}};
  const bridge=new OwnedWorkflowHostBridge({receiptSecret,host,checkpoints,assertActive:()=>{}});
  const runtime=engine({receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret}),
    host:{capabilities:['github.bound_ci_failure'],read:async()=>({state:'completed',value:{sha:'synthetic-sha'}})}});
  const original=request('F16',{availableTools:tools(['workspace.apply_text_patch'])});
  let last=await runtime.advance(original);last=await next(runtime,original,last);last=await next(runtime,original,last);
  const proposal=last.proposals[0];assert.equal(proposal.effect,'write');assert.equal(proposal.originControlRevision,1);
  const changed={...original,controlRevision:2,input:{goal:'Changed patch parameters; reconcile the original operation'}};
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,workflowId:value.workflowId,
    templateDigest:getOwnedWorkflowTemplate(value.workflowId).templateDigest,controlRevision:value.controlRevision,
    inputDigest:sha(value.input),catalogDigest:sha(value.availableTools)});
  const migrated=await next(runtime,changed,last,{migration:bridge.migration(identity(original),identity(changed),['F16_N02'])});
  assert.equal(migrated.nodes.F16_N03.state,'unknown');assert.equal(migrated.proposals.length,0);
  assert.equal(migrated.nodes.F16_N03.proposal.operationId,proposal.operationId);
  assert.throws(()=>bridge.submit(changed,proposal),{code:'REVISION_CONFLICT'});assert.equal(submits,0);
  stored.set(original.taskId+'owned-workflow:intent:'+proposal.operationId,{taskId:original.taskId,sessionId:original.sessionId,
    workflowId:original.workflowId,proposal,deadline:original.deadline});
  assert.throws(()=>bridge.submit(changed,proposal),{code:'REVISION_CONFLICT'});assert.equal(submits,0);
  // A separately established original binding is read-only after migration, even when the parent is no longer active.
  const bound=new Map(),boundBridge=new OwnedWorkflowHostBridge({receiptSecret,host,
    checkpoints:{read:(task,key)=>bound.get(task+key),writeOnce:(task,key,value)=>{if(bound.has(task+key))return false;bound.set(task+key,value);return true;}},
    assertActive:(_task,revision)=>{assert.equal(revision,1,'Past binding readback must not enter a new submission authorization path');}});
  const submitted=boundBridge.submit(original,proposal);assert.equal(submits,1);
  const readOnly=boundBridge.submit(changed,proposal);assert.equal(readOnly.localTaskId,submitted.localTaskId);assert.equal(submits,1);
});

test('revision migration refreshes affected read-only host observations while preserving an already confirmed effect',async()=>{
  const receiptSecret='synthetic-host-observation-receipt-key-32-chars',stored=new Map();
  const bridge=new OwnedWorkflowHostBridge({receiptSecret,host:{submitHostToolTask:()=>{throw Error('unused');},readHostToolTask:()=>{throw Error('unused');}},
    checkpoints:{read:(task,key)=>stored.get(task+key),writeOnce:(task,key,value)=>{if(stored.has(task+key))return false;stored.set(task+key,value);return true;}},assertActive:()=>{}});
  let currentSourceVersion='v1',freshnessChecks=0,writePreparations=0;
  const migrationVerifier=createOwnedWorkflowReceiptVerifier({secret:receiptSecret});
  const runtime=engine({receiptVerifier:{...proofVerifier,verifyMigration:migrationVerifier.verifyMigration},
    host:{capabilities:['calendar.freshness_check','calendar.registered_write'],read:async context=>{
      assert.equal(context.node.id,'F07_N04');freshnessChecks++;return {state:'completed',value:{sourceVersion:currentSourceVersion}};}},
    prepareCandidates:async context=>{if(context.node.id==='F07_N05')writePreparations++;return candidates(context);}});
  const original=request('F07',{availableTools:tools(['calendar.events'])});let last=await runtime.advance(original);
  last=await next(runtime,original,last);const readProposal=last.proposals[0];
  last=await next(runtime,original,last,{receipts:[receipt(readProposal)]});
  last=await next(runtime,original,last);assert.equal(freshnessChecks,1);
  last=await next(runtime,original,last);const writeProposal=last.proposals[0];assert.equal(writeProposal.effect,'write');
  last=await next(runtime,original,last,{receipts:[receipt(writeProposal)]});assert.equal(last.nodes.F07_N05.state,'completed');
  const changed={...original,controlRevision:2,input:{...original.input,sourceVersion:'v2'}};currentSourceVersion='v2';
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,workflowId:value.workflowId,
    templateDigest:getOwnedWorkflowTemplate(value.workflowId).templateDigest,controlRevision:value.controlRevision,
    inputDigest:sha(value.input),catalogDigest:sha(value.availableTools)});
  last=await next(runtime,changed,last,{migration:bridge.migration(identity(original),identity(changed),['F07_N04'])});
  for(let i=0;i<3;i++)last=await next(runtime,changed,last);
  assert.equal(freshnessChecks,2);assert.equal(last.nodes.F07_N04.value.sourceVersion,'v2');
  assert.equal(last.nodes.F07_N05.state,'completed');assert.equal(last.nodes.F07_N05.proposal.operationId,writeProposal.operationId);
  assert.equal(writePreparations,1);assert.equal(last.proposals.length,0);
});
