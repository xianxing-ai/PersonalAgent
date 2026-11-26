import {ProtocolError} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';
import {
  externalEffectDecision,
  externalKindForTool,
  externalKindLabel,
  fenceExternalValue,
  guardedEffectForTool,
  guardedEffectLabel,
  isLocalReadOnlyTool,
} from '@personal-agent/policy';

/**
 * Competition startup checks the fence before ToolGateway consumes Policy grants,
 * and fences external tool results without tainting tasks on local read-only tools.
 */
export function createContentFenceProduct({readGoal,restrictBrowserRead} = {}) {
  const sources = [];
  const seen = new Map();
  let blocked = null;
  const goalFor = taskId => {
    try { return readGoal?.(taskId) ?? ''; }
    catch { return ''; }
  };
  const beforeAuthorize = scope => {
    const {taskId,toolName,toolVersion,sideEffect}=scope;
    const effect = guardedEffectForTool(toolName ?? '', sideEffect);
    if (!effect || !taskId || seen.get(taskId)?.external !== true) return;
    // The Playwright host pins the original run, document and control, and enforces a GET-only navigation
    // or the original media element's play method. A descriptor called "click" alone grants nothing.
    if(toolName==='browser.click'&&toolVersion==='1.0.0'){
      if(restrictBrowserRead?.(scope)===true)return;
      if(scope.arguments?.mediaAction==='play'){
        const reason='请确认原用户请求了播放，且该音视频仍在刚观察到的页面中。';
        blocked={effect,reason,at:new Date().toISOString()};
        throw new ProtocolError('SCOPE_DENIED',reason);
      }
    }
    const decision = externalEffectDecision({effect, userGoal: goalFor(taskId), sawExternal: true});
    if (decision.allowed) return;
    blocked = {effect, reason: decision.reason, at: new Date().toISOString()};
    throw new ProtocolError('SCOPE_DENIED', decision.reason);
  };
  return {
    beforeAuthorize,
    clearTask(taskId) {
      if (taskId) seen.delete(taskId);
    },
    hasExternal(taskId) {
      return Boolean(taskId && seen.get(taskId)?.external === true);
    },
    wrapTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          const name = tool.descriptor?.name ?? '';
          const sideEffect = tool.descriptor?.sideEffect;
          const taskId = context?.taskId;
          beforeAuthorize({...context,toolName:name,toolVersion:tool.descriptor?.version,sideEffect,arguments:input});
          const result = await tool.execute(input, context);
          // This exact trusted empty-session response has no page, URL, text, or controls.
          // It does not add an external source or clear a previous one.
          if(name==='browser.observe'&&tool.descriptor?.version==='1.0.0'&&
            isDeepStrictEqual(result,{source:'playwright',state:'no_page',nextTool:'browser.open',goalVerified:false}))return result;
          if (taskId && !isLocalReadOnlyTool(name, sideEffect)) {
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
