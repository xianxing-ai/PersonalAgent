/**
 * Trusted local command diagnostic collector for `task.locate` (#649 / L-06).
 * Reads only allowlisted local coding command tool checkpoints; never exports
 * stderr to cloud prompts and never opens workspace source files.
 */
export const LOCATABLE_COMMAND_TOOLS = new Set([
  'workspace.node_check',
  'workspace.npm_test',
  'workspace.npm_build',
  'workspace.git_diff_check',
]);

const MAX_TOOL_OUTPUT_CHARS = 64 * 1024;
const MAX_TOTAL_DIAGNOSTIC_CHARS = 256 * 1024;
const MAX_TASK_TREE_NODES = 16;

function clipText(value, limit) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function readTaskTreeIds(taskId, readChildren) {
  const visited = new Set([taskId]);
  const queue = [taskId];
  while (queue.length > 0 && visited.size < MAX_TASK_TREE_NODES) {
    const current = queue.shift();
    if (typeof readChildren !== 'function') break;
    let children;
    try { children = readChildren(current); } catch { children = []; }
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const childId = typeof child === 'string' ? child : child?.taskId;
      if (typeof childId !== 'string' || !childId || visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
      if (visited.size >= MAX_TASK_TREE_NODES) break;
    }
  }
  return [...visited];
}

export function collectTrustedTaskCommandDiagnostics(runtime, taskId, {readChildren} = {}) {
  if (!runtime || typeof taskId !== 'string' || !taskId.trim()) return '';
  if (typeof runtime.readToolExecutions !== 'function' || typeof runtime.loadCheckpoint !== 'function') return '';
  const chunks = [];
  let totalChars = 0;
  for (const id of readTaskTreeIds(taskId, readChildren)) {
    let records;
    try { records = runtime.readToolExecutions(id); } catch { continue; }
    if (!Array.isArray(records)) continue;
    for (const record of [...records].reverse()) {
      if (!record || !LOCATABLE_COMMAND_TOOLS.has(record.toolName) || typeof record.evidenceId !== 'string') continue;
      let stored;
      try { stored = runtime.loadCheckpoint(id, `tool-result-${record.evidenceId}`); } catch { continue; }
      const result = stored && typeof stored === 'object' ? (stored.result ?? stored) : undefined;
      if (!result || typeof result !== 'object') continue;
      for (const field of ['stderr', 'stdout']) {
        const piece = clipText(result[field], MAX_TOOL_OUTPUT_CHARS);
        if (!piece) continue;
        const remaining = MAX_TOTAL_DIAGNOSTIC_CHARS - totalChars;
        if (remaining <= 0) return chunks.join('\n\n');
        const bounded = piece.length > remaining ? piece.slice(0, remaining) : piece;
        chunks.push(bounded);
        totalChars += bounded.length;
      }
    }
  }
  return chunks.join('\n\n');
}

export function resolveTaskLocateInput({
  payload,
  sender,
  panel,
  admin,
  workspace,
  tasks,
  taskSurface,
  runtime,
  readChildren,
} = {}) {
  const directText = typeof payload?.text === 'string' ? payload.text : '';
  const taskId = typeof payload?.taskId === 'string' && payload.taskId.trim() ? payload.taskId.trim() : '';
  if (!taskId || !runtime) return directText;
  let task = tasks?.get?.(taskId);
  if (!task) {
    try { task = runtime.getTask?.(taskId); } catch { task = undefined; }
  }
  if (!task || task.bodyWithheld) return directText;
  if (sender !== admin && typeof taskSurface === 'function') {
    const expectedSurface = sender === workspace ? 'workspace' : sender === panel ? 'panel' : '';
    if (!expectedSurface || taskSurface(task) !== expectedSurface) return directText;
  }
  const commandDiagnostics = collectTrustedTaskCommandDiagnostics(runtime, taskId, {readChildren});
  if (!commandDiagnostics) return directText;
  return directText.trim() ? `${commandDiagnostics}\n\n${directText}` : commandDiagnostics;
}
