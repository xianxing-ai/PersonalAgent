import {createHash, createHmac} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
/** Trusted main-process only. Implements Huawei's SDK-HMAC-SHA256 signing guide.
 * Credentials never leave this closure; only fixed SIS ASR/TTS POSTs are signed.
 * https://support.huaweicloud.com/devg-apisign/api-sign-algorithm-001.html */
export function createHuaweiSisRequestAuth({region, projectId, accessKeyId, secretAccessKey}, {now = Date.now} = {}) {
  if (!['cn-north-4', 'cn-east-3'].includes(region)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)
    || !/^[A-Za-z0-9]{10,128}$/.test(accessKeyId)
    || typeof secretAccessKey !== 'string' || secretAccessKey.length < 16
    || secretAccessKey.length > 256 || /[\r\n\0]/.test(secretAccessKey)) throw Error('SIS signing configuration is invalid');
  const origin = `https://sis-ext.${region}.myhuaweicloud.com`;
  return {async getSisRequestHeaders({url, method, body, deadline, signal}) {
    const timestamp = now();
    const target = new URL(url);
    if (signal?.aborted || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= timestamp)
      throw Error('SIS signing request expired');
    if (method !== 'POST' || target.origin !== origin || target.search || target.hash
      || target.username || target.password
      || ![`/v1/${projectId}/asr/short-audio`, `/v1/${projectId}/tts`].includes(target.pathname)
      || typeof body !== 'string' || Buffer.byteLength(body) > 12 * 1024 * 1024)
      throw Error('SIS signing request is outside the configured scope');
    const date = new Date(timestamp).toISOString().replace(/[:-]|\.\d{3}/g, '');
    const signedHeaders = 'content-type;host;x-project-id;x-sdk-date';
    const canonical = [method, `${target.pathname}/`, '',
      `content-type:application/json\nhost:${target.host}\nx-project-id:${projectId}\nx-sdk-date:${date}\n`,
      signedHeaders, hash(body)].join('\n');
    const signature = createHmac('sha256', secretAccessKey)
      .update(`SDK-HMAC-SHA256\n${date}\n${hash(canonical)}`).digest('hex');
    return {'Authorization': `SDK-HMAC-SHA256 Access=${accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'X-Sdk-Date': date, 'X-Project-Id': projectId};
  }};
}
