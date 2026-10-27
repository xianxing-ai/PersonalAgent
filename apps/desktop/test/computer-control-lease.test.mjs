import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError,ToolNotStartedError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createComputerControlLease} from '../electron/computer-control-lease.js';

const now=Date.parse('2026-10-18T20:00:00.000Z');
const context=(overrides={})=>({taskId:'task-1',runId:'run-1',authorizationRef:'grant-1',signal:new AbortController().signal,
  deadline:new Date(now+60000).toISOString(),scopes:['computer:fixture'],...overrides});
const tool=(name,execute=async()=>({state:'observed'}))=>({descriptor:{name,version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{state:{type:'string'}},required:['state'],additionalProperties:false},
  sideEffect:name==='computer.desktop.observe'?'read':'local_write',requiredScopes:['computer:fixture'],requiresPresence:true,idempotencySupport:false,recoverySupport:false},execute});
function fixture(){
  const tasks=[],records=new Map();let available=true;
  const source={listTasks:({states,beforeSequence})=>({items:tasks.filter(task=>states.includes(task.state))}),
    readToolExecutions:taskId=>records.get(taskId)??[],matchesToolExecutionInput:(record,input)=>record.scopeRef===input.scopeRef&&record.argsDigest===toolArgumentsDigest(input.arguments)};
  const lease=()=>createComputerControlLease({getRuntime:()=>available?source:undefined,now:()=>now});
  function record(name,ctx=context(),changes={}){
    const row={taskId:ctx.taskId,evidenceId:ctx.runId,toolName:name,toolVersion:'1.0.0',state:'started',executionStarted:true,policyDecision:'allow',scopeRef:ctx.authorizationRef,argsDigest:toolArgumentsDigest({}),...changes};
    records.set(ctx.taskId,[...(records.get(ctx.taskId)??[]),row]);return row;
  }
  return {lease,source,tasks,records,record,setAvailable:value=>{available=value;}};
}
test('two different computer engines share one immediate lease without changing descriptors or unrelated tools',async()=>{
  const f=fixture(),lease=f.lease();let release,notepadCalls=0,mcpCalls=0;
  const notepad=tool('computer.notepad.replace_text',async()=>{notepadCalls++;await new Promise(resolve=>{release=resolve;});return {state:'observed'};});
  const mcp=tool('computer.desktop.click',async()=>{mcpCalls++;return {state:'observed'};});
  const unrelated=tool('computer.system.observe');
  const [native,desktop,system]=lease.wrapTools([notepad,mcp,unrelated]);
  assert.strictEqual(native.descriptor,notepad.descriptor);assert.strictEqual(desktop.descriptor,mcp.descriptor);assert.strictEqual(system,unrelated);assert.strictEqual(lease.wrap(native),native);
  const original=f.record(notepad.descriptor.name);const pending=native.execute({},context());
  await assert.rejects(desktop.execute({},context({taskId:'task-2',runId:'run-2'})),{code:'REVISION_CONFLICT'});
  assert.equal(notepadCalls,1);assert.equal(mcpCalls,0);release();await pending;
  await assert.rejects(desktop.execute({},context({taskId:'task-2',runId:'run-2'})),{code:'RESULT_UNKNOWN'});
  original.state='confirmed';f.record(mcp.descriptor.name,context({taskId:'task-2',runId:'run-2'}));
  await desktop.execute({},context({taskId:'task-2',runId:'run-2'}));assert.equal(mcpCalls,1);
});
test('shared lease serializes observation with in-flight writes and permits observation while original unknown still seals writes',async()=>{
  const f=fixture(),lease=f.lease();let release,reads=0;
  const native=lease.wrap(tool('computer.notepad.replace_text',async()=>{await new Promise(resolve=>{release=resolve;});throw new ProtocolError('RESULT_UNKNOWN','unknown');}));
  const observe=lease.wrap(tool('computer.desktop.observe',async()=>{reads++;return {state:'observed'};}));
  const original=f.record('computer.notepad.replace_text');const pending=native.execute({},context());
  await assert.rejects(observe.execute({},context({runId:'read-1'})),{code:'REVISION_CONFLICT'});assert.equal(reads,0);
  release();await assert.rejects(pending,{code:'RESULT_UNKNOWN'});
  original.state='unknown';f.tasks.push({taskId:'task-1',state:'waiting_reconciliation'});
  await observe.execute({},context({runId:'read-2'}));assert.equal(reads,1);assert.equal(lease.snapshot().writeBlocked,true);
});
test('original Runtime unknown blocks all new writes across newly constructed lease instances',async()=>{
  const f=fixture();let calls=0;const original=f.record('computer.desktop.type',context(),{state:'unknown'});
  f.tasks.push({taskId:'task-1',state:'waiting_reconciliation'});
  for(const name of ['computer.notepad.replace_text','computer.desktop.click','computer.desktop.type','computer.desktop.scroll','computer.desktop.move','computer.desktop.shortcut']){
    const wrapped=f.lease().wrap(tool(name,async()=>{calls++;return {state:'observed'};}));
    await assert.rejects(wrapped.execute({},context({taskId:'task-2',runId:'new-run'})),{code:'RESULT_UNKNOWN'});
  }
  assert.equal(calls,0);
  original.state='confirmed';original.reconciliationOutcome='applied';
  await f.lease().wrap(tool('computer.notepad.replace_text',async()=>{calls++;return {state:'observed'};})).execute({},context({taskId:'task-2',runId:'new-run'}));
  assert.equal(calls,1,'trusted original Runtime reconciliation allows fresh work, never replays the old run');
});

