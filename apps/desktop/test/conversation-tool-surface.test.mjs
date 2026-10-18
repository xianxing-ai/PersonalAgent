import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import * as coding from '@personal-agent/coding-tools';
import {createRuntimeApplication,createRuntimeCodingRepairDispatchTool} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createConversationToolSurface} from '../electron/conversation-tool-surface.js';

const profile='huawei_ict_agentarts',empty={type:'object',properties:{},additionalProperties:false};
const plain=name=>({descriptor:{name,version:'1.0.0',inputSchema:empty,outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['fixture:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async()=>({})});
const bindings=tools=>tools.map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version,available:()=>true}));
test('trusted surface retains original binding/readiness and marks only exact graph nodes and canonical aliases',()=>{
  const names=['coding.repair.start','coding.repair.list','coding.repair.read','coding.repair.snapshot','coding.repair.preview','coding.repair.patch','coding.repair.verify','coding.repair.check','coding.repair.publish','coding.repair.reconcile','workspace.coding_snapshot','workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06','workspace.git_diff_check','workspace.node_check','workspace.npm_build','workspace.npm_test'];
  const tools=[...names.map(plain),plain('workspace.run_allowed_command'),plain('coding.repair.workflow'),plain('coding.repair.future'),plain('workflow.host.f15_future')],original=bindings(tools);
  const result=createConversationToolSurface({profile,tools,competitionToolAvailability:original});
  assert.equal(result.length,original.length);result.forEach((b,i)=>{assert.equal(b.available,original[i].available);assert.equal(b.modelExposure,names.includes(b.toolName)?'internal':undefined);});
  assert.ok(original.every(b=>b.modelExposure===undefined));
});
test('fixed commands remain visible without a registered canonical command; non-Competition input is rejected',()=>{
  const tools=[plain('workspace.node_check'),plain('coding.repair.start')],original=bindings(tools);
  const result=createConversationToolSurface({profile,tools,competitionToolAvailability:original});
  assert.equal(result[0].modelExposure,undefined);assert.equal(result[1].modelExposure,'internal','F15 entry is injected after main composition');
  assert.throws(()=>createConversationToolSurface({profile:'local',tools,competitionToolAvailability:original}));
});
test('catalog rejects invalid trusted exposure metadata',()=>{
  const tools=[plain('fixture.read')];assert.throws(()=>createRuntimeApplication({path:':memory:',profile,tools,
    competitionToolAvailability:[{...bindings(tools)[0],modelExposure:'public'}]}),{code:'INVALID_ARGUMENT'});
});
test('original graph ToolPort retains hidden public node, while original model proposal cannot invoke it',async()=>{
  let graphCalls=0;const node=coding.createIsolatedCodingRepairTools({list:async()=>{graphCalls++;return {entries:[]};}}).find(t=>t.descriptor.name==='coding.repair.list');
  const tools=[node,createRuntimeCodingRepairDispatchTool(()=>app)],availability=createConversationToolSurface({profile,tools,competitionToolAvailability:bindings(tools)});
  const app=createRuntimeApplication({path:':memory:',profile,tools,competitionToolAvailability:availability,
    competitionToolExports:tools.map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version,exportPolicyVersion:'synthetic-surface',accepts:()=>true,project:({result})=>result})),
    coordination:{execute:async request=>{assert.deepEqual(request.availableTools.map(t=>t.name),['coding.repair.workflow']);return {kind:'tool_proposal',proposalId:'hidden-node',toolName:node.descriptor.name,toolVersion:node.descriptor.version,arguments:{sessionId:'synthetic',path:'.'},verification:'unverified'};}}});
  try{
    assert.ok(app.tools.list().some(t=>t.name===node.descriptor.name));assert.deepEqual(app.readConversationToolCapabilities().map(t=>t.name),['coding.repair.workflow']);
    assert.equal(availability.find(b=>b.toolName===node.descriptor.name).available(),true,'F15 trusted readiness can still read the original binding');
    const task=app.runtime.submitTask({goal:'Synthetic original graph call',conversationId:'ui',idempotencyKey:'graph'}),deadline=new Date(Date.now()+60000).toISOString(),args={sessionId:'synthetic',path:'.'};
    app.runtime.policy.grant({authorizationRef:'original-graph-node',taskId:task.taskId,toolName:node.descriptor.name,scopes:node.descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(args),expiresAt:deadline,maxUses:1});
    const end=await app.runtime.runTask(task.taskId,async worker=>{await app.tools.invoke({taskId:task.taskId,runId:'original-graph-node',authorizationRef:'original-graph-node',toolName:node.descriptor.name,toolVersion:node.descriptor.version,arguments:args,deadline,signal:worker.signal});return {resultSummary:'Original graph consumed original ToolPort'};},{deadline,sideEffect:'read'});
    assert.equal(end.state,'succeeded');assert.equal(graphCalls,1);
    const client=new Client(app);await client.connect();const model=await client.call('task.submit',{goal:'Synthetic hidden-node proposal',conversationId:'ui'},{idempotencyKey:'hidden-proposal'});
    for(let i=0;i<400&&app.runtime.getTask(model.taskId).state!=='failed';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(model.taskId).state,'failed');assert.equal(app.runtime.getTask(model.taskId).error.code,'UNSUPPORTED_CAPABILITY');assert.equal(graphCalls,1);
    assert.equal(app.runtime.listApprovals({taskId:model.taskId}).items.length,0);
  }finally{app.close();}
});
