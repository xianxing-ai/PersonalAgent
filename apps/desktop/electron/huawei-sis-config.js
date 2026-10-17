import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const REGIONS = new Set(['cn-north-4', 'cn-east-3']);

/** SIS credentials belong to the trusted main process, never the panel snapshot. */
export function createDesktopSisConfigHost({userData, safeStorage, env = process.env}) {
  const target = path.join(userData, 'huawei-sis-config.json');
  const accessKeyTarget = path.join(userData, 'huawei-sis-access-key.json');
  let accessKeyConfig;
  function validateAccessKey(value) {
    if (!value || !REGIONS.has(value.region) || !/^[A-Za-z0-9_-]{1,128}$/.test(value.projectId)
      || !/^[A-Za-z0-9]{10,128}$/.test(value.accessKeyId)
      || typeof value.secretAccessKey !== 'string' || value.secretAccessKey.length < 16
      || value.secretAccessKey.length > 256 || /[\r\n\0]/.test(value.secretAccessKey))
      throw Error('SIS 访问密钥配置无效');
  }
  if (existsSync(accessKeyTarget)) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw Error();
      const envelope = JSON.parse(readFileSync(accessKeyTarget, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw Error();
      const restored = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      validateAccessKey(restored);
      accessKeyConfig = restored;
    } catch { /* Existing token configuration remains independently recoverable. */ }
  }
  function configureAccessKey({region, projectId, accessKeyId, secretAccessKey}) {
    const selected = {region, projectId, accessKeyId, secretAccessKey};
    validateAccessKey(selected);
    if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，SIS 配置未保存');
    const envelope = {version: 1, encrypted: safeStorage.encryptString(JSON.stringify(selected)).toString('base64')};
    mkdirSync(path.dirname(accessKeyTarget), {recursive: true});
    const temporary = `${accessKeyTarget}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(envelope), {encoding: 'utf8', mode: 0o600});
    renameSync(temporary, accessKeyTarget);
    accessKeyConfig = selected;
  }
  // Trusted host only. Never spread this object into a renderer snapshot.
  function currentAccessKey() {return accessKeyConfig ? {...accessKeyConfig} : undefined;}
  let saved;
  let restoreFailed = false;
  if (existsSync(target)) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw Error('secure storage unavailable');
      const payload = JSON.parse(readFileSync(target, 'utf8'));
      if (payload?.version !== 1 || !REGIONS.has(payload.region)
        || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.projectId)
        || typeof payload.token !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.token)) {
        throw Error('invalid SIS configuration');
      }
      saved = {region: payload.region, projectId: payload.projectId,
        token: safeStorage.decryptString(Buffer.from(payload.token, 'base64')),
        tokenExpiresAt: payload.tokenExpiresAt ?? ''};
    } catch { restoreFailed = true; }
  }

  function validate(region, projectId, token, tokenExpiresAt = '') {
    if (!REGIONS.has(region) || typeof projectId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)
      || typeof token !== 'string' || !token || token.length > 16_384
      || token.trim() !== token || /[\r\n]/.test(token)
      || typeof tokenExpiresAt !== 'string'
      || tokenExpiresAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(tokenExpiresAt)
        || !Number.isFinite(Date.parse(tokenExpiresAt)))) {
      throw Error('SIS 区域、项目 ID 或独立 IAM Token 无效');
    }
  }

  function current() {
    const region = saved?.region ?? env.PA_HUAWEI_SIS_REGION;
    const projectId = saved?.projectId ?? env.PA_HUAWEI_SIS_PROJECT_ID;
    const token = saved?.token ?? env.PA_HUAWEI_SIS_IAM_TOKEN;
    const tokenExpiresAt = saved?.tokenExpiresAt ?? env.PA_HUAWEI_SIS_TOKEN_EXPIRES_AT ?? '';
    if (!region && !projectId && !token) return undefined;
    validate(region, projectId, token, tokenExpiresAt);
    return {region, projectId, token, tokenExpiresAt};
  }

  function configure({region, projectId, iamToken, tokenExpiresAt = ''}) {
    validate(region, projectId, iamToken, tokenExpiresAt);
    if (tokenExpiresAt && Date.parse(tokenExpiresAt) <= Date.now()) {
      throw Error('SIS IAM Token 已过期');
    }
    if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，SIS 配置未保存');
    const payload = {version: 1, region, projectId, tokenExpiresAt,
      token: safeStorage.encryptString(iamToken).toString('base64')};
    mkdirSync(path.dirname(target), {recursive: true});
    const temporary = `${target}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(payload), {encoding: 'utf8', mode: 0o600});
    renameSync(temporary, target);
    saved = {region, projectId, token: iamToken, tokenExpiresAt};
    restoreFailed = false;
  }

  function snapshot() {
    if (accessKeyConfig) return {route: 'direct-huawei-sis', agentArtsProxy: 'unavailable',
      credentialSource: 'encrypted_file', authMode: 'ak_sk', missingFields: [], configured: true,
      region: accessKeyConfig.region, projectId: accessKeyConfig.projectId,
      tokenStatus: 'not_required', tokenExpiresAt: '',
      reason: 'SIS 长期访问密钥已保存；AgentArts SIS 转发尚未接通，真实调用尚未验收'};
    const presence={region:Boolean(saved?.region??env.PA_HUAWEI_SIS_REGION),projectId:Boolean(saved?.projectId??env.PA_HUAWEI_SIS_PROJECT_ID),
      iamToken:Boolean(saved?.token??env.PA_HUAWEI_SIS_IAM_TOKEN)};
    const diagnostic={route:'direct-huawei-sis',agentArtsProxy:'unavailable',credentialSource:saved?'encrypted_file':Object.values(presence).some(Boolean)?'environment':'missing',
      missingFields:Object.keys(presence).filter(key=>!presence[key])};
    try {
      const selected = current();
      const expired = Boolean(selected?.tokenExpiresAt && Date.parse(selected.tokenExpiresAt) <= Date.now());
      return {...diagnostic,configured: Boolean(selected) && !expired,
        region: selected?.region ?? 'cn-north-4', projectId: selected?.projectId ?? '',
        tokenStatus: expired ? 'expired' : selected?.tokenExpiresAt ? 'expires_at' : 'unknown',
        tokenExpiresAt: selected?.tokenExpiresAt ?? '',
        reason: expired ? 'SIS IAM Token 已过期，请更新'
          : selected ? selected.tokenExpiresAt
            ? 'SIS 已配置；真实设备与云端调用尚未验收'
            : 'SIS 已配置；IAM Token 有效期未知，真实调用尚未验收'
          : restoreFailed ? '保存的 SIS 配置无法解密，请重新配置'
            : '请配置 SIS 区域、项目 ID 和独立 IAM Token'};
    } catch {
      return {...diagnostic,configured: false, tokenStatus: 'unknown', tokenExpiresAt: '',
        reason: 'SIS 区域、项目 ID 或独立 IAM Token 配置无效'};
    }
  }

  return {current, configure, snapshot, configureAccessKey, currentAccessKey};
}
