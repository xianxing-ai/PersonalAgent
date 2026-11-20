import type { ToolDescriptor } from '@personal-agent/contracts';
import type { GitHubOperation } from './provider.js';
const s = {type: 'string', maxLength: 65536};
const n = {type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER};
const nullable = {type: ['integer', 'null'], minimum: 1};
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const issue = obj({number: n, title: s, body: s, state: s, labels: {type: 'array', maxItems: 100, items: s}, url: s, updatedAt: s});
const run = obj({id: n, name: s, status: s, conclusion: {type: ['string', 'null']}, headSha: s, url: s, createdAt: s});
const job = obj({id: n, runId: n, name: s, status: s, conclusion: {type: ['string', 'null']}, url: s});
const page = (items: Record<string, unknown>) => obj({items: {type: 'array', maxItems: 100, items}, page: n, nextPage: nullable, hasMore: {type: 'boolean'}});
const text = obj({text: {...s, maxLength: 65536}, offset: {type: 'integer', minimum: 0}, nextOffset: {type: ['integer', 'null'], minimum: 0}, truncated: {type: 'boolean'}});
const write = obj({state: {enum: ['confirmed', 'unknown']}, externalId: s, url: s, evidenceRefs: {type: 'array', items: s}}, ['state', 'evidenceRefs']);
const repairSha = {type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const repairReceipt = {repo: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'},
  runId: n, expectedRunAttempt: n, sourceSha: repairSha, repairPrNumber: n, repairHeadSha: repairSha,
  workflowExecutionId: {type: 'string', pattern: '^[a-f0-9]{64}$'}, checkRunId: n, externalId: s, url: s, name: s,
  detailsUrl: s, status: {const: 'completed'}, conclusion: {const: 'neutral'}, evidenceRefs: {type: 'array', items: s}};
const boolOrNull = {type: ['boolean', 'null']};
const strOrNull = {type: ['string', 'null'], maxLength: 65536};
const prObj = {type: 'object', properties: {number: n, title: s, body: s, state: s, base: s, baseSha: s, head: s, headSha: s, url: s, draft: {type: 'boolean'}, merged: {type: 'boolean'}, mergedAt: strOrNull, mergeable: boolOrNull, mergeStateStatus: s}, required: ['number', 'title', 'body', 'state', 'base', 'baseSha', 'head', 'headSha', 'url', 'draft'], additionalProperties: false};
const outputs: Record<GitHubOperation, Record<string, unknown>> = {
  'repo.get': obj({fullName: s, defaultBranch: s, private: {type: 'boolean'}, url: s}),
  'actions.run.list': page(run), 'actions.job.list': page(job), 'actions.log.read': text,
  'actions.repair.link': {oneOf: [obj({state: {const: 'confirmed'}, ...repairReceipt}),
    obj({state: {const: 'unknown'}, checkRunId: n, externalId: s, url: s, evidenceRefs: {type: 'array', items: s}}, ['state', 'evidenceRefs'])]},
  'actions.repair.get': obj(repairReceipt),
  'issue.get': issue, 'issue.list': page(issue), 'issue.label': write, 'issue.comment': write, 'issue.close': write,
  'pr.get': prObj,
  'pr.diff': text, 'pr.create': write, 'pr.comment': write, 'pr.review.comment': write,
};
export const outputSchema = (op: GitHubOperation): ToolDescriptor['outputSchema'] => outputs[op];
