import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function collectionUrl(value) {
  if (!text(value, 2048) || !value.trim()) throw Error('请填写日历集合地址');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('请填写有效的日历集合地址'); }
  // 与 packages/connectors/calendar 的 allowLoopbackHttp 语义对齐：仅 localhost/127.0.0.1/[::1]
  // 允许明文 HTTP（本地 Radicale 等验收服务器）；非回环明文一律拒绝。
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname) || url.hostname === '::1';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw Error('日历集合地址必须为 HTTPS；仅本机地址（localhost/127.0.0.1/[::1]）允许 HTTP，且不能包含账号、密码、查询参数或片段');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (url.href.length > 2048) throw Error('日历集合地址过长');
  return url.href;
}
function validSaved(value) {
  if (!value || value.providerKind !== 'caldav' || !uuid(value.accountRef) || !uuid(value.secretRef)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !text(value.calendarName, 120) || !text(value.username, 256) || value.username.includes(':')
    || !text(value.password, 4096) || !value.username || !value.password) return false;
  try { return collectionUrl(value.calendarUrl) === value.calendarUrl; } catch { return false; }
}

/** Trusted main only. Saving configuration grants no read permission and makes no provider call.
 * Binding/authorization are host-only; snapshots never disclose URL, account, secret or opaque refs.
 */
export function createCalendarConfig({userData, safeStorage}) {
  const target = path.join(userData, 'calendar-config.json');
  let saved, failure = '';
  if (existsSync(target)) {
    try {
      const raw = readFileSync(target);
      if (raw.length > 32_768 || !safeStorage.isEncryptionAvailable()) throw Error();
      const stored = JSON.parse(raw.toString('utf8'));
      if (stored.version !== 1 || typeof stored.encrypted !== 'string') throw Error();
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')));
      if (!validSaved(value)) throw Error();
      saved = value;
    } catch {failure = '日历加密配置无法读取，原文件已保留，请重新保存';}
  }
  const snapshot = () => ({configured: Boolean(saved), providerKind: saved?.providerKind ?? 'caldav',
    calendarName: saved?.calendarName ?? '', hasCredentials: Boolean(saved?.password),
    readAvailable: false, sessionAllowed: false, calendarWriteVerified: false,
    status: failure ? 'unavailable' : saved ? 'read_unavailable' : 'unconfigured',
    reason: failure || (saved ? '配置已加密保存；日历读取能力尚未接入，本次未读取日历'
      : '请配置一个 CalDAV 日历；保存配置不会读取日历或授予读取权限')});
  const requireBinding = binding => {
    if (!saved || !binding || binding.accountRef !== saved.accountRef
      || binding.secretRef !== saved.secretRef || binding.revision !== saved.revision
      || binding.providerKind !== saved.providerKind || binding.calendarUrl !== saved.calendarUrl) {
      throw Error('日历配置已变更或撤销');
    }
  };
  return Object.freeze({
    snapshot,
    binding: () => saved ? {providerKind: saved.providerKind, accountRef: saved.accountRef,
      secretRef: saved.secretRef, revision: saved.revision, calendarUrl: saved.calendarUrl,
      calendarName: saved.calendarName} : undefined,
    readAuthorization(binding) {
      requireBinding(binding);
      return `Basic ${Buffer.from(`${saved.username}:${saved.password}`, 'utf8').toString('base64')}`;
    },
    configure(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['providerKind', 'calendarUrl', 'calendarName', 'username', 'password'].includes(key))
        || input.providerKind !== 'caldav') throw Error('当前只支持配置 CalDAV 日历');
      const calendarUrl = collectionUrl(input.calendarUrl);
      const calendarName = input.calendarName ?? '';
      const username = typeof input.username === 'string' ? input.username.trim() : '';
      if (!text(calendarName, 120) || !text(username, 256) || username.includes(':')
        || (input.username !== undefined && typeof input.username !== 'string')
        || (input.password !== undefined && typeof input.password !== 'string')) throw Error('日历名称或账号格式无效');
      const sameAccount = saved?.calendarUrl === calendarUrl && saved?.username === username;
      const password = input.password || (sameAccount ? saved.password : '');
      if (!text(password, 4096) || !username || !password) throw Error('请填写日历账号及应用密码');
      if (saved?.revision === Number.MAX_SAFE_INTEGER) throw Error('日历配置版本不可继续，请撤销后重新保存');
      const value = {providerKind: 'caldav', calendarUrl, calendarName, username, password,
        accountRef: sameAccount ? saved.accountRef : randomUUID(), secretRef: randomUUID(),
        revision: (saved?.revision ?? 0) + 1};
      let temporary;
      try {
        if (!safeStorage.isEncryptionAvailable()) throw Error();
        const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
        mkdirSync(userData, {recursive: true});
        temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
        writeFileSync(temporary, JSON.stringify({version: 1, encrypted}), {encoding: 'utf8', flag: 'wx'});
        renameSync(temporary, target);
      } catch {
        if (temporary) {try {unlinkSync(temporary);} catch {}}
        throw Error('日历加密配置未保存，请检查本机安全存储');
      }
      saved = value; failure = '';
      return snapshot();
    },
    revoke() {
      try {if (existsSync(target)) unlinkSync(target);} catch {throw Error('日历配置清除失败，原文件已保留');}
      saved = undefined; failure = '';
      return snapshot();
    },
  });
}
