import {publicErrorMessages} from './public-error-messages.js';
// This module runs in both main and renderer. Never copy arbitrary exception text:
// it may contain email bodies, access tokens, URLs or private filesystem paths.
const reasons = Object.freeze({
  CANCELLED:'操作已取消；请确认当前任务状态', TIMEOUT:'操作超过截止时间；请检查服务状态',
  RESULT_UNKNOWN:'原操作结果尚未确认；请核实原记录和目标状态，确认前不要重试',
  INVALID_ARGUMENT:'输入或返回数据不符合约定；请检查输入与工具版本',
  UNAUTHORIZED:'授权无效或已失效；请检查当前授权', SCOPE_DENIED:'授权范围不足；请检查所需权限',
  EACCES:'资源访问被拒绝；请检查目标权限', EPERM:'操作权限不足；请检查目标权限',
  ENOENT:'目标资源不存在；请检查目标是否仍存在', NOT_FOUND:'目标资源不存在；请检查目标是否仍存在',
  ENOSPC:'存储空间不足；请释放空间', EEXIST:'目标已存在；请检查原操作是否已完成',
  EBUSY:'目标正被占用；请关闭占用程序', ECONNREFUSED:'服务拒绝连接；请检查服务是否启动',
  ECONNRESET:'服务连接已中断；请检查网络', ENOTFOUND:'服务地址解析失败；请检查网络和地址',
  ETIMEDOUT:'服务响应超时；请检查网络和服务状态', REVISION_CONFLICT:'资源版本已变化；请刷新当前状态',
  RATE_LIMITED:'请求频率或配额受限；请检查配额与限流设置',
  CURSOR_EXPIRED:'分页游标已过期；请从第一页重新读取',
  PROTOCOL_MISMATCH:'协议版本不匹配；请检查应用和工具版本', UNSUPPORTED_CAPABILITY:'所需能力不可用；请检查配置',
  EXTERNAL_FAILURE:'外部服务执行失败；请检查服务状态',
  CONFIGURATION:'配置尚未就绪或无效；请打开对应设置检查配置',
  STORAGE:'本机安全存储不可用；请检查系统安全存储状态',
  CONNECTION:'连接尚未就绪或已断开；请检查网络和服务连接',
  VALIDATION:'输入不符合要求；请检查必填字段和格式',
});
const stages = new Set(['task','ipc','renderer','runtime','configuration']);
function errorData(error){
  try{
    if(!error||typeof error!=='object')return {};
    const data={};
    for(const key of ['message','code','status','errorId']){
      const descriptor=Object.getOwnPropertyDescriptor(error,key);
      if(!descriptor)continue;
      if(!Object.hasOwn(descriptor,'value'))return {};
      data[key]=descriptor.value;
    }
    return data;
  }catch{return {};}
}
export function errorDisplay(error, stage='renderer') {
  const data=errorData(error);
  const raw = typeof error==='string'?error:typeof data.message==='string'?data.message:'';
  const codeValue = typeof data.code==='string'?data.code:'';
  // Gateway messages consist solely of fixed vocabulary and enum values. Preserve
  // their more precise execution stage/cause; all other messages are classified.
  const gateway = /^工具失败 \[stage=(execute|output_validation); cause=([A-Z_]+)(?:; status=([45]\d\d))?(?:; validation=(required|type|enum|const|minimum|maximum|minLength|maxLength|pattern|format|additionalProperties|minItems|maxItems|oneOf|anyOf|schema)(?:; field=([A-Za-z][A-Za-z0-9_]{0,47}))?)?\]：/.exec(raw);
  const previous = /^\[stage=(task|ipc|renderer|runtime|configuration|execute|output_validation); code=([A-Z_]+)(?:; cause=([A-Z_]+))?(?:; status=([45]\d\d))?(?:; validation=(required|type|enum|const|minimum|maximum|minLength|maxLength|pattern|format|additionalProperties|minItems|maxItems|oneOf|anyOf|schema)(?:; field=([A-Za-z][A-Za-z0-9_]{0,47}))?)?\] /.exec(raw);
  const inputValidation=/^Tool value violates schema \[keyword=(required|type|enum|const|minimum|maximum|minLength|maxLength|pattern|format|additionalProperties|minItems|maxItems|oneOf|anyOf|schema)(?:; field=([A-Za-z][A-Za-z0-9_]{0,47}))?\]$/.exec(raw);
  const cloud=/\[cloud: transport=(https|wss)(?: http=([45]\d\d)| phase=(wss_connect|wss_ready|wss_invoke)(?: close=([1-4]\d{3}) reason=(normal|going_away|protocol_error|abnormal|server_error|other)| socket=(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE))?| code=(RATE_LIMITED|UNAUTHORIZED|INVALID_ARGUMENT|UNSUPPORTED_CAPABILITY|TIMEOUT|CANCELLED|EXTERNAL_FAILURE))\]$/.exec(raw);
  let code = Object.hasOwn(reasons, codeValue)?codeValue:
    gateway&&Object.hasOwn(reasons,gateway[2])?gateway[2]:
    previous&&Object.hasOwn(reasons,previous[2])?previous[2]:undefined;
  if(!code) {
    if(/取消|cancel|abort/i.test(raw))code='CANCELLED';
    else if(/超时|截止|timeout|deadline/i.test(raw))code='TIMEOUT';
    else if(/待核实|未确认|unknown/i.test(raw))code='RESULT_UNKNOWN';
    else if(/安全存储|加密存储|safe.?storage/i.test(raw))code='STORAGE';
    else if(/授权|权限|unauthori|permission|access denied/i.test(raw))code='UNAUTHORIZED';
    else if(/不存在|not found|ENOENT/i.test(raw))code='NOT_FOUND';
    else if(/版本|冲突|revision|conflict/i.test(raw))code='REVISION_CONFLICT';
    else if(/配置|凭据|api.?key|未设置|未启用|未注册|不可用/i.test(raw))code='CONFIGURATION';
    else if(/连接|网络|socket|network|connect/i.test(raw))code='CONNECTION';
    else if(/参数|格式|必填|不能为空|无效|invalid|schema/i.test(raw))code='VALIDATION';
    else code='EXTERNAL_FAILURE';
  }
  const projectedStage = gateway?gateway[1]:previous?previous[1]:stages.has(stage)?stage:'renderer';
  const causeCode=gateway?.[2]??previous?.[3];
  const cause=causeCode&&Object.hasOwn(reasons,causeCode)?`; cause=${causeCode}`:'';
  const suppliedStatus=data.status;
  const providerStatus=/^(?:Model endpoint returned HTTP |Pangu request failed with HTTP )([45]\d\d)$/.exec(raw)?.[1];
  const status=gateway?.[3]??previous?.[4]??cloud?.[2]??providerStatus??(Number.isInteger(suppliedStatus)&&suppliedStatus>=400&&suppliedStatus<=599?String(suppliedStatus):undefined);
  const statusReason=status==='401'?'服务认证失败；请在设置中检查凭据':status==='403'?'服务拒绝访问；请检查账号权限'
    :status==='429'?'服务请求频率或配额受限；请检查配额与限流设置':status&&Number(status)>=500?'上游服务内部异常；请检查服务状态':undefined;
  const previousText=previous?raw.slice(previous[0].length):'';
  const publicMessage=publicErrorMessages.has(raw)?raw:publicErrorMessages.has(previousText)?previousText:undefined;
  const keyword=gateway?.[4]??previous?.[5]??inputValidation?.[1];
  const field=gateway?.[5]??previous?.[6]??inputValidation?.[2];
  const validation=keyword?`; validation=${keyword}${field?`; field=${field}`:''}`:'';
  const validationReason=keyword==='required'?'缺少必填字段':keyword==='type'?'字段类型不符合要求'
    :keyword==='additionalProperties'?'包含工具不支持的额外字段':keyword?'字段未满足工具的数据约束':undefined;
  const identity=typeof data.errorId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.errorId)?data.errorId:
    /\[errorId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\](?: \[cloud:.*\])?$/i.exec(raw)?.[1];
  const cloudReason=cloud?.[5]==='server_error'?'云端服务异常关闭；请检查服务状态':cloud?.[5]==='protocol_error'?'云端连接协议错误；请检查部署与客户端版本'
    :cloud?.[4]?'云端连接已关闭；请检查原请求回执'
    :cloud?.[6]==='ECONNREFUSED'?'云端连接被拒绝；请检查服务地址与运行状态'
    :cloud?.[6]?'云端网络或证书连接失败；请检查网络、证书与服务配置'
    :cloud?.[7]==='RATE_LIMITED'?'云端请求被限流；请检查配额和请求频率'
    :cloud?.[7]&&Object.hasOwn(reasons,cloud[7])?`云端已返回明确失败：${reasons[cloud[7]]}`
    :cloud?.[3]==='wss_ready'?'云端未完成就绪握手；请检查服务协议与部署'
    :cloud?.[3]==='wss_invoke'?'云端请求已发出但未取得确定回执；请核实原操作'
    :cloud?.[3]==='wss_connect'?'云端连接未能建立；请检查网络和服务地址':undefined;
  const text=`[stage=${projectedStage}; code=${code}${cause}${status?`; status=${status}`:''}${validation}] ${publicMessage??reasons[code]}`
    +(cause&&causeCode!==code?`。原因：${reasons[causeCode]}`:'')+(statusReason?`。${statusReason}`:'')
    +(validationReason?`。${validationReason}${field?`：${field}`:''}`:'')
    +(cloudReason?`。${cloudReason}`:'')+(identity?` [errorId=${identity}]`:'')+(cloud?` ${cloud[0]}`:'');
  return {code,message:text};
}
export const errorDisplayText=(error,stage)=>error===''?'':errorDisplay(error,stage).message;
