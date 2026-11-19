import {ProtocolError} from '@personal-agent/contracts';
import {parsePermissionManifest, type PluginPermissionManifest} from './permissions.js';

export const HIGH_RISK_EFFECTS = ['filesystem.write', 'network.write', 'code.execute'] as const;
export const CAPABILITY_EFFECTS = ['instruction', 'read', 'network.read', ...HIGH_RISK_EFFECTS] as const;
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const MAINTENANCE_STATUSES = ['active', 'stale', 'unknown'] as const;
export const INSTALLERS = ['local-skill', 'pinned-filesystem-readonly', 'none'] as const;
export const SHA256_SUBJECTS = ['skill-bundle', 'npm-entry', 'npm-tarball'] as const;

export type HighRiskEffect = (typeof HIGH_RISK_EFFECTS)[number];
export type CapabilityEffect = (typeof CAPABILITY_EFFECTS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export type PluginInstaller = (typeof INSTALLERS)[number];
export type Sha256Subject = (typeof SHA256_SUBJECTS)[number];

export interface PluginCapability {
  name: string;
  effect: CapabilityEffect;
  admitted: boolean;
  statement: string;
}

export interface PermissionDeclaration {
  scope: string;
  effect: CapabilityEffect | 'enable';
  admitted: boolean;
  requiredForEnable: boolean;
  statement: string;
}

export interface PluginPin {
  state: 'pinned' | 'unpinned';
  commit?: string;
  version?: string;
  sha256?: string;
  sha256Subject?: Sha256Subject;
  distributionSha256?: string;
}

export interface PluginArchive {
  kind: 'github-directory' | 'npm-tarball';
  directory?: string;
  files?: readonly string[];
  tarballUrl?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  type: 'mcp' | 'skill';
  sourceRepositoryUrl: string;
  license: string;
  licenseNotes: string;
  pin: PluginPin;
  author: string;
  description: string;
  capabilities: readonly PluginCapability[];
  permissionDeclarations: readonly PermissionDeclaration[];
  permissionManifest: PluginPermissionManifest;
  riskLevel: RiskLevel;
  enableRequiresAuthorization: boolean;
  maintenanceStatus: MaintenanceStatus;
  maintenanceEvidence: string;
  admissionReason: string;
  admissionCriteria: readonly string[];
  oneClickInstall: boolean;
  installer: PluginInstaller;
  installBlockReason?: string;
  archive?: PluginArchive;
  skillName?: string;
  publicEndpoint?: string;
  reviewedAt: string;
  reviewedStars?: number;
  lastPushedAt?: string;
  reviewSources: readonly string[];
}

const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const manifestKeys = ['id','name','type','sourceRepositoryUrl','license','licenseNotes','pin','author','description','capabilities','permissionDeclarations','permissionManifest','riskLevel','enableRequiresAuthorization','maintenanceStatus','maintenanceEvidence','admissionReason','admissionCriteria','oneClickInstall','installer','installBlockReason','archive','skillName','publicEndpoint','reviewedAt','reviewedStars','lastPushedAt','reviewSources'] as const;
const archiveKeys = ['kind','directory','files','tarballUrl'] as const;
const pinKeys = ['state','commit','version','sha256','sha256Subject','distributionSha256'] as const;
const capabilityKeys = ['name','effect','admitted','statement'] as const;
const permissionKeys = ['scope','effect','admitted','requiredForEnable','statement'] as const;

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} is invalid`);
  return value;
}

function httpsUrl(value: unknown, label: string): string {
  const raw = text(value, label, 300);
  let url: URL;
  try { url = new URL(raw); } catch { return fail(`${label} is invalid`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail(`${label} is invalid`);
  return raw;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unknown field ${key}`);
}

