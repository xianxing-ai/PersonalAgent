import type {PluginManifest} from './schema.js';

const emptyArchivePin = {
  state: 'pinned' as const,
  sha256: '0'.repeat(64),
  sha256Subject: 'skill-bundle' as const,
};

/**
 * Test-only catalog entries with a non-empty minimal file grant.
 * Not part of the curated production directory; pass via createPluginCatalogService({catalog}).
 */
export function minimalPermissionPositivePlugin(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'skill.fixture.minimal-notes',
    name: 'Minimal notes grant',
    type: 'skill',
    sourceRepositoryUrl: 'https://github.com/example-org/minimal-notes-skill',
    license: 'MIT',
    licenseNotes: '测试夹具：声明 notes/ 最小文件权限正例，不是精选目录条目。',
    pin: emptyArchivePin,
    author: 'fixture',
    description: '声明 filePaths:notes 的最小权限正例，用于沙箱读写与越界拒绝验收。',
    capabilities: [{name: 'instruction', effect: 'instruction', admitted: true, statement: '只有说明与受限本地文件读写。'}],
    permissionDeclarations: [
      {scope: 'skill:instruction', effect: 'instruction', admitted: true, requiredForEnable: false, statement: '不签发工具授权。'},
      {scope: 'file:notes', effect: 'read', admitted: true, requiredForEnable: false, statement: '仅允许 notes/ 相对路径。'},
    ],
    permissionManifest: {networkHosts: [], filePaths: ['notes'], connectors: [], secrets: []},
    riskLevel: 'low',
    enableRequiresAuthorization: false,
    maintenanceStatus: 'active',
    maintenanceEvidence: '测试夹具。',
    admissionReason: 'Z-09 #25 最小权限正例。',
    admissionCriteria: ['摘要匹配才安装', '权限仅 notes/'],
    oneClickInstall: true,
    installer: 'local-skill',
    skillName: 'fixture-minimal-notes',
    reviewedAt: '2026-11-20',
    reviewSources: ['https://github.com/example-org/minimal-notes-skill'],
    ...overrides,
  };
}

/** Same grant as the positive fixture, but enableRequiresAuthorization for high-risk enable readback. */
export function minimalPermissionHighRiskPlugin(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return minimalPermissionPositivePlugin({
    id: 'skill.fixture.minimal-notes-high',
    name: 'Minimal notes grant (high)',
    skillName: 'fixture-minimal-notes-high',
    riskLevel: 'high',
    enableRequiresAuthorization: true,
    description: '高风险启用需授权读回的最小权限正例。',
    admissionReason: 'Z-09 #25 高风险启用授权正例。',
    permissionDeclarations: [
      {scope: 'plugin-catalog:enable', effect: 'enable', admitted: true, requiredForEnable: true, statement: '启用需要授权。'},
      {scope: 'file:notes', effect: 'read', admitted: true, requiredForEnable: false, statement: '仅允许 notes/ 相对路径。'},
    ],
    ...overrides,
  });
}
