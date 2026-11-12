/** One status line, and a replay button only when a finished task can be compared. */
export function renderCostRoute(node, snapshot, invoke) {
  if (!node) return;
  const route = snapshot?.route;
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs.at(-1) : undefined;
  node.replaceChildren();
  if ((!route || route.state === 'idle') && !run) { node.hidden = true; return; }
  node.hidden = false;
  const line = document.createElement('p');
  line.textContent = route?.state === 'blocked' ? route.reason
    : route?.state === 'selected' ? `${route.tierLabel} · ${route.modelId}`
    : (route?.reason ?? '');
  node.append(line);
  if (run?.taskId && run.alternateModelId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '回放对比';
    button.onclick = () => invoke('costRoute.replay', {taskId: run.taskId, modelId: run.alternateModelId});
    node.append(button);
  }
}
