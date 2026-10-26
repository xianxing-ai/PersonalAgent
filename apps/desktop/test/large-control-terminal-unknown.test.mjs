import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {ProtocolError,ToolNotStartedError} from '@personal-agent/contracts';
import {createComputerControlLease} from '../electron/computer-control-lease.js';
import {createBrowserControlHost} from '../electron/browser-control-host.js';

const base=path.resolve('.cache/large-control-terminal-unknown');mkdirSync(base,{recursive:true});
const schema={type:'object',properties:{},additionalProperties:false};
const outputSchema={type:'object',properties:{state:{type:'string'}},required:['state'],additionalProperties:false};
const isRead=name=>['browser.observe','browser.screenshot','browser.wait','computer.desktop.observe'].includes(name);
const descriptor=name=>({name,version:'1.0.0',inputSchema:schema,outputSchema,
  sideEffect:isRead(name)?'read':'external_write',requiredScopes:['synthetic:control'],requiresPresence:false,
  idempotencySupport:false,recoverySupport:false});
const scope=()=>({taskId:'synthetic-new-task',runId:'synthetic-new-run',authorizationRef:'synthetic-new-grant',
  deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,scopes:['synthetic:control']});

async function persistedUnknown(t,terminal,toolName='computer.desktop.click'){
  const directory=mkdtempSync(path.join(base,'case-')),file=path.join(directory,'runtime.sqlite');
  let originalCalls=0,runtime=new TaskRuntime(file,{createToolGateway:policy=>{
    const gateway=new ToolGateway({policy});gateway.register({descriptor:descriptor(toolName),async execute(){
      originalCalls++;throw new ProtocolError('RESULT_UNKNOWN','Synthetic driver acknowledgement was lost');
    }});return gateway;
  }});
  t.after(()=>runtime.close());
  const task=runtime.submitTask({goal:'Public synthetic unknown input receipt',conversationId:'synthetic-control',idempotencyKey:'original-task'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString();
  runtime.policy.grant({authorizationRef:'original-grant',taskId:task.taskId,toolName,
    scopes:['synthetic:control'],expiresAt:deadline,maxUses:1,argumentsDigest:toolArgumentsDigest({})});
  const response=await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:randomUUID(),taskId:task.taskId,
    idempotencyKey:'original-run',deadline,operation:'tool.invoke',payload:{toolName,toolVersion:'1.0.0',arguments:{},scopeRef:'original-grant'}},new AbortController().signal);
  assert.equal(response.outcome,'ok');assert.equal(response.data.state,'unknown');assert.equal(originalCalls,1);
  const before=runtime.getTask(task.taskId),records=runtime.readToolExecutions(task.taskId);
  assert.equal(before.state,'waiting_reconciliation');assert.equal(records.length,1);
  assert.equal(records[0].state,'unknown');assert.equal(records[0].executionStarted,true);assert.equal(records[0].policyDecision,'allow');
  if(terminal)runtime.finishNativeReconciliation(task.taskId,before.revision,{terminal,evidenceRefs:[records[0].evidenceId],
    reason:'Synthetic owned driver was stopped; the original operation remains unknown',
    assertUnchangedAndStopped(){assert.equal(originalCalls,1);}}); // Explicit synthetic host stop readback, no actual device.
  const original=runtime.getTask(task.taskId);
  runtime.close();runtime=new TaskRuntime(file);
  assert.equal(runtime.getTask(task.taskId).state,terminal??'waiting_reconciliation');
  assert.deepEqual(runtime.readToolExecutions(task.taskId),records);
  const preserve=()=>{assert.deepEqual(runtime.getTask(task.taskId),original);assert.deepEqual(runtime.readToolExecutions(task.taskId),records);assert.equal(originalCalls,1);};
  return {runtime,directory,taskId:task.taskId,preserve};
}

