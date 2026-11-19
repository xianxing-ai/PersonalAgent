import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {TaskRuntime} from '../dist/index.js';

test('paged private bindings preserve sorted ancestry and erasure receipt identity', async () => {
  const runtime = new TaskRuntime(':memory:');
  try {
    const ids = Array.from({length: 6}, (_, i) => runtime.submitTask({goal:'synthetic', conversationId:'binding-test', idempotencyKey:`case-${i}`}).taskId).sort();
    const [a,b,c,cycleA,cycleB,root] = ids;
    runtime.saveCheckpoint(root, 'private-memory:consumption:v1', {taskId:root, destination:'agentarts', fact:{ref:{id:'synthetic-fact'}}});
    runtime.saveCheckpoint(a, 'subtask-parent', {parentTaskId:c,subtaskId:'a'});
    runtime.saveCheckpoint(b, 'subtask-parent', {parentTaskId:root,subtaskId:'b'});
    runtime.saveCheckpoint(c, 'subtask-parent', {parentTaskId:b,subtaskId:'c'});
    runtime.saveCheckpoint(cycleA, 'subtask-parent', {parentTaskId:cycleB,subtaskId:'cycle-a'});
    runtime.saveCheckpoint(cycleB, 'subtask-parent', {parentTaskId:cycleA,subtaskId:'cycle-b'});
    const all = runtime.listBindings().items;
    assert.deepEqual(all.map(item=>item.taskId), [a,b,c,root]);
    assert.equal(all.find(item=>item.taskId===a).binding.derivedFromTaskId,root);
    assert.equal(all.find(item=>item.taskId===b).binding.derivedFromTaskId,root);
    const target=all.find(item=>item.taskId===c);
    assert.equal(target.binding.derivedFromTaskId,b);
    const paged=[]; let afterTaskId;
    do { const page=runtime.listBindings({limit:1,...(afterTaskId?{afterTaskId}:{})}); paged.push(...page.items); afterTaskId=page.nextAfterTaskId; } while(afterTaskId);
    assert.deepEqual(paged,all);
    const bindingDigest=createHash('sha256').update(JSON.stringify(target.binding)).digest('hex');
    const deadline=new Date(Date.now()+60_000).toISOString(),signal=new AbortController().signal;
    await runtime.runTask(c,async()=> 'synthetic result',{deadline,signal});
    assert.equal(runtime.eraseTaskCopies({taskId:c,factId:'synthetic-fact',bindingDigest,deadline,signal}).state,'purged');
    assert.deepEqual(runtime.readCopyErasureReceipt(c),{taskId:c,factId:'synthetic-fact',bindingDigest,state:'purged'});
    assert.equal(runtime.listBindings({limit:1,afterTaskId:b}).items[0].binding.derivedFromTaskId,b);
  } finally {runtime.close();}
});

