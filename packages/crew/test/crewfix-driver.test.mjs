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
