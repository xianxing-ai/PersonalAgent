import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync, linkSync, symlinkSync} from 'node:fs';
import {join, parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {installPlugin, uninstallPlugin} from '../src/installation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const parent = fileURLToPath(new URL('../../../.cache/plugin-installation/', import.meta.url));
  mkdirSync(parent, {recursive: true});
  const vault = mkdtempSync(join(parent, 'vault-'));
  writeFileSync(join(vault, 'note.md'), 'Synthetic note untouched');
  t.after(() => rmSync(vault, {recursive: true, force: true}));
  const destination = join(vault, '.obsidian', 'plugins', 'personal-agent-knowledge');
  const install = () => installPlugin({vaultPath: vault, bundlePath: join(root, 'dist')});
  const uninstall = () => uninstallPlugin({vaultPath: vault});
  return {vault, destination, install, uninstall};
}

test('installs only into explicit Vault, never enables, preserves other plugins and refuses replacement', t => {
  const f = fixture(t), enabled = join(f.vault, '.obsidian', 'community-plugins.json');
  mkdirSync(join(f.vault, '.obsidian', 'plugins', 'other-plugin'), {recursive: true});
  writeFileSync(enabled, '["other-plugin"]');
  assert.equal(f.install().enabled, false);
  assert.ok(existsSync(join(f.destination, 'main.js')));
  assert.equal(readFileSync(enabled, 'utf8'), '["other-plugin"]');
  assert.throws(f.install, /已存在/);
  assert.equal(f.uninstall().state, 'uninstalled');
  assert.equal(existsSync(f.destination), false);
  assert.ok(existsSync(join(f.vault, '.obsidian', 'plugins', 'other-plugin')));
  assert.equal(readFileSync(join(f.vault, 'note.md'), 'utf8'), 'Synthetic note untouched');
});

test('modified files, extra files and enabled plugin refuse before removing any managed file', t => {
  const f = fixture(t); f.install();
  const main = join(f.destination, 'main.js'), original = readFileSync(main);
  writeFileSync(main, 'user change');
  assert.throws(f.uninstall, /已修改/); assert.ok(existsSync(join(f.destination, 'manifest.json')));
  writeFileSync(main, original); writeFileSync(join(f.destination, 'user.txt'), 'keep');
  assert.throws(f.uninstall, /其他文件/); assert.ok(existsSync(main));
  unlinkSync(join(f.destination, 'user.txt'));
  const enabled = join(f.vault, '.obsidian', 'community-plugins.json');
  writeFileSync(enabled, '["personal-agent-knowledge"]');
  assert.throws(f.uninstall, /停用/); assert.ok(existsSync(main));
  writeFileSync(enabled, '[]');
  const receipt = join(f.destination, 'personal-agent-installation.json'), originalReceipt = readFileSync(receipt);
  writeFileSync(receipt, '{}'); assert.throws(f.uninstall, /回执/); assert.ok(existsSync(main));
  writeFileSync(receipt, originalReceipt);
  writeFileSync(enabled, '[]'); unlinkSync(join(f.destination, 'manifest.json'));
  assert.equal(f.uninstall().state, 'uninstalled'); // Resume interrupted removal without restoring code.
});

test('linked configuration directory cannot redirect installation into another folder', t => {
  const f = fixture(t), other = join(f.vault, 'other'); mkdirSync(other);
  symlinkSync(other, join(f.vault, '.obsidian'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(f.install, /链接/);
  assert.equal(existsSync(join(other, 'plugins')), false);
  assert.equal(readFileSync(join(f.vault, 'note.md'), 'utf8'), 'Synthetic note untouched');
});

test('relative roots, whole drives and hard-linked plugin files are rejected', t => {
  const f = fixture(t);
  assert.throws(() => installPlugin({vaultPath: '.', bundlePath: join(root, 'dist')}), /绝对路径/);
  assert.throws(() => installPlugin({vaultPath: parse(f.vault).root, bundlePath: join(root, 'dist')}), /整个磁盘/);
  if (process.platform === 'win32') {
    assert.throws(() => installPlugin({vaultPath: '//server/share/vault', bundlePath: join(root, 'dist')}), /本机/);
  }
  f.install();
  const main = join(f.destination, 'main.js'); linkSync(main, join(f.vault, 'alias.js'));
  assert.throws(f.uninstall, /链接/); assert.ok(existsSync(join(f.destination, 'manifest.json')));
});
