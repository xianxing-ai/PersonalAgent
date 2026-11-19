/** 文件交接：单文件上限与基于真实字节的 SHA-256 度量（可信执行路径，不信任自报值）。 */
import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {CrewError} from './errors.js';

/** 单个交接文件的大小上限；与设计页"共享目录 + manifest，单文件 100MB"一致。 */
export const MAX_HANDOFF_FILE_BYTES = 100 * 1024 * 1024;

/** 计算字节内容的 SHA-256（小写十六进制）。 */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 登记前度量共享目录里的交接文件：必须存在、是常规文件且不超过大小上限。
 * 大小与哈希都来自此刻读到的真实字节；之后的一切改动由接收方校验兜底。
 */
export function measureHandoffFile(absolutePath: string, field: string): {sizeBytes: number; sha256: string} {
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    throw new CrewError('INVALID_INPUT', `${field} does not exist; write the file into the shared directory first (see resolveHandoffPath)`);
  }
  if (!stat.isFile()) throw new CrewError('INVALID_INPUT', `${field} must be a regular file`);
  if (stat.size > MAX_HANDOFF_FILE_BYTES) {
    throw new CrewError('INVALID_INPUT', `${field} exceeds the ${MAX_HANDOFF_FILE_BYTES} byte handoff limit`);
  }
  const bytes = readFileSync(absolutePath);
  return {sizeBytes: bytes.length, sha256: sha256OfBytes(bytes)};
}
