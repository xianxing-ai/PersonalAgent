import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPermissionAuditProduct} from '../electron/permission-audit-product.js';
import {renderPermissionSheet} from '../src/features/workspace/permission-sheet.js';
import {mountWorkspaceRuntimeControls} from '../src/features/workspace/runtime-controls.js';

test('the product lists grants, avoids writing on status read, atomically writes revocations/tool calls, and logs failures/denials/timeouts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-audit-'));
  const rules = [{id: 'rule-1', kind: 'rule', label: '允许读取天气', revision: 3, revocable: true}];
  const revoked = [];
  let updates = 0;
  const product = createPermissionAuditProduct({
    userData: dir,
    onUpdate: () => { updates += 1; },
    list: () => [{id: 'sandbox', kind: 'sandbox', label: '只读', revocable: false}, ...rules],
    revoke: grant => { revoked.push(grant.id); rules.splice(0, rules.length); return {revoked: grant.id}; },
  });
  const [readTool, deniedTool, timeoutTool, failedTool] = product.observeTools([
    {descriptor: {name: 'mail.inbox', sideEffect: 'read'}, execute: async () => ({ok: true})},
    {descriptor: {name: 'mail.send', sideEffect: 'external_write'}, execute: async () => { const err = Error('denied'); err.code = 'UNAUTHORIZED'; throw err; }},
    {descriptor: {name: 'web.fetch', sideEffect: 'read'}, execute: async () => { const err = Error('timeout'); err.code = 'TIMEOUT'; throw err; }},
    {descriptor: {name: 'note.write', sideEffect: 'local_write'}, execute: async () => ({state: 'failed'})},
  ]);

  assert.deepEqual(await readTool.execute({}, {taskId: 't1'}), {ok: true});
  await assert.rejects(() => deniedTool.execute({}, {taskId: 't2'}), /denied/);
  await assert.rejects(() => timeoutTool.execute({}, {taskId: 't3'}), /timeout/);
  assert.deepEqual(await failedTool.execute({}, {taskId: 't4'}), {state: 'failed'});

  const auditPath = path.join(dir, 'permission-audit.json');
  const beforeStat = statSync(auditPath);
  const beforeRaw = readFileSync(auditPath, 'utf8');
  const state = product.handleAction('assistantPermissions.state', undefined);
  assert.equal(state.grants[1].label, '允许读取天气');
  assert.equal(state.audit.intact, true);
  assert.equal(state.audit.count, 4);
  assert.equal(readFileSync(auditPath, 'utf8'), beforeRaw);
  assert.equal(statSync(auditPath).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(readdirSync(dir), ['permission-audit.json']);

  const storedBeforeRevoke = JSON.parse(readFileSync(auditPath, 'utf8'));
  assert.deepEqual(storedBeforeRevoke.map(item => item.subject), [
    'mail.inbox:read:ok',
    'mail.send:external_write:denied',
    'web.fetch:read:timeout',
    'note.write:local_write:failed',
  ]);

  const after = product.handleAction('assistantPermissions.revoke', {id: 'rule-1', kind: 'rule', revision: 3});
  assert.deepEqual(revoked, ['rule-1']);
  assert.equal(after.grants.some(grant => grant.id === 'rule-1'), false);
  assert.equal(after.recorded, true);
  assert.equal(after.audit.count, 5);

  const stored = JSON.parse(readFileSync(auditPath, 'utf8'));
  stored[0].subject = 'tampered';
  writeFileSync(auditPath, JSON.stringify(stored));
  const reloaded = createPermissionAuditProduct({userData: dir, onUpdate: () => { updates += 1; }, list: () => [], revoke: () => {}});
  assert.equal(reloaded.snapshot().audit.intact, false);
  assert.equal(reloaded.snapshot().audit.brokenAt, 1);
  assert.equal(reloaded.snapshot().audit.recordingStopped, true);

  const [postCorruptTool] = reloaded.observeTools([{descriptor: {name: 'mail.inbox', sideEffect: 'read'}, execute: async () => ({ok: true})}]);
  await postCorruptTool.execute({}, {taskId: 't5'});
  assert.equal(reloaded.snapshot().audit.skippedCount, 1);
  assert.match(reloaded.snapshot().audit.warning, /已停止追加新记录/);
  assert.ok(updates >= 1);
});

