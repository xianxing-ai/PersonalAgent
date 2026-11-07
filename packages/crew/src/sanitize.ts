/**
 * 敏感信息脱敏：驱动协议与对端返回的内容（错误原文、结果文本）在进入错误信息
 * 与回执前统一过一遍。键名匹配凭据类字样（token/key/secret/authorization/
 * bearer/cookie/password）的键值对，以及 Bearer / sk- / 长 base64 样式的值，
 * 一律替换为 `[已脱敏]`；其余内容原样保留。
 */

const SENSITIVE_KEY = /[\w-]*(token|secret|authorization|bearer|cookie|password|apikey|api_key|key)[\w-]*/i;
const SENSITIVE_KEY_VALUE = new RegExp(
  `(${SENSITIVE_KEY.source}\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;}&]+)`,
  'gi',
);
const BEARER_VALUE = /(Bearer\s+)[^\s,;}&]+/gi;
const SK_VALUE = /\bsk-[A-Za-z0-9_-]{8,}/g;
const LONG_TOKENISH = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

const REDACTED = '[已脱敏]';

/** 对一段文本做键值与凭据样式脱敏；返回净化后的文本。 */
export function redactSensitiveText(text: string): string {
  let out = text.replace(SENSITIVE_KEY_VALUE, (_match, prefix: string, value: string) => {
    // 键名本身保留（诊断仍能看到哪个字段），只去掉值（含引号包裹形式）。
    const stripped = value.replace(/^["']|["']$/g, '');
    if (!stripped) return `${prefix}${REDACTED}`;
    return `${prefix}${REDACTED}`;
  });
  out = out.replace(BEARER_VALUE, `$1${REDACTED}`);
  out = out.replace(SK_VALUE, REDACTED);
  out = out.replace(LONG_TOKENISH, REDACTED);
  return out;
}

/** 判断一个键名是否属于凭据类字段。 */
export function isSensitiveKeyName(name: string): boolean {
  return SENSITIVE_KEY.test(name);
}

/** 对端对象的诊断描述：只保留顶层字段名列表，不序列化任何值。 */
export function describeObjectFields(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const names = Object.keys(value as Record<string, unknown>);
    return names.length ? `字段：${names.join(', ')}` : '（空对象）';
  }
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  return typeof value;
}
