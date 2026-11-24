import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createF12ReturnDigestController} from '../electron/f12-return-digest-controller.js';

test('return controller freezes per-scope IDs and reuses the original admissions after feed changes',()=>{
  const checkpoints=new Map(),tasks=new Map(),submitted=[],seen=[];
  const source={taskId:'source',sessionId:'session',sourceTaskId:'user',commandId:'return',controlRevision:1};
  let items=[{id:'b',scope:{kind:'connector',connectorId:'mail'}},{id:'a',scope:{kind:'connector',connectorId:'mail'}},
    {id:'c',scope:{kind:'connector',connectorId:'calendar'}}];
  const application={runtime:{loadCheckpoint:(_id,key)=>checkpoints.get(key),saveCheckpointOnce(_id,key,value){if(checkpoints.has(key))return false;
    checkpoints.set(key,structuredClone(value));return true;}},readF12ReturnDigestTask:key=>tasks.get(key),submitF12ReturnDigestTask(request){
      submitted.push(structuredClone(request));const task={taskId:'digest-'+submitted.length,state:'waiting_approval'};tasks.set(request.idempotencyKey,task);return task;}};
  const controller=createF12ReturnDigestController({getApplication:()=>application,explicitReturnSource:{acceptExplicitReturn(value){
    assert.deepEqual(value,source);return {conversationId:'original-conversation',taskDeadline:'2099-01-01T00:00:00.000Z',idempotencyKey:'original-command'};}},
    notificationHost:{getDigest(input){assert.deepEqual(input,{trigger:'on_return'});return {items};}},now:()=>0,readTimeoutMs:()=>60000,onTask:task=>seen.push(task)});
  const result=controller.submit(source);assert.equal(result.tasks.length,2);assert.equal(result.state,'submitted');
  assert.deepEqual(submitted.map(item=>item.arguments.itemIds),[['a','b'],['c']]);
  assert.ok(submitted.every(item=>item.conversationId==='original-conversation'&&item.deadline==='1970-01-01T00:01:00.000Z'));
  items=[{id:'new',scope:{kind:'global'}}];assert.deepEqual(controller.submit(source),result);
  assert.equal(submitted.length,2);assert.equal(seen.length,4);
});

test('actual Main only admits return after trusted control success and preserves confirmed control on digest failure',async()=>{
  const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const start=main.indexOf("if (name.startsWith('proactive.workflow.'))"),end=main.indexOf("if (name === 'proactive.configure'",start);
  assert.ok(start>=0&&end>start);
  const panel={},admin={},requests=[];let controls=0,failControl=false,failDigest=false;
  const context={panel,admin,sender:panel,competitionMode:true,name:'proactive.workflow.control',
    payload:{taskId:'original',sourceTaskId:'user',commandId:'command',action:'return',expectedControlRevision:4},
    proactiveWorkflowApplication:{async control(){controls++;if(failControl)throw Error('control unavailable');return {mode:'attended'};},
      read:()=>({binding:{sessionId:'session',controlRevision:5}})},f12ReturnDigest:{submit(source){requests.push(source);
        if(failDigest)throw Error('digest unknown');return {state:'submitted',tasks:[{taskId:'digest',state:'waiting_approval'}]};}},publish(){}};
  const run=()=>runInNewContext('(async()=>{'+main.slice(start,end)+'})()',context);
  assert.equal((await run()).notificationDigest.state,'submitted');
  assert.equal(JSON.stringify(requests[0]),JSON.stringify({taskId:'original',sessionId:'session',sourceTaskId:'user',commandId:'command',controlRevision:5}));
  context.sender={};await assert.rejects(run());assert.equal(controls,1);context.sender=panel;
  failControl=true;await assert.rejects(run());assert.equal(requests.length,1);failControl=false;
  context.payload.action='pause';await run();assert.equal(requests.length,1);
  context.payload.action='return';failDigest=true;const unknown=await run();
  assert.equal(unknown.mode,'attended');assert.equal(unknown.notificationDigest.state,'unconfirmed');
});
