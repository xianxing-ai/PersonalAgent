import {ProtocolError} from '@personal-agent/contracts';
import {randomUUID} from 'node:crypto';

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
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : [];
  const label = toolDisplayLabel(descriptor);
  return {
    id: randomUUID(),
    toolName: descriptor.name,
    label,
    effect: descriptor.sideEffect ?? 'write',
    argumentKeys: keys,
    summary: `将执行${label}（${keys.length ? `包含 ${keys.length} 项参数` : '无参数'}）。尚未产生实际写入或外部副作用。`,
  };
}

export function verifyToolResult(result) {
  if (result == null) return {ok: false, scope: 'tool_result', reason: '工具没有返回可核验的结果'};
  if (typeof result === 'object') {
    const state = String(result.state ?? '').toLowerCase();
    const status = String(result.status ?? '').toLowerCase();
    if (
      result.error
      || result.ok === false
      || ['failed', 'pending', 'unknown', 'cancelled', 'cancelling', 'waiting_approval', 'waiting_reconciliation'].includes(state)
      || ['failed', 'pending', 'unknown'].includes(status)
    ) {
      return {ok: false, scope: 'tool_result', reason: '操作结果尚未确认或与试运行预览不一致'};
    }
  }
  return {ok: true, scope: 'tool_result', reason: '已核对工具返回与预览的操作一致；未做外部系统读回'};
}

/**
 * High-risk tools wait for an explicit preview confirmation before Policy/ToolGateway authorization,
 * and verification rejects pending/unknown/failed results without auto-retrying side effects.
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
    assertAuthorized({taskId, runId, toolName, sideEffect}) {
      if (!isHighRiskTool({name: toolName, sideEffect})) return;
      const key = runKey(taskId, runId);
      if (!key || !confirmedRuns.has(key)) {
        throw new ProtocolError('UNAUTHORIZED', '请先确认试运行预览');
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
          if (!preview) preview = await waitForPreview(tool.descriptor, input, context);
          const result = await tool.execute(input, context);
          const verification = verifyToolResult(result);
          recent.push({id: preview.id, toolName: preview.toolName, label: preview.label, ...verification, at: new Date().toISOString()});
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