test('permission sheet warns on broken audit chain, includes settings entry, and supports revoke', async () => {
  const original = globalThis.document;
  globalThis.document = {createElement() {
    const node = {textContent: '', type: '', children: [], dataset: {}, hidden: false, attrs: {}};
    node.append = (...children) => node.children.push(...children);
    node.replaceChildren = (...children) => { node.children = [...children]; };
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    return node;
  }};
  try {
    const sheet = {dataset: {}, children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = [...children]; }};
    const calls = [];
    renderPermissionSheet(sheet, {
      grants: [{id: 'sandbox', kind: 'sandbox', label: '只读', revocable: false}, {id: 'rule-1', kind: 'rule', label: '天气', revision: 2, revocable: true}],
      audit: {intact: true, count: 4},
    }, async (name, payload) => { calls.push({name, payload}); });
    assert.match(sheet.children[0].textContent, /审计链完整 · 4 条/);
    assert.equal(sheet.children[1].textContent, '打开权限设置');
    sheet.children[1].onclick();
    await Promise.resolve();
    assert.deepEqual(calls[0], {name: 'admin.open', payload: {page: 'authorizations'}});
    assert.equal(sheet.children[2].textContent, '只读');
    assert.equal(sheet.children[2].children.length, 0);
    sheet.children[3].children[0].onclick();
    await Promise.resolve();
    assert.deepEqual(calls[1], {name: 'assistantPermissions.revoke', payload: {id: 'rule-1', kind: 'rule', revision: 2}});

    renderPermissionSheet(sheet, {
      grants: [],
      audit: {intact: false, brokenAt: 2, recordingStopped: true, warning: '审计链在第 2 条损坏，已停止追加新记录（1 条未写入）'},
    }, async () => {});
    assert.equal(sheet.children[0].attrs.role, 'alert');
    assert.match(sheet.children[0].textContent, /警告：审计链在第 2 条损坏/);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('runtime controls keep .cc-access opening authorization settings, add separate .cc-permission-overview button, and surface broken-audit alert', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  function makeNode(tag = 'div') {
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      hidden: false,
      disabled: false,
      textContent: '',
      attrs: {},
      dataset: {},
      children: [],
      append(...children) { this.children.push(...children); },
      after(el) { this._after = el; },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute(k, v) { this.attrs[k] = v; },
      querySelector(sel) {
        if (sel === '.cc-access') return node._access;
        if (sel === '.cc-permission-overview') return node._overview;
        if (sel === '.cc-approval') return node._approval;
        if (sel === '.cc-live') return node._live;
        if (sel === '.cc-live-settings') return node._liveSettings;
        if (sel === '[data-access-mode]') return node._accessMode;
        if (sel === 'span') return node._span;
        return null;
      },
      querySelectorAll() { return []; },
    };
    return node;
  }
  const actionsNode = makeNode('div');
  const root = {
    querySelector(sel) { return sel === '.workspace-composer-actions' ? actionsNode : null; },
    querySelectorAll() { return []; },
  };
  globalThis.window = {addEventListener() {}};
  globalThis.document = {
    createElement(tag) {
      const node = makeNode(tag);
      let html = '';
      Object.defineProperty(node, 'innerHTML', {
        get() { return html; },
        set(val) {
          html = val;
          if (val.includes('cc-access')) {
            node._access = makeNode('button');
            node._accessMode = makeNode('span');
            node._overview = makeNode('button');
            node._approval = makeNode('button');
            node._live = makeNode('button');
            node._live._span = makeNode('span');
            node._liveSettings = makeNode('button');
          }
        },
      });
      return node;
    },
  };
  try {
    const calls = [];
    const mounted = mountWorkspaceRuntimeControls(root, async (name, payload) => { calls.push({name, payload}); }, () => {});
    const controls = actionsNode._after;
    assert.ok(controls._access);
    assert.ok(controls._overview);
    controls._access.onclick();
    await Promise.resolve();
    assert.deepEqual(calls, [{name: 'admin.open', payload: {page: 'authorizations'}}]);

    mounted.update({
      authorizationSandbox: {mode: 'read-only', label: '只读'},
      assistantPermissions: {
        grants: [],
        audit: {intact: false, brokenAt: 1, recordingStopped: true, warning: '审计链在第 1 条损坏，已停止追加新记录'},
      },
      approvals: [],
      authorizationQuestions: [],
    });
    assert.match(controls._overview.textContent, /审计异常/);
    assert.equal(controls.children[0].hidden, false);
    assert.match(controls.children[0].textContent, /警告：审计链在第 1 条损坏/);
    assert.equal(controls.children[1].hidden, true);
    controls._overview.onclick();
    assert.equal(controls.children[1].hidden, false);
  } finally {
    if (originalDocument) globalThis.document = originalDocument;
    else delete globalThis.document;
    if (originalWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
  }
});

test('startup records tool failures/denials and exposes permission audit actions through existing preload', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /permissionAudit=createPermissionAuditProduct/);
  assert.match(main, /permissionAudit\.observeTools\(conversationTools\)/);
  assert.match(main, /permissionAudit\?\.recordEvent/);
  assert.match(main, /if \(name === 'assistantPermissions\.revoke'\) publish\(\)/);
  assert.match(main, /assistantPermissions:/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