test('the shared input preflight supplies trusted zero-dispatch proof without hiding the original unknown',async()=>{
  const f=fixture(),lease=f.lease();let calls=0;
  const original=f.record('computer.desktop.click',context(),{state:'unknown'});
  f.tasks.push({taskId:'task-1',state:'waiting_reconciliation'});
  const action=lease.wrap(tool('computer.desktop.type',async()=>{calls++;return {state:'observed'};}));
  const error=await action.execute({},context({taskId:'new-task',runId:'new-run'})).catch(error=>error);
  assert.ok(error instanceof ToolNotStartedError);assert.equal(error.code,'RESULT_UNKNOWN');
  assert.equal(calls,0);assert.equal(original.state,'unknown');assert.equal(lease.snapshot().writeBlocked,true);
});
test('an unknown handoff cannot exploit the gap before Runtime persists it, and only original reconciliation releases the retained lease',async()=>{
  const f=fixture(),lease=f.lease();let calls=0;
  const original=f.record('computer.desktop.type');
  const first=lease.wrap(tool('computer.desktop.type',async()=>{throw Error('unconfirmed remote outcome');}));
  const next=lease.wrap(tool('computer.notepad.replace_text',async()=>{calls++;return {state:'observed'};}));
  await assert.rejects(first.execute({},context()));
  await assert.rejects(next.execute({},context({taskId:'task-2',runId:'run-2'})),{code:'RESULT_UNKNOWN'});
  original.state='confirmed';
  await assert.rejects(next.execute({},context({taskId:'task-2',runId:'run-2'})),{code:'RESULT_UNKNOWN'});
  original.reconciliationOutcome='applied';await next.execute({},context({taskId:'task-2',runId:'run-2'}));assert.equal(calls,1);
});
test('read errors and cancelled/expired/unbound requests do no write I/O and cannot manufacture a release',async()=>{
  const f=fixture(),lease=f.lease();let calls=0;
  const wrapped=lease.wrap(tool('computer.desktop.click',async()=>{calls++;return {state:'observed'};}));
  const controller=new AbortController();controller.abort();
  await assert.rejects(wrapped.execute({},context({signal:controller.signal})),{code:'CANCELLED'});
  await assert.rejects(wrapped.execute({},context({deadline:new Date(now).toISOString()})),{code:'TIMEOUT'});
  f.setAvailable(false);await assert.rejects(wrapped.execute({},context()),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls,0);assert.equal(lease.snapshot().writeBlocked,true);
  lease.close();f.setAvailable(true);await assert.rejects(wrapped.execute({},context()),{code:'CANCELLED'});assert.equal(calls,0);
});
test('real Policy/ToolGateway still rejects unconfirmed presence before either underlying engine receives I/O',async()=>{
  const f=fixture(),lease=f.lease();let calls=0;
  const wrapped=lease.wrap(tool('computer.notepad.replace_text',async()=>{calls++;return {state:'observed'};}));
  const policy=new InMemoryAuthorizationPolicy();policy.grant({authorizationRef:'grant-1',taskId:'task-1',toolName:wrapped.descriptor.name,
    scopes:['computer:fixture'],expiresAt:new Date(now+60000).toISOString(),maxUses:1,argumentsDigest:toolArgumentsDigest({})});
  const gateway=new ToolGateway({policy,now:()=>now});gateway.register(wrapped);
  const request={...context(),toolName:wrapped.descriptor.name,toolVersion:'1.0.0',arguments:{}};
  await assert.rejects(gateway.invoke({...request,userPresent:false}),{code:'UNAUTHORIZED'});
  assert.equal(calls,0);assert.equal(policy.get('grant-1').usesRemaining,1);
  // Explicit Synthetic confirmation, not a model assertion or real hardware receipt.
  const confirmation=true;
  await gateway.invoke({...request,userPresent:confirmation,onAuthorized:()=>f.record(wrapped.descriptor.name)});
  assert.equal(calls,1);assert.equal(policy.get('grant-1').usesRemaining,0);
});
test('an invalid write result retains ownership until original Runtime readback rather than enabling the other engine',async()=>{
  const f=fixture(),lease=f.lease();let calls=0;f.record('computer.desktop.click');
  const invalid=lease.wrap(tool('computer.desktop.click',async()=>({unverified:true})));
  await assert.rejects(invalid.execute({},context()),{code:'INVALID_ARGUMENT'});
  const other=lease.wrap(tool('computer.notepad.replace_text',async()=>{calls++;return {state:'observed'};}));
  await assert.rejects(other.execute({},context({taskId:'task-2',runId:'run-2'})),{code:'RESULT_UNKNOWN'});assert.equal(calls,0);
});
