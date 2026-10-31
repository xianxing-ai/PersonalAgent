import test from 'node:test';import assert from 'node:assert/strict';import {reconcileTaskFromSurface} from '../electron/reconcile-task-action.js';
function fixture(){const panel={},workspace={},calls=[];const task={taskId:'original',state:'waiting_reconciliation',surface:'panel'};return {task,calls,args:{taskId:'original',sender:panel,panel,workspace,tasks:new Map([['original',task]]),taskSurface:t=>t.surface,application:{async reconcileConfirmedSubagentTermination(id){calls.push(['reconcile',id]);}},async refresh(id){calls.push(['refresh',id]);return {...task,state:'cancelled'};},publish(){calls.push(['publish']);}}};}
test('trusted current surface reconciles original id then returns actual refreshed state',async()=>{const {args,calls}=fixture();const value=await reconcileTaskFromSurface(args);assert.equal(value.state,'cancelled');assert.deepEqual(calls,[['reconcile','original'],['refresh','original'],['publish']]);assert.equal(args.tasks.get('original').state,'waiting_reconciliation','Desktop does not invent a terminal transition');});
test('sender, surface, input and waiting-state gates reject without invoking Runtime',async()=>{for(const change of [a=>a.sender={},a=>a.sender=a.workspace,a=>a.taskId='other',a=>a.taskId={taskId:'original'},a=>a.tasks.get('original').state='running']){const {args,calls}=fixture();change(args);await assert.rejects(reconcileTaskFromSurface(args));assert.deepEqual(calls,[]);}});
test('unconfirmed original result stays waiting and errors remain visible without retry or refresh',async()=>{const {args,calls}=fixture();args.application.reconcileConfirmedSubagentTermination=async id=>{calls.push(['reconcile',id]);throw Error('原执行结果仍无法确认');};await assert.rejects(reconcileTaskFromSurface(args),/仍无法确认/);assert.deepEqual(calls,[['reconcile','original']]);assert.equal(args.tasks.get('original').state,'waiting_reconciliation');});

test('F24 surface action uses the current original revision and native observation scope, preserving unknown',async()=>{
 const {args,calls,task}=fixture();task.revision=4;
 const scope={deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal};
 const readback={kind:'f24_knowledge',state:'unknown',resumed:false,task};
 Object.assign(args.application,{runtime:{getTask:()=>({...task})},readF24RecoveryAvailable:()=>true,
  readHarnessCandidateRecoveryAvailable:()=>assert.fail('F24 must retain its original route'),
  async reconcileF24WorkflowTask(id,revision,actual){assert.equal(id,task.taskId);assert.equal(revision,4);assert.equal(actual,scope);return readback;}});
 args.observe=operation=>operation(scope);args.refresh=async()=>({...task});args.reportNative=async result=>assert.equal(result,readback);
 assert.equal((await reconcileTaskFromSurface(args)).state,'waiting_reconciliation');assert.deepEqual(calls,[['publish']]);
});

test('F24 stale revision or unavailable observer cannot start readback or continuation',async()=>{
 for(const stale of [true,false]){
  const {args,calls,task}=fixture();task.revision=4;
  Object.assign(args.application,{runtime:{getTask:()=>({...task,revision:stale?5:4})},readF24RecoveryAvailable:()=>true,
   reconcileF24WorkflowTask:()=>assert.fail('no readback before current revision and observer are established')});
  if(stale)args.observe=operation=>operation({});
  await assert.rejects(reconcileTaskFromSurface(args));assert.deepEqual(calls,[]);
 }
});
