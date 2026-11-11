import test from 'node:test';
import assert from 'node:assert/strict';
import {CURATED_PLUGINS, parsePluginCatalog, parsePluginManifest} from '../dist/index.js';

const HIGH_RISK = new Set(['filesystem.write', 'network.write', 'code.execute']);

test('curated catalog entries are unique, sourced, and install only when a sha256 pin exists', () => {
  assert.equal(new Set(CURATED_PLUGINS.map(entry => entry.id)).size, CURATED_PLUGINS.length);
  assert.ok(CURATED_PLUGINS.length >= 16);
  for (const entry of CURATED_PLUGINS) {
    assert.equal(parsePluginManifest(structuredClone(entry)).id, entry.id);
    assert.match(entry.sourceRepositoryUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    assert.ok(entry.admissionReason.length > 20);
    assert.ok(entry.admissionCriteria.length >= 1);
    assert.equal(entry.reviewedAt, '2026-11-11');
    assert.notEqual(entry.pin.state, 'unpinned');
    if (!entry.oneClickInstall) {
      assert.equal(entry.installer, 'none');
      assert.ok(entry.installBlockReason);
    } else {
      assert.equal(entry.pin.sha256?.length, 64);
      assert.notEqual(entry.installer, 'none');
    }
    const admittedHighRisk = [...entry.capabilities, ...entry.permissionDeclarations]
      .some(item => item.admitted && HIGH_RISK.has(item.effect));
    if (entry.riskLevel === 'high' || admittedHighRisk) assert.equal(entry.enableRequiresAuthorization, true);
  }
  const installable = CURATED_PLUGINS.filter(entry => entry.oneClickInstall).map(entry => entry.id).sort();
  assert.deepEqual(installable, [
    'mcp.pinned.filesystem-readonly',
    'skill.anthropic.brand-guidelines',
    'skill.anthropic.frontend-design',
    'skill.anthropic.internal-comms',
  ]);
});

test('reviewed pins stay attached to the commits and hashes read on 2026-11-11', () => {
  const byId = new Map(CURATED_PLUGINS.map(entry => [entry.id, entry]));
  assert.equal(byId.get('mcp.reference.filesystem').pin.version, '2.2.0');
  assert.equal(byId.get('mcp.reference.filesystem').pin.commit, '36380287ed3b15d115b55f546617d723072b1296');
  assert.equal(byId.get('mcp.pinned.filesystem-readonly').pin.version, '2026.8.31');
  assert.equal(byId.get('mcp.pinned.filesystem-readonly').pin.sha256, '729dc8511e779e5cd6640851a74b25283e3af1ca3a7106722f993e864a1d9935');
  assert.equal(byId.get('mcp.pinned.filesystem-readonly').pin.distributionSha256, 'a239da270c403c42eb03e1ca7cca07c858085819797b74856ddbb91b50491b1a');
  assert.equal(byId.get('mcp.context7').pin.version, '4.6.0');
  assert.equal(byId.get('mcp.context7').pin.sha256, '20e9e401baa80ee5a9f9d77e5d6b5e5897fbaa89118b5db9003202396d19a988');
  assert.equal(byId.get('mcp.context7').oneClickInstall, false);
  assert.equal(byId.get('mcp.cloudflare-docs').pin.commit, 'a21972e219289337731a066befb5c66886b9ce7b');
  assert.equal(byId.get('mcp.cloudflare-docs').pin.sha256, undefined);
  assert.equal(byId.get('mcp.github').pin.commit, '4bcdcdf8d7beee98c9448e73e257308280924cc4');
  assert.equal(byId.get('skill.obra.superpowers').pin.version, '7.0.2');
  assert.equal(byId.get('skill.anthropic.frontend-design').pin.sha256, 'd55d581490111ef10d26da1a769e6ac863094ea6809423578617d8431d793fd1');
  assert.equal(byId.get('skill.anthropic.skill-creator').oneClickInstall, false);
  assert.equal(byId.get('mcp.reference.filesystem').pin.version === byId.get('mcp.pinned.filesystem-readonly').pin.version, false);
});

test('schema rejects unknown fields, unpinned one-click installs, and high-risk entries without a gate', () => {
  const base = structuredClone(CURATED_PLUGINS.find(entry => entry.id === 'skill.anthropic.frontend-design'));
  base.extra = true;
  assert.throws(() => parsePluginManifest(base), {code: 'INVALID_ARGUMENT'});
  const unpinned = structuredClone(CURATED_PLUGINS.find(entry => entry.id === 'mcp.reference.time'));
  unpinned.id = 'mcp.example.unpinned';
  unpinned.pin = {state: 'unpinned'};
  unpinned.oneClickInstall = true;
  unpinned.installer = 'local-skill';
  unpinned.skillName = 'time-copy';
  delete unpinned.installBlockReason;
  assert.throws(() => parsePluginManifest(unpinned), {code: 'INVALID_ARGUMENT'});
  unpinned.oneClickInstall = false;
  unpinned.installer = 'none';
  delete unpinned.skillName;
  unpinned.installBlockReason = '没有 commit、版本或 sha256。';
  assert.equal(parsePluginManifest(unpinned).pin.state, 'unpinned');
  const ungated = structuredClone(CURATED_PLUGINS.find(entry => entry.id === 'mcp.reference.git'));
  ungated.enableRequiresAuthorization = false;
  ungated.permissionDeclarations = [];
  assert.throws(() => parsePluginManifest(ungated), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => parsePluginCatalog([CURATED_PLUGINS[0], CURATED_PLUGINS[0]]), {code: 'INVALID_ARGUMENT'});
});
