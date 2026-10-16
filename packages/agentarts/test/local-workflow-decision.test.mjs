import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedWorkflowEngine,OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool,WORKFLOW_DECISION_SCOPE,getOwnedWorkflowAdapterRequirements,
  createOwnedWorkflowAdapter,getOwnedWorkflowTemplates} from '../dist/index.js';

const tool=createWorkflowDecisionTool({selector:{select:async()=> 'candidate'}});
const context=()=>({taskId:'test-task',runId:'test-run',signal:new AbortController().signal,
  deadline:new Date(Date.now()+10000).toISOString(),authorizationRef:'test-authorization',scopes:[WORKFLOW_DECISION_SCOPE]});
const request=(extra={})=>({workflowId:'F20',input:{goal:'public fixture'},taskId:'test-task',controlRevision:1,
  sessionId:'test-session',requestId:'test-request',deadline:context().deadline,signal:context().signal,
  availableTools:[{name:tool.descriptor.name,version:tool.descriptor.version,inputSchema:tool.descriptor.inputSchema},
    {name:'workspace.read_text',version:'1.0.0',inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'}},additionalProperties:false}}],...extra});
const engine=(extra={})=>new OwnedWorkflowEngine({checkpointSecret:'synthetic-local-workflow-checkpoint-key-32',
  decisionTool:{name:tool.descriptor.name,version:tool.descriptor.version},externalHost:true,
  prepareCandidates:async()=>[{id:'candidate',description:'read the public fixture',value:{toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public.txt'}}},
    {id:'review',description:'evidence missing',value:null,abstain:true}],receiptVerifier:{verify:async receipt=>receipt.proof==='test-only-proof'},...extra});
const receipt=(proposal,result)=>({nodeId:proposal.nodeId,proposalId:proposal.proposalId,operationId:proposal.operationId,
  inputDigest:proposal.inputDigest,state:'confirmed',result,evidenceRefs:['test-evidence'],proof:'test-only-proof'});

test('local typed decision does not complete a business read, and consumes sealed candidates once',async()=>{
  let preparations=0;const runtime=engine({prepareCandidates:async()=>{preparations++;return [{id:'candidate',description:'read public source',
    value:{toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public.txt'}}},{id:'review',description:'review',value:null,abstain:true}];}});
  const original=request(),first=await runtime.advance(original),decision=first.proposals[0];
  assert.equal(decision.toolName,tool.descriptor.name);assert.equal(first.nodes.F20_N01.state,'waiting_receipt');
  assert.deepEqual((await runtime.advance({...original,checkpoint:first.checkpoint})).proposals,[decision]);assert.equal(preparations,1);
  const result=await tool.execute(decision.arguments,context());
  const second=await runtime.advance({...original,checkpoint:first.checkpoint,receipts:[receipt(decision,result)]});
  assert.equal(second.nodes.F20_N01.state,'waiting_receipt');assert.equal(second.proposals[0].toolName,'workspace.read_text');
  assert.notEqual(second.proposals[0].operationId,decision.operationId);assert.equal(preparations,1);
  const third=await runtime.advance({...original,checkpoint:second.checkpoint,receipts:[receipt(second.proposals[0],{content:'real fixture placeholder in offline test'})]});
  assert.equal(third.nodes.F20_N01.state,'completed');assert.equal(third.proposals[0].toolName,tool.descriptor.name);
  assert.equal(third.nodes.F20_N02.state,'waiting_receipt');
});

test('unknown/forged selections and cancelled local calls cannot authorize an operation',async()=>{
  const runtime=engine(),original=request(),first=await runtime.advance(original);
  await assert.rejects(runtime.advance({...original,checkpoint:first.checkpoint,receipts:[receipt(first.proposals[0],{selectedId:'invented'})]}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(runtime.advance({...original,checkpoint:first.checkpoint,receipts:[{...receipt(first.proposals[0],{selectedId:'candidate'}),proof:'forged'}]}),/verified/);
  await assert.rejects(tool.execute(first.proposals[0].arguments,{...context(),scopes:[]}),/scope/);
  const cancelled=context();const controller=new AbortController();controller.abort();
  await assert.rejects(tool.execute(first.proposals[0].arguments,{...cancelled,signal:controller.signal}),/cancelled/);
  const missing=await runtime.advance(request({availableTools:original.availableTools.filter(value=>value.name!==tool.descriptor.name)}));
  assert.equal(missing.state,'unavailable');assert.equal(missing.proposals.length,0);
});

test('source-read decision omits downstream source bodies by explicit digest, without dropping original input',async()=>{
  const runtime=engine(),original=request({input:{goal:'Read public.txt to repair the known animation later',targetFile:'public.txt',
    sourceSnapshot:'Public original SVG body',patchSchema:{type:'object'},initialFailure:{passed:false}}});
  const first=await runtime.advance(original),proposal=first.proposals[0],observed=JSON.parse(proposal.arguments.context);
  assert.equal(observed.input.targetFile,'public.txt');assert.equal(observed.input.goal,original.input.goal);
  assert.equal(observed.input.sourceSnapshot,undefined);assert.equal(observed.input.patchSchema,undefined);
  assert.match(observed.decisionInputProjection.deferredSourceFields.sourceSnapshot,/^[a-f0-9]{64}$/);
  assert.equal(original.input.sourceSnapshot,'Public original SVG body');
});

test('every host/conditional node in all 28 image workflows has a stable external wiring requirement',()=>{
  const requirements=getOwnedWorkflowAdapterRequirements();assert.equal(new Set(requirements.map(item=>item.toolName)).size,requirements.length);
  for(const template of getOwnedWorkflowTemplates()) for(const node of template.nodes) {
    if(node.kind==='host')assert.ok(requirements.some(item=>item.nodeId===node.id&&item.kind==='host'));
    if(node.condition)assert.ok(requirements.some(item=>item.nodeId===node.id&&item.kind==='guard'));
  }
  const write=requirements.find(item=>item.kind==='host'&&item.effect==='write');
  assert.throws(()=>createOwnedWorkflowAdapter({nodeId:write.nodeId,kind:'host',inputSchema:{type:'object'},outputSchema:{type:'object'},
    requiredScopes:['test'],sideEffect:'read',execute:async()=>({})}),/Unknown/);
});

test('all 28 main and 28 isolated-shadow serial graphs resume through published receipts (explicit Fake adapters only)',async()=>{
  const objectSchema={type:'object'},requirements=getOwnedWorkflowAdapterRequirements();
  for(const mode of ['main','isolated']) for(const template of getOwnedWorkflowTemplates()) {
    let preparations=0;
    const adapters=requirements.filter(item=>item.workflowId===template.workflowId);
    const nativeNames=template.nodes.flatMap(node=>node.capabilities.filter(cap=>cap.kind==='tool').map(cap=>cap.name));
    const catalog=[{name:tool.descriptor.name,version:'1.0.0',inputSchema:tool.descriptor.inputSchema},
      ...[...new Set([...nativeNames,...adapters.map(item=>item.toolName)])].map(name=>({name,version:'1.0.0',inputSchema:objectSchema}))];
    const runtime=engine({allowIsolatedProposals:true,prepareCandidates:async context=>{preparations++;return [
      {id:'candidate',description:'Explicit Fake adapter output; no business verification',value:context.node.kind==='tool'
        ?{toolName:context.node.capabilities.find(cap=>cap.kind==='tool').name,toolVersion:'1.0.0',arguments:{}}
        :context.node.kind==='host'?{arguments:{}}:{fakeNode:context.node.id}},
      {id:'review',description:'Fake recheck alternative',value:null,abstain:true}];}});
    const original=request({workflowId:template.workflowId,availableTools:catalog,mode,
      ...(mode==='isolated'?{snapshot:{namespace:'fake-shadow',asOf:new Date().toISOString(),sourceVersions:{fixture:'fake'}}}:{})});let graph,receipts=[];
    // Finite regression bound follows the graph's declared stages, not a product task budget.
    for(let stage=0;stage<template.nodes.length*4+1;stage++) {
      graph=await runtime.advance({...original,...(graph?{checkpoint:graph.checkpoint}:{}),receipts});
      assert.ok(graph.proposals.length<=1,template.workflowId+' is serial');
      if(graph.state==='settled')break;
      assert.ok(!['unknown','failed','unavailable','cancelled'].includes(graph.state),template.workflowId+': '+JSON.stringify(graph.unavailable));
      receipts=graph.proposals.map(proposal=>receipt(proposal,proposal.toolName===tool.descriptor.name?{selectedId:'candidate'}
        :proposal.toolName.startsWith('workflow.guard.')?{state:'selected'}:{fake:true}));
    }
    assert.equal(graph.state,'settled',template.workflowId);assert.ok(preparations>0);
    assert.ok(Object.values(graph.nodes).every(node=>['completed','skipped'].includes(node.state)),template.workflowId);
  }
});

test('local condition observations are signed stages, cannot be replaced by model-generated permission',async()=>{
  const requirement=getOwnedWorkflowAdapterRequirements().find(item=>item.kind==='guard');
  const adapter=createOwnedWorkflowAdapter({nodeId:requirement.nodeId,kind:'guard',inputSchema:{type:'object'},outputSchema:{},
    requiredScopes:['test:observe'],sideEffect:'read',execute:async()=>({state:'unknown'})});
  assert.deepEqual(await adapter.execute({}, {...context(),scopes:['test:observe']}),{state:'unknown'});
  await assert.rejects(adapter.execute({},context()),/scope/);
});

test('full isolated-shadow proposals require a real host isolation check and cannot become main receipts',async()=>{
  const secret='synthetic-isolated-host-receipt-secret-32-characters';
  const runtime=engine({allowIsolatedProposals:true,receiptVerifier:createOwnedWorkflowReceiptVerifier({secret})});
  const original=request({mode:'isolated',snapshot:{namespace:'test-shadow',asOf:new Date().toISOString(),sourceVersions:{fixture:'v1'}}});
  const first=await runtime.advance(original),proposal=first.proposals[0];assert.equal(proposal.isolation.namespace,'test-shadow');
  let submissions=0;const stored=new Map(),host={submitHostToolTask:input=>{submissions++;return {commandId:input.commandId,
    toolName:input.toolName,toolVersion:input.toolVersion,task:{taskId:'local-decision',state:'succeeded'}};},readHostToolTask:()=>({commandId:proposal.operationId,
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,task:{taskId:'local-decision',state:'succeeded'},
      confirmed:{runId:'host-tool-local-decision',result:{selectedId:'candidate'},evidenceRefs:['host-tool-local-decision']}})};
  const options={host,receiptSecret:secret,assertActive:()=>{},checkpoints:{read:(task,key)=>stored.get(task+key),
    writeOnce:(task,key,value)=>{if(stored.has(task+key))return false;stored.set(task+key,value);return true;}}};
  assert.throws(()=>new OwnedWorkflowHostBridge(options).submit(original,proposal),/Isolated/);assert.equal(submissions,0);
  const bridge=new OwnedWorkflowHostBridge({...options,assertIsolation:(task,isolation)=>{assert.equal(task,original.taskId);assert.equal(isolation.namespace,'test-shadow');}});
  bridge.submit(original,proposal);const signed=bridge.readReceipt(original,proposal);
  const next=await runtime.advance({...original,checkpoint:first.checkpoint,receipts:[signed]});
  assert.equal(next.proposals[0].toolName,'workspace.read_text');assert.equal(next.proposals[0].isolation.namespace,'test-shadow');
  await assert.rejects(runtime.advance({...original,checkpoint:first.checkpoint,mode:'main',receipts:[signed]}),/identity/);
  const changed={...proposal,isolation:{...proposal.isolation,namespace:'main'}};
  assert.equal(await createOwnedWorkflowReceiptVerifier({secret}).verify(signed,changed,original),false);
});
