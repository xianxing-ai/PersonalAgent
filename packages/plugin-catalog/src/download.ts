import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import type {PluginManifest} from './schema.js';

export interface PinnedDownload {
  get(url: string): Promise<{status: number; bytes: Uint8Array}>;
}

const FILE_LIMIT = 262144;
const BUNDLE_LIMIT = 1_048_576;

function fail(code: string, message: string): never {
  throw new ProtocolError(code, message);
}

export function githubFileUrl(entry: PluginManifest, file: string): string {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(entry.sourceRepositoryUrl);
  const commit = entry.pin.commit;
  const directory = entry.archive?.directory;
  if (!match || !commit || !directory || !entry.archive?.files?.includes(file)) fail('INVALID_ARGUMENT', '技能下载地址不在录取针内');
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commit}/${directory}/${file}`;
}

async function readBytes(download: PinnedDownload, url: string, limit: number): Promise<Uint8Array> {
  let response: {status: number; bytes: Uint8Array};
  try { response = await download.get(url); }
  catch { return fail('EXTERNAL_FAILURE', '固定版本下载失败'); }
  if (response.status !== 200 || response.bytes.byteLength < 1 || response.bytes.byteLength > limit) fail('EXTERNAL_FAILURE', '固定版本下载失败');
  return response.bytes;
}

export async function materializePinnedSkill(entry: PluginManifest, download: PinnedDownload): Promise<{directory: string; remove: () => void}> {
  if (entry.archive?.kind !== 'github-directory' || !entry.skillName || !entry.archive.files) fail('INVALID_ARGUMENT', '技能下载针无效');
  const root = mkdtempSync(path.join(tmpdir(), 'plugin-catalog-'));
  const directory = path.join(root, entry.skillName);
  mkdirSync(directory);
  let total = 0;
  try {
    for (const file of entry.archive.files) {
      const bytes = Buffer.from(await readBytes(download, githubFileUrl(entry, file), FILE_LIMIT));
      total += bytes.byteLength;
      if (total > BUNDLE_LIMIT) fail('INVALID_ARGUMENT', '下载内容超过现有技能安装上限');
      const target = path.resolve(directory, file);
      if (target !== directory && !target.startsWith(directory + path.sep)) fail('INVALID_ARGUMENT', '技能下载路径无效');
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, bytes);
    }
  } catch (error) {
    rmSync(root, {recursive: true, force: true});
    throw error;
  }
  return {directory, remove: () => rmSync(root, {recursive: true, force: true})};
}

export function readNpmTarball(bytes: Uint8Array): {packageJson: Buffer; entry: Buffer} {
  let raw: Buffer;
  try { raw = gunzipSync(bytes); }
  catch { return fail('INVALID_ARGUMENT', 'filesystem 包压缩内容无效'); }
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8);
    const type = header[156];
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > raw.length) fail('INVALID_ARGUMENT', 'filesystem 包内容无效');
    const body = raw.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 0 || type === 48) {
      const normalized = name.replace(/^package\//, '');
      if (normalized === 'package.json' || normalized === 'dist/index.js') files.set(normalized, Buffer.from(body));
    }
  }
  const packageJson = files.get('package.json');
  const entry = files.get('dist/index.js');
  if (!packageJson || !entry) fail('INVALID_ARGUMENT', 'filesystem 包缺少钉死入口');
  return {packageJson, entry};
}

export async function downloadPinnedFilesystem(entry: PluginManifest, download: PinnedDownload): Promise<{packageVersion: string; entrySha256: string}> {
  const url = entry.archive?.tarballUrl;
  if (entry.archive?.kind !== 'npm-tarball' || !url || !entry.pin.sha256 || !entry.pin.distributionSha256 || !entry.pin.version) {
    fail('INVALID_ARGUMENT', 'filesystem 下载针无效');
  }
  const bytes = await readBytes(download, url, 2_000_000);
  const tarballSha = createHash('sha256').update(bytes).digest('hex');
  if (tarballSha !== entry.pin.distributionSha256) fail('INVALID_ARGUMENT', '下载的 filesystem 包摘要不一致');
  const packed = readNpmTarball(bytes);
  const metadata = JSON.parse(packed.packageJson.toString('utf8')) as {version?: unknown};
  const entrySha = createHash('sha256').update(packed.entry).digest('hex');
  if (metadata.version !== entry.pin.version || entrySha !== entry.pin.sha256) fail('INVALID_ARGUMENT', '下载的 filesystem 入口摘要不一致');
  return {packageVersion: entry.pin.version, entrySha256: entrySha};
}
