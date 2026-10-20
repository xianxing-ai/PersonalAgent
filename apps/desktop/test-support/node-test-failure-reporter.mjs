import {inspect} from 'node:util';

const MAX_STRING_LENGTH = 4000;
const MAX_CAUSE_DEPTH = 4;

function isRecord(value) {
  return value !== null && typeof value === 'object';
}

function safeString(value, maxLength = MAX_STRING_LENGTH) {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeScalar(value) {
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function summarizeError(error, depth = 0) {
  if (depth >= MAX_CAUSE_DEPTH) return '[cause depth limit]';
  if (!isRecord(error)) return safeScalar(error) ?? '[non-scalar error]';

  const result = {};
  const name = safeString(error.name, 200);
  const message = safeString(error.message);
  const stack = safeString(error.stack, 8000);
  const code = safeScalar(error.code);
  const exitCode = safeScalar(error.exitCode);
  const signal = safeString(error.signal, 200);

  if (name !== undefined) result.name = name;
  if (message !== undefined) result.message = message;
  if (stack !== undefined) result.stack = stack;
  if (code !== undefined) result.code = code;
  if (exitCode !== undefined) result.exitCode = exitCode;
  if (signal !== undefined) result.signal = signal;
  if (error.cause !== undefined) result.cause = summarizeError(error.cause, depth + 1);

  return result;
}

function summarizeFailure(data) {
  const details = isRecord(data?.details) ? data.details : {};
  const error = details.error ?? data?.error;
  const result = {};

  for (const field of ['name', 'file', 'line', 'column', 'type']) {
    const value = safeScalar(data?.[field]);
    if (value !== undefined) result[field] = value;
  }

  const duration = safeNumber(details.duration_ms);
  if (duration !== undefined) result.duration_ms = duration;

  for (const field of ['exitCode', 'signal']) {
    const value = safeScalar(details[field] ?? data?.[field]);
    if (value !== undefined) result[field] = value;
  }

  if (error !== undefined) result.error = summarizeError(error);
  return result;
}

export default async function* nodeTestFailureReporter(source) {
  for await (const event of source) {
    if (event?.type !== 'test:fail') continue;
    const summary = summarizeFailure(event.data);
    yield 'node:test failure ' + inspect(summary, {
      colors: false,
      compact: false,
      depth: MAX_CAUSE_DEPTH + 1,
      maxArrayLength: 16,
      maxStringLength: MAX_STRING_LENGTH,
      breakLength: 120,
    }) + '\n';
  }
}