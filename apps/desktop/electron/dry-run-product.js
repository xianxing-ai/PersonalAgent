import {ProtocolError} from '@personal-agent/contracts';
import {createHash, randomUUID} from 'node:crypto';

const SENSITIVE_KEY_PATTERN = /(password|passphrase|secret|token|api[_-]?key|credential|authorization|cookie|private[_-]?key|session[_-]?key)/i;
const SENSITIVE_VALUE_PATTERN = /(\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bghp_[A-Za-z0-9]{8,})/i;

const TARGET_FIELDS = [
  ['to', '收件人'],
  ['recipient', '收件人'],
  ['recipients', '收件人'],
  ['path', '路径'],
  ['filePath', '路径'],
  ['target', '目标'],
  ['url', '地址'],
  ['calendarId', '日历'],
  ['noteId', '笔记'],
  ['todoId', '待办'],
  ['id', '标识'],
];

const CONTENT_FIELDS = [
  ['subject', '标题'],
  ['title', '标题'],
  ['summary', '摘要'],
  ['text', '内容'],
  ['body', '内容'],
  ['content', '内容'],
  ['message', '内容'],
  ['amount', '金额'],
];

function canonicalJson(item) {
  if (item === null || typeof item !== 'object') return String(JSON.stringify(item));
  if (Array.isArray(item)) return '[' + item.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(item[key])).join(',') + '}';
}

