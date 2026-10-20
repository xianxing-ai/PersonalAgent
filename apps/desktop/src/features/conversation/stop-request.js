/**
 * A short, whole-message stop instruction. Deliberately strict: only an utterance that is
 * nothing but a stop word is treated as "叫停", so "停止条件是什么" or "取消订单后怎么办"
 * still reach the model as ordinary questions.
 */
const STOP_PHRASES = new Set([
  '停', '停下', '停止', '停下来', '停止执行', '停止任务', '别做了', '别执行了', '不用了',
  '取消', '取消任务', '取消执行', '结束', '结束任务', '中止', '中断',
  'stop', 'stop it', 'stop now', 'cancel', 'abort', 'halt',
]);

export function isStopRequest(text) {
  if (typeof text !== 'string') return false;
  // Strip wrapping punctuation/space that a chat message normally carries.
  const normalized = text.trim().replace(/[\s。.!！?？~～,，、；;]+$/u, '').replace(/^[\s。.!！?？~～,，、；;]+/u, '');
  return STOP_PHRASES.has(normalized.toLowerCase());
}
