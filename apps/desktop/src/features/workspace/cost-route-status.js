/** One status line, replay fee confirmation, and comparison/failure feedback without exposing raw model IDs. */
export function renderCostRoute(node, snapshot, invoke, report = () => {}) {
  if (!node) return;
  const route = snapshot?.route;
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs.at(-1) : undefined;
  const replay = snapshot?.replay;
  node.replaceChildren();
  if ((!route || route.state === 'idle') && !run && !replay) { node.hidden = true; return; }
  node.hidden = false;
  const line = document.createElement('p');
  line.textContent = route?.state === 'blocked' ? route.reason
    : route?.state === 'selected' ? `${route.tierLabel} · ${route.modelLabel ?? '目录模型'}`
    : (route?.reason ?? '');
  node.append(line);
  if (replay?.state === 'confirm_required' && replay.taskId && replay.modelId) {
    const prompt = document.createElement('p');
    prompt.textContent = replay.reason ?? '确认发起云端付费回放对比？';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = '确认费用并回放';
    confirmButton.onclick = () => Promise.resolve(invoke('costRoute.replay', {
      taskId: replay.taskId,
      modelId: replay.modelId,
      confirmed: true,
    })).catch(report);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = '取消';
    cancelButton.onclick = () => Promise.resolve(invoke('costRoute.cancelReplay')).catch(report);
    node.append(prompt, confirmButton, cancelButton);
    return;
  }
  if (run?.taskId && run.alternateModelId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '回放对比';
    button.onclick = () => Promise.resolve(invoke('costRoute.replay', {taskId: run.taskId, modelId: run.alternateModelId})).catch(report);
    node.append(button);
  }
  if (replay?.state === 'compared') {
    const summary = document.createElement('p');
    summary.textContent = replay.same ? '对比结果：两种方案输出一致' : '对比结果：两种方案输出存在差异';
    const baseline = document.createElement('p');
    baseline.textContent = `原方案（${replay.baseline?.label || '目录模型'}）：${(replay.baseline?.output || '暂无输出').slice(0, 120)}`;
    const candidate = document.createElement('p');
    candidate.textContent = `对比方案（${replay.candidate?.label || '目录模型'}）：${(replay.candidate?.output || '暂无输出').slice(0, 120)}`;
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '关闭结果';
    clearButton.onclick = () => Promise.resolve(invoke('costRoute.cancelReplay')).catch(report);
    node.append(summary, baseline, candidate, clearButton);
  } else if (replay && ['failed', 'blocked', 'unavailable'].includes(replay.state)) {
    const errorLine = document.createElement('p');
    errorLine.textContent = `回放失败：${replay.reason || '未能完成对比回放'}`;
    node.append(errorLine);
  }
}
