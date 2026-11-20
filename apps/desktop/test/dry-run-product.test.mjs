import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Client} from '@personal-agent/client';
import {CalDavProvider, register as registerCalendar} from '@personal-agent/calendar';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDryRunProduct, isHighRiskTool, previewToolCall, verifyToolResult} from '../electron/dry-run-product.js';
import {renderDryRun} from '../src/features/workspace/dry-run-status.js';

function tool(name, sideEffect, execute) {
  return {descriptor: {name, sideEffect}, execute};
}
const context = () => ({taskId: 'task-1', deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal});

test('a high-risk send waits for the preview, distinguishes target/content while redacting secrets, and verifies the tool result', async () => {
  assert.equal(isHighRiskTool({name: 'workspace.custom_action', sideEffect: 'local_write'}), true);
  assert.equal(isHighRiskTool({name: 'mail.compose_draft', sideEffect: 'external_write'}), true);
  assert.equal(isHighRiskTool({name: 'mail.reconcile_send', sideEffect: 'external_write'}), false);
  assert.equal(isHighRiskTool({name: 'mail.inbox', sideEffect: 'read'}), false);

  const previewA = previewToolCall({name: 'mail.send', sideEffect: 'external_write'}, {to: 'alice@example.com', body: '上午十点评审'});
  const previewB = previewToolCall({name: 'mail.send', sideEffect: 'external_write'}, {to: 'bob@example.com', body: '下午三点同步'});
  assert.notEqual(previewA.summary, previewB.summary);
  assert.notEqual(previewA.argumentsDigest, previewB.argumentsDigest);
  assert.match(previewA.summary, /收件人：alice@example\.com/);
  assert.match(previewA.summary, /内容：上午十点评审/);
  assert.match(previewB.summary, /收件人：bob@example\.com/);
  assert.match(previewB.summary, /内容：下午三点同步/);

  const calls = [];
  const product = createDryRunProduct();
  const [send, read] = product.wrapTools([
    tool('mail.send', 'external_write', async () => { calls.push('send'); return {id: 'sent-1', to: 'person'}; }),
    tool('mail.inbox', 'read', async () => { calls.push('read'); return {id: 'm1'}; }),
  ]);
  assert.deepEqual(await read.execute({}, context()), {id: 'm1'});
  const running = send.execute({to: 'person', apiKey: 'sk-secret1234567890'}, context());
  const preview = product.snapshot().pending[0];
  assert.match(preview.summary, /发送操作/);
  assert.doesNotMatch(preview.summary, /mail\.send/);
  assert.equal(preview.argumentKeys.includes('to'), true);
  assert.match(preview.summary, /收件人：person/);
  assert.doesNotMatch(JSON.stringify(preview), /sk-secret1234567890/);
  assert.deepEqual(calls, ['read']);
  product.handleAction('dryRun.confirm', {id: preview.id});
  assert.deepEqual(await running, {id: 'sent-1', to: 'person'});
  assert.deepEqual(calls, ['read', 'send']);
  assert.equal(product.snapshot().recent.at(-1).verified, true);
  assert.match(product.snapshot().recent.at(-1).reason, /已按工具返回字段核对目标与试运行预览一致；未做外部系统读回/);
});

