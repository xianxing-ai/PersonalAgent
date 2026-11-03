/** crew 模块错误码，对齐仓库统一错误分类：输入错误、不支持、限流、冲突、未知目标。 */
export type CrewErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_AGENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DISPATCH_LIMIT_EXCEEDED'
  | 'UNSUPPORTED';

export class CrewError extends Error {
  readonly code: CrewErrorCode;

  constructor(code: CrewErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CrewError';
    this.code = code;
  }
}
