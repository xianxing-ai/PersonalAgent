import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedWorkflowAdapter,getOwnedWorkflowAdapterRequirements} from '../dist/workflow-adapters.js';

const requirements=getOwnedWorkflowAdapterRequirements();
const read=requirements.find(item=>item.kind==='host'&&item.effect==='read');
const write=requirements.find(item=>item.kind==='host'&&item.effect==='write');
const guardRequirement=requirements.find(item=>item.kind==='guard');
const context=(extra={})=>({taskId:'adapter-task',runId:'adapter-run',signal:new AbortController().signal,
  deadline:new Date(Date.now()+10000).toISOString(),authorizationRef:'adapter-authorization',scopes:['adapter:read'],...extra});
const options=(extra={})=>({nodeId:read.nodeId,kind:'host',inputSchema:{type:'object'},outputSchema:{type:'object'},
  requiredScopes:['adapter:read'],sideEffect:'read',execute:async()=>({}),...extra});

test('adapter creation pins the published host naming and rejects unknown, mismatched or unscoped declarations',()=>{
  const adapter=createOwnedWorkflowAdapter(options());
  assert.equal(adapter.descriptor.name,'workflow.host.'+read.nodeId.toLowerCase());
  assert.equal(adapter.descriptor.version,'1.0.0');assert.equal(adapter.descriptor.sideEffect,'read');
  assert.deepEqual(adapter.descriptor.requiredScopes,['adapter:read']);
  assert.equal(adapter.descriptor.idempotencySupport,false);assert.equal(adapter.descriptor.recoverySupport,false);
  assert.equal(adapter.descriptor.requiresPresence,false);
  for(const broken of [options({nodeId:'F99_N99'}),options({kind:'guard'}),options({sideEffect:'external_write'}),
    options({execute:'not-a-function'}),options({requiredScopes:[]}),options({requiredScopes:undefined}),
    options({nodeId:write.nodeId,sideEffect:'read'})]) assert.throws(()=>createOwnedWorkflowAdapter(broken),{code:'INVALID_ARGUMENT'});
});

test('registered schemas are cloned at creation, so later caller mutation cannot rewrite the contract',()=>{
  const inputSchema={type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false};
  const adapter=createOwnedWorkflowAdapter(options({inputSchema,outputSchema:{type:'object',properties:{content:{type:'string'}},required:['content'],additionalProperties:false}}));
  inputSchema.properties.path.type='number';
  assert.equal(adapter.descriptor.inputSchema.properties.path.type,'string');
  assert.equal(adapter.descriptor.outputSchema.properties.content.type,'string');
});

test('adapter execution enforces schema, scope, deadline and cancellation before and after the delegated call',async()=>{
  const calls=[];
  const outputSchema={type:'object',properties:{content:{type:'string'}},required:['content'],additionalProperties:false};
  const adapter=createOwnedWorkflowAdapter(options({inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},
    outputSchema,execute:async input=>{calls.push(input);return {content:'public readback'};}}));
  assert.deepEqual(await adapter.execute({path:'a.txt'},context()),{content:'public readback'});assert.equal(calls.length,1);
  await assert.rejects(adapter.execute({path:42},context()),{code:'INVALID_ARGUMENT'});
  await assert.rejects(adapter.execute({path:'a.txt'},{...context(),authorizationRef:undefined}),{code:'SCOPE_DENIED'});
  await assert.rejects(adapter.execute({path:'a.txt'},context({scopes:['adapter:other']})),{code:'SCOPE_DENIED'});
  await assert.rejects(adapter.execute({path:'a.txt'},context({deadline:new Date(Date.now()-1000).toISOString()})),{code:'TIMEOUT'});
  await assert.rejects(adapter.execute({path:'a.txt'},context({deadline:'not-a-date'})),{code:'TIMEOUT'});
  const aborted=context(),controller=new AbortController();controller.abort();
  await assert.rejects(adapter.execute({path:'a.txt'},{...aborted,signal:controller.signal}),{code:'CANCELLED'});
  const late=new AbortController();
  const racing=createOwnedWorkflowAdapter(options({execute:async()=>{late.abort();return {content:'late'};}}));
  await assert.rejects(racing.execute({path:'a.txt'},{...context(),signal:late.signal}),{code:'CANCELLED'});
  const lying=createOwnedWorkflowAdapter(options({outputSchema,execute:async()=>({content:42})}));
  await assert.rejects(lying.execute({path:'a.txt'},context()),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(calls,[{path:'a.txt'}]);
});

test('guard adapters always publish the fixed selected/skipped/unknown state enum, regardless of declared output schema',async()=>{
  const guard=createOwnedWorkflowAdapter({nodeId:guardRequirement.nodeId,kind:'guard',inputSchema:{type:'object'},outputSchema:{},
    requiredScopes:['adapter:read'],sideEffect:'read',execute:async()=>({state:'selected'})});
  assert.equal(guard.descriptor.name,'workflow.guard.'+guardRequirement.nodeId.toLowerCase());
  assert.equal(guard.descriptor.sideEffect,'read');
  assert.deepEqual(guard.descriptor.outputSchema,{type:'object',additionalProperties:false,required:['state'],
    properties:{state:{type:'string',enum:['selected','skipped','unknown']}}});
  assert.deepEqual(await guard.execute({},context()),{state:'selected'});
  const fabricated=createOwnedWorkflowAdapter({nodeId:guardRequirement.nodeId,kind:'guard',inputSchema:{type:'object'},outputSchema:{},
    requiredScopes:['adapter:read'],sideEffect:'read',execute:async()=>({state:'authorized'})});
  await assert.rejects(fabricated.execute({},context()),{code:'INVALID_ARGUMENT'});
});