test('verifyToolResult distinguishes unverified return-only results from matched and mismatched target fields, and confirmed parameters are bound', async () => {
  const preview = previewToolCall({name: 'mail.send', sideEffect: 'external_write'}, {to: 'alice@example.com', subject: '周报'});
  const unverified = verifyToolResult({id: 'unrelated-result'});
  assert.equal(unverified.ok, true);
  assert.equal(unverified.verified, false);
  assert.equal(unverified.scope, 'tool_return_only');
  assert.doesNotMatch(unverified.reason, /已核对工具返回与预览的操作一致/);
  assert.match(unverified.reason, /仅收到工具返回，未验证目标与预览一致/);

  const missingTarget = verifyToolResult({id: 'unrelated-result'}, preview);
  assert.equal(missingTarget.ok, true);
  assert.equal(missingTarget.verified, false);
  assert.equal(missingTarget.targetMatched, false);
  assert.equal(missingTarget.scope, 'tool_return_only');

  const toolNameOnly = verifyToolResult({toolName: 'mail.send'}, preview);
  assert.equal(toolNameOnly.ok, true);
  assert.equal(toolNameOnly.verified, false);
  assert.equal(toolNameOnly.targetMatched, false);
  assert.equal(toolNameOnly.identityMatched, true);
  assert.equal(toolNameOnly.scope, 'operation_identity_only');
  assert.match(toolNameOnly.reason, /未验证实际目标与预览一致/);

  const previewIdOnly = verifyToolResult({previewId: preview.id}, preview);
  assert.equal(previewIdOnly.ok, true);
  assert.equal(previewIdOnly.verified, false);
  assert.equal(previewIdOnly.targetMatched, false);
  assert.equal(previewIdOnly.identityMatched, true);
  assert.equal(previewIdOnly.scope, 'operation_identity_only');
  assert.match(previewIdOnly.reason, /未验证实际目标与预览一致/);

  const mismatchedTarget = verifyToolResult({id: 'sent-2', to: 'mallory@example.com'}, preview);
  assert.equal(mismatchedTarget.ok, false);
  assert.equal(mismatchedTarget.verified, false);
  assert.match(mismatchedTarget.reason, /不一致/);

  const matchedTarget = verifyToolResult({id: 'sent-1', to: 'alice@example.com'}, preview);
  assert.equal(matchedTarget.ok, true);
  assert.equal(matchedTarget.verified, true);
  assert.equal(matchedTarget.targetMatched, true);
  assert.equal(matchedTarget.scope, 'tool_result_matched');

  const product = createDryRunProduct();
  let executed = 0;
  const [send] = product.wrapTools([
    tool('mail.send', 'external_write', async () => { executed += 1; return {id: 'sent-1'}; }),
  ]);
  const authGate = product.beforeAuthorize({
    taskId: 'task-bind',
    runId: 'run-bind',
    toolName: 'mail.send',
    sideEffect: 'external_write',
    arguments: {to: 'alice@example.com', body: '原内容'},
    deadline: new Date(Date.now() + 5_000).toISOString(),
  });
  const pendingId = product.snapshot().pending[0].id;
  product.handleAction('dryRun.confirm', {id: pendingId});
  await authGate;

  assert.throws(
    () => product.assertAuthorized({
      taskId: 'task-bind',
      runId: 'run-bind',
      toolName: 'mail.send',
      sideEffect: 'external_write',
      arguments: {to: 'bob@example.com', body: '篡改内容'},
    }),
    /不一致/,
  );

  await assert.rejects(
    send.execute({to: 'bob@example.com', body: '篡改内容'}, {...context(), taskId: 'task-bind', runId: 'run-bind'}),
    /不一致/,
  );
  assert.equal(executed, 0);
});

test('a failed, pending or unknown verification never passes and does not retry the side effect', async () => {
  assert.equal(verifyToolResult({state: 'pending'}).ok, false);
  assert.equal(verifyToolResult({state: 'unknown'}).ok, false);
  assert.equal(verifyToolResult({status: 'pending'}).ok, false);
  assert.equal(verifyToolResult({status: 'unknown'}).ok, false);

  let count = 0;
  const product = createDryRunProduct();
  const [pay] = product.wrapTools([tool('wallet.pay', 'external_write', async () => { count += 1; return {state: 'unknown'}; })]);
  const running = pay.execute({}, context());
  product.handleAction('dryRun.confirm', {id: product.snapshot().pending[0].id});
  await assert.rejects(running, /操作可能已经发生/);
  assert.equal(count, 1);
});

test('cancellation before confirmation does not run the tool', async () => {
  const controller = new AbortController();
  let count = 0;
  const product = createDryRunProduct();
  const [remove] = product.wrapTools([tool('files.delete', 'external_write', async () => { count += 1; return {removed: true}; })]);
  const running = remove.execute({}, {...context(), signal: controller.signal});
  controller.abort();
  await assert.rejects(running, /未执行/);
  assert.equal(count, 0);
  assert.equal(product.snapshot().pending.length, 0);
});

