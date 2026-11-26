/** One answer block for the panel, the workspace and an assistant thread. */
import {browserExcerptReply} from './result-text.js';

export const DISPATCH_ACK = '已收到，已派发子智能体在后台处理；你可以继续和我聊天，完成后我会把结果发给你。';

export function emptyLive() {
  return {reasoning: '', answer: '', steps: [], summary: '', startedAt: Date.now(), updatedAt: Date.now(), openDisclosures: new Set()};
}

function stepDisclosureKey(step, index) {
  return typeof step?.stepId === 'string' && step.stepId.length > 0 ? `step:${step.stepId}` : `step-index:${index}`;
}

export function rememberActivity(store, event) {
  if (!event || typeof event.taskId !== 'string') return undefined;
  const current = store.get(event.taskId) ?? emptyLive();
  const now = Date.now();
  if (!current.startedAt) current.startedAt = now;
  current.updatedAt = now;
  if (event.kind === 'reasoning' || event.kind === 'reasoning_summary') current.reasoning += event.text ?? '';
  else if (event.kind === 'answer_delta') current.answer += event.text ?? '';
  else if (event.kind === 'tool_call') {
    const existing = typeof event.stepId === 'string' && event.stepId.length > 0
      ? [...current.steps].reverse().find(item => item.stepId === event.stepId && item.unmatchedCall)
      : undefined;
    if (existing) {
      existing.label = event.label || existing.label;
      existing.toolName = event.toolName || existing.toolName;
      existing.argsSummary = event.argsSummary;
      delete existing.unmatchedCall;
    } else {
      current.steps.push({stepId: event.stepId, label: event.label, toolName: event.toolName, argsSummary: event.argsSummary, state: 'running'});
    }
  } else if (event.kind === 'tool_result') {
    if (typeof event.stepId === 'string' && event.stepId.length > 0) {
      const step = [...current.steps].reverse().find(item => item.stepId === event.stepId && item.state === 'running')
        ?? [...current.steps].reverse().find(item => item.stepId === event.stepId);
      if (step) {
        step.resultSummary = event.resultSummary;
        step.durationMs = event.durationMs;
        step.state = 'completed';
        step.label = event.label || step.label;
      } else {
        current.steps.push({
          stepId: event.stepId,
          label: event.label,
          toolName: event.toolName,
          resultSummary: event.resultSummary,
          durationMs: event.durationMs,
          state: 'completed',
          unmatchedCall: true,
        });
      }
    }
  } else if (event.kind === 'child_summary' || event.kind === 'user_injection') current.summary = event.text ?? current.summary;
  store.set(event.taskId, current);
  return current;
}

export function liveFromTranscript(transcript) {
  const live = emptyLive();
  for (const segment of transcript?.segments ?? []) {
    if (segment.kind === 'reasoning' || segment.kind === 'reasoning_summary') live.reasoning += segment.text ?? '';
    else if (segment.kind === 'answer') live.answer += segment.text ?? '';
    else if (segment.kind === 'tool') live.steps.push({stepId: segment.stepId, label: segment.label, toolName: segment.toolName, argsSummary: segment.argsSummary, resultSummary: segment.resultSummary, durationMs: segment.durationMs, state: segment.resultSummary ? 'completed' : 'running'});
    else if (segment.kind === 'summary') live.summary = segment.text ?? live.summary;
    if (segment.startedAt) live.startedAt = Date.parse(segment.startedAt) || live.startedAt;
    if (segment.updatedAt) live.updatedAt = Date.parse(segment.updatedAt) || live.updatedAt;
  }
  return live;
}

