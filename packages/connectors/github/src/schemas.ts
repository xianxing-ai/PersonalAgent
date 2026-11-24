import { ProtocolError, validateToolValue } from '@personal-agent/contracts';
import type { ToolDescriptor } from '@personal-agent/contracts';
import type { GitHubOperation } from './provider.js';
const repo = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$' };
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const body = { type: 'string', minLength: 1, maxLength: 65536 };
const title = { type: 'string', minLength: 1, maxLength: 256 };
const branch = { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9_./-]*$' };
const refName = { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9_.-][A-Za-z0-9_./-]*$' };
const contentPath = { type: 'string', minLength: 0, maxLength: 1024 };
const filePath = { type: 'string', minLength: 1, maxLength: 1024 };
const sha = { type: 'string', pattern: '^[a-fA-F0-9]{40}$' };
const userList = { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' } };
const repairIdentity = {runId: positive, expectedRunAttempt: positive,
  sourceSha: {type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$'}, repairPrNumber: positive,
  repairHeadSha: {type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$'},
  workflowExecutionId: {type: 'string', pattern: '^[a-f0-9]{64}$'}};
const labels = { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: {type: 'string', minLength: 1, maxLength: 100, pattern: '^[^\\x00-\\x1f\\x7f]+$'} };
const page = { page: {...positive, maximum: 10000}, perPage: {...positive, maximum: 100} };
const textPage = { offset: {type: 'integer', minimum: 0, maximum: 1048576}, maxChars: {...positive, maximum: 65536} };
const isoTime = { type: 'string', format: 'date-time', maxLength: 40 };
const reviewComments = {
  type: 'array', minItems: 1, maxItems: 30,
  items: {
    type: 'object',
    properties: { path: filePath, line: positive, body, side: { enum: ['LEFT', 'RIGHT'] } },
    required: ['path', 'line', 'body'],
    additionalProperties: false,
  },
};
const fields: Record<GitHubOperation, Record<string, unknown>> = {
  'viewer.get': {},
  'repo.get': {},
  'repo.list': {
    ...page,
    sort: { enum: ['created', 'updated', 'pushed', 'full_name'] },
    affiliation: { enum: ['owner', 'collaborator', 'organization_member', 'all'] },
  },
  'repo.contents': { path: contentPath, ref: refName, ...textPage },
  'branch.list': { ...page },
  'branch.create': { branch, fromSha: sha },
  'commit.list': { ...page, sha: refName, path: filePath, author: { type: 'string', minLength: 1, maxLength: 256 } },
  'commit.get': { sha: refName },
  'search.code': { q: { type: 'string', minLength: 1, maxLength: 256 }, ...page },
  'search.issues': { q: { type: 'string', minLength: 1, maxLength: 256 }, sort: { enum: ['created', 'updated', 'comments'] }, ...page },
  'actions.run.list': {...page, status: {enum: ['queued', 'in_progress', 'completed', 'failure', 'success']}, branch},
  'actions.job.list': {...page, runId: positive},
  'actions.log.read': {...textPage, runId: positive, jobId: positive},
  'actions.repair.link': repairIdentity,
  'actions.repair.get': {...repairIdentity, checkRunId: positive},
  'issue.get': {number: positive},
  'issue.list': {...page, state: {enum: ['open', 'closed', 'all']}, labels},
  'issue.create': { title, body, labels, assignees: userList },
  'issue.update': { number: positive, expectedUpdatedAt: isoTime, title, body, state: { enum: ['open', 'closed'] }, labels },
  'issue.label': {number: positive, labels, expectedUpdatedAt: isoTime},
  'issue.comment': {number: positive, body},
  'issue.close': {number: positive, expectedUpdatedAt: isoTime, comment: body, stateReason: {enum: ['completed', 'not_planned']}},
  'pr.get': {number: positive},
  'pr.list': { ...page, state: { enum: ['open', 'closed', 'all'] }, base: branch, head: { type: 'string', minLength: 1, maxLength: 255 }, sort: { enum: ['created', 'updated', 'popularity', 'long-running'] } },
  'pr.files': { number: positive, ...page },
  'pr.diff': {number: positive, expectedHeadSha: sha, expectedBaseSha: sha, ...textPage},
  'pr.create': {title, body, head: branch, base: branch, expectedHeadSha: sha, draft: {type: 'boolean'}},
  'pr.comment': {number: positive, body},
  'pr.review': { number: positive, expectedHeadSha: sha, event: { enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] }, body, comments: reviewComments },
  'pr.review.comment': {number: positive, body, commitId: sha, expectedBaseSha: sha, path: filePath, line: positive, side: {enum: ['LEFT', 'RIGHT']}},
  'pr.merge': { number: positive, expectedHeadSha: sha, mergeMethod: { enum: ['merge', 'squash', 'rebase'] }, commitTitle: { type: 'string', minLength: 1, maxLength: 256 }, commitMessage: body },
};
const required: Partial<Record<GitHubOperation, string[]>> = {
  'branch.create': ['branch', 'fromSha'],
  'commit.get': ['sha'],
  'search.code': ['q'],
  'search.issues': ['q'],
  'actions.job.list': ['runId'], 'actions.log.read': ['runId', 'jobId'],
  'actions.repair.link': Object.keys(repairIdentity),
  'actions.repair.get': [...Object.keys(repairIdentity), 'checkRunId'],
  'issue.get': ['number'], 'issue.create': ['title'], 'issue.update': ['number', 'expectedUpdatedAt'], 'issue.label': ['number', 'labels', 'expectedUpdatedAt'],
  'issue.comment': ['number', 'body'],
  'issue.close': ['number'],
  'pr.get': ['number'], 'pr.files': ['number'], 'pr.diff': ['number', 'expectedHeadSha', 'expectedBaseSha'], 'pr.create': ['title', 'body', 'head', 'base', 'expectedHeadSha'],
  'pr.comment': ['number', 'body'], 'pr.review': ['number', 'expectedHeadSha', 'event'], 'pr.review.comment': ['number', 'body', 'commitId', 'path', 'line'],
  'pr.merge': ['number', 'expectedHeadSha'],
};
const repoOmittedOps = new Set<GitHubOperation>(['viewer.get', 'repo.list']);
const repoOptionalOps = new Set<GitHubOperation>(['search.code', 'search.issues']);
export const inputSchema = (op: GitHubOperation): ToolDescriptor['inputSchema'] => {
  const includeRepo = !repoOmittedOps.has(op);
  const needsRepo = includeRepo && !repoOptionalOps.has(op);
  return {
    type: 'object',
    properties: includeRepo ? {repo, ...fields[op]} : {...fields[op]},
    required: needsRepo ? ['repo', ...(required[op] ?? [])] : [...(required[op] ?? [])],
    additionalProperties: false,
  };
};
export function validateInput(op: GitHubOperation, input: unknown): void {
  validateToolValue(inputSchema(op), input);
  const record = input as Record<string, unknown>;
  for (const name of ['head', 'base', 'branch', 'ref', 'path']) {
    const value = record[name];
    if (typeof value === 'string' && (value.includes('..') || value.includes('@{') || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid GitHub reference or path');
  }
  if (Array.isArray(record.comments)) {
    for (const item of record.comments) {
      const p = (item as { path?: unknown })?.path;
      if (typeof p === 'string' && (p.includes('..') || p.startsWith('/') || p.includes('\\') || /[\x00-\x1f\x7f]/.test(p))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid GitHub review comment path');
    }
  }
  if (record.expectedUpdatedAt !== undefined && !Number.isFinite(Date.parse(String(record.expectedUpdatedAt)))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid issue revision time');
  if (op === 'issue.update' && record.title === undefined && record.body === undefined && record.state === undefined && record.labels === undefined) {
    throw new ProtocolError('INVALID_ARGUMENT', 'issue.update requires at least one field to update');
  }
  if (op === 'pr.review' && (record.event === 'REQUEST_CHANGES' || record.event === 'COMMENT') && !record.body && !(Array.isArray(record.comments) && record.comments.length > 0)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'pr.review with REQUEST_CHANGES or COMMENT requires body or comments');
  }
}
