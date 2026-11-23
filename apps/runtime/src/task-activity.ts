/** Runtime-owned activity. These are not frozen protocol events: token deltas stay off the task snapshot. */

export const TRANSCRIPT_CHECKPOINT = 'task-transcript:v1';
export const INJECTION_CHECKPOINT = 'user-injections:v1';

export type TaskActivityKind = 'reasoning' | 'tool_call' | 'tool_result' | 'answer_delta' | 'user_injection' | 'child_summary';

export interface TaskActivityInput {
  kind: TaskActivityKind;
  stepId: string;
  label?: string;
  text?: string;
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  durationMs?: number;
}

export interface TaskActivityEvent extends TaskActivityInput {
  taskId: string;
  sequence: number;
  label: string;
  occurredAt: string;
}

export interface TranscriptSegment {
  id: string;
  kind: 'reasoning' | 'tool' | 'answer' | 'user' | 'summary';
  stepId: string;
  label: string;
  text: string;
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  durationMs?: number;
  startedAt: string;
  updatedAt: string;
}

export interface TaskTranscript {
  version: '1.0';
  segments: TranscriptSegment[];
  updatedAt: string;
}

export interface UserInjection {
  id: string;
  text: string;
  source: 'user' | 'peer' | 'parent';
  requestId?: string;
  at: string;
}

const SECRET = /(?:bearer\s+)[a-z0-9._\-]{8,}|(?:sk|rk|pk)-[a-z0-9_\-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi;

export function redactSecrets(value: string): string {
  return value.replace(SECRET, match => match.toLowerCase().startsWith('bearer') ? 'Bearer [密钥已隐藏]' : '[密钥已隐藏]');
}

export function summarizeValue(value: unknown, max = 180): string {
  let text = '';
  try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; }
  catch { text = '[无法显示]'; }
  text = redactSecrets(text);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const FAILURES: Record<string, string> = {
  TIMEOUT: '这一步超时了，可以稍后再试。',
  CANCELLED: '已停止。',
  UNAUTHORIZED: '没有通过授权，这次没有继续执行。',
  SCOPE_DENIED: '当前权限不够，这次没有执行。',
  UNSUPPORTED_CAPABILITY: '当前环境还不支持这一步。',
  EXTERNAL_FAILURE: '外部服务没有成功返回，可以稍后再试。',
  RESULT_UNKNOWN: '结果还不能确定，需要先核对，不会自动重做。',
  REVISION_CONFLICT: '原来的记录已经变了，请刷新后再试。',
  NOT_FOUND: '找不到对应的记录。',
  INVALID_ARGUMENT: '这条请求的内容不符合要求。',
  RATE_LIMITED: '请求太频繁或额度不够，请稍后再试。',
  PROTOCOL_MISMATCH: '两边的版本对不上，这次没有执行。',
};

export function publicFailureMessage(code: string | undefined, message: string | undefined): string {
  const cleaned = redactSecrets(message ?? '').trim();
  if (code && FAILURES[code]) return FAILURES[code];
  if (cleaned && /[\u4e00-\u9fff]/.test(cleaned) && !/密钥已隐藏|bearer|sk-|api[_-]?key|secret|password|token/i.test(cleaned)) {
    return cleaned.slice(0, 240);
  }
  return '这次没有完成，请稍后再试。';
}

function labelFor(input: TaskActivityInput): string {
  if (input.label?.trim()) return input.label.trim();
  if (input.kind === 'reasoning') return '思考';
  if (input.kind === 'tool_call') return input.toolName ? `正在调用 ${input.toolName}` : '正在调用工具';
  if (input.kind === 'tool_result') return input.toolName ? `${input.toolName} 已返回` : '工具已返回';
  if (input.kind === 'answer_delta') return '回答';
  if (input.kind === 'user_injection') return '插话';
  return '子助手结论';
}

function segmentKind(kind: TaskActivityKind): TranscriptSegment['kind'] {
  if (kind === 'reasoning') return 'reasoning';
  if (kind === 'tool_call' || kind === 'tool_result') return 'tool';
  if (kind === 'answer_delta') return 'answer';
  if (kind === 'user_injection') return 'user';
  return 'summary';
}

export function emptyTranscript(now: string): TaskTranscript {
  return {version: '1.0', segments: [], updatedAt: now};
}

export function parseTranscript(value: unknown): TaskTranscript | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as {version?: unknown; segments?: unknown; updatedAt?: unknown};
  if (record.version !== '1.0' || !Array.isArray(record.segments)) return undefined;
  return {version: '1.0', segments: record.segments as TranscriptSegment[], updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''};
}

/** Coalesce deltas into the open segment. Tool results fill the matching call. */
export function applyTranscript(current: TaskTranscript, event: TaskActivityEvent): TaskTranscript {
  const segments = current.segments.map(segment => ({...segment}));
  const kind = segmentKind(event.kind);
  const text = redactSecrets(event.text ?? '');
  const last = segments[segments.length - 1];
  if ((kind === 'reasoning' || kind === 'answer') && last && last.kind === kind && last.stepId === event.stepId) {
    last.text += text;
    last.updatedAt = event.occurredAt;
  } else if (event.kind === 'tool_result') {
    const tool = [...segments].reverse().find(segment => segment.kind === 'tool' && segment.stepId === event.stepId && segment.resultSummary === undefined);
    if (tool) {
      tool.resultSummary = redactSecrets(event.resultSummary ?? text);
      if (typeof event.durationMs === 'number') tool.durationMs = event.durationMs;
      tool.updatedAt = event.occurredAt;
      tool.label = event.label;
    } else {
      segments.push(segmentFrom(event, text));
    }
  } else {
    segments.push(segmentFrom(event, text));
  }
  return {version: '1.0', segments, updatedAt: event.occurredAt};
}

function segmentFrom(event: TaskActivityEvent, text: string): TranscriptSegment {
  return {
    id: String(event.sequence),
    kind: segmentKind(event.kind),
    stepId: event.stepId,
    label: event.label,
    text,
    ...(event.toolName ? {toolName: event.toolName} : {}),
    ...(event.argsSummary ? {argsSummary: redactSecrets(event.argsSummary)} : {}),
    ...(event.resultSummary ? {resultSummary: redactSecrets(event.resultSummary)} : {}),
    ...(typeof event.durationMs === 'number' ? {durationMs: event.durationMs} : {}),
    startedAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
}

export function activityEvent(taskId: string, sequence: number, occurredAt: string, input: TaskActivityInput): TaskActivityEvent {
  return {
    taskId,
    sequence,
    occurredAt,
    kind: input.kind,
    stepId: input.stepId,
    label: labelFor(input),
    ...(input.text ? {text: redactSecrets(input.text)} : {}),
    ...(input.toolName ? {toolName: input.toolName} : {}),
    ...(input.argsSummary ? {argsSummary: redactSecrets(input.argsSummary)} : {}),
    ...(input.resultSummary ? {resultSummary: redactSecrets(input.resultSummary)} : {}),
    ...(input.durationMs !== undefined ? {durationMs: input.durationMs} : {}),
  };
}