for(const terminal of ['failed','cancelled']){
  test(`a reopened shared lease retains ${terminal} original UNKNOWN input across all controlled engines`,async t=>{
    const f=await persistedUnknown(t,terminal);let newCalls=0,readCalls=0,unrelatedCalls=0;
    for(const name of ['computer.notepad.replace_text','computer.desktop.click','browser.click']){
      const lease=createComputerControlLease({getRuntime:()=>f.runtime});
      const tool=lease.wrap({descriptor:descriptor(name),async execute(){newCalls++;return {state:'observed'};}});
      await assert.rejects(tool.execute({},scope()),error=>error instanceof ToolNotStartedError&&error.code==='RESULT_UNKNOWN');
      assert.equal(lease.snapshot().writeBlocked,true);lease.close();
    }
    const reader=createComputerControlLease({getRuntime:()=>f.runtime});
    await reader.wrap({descriptor:descriptor('computer.desktop.observe'),async execute(){readCalls++;return {state:'observed'};}}).execute({},scope());
    const unrelated={descriptor:descriptor('unrelated.write'),async execute(){unrelatedCalls++;return {state:'observed'};}};
    assert.equal(reader.wrap(unrelated),unrelated);await unrelated.execute({},scope());reader.close();
    assert.equal(readCalls,1);assert.equal(unrelatedCalls,1);
    assert.equal(newCalls,0);f.preserve();
    t.diagnostic(JSON.stringify({kind:'actual_Runtime_SQLite_with_synthetic_driver',originalTaskId:f.taskId,terminal,
      originalRecord:'unknown',originalCalls:1,newCalls,readCalls,unrelatedCalls,originalUnchanged:true}));
  });
  test(`a reopened browser does not discard a ${terminal} task's original UNKNOWN write`,async t=>{
    const f=await persistedUnknown(t,terminal,'browser.click');let launchCalls=0;
    const host=createBrowserControlHost({userDataPath:path.join(f.directory,'browser'),authorizePresence:async()=>true,
      playwright:{chromium:{async launchPersistentContext(){launchCalls++;assert.fail('An unresolved original write must not launch a browser');}}}});
    t.after(()=>host.close());host.bind({runtime:f.runtime});
    assert.equal(host.snapshot().state,'blocked');assert.equal(launchCalls,0);f.preserve();
  });
}

test('original terminal UNKNOWN beyond the first candidate page still seals controlled input',async t=>{
  const f=await persistedUnknown(t,'cancelled');let newCalls=0;const pages=[];
  for(let index=0;index<125;index++){
    const task=f.runtime.submitTask({goal:'Public synthetic settled filler',conversationId:'synthetic-filler',idempotencyKey:'filler-'+index});
    f.runtime.transitionTask(task.taskId,'planning');f.runtime.transitionTask(task.taskId,'failed');
  }
  const source={listTasks(input){pages.push({...input});return f.runtime.listTasks(input);},
    readToolExecutions:f.runtime.readToolExecutions.bind(f.runtime),matchesToolExecutionInput:f.runtime.matchesToolExecutionInput.bind(f.runtime)};
  const lease=createComputerControlLease({getRuntime:()=>source});
  const action=lease.wrap({descriptor:descriptor('computer.desktop.click'),async execute(){newCalls++;return {state:'observed'};}});
  await assert.rejects(action.execute({},scope()),{code:'RESULT_UNKNOWN'});
  assert.equal(newCalls,0);assert.equal(pages.length,2);assert.ok(pages.every(page=>page.limit===100));
  assert.ok(Number.isSafeInteger(pages[1].beforeSequence));f.preserve();lease.close();
});

for(const toolName of ['browser.observe','browser.screenshot','browser.wait','computer.desktop.observe','weather.forecast','unrelated.write']){
  test(`${toolName} UNKNOWN does not seal a fresh shared write lease`,async t=>{
    const f=await persistedUnknown(t,'failed',toolName);let newCalls=0;
    const lease=createComputerControlLease({getRuntime:()=>f.runtime});
    const tool=lease.wrap({descriptor:descriptor('computer.desktop.click'),async execute(){newCalls++;return {state:'observed'};}});
    assert.equal((await tool.execute({},scope())).state,'observed');assert.equal(newCalls,1);f.preserve();lease.close();
  });
}
for(const toolName of ['browser.observe','browser.screenshot','browser.wait']){
  test(`a browser bind does not treat unresolved read ${toolName} as an uncertain input write`,async t=>{
    const f=await persistedUnknown(t,undefined,toolName);
    const host=createBrowserControlHost({userDataPath:path.join(f.directory,'browser'),authorizePresence:async()=>true});
    t.after(()=>host.close());host.bind({runtime:f.runtime});
    assert.equal(host.snapshot().state,'stopped');f.preserve();
  });
}
