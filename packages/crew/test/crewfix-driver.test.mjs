// F2：驱动子进程环境变量白名单（参照审阅复现 r2-codex.mjs env 场景）。
// 只用假值（FAKE_*）与本机 node 子进程，不接触任何真实凭据。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNodeSpawn } from '../dist/index.js';

// 子进程回报指定环境变量是否可见（只回报名与是否存在，不打印值）。
const PROBE_SCRIPT = `
const names = process.env.PROBE_NAMES.split(',');
const seen = names.filter(n => process.env[n] !== undefined);
process.stdout.write(JSON.stringify(seen));
`;

function probeEnv(names, extraEnv) {
  const spawn = createNodeSpawn();
  const proc = spawn(process.execPath, ['-e', PROBE_SCRIPT], {
    cwd: process.cwd(),
    env: {...extraEnv, PROBE_NAMES: names.join(',')},
  });
  proc.stdout.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', chunk => { out += chunk; });
    proc.exited.then(exit => {
      if (exit.exitCode !== 0) { reject(new Error(`probe exited ${exit.exitCode}`)); return; }
      resolve(JSON.parse(out));
    }).catch(reject);
  });
}

test('F2: the codex child process cannot see host secrets from the inherited environment', async () => {
  process.env.FAKE_CREW_SECRET = 'not-a-real-secret';
  process.env.FAKE_ANTHROPIC_API_KEY = 'dummy-not-real-1234';
  process.env.FAKE_PI_NOTIFY_WEBHOOK = 'https://127.0.0.1.invalid/hook';
  try {
    const seen = await probeEnv(['FAKE_CREW_SECRET', 'FAKE_ANTHROPIC_API_KEY', 'FAKE_PI_NOTIFY_WEBHOOK', 'PATH']);
    assert.deepEqual(seen, ['PATH'], 'only whitelisted entries (PATH) reach the child');
  } finally {
    delete process.env.FAKE_CREW_SECRET;
    delete process.env.FAKE_ANTHROPIC_API_KEY;
    delete process.env.FAKE_PI_NOTIFY_WEBHOOK;
  }
});

test('F2: whitelisted login/runtime variables still reach the child, and extraEnv works', async () => {
  const seen = await probeEnv(['CODEX_HOME', 'HOME', 'SHELL', 'CODEX_EXTRA_FLAG'], {CODEX_HOME: '/home/fakeuser/.codex', CODEX_EXTRA_FLAG: 'yes'});
  assert.ok(seen.includes('HOME'), 'HOME passes the whitelist');
  assert.ok(seen.includes('CODEX_HOME'), 'CODEX_HOME passes (login-critical)');
  assert.ok(seen.includes('CODEX_EXTRA_FLAG'), 'the caller may pass extraEnv');
  const secretSeen = await probeEnv(['FAKE_API_KEY'], {FAKE_API_KEY: 'dummy'});
  assert.deepEqual(secretSeen, [], 'extraEnv keys matching the deny patterns are dropped');
});

test('F12: a child writing 4MB to stderr does not deadlock, and the sanitized tail is kept', async () => {
  const spawn = createNodeSpawn();
  // 4MB stderr（远超保留上限）：子进程必须能写完并正常退出（管道不被写满阻塞）。
  const script = `process.stderr.write('x'.repeat(4 * 1024 * 1024)); process.stderr.write('\n诊断尾部标记 END-OF-STDERR'); process.stdout.write('done');`;
  const proc = spawn(process.execPath, ['-e', script], {cwd: process.cwd()});
  proc.stdout.setEncoding('utf8');
  let out = '';
  proc.stdout.on('data', chunk => { out += chunk; });
  const exit = await Promise.race([
    proc.exited.then(async e => {
      // stderr 数据块可能在 exit 事件后才投递完，稍等再取尾部。
      await new Promise(resolve => setTimeout(resolve, 100));
      return e;
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('child deadlocked writing stderr')), 15000)),
  ]);
  assert.equal(exit.exitCode, 0, 'the child exits cleanly');
  assert.equal(out, 'done');
  assert.ok(proc.stderrTail, 'the tail accessor is provided');
  const tail = proc.stderrTail();
  assert.ok(tail.length <= 8192 + 16, 'only a bounded tail is retained');
  assert.ok(tail.endsWith('END-OF-STDERR'), 'the most recent diagnostics survive');
});
