import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGitHubConfig, normalizeRepositories} from '../electron/github-config.js';
import {createConversationEnvironmentContext} from '../electron/conversation-environment-context.js';

const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8').reverse(),
  decryptString: buffer => Buffer.from(buffer).reverse().toString('utf8'),
};

test('normalizeRepositories validates wildcards and explicit owner/repo lists', () => {
  assert.deepEqual(normalizeRepositories(undefined), ['*']);
  assert.deepEqual(normalizeRepositories(''), ['*']);
  assert.deepEqual(normalizeRepositories('acme/app, octo/lib\nacme/app'), ['acme/app', 'octo/lib']);
  assert.deepEqual(normalizeRepositories('acme/app, *'), ['*']);
  assert.throws(() => normalizeRepositories('not-a-repo'), /仓库格式无效/);
  assert.throws(() => normalizeRepositories('../evil'), /仓库格式无效/);
});

test('createGitHubConfig encrypts PAT, reloads cleanly, detects gh CLI without leaking secrets, and revokes', async t => {
  const userData = mkdtempSync(path.join(tmpdir(), 'pa-gh-config-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));

  const token = 'ghp_123456789012345678901234567890abcd';
  const rotated = [];
  const question = {
    readResourceGeneration: id => (rotated.filter(x => x.id === id).length),
    rotateResourceGeneration: (id, prev) => rotated.push({id, prev}),
  };

  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify({login: 'octocat'}), {status: 200});
  };

  const config = createGitHubConfig({
    userData,
    safeStorage: mockSafeStorage,
    question,
    fetchImpl,
    execFileImpl: async (_cmd, args) => {
      assert.deepEqual(args, ['auth', 'token', '--hostname', 'github.com']);
      return {stdout: `${token}\n`, stderr: ''};
    },
  });

  assert.equal(config.snapshot().configured, false);
  assert.equal(config.snapshot().status, 'unconfigured');

  // Detect-only never returns token or writes config file.
  const probed = await config.detectLocalGh({importToken: false});
  assert.equal(probed.authenticated, true);
  assert.equal(probed.login, 'octocat');
  assert.ok(!JSON.stringify(probed).includes(token));
  assert.equal(existsSync(path.join(userData, 'github-config.json')), false);

  // Import token persists encrypted JSON and populates safe snapshot.
  const imported = await config.detectLocalGh({importToken: true, repositories: 'acme/app'});
  assert.equal(imported.snapshot.configured, true);
  assert.equal(imported.snapshot.authMode, 'gh_cli');
  assert.equal(imported.snapshot.login, 'octocat');
  assert.deepEqual(imported.snapshot.repositories, ['acme/app']);
  assert.ok(!JSON.stringify(imported).includes(token));
  const disk = readFileSync(path.join(userData, 'github-config.json'), 'utf8');
  assert.ok(!disk.includes(token));

  // Reload from encrypted file.
  const reloaded = createGitHubConfig({userData, safeStorage: mockSafeStorage, question, fetchImpl});
  assert.equal(reloaded.snapshot().configured, true);
  assert.equal(reloaded.snapshot().login, 'octocat');
  assert.deepEqual(reloaded.snapshot().repositories, ['acme/app']);
  const binding = reloaded.binding();
  assert.equal(reloaded.readToken(binding), token);

  // Updating repositories without passing a new token preserves the stored token.
  const updated = await reloaded.configure({repositories: '*'}, {verify: false});
  assert.deepEqual(updated.repositories, ['*']);
  assert.equal(updated.login, 'octocat');

  // Revoke deletes file and rotates resource generation.
  const afterRevoke = reloaded.revoke();
  assert.equal(afterRevoke.configured, false);
  assert.equal(reloaded.binding(), undefined);
  assert.equal(existsSync(path.join(userData, 'github-config.json')), false);
  assert.ok(rotated.length >= 1);
});

test('createGitHubConfig rejects invalid PAT with 401 before saving', async t => {
  const userData = mkdtempSync(path.join(tmpdir(), 'pa-gh-401-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));
  const config = createGitHubConfig({
    userData,
    safeStorage: mockSafeStorage,
    fetchImpl: async () => new Response('Bad credentials', {status: 401}),
  });
  await assert.rejects(() => config.configure({token: 'ghp_invalid12345678901234567890'}), /Token 无效/);
  assert.equal(config.snapshot().configured, false);
});

test('createConversationEnvironmentContext reports github guidance when registered', () => {
  const unconfigured = JSON.parse(createConversationEnvironmentContext({
    now: () => new Date('2026-11-24T12:00:00Z'),
    readTimeZone: () => 'Asia/Shanghai',
    readGitHubState: () => ({registered: true, configured: false}),
  })());
  assert.equal(unconfigured.capabilityGuidance.length, 1);
  assert.equal(unconfigured.capabilityGuidance[0].capability, 'github');
  assert.equal(unconfigured.capabilityGuidance[0].state, 'configuration_required');

  const configured = JSON.parse(createConversationEnvironmentContext({
    now: () => new Date('2026-11-24T12:00:00Z'),
    readTimeZone: () => 'Asia/Shanghai',
    readGitHubState: () => ({registered: true, configured: true}),
  })());
  assert.equal(configured.capabilityGuidance[0].state, 'check_task_catalog');
  assert.match(configured.capabilityGuidance[0].guidance, /subagent\.dispatch/);
  assert.match(configured.capabilityGuidance[0].guidance, /capability\.search/);
});
