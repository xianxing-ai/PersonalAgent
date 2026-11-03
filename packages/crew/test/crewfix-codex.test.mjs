// F6：Codex 协议/对端错误不再把完整 JSON（含令牌原文）带进错误与回执。
// 全部使用假值（FAKE-*）与协议级假子进程，不接触真实凭据。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  CREW_PARENT_AGENT_ID,
  openCrewDriverRuntime,
  openCrewKernel,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});

function open(options) {
  let clock = 1700000000000;
  const path = join(mkdtempSync(join(root, 'crewfix-codex-')), 'crew.sqlite');
  const runtime = openCrewDriverRuntime(path, {...options, now: options?.now ?? (() => (clock += 1000))});
  const kernel = openCrewKernel(path, {now: () => 1700000000000});
  return {runtime, kernel};
}

function setup(runtime) {
  runtime.registerAgent({
    agentId: 'coder-x',
    displayName: '编码者',
    driver: 'codex',
    instructions: '在自有 worktree 内完成编码任务。',
    workspacePath: '/workspace/crew/coder-x',
  });
  runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '本人本机登录的官方 Codex CLI'});
}

const dispatch = runtime => runtime.dispatchTask({
  actorId: CREW_PARENT_AGENT_ID,
  taskId: 't1',
  rootRequestId: 'root-1',
  assignedAgentId: 'coder-x',
  goal: '修复 crew 包的类型错误',
});

/** 极简假 app-server：脚本化应答，可注入对端"泄漏"字段。 */
function scriptedSpawn(script) {
  const servers = [];
  const spawn = (command, args) => {
    if (args.includes('--version')) {
      const stdout = new PassThrough();
      stdout.end('codex-cli 0.0.0-fake');
      return {stdin: new PassThrough(), stdout, stderr: new PassThrough(), kill: () => true, exited: Promise.resolve({exitCode: 0, signal: null})};
    }
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const server = {stdin, stdout, servers, script, buffer: ''};
    servers.push(server);
    stdin.setEncoding('utf8');
    stdin.on('data', chunk => {
      server.buffer += chunk;
      let i;
      while ((i = server.buffer.indexOf('\n')) >= 0) {
        const line = server.buffer.slice(0, i).trim();
        server.buffer = server.buffer.slice(i + 1);
        if (line) handle(server, JSON.parse(line));
      }
    });
    stdin.on('error', () => undefined);
    const exited = new Promise(resolve => {
      const settle = () => resolve({exitCode: 0, signal: null});
      stdin.once('close', settle);
      stdout.once('close', settle);
    });
    return {stdin, stdout, stderr: new PassThrough(), kill: () => { stdin.destroy(); stdout.destroy(); }, exited};
  };
  return {spawn, servers};
}

function handle(server, message) {
  const reply = (result, error) => server.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id: message.id, ...(error ? {error} : {result})})}\n`);
  const notify = (method, params) => server.stdout.write(`${JSON.stringify({jsonrpc: '2.0', method, params})}\n`);
  switch (message.method) {
    case 'initialize': reply({ok: true}); return;
    case 'loginStatus': reply({requiresLogin: false}); return;
    case 'newConversation': scriptReply(server, 'newConversation', reply, notify); return;
    case 'sendUserMessage': {
      reply({ok: true});
      scriptReply(server, 'afterSend', reply, notify);
      return;
    }
    default: reply({ok: true}); return;
  }
}

function scriptReply(server, phase, reply, notify) {
  const events = server.script[phase] ?? [];
  for (const event of events) {
    if (event.reply) reply(event.reply.result, event.reply.error);
    if (event.notify) notify(event.notify.method, event.notify.params);
  }
}

test('F6: a newConversation response carrying tokens never leaks them into the blocked receipt', async () => {
  const {spawn} = scriptedSpawn({
    newConversation: [{reply: {result: {session: {accessToken: 'FAKE-ACCESS-TOKEN-xyz', accountId: 'acct-1'}}}}],
  });
  const {runtime} = open({codexSpawn: spawn});
  try {
    setup(runtime);
    dispatch(runtime);
    const task = await runtime.runNextTask('coder-x');
    assert.equal(task.status, 'blocked', 'the protocol error still blocks the task');
    const text = JSON.stringify(task.receipt);
    assert.ok(!text.includes('FAKE-ACCESS-TOKEN-xyz'), 'no token原文 in the receipt');
    assert.ok(text.includes('conversationId'), 'the error keeps the field-name diagnostics');
  } finally { runtime.close(); }
});

test('F6: an error notification with an authorization header never leaks into the failed receipt', async () => {
  const {spawn} = scriptedSpawn({
    newConversation: [{reply: {result: {conversationId: 'c1'}}}],
    afterSend: [{notify: {method: 'error', params: {conversationId: 'c1', authorization: 'Bearer FAKE-BEARER-777', retry: {accessToken: 'FAKE-REFRESH-555'}}}}],
  });
  const {runtime, kernel} = open({codexSpawn: spawn});
  try {
    setup(runtime);
    dispatch(runtime);
    const task = await runtime.runNextTask('coder-x');
    assert.equal(task.status, 'failed');
    const text = JSON.stringify(task.receipt);
    assert.ok(!text.includes('FAKE-BEARER-777'), 'no bearer token原文 in the receipt');
    assert.ok(text.includes('error'), 'the method name survives in the diagnostics');
    // SQLite 里的回执（经 kernel 读回同一行）同样不带原文。
    const stored = kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.ok(!JSON.stringify(stored.receipt).includes('FAKE-BEARER-777'));
  } finally { runtime.close(); }
});
