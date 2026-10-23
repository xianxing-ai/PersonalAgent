import {ProtocolError} from '@personal-agent/contracts';
import {types} from 'node:util';

// External exception messages may contain credentials, private paths or mail text.
// Only fixed classifications cross the Gateway boundary.
const reasons: Record<string, string> = {
  EACCES: '访问被拒绝；请检查目标资源权限', EPERM: '操作权限不足；请检查目标资源权限',
  ENOENT: '目标资源不存在；请检查目标是否仍存在', ENOSPC: '存储空间不足；请释放空间后核实原操作',
  EEXIST: '目标已存在；请检查原操作是否已经完成', EBUSY: '目标正被占用；请关闭占用程序并核实原操作',
  ECONNREFUSED: '目标服务拒绝连接；请检查服务是否启动', ECONNRESET: '连接被中断；请检查服务连接',
  ENOTFOUND: '无法解析服务地址；请检查网络和服务地址', ETIMEDOUT: '服务响应超时；请检查网络和服务状态',
  UNAUTHORIZED: '授权无效或已失效；请检查当前授权', SCOPE_DENIED: '授权范围不足；请检查所需权限',
  INVALID_ARGUMENT: '参数或返回数据不符合约定；请检查输入和工具版本',
  UNSUPPORTED_CAPABILITY: '所需能力不可用；请检查工具配置', PROTOCOL_MISMATCH: '协议版本不匹配；请检查工具版本',
  REVISION_CONFLICT: '资源版本已变化；请重新读取当前状态', NOT_FOUND: '目标资源不存在；请检查目标是否仍存在',
  RATE_LIMITED: '工具请求频率或配额受限；请检查配额与限流设置',
  CURSOR_EXPIRED: '分页游标已过期；请从第一页重新读取',
  CANCELLED: '执行收到取消请求', TIMEOUT: '执行超过截止时间', RESULT_UNKNOWN: '工具未能确认原操作结果',
  EXTERNAL_FAILURE: '工具执行异常；请检查工具服务状态',
};

function errorData(error: unknown): {typed?: boolean; code?: unknown; status?: unknown; message?: unknown; retryable?: unknown; retryAfterMs?: unknown} {
  try {
    if(!error||typeof error!=='object'||types.isProxy(error))return {};
    const data: Record<string,unknown>={};
    for(const key of ['code','status','message','retryable','retryAfterMs']){
      const descriptor=Object.getOwnPropertyDescriptor(error,key);
      if(!descriptor)continue;
      // Even apparently harmless accessors are untrusted execution. Inherited
      // properties and accessor-backed diagnostics never classify an exception.
      if(!Object.hasOwn(descriptor,'value'))return {};
      data[key]=descriptor.value;
    }
    return {...data,typed:error instanceof ProtocolError};
  } catch {
    // Hostile prototypes/descriptors must not replace an unknown write outcome
    // with the diagnostic extractor's own exception or its private message.
    return {};
  }
}

export function toolFailure(error: unknown, stage: 'execute' | 'output_validation', write: boolean): ProtocolError {
  const data=errorData(error);
  const candidate = data.code;
  const code = typeof candidate === 'string' && Object.hasOwn(reasons, candidate) ? candidate : 'EXTERNAL_FAILURE';
  const statusValue=data.status;
  const status=typeof statusValue==='number'&&Number.isInteger(statusValue)&&statusValue>=400&&statusValue<=599?statusValue:undefined;
  const validation=data.typed&&candidate==='INVALID_ARGUMENT'&&typeof data.message==='string'
    ?/^Tool value violates schema \[keyword=(required|type|enum|const|minimum|maximum|minLength|maxLength|pattern|format|additionalProperties|minItems|maxItems|oneOf|anyOf|schema)(?:; field=([A-Za-z][A-Za-z0-9_]{0,47}))?\]$/.exec(data.message):undefined;
  const reason = stage === 'output_validation' ? '工具返回数据不符合约定；请检查工具版本和原操作结果'
    : status===401?'服务认证失败；请在设置中检查凭据'
    : status===403?'服务拒绝访问；请检查账号权限'
    : status===429?'服务请求频率或配额受限；请检查配额与限流设置'
    : status&&status>=500?'上游服务内部异常；请检查服务状态':reasons[code];
  const message = `工具失败 [stage=${stage}; cause=${code}${status?`; status=${status}`:''}${validation?`; validation=${validation[1]}${validation[2]?`; field=${validation[2]}`:''}`:''}]：${reason}。`
    + (write ? '写入结果待核实；请检查原操作记录和目标状态，确认前不要重试。' : '本次读取未取得有效结果。');
  const readError=!write&&data.typed;
  const retryAfterMs=readError&&typeof data.retryAfterMs==='number'&&Number.isSafeInteger(data.retryAfterMs)&&data.retryAfterMs>=0?data.retryAfterMs:undefined;
  return new ProtocolError(write ? 'RESULT_UNKNOWN' : readError ? code : 'EXTERNAL_FAILURE', message,
    readError&&data.retryable===true,retryAfterMs);
}
