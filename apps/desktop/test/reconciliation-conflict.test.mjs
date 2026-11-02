import test from 'node:test';
import assert from 'node:assert/strict';
import {readReconciliationConflict,recordReconciliationConflictSkip,recordUnavailableConflictNotification,
 assertNoUnresolvedWriteReplay,inspectReconciliationConflictOnce} from '../electron/reconciliation-conflict.js';
import {readReconciliationStatus,readConversationConflictTasks} from '../electron/reconciliation-status.js';
import {skipReconciliationConflictFromSurface} from '../electron/reconcile-task-action.js';
import {conflictDecisionMarkup,conflictDecisionPayload} from '../src/features/conversation/conflict-decision.js';
import {conversationTimeline} from '../src/features/conversation/timeline.js';

function fixture(state='waiting_reconciliation'){
 const task={taskId:'original',state,revision:4,surface:'panel'},checkpoints=new Map();
 const records=[{evidenceId:'run-1',inputDigest:'a'.repeat(64),toolName:'mail.send',toolVersion:'1.0',
  policyDecision:'allow',executionStarted:true,state:state==='failed'?'failed':'unknown'}];
 const runtime={getTask:id=>id===task.taskId?task:{taskId:id,state:'running',revision:1},readToolExecutions:()=>records,
  readExecutionEpoch:()=>checkpoints.get('execution-epoch')??0,
  loadCheckpoint:(_id,key)=>structuredClone(checkpoints.get(key)),
  saveCheckpoint(_id,key,value){checkpoints.set(key,structuredClone(value));},
  saveCheckpointOnce(_id,key,value){if(checkpoints.has(key))return false;checkpoints.set(key,structuredClone(value));return true;}};
 return {task,checkpoints,records,application:{runtime}};
}
const scope=()=>({deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

for(const state of ['waiting_reconciliation','failed'])test(state+' exact skip preserves original state and rejects a changed frontier',()=>{
 const f=fixture(state);if(state==='failed')f.records[0].executionStarted=false;
 const binding=readReconciliationConflict(f.application,f.task);assert.equal(binding.skipped,false);
 recordReconciliationConflictSkip(f.application,f.task,binding);
 assert.equal(readReconciliationConflict(f.application,f.task).skipped,true);assert.equal(f.task.state,state);
 recordReconciliationConflictSkip(f.application,f.task,binding);
 f.records[0].inputDigest='b'.repeat(64);
 assert.equal(readReconciliationConflict(f.application,f.task).skipped,false);
 assert.throws(()=>recordReconciliationConflictSkip(f.application,f.task,binding),/变化/);
});

test('policy denials and ordinary network failures do not become dangerous-action conflict prompts',()=>{
 const f=fixture('failed');f.records[0].policyDecision='deny';
 for(const key of ['competition-coordination-failure','competition-cloud-terminal-error','competition-cloud-received-failure'])f.checkpoints.set(key,{code:'EXTERNAL_FAILURE'});
 assert.equal(readReconciliationConflict(f.application,f.task),undefined);
 f.records[0].policyDecision='allow';f.records[0].toolName='calendar.list';
 assert.equal(readReconciliationConflict(f.application,f.task),undefined);
});

test('stale failed proposal is discarded while original started unknown and newer-epoch failures remain visible',()=>{
 const f=fixture('failed');f.checkpoints.set('execution-epoch',2);f.checkpoints.set('competition-stale-epoch',{expected:1,current:2});
 f.checkpoints.set('execution-epoch:run:run-1',1);f.records[0].executionStarted=false;
 assert.equal(readReconciliationConflict(f.application,f.task),undefined);
 f.checkpoints.set('execution-epoch:run:run-1',2);assert.ok(readReconciliationConflict(f.application,f.task));
 f.records[0].executionStarted=true;f.records[0].state='unknown';f.checkpoints.set('execution-epoch:run:run-1',1);
 assert.ok(readReconciliationConflict(f.application,f.task),'an original started unknown survives a failed task snapshot');
 f.task.state='waiting_reconciliation';
 assert.ok(readReconciliationConflict(f.application,f.task));
 f.records.length=0;f.checkpoints.set('competition-loop',{executionEpoch:1});f.checkpoints.set('competition-cloud-unknown',{requestId:'old'});
 assert.equal(readReconciliationConflict(f.application,f.task),undefined);
 f.checkpoints.set('competition-loop',{executionEpoch:2});assert.ok(readReconciliationConflict(f.application,f.task));
});

test('cloud completion disagreement binds only the current epoch and exact received result',()=>{
 const f=fixture('failed');f.records.length=0;f.checkpoints.set('execution-epoch',2);
 const mismatch={version:1,executionEpoch:1,cloudResultDigest:'c'.repeat(64),localVerdict:'required_delegation_incomplete'};
 f.checkpoints.set('competition-completion-conflict',mismatch);assert.equal(readReconciliationConflict(f.application,f.task),undefined);
 mismatch.executionEpoch=2;f.checkpoints.set('competition-completion-conflict',mismatch);
 const current=readReconciliationConflict(f.application,f.task);assert.equal(current.kind,'cloud_local');assert.match(current.notice,/必需子任务/);
 recordReconciliationConflictSkip(f.application,f.task,current);mismatch.cloudResultDigest='d'.repeat(64);
 assert.equal(readReconciliationConflict(f.application,f.task).skipped,false);
});

test('surface skip rejects a different window/conversation or revision and never calls execution/resume',async()=>{
 for(const invalid of ['sender','surface','conversation','revision',null]){
  const f=fixture(),panel={},workspace={},calls=[],binding=readReconciliationConflict(f.application,f.task);
  const args={payload:{taskId:f.task.taskId,conflictId:binding.conflictId,expectedRevision:binding.expectedRevision,conversationId:'conversation'},
   sender:panel,panel,workspace,tasks:new Map([[f.task.taskId,f.task]]),taskSurface:task=>task.surface,
   conversations:{conversationIdForTask:()=> 'conversation',activeConversationId:()=>invalid==='conversation'?'other':'conversation'},
   application:f.application,refresh:async()=>{calls.push('refresh');return f.task;},publish:()=>calls.push('publish')};
  if(invalid==='sender')args.sender={};if(invalid==='surface')args.sender=workspace;if(invalid==='revision')args.payload.expectedRevision--;
  if(invalid){await assert.rejects(skipReconciliationConflictFromSurface(args));assert.deepEqual(calls,[]);assert.equal(f.checkpoints.size,0);}
  else{assert.equal((await skipReconciliationConflictFromSurface(args)).state,'waiting_reconciliation');assert.deepEqual(calls,['refresh','publish']);}
 }
});

test('trusted child conflict reaches its owner conversation and exact skip never changes the parent or original operation',async()=>{
 const parent={taskId:'parent',state:'succeeded',revision:9,surface:'panel',conversationId:'owner'},
   child={taskId:'child',state:'waiting_reconciliation',revision:4,conversationId:'desktop-subtask:parent'},
   forged={...child,taskId:'forged'},all=new Map([parent,child,forged].map(task=>[task.taskId,task])),checkpoints=new Map();
 const records=[{evidenceId:'child-write',inputDigest:'a'.repeat(64),toolName:'mail.send',toolVersion:'1.0',policyDecision:'allow',executionStarted:true,state:'unknown'}];
 const original=structuredClone({parent,child,records}),runtime={getTask:id=>all.get(id),readExecutionEpoch:()=>0,
   readToolExecutions:id=>id===child.taskId?records:[],loadCheckpoint:(id,key)=>structuredClone(checkpoints.get(id+':'+key)),
   saveCheckpointOnce(id,key,value){const name=id+':'+key;if(checkpoints.has(name))return false;checkpoints.set(name,structuredClone(value));return true;}};
 let active='owner',bound=true;
 const application={runtime,readToolConversation:id=>bound&&id===child.taskId?'owner':undefined,
   readSubagentTasks:id=>id===parent.taskId?[{parentTaskId:id,taskId:child.taskId}]:[]};
 const conversations={sessions:new Map([['owner',{surface:'panel'}],['other',{surface:'panel'}],['workspace',{surface:'workspace'}]]),
   activeConversationId:surface=>surface==='panel'?active:'workspace',conversationIdForTask:task=>task.conversationId};
 const taskSurface=task=>task.surface,scope={application,tasks:[parent,forged],parents:[parent],surface:'panel',taskSurface,conversations};
 const projected=readConversationConflictTasks(scope);assert.deepEqual(projected,[child]);
 assert.equal(conversationTimeline(projected)[0].value.taskId,child.taskId,'synthetic child conversation is not filtered by the renderer timeline');
 const task={...projected[0],conflictOnly:true,reconciliationStatus:{...readReconciliationStatus(application,child),conversationId:'owner'}};
 const payload=conflictDecisionPayload(task);assert.equal(payload.taskId,child.taskId);assert.equal(payload.expectedRevision,child.revision);
 assert.match(conflictDecisionMarkup(task,escape),/data-id="child"/);assert.match(conflictDecisionMarkup(task,escape,true),/data-skip-conflict="child"/);
 const panel={},workspace={},calls=[],args={payload,sender:panel,panel,workspace,tasks:new Map([[parent.taskId,parent]]),taskSurface,
   conversations,application,refresh:async id=>{calls.push(id);return runtime.getTask(id);},publish:()=>calls.push('publish')};
 for(const change of [{expectedRevision:3},{conflictId:'f'.repeat(64)},{conversationId:'other'},{taskId:parent.taskId}])
   await assert.rejects(skipReconciliationConflictFromSurface({...args,payload:{...payload,...change}}));
 await assert.rejects(skipReconciliationConflictFromSurface({...args,sender:workspace}));
 active='other';assert.deepEqual(readConversationConflictTasks(scope),[]);await assert.rejects(skipReconciliationConflictFromSurface(args));active='owner';
 bound=false;assert.deepEqual(readConversationConflictTasks(scope),[]);await assert.rejects(skipReconciliationConflictFromSurface(args));bound=true;
 assert.equal(checkpoints.size,0);assert.deepEqual(calls,[]);
 assert.equal((await skipReconciliationConflictFromSurface(args)).taskId,child.taskId);assert.deepEqual(calls,['child','publish']);
 assert.deepEqual({parent,child,records},original);assert.equal(readReconciliationConflict(application,child).skipped,true);
 assert.ok([...checkpoints.keys()].every(key=>key.startsWith('child:reconciliation-conflict-decision:')));
});

test('only the conflicted original write is held; reads and independently scheduled tasks remain available',()=>{
 const f=fixture();assert.throws(()=>assertNoUnresolvedWriteReplay({...f,taskId:f.task.taskId,sideEffect:'external_write'}),/只允许/);
 assertNoUnresolvedWriteReplay({...f,taskId:f.task.taskId,sideEffect:'read'});
 assertNoUnresolvedWriteReplay({...f,taskId:'independent',sideEffect:'external_write'});
 const notification=recordUnavailableConflictNotification(f.application,f.task.taskId);
 assert.equal(notification.state,'notification_skipped');assert.equal(notification.reason,'fixed_contact_email_unavailable');assert.equal(f.task.state,'waiting_reconciliation');
});

test('automatic original read is claimed once, including concurrent calls, and never consumes the original conflict',async()=>{
 const f=fixture();let calls=0,finish;const readOriginal=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const args={...f,taskId:f.task.taskId,readOriginal,...scope()},first=inspectReconciliationConflictOnce(args);
 assert.equal((await inspectReconciliationConflictOnce(args)).state,'started');assert.equal(calls,1);
 finish({state:'confirmed'});assert.equal((await first).state,'confirmed');
 assert.equal((await inspectReconciliationConflictOnce(args)).state,'confirmed');assert.equal(calls,1);
 assert.equal(f.task.state,'waiting_reconciliation');assert.equal(readReconciliationConflict(f.application,f.task).skipped,false);
});

test('missing reader stays explicitly unavailable; a later reader is not silently invoked',async()=>{
 const f=fixture(),args={...f,taskId:f.task.taskId,...scope()};
 assert.equal((await inspectReconciliationConflictOnce(args)).state,'unavailable');
 assert.equal((await inspectReconciliationConflictOnce({...args,readOriginal:()=>assert.fail('no replay')})).state,'unavailable');
});

test('readback abort bounds even an uncooperative port, persists unknown and never retries',async()=>{
 const f=fixture(),controller=new AbortController();let calls=0;
 const args={...f,taskId:f.task.taskId,deadline:new Date(Date.now()+5000).toISOString(),signal:controller.signal,
  readOriginal:()=>{calls++;return new Promise(()=>{});}};
 const pending=inspectReconciliationConflictOnce(args);await Promise.resolve();controller.abort();
 assert.equal((await pending).state,'unknown');assert.equal((await inspectReconciliationConflictOnce(args)).state,'unknown');assert.equal(calls,1);
});

test('readback deadline bounds an uncooperative original port without reopening its execution',async()=>{
 const f=fixture();const result=await inspectReconciliationConflictOnce({...f,taskId:f.task.taskId,
  deadline:new Date(Date.now()+30).toISOString(),signal:new AbortController().signal,readOriginal:()=>new Promise(()=>{})});
 assert.equal(result.state,'unknown');assert.equal(f.task.state,'waiting_reconciliation');
});

test('failure cards and both actual renderer consumers offer exact skip without implying success',()=>{
 for(const state of ['waiting_reconciliation','failed']){
  const f=fixture(state),status=readReconciliationStatus(f.application,f.task),task={...f.task,reconciliationStatus:{...status,conversationId:'conversation'}};
  assert.match(status.conflictId,/^[a-f0-9]{64}$/);assert.equal(conflictDecisionPayload(task).expectedRevision,4);
  assert.match(conflictDecisionMarkup(task,escape),/task.reconcile.skip/);assert.match(conflictDecisionMarkup(task,escape,true),/data-skip-conflict/);
  assert.match(conflictDecisionMarkup(task,escape),/不代表成功/);
  recordReconciliationConflictSkip(f.application,f.task,{...readReconciliationConflict(f.application,f.task)});
  task.reconciliationStatus=readReconciliationStatus(f.application,f.task);
  assert.doesNotMatch(conflictDecisionMarkup(task,escape),/<button/);assert.throws(()=>conflictDecisionPayload(task),/变化/);
 }
 const f=fixture('failed');f.application.runtime.readToolExecutions=()=>{throw Error('private receipt');};
 const status=readReconciliationStatus(f.application,f.task);assert.match(status.notice,/保留失败/);assert.doesNotMatch(JSON.stringify(status),/private receipt/);
});
