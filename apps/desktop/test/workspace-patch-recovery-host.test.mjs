import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspacePatchRecoveryHost} from '../electron/workspace-patch-recovery-host.js';

function fixture() {
  let allowed = true, calls = 0;
  const task = {taskId:'task-1',state:'waiting_reconciliation',revision:4};
  const result = {taskId:task.taskId,runId:'original-run',task,
    result:{state:'reconciled',outcome:'applied',path:'PRIVATE',pid:123},evidence:['SECRET']};
  const application = {runtime:{getTask(id) { if(id !== task.taskId) throw Error('PRIVATE'); return {...task}; }},
    async reconcileWorkspacePatchTask() { calls++; task.state='cancelled'; task.revision=5; return result; }};
  return {task,result,application,host:()=>createWorkspacePatchRecoveryHost({application,isAuthorized:()=>allowed}),
    revoke:()=>{allowed=false;},calls:()=>calls};
}
test('host exposes only original identity, task state and the four patch outcomes',async()=>{
  for(const outcome of ['applied','not_applied','unknown','in_progress']) {
    const f=fixture(); f.result.result=outcome==='in_progress'?{state:'in_progress',path:'PRIVATE',pid:123}
      :{state:'reconciled',outcome,path:'PRIVATE'};
    assert.deepEqual(await f.host().reconcile({taskId:'task-1',expectedRevision:4}),
      {taskId:'task-1',runId:'original-run',revision:5,taskState:'cancelled',outcome});
    assert.equal(f.calls(),1);
  }
});
test('duplicate requests share recovery across host instances and lost replies only reread Runtime',async()=>{
  const f=fixture();let release;const gate=new Promise(r=>{release=r;});
  const original=f.application.reconcileWorkspacePatchTask;
  f.application.reconcileWorkspacePatchTask=async()=>{await gate;return original();};
  const a=f.host().reconcile({taskId:'task-1',expectedRevision:4});
  const b=f.host().reconcile({taskId:'task-1',expectedRevision:4}); release();
  assert.deepEqual(await a,await b);assert.equal(f.calls(),1);
  await f.host().reconcile({taskId:'task-1',expectedRevision:5});assert.equal(f.calls(),2);
  // The bridge only calls Runtime recovery. It has no submit/execute/grant interface.
});
test('untrusted, stale, unknown and malformed requests fail without dispatch or private errors',async()=>{
  for(const mode of ['untrusted','stale','unknown','extra','missing']) {
    const f=fixture();if(mode==='untrusted')f.revoke();
    const input=mode==='missing'?{}:{taskId:mode==='unknown'?'other':'task-1',expectedRevision:mode==='stale'?3:4,
      ...(mode==='extra'?{path:'PRIVATE'}:{})};
    await assert.rejects(f.host().reconcile(input),e=>!e.message.includes('PRIVATE'));
    assert.equal(f.calls(),0);
  }
});
test('session loss, Runtime rejection and malformed readback never leak raw data',async()=>{
  for(const mode of ['session','error','identity','invalid-outcome']) {
    const f=fixture();const original=f.application.reconcileWorkspacePatchTask;
    f.application.reconcileWorkspacePatchTask=async()=>{
      if(mode==='error')throw Error('PRIVATE PID credential');
      const result=await original();if(mode==='session')f.revoke();
      if(mode==='identity')result.taskId='other';
      if(mode==='invalid-outcome')result.result.outcome='PRIVATE';return result;
    };
    await assert.rejects(f.host().reconcile({taskId:'task-1',expectedRevision:4}),e=>!e.message.includes('PRIVATE'));
  }
});
