/** crew 模块错误码，对齐仓库统一错误分类：输入错误、未授权、不支持、限流、冲突、超时、外部失败、结果不确定。 */
export type CrewErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_AGENT'
  | 'NOT_PERMITTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DISPATCH_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNSUPPORTED'
  /** 首次使用某家订阅来源未经用户同意（或同意已被撤销）。 */
  | 'CONSENT_REQUIRED'
  /** 驱动在本机不可用：CLI 未安装、未登录、无法确认登录状态或留后续 PR。 */
  | 'DRIVER_UNAVAILABLE'
  /** 驱动协议失败：非法数据、请求被对端以错误响应拒绝。 */
  | 'DRIVER_PROTOCOL'
  /** 驱动请求超时。 */
  | 'TIMEOUT'
  /** 驱动进程异常退出，结果不确定。 */
  | 'DRIVER_FAILED';

export class CrewError extends Error {
  readonly code: CrewErrorCode;

  constructor(code: CrewErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CrewError';
    this.code = code;
  }
}
