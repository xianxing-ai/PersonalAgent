import {
  externalEffectDecision,
  externalKindForTool,
  externalKindLabel,
  fenceExternalValue,
  guardedEffectForTool,
  guardedEffectLabel,
} from '@personal-agent/policy';

/**
 * Competition startup wraps the tools already assembled for the runtime.
 * The fence is applied to results; send, delete and payment still use Policy.
 */
export function createContentFenceProduct({readGoal} = {}) {
  const sources = [];
  const seen = new Map();
  let blocked = null;
  const goalFor = taskId => {
    try { return readGoal?.(taskId) ?? ''; }
    catch { return ''; }
  };
  return {
    wrapTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          const name = tool.descriptor?.name ?? '';
          const effect = guardedEffectForTool(name, tool.descriptor?.sideEffect);
          const taskId = context?.taskId;
          if (effect && taskId && seen.get(taskId)?.external === true) {
            const decision = externalEffectDecision({effect, userGoal: goalFor(taskId), sawExternal: true});
            if (!decision.allowed) {
              blocked = {effect, reason: decision.reason, at: new Date().toISOString()};
              const error = Error(decision.reason);
              error.code = 'SCOPE_DENIED';
              throw error;
            }
          }
          const result = await tool.execute(input, context);
          if (taskId) {
            const kind = externalKindForTool(name);
            const fenced = fenceExternalValue(result, tool.descriptor?.outputSchema, {kind, ref: name});
            seen.set(taskId, {external: true});
            for (const source of fenced.sources) {
              sources.push({id: source.id, kind: source.kind, ref: source.ref, sha256: source.sha256, taskId, at: new Date().toISOString()});
            }
            if (sources.length > 40) sources.splice(0, sources.length - 40);
            return fenced.value;
          }
          return result;
        },
      }));
    },
    snapshot() {
      return {
        sources: sources.map(source => ({id: source.id, kind: source.kind, ref: source.ref, label: externalKindLabel(source.kind)})),
        blocked: blocked?.reason ?? '',
        blockedLabel: blocked ? guardedEffectLabel(blocked.effect) : '',
      };
    },
    handleAction(name, payload) {
      if (name !== 'contentFence.state') throw Error('不支持的围栏操作');
      if (payload !== undefined) throw Error('围栏状态不接受参数');
      return this.snapshot();
    },
  };
}