test('the workspace line confirms or cancels the pending preview without showing English tool names', () => {
  const created = [];
  const original = globalThis.document;
  globalThis.document = {createElement(tag) {
    const node = {tag, textContent: '', type: '', hidden: false, children: [], dataset: {}};
    node.append = (...children) => node.children.push(...children);
    node.replaceChildren = () => { node.children = []; };
    created.push(node);
    return node;
  }};
  try {
    const node = document.createElement('div');
    const calls = [];
    renderDryRun(node, {pending: [{id: 'preview-1', summary: '将执行发送操作（包含 1 项参数）。尚未产生实际写入或外部副作用。'}], recent: []}, (name, payload) => calls.push({name, payload}));
    assert.equal(node.hidden, false);
    assert.equal(node.children[1].textContent, '按预览执行');
    assert.equal(node.children[2].textContent, '取消预览');
    node.children[1].onclick();
    node.children[2].onclick();
    assert.deepEqual(calls, [
      {name: 'dryRun.confirm', payload: {id: 'preview-1'}},
      {name: 'dryRun.cancel', payload: {id: 'preview-1'}},
    ]);
    renderDryRun(node, {pending: [], recent: [{toolName: 'mail.send', label: '发送操作', reason: '已核对'}]}, () => {});
    assert.doesNotMatch(node.children[0].textContent, /mail\.send/);
    assert.match(node.children[0].textContent, /发送操作/);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup wraps tools and preload still carries desktop actions', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /dryRun=createDryRunProduct/);
  assert.match(main, /beforeToolAuthorize:\s*(?:async\s*)?(?:\(\s*input\s*\)|input)\s*=>\s*(?:\{[^}]*dryRun\?\.beforeAuthorize\(input\)|[^\n;]*dryRun\?\.beforeAuthorize\(input\))/);
  assert.match(main, /assertToolPrechecked:\s*(?:async\s*)?(?:\(\s*input\s*\)|input)\s*=>\s*(?:\{[^}]*dryRun\?\.assertAuthorized\(input\)|[^\n;]*dryRun\?\.assertAuthorized\(input\))/);
  assert.match(main, /dryRun\.wrapTools\(conversationTools\)/);
  assert.match(main, /name === 'dryRun\.confirm' \|\| name === 'dryRun\.cancel'/);
  assert.match(main, /dryRun:dryRun\?\.snapshot\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});

test('cancelling preview stops before RuntimeApplication requests Policy authorization', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pa-dryrun-'));
  t.after(() => rm(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  let authCalls = 0;
  let executions = 0;
  const dryRun = createDryRunProduct();
  const writeTool = {
    descriptor: {
      name: 'notepad.save_note', version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false, properties: {text: {type: 'string'}}},
      outputSchema: {type: 'object', additionalProperties: false, properties: {saved: {type: 'boolean'}}},
      sideEffect: 'local_write', requiredScopes: ['notepad:write'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
    },
    execute: async () => { executions += 1; return {saved: true}; },
  };
  const app = createRuntimeApplication({
    path: path.join(dir, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    tools: dryRun.wrapTools([writeTool]),
    beforeToolAuthorize: input => dryRun.beforeAuthorize(input),
    assertToolPrechecked: input => dryRun.assertAuthorized(input),
    requestToolAuthorization: async () => { authCalls += 1; return 'allow_once'; },
    requiresToolAuthorization: () => true,
    competitionToolAvailability: [{toolName: 'notepad.save_note', toolVersion: '1.0.0', available: () => true}],
    competitionToolExports: [{toolName: 'notepad.save_note', toolVersion: '1.0.0', exportPolicyVersion: 'public-v1', accepts: () => true, project: ({result}) => result}],
    coordination: {
      execute: async ({executionEpoch}) => ({kind: 'tool_proposal', proposalId: 'p-1', toolName: 'notepad.save_note', toolVersion: '1.0.0', arguments: {text: 'hi'}, verification: 'unverified', executionEpoch}),
    },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const submitted = await client.call('task.submit', {goal: '保存一条笔记', conversationId: 'c-dryrun'}, {idempotencyKey: 'dry-cancel-1'});
    const started = Date.now();
    while (dryRun.snapshot().pending.length === 0 && Date.now() - started < 3000) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    const preview = dryRun.snapshot().pending[0];
    assert.ok(preview);
    dryRun.handleAction('dryRun.cancel', {id: preview.id});
    while (app.activeTaskCount > 0 && Date.now() - started < 3000) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.equal(authCalls, 0);
    assert.equal(executions, 0);
    assert.equal(app.runtime.listApprovals({taskId: submitted.taskId}).items.length, 0);
  } finally {
    app.close();
  }
});

test('calendar.update and calendar.create write receipts bind verification to item UID, event title, and validFor window without colliding with status summary', async () => {
  const updateInput = {
    externalId: 'caldav-evt-42',
    summary: '下午交互走查',
    startUtc: '2026-11-19T06:00:00.000Z',
    endUtc: '2026-11-19T07:00:00.000Z',
  };
  const preview = previewToolCall({name: 'calendar.update', sideEffect: 'external_write'}, updateInput);
  assert.equal(preview.targetFields.externalId, 'caldav-evt-42');
  assert.equal(preview.comparableFields.summary, '下午交互走查');

  const receipt = {
    item: {
      source: 'calendar',
      accountRef: 'desktop-calendar',
      externalId: 'caldav-evt-42',
      occurredAt: '2026-11-19T06:00:00.000Z',
      fetchedAt: '2026-11-19T05:00:00.000Z',
      contentRef: '[confirmed] 下午交互走查｜2026-11-19 14:00（Asia/Shanghai）→ 15:00｜组织者未知｜编号 caldav-evt-42（取消或更新时用）',
      sensitivity: 'normal',
      dedupeKey: 'calendar:default:caldav-evt-42:1',
      validFor: '2026-11-19T06:00:00.000Z/2026-11-19T07:00:00.000Z',
    },
    state: 'updated',
    summary: '日程已更新，日历中已保存新内容。',
  };
  const verified = verifyToolResult(receipt, preview);
  assert.equal(verified.ok, true);
  assert.equal(verified.verified, true);
  assert.equal(verified.targetMatched, true);
  assert.equal(verified.scope, 'tool_result_matched');

  const wrongTitle = verifyToolResult({
    ...receipt,
    item: {...receipt.item, contentRef: '[confirmed] 错误标题｜2026-11-19 14:00（Asia/Shanghai）→ 15:00｜组织者未知｜编号 caldav-evt-42（取消或更新时用）'},
  }, preview);
  assert.equal(wrongTitle.ok, false);
  assert.equal(wrongTitle.mismatchedField, 'summary');
  assert.match(wrongTitle.reason, /字段：summary/);

  const wrongUid = verifyToolResult({
    ...receipt,
    item: {...receipt.item, externalId: 'caldav-evt-99'},
  }, preview);
  assert.equal(wrongUid.ok, false);
  assert.equal(wrongUid.mismatchedField, 'externalId');
});

test('CalDAV calendar.update succeeds through dryRun and RuntimeApplication in both restricted and full-access modes with SEQUENCE 0->1 readback', async t => {
  for (const mode of ['restricted', 'full-access']) {
    const dir = await mkdtemp(path.join(os.tmpdir(), `pa-caldav-${mode}-`));
    t.after(() => rm(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
    const uid = `evt-${mode}-01`;
    let currentEtag = '"etag-v0"';
    let currentIcs = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'BEGIN:VEVENT',
      `UID:${uid}`, 'SUMMARY:初版评审', 'DTSTART:20261120T060000Z', 'DTEND:20261120T070000Z',
      'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const fetchImpl = async (_url, init = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'REPORT') {
        const escapedIcs = currentIcs.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const escapedEtag = currentEtag.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/alice/work/${uid}.ics</D:href><D:propstat><D:prop><D:getetag>${escapedEtag}</D:getetag><C:calendar-data>${escapedIcs}</C:calendar-data></D:prop></D:propstat></D:response></D:multistatus>`;
        return {ok: false, status: 207, headers: {get: () => null}, text: async () => xml};
      }
      if (method === 'GET') {
        return {ok: true, status: 200, headers: {get: name => name.toLowerCase() === 'etag' ? currentEtag : null}, text: async () => currentIcs};
      }
      if (method === 'PUT') {
        currentIcs = String(init.body ?? '');
        currentEtag = '"etag-v1"';
        return {ok: true, status: 204, headers: {get: name => name.toLowerCase() === 'etag' ? currentEtag : null}, text: async () => ''};
      }
      return {ok: false, status: 405, headers: {get: () => null}, text: async () => ''};
    };
    const provider = new CalDavProvider({
      calendarUrl: 'http://127.0.0.1:5232/alice/work/',
      authorization: 'Basic dXNlcjpwYXNz',
      allowLoopbackHttp: true,
      fetchImpl,
    });
    const rawTools = [];
    const unregister = registerCalendar({register(tool) { rawTools.push(tool); return () => {}; }}, {provider, accountRef: 'desktop-calendar'});
    t.after(() => unregister());
    const dryRun = createDryRunProduct();
    let step = 0;
    let authCalls = 0;
    const app = createRuntimeApplication({
      path: path.join(dir, 'runtime.sqlite'),
      profile: 'huawei_ict_agentarts',
      tools: dryRun.wrapTools(rawTools),
      beforeToolAuthorize: input => dryRun.beforeAuthorize(input),
      assertToolPrechecked: input => dryRun.assertAuthorized(input),
      requestToolAuthorization: async () => { authCalls += 1; return 'allow_once'; },
      requiresToolAuthorization: () => mode === 'restricted',
      competitionToolAvailability: rawTools.map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version, available: () => true})),
      competitionToolExports: rawTools.map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version, exportPolicyVersion: 'public-v1', accepts: () => true, project: ({result}) => result})),
      coordination: {
        execute: async request => {
          step += 1;
          if (!request.continuation) {
            return {
              kind: 'tool_proposal',
              proposalId: `prop-${mode}`,
              toolName: 'calendar.update',
              toolVersion: '0.1.0-alpha.1',
              arguments: {externalId: uid, summary: '终版交互走查'},
              verification: 'unverified',
            };
          }
          return {kind: 'text', text: '已更新日程为终版交互走查', verification: 'mock'};
        },
      },
    });
    try {
      const client = new Client(app);
      await client.connect();
      const submitted = await client.call('task.submit', {goal: '修改日程标题', conversationId: `c-${mode}`}, {idempotencyKey: `cal-upd-${mode}`});
      const started = Date.now();
      while (dryRun.snapshot().pending.length === 0 && Date.now() - started < 3000) {
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      const preview = dryRun.snapshot().pending[0];
      assert.ok(preview, `expected dry-run preview in ${mode}`);
      dryRun.handleAction('dryRun.confirm', {id: preview.id});
      while (app.activeTaskCount > 0 && Date.now() - started < 3000) {
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      const task = app.runtime.getTask(submitted.taskId);
      assert.equal(task.state, 'succeeded', `task in ${mode} should succeed, got ${task.state}`);
      assert.equal(authCalls, 1);
      const executions = app.runtime.readToolExecutions(submitted.taskId);
      assert.equal(executions.length, 1);
      assert.equal(executions[0].state, 'confirmed');
      assert.equal(dryRun.snapshot().recent.at(-1)?.verified, true);
      assert.equal(dryRun.snapshot().recent.at(-1)?.scope, 'tool_result_matched');
      const getCheck = await fetchImpl('http://127.0.0.1:5232/alice/work/' + uid + '.ics', {method: 'GET'});
      const text = await getCheck.text();
      assert.equal(getCheck.headers.get('etag'), '"etag-v1"');
      assert.match(text, /SUMMARY:终版交互走查/);
      assert.match(text, /SEQUENCE:1/);
    } finally {
      app.close();
    }
  }
});
