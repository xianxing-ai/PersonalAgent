import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPermissionAuditProduct} from '../electron/permission-audit-product.js';
import {renderPermissionSheet} from '../src/features/workspace/permission-sheet.js';
import {readFileSync as readSource} from 'node:fs';

test('the product lists grants, revokes through the existing port, and chains the operation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-audit-'));
  const rules = [{id: 'rule-1', kind: 'rule', label: '允许读取天气', revision: 3, revocable: true}];
  const revoked = [];
  const product = createPermissionAuditProduct({
    userData: dir,
    list: () => [{id: 'sandbox', kind: 'sandbox', label: '只读', revocable: false}, ...rules],
    revoke: grant => { revoked.push(grant.id); rules.splice(0, rules.length); return {revoked: grant.id}; },
  });
  const [tool] = product.observeTools([{descriptor: {name: 'mail.inbox', sideEffect: 'read'}, execute: async () => ({ok: true})}]);
  assert.deepEqual(await tool.execute({}, {taskId: 't1'}), {ok: true});
  const state = product.handleAction('assistantPermissions.state', undefined);
  assert.equal(state.grants[1].label, '允许读取天气');
  assert.equal(state.audit.intact, true);
  assert.equal(state.audit.count >= 2, true);
  const after = product.handleAction('assistantPermissions.revoke', {id: 'rule-1', kind: 'rule', revision: 3});
  assert.deepEqual(revoked, ['rule-1']);
  assert.equal(after.grants.some(grant => grant.id === 'rule-1'), false);
  assert.equal(after.recorded, true);
  const stored = JSON.parse(readFileSync(path.join(dir, 'permission-audit.json'), 'utf8'));
  stored[0].subject = 'tampered';
  writeFileSync(path.join(dir, 'permission-audit.json'), JSON.stringify(stored));
  const reloaded = createPermissionAuditProduct({userData: dir, list: () => [], revoke: () => {}});
  assert.equal(reloaded.snapshot().audit.intact, false);
  assert.equal(reloaded.snapshot().audit.brokenAt, 1);
});

test('the permission sheet offers revoke only for revocable grants', () => {
  const nodes = [];
  const original = globalThis.document;
  globalThis.document = {createElement() {
    const node = {textContent: '', type: '', children: [], dataset: {}, hidden: false};
    node.append = child => node.children.push(child);
    node.replaceChildren = () => { node.children = []; };
    nodes.push(node);
    return node;
  }};
  try {
    const sheet = {dataset: {}, children: [], append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }};
    const calls = [];
    renderPermissionSheet(sheet, {grants: [{id: 'sandbox', kind: 'sandbox', label: '只读', revocable: false}, {id: 'rule-1', kind: 'rule', label: '天气', revision: 2, revocable: true}], audit: {intact: true, count: 4}}, (name, payload) => calls.push({name, payload}));
    assert.match(sheet.children[0].textContent, /审计链完整 · 4 条/);
    assert.equal(sheet.children[1].textContent, '只读');
    assert.equal(sheet.children[1].children.length, 0);
    sheet.children[2].children[0].onclick();
    assert.deepEqual(calls, [{name: 'assistantPermissions.revoke', payload: {id: 'rule-1', kind: 'rule', revision: 2}}]);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup records tool use and the existing preload channel carries the action', () => {
  const main = readSource(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readSource(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /permissionAudit=createPermissionAuditProduct/);
  assert.match(main, /permissionAudit\.observeTools\(conversationTools\)/);
  assert.match(main, /assistantPermissions\.revoke/);
  assert.match(main, /assistantPermissions:/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