export function hashToolArguments(input) {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed.length ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(normalizeComparableValue).filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

function formatBoundedPreviewValue(key, rawValue, maxLength = 36) {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[已脱敏]';
  const normalized = normalizeComparableValue(rawValue);
  if (!normalized) return undefined;
  if (SENSITIVE_VALUE_PATTERN.test(normalized)) return '[已脱敏]';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function isHighRiskTool(descriptor) {
  if (!descriptor || descriptor.sideEffect === 'read') return false;
  const name = String(descriptor.name ?? '').toLowerCase();
  if (name.includes('reconcile')) return false;
  return descriptor.sideEffect === 'local_write' || descriptor.sideEffect === 'external_write';
}

export function toolDisplayLabel(descriptor) {
  const name = String(descriptor?.name ?? '').toLowerCase();
  if (/(^|[._-])(pay|payment|checkout|transfer)([._-]|$)/.test(name)) return '付款操作';
  if (/(^|[._-])(delete|erase|trash|remove|unlink|rmdir)([._-]|$)/.test(name)) return '删除操作';
  if (/(^|[._-])(send|reply|forward|publish|notify)([._-]|$)/.test(name)) return '发送操作';
  if (name.startsWith('mail.') || name.includes('.mail')) return '邮件写入操作';
  if (name.startsWith('calendar.')) return '日历写入操作';
  if (name.startsWith('workspace.') || name.startsWith('files.') || name.startsWith('file.')) return '文件写入操作';
  if (name.startsWith('notepad.') || name.startsWith('knowledge.') || name.startsWith('wiki.')) return '笔记写入操作';
  if (name.startsWith('todo.')) return '待办写入操作';
  if (name.startsWith('assistant.')) return '助手消息操作';
  return descriptor?.sideEffect === 'local_write' ? '本机写入操作' : '外部写入操作';
}

export function previewToolCall(descriptor, input) {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const keys = Object.keys(record);
  const label = toolDisplayLabel(descriptor);
  const argumentsDigest = hashToolArguments(input);
  let targetSummary;
  let contentSummary;
  const comparableFields = {};

  for (const [field, fieldLabel] of TARGET_FIELDS) {
    if (!(field in record)) continue;
    const comparable = normalizeComparableValue(record[field]);
    if (comparable !== undefined && !SENSITIVE_KEY_PATTERN.test(field) && !SENSITIVE_VALUE_PATTERN.test(comparable)) {
      comparableFields[field] = comparable;
    }
    if (!targetSummary) {
      const formatted = formatBoundedPreviewValue(field, record[field], 40);
      if (formatted) targetSummary = `${fieldLabel}：${formatted}`;
    }
  }

  for (const [field, fieldLabel] of CONTENT_FIELDS) {
    if (!(field in record)) continue;
    const comparable = normalizeComparableValue(record[field]);
    if (comparable !== undefined && !SENSITIVE_KEY_PATTERN.test(field) && !SENSITIVE_VALUE_PATTERN.test(comparable)) {
      comparableFields[field] = comparable;
    }
    if (!contentSummary) {
      const formatted = formatBoundedPreviewValue(field, record[field], 36);
      if (formatted) contentSummary = `${fieldLabel}：${formatted}`;
    }
  }

  if (!targetSummary && !contentSummary && keys.length > 0) {
    const fallbackParts = [];
    for (const key of keys.slice(0, 2)) {
      const formatted = formatBoundedPreviewValue(key, record[key], 24);
      if (formatted) fallbackParts.push(`${key}=${formatted}`);
    }
    if (fallbackParts.length) contentSummary = `参数预览：${fallbackParts.join('，')}`;
  }

  const detailParts = [
    keys.length ? `包含 ${keys.length} 项参数` : '无参数',
    ...(targetSummary ? [targetSummary] : []),
    ...(contentSummary ? [contentSummary] : []),
    ...(keys.length ? [`参数摘要 #${argumentsDigest.slice(0, 8)}`] : []),
  ];

  return {
    id: randomUUID(),
    toolName: descriptor.name,
    label,
    effect: descriptor.sideEffect ?? 'write',
    argumentKeys: keys,
    argumentsDigest,
    ...(targetSummary ? {targetSummary} : {}),
    ...(contentSummary ? {contentSummary} : {}),
    comparableFields,
    summary: `将执行${label}（${detailParts.join('；')}）。尚未产生实际写入或外部副作用。`,
  };
}

export function verifyToolResult(result, preview) {
  if (result == null) return {ok: false, verified: false, scope: 'tool_result', reason: '工具没有返回可核验的结果'};
  if (typeof result === 'object') {
    const state = String(result.state ?? '').toLowerCase();
    const status = String(result.status ?? '').toLowerCase();
    if (
      result.error
      || result.ok === false
      || ['failed', 'pending', 'unknown', 'cancelled', 'cancelling', 'waiting_approval', 'waiting_reconciliation'].includes(state)
      || ['failed', 'pending', 'unknown'].includes(status)
    ) {
      return {ok: false, verified: false, scope: 'tool_result', reason: '操作结果尚未确认或与试运行预览不一致'};
    }
  }
  if (!preview || typeof preview !== 'object' || typeof result !== 'object') {
    return {ok: true, verified: false, scope: 'tool_return_only', reason: '仅收到工具返回，未验证目标与预览一致，也未做外部系统读回'};
  }
  if (result.toolName !== undefined && String(result.toolName) !== String(preview.toolName)) {
    return {ok: false, verified: false, scope: 'tool_result', reason: '工具返回的操作名称与试运行预览不一致'};
  }
  if (result.argumentsDigest !== undefined && String(result.argumentsDigest) !== String(preview.argumentsDigest)) {
    return {ok: false, verified: false, scope: 'tool_result', reason: '工具返回的参数摘要与试运行预览不一致'};
  }
  if (result.previewId !== undefined && String(result.previewId) !== String(preview.id)) {
    return {ok: false, verified: false, scope: 'tool_result', reason: '工具返回的预览标识与试运行预览不一致'};
  }
  const matchedFields = [];
  if (result.toolName !== undefined) matchedFields.push('toolName');
  if (result.argumentsDigest !== undefined) matchedFields.push('argumentsDigest');
  if (result.previewId !== undefined) matchedFields.push('previewId');
  const comparableFields = preview.comparableFields && typeof preview.comparableFields === 'object' ? preview.comparableFields : {};
  for (const [field, expected] of Object.entries(comparableFields)) {
    if (result[field] === undefined) continue;
    const actual = normalizeComparableValue(result[field]);
    if (actual !== expected) {
      return {ok: false, verified: false, scope: 'tool_result', reason: '工具返回的目标或内容与试运行预览不一致'};
    }
    matchedFields.push(field);
  }
  if (matchedFields.length === 0) {
    return {ok: true, verified: false, scope: 'tool_return_only', reason: '仅收到工具返回，未验证目标与预览一致，也未做外部系统读回'};
  }
  return {ok: true, verified: true, scope: 'tool_result_matched', reason: '已按工具返回字段核对目标与试运行预览一致；未做外部系统读回'};
}

/**
 * High-risk tools wait for an explicit preview confirmation before Policy/ToolGateway authorization,
 * and verification rejects pending/unknown/failed or mismatched results without auto-retrying side effects.
 */
export function createDryRunProduct({onUpdate} = {}) {
  const waiting = new Map();
  const confirmedRuns = new Map();
  const recent = [];
  const runKey = (taskId, runId) => taskId && runId ? JSON.stringify([taskId, runId]) : undefined;
  function publish() { try { onUpdate?.(); } catch { /* UI refresh must not change the tool result. */ } }
  function snapshot() {
    return {
      pending: [...waiting.values()].map(item => item.preview),
      recent: recent.slice(-5),
    };
  }
  function waitForPreview(descriptor, input, context) {
    const preview = previewToolCall(descriptor, input);
    let resolve;
    let reject;
    const gate = new Promise((yes, no) => { resolve = yes; reject = no; });
    const deadline = Date.parse(context?.deadline);
    const left = Number.isFinite(deadline) ? deadline - Date.now() : 60_000;
    if (left <= 0) throw new ProtocolError('TIMEOUT', '试运行已超过期限，未执行');
    const timer = setTimeout(() => settle(new ProtocolError('TIMEOUT', '试运行已超过期限，未执行')), left);
    const onAbort = () => settle(new ProtocolError('CANCELLED', '试运行已取消，未执行'));
    context?.signal?.addEventListener?.('abort', onAbort, {once: true});
    function settle(error, value) {
      clearTimeout(timer);
      context?.signal?.removeEventListener?.('abort', onAbort);
      waiting.delete(preview.id);
      publish();
      if (error) reject(error);
      else resolve(value);
    }
    waiting.set(preview.id, {
      preview,
      resolve: () => settle(null, preview),
      reject: reason => settle(new ProtocolError('CANCELLED', reason ?? '试运行已取消，未执行')),
    });
    publish();
    return gate;
  }
  return {
    snapshot,
    async beforeAuthorize({taskId, runId, toolName, sideEffect, arguments: input, deadline, signal}) {
      const descriptor = {name: toolName, sideEffect};
      if (!isHighRiskTool(descriptor)) return;
      const preview = await waitForPreview(descriptor, input, {taskId, runId, deadline, signal});
      const key = runKey(taskId, runId);
      if (key) confirmedRuns.set(key, preview);
    },
    assertAuthorized({taskId, runId, toolName, sideEffect, arguments: input, argumentsDigest}) {
      if (!isHighRiskTool({name: toolName, sideEffect})) return;
      const key = runKey(taskId, runId);
      const confirmed = key ? confirmedRuns.get(key) : undefined;
      if (!confirmed) {
        throw new ProtocolError('UNAUTHORIZED', '请先确认试运行预览');
      }
      if (confirmed.toolName !== toolName) {
        throw new ProtocolError('UNAUTHORIZED', '试运行确认的工具与实际执行不一致');
      }
      if (input !== undefined && confirmed.argumentsDigest !== hashToolArguments(input)) {
        throw new ProtocolError('UNAUTHORIZED', '试运行确认的参数与实际执行不一致');
      }
      if (argumentsDigest !== undefined && confirmed.argumentsDigest !== argumentsDigest) {
        throw new ProtocolError('UNAUTHORIZED', '试运行确认的参数摘要与实际执行不一致');
      }
    },
    wrapTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          if (!isHighRiskTool(tool.descriptor)) return tool.execute(input, context);
          const key = runKey(context?.taskId, context?.runId);
          let preview = key ? confirmedRuns.get(key) : undefined;
          if (key && preview) confirmedRuns.delete(key);
          if (preview) {
            if (preview.toolName !== tool.descriptor.name || preview.argumentsDigest !== hashToolArguments(input)) {
              throw new ProtocolError('UNAUTHORIZED', '试运行确认的参数与实际执行不一致，已拒绝执行');
            }
          } else {
            preview = await waitForPreview(tool.descriptor, input, context);
          }
          const result = await tool.execute(input, context);
          const verification = verifyToolResult(result, preview);
          recent.push({
            id: preview.id,
            toolName: preview.toolName,
            label: preview.label,
            ...(preview.targetSummary ? {targetSummary: preview.targetSummary} : {}),
            ...verification,
            at: new Date().toISOString(),
          });
          if (!verification.ok) {
            const error = new ProtocolError('RESULT_UNKNOWN', `${verification.reason}。操作可能已经发生，不会自动重试`);
            throw error;
          }
          return result;
        },
      }));
    },
    handleAction(name, payload) {
      if (name === 'dryRun.state') {
        if (payload !== undefined) throw Error('试运行状态不接受参数');
        return snapshot();
      }
      if (name === 'dryRun.confirm') {
        if (!payload || Object.keys(payload).some(key => key !== 'id') || typeof payload.id !== 'string') throw Error('试运行确认无效');
        const pending = waiting.get(payload.id);
        if (!pending) throw Error('没有这项试运行');
        pending.resolve();
        return snapshot();
      }
      if (name === 'dryRun.cancel') {
        if (!payload || Object.keys(payload).some(key => key !== 'id') || typeof payload.id !== 'string') throw Error('取消试运行参数无效');
        const pending = waiting.get(payload.id);
        if (!pending) throw Error('没有这项试运行');
        pending.reject('试运行已取消，未执行');
        return snapshot();
      }
      throw Error('不支持的试运行操作');
    },
  };
}
