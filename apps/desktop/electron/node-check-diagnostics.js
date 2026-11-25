/** Project failed workspace.node_check stderr onto the Desktop task snapshot for locate. */

const STDERR_LIMIT = 64_000;
const STDOUT_LIMIT = 16_000;

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the latest confirmed node_check tool result from TaskRuntime checkpoints.
 * Competition export still redacts stdout/stderr; this local projection is Desktop-only.
 */
export function projectNodeCheckDiagnostics(runtime, task) {
  if (!runtime || !task || (task.state !== 'failed' && task.state !== 'waiting_reconciliation')) return undefined;
  if (typeof runtime.readToolExecutions !== 'function' || typeof runtime.loadCheckpoint !== 'function') return undefined;
  let records;
  try {
    records = runtime.readToolExecutions(task.taskId);
  } catch {
    return undefined;
  }
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const last = [...records].reverse().find(record =>
    record?.toolName === 'workspace.node_check'
    && record.state === 'confirmed'
    && record.executionStarted === true);
  if (!last?.evidenceId) return undefined;
  let cached;
  try {
    cached = runtime.loadCheckpoint(task.taskId, `tool-result-${last.evidenceId}`);
  } catch {
    return undefined;
  }
  const result = plainObject(cached) ? cached.result : undefined;
  if (!plainObject(result) || !Number.isSafeInteger(result.exitCode) || result.exitCode === 0) return undefined;
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (!stderr && !stdout) return undefined;
  return {
    toolName: 'workspace.node_check',
    recipeId: typeof result.recipeId === 'string' ? result.recipeId : 'node-check',
    exitCode: result.exitCode,
    ...(stderr ? {stderr: stderr.slice(0, STDERR_LIMIT)} : {}),
    ...(stdout ? {stdout: stdout.slice(0, STDOUT_LIMIT)} : {}),
  };
}

/** Prefer projected stderr for locate buttons; fall back to the public error message. */
export function locateFailureText(task) {
  if (!task || task.outputTruncated) return undefined;
  const stderr = task.resultMetadata?.diagnostics?.stderr;
  if (typeof stderr === 'string' && stderr.trim()) return stderr;
  return typeof task.error?.message === 'string' && task.error.message.trim() ? task.error.message : undefined;
}
