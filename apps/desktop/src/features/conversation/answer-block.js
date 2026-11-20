/** One answer block for the panel, the workspace and an assistant thread. */

export function emptyLive() {
  return {reasoning: '', answer: '', steps: [], summary: '', startedAt: Date.now(), openDisclosures: new Set()};
}

function stepDisclosureKey(step, index) {
  return typeof step?.stepId === 'string' && step.stepId.length > 0 ? `step:${step.stepId}` : `step-index:${index}`;
}

export function rememberActivity(store, event) {
  if (!event || typeof event.taskId !== 'string') return undefined;
  const current = store.get(event.taskId) ?? emptyLive();
  if (!current.startedAt) current.startedAt = Date.now();
  if (event.kind === 'reasoning') current.reasoning += event.text ?? '';
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
    if (segment.kind === 'reasoning') live.reasoning += segment.text ?? '';
    else if (segment.kind === 'answer') live.answer += segment.text ?? '';
    else if (segment.kind === 'tool') live.steps.push({stepId: segment.stepId, label: segment.label, toolName: segment.toolName, argsSummary: segment.argsSummary, resultSummary: segment.resultSummary, durationMs: segment.durationMs, state: segment.resultSummary ? 'completed' : 'running'});
    else if (segment.kind === 'summary') live.summary = segment.text ?? live.summary;
    if (segment.startedAt) live.startedAt = Date.parse(segment.startedAt) || live.startedAt;
  }
  return live;
}

function seconds(live) {
  if (!live?.startedAt) return '';
  const elapsed = Math.max(1, Math.round((Date.now() - live.startedAt) / 1000));
  return ` · ${elapsed} 秒`;
}

export function answerCardHtml(task, live, escape) {
  const reasoning = live?.reasoning ?? '';
  const streamed = live?.answer ?? '';
  const settled = typeof task?.resultSummary === 'string' && task.resultSummary.trim() ? task.resultSummary : '';
  const answer = settled || streamed;
  const steps = live?.steps?.length ? live.steps : [];
  const summary = live?.summary ?? '';
  const openDisclosures = live?.openDisclosures instanceof Set ? live.openDisclosures : new Set();
  const thinkingOpen = openDisclosures.has('thinking') ? ' open' : '';
  const thinking = reasoning
    ? `<details class="thinking-block" data-disclosure-key="thinking"${thinkingOpen}><summary>思考过程${seconds(live)}</summary><p class="thinking-body">${escape(reasoning)}</p></details>`
    : '';
  const tools = steps.length ? `<div class="tool-steps">${steps.map((step, index) => {
    const key = stepDisclosureKey(step, index);
    const stepOpen = openDisclosures.has(key) ? ' open' : '';
    const label = step.toolName === 'workflow.shadow_preview' ? '影子工作流试运行预览' : step.label || step.toolName || '工具';
    return `<details class="tool-step" data-disclosure-key="${escape(key)}"${stepOpen}><summary>${escape(label)}</summary><p>${step.argsSummary ? `参数：${escape(step.argsSummary)}` : ''}${step.resultSummary ? `\n结果：${escape(step.resultSummary)}` : ''}${step.durationMs !== undefined ? `\n耗时：${escape(String(step.durationMs))} 毫秒` : ''}</p></details>`;
  }).join('')}</div>` : '';
  const body = answer ? `<div class="assistant-message">${escape(answer)}</div>` : (task?.error?.message ? `<div class="assistant-error">${escape(task.error.message)}</div>` : '');
  const back = summary ? `<p class="child-summary">结果已回到主对话：${escape(summary)}</p>` : '';
  return `<section class="answer-card" data-answer-for="${escape(task?.taskId ?? '')}">${thinking}${tools}${body}${back}</section>`;
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

export function assistantCardHtml(assistant, escape) {
  const unread = assistant.unreadCount > 0 ? `<span class="unread">${assistant.unreadCount} 条未读</span>` : '';
  const summary = assistant.lastSummary ? `<em>${escape(assistant.lastSummary)}</em>` : '';
  return `<button type="button" class="assistant-card" data-assistant-id="${escape(assistant.assistantId)}"><strong>${escape(assistant.displayName)}</strong><small>${escape(assistant.instructions || '')}</small><small>${assistantStatusLabel(assistant.status)} ${unread}</small>${summary}</button>`;
}
