import test from 'node:test';
import assert from 'node:assert/strict';

const escape = value => String(value).replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

test('admin task monitor reads steps and Evidence counts without exposing refs or inventing source', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  globalThis.window = {addEventListener() {}};
  t.after(() => previous
    ? Object.defineProperty(globalThis, 'matchMedia', previous)
    : delete globalThis.matchMedia);
  t.after(() => previousWindow
    ? Object.defineProperty(globalThis, 'window', previousWindow)
    : delete globalThis.window);
  const {taskTable} = await import('../src/features/admin/view.js');
  const html = taskTable({tasks: [{taskId: 'task-1', userMessage:'总结 <script>报告</script>', state: 'waiting_approval', revision: 3,
    steps: [{stepId: 'one', label: '<private>', state: 'waiting'}],
    evidenceRefs: ['secret-ref'], resultSummary: '等待用户授权'}]}, escape);
  assert.match(html, /等待授权/);
  assert.match(html, /class="task-record-title">总结 &lt;script&gt;报告&lt;\/script&gt;/);
  assert.match(html, /class="task-record-id">task-1/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /步骤 1 项 · Evidence 引用 1 条/);
  assert.match(html, /&lt;private&gt;/);
  assert.doesNotMatch(html, /secret-ref|<private>/);
  assert.match(html, /此接口未提供任务来源或云端 trace/);
  const patches = new Map([['task-1', {result:{revision:4,taskState:'cancelled',outcome:'applied'}}]]);
  const recovered = taskTable({tasks:[{taskId:'task-1',state:'waiting_reconciliation',revision:3}]},escape,new Map(),patches);
  assert.match(recovered, /data-state="cancelled">已取消<\/span><\/td><td>4<\/td>/);
  assert.match(recovered, /此前修改已写入/);
  const newer = taskTable({tasks:[{taskId:'task-1',state:'waiting_reconciliation',revision:5}]},escape,new Map(),patches);
  assert.match(newer, /data-state="waiting_reconciliation">结果待核实<\/span><\/td><td>5<\/td>/);
  assert.doesNotMatch(newer, /此前修改已写入/);
});
