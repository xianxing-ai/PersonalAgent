/** One answer block for the panel, the workspace and an assistant thread. */

export function emptyLive() {
  return {reasoning: '', answer: '', steps: [], summary: '', startedAt: Date.now()};
}

export function rememberActivity(store, event) {
  if (!event || typeof event.taskId !== 'string') return undefined;
  const current = store.get(event.taskId) ?? emptyLive();
  if (!current.startedAt) current.startedAt = Date.now();
  if (event.kind === 'reasoning') current.reasoning += event.text ?? '';
  else if (event.kind === 'answer_delta') current.answer += event.text ?? '';
  else if (event.kind === 'tool_call') current.steps.push({stepId: event.stepId, label: event.label, toolName: event.toolName, argsSummary: event.argsSummary, state: 'running'});
  else if (event.kind === 'tool_result') {
    const step = [...current.steps].reverse().find(item => item.stepId === event.stepId && item.state === 'running') ?? current.steps[current.steps.length - 1];
    if (step) {
      step.resultSummary = event.resultSummary;
      step.durationMs = event.durationMs;
      step.state = 'completed';
      step.label = event.label || step.label;
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
  const thinking = reasoning
    ? `<details class="thinking-block"><summary>思考过程${seconds(live)}</summary><p class="thinking-body">${escape(reasoning)}</p></details>`
    : '';
  const tools = steps.length ? `<div class="tool-steps">${steps.map(step => `<details class="tool-step"><summary>${escape(step.label || step.toolName || '工具')}</summary><p>${step.argsSummary ? `参数：${escape(step.argsSummary)}` : ''}${step.resultSummary ? `\n结果：${escape(step.resultSummary)}` : ''}${step.durationMs !== undefined ? `\n耗时：${escape(String(step.durationMs))} 毫秒` : ''}</p></details>`).join('')}</div>` : '';
  const body = answer ? `<div class="assistant-message">${escape(answer)}</div>` : (task?.error?.message ? `<div class="assistant-error">${escape(task.error.message)}</div>` : '');
  const back = summary ? `<p class="child-summary">结果已回到主对话：${escape(summary)}</p>` : '';
  return `<section class="answer-card" data-answer-for="${escape(task?.taskId ?? '')}">${thinking}${tools}${body}${back}</section>`;
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
