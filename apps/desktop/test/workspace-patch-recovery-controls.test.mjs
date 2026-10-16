import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspacePatchRecoveryControls,workspacePatchRecoveryHtml} from '../src/features/admin/workspace-patch-recovery-controls.js';
const task={taskId:'task-1',revision:4};
const value={taskId:'task-1',runId:'run-1',revision:5,taskState:'cancelled',outcome:'applied'};
const setup=()=>{let resolve,calls=0;const response=new Promise(r=>resolve=r);
  const c=createWorkspacePatchRecoveryControls({invoke:()=>{calls++;return response;},changed(){}});
  c.sync([task],true);return {c,resolve,calls:()=>calls};};
test('duplicate clicks invoke once and cancelled applied is displayed separately',async()=>{
  const f=setup();const pending=f.c.reconcile(task.taskId);await f.c.reconcile(task.taskId);
  assert.equal(f.calls(),1);assert.match(workspacePatchRecoveryHtml(task,f.c.entries.get(task.taskId),String),/disabled/);
  f.resolve(value);await pending;
  assert.match(workspacePatchRecoveryHtml(task,f.c.entries.get(task.taskId),String),/任务已取消，但此前修改已写入/);
});
test('navigation, disposal, missing task and newer revision discard old replies',async()=>{
  for(const mode of ['navigation','other-task-page','closed','removed','newer','identity']) {
    const f=setup();const pending=f.c.reconcile(task.taskId);
    if(mode==='navigation'){f.c.sync([task],false);f.c.sync([task],true);}
    if(mode==='other-task-page')f.c.sync([task],true,'overview');
    if(mode==='closed')f.c.close();
    if(mode==='removed')f.c.sync([],true);
    if(mode==='newer')f.c.sync([{...task,revision:6}],true);
    f.resolve(mode==='identity'?{...value,taskId:'other'}:value);await pending;
    assert.equal(f.c.entries.get(task.taskId)?.result,undefined);
    assert.equal(f.calls(),1);
  }
});
test('IPC rejection is generic and remains retryable without raw errors',async()=>{
  let calls=0;const c=createWorkspacePatchRecoveryControls({invoke:async()=>{calls++;throw Error('PRIVATE');},changed(){}});
  c.sync([task],true);await c.reconcile(task.taskId);await c.reconcile(task.taskId);
  assert.equal(calls,2);assert.equal(c.entries.get(task.taskId).pending,undefined);
  assert.doesNotMatch(workspacePatchRecoveryHtml(task,c.entries.get(task.taskId),String),/PRIVATE/);
});
