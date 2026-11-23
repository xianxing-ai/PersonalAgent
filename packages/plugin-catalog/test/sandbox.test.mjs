import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createPluginSandbox, pathStaysInside, pluginInstallSummary} from '../dist/index.js';

const grant = {
  networkHosts: ['docs.example.com'],
  filePaths: ['notes'],
  connectors: ['calendar.read'],
  secrets: ['plugin.notes.token'],
};

function workspace(t) {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-tests'), 'sandbox-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}

function sandbox(t, lookup, extras = {}) {
  const root = workspace(t);
  const calls = [];
  const created = createPluginSandbox({
    dataRoot: path.join(root, 'data'),
    violationFile: path.join(root, 'violations.json'),
    lookup,
    readSecret(name) {
      calls.push(name);
      return name === 'plugin.notes.token' ? 'super-secret-value' : undefined;
    },
    ...extras,
  });
  return {root, calls, sandbox: created};
}

test('windows and posix path checks reject parent and other-drive targets', () => {
  assert.equal(pathStaysInside('C:\\data\\plugin', 'C:\\data\\plugin\\notes\\a.txt', path.win32), true);
  assert.equal(pathStaysInside('C:\\data\\plugin', 'C:\\data\\secret', path.win32), false);
  assert.equal(pathStaysInside('C:\\data\\plugin', 'D:\\data\\plugin\\notes', path.win32), false);
  assert.equal(pathStaysInside('/tmp/plugin', '/tmp/secret', path.posix), false);
  assert.equal(pathStaysInside('C:\\data\\plugin', '\\\\server\\share\\notes', path.win32), false);
  assert.equal(pathStaysInside('/tmp/plugin', '/tmp/plugin/notes/a.txt', path.posix), true);
  const summary = pluginInstallSummary('安装', 'Notes', grant);
  assert.ok(summary.length <= 512);
  assert.match(summary, /网络只允许docs\.example\.com/);
  assert.match(summary, /不执行脚本/);
  assert.match(summary, /密钥只允许plugin\.notes\.token/);
});

test('enabled plugin is limited to its grant and violations omit secret values', async t => {
  const state = {state: 'enabled', grant};
  const fetches = [];
  const host = sandbox(t, () => state, {fetchImpl: async url => { fetches.push(url); return {status: 200}; }});
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'network', 'https://docs.example.com/a').allowed, true);
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'network', 'https://evil.example/a').allowed, false);
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'network', 'http://docs.example.com/a').allowed, false);
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'network', 'https://user:pass@docs.example.com/a').allowed, false);
  assert.equal(fetches.length, 0);
  assert.equal((await host.sandbox.fetch('skill.fixture.notes', 'https://docs.example.com/a')).status, 200);
  assert.deepEqual(fetches, ['https://docs.example.com/a']);
  assert.equal((await host.sandbox.fetch('skill.fixture.notes', 'https://evil.example/a')).allowed, false);
  assert.equal(fetches.length, 1);
  const redirect = sandbox(t, () => state, {fetchImpl: async () => ({status: 302})});
  assert.equal((await redirect.sandbox.fetch('skill.fixture.notes', 'https://docs.example.com/go')).allowed, false);

  assert.equal(host.sandbox.writeFile('skill.fixture.notes', 'notes/a.txt', 'hello').allowed, true);
  assert.equal(readFileSync(path.join(host.root, 'data', 'skill.fixture.notes', 'notes', 'a.txt'), 'utf8'), 'hello');
  assert.equal(host.sandbox.writeFile('skill.fixture.notes', 'other/a.txt', 'no').allowed, false);
  assert.equal(host.sandbox.writeFile('skill.fixture.notes', 'notes/../../outside.txt', 'no').allowed, false);
  assert.equal(host.sandbox.writeFile('skill.fixture.notes', 'C:/notes/a.txt', 'no').allowed, false);
  assert.equal(host.sandbox.readFile('skill.fixture.notes', 'notes/a.txt').text, 'hello');
  assert.equal(existsSyncSafe(path.join(host.root, 'outside.txt')), false);

  assert.equal(host.sandbox.decide('skill.fixture.notes', 'connector', 'calendar.read').allowed, true);
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'connector', 'mail.send').allowed, false);
  assert.equal(host.calls.length, 0);
  assert.equal(host.sandbox.readSecret('skill.fixture.notes', 'other.token').allowed, false);
  assert.deepEqual(host.calls, []);
  assert.equal(host.sandbox.readSecret('skill.fixture.notes', 'plugin.notes.token').value, 'super-secret-value');
  assert.deepEqual(host.calls, ['plugin.notes.token']);

  const log = readFileSync(path.join(host.root, 'violations.json'), 'utf8');
  assert.equal(log.includes('super-secret-value'), false);
  assert.equal(log.includes('https://user:pass@'), false);
  assert.match(log, /evil\.example/);
  assert.equal(host.sandbox.lastViolation().reason.length > 0, true);

  state.state = 'disabled';
  assert.equal(host.sandbox.readFile('skill.fixture.notes', 'notes/a.txt').reason, 'not-enabled');
  state.state = 'missing';
  assert.equal(host.sandbox.decide('skill.fixture.notes', 'network', 'https://docs.example.com/a').reason, 'not-installed');
});

function existsSyncSafe(file) {
  try { return readFileSync(file); } catch { return false; }
}

test('a symlink inside the grant cannot read outside the plugin directory', t => {
  const host = sandbox(t, () => ({state: 'enabled', grant}));
  const outside = path.join(host.root, 'secret.txt');
  writeFileSync(outside, 'outside-secret');
  assert.equal(host.sandbox.writeFile('skill.fixture.notes', 'notes/a.txt', 'inside').allowed, true);
  const link = path.join(host.root, 'data', 'skill.fixture.notes', 'notes', 'link.txt');
  try { symlinkSync(outside, link); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') return;
    throw error;
  }
  const read = host.sandbox.readFile('skill.fixture.notes', 'notes/link.txt');
  assert.equal(read.allowed, false);
  assert.equal(read.text, undefined);
  assert.equal(readFileSync(outside, 'utf8'), 'outside-secret');
});
