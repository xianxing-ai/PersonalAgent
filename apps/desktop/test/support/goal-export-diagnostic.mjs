import assert from 'node:assert/strict';

const codes = new Set(['TIMEOUT','CANCELLED','RESULT_UNKNOWN','UNAUTHORIZED','REVISION_CONFLICT','EXTERNAL_FAILURE','INVALID_ARGUMENT','UNSUPPORTED_CAPABILITY','SCOPE_DENIED','NOT_FOUND','NOT_CONFIRMED']);
const taskStates = new Set(['created','planning','running','waiting_approval','waiting_external','waiting_reconciliation','verifying','cancelling','succeeded','failed','cancelled']);
const toolStates = new Set(['started','confirmed','failed','unknown']);
const safeCode = value => value === undefined ? null : codes.has(value) ? value : 'OTHER';
const safeState = (value, allowed) => allowed.has(value) ? value : 'OTHER';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : null;

// Test diagnostics only: never serialize tasks, errors, tool results or checkpoints wholesale.
export function goalExportDiagnostic({runtime, task, phase, toolName, change, credentials, fetches, now = new Date().toISOString()}) {
  const deadline = timestamp(runtime.loadCheckpoint(task.taskId, 'application-deadline'));
  const observedAt = timestamp(now);
  const loop = runtime.loadCheckpoint(task.taskId, 'competition-loop');
  const receipts = Array.isArray(loop?.receipts) ? loop.receipts : [];
  return {
    phase: ['initial_goal','restored_goal'].includes(phase) ? phase : 'OTHER',
    toolName: ['goals.get','goals.list'].includes(toolName) ? toolName : 'OTHER',
    change: ['none','restricted','withdrawn','revised','unrelated','private','empty'].includes(change) ? change : 'OTHER',
    state: safeState(task.state, taskStates), errorCode: safeCode(task.error?.code),
    deadline, now: observedAt,
    deadlineExpired: deadline === null || observedAt === null ? null : Date.parse(observedAt) >= Date.parse(deadline),
    credentials: count(credentials), fetches: count(fetches),
    tools: runtime.readToolExecutions(task.taskId).map(record => ({state: safeState(record.state, toolStates), errorCode: safeCode(record.errorCode)})),
    receiptCount: receipts.length, continuationPresent: receipts[0]?.continuation != null,
    externalCloud: false,
  };
}

export function assertGoalExportReceipt(receipt, diagnostic) {
  assert.ok(receipt?.continuation, `Expected confirmed Goal export receipt before revocation checks: ${JSON.stringify(diagnostic)}`);
}
