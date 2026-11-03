/** crew 模块错误码，对齐仓库统一错误分类：输入错误、未授权、不支持、限流、冲突、未知目标。 */
export type CrewErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_AGENT'
  | 'NOT_PERMITTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DISPATCH_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNSUPPORTED'
  | 'HANDOFF_REJECTED';

export class CrewError extends Error {
  readonly code: CrewErrorCode;

  constructor(code: CrewErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CrewError';
    this.code = code;
  }
}