function formatElapsed(live, freeze = false) {
  if (!live?.startedAt) return '';
  const end = freeze && live.updatedAt ? live.updatedAt : Date.now();
  const totalSeconds = Math.max(1, Math.round((end - live.startedAt) / 1000));
  if (totalSeconds < 60) return ` · ${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const rem = totalSeconds % 60;
  return rem > 0 ? ` · ${minutes}m ${rem}s` : ` · ${minutes}m`;
}

function activePhaseLabel(task) {
  if (task?.state === 'planning') return '思考中';
  if (task?.state === 'verifying') return '验证中';
  if (task?.state === 'waiting_approval') return '等待授权';
  if (task?.state === 'waiting_external') return '等待外部结果';
  if (task?.state === 'cancelling') return '正在取消';
  return '执行中';
}

const STEP_LOGO_SVGS = {
  term: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 5 6.5 8 3.5 11"/><line x1="8.5" y1="11" x2="12.5" y2="11"/></svg>',
  search: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="13.5" y2="13.5"/></svg>',
  file: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5h4.5l3 3v8h-7.5z"/><polyline points="9 2.5 9 5.5 12 5.5"/></svg>',
  mail: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><polyline points="2.5 4.5 8 8.8 13.5 4.5"/></svg>',
  cal: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><line x1="5.5" y1="2" x2="5.5" y2="4.5"/><line x1="10.5" y1="2" x2="10.5" y2="4.5"/><line x1="2.5" y1="7" x2="13.5" y2="7"/></svg>',
  cloud: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.8 12h6.8a2.4 2.4 0 0 0 .3-4.8A3.6 3.6 0 0 0 5 6.4 2.8 2.8 0 0 0 4.8 12Z"/></svg>',
  sys: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="3" width="11.6" height="8" rx="1.4"/><line x1="5.5" y1="13" x2="10.5" y2="13"/></svg>',
  tool: '<svg class="trace-logo-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4"/></svg>',
};

const HEAD_ICON_SVGS = {
  think: '<svg class="trace-head-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4 4l1.1 1.1M10.9 10.9 12 12M12 4l-1.1 1.1M5.1 10.9 4 12"/><circle cx="8" cy="8" r="2.2"/></svg>',
  process: '<svg class="trace-head-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="4.2" r="1.4"/><line x1="7" y1="4.2" x2="13.2" y2="4.2"/><circle cx="4" cy="8" r="1.4"/><line x1="7" y1="8" x2="13.2" y2="8"/><circle cx="4" cy="11.8" r="1.4"/><line x1="7" y1="11.8" x2="11.2" y2="11.8"/></svg>',
};

const EXT_LOGOS = {
  js: {kind: 'js', text: 'JS'},
  mjs: {kind: 'js', text: 'JS'},
  cjs: {kind: 'js', text: 'JS'},
  ts: {kind: 'ts', text: 'TS'},
  tsx: {kind: 'ts', text: 'TS'},
  jsx: {kind: 'jsx', text: 'JSX'},
  css: {kind: 'css', text: 'CSS'},
  scss: {kind: 'css', text: 'CSS'},
  html: {kind: 'html', text: 'HTML'},
  json: {kind: 'json', text: '{}'},
  md: {kind: 'md', text: 'MD'},
  py: {kind: 'py', text: 'PY'},
  sql: {kind: 'sql', text: 'DB'},
  sqlite: {kind: 'sql', text: 'DB'},
  sh: {kind: 'sh', text: '&gt;_'},
  ps1: {kind: 'sh', text: '&gt;_'},
  cmd: {kind: 'sh', text: '&gt;_'},
};

export function describeTraceStepLogo(step) {
  const haystack = `${step?.argsSummary ?? ''} ${step?.label ?? ''} ${step?.toolName ?? ''}`;
  const extMatch = /[\w.-]+\.(tsx|ts|jsx|mjs|cjs|js|scss|css|html|json|md|py|sqlite|sql|ps1|cmd|sh)(?=$|[^a-z0-9_])/iu.exec(haystack);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    if (Object.hasOwn(EXT_LOGOS, ext)) return {...EXT_LOGOS[ext]};
  }
  const lower = haystack.toLowerCase();
  if (/(exec|run|shell|cmd|command|terminal|npm|node|test|build|git|运行|命令|测试|构建)/u.test(lower)) return {kind: 'term', svg: STEP_LOGO_SVGS.term};
  if (/(search|find|grep|glob|list|scan|knowledge|memory|wiki|vault|搜索|检索|扫描|查找)/u.test(lower)) return {kind: 'search', svg: STEP_LOGO_SVGS.search};
  if (/(fs\.|file|workspace|patch|edit|read|write|config|读取|写入|修改|编辑|配置|文件|目录)/u.test(lower)) return {kind: 'file', svg: STEP_LOGO_SVGS.file};
  if (/(mail|imap|邮件|邮箱)/u.test(lower)) return {kind: 'mail', svg: STEP_LOGO_SVGS.mail};
  if (/(calendar|todo|briefing|schedule|日程|待办|简报|提醒)/u.test(lower)) return {kind: 'cal', svg: STEP_LOGO_SVGS.cal};
  if (/(workflow|agentarts|cloud|http|fetch|web|feed|weather|subagent|shadow_preview|智能体|云端|影子)/u.test(lower)) return {kind: 'cloud', svg: STEP_LOGO_SVGS.cloud};
  if (/(computer|notepad|screen|window|desktop|电脑|桌面|窗口)/u.test(lower)) return {kind: 'sys', svg: STEP_LOGO_SVGS.sys};
  return {kind: 'tool', svg: STEP_LOGO_SVGS.tool};
}

function traceLogoHtml(logo) {
  return `<span class="trace-logo" data-logo="${logo.kind}" aria-hidden="true">${logo.svg ?? logo.text}</span>`;
}

function traceHeadIconHtml(kind) {
  return HEAD_ICON_SVGS[kind] ?? '';
}

export function describeTraceStepVerb(step) {
  const state = step?.state || 'running';
  if (state === 'waiting_approval') return '待确认';
  if (state === 'failed' || state === 'denied' || state === 'cancelled') return '失败';
  const running = !isTraceStepTerminal(state);
  const text = `${step?.toolName ?? ''} ${step?.label ?? ''}`.toLowerCase();
  if (/(search|find|grep|glob|list|scan|query|搜索|检索|扫描|查找|查询)/u.test(text)) return running ? '检索中' : '检索';
  if (/(write|edit|patch|create|save|update|delete|remove|写入|修改|编辑|保存|更新|删除)/u.test(text)) return running ? '修改中' : '修改';
  if (/(exec|run|shell|cmd|command|test|build|运行|命令|测试|构建)/u.test(text)) return running ? '运行中' : '运行';
  if (/(read|inspect|get|load|fetch|open|analyze|读取|查看|加载|分析)/u.test(text)) return running ? '读取中' : '读取';
  if (/(verify|check|audit|核对|验证|检查)/u.test(text)) return running ? '验证中' : '验证';
  if (/(workflow|agentarts|cloud|http|web|subagent|shadow_preview|智能体|云端|影子)/u.test(text)) return running ? '调用中' : '调用';
  return running ? '执行中' : '执行';
}

export function stripProfileMetadata(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s*\[profile=[^\]]+\]\s*$/u, '').trim();
}

function formatStepDuration(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

export function answerCardHtml(task, live, escape) {
  const reasoning = live?.reasoning ?? '';
  const streamed = stripProfileMetadata(live?.answer ?? '');
  const excerpt = task?.deviceReplyKind === 'browser-excerpt' && typeof task.resultSummary === 'string' ? task.resultSummary : '';
  const settled = excerpt || (typeof task?.resultSummary === 'string' && task.resultSummary.trim() ? stripProfileMetadata(task.resultSummary) : '');
  const answer = settled || streamed;
  const steps = live?.steps?.length ? live.steps : [];
  const summary = stripProfileMetadata(live?.summary ?? '');
  const openDisclosures = live?.openDisclosures instanceof Set ? live.openDisclosures : new Set();
  const thinkingOpen = openDisclosures.has('thinking') ? ' open' : '';
  const isActive = Boolean(task && task.state && !traceDoneStates.has(task.state) && !task.cancelRequested);
  const thinking = reasoning
    ? `<details class="thinking-block" data-disclosure-key="thinking"${thinkingOpen}><summary>${traceHeadIconHtml('think')}<span class="trace-label${isActive ? ' is-shimmer' : ''}">${isActive ? '思考中' : '思考过程'}${formatElapsed(live, !isActive)}</span><span class="trace-chevron" aria-hidden="true"></span></summary><p class="thinking-body">${escape(reasoning)}</p></details>`
    : '';
  const tools = steps.length ? `<div class="tool-steps">${steps.map((step, index) => {
    const key = stepDisclosureKey(step, index);
    const stepOpen = openDisclosures.has(key) ? ' open' : '';
    const label = step.toolName === 'workflow.shadow_preview' ? '影子工作流试运行预览' : step.label || step.toolName || '工具';
    const stepRunning = !isTraceStepTerminal(step.state) && step.state !== 'waiting_approval';
    const logo = describeTraceStepLogo({...step, label});
    const verb = describeTraceStepVerb({...step, label});
    const dur = formatStepDuration(step.durationMs);
    const durHtml = dur ? `<span class="trace-step-time">${escape(dur)}</span>` : '';
    return `<details class="tool-step" data-disclosure-key="${escape(key)}"${stepOpen}><summary><span class="trace-step-verb${stepRunning ? ' is-shimmer' : ''}">${escape(verb)}</span>${traceLogoHtml(logo)}<span class="trace-label${stepRunning ? ' is-shimmer' : ''}">${escape(label)}</span>${durHtml}<span class="trace-chevron" aria-hidden="true"></span></summary><p>${step.argsSummary ? `参数：${escape(step.argsSummary)}` : ''}${step.resultSummary ? `\n结果：${escape(step.resultSummary)}` : ''}${step.durationMs !== undefined ? `\n耗时：${escape(String(step.durationMs))} 毫秒` : ''}</p></details>`;
  }).join('')}</div>` : '';
  const body = answer ? `<div class="assistant-message">${escape(answer)}</div>` : (task?.error?.message ? `<div class="assistant-error">${escape(task.error.message)}</div>` : '');
  const back = summary ? `<p class="child-summary">结果已回到主对话：${escape(summary)}</p>` : '';
  return `<section class="answer-card" data-answer-for="${escape(task?.taskId ?? '')}" data-live="${isActive ? 'true' : 'false'}"${excerpt ? ' data-browser-excerpt' : ''}>${thinking}${tools}${body}${back}</section>`;
}

export function syncAnswerCardDisclosures(card, live) {
  const openKeys = new Set(live?.openDisclosures instanceof Set ? live.openDisclosures : []);
  for (const details of card?.querySelectorAll?.('details[data-disclosure-key]') ?? []) {
    const key = details.dataset?.disclosureKey ?? details.getAttribute?.('data-disclosure-key');
    if (!key) continue;
    const isOpen = details.open === true || (typeof details.hasAttribute === 'function' && details.hasAttribute('open'));
    if (isOpen) openKeys.add(key);
    else openKeys.delete(key);
  }
  if (live && typeof live === 'object') live.openDisclosures = openKeys;
  return openKeys;
}

export function syncContainerAnswerDisclosures(container, liveTurns) {
  if (!container || !liveTurns) return;
  for (const card of container.querySelectorAll?.('[data-answer-for]') ?? []) {
    const taskId = card.dataset?.answerFor ?? card.getAttribute?.('data-answer-for');
    if (taskId && liveTurns.has(taskId)) {
      syncAnswerCardDisclosures(card, liveTurns.get(taskId));
    }
  }
}

export function replaceAnswerCard(slot, task, live, escape, doc = globalThis.document) {
  if (!slot || !doc) return undefined;
  const openKeys = syncAnswerCardDisclosures(slot, live);
  const active = doc.activeElement;
  const inside = Boolean(active && (typeof slot.contains === 'function' ? slot.contains(active) : active.closest?.('[data-answer-for]') === slot));
  const activeDetails = inside ? active.closest?.('details[data-disclosure-key]') : undefined;
  const focusedKey = activeDetails ? (activeDetails.dataset?.disclosureKey ?? activeDetails.getAttribute?.('data-disclosure-key')) : undefined;
  const wrap = doc.createElement('div');
  wrap.innerHTML = answerCardHtml(task, live, escape);
  const nextCard = wrap.firstElementChild ?? wrap.children?.[0];
  if (!nextCard) return undefined;
  for (const details of nextCard.querySelectorAll?.('details[data-disclosure-key]') ?? []) {
    const key = details.dataset?.disclosureKey ?? details.getAttribute?.('data-disclosure-key');
    if (key && openKeys.has(key)) {
      details.open = true;
      details.setAttribute?.('open', '');
    }
  }
  slot.replaceWith(nextCard);
  if (focusedKey) {
    const targetDetails = [...(nextCard.querySelectorAll?.('details[data-disclosure-key]') ?? [])].find(
      item => (item.dataset?.disclosureKey ?? item.getAttribute?.('data-disclosure-key')) === focusedKey,
    );
    (targetDetails?.querySelector?.('summary') ?? targetDetails)?.focus?.({preventScroll: true});
  }
  return nextCard;
}

export function assistantStatusLabel(status) {
  if (status === 'working') return '工作中';
  if (status === 'waiting_approval') return '等待审批';
  return '空闲';
}

const ASSISTANT_ICON_PRESETS = Object.freeze({
  coder: {
    tone: 'sky',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.1 5.8 2.8 9l3.3 3.2M11.9 5.8 15.2 9l-3.3 3.2M10.1 4.3 7.9 13.7"/></svg>',
  },
  coordinator: {
    tone: 'mint',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5.8" r="1.9"/><circle cx="13" cy="5.8" r="1.9"/><circle cx="9" cy="12.8" r="1.9"/><path d="M6.9 5.8h4.2M5.9 7.5l2.1 3.6M12.1 7.5 10 11.1"/></svg>',
  },
  planner: {
    tone: 'amber',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="6.2"/><polygon points="11.9,6.1 9.9,9.9 6.1,11.9 8.1,8.1" fill="currentColor" stroke="none"/></svg>',
  },
  researcher: {
    tone: 'violet',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 4.8c1.9-.5 4-.2 6.2 1 2.2-1.2 4.3-1.5 6.2-1v8.4c-1.9-.4-4-.1-6.2 1-2.2-1.1-4.3-1.4-6.2-1Z"/><path d="M9 5.8v8.4"/></svg>',
  },
  reviewer: {
    tone: 'rose',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.6 14.4 4.7v4.1c0 3.3-2.2 5.6-5.4 6.6-3.2-1-5.4-3.3-5.4-6.6V4.7Z"/><path d="m6.6 9.1 1.7 1.7 3.2-3.2"/></svg>',
  },
});

const ASSISTANT_FALLBACK_POOL = Object.freeze([
  {
    tone: 'teal',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5 10.8 7.2 15.5 9l-4.7 1.8L9 15.5 7.2 10.8 2.5 9l4.7-1.8Z"/></svg>',
  },
  {
    tone: 'indigo',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 9h2.8l1.8-4.2 3.4 8.4 2-4.2h3"/></svg>',
  },
  {
    tone: 'ochre',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.6 14.6 5.8v6.4L9 15.4 3.4 12.2V5.8Z"/><path d="M3.4 5.8 9 9l5.6-3.2M9 9v6.4"/></svg>',
  },
  {
    tone: 'lime',
    svg: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.8 2.6 4.6 9.8h4.1l-.5 5.6 5.2-7.2H9.3Z"/></svg>',
  },
]);

export function assistantVisualSpec(assistant = {}) {
  const id = String(assistant?.assistantId ?? '').trim().toLowerCase();
  const role = String(assistant?.role ?? '').trim().toLowerCase();
  if (ASSISTANT_ICON_PRESETS[id]) return ASSISTANT_ICON_PRESETS[id];
  if (ASSISTANT_ICON_PRESETS[role]) return ASSISTANT_ICON_PRESETS[role];
  const hint = `${assistant?.displayName ?? ''} ${assistant?.instructions ?? ''}`.toLowerCase();
  if (/编码|代码|开发|工程|脚本|code|dev/.test(hint)) return ASSISTANT_ICON_PRESETS.coder;
  if (/协作|统筹|沟通|群聊|传达|coord|collab|team/.test(hint)) return ASSISTANT_ICON_PRESETS.coordinator;
  if (/规划|计划|拆解|路线|排期|plan|road/.test(hint)) return ASSISTANT_ICON_PRESETS.planner;
  if (/资料|检索|文档|知识|笔记|阅读|论文|research|doc|wiki/.test(hint)) return ASSISTANT_ICON_PRESETS.researcher;
  if (/审查|评审|检查|安全|风险|测试|review|audit|qa/.test(hint)) return ASSISTANT_ICON_PRESETS.reviewer;
  if (/写|文案|润色|翻译|总结|创作|write|draft/.test(hint)) return ASSISTANT_FALLBACK_POOL[0];
  if (/监控|追踪|提醒|简报|动态|watch|monitor/.test(hint)) return ASSISTANT_FALLBACK_POOL[1];
  let hash = 0;
  const seed = String(assistant?.assistantId || assistant?.displayName || 'assistant');
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ASSISTANT_FALLBACK_POOL[hash % ASSISTANT_FALLBACK_POOL.length];
}

export function assistantCardHtml(assistant, escape) {
  const unread = assistant.unreadCount > 0 ? `<span class="unread">${assistant.unreadCount} 条未读</span>` : '';
  const cleanSummary = stripProfileMetadata(assistant.lastSummary || '');
  const summary = cleanSummary ? `<em>${escape(cleanSummary)}</em>` : '';
  const status = assistant.status || 'idle';
  const spec = assistantVisualSpec(assistant);
  return `<button type="button" class="assistant-card" data-assistant-id="${escape(assistant.assistantId)}" data-status="${escape(status)}" data-tone="${spec.tone}"><span class="assistant-card-icon" data-tone="${spec.tone}" aria-hidden="true">${spec.svg}</span><strong>${escape(assistant.displayName)}</strong><small>${escape(assistant.instructions || '')}</small><small>${assistantStatusLabel(status)}${unread ? ` ${unread}` : ''}</small>${summary}</button>`;
}

const traceDoneStates = new Set(['succeeded', 'failed', 'cancelled', 'waiting_reconciliation']);
function isTraceStepTerminal(state) {
  return ['completed', 'succeeded', 'confirmed', 'returned', 'allowed', 'failed', 'denied', 'cancelled'].includes(state);
}
function traceStepGlyph(state) {
  if (state === 'waiting_approval') return {cls: 'waiting', glyph: '⏸'};
  if (state === 'failed' || state === 'denied' || state === 'cancelled') return {cls: 'failed', glyph: '✕'};
  if (isTraceStepTerminal(state)) return {cls: 'done', glyph: '✓'};
  return {cls: 'running', glyph: '◌'};
}
function collectTraceSteps(task, live, children = []) {
  const ordered = [];
  const byId = new Map();
  const pushStep = raw => {
    if (!raw || typeof raw !== 'object') return;
    const label = raw.toolName === 'workflow.shadow_preview' ? '影子工作流试运行预览' : (raw.label || raw.toolName || '').trim();
    if (!label) return;
    const step = {
      stepId: typeof raw.stepId === 'string' && raw.stepId.length > 0 ? raw.stepId : undefined,
      label,
      toolName: raw.toolName,
      state: raw.state || 'running',
      argsSummary: raw.argsSummary,
      resultSummary: raw.resultSummary,
      durationMs: raw.durationMs,
    };
    if (step.stepId && byId.has(step.stepId)) {
      const prev = byId.get(step.stepId);
      if (isTraceStepTerminal(step.state) || !isTraceStepTerminal(prev.state)) prev.state = step.state;
      prev.label = step.label || prev.label;
      prev.toolName = step.toolName || prev.toolName;
      if (step.argsSummary !== undefined) prev.argsSummary = step.argsSummary;
      if (step.resultSummary !== undefined) prev.resultSummary = step.resultSummary;
      if (step.durationMs !== undefined) prev.durationMs = step.durationMs;
      return;
    }
    if (step.stepId) byId.set(step.stepId, step);
    ordered.push(step);
  };
  for (const step of live?.steps ?? []) pushStep(step);
  for (const child of children ?? []) {
    for (const step of child?.steps ?? []) pushStep(step);
    for (const act of child?.toolActivity ?? []) pushStep(act);
  }
  const hasDetailSteps = ordered.length > 0;
  const taskSteps = Array.isArray(task?.steps) ? task.steps : [];
  const lastCoordIndex = taskSteps.reduce((acc, s, idx) => (typeof s?.stepId === 'string' && /^competition-\d+$/.test(s.stepId) && s.label === '正在协调' ? idx : acc), -1);
  const taskDone = traceDoneStates.has(task?.state);
  for (let idx = 0; idx < taskSteps.length; idx++) {
    const step = taskSteps[idx];
    if (hasDetailSteps && (step.toolName === 'subagent.dispatch' || /^subagent\.dispatch\b/.test(step.label ?? ''))) continue;
    const isCoordStep = typeof step?.stepId === 'string' && /^competition-\d+$/.test(step.stepId) && step.label === '正在协调';
    if (isCoordStep && (idx !== lastCoordIndex || taskDone)) continue;
    pushStep(step);
  }
  return ordered;
}

export function traceBlockHtml(task, live, children = [], escape) {
  if (!task || task.bodyWithheld || task.conflictOnly) return '';
  const steps = collectTraceSteps(task, live, children);
  const isActive = !traceDoneStates.has(task.state) && !task.outputTruncated && !task.cancelRequested;
  const delegated = children.length > 0 || task.backgroundDelegation === true;
  const reasoning = typeof live?.reasoning === 'string' ? live.reasoning.trim() : '';
  if (!reasoning && !steps.length && !isActive && !delegated) return '';
  const openDisclosures = live?.openDisclosures instanceof Set ? live.openDisclosures : new Set();
  const elapsed = formatElapsed(live, !isActive);
  const phase = activePhaseLabel(task);
  const hasAnswer = Boolean((live?.answer ?? '').trim() || (typeof task.resultSummary === 'string' && task.resultSummary.trim()));
  const showThinking = Boolean(reasoning) || (isActive && !steps.length && !hasAnswer && !delegated);
  const thinkingHtml = showThinking
    ? `<details class="trace-disclosure trace-thinking" data-disclosure-key="thinking"${openDisclosures.has('thinking') ? ' open' : ''}><summary>${traceHeadIconHtml('think')}<span class="trace-label${isActive ? ' is-shimmer' : ''}">${isActive ? '正在思考' : '思考过程'}${elapsed}</span><span class="trace-chevron" aria-hidden="true"></span></summary><div class="trace-thinking-body">${escape(reasoning || '正在分析任务并规划步骤…')}</div></details>`
    : '';
  const showProcess = steps.length > 0 || delegated;
  let processHtml = '';
  if (showProcess) {
    const label = steps.length > 0
      ? (isActive ? `${phase} · 执行过程 · ${steps.length} 步` : `执行过程 · ${steps.length} 步${elapsed}`)
      : (isActive ? `${phase} · 子智能体执行中` : '子智能体已结束');
    const body = steps.length > 0
      ? `<ol class="trace-step-list">${steps.map(step => {
        const icon = traceStepGlyph(step.state);
        const stepRunning = icon.cls === 'running';
        const logo = describeTraceStepLogo(step);
        const verb = describeTraceStepVerb(step);
        const meta = [
          step.argsSummary ? String(step.argsSummary) : '',
          step.resultSummary ? `结果：${step.resultSummary}` : '',
        ].filter(Boolean).join(' · ');
        const duration = step.durationMs !== undefined ? `<span class="trace-step-time">${escape(String(step.durationMs))}ms</span>` : '';
        return `<li class="trace-step-item" data-step-state="${escape(icon.cls)}"><div class="trace-step-row"><span class="trace-step-verb${stepRunning ? ' is-shimmer' : ''}">${escape(verb)}</span>${traceLogoHtml(logo)}<strong class="trace-step-target${stepRunning ? ' is-shimmer' : ''}">${escape(step.label)}</strong>${duration}<span class="trace-step-glyph" aria-hidden="true">${icon.glyph}</span></div>${meta ? `<small class="trace-step-meta">${escape(meta)}</small>` : ''}</li>`;
      }).join('')}</ol>`
      : `<p class="trace-empty-note">${escape(isActive ? '子智能体正在后台处理，你可以继续在主对话输入…' : '已委派子智能体完成执行。')}</p>`;
    processHtml = `<details class="trace-disclosure trace-process" data-disclosure-key="process"${openDisclosures.has('process') ? ' open' : ''}><summary>${traceHeadIconHtml('process')}<span class="trace-label${isActive ? ' is-shimmer' : ''}">${escape(label)}</span><span class="trace-chevron" aria-hidden="true"></span></summary>${body}</details>`;
  }
  if (!thinkingHtml && !processHtml) return '';
  return `<div class="trace-block" data-trace-for="${escape(task.taskId)}" data-live="${isActive ? 'true' : 'false'}">${thinkingHtml}${processHtml}</div>`;
}

export function syncTraceDisclosures(container, liveTurns) {
  if (!container || !liveTurns) return;
  for (const block of container.querySelectorAll?.('[data-trace-for]') ?? []) {
    const taskId = block.dataset?.traceFor ?? block.getAttribute?.('data-trace-for');
    if (!taskId) continue;
    let live = liveTurns.get(taskId);
    if (!live) {
      const hasOpen = [...(block.querySelectorAll?.('details[data-disclosure-key]') ?? [])]
        .some(details => details.open === true || (typeof details.hasAttribute === 'function' && details.hasAttribute('open')));
      if (!hasOpen) continue;
      live = emptyLive();
      liveTurns.set(taskId, live);
    }
    syncAnswerCardDisclosures(block, live);
  }
}

export function replaceTraceBlock(slot, task, live, children, escape, doc = globalThis.document) {
  if (!slot || !doc) return undefined;
  const openKeys = syncAnswerCardDisclosures(slot, live);
  const active = doc.activeElement;
  const inside = Boolean(active && (typeof slot.contains === 'function' ? slot.contains(active) : active.closest?.('[data-trace-for]') === slot));
  const activeDetails = inside ? active.closest?.('details[data-disclosure-key]') : undefined;
  const focusedKey = activeDetails ? (activeDetails.dataset?.disclosureKey ?? activeDetails.getAttribute?.('data-disclosure-key')) : undefined;
  const html = traceBlockHtml(task, live, children, escape);
  if (!html) {
    slot.replaceChildren?.();
    return slot;
  }
  const wrap = doc.createElement('div');
  wrap.innerHTML = html;
  const nextBlock = wrap.firstElementChild ?? wrap.children?.[0];
  if (!nextBlock) return undefined;
  for (const details of nextBlock.querySelectorAll?.('details[data-disclosure-key]') ?? []) {
    const key = details.dataset?.disclosureKey ?? details.getAttribute?.('data-disclosure-key');
    if (key && openKeys.has(key)) {
      details.open = true;
      details.setAttribute?.('open', '');
    }
  }
  slot.replaceWith(nextBlock);
  if (focusedKey) {
    const targetDetails = [...(nextBlock.querySelectorAll?.('details[data-disclosure-key]') ?? [])].find(
      item => (item.dataset?.disclosureKey ?? item.getAttribute?.('data-disclosure-key')) === focusedKey,
    );
    (targetDetails?.querySelector?.('summary') ?? targetDetails)?.focus?.({preventScroll: true});
  }
  return nextBlock;
}

export function createDelegatedDeliveryTracker(limit = 12) {
  const active = new Set();
  const deliveries = [];
  return {
    reset() {
      active.clear();
      deliveries.length = 0;
    },
    observe(timeline, childrenByParent, mainChatRepliesFn) {
      const visibleExcerpts = new Set();
      for (let i = 0; i < (timeline?.length ?? 0); i++) {
        const entry = timeline[i];
        if (entry?.kind !== 'task') continue;
        const task = entry.value;
        if (!task || task.conflictOnly || task.bodyWithheld || task.outputTruncated) {
          if (task?.taskId) active.delete(task.taskId);
          continue;
        }
        const children = childrenByParent?.get?.(task.taskId) ?? [];
        const excerpt = browserExcerptReply(task, children);
        if (excerpt) visibleExcerpts.add(task.taskId);
        const delegated = children.length > 0 || task.backgroundDelegation === true;
        const done = traceDoneStates.has(task.state);
        if (!done && delegated) {
          active.add(task.taskId);
          continue;
        }
        if (active.has(task.taskId) && done) {
          active.delete(task.taskId);
          if (i < timeline.length - 1 && task.state !== 'cancelled') {
            const reply = (typeof mainChatRepliesFn === 'function' ? mainChatRepliesFn(task, children) : []).join('\n\n')
              || (task.state === 'succeeded' ? '子智能体已完成。' : task.error?.message || '子智能体执行已结束。');
            const record = {
              taskId: task.taskId,
              title: (task.userMessage || '后台任务').trim().slice(0, 60),
              state: task.state,
              reply,
              ...(excerpt ? {browserExcerpt: true} : {}),
            };
            const existingIndex = deliveries.findIndex(item => item.taskId === task.taskId);
            if (existingIndex >= 0) deliveries.splice(existingIndex, 1);
            deliveries.push(record);
            if (deliveries.length > limit) deliveries.splice(0, deliveries.length - limit);
          }
        }
      }
      for (let i = deliveries.length - 1; i >= 0; i--) {
        if (deliveries[i].browserExcerpt && !visibleExcerpts.has(deliveries[i].taskId)) deliveries.splice(i, 1);
      }
    },
    list() {
      return deliveries;
    },
  };
}

export function delegatedDeliveryHtml(deliveries, escape, surface = 'workspace') {
  if (!deliveries?.length) return '';
  return deliveries.map(item => {
    const statusLabel = item.state === 'failed'
      ? '子智能体执行异常'
      : item.state === 'waiting_reconciliation'
        ? '子智能体结果待核实'
        : '子智能体已完成';
    const cls = surface === 'panel' ? 'task turn delegated-delivery-turn' : 'workspace-turn delegated-delivery-turn';
    const jumpAttrs = surface === 'panel'
      ? `data-ui-action="jump-turn" data-id="${escape(item.taskId)}"`
      : `data-jump-turn="${escape(item.taskId)}"`;
    const body = `<header class="delegated-delivery-head"><span class="delegated-delivery-badge" data-state="${escape(item.state)}">${escape(statusLabel)}</span><strong class="delegated-delivery-title">${escape(item.title)}</strong><button type="button" class="turn-action" ${jumpAttrs}>定位原任务</button></header><div class="assistant-message">${escape(item.reply)}</div>`;
    return `<article class="${cls}" data-turn="delivery:${escape(item.taskId)}" data-delegated-delivery="${escape(item.taskId)}">${surface === 'panel' ? `<div class="assistant-turn">${body}</div>` : body}</article>`;
  }).join('');
}
