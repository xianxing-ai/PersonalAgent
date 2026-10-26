import {errorDisplay} from '../src/shared/error-display.js';

const messages={ENOENT:'电脑组件文件不存在',EACCES:'系统拒绝访问电脑组件',EPERM:'系统策略拒绝操作',
  UNSUPPORTED_CAPABILITY:'此设备缺少所需组件或能力',PROTOCOL_MISMATCH:'电脑组件协议或版本不兼容',
  TARGET_STALE:'目标窗口、控件或显示比例已经变化',TARGET_AMBIGUOUS:'无法唯一确定操作目标',
  USER_TAKEOVER:'检测到用户接管，已停止后续输入',UNAUTHORIZED:'当前目标或访问范围未获有效许可',
  REVISION_CONFLICT:'另一个电脑操作正在使用输入设备',CANCELLED:'用户或原任务已取消操作',TIMEOUT:'操作超过原任务期限',
  RESULT_UNKNOWN:'操作可能已经发生，原结果需要核实',EXTERNAL_FAILURE:'电脑组件执行或读回失败'};
// Match PR511's own-data boundary: exception accessors, prototypes and coercion
// hooks are not diagnostic data. Read nothing else (cause, body, stack, etc.).
function errorData(error){
  try{
    if(!error||typeof error!=='object')return {};
    const data={};
    for(const key of ['code','message','stage']){
      const descriptor=Object.getOwnPropertyDescriptor(error,key);
      if(!descriptor)continue;
      if(!Object.hasOwn(descriptor,'value'))return {};
      data[key]=descriptor.value;
    }
    return data;
  }catch{return {};}
}

/** Keep the fault's actual explanation; replace only labelled private fragments. */
function redactMessage(message){
  return message
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,'[凭据已遮蔽]')
    .replace(/\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/giu,'$1[凭据已遮蔽]')
    .replace(/\bsk-[\w-]{8,}/gu,'[凭据已遮蔽]')
    .replace(/(?:\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|authorization|password|secret|cookie|set-cookie)|("?(?:密钥|密码|令牌)"?))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,&;，；]+)/giu,(_all,key,chinese,separator)=>`${key??chinese}${separator}[凭据已遮蔽]`)
    .replace(/(?:\b((?:response[ _-]?|request[ _-]?|email[ _-]?)?body|content|text|prompt|stdout|stderr|html|page[_-]?text|window[_-]?text)|((?:邮件)?正文))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;；][^;；\r\n]*)/giu,(_all,key,chinese,separator)=>`${key??chinese}${separator}[正文已遮蔽]`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,'$1[凭据已遮蔽]@')
    .replace(/\bfile:\/\/[^\s"'<>，；。！？,;)\]}]+/giu,'[路径已遮蔽]')
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n]*?\1/gu,'[路径已遮蔽]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]')
    .replace(/\\\\[^\s\\]+\\[^\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]')
    .replace(/(?<![:/\w])\/(?:[^/\s"'<>，；。！？,;)\]}]+\/)*[^/\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]');
}

/** A technical failure keeps its code, stage and safe detail; it is never recast as lack of consent. */
export function computerControlFailure(error,stage){
  const data=errorData(error),code=data.code;
  const known=typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'EXTERNAL_FAILURE';
  const suppliedStage=stage??data.stage;
  const safeStage=typeof suppliedStage==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(suppliedStage)?suppliedStage:'unknown';
  const raw=typeof error==='string'?error:typeof data.message==='string'?data.message:'';
  // PR511 already supplies reviewed code-specific fallbacks. Only use them when
  // there is no original explanation; its classifier intentionally drops raw text.
  const fallback=messages[known]??errorDisplay({code:known},'ipc').message.replace(/\s*\[stage=ipc; code=[A-Z_]+\]\s*$/u,'');
  return {code:known,stage:safeStage,message:raw.trim()?redactMessage(raw):fallback,retryable:false};
}