function optionalHash(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} is invalid`);
  return value;
}

function safeRelative(value: string): boolean {
  return value.length <= 200 && !value.split('/').some(part => !part || part === '.' || part === '..') && !value.includes('\\') && !value.includes(':');
}

function parseArchive(value: unknown): PluginArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('archive is invalid');
  const archive = value as Record<string, unknown>;
  exactKeys(archive, archiveKeys, 'archive');
  if (archive.kind === 'github-directory') {
    const directory = text(archive.directory, 'archive.directory', 200);
    if (!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directory)) fail('archive.directory is invalid');
    if (!Array.isArray(archive.files) || archive.files.length < 1 || archive.files.length > 128) fail('archive.files are invalid');
    const files = archive.files.map(file => text(file, 'archive.file', 200));
    if (files.some(file => !safeRelative(file)) || new Set(files).size !== files.length || !files.includes('SKILL.md')) fail('archive.files are invalid');
    if (archive.tarballUrl !== undefined) fail('github archive cannot include a tarball');
    return {kind: 'github-directory', directory, files};
  }
  if (archive.kind === 'npm-tarball') {
    const tarballUrl = httpsUrl(archive.tarballUrl, 'archive.tarballUrl');
    if (archive.directory !== undefined || archive.files !== undefined) fail('npm archive cannot include skill files');
    return {kind: 'npm-tarball', tarballUrl};
  }
  return fail('archive.kind is invalid');
}

function isHighRisk(effect: string): boolean {
  return (HIGH_RISK_EFFECTS as readonly string[]).includes(effect);
}

export function parsePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Plugin manifest is invalid');
  const data = value as Record<string, unknown>;
  exactKeys(data, manifestKeys, 'Plugin manifest');
  const id = text(data.id, 'id', 80);
  if (!ID.test(id)) fail('id is invalid');
  const type = data.type;
  if (type !== 'mcp' && type !== 'skill') fail('type is invalid');
  const sourceRepositoryUrl = httpsUrl(data.sourceRepositoryUrl, 'sourceRepositoryUrl');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceRepositoryUrl)) fail('sourceRepositoryUrl is invalid');
  if (!data.pin || typeof data.pin !== 'object' || Array.isArray(data.pin)) fail('pin is invalid');
  const pinRecord = data.pin as Record<string, unknown>;
  exactKeys(pinRecord, pinKeys, 'pin');
  if (pinRecord.state !== 'pinned' && pinRecord.state !== 'unpinned') fail('pin.state is invalid');
  const commit = pinRecord.commit === undefined ? undefined : text(pinRecord.commit, 'pin.commit', 40);
  if (commit !== undefined && !COMMIT.test(commit)) fail('pin.commit is invalid');
  const version = pinRecord.version === undefined ? undefined : text(pinRecord.version, 'pin.version', 64);
  const sha256 = optionalHash(pinRecord.sha256, 'pin.sha256');
  const distributionSha256 = optionalHash(pinRecord.distributionSha256, 'pin.distributionSha256');
  const sha256Subject = pinRecord.sha256Subject as Sha256Subject | undefined;
  if (sha256Subject !== undefined && !(SHA256_SUBJECTS as readonly string[]).includes(sha256Subject)) fail('pin.sha256Subject is invalid');
  if (pinRecord.state === 'unpinned' && (commit || version || sha256 || distributionSha256 || sha256Subject)) fail('unpinned manifest cannot carry a pin');
  if (pinRecord.state === 'pinned' && !commit && !version && !sha256) fail('pinned manifest needs a commit, version, or sha256');
  if (Boolean(sha256) !== Boolean(sha256Subject)) fail('sha256 and sha256Subject must be paired');
  const installer = data.installer;
  if (!(INSTALLERS as readonly string[]).includes(String(installer))) fail('installer is invalid');
  const oneClickInstall = data.oneClickInstall;
  if (typeof oneClickInstall !== 'boolean') fail('oneClickInstall is invalid');
  if (oneClickInstall && (!sha256 || installer === 'none' || pinRecord.state !== 'pinned')) fail('one-click install requires a pinned sha256 and an installer');
  const skillName = data.skillName === undefined ? undefined : text(data.skillName, 'skillName', 64);
  if (skillName !== undefined && !SKILL_NAME.test(skillName)) fail('skillName is invalid');
  if (installer === 'local-skill' && (type !== 'skill' || !skillName || sha256Subject !== 'skill-bundle')) fail('local-skill installer is inconsistent');
  if (installer === 'pinned-filesystem-readonly' && (type !== 'mcp' || !version || sha256Subject !== 'npm-entry')) fail('filesystem installer is inconsistent');
  if (installer === 'none' && oneClickInstall) fail('installer none cannot be one-click installed');
  const installBlockReason = data.installBlockReason === undefined ? undefined : text(data.installBlockReason, 'installBlockReason', 800);
  if (!oneClickInstall && !installBlockReason) fail('blocked install requires a reason');
  if (oneClickInstall && installBlockReason) fail('one-click install cannot include a block reason');
  const archive = data.archive === undefined ? undefined : parseArchive(data.archive);
  if (archive?.kind === 'github-directory' && archive.directory !== `skills/${skillName}`) fail('skill archive is invalid');
  if (archive?.kind === 'npm-tarball' && archive.tarballUrl !== `https://registry.npmjs.org/@modelcontextprotocol/server-filesystem/-/server-filesystem-${version}.tgz`) fail('filesystem archive is invalid');
  if (!oneClickInstall && archive) fail('blocked install cannot include a download archive');
  if (!Array.isArray(data.capabilities) || data.capabilities.length < 1 || data.capabilities.length > 24) fail('capabilities are invalid');
  const capabilities = data.capabilities.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('capability is invalid');
    const capability = item as Record<string, unknown>;
    exactKeys(capability, capabilityKeys, 'capability');
    const effect = capability.effect;
    if (!(CAPABILITY_EFFECTS as readonly string[]).includes(String(effect))) fail('capability effect is invalid');
    if (typeof capability.admitted !== 'boolean') fail('capability admitted is invalid');
    return {name: text(capability.name, 'capability.name', 80), effect: effect as CapabilityEffect, admitted: capability.admitted, statement: text(capability.statement, 'capability.statement', 600)};
  });
  if (new Set(capabilities.map(item => item.name)).size !== capabilities.length) fail('capability names must be unique');
  if (!Array.isArray(data.permissionDeclarations) || data.permissionDeclarations.length > 24) fail('permissionDeclarations are invalid');
  const permissionDeclarations = data.permissionDeclarations.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('permission declaration is invalid');
    const permission = item as Record<string, unknown>;
    exactKeys(permission, permissionKeys, 'permission declaration');
    const effect = permission.effect;
    if (effect !== 'enable' && !(CAPABILITY_EFFECTS as readonly string[]).includes(String(effect))) fail('permission effect is invalid');
    if (typeof permission.admitted !== 'boolean' || typeof permission.requiredForEnable !== 'boolean') fail('permission flags are invalid');
    if (permission.requiredForEnable && !permission.admitted) fail('enable scope must be admitted');
    return {scope: text(permission.scope, 'permission.scope', 120), effect: effect as PermissionDeclaration['effect'], admitted: permission.admitted, requiredForEnable: permission.requiredForEnable, statement: text(permission.statement, 'permission.statement', 600)};
  });
  if (new Set(permissionDeclarations.map(item => item.scope)).size !== permissionDeclarations.length) fail('permission scopes must be unique');
  const permissionManifest = parsePermissionManifest(data.permissionManifest);
  const riskLevel = data.riskLevel;
  if (!(RISK_LEVELS as readonly string[]).includes(String(riskLevel))) fail('riskLevel is invalid');
  if (typeof data.enableRequiresAuthorization !== 'boolean') fail('enableRequiresAuthorization is invalid');
  const admittedHighRisk = capabilities.some(item => item.admitted && isHighRisk(item.effect)) || permissionDeclarations.some(item => item.admitted && isHighRisk(item.effect));
  if ((riskLevel === 'high' || admittedHighRisk) && !data.enableRequiresAuthorization) fail('high-risk plugin requires authorization before enable');
  if (data.enableRequiresAuthorization && !permissionDeclarations.some(item => item.requiredForEnable)) fail('authorization gate needs a required scope');
  const maintenanceStatus = data.maintenanceStatus;
  if (!(MAINTENANCE_STATUSES as readonly string[]).includes(String(maintenanceStatus))) fail('maintenanceStatus is invalid');
  if (!Array.isArray(data.admissionCriteria) || data.admissionCriteria.length < 1 || data.admissionCriteria.length > 12) fail('admissionCriteria are invalid');
  const admissionCriteria = data.admissionCriteria.map(item => text(item, 'admission criterion', 400));
  if (!Array.isArray(data.reviewSources) || data.reviewSources.length < 1 || data.reviewSources.length > 12) fail('reviewSources are invalid');
  const reviewSources = data.reviewSources.map(item => httpsUrl(item, 'reviewSource'));
  const reviewedAt = text(data.reviewedAt, 'reviewedAt', 10);
  if (!DATE.test(reviewedAt) || !Number.isFinite(Date.parse(`${reviewedAt}T00:00:00Z`))) fail('reviewedAt is invalid');
  const lastPushedAt = data.lastPushedAt === undefined ? undefined : text(data.lastPushedAt, 'lastPushedAt', 10);
  if (lastPushedAt !== undefined && (!DATE.test(lastPushedAt) || !Number.isFinite(Date.parse(`${lastPushedAt}T00:00:00Z`)))) fail('lastPushedAt is invalid');
  const reviewedStars = data.reviewedStars;
  if (reviewedStars !== undefined && (!Number.isSafeInteger(reviewedStars) || (reviewedStars as number) < 0)) fail('reviewedStars is invalid');
  const publicEndpoint = data.publicEndpoint === undefined ? undefined : httpsUrl(data.publicEndpoint, 'publicEndpoint');
  const pin: PluginPin = {state: pinRecord.state};
  if (commit) pin.commit = commit;
  if (version) pin.version = version;
  if (sha256 && sha256Subject) { pin.sha256 = sha256; pin.sha256Subject = sha256Subject; }
  if (distributionSha256) pin.distributionSha256 = distributionSha256;
  const manifest: PluginManifest = {
    id, name: text(data.name, 'name', 120), type, sourceRepositoryUrl,
    license: text(data.license, 'license', 80), licenseNotes: text(data.licenseNotes, 'licenseNotes', 800),
    pin, author: text(data.author, 'author', 160), description: text(data.description, 'description', 2000),
    capabilities, permissionDeclarations, permissionManifest, riskLevel: riskLevel as RiskLevel, enableRequiresAuthorization: data.enableRequiresAuthorization,
    maintenanceStatus: maintenanceStatus as MaintenanceStatus, maintenanceEvidence: text(data.maintenanceEvidence, 'maintenanceEvidence', 800),
    admissionReason: text(data.admissionReason, 'admissionReason', 2000), admissionCriteria, oneClickInstall, installer: installer as PluginInstaller,
    reviewedAt, reviewSources,
  };
  if (installBlockReason) manifest.installBlockReason = installBlockReason;
  if (archive) manifest.archive = archive;
  if (skillName) manifest.skillName = skillName;
  if (publicEndpoint) manifest.publicEndpoint = publicEndpoint;
  if (reviewedStars !== undefined) manifest.reviewedStars = reviewedStars as number;
  if (lastPushedAt) manifest.lastPushedAt = lastPushedAt;
  return manifest;
}

export function parsePluginCatalog(value: unknown): PluginManifest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail('Plugin catalog is invalid');
  const entries = value.map(parsePluginManifest);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) fail('Plugin ids must be unique');
  const skillNames = entries.filter(entry => entry.skillName).map(entry => entry.skillName);
  if (new Set(skillNames).size !== skillNames.length) fail('Skill directory names must be unique');
  return entries;
}
