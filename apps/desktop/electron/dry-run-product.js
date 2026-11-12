import {randomUUID} from 'node:crypto';

const EFFECT = /(^|[._-])(pay|payment|checkout|transfer|delete|erase|trash|remove|send|reply|forward|publish)([._-]|$)/;

export function isHighRiskTool(descriptor) {
  if (!descriptor || descriptor.sideEffect === 'read') return false;
  const name = String(descriptor.name ?? '').toLowerCase();
  if (name.includes('reconcile')) return false;
  return descriptor.sideEffect === 'external_write' || EFFECT.test(name);
}

export function previewToolCall(descriptor, input) {
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : [];
  return {
    id: randomUUID(),
    toolName: descriptor.name,
    effect: descriptor.sideEffect ?? 'write',
    argumentKeys: keys,
    summary: `将执行 ${descriptor.name}，参数字段 ${keys.length ? keys.join('、') : '无'}。尚未产生外部副作用。`,
  };
}

export function verifyToolResult(result) {
  if (result == null) return {ok: false, scope: 'tool_result', reason: '工具没有返回可核验的结果'};
  if (typeof result === 'object' && (result.error || result.ok === false || result.state === 'failed')) {
    return {ok: false, scope: 'tool_result', reason: '结果与试运行预览不一致'};
  }
  return {ok: true, scope: 'tool_result', reason: '已核对工具返回与预览的操作一致；未做外部系统读回'};
}

/**
 * High-risk tools wait for an explicit preview confirmation, then the original tool runs.
 * Verification checks the tool result only. It does not read an external system back.
 */
export function createDryRunProduct({onUpdate} = {}) {
  const waiting = new Map();
  const recent = [];
  function publish() { try { onUpdate?.(); } catch { /* UI refresh must not change the tool result. */ } }
  function snapshot() {
    return {
      pending: [...waiting.values()].map(item => item.preview),
      recent: recent.slice(-5),
    };
  }
  return {
    snapshot,
    wrapTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          if (!isHighRiskTool(tool.descriptor)) return tool.execute(input, context);
          const preview = previewToolCall(tool.descriptor, input);
          let resolve;
          let reject;
          const gate = new Promise((yes, no) => { resolve = yes; reject = no; });
          const deadline = Date.parse(context?.deadline);
          const left = Number.isFinite(deadline) ? deadline - Date.now() : 60_000;
          if (left <= 0) throw Error('试运行已超过期限，未执行');
          const timer = setTimeout(() => settle(Error('试运行已超过期限，未执行')), left);
          const onAbort = () => settle(Error('试运行已取消，未执行'));
          context?.signal?.addEventListener?.('abort', onAbort, {once: true});
          function settle(error, value) {
            clearTimeout(timer);
            context?.signal?.removeEventListener?.('abort', onAbort);
            waiting.delete(preview.id);
            publish();
            if (error) reject(error);
            else resolve(value);
          }
          waiting.set(preview.id, {preview, resolve: () => settle(null, 'run')});
          publish();
          await gate;
          const result = await tool.execute(input, context);
          const verification = verifyToolResult(result);
          recent.push({id: preview.id, toolName: preview.toolName, ...verification, at: new Date().toISOString()});
          if (!verification.ok) {
            const error = Error(`${verification.reason}。操作可能已经发生，不会自动重试`);
            error.code = 'RESULT_UNKNOWN';
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
      throw Error('不支持的试运行操作');
    },
  };
}
