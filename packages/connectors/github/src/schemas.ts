import { ProtocolError, validateToolValue } from '@personal-agent/contracts';
import type { ToolDescriptor } from '@personal-agent/contracts';
import type { GitHubOperation } from './provider.js';
const repo = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$' };
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const body = { type: 'string', minLength: 1, maxLength: 65536 };
const branch = { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9_./-]*$' };
const sha = { type: 'string', pattern: '^[a-fA-F0-9]{40}$' };
const repairIdentity = {runId: positive, expectedRunAttempt: positive,
  sourceSha: {type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$'}, repairPrNumber: positive,
  repairHeadSha: {type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$'},
  workflowExecutionId: {type: 'string', pattern: '^[a-f0-9]{64}$'}};
const labels = { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: {type: 'string', minLength: 1, maxLength: 100, pattern: '^[^\\x00-\\x1f\\x7f]+$'} };
const page = { page: {...positive, maximum: 10000}, perPage: {...positive, maximum: 100} };
const textPage = { offset: {type: 'integer', minimum: 0, maximum: 1048576}, maxChars: {...positive, maximum: 65536} };
const fields: Record<GitHubOperation, Record<string, unknown>> = {
  'repo.get': {},
  'actions.run.list': {...page, status: {enum: ['queued', 'in_progress', 'completed', 'failure', 'success']}, branch},
  'actions.job.list': {...page, runId: positive},
  'actions.log.read': {...textPage, runId: positive, jobId: positive},
  'actions.repair.link': repairIdentity,
  'actions.repair.get': {...repairIdentity, checkRunId: positive},
  'issue.get': {number: positive},
  'issue.list': {...page, state: {enum: ['open', 'closed', 'all']}, labels},
  'issue.label': {number: positive, labels, expectedUpdatedAt: {type: 'string', format: 'date-time', maxLength: 40}},
  'issue.comment': {number: positive, body},
  'issue.close': {number: positive, expectedUpdatedAt: {type: 'string', format: 'date-time', maxLength: 40}, comment: body, stateReason: {enum: ['completed', 'not_planned']}},
  'pr.get': {number: positive}, 'pr.diff': {number: positive, expectedHeadSha: sha, expectedBaseSha: sha, ...textPage},
  'pr.create': {title: {...body, maxLength: 256}, body, head: branch, base: branch, expectedHeadSha: sha, draft: {type: 'boolean'}},
  'pr.comment': {number: positive, body},
  'pr.review.comment': {number: positive, body, commitId: sha, expectedBaseSha: sha, path: {type: 'string', minLength: 1, maxLength: 1024}, line: positive, side: {enum: ['LEFT', 'RIGHT']}},
};
const required: Partial<Record<GitHubOperation, string[]>> = {
  'actions.job.list': ['runId'], 'actions.log.read': ['runId', 'jobId'],
  'actions.repair.link': Object.keys(repairIdentity),
  'actions.repair.get': [...Object.keys(repairIdentity), 'checkRunId'],
  'issue.get': ['number'], 'issue.label': ['number', 'labels', 'expectedUpdatedAt'],
  'issue.comment': ['number', 'body'],
  'issue.close': ['number'],
  'pr.get': ['number'], 'pr.diff': ['number', 'expectedHeadSha', 'expectedBaseSha'], 'pr.create': ['title', 'body', 'head', 'base', 'expectedHeadSha'],
  'pr.comment': ['number', 'body'], 'pr.review.comment': ['number', 'body', 'commitId', 'path', 'line'],
};
export const inputSchema = (op: GitHubOperation): ToolDescriptor['inputSchema'] => ({type: 'object', properties: {repo, ...fields[op]}, required: ['repo', ...(required[op] ?? [])], additionalProperties: false});
export function validateInput(op: GitHubOperation, input: unknown): void {
  validateToolValue(inputSchema(op), input);
  const record = input as Record<string, unknown>;
  for (const name of ['head', 'base', 'branch', 'path']) {
    const value = record[name];
    if (typeof value === 'string' && (value.includes('..') || value.includes('@{') || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid GitHub reference or path');
  }
  if (record.expectedUpdatedAt !== undefined && !Number.isFinite(Date.parse(String(record.expectedUpdatedAt)))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid issue revision time');
}
