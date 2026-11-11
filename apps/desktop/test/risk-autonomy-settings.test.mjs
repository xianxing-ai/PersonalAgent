import assert from 'node:assert/strict';
import test from 'node:test';
import {createEncryptedAutonomyStore, createRiskAutonomyHost} from '../electron/risk-autonomy-host.js';
import {mountRiskAutonomySettings, riskAutonomyButtonLabel} from '../src/features/admin/risk-autonomy-settings.js';

const digest = 'c'.repeat(64);

test('risk settings survive a new host and a notification click executes the stored compensation', () => {
  const values = new Map();
  const storage = {
    get: key => values.has(key) ? structuredClone(values.get(key)) : undefined,
    set(key, value) { values.set(key, structuredClone(value)); },
  };
  const sent = [];
  const calls = [];
  const host = createRiskAutonomyHost({
    store: createEncryptedAutonomyStore(storage),
    channel: {sendAdvisoryNotification: async input => { sent.push(input); return {delivered: false}; }},
    getApplication: () => ({
      submitHostToolTask(request) {
        calls.push(request);
        return {task: {taskId: 'undo-task', state: 'waiting_approval'}, approval: {approvalId: 'approval-1', revision: 1, state: 'pending'}};
      },
      runtime: {respondApproval(id, decision, revision) { calls.push({id, decision, revision}); }},
      resumeHostToolTask(taskId) { calls.push({resume: taskId}); },
    }),
  });
  host.setStance('balanced');
  const restored = createRiskAutonomyHost({store: createEncryptedAutonomyStore(storage), getApplication: () => undefined});
  assert.equal(restored.snapshot().stance, 'balanced');
  host.setStance('autonomous');
  host.gate.recordGranted({
    taskId: 'task-1', runId: 'run-1', toolName: 'todo.update', toolVersion: '1.0.0',
    sideEffect: 'local_write', recoverySupport: true, requiresPresence: false, argumentsDigest: digest,
    disposition: 'execute_and_notify',
  });
  assert.equal(sent.length, 0);
  host.gate.rememberCompensation({runId: 'run-1', toolName: 'notes.restore', toolVersion: '1.0.0', arguments: {note: 'back'}});
  host.gate.notifyGranted({runId: 'run-1'});
  assert.equal(sent[0].title, '已自动完成');
  assert.match(sent[0].body, /点击此通知可撤销/);
  const result = host.compensate(sent[0].id);
  assert.equal(result.executed, true);
  assert.equal(calls[0].toolName, 'notes.restore');
  assert.equal(calls[0].arguments.note, 'back');
  assert.deepEqual(calls[1], {id: 'approval-1', decision: 'allow_once', revision: 1});
  assert.deepEqual(calls[2], {resume: 'undo-task'});
});

function element(tag) {
  const node = {
    tag, hidden: false, textContent: '', value: '', children: [],
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    querySelector(selector) {
      const name = selector.match(/data-risk="([^"]+)"/)?.[1];
      return this.fields?.[name];
    },
  };
  return node;
}

test('the settings section only keeps the stance, two category overrides, one revoke button and the recent list', async () => {
  const fields = {};
  for (const name of ['stance', 'read', 'local_reversible_write', 'revoke', 'audits', 'status']) fields[name] = element(name);
  const section = element('section');
  section.querySelector = selector => fields[selector.match(/data-risk="([^"]+)"/)[1]];
  const original = globalThis.document;
  globalThis.document = {createElement: tag => tag === 'section' ? section : element(tag)};
  const calls = [];
  try {
    const view = mountRiskAutonomySettings({append() {}}, async (action, payload) => {
      calls.push({action, payload});
      return {stance: payload?.stance ?? 'autonomous', revoked: action === 'riskAutonomy.revoke', categories: [], audits: []};
    });
    const html = section.innerHTML;
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.equal(html.includes('保存'), false);
    assert.equal(html.includes('刷新'), false);
    assert.equal(html.includes('统计'), false);
    assert.equal((html.match(/<select/g) ?? []).length, 3);
    assert.match(html, /发消息、付款、删除和对外提交始终先问/);
    fields.stance.value = 'balanced';
    await fields.stance.onchange();
    assert.deepEqual(calls[0], {action: 'riskAutonomy.setStance', payload: {stance: 'balanced'}});
    assert.equal(fields.revoke.textContent, '停止自动执行');
    fields.revoke.onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[1].action, 'riskAutonomy.revoke');
    assert.equal(fields.revoke.textContent, riskAutonomyButtonLabel(true));
    view.render({stance: 'autonomous', revoked: true, categories: [], audits: [{toolName: 'todo.update', disposition: 'execute_and_notify', rollback: 'available'}]});
    assert.equal(fields.audits.children.length, 1);
    assert.equal(fields.audits.children[0].textContent.includes('todo.update'), true);
    assert.equal(fields.audits.children[0].children.length, 0);
  } finally {
    globalThis.document = original;
  }
});
