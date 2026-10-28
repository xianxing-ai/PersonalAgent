import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const ACCESS_KEY = /^[A-Za-z0-9]{10,128}$/;
const APPLICATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET = value => typeof value === 'string' && value.length >= 16 && value.length <= 256
  && !/[\r\n\0]/.test(value);
const TOKEN = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('AgentArts 观测凭据格式无效');
  const keys = Object.keys(value);
  if (keys.some(key => !['accessKey', 'secretKey', 'securityToken', 'applicationId'].includes(key))) {
    throw Error('AgentArts 观测凭据格式无效');
  }
  if (!ACCESS_KEY.test(value.accessKey) || !SECRET(value.secretKey)
    || (value.securityToken !== undefined && !TOKEN(value.securityToken))
    || (value.applicationId !== undefined && !APPLICATION_ID.test(value.applicationId))) {
    throw Error('AgentArts 观测凭据格式无效');
  }
  return {
    accessKey: value.accessKey,
    secretKey: value.secretKey,
    ...(value.securityToken === undefined ? {} : {securityToken: value.securityToken}),
    ...(value.applicationId === undefined ? {} : {applicationId: value.applicationId}),
  };
}

function fromEnvironment(environment) {
  const accessKey = environment.PA_AGENTARTS_OBSERVATION_ACCESS_KEY;
  const secretKey = environment.PA_AGENTARTS_OBSERVATION_SECRET_KEY;
  const securityToken = environment.PA_AGENTARTS_OBSERVATION_SECURITY_TOKEN;
  const applicationId = environment.PA_AGENTARTS_OBSERVATION_APPLICATION_ID;
  if (accessKey === undefined && secretKey === undefined && securityToken === undefined
    && applicationId === undefined) return undefined;
  // Application id alone is allowed; AK/SK must arrive as a complete pair.
  if ((accessKey === undefined) !== (secretKey === undefined)) {
    throw Error('AgentArts 观测 AK/SK 必须成对配置');
  }
  if (accessKey === undefined) {
    if (securityToken !== undefined) throw Error('AgentArts 观测临时令牌需要配套 AK/SK');
    if (!APPLICATION_ID.test(applicationId)) throw Error('AgentArts 观测 applicationId 无效');
    return {applicationId};
  }
  return validate({
    accessKey, secretKey,
    ...(securityToken === undefined ? {} : {securityToken}),
    ...(applicationId === undefined ? {} : {applicationId}),
  });
}

/**
 * Host-only observation AK/SK + applicationId storage.
 * Snapshots never return secrets; invoke Bearer is never stored or reused here.
 */
export function createAgentArtsObservationConfig({userData, safeStorage, environment = process.env}) {
  const file = path.join(userData, 'agentarts-observation-config.json');
  let saved;
  let failure = '';
  try {
    if (existsSync(file)) {
      if (!safeStorage.isEncryptionAvailable()) throw Error();
      const envelope = JSON.parse(readFileSync(file, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw Error();
      saved = validate(JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))));
    } else {
      saved = fromEnvironment(environment);
    }
  } catch {
    failure = 'AgentArts 观测凭据不可用，请重新保存 AK/SK 与 applicationId';
    saved = undefined;
  }

  const effective = () => {
    if (saved) return saved;
    try { return fromEnvironment(environment); } catch { return undefined; }
  };

  return {
    snapshot() {
      const value = effective();
      const credentialsConfigured = Boolean(value?.accessKey && value?.secretKey) && !failure;
      const applicationIdConfigured = Boolean(value?.applicationId) && !failure;
      return {
        configured: credentialsConfigured,
        applicationIdConfigured,
        applicationId: applicationIdConfigured ? value.applicationId : '',
        reason: failure
          || (credentialsConfigured
            ? (applicationIdConfigured
              ? '观测 AK/SK 与 applicationId 已配置；真实平台读回仍需任务身份与现场验收'
              : '观测 AK/SK 已配置；未配置 applicationId 时请求关联保持 not_checked')
            : (applicationIdConfigured
              ? '仅配置了 applicationId；缺观测 AK/SK 时读回保持显式 unavailable'
              : '未配置观测 AK/SK；平台观测读回保持显式 unavailable，不复用 invoke Bearer')),
      };
    },
    /** Trusted host only. Never spread into renderer snapshots. */
    readCredentials() {
      if (failure) return undefined;
      const value = effective();
      if (!value?.accessKey || !value?.secretKey) return undefined;
      return {
        accessKey: value.accessKey,
        secretKey: value.secretKey,
        ...(value.securityToken === undefined ? {} : {securityToken: value.securityToken}),
      };
    },
    readApplicationId() {
      if (failure) return undefined;
      return effective()?.applicationId;
    },
    configure(input) {
      const value = validate(input);
      if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用，未保存观测凭据');
      const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
      mkdirSync(userData, {recursive: true});
      const temporary = `${file}.tmp-${process.pid}`;
      writeFileSync(temporary, JSON.stringify({version: 1, encrypted}), {encoding: 'utf8', mode: 0o600});
      renameSync(temporary, file);
      saved = value;
      failure = '';
      return this.snapshot();
    },
    revoke() {
      saved = undefined;
      failure = '';
      try { unlinkSync(file); } catch (error) {
        if (error?.code !== 'ENOENT') {
          failure = '未能删除本机 AgentArts 观测凭据；撤销尚未确认';
          throw Error(failure);
        }
      }
      return this.snapshot();
    },
  };
}
