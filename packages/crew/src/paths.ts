/** crew 的共享路径策略，写法对齐 packages/coding-tools/src/workspace-paths.ts 的既有约定。 */
import {isAbsolute, join, relative, sep, win32} from 'node:path';
import {CrewError} from './errors.js';

export const MAX_RELATIVE_PATH_LENGTH = 1024;

const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

/**
 * 校验"受信根目录下的相对路径"：必须使用规范的子级片段，
 * 拒绝绝对路径、盘符/数据流、`.`/`..` 路径穿越、NUL 与 Windows 歧义段。
 * 返回以 `/` 连接的规范化形式，供目录映射与清单去重使用。
 */
export function canonicalRelativePath(value: unknown, field: string): {normalized: string; segments: string[]} {
  if (typeof value !== 'string') throw new CrewError('INVALID_INPUT', `${field} must be a string`);
  if (value.length > MAX_RELATIVE_PATH_LENGTH || value.includes('\0')) {
    throw new CrewError('INVALID_INPUT', `${field} is invalid`);
  }
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw new CrewError('INVALID_INPUT', `${field} must be a relative path`);
  }
  if (value.includes(':')) {
    throw new CrewError('INVALID_INPUT', `${field} must not contain drive qualifiers or alternate data streams`);
  }
  const segments = value.split(/[\\/]/u);
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new CrewError('INVALID_INPUT', `${field} must use canonical child segments without path traversal`);
  }
  for (const segment of segments) {
    if (/[. ]$/u.test(segment)) {
      throw new CrewError('INVALID_INPUT', `${field} contains a Windows-ambiguous segment`);
    }
    const deviceCandidate = segment.split('.')[0] ?? segment;
    if (windowsReservedName.test(deviceCandidate)) {
      throw new CrewError('INVALID_INPUT', `${field} contains a Windows device name`);
    }
  }
  return {normalized: segments.join('/'), segments};
}

/** 单一路径片段（例如 agentId 映射为工作区目录名）；含分隔符或穿越片段即拒绝。 */
export function singleSegment(value: unknown, field: string): string {
  const {normalized, segments} = canonicalRelativePath(value, field);
  if (segments.length !== 1) {
    throw new CrewError('INVALID_INPUT', `${field} must be a single path segment`);
  }
  return normalized;
}

/**
 * 把规范化相对路径解析到受信根目录之内，并用 `path.relative` 复核解析结果
 * 未越出根目录（双保险，与 coding-tools 的 pathIsWithinRoot 同一写法）。
 */
export function resolveWithinRoot(rootDir: string, value: unknown, field: string): {absolutePath: string; normalized: string} {
  const {normalized, segments} = canonicalRelativePath(value, field);
  const absolutePath = join(rootDir, ...segments);
  const relation = relative(rootDir, absolutePath);
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new CrewError('INVALID_INPUT', `${field} resolves outside the trusted root`);
  }
  return {absolutePath, normalized};
}
