import {createHash} from 'node:crypto';
import type {TaskRuntime} from '../index.js';
import type {CollectResult} from '@personal-agent/feeds';

export interface KnowledgeFeedItem {
  dedupeKey: string;
  occurredAt: string;
  contentRef: string;
  title: string;
  summary: string;
}
export interface KnowledgeFeedCitation {
  itemKey: string;
  contentRef: string;
  itemContentSha256: string;
}
interface KnowledgeFeedReceiptBase {
  kind: 'feeds.collect';
  namespace: string;
  sourceId: string;
  observedAt: string;
  revision: string;
  contentSha256: string;
  /** One actual locator, or a v2 internal bundle identity. Never a invented web source. */
  citation: string;
  summary: string;
  items: KnowledgeFeedItem[];
  receiptId: string;
}
export interface KnowledgeFeedReceiptV1 extends KnowledgeFeedReceiptBase {version: 1;}
export interface KnowledgeFeedReceiptV2 extends KnowledgeFeedReceiptBase {
  version: 2;
  citationItems: KnowledgeFeedCitation[];
}
export type KnowledgeFeedReceipt = KnowledgeFeedReceiptV1 | KnowledgeFeedReceiptV2;
export interface KnowledgeFeedReceiptBinding {
  namespace: string;
  sourceId: string;
  observedAt: string;
  revision: string;
  contentSha256: string;
  citation: string;
  receiptId: string;
  summary?: string | null | undefined;
}
export interface KnowledgeFeedQuotedItem {
  itemKey: string;
  contentSha256: string;
  citation: string;
  title: string;
  excerpt: string;
  occurredAt: string;
  fetchedAt: string;
  sourceId: string;
  sourceRevision: string;
  pageContentSha256: string;
  dataClass: 'untrusted_source_text';
}

const baseKeys = ['version', 'kind', 'namespace', 'sourceId', 'observedAt', 'revision',
  'contentSha256', 'citation', 'summary', 'items', 'receiptId'];
const itemKeys = ['dedupeKey', 'occurredAt', 'contentRef', 'title', 'summary'];
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const identifier = (value: unknown): value is string => text(value) && value.length <= 200
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const instant = (value: unknown): boolean => text(value) && Number.isFinite(Date.parse(value));
const itemCore = (item: KnowledgeFeedItem): KnowledgeFeedItem => ({dedupeKey: item.dedupeKey,
  occurredAt: item.occurredAt, contentRef: item.contentRef, title: item.title, summary: item.summary});
const citationItems = (items: KnowledgeFeedItem[]): KnowledgeFeedCitation[] => items.map(item => ({
  itemKey: item.dedupeKey, contentRef: item.contentRef, itemContentSha256: hash(itemCore(item)),
}));
const citationIdentity = (items: KnowledgeFeedItem[], citations: KnowledgeFeedCitation[]): string =>
  new Set(items.map(item => item.contentRef)).size === 1 ? items[0]!.contentRef
    : `knowledge-feed-citations:${hash(citations)}`;
const mappedSummary = (items: KnowledgeFeedItem[]): string => items.map(item => JSON.stringify({
  itemKey: item.dedupeKey, citation: item.contentRef, itemContentSha256: hash(itemCore(item)),
  title: item.title, excerpt: item.summary,
})).join('\n');

function receiptCore(receipt: KnowledgeFeedReceipt) {
  const core = {version: receipt.version, kind: receipt.kind, namespace: receipt.namespace,
    sourceId: receipt.sourceId, observedAt: receipt.observedAt, revision: receipt.revision,
    contentSha256: receipt.contentSha256, citation: receipt.citation, summary: receipt.summary, items: receipt.items};
  return receipt.version === 2 ? {...core, citationItems: receipt.citationItems} : core;
}

/** Structural verification only: does not declare task success, consent, freshness or model relevance. */
export function parseKnowledgeFeedReceipt(raw: unknown): KnowledgeFeedReceipt | undefined {
  if (!object(raw) || ![1, 2].includes(raw.version as number)
    || !keys(raw, raw.version === 2 ? [...baseKeys, 'citationItems'] : baseKeys)
    || raw.kind !== 'feeds.collect' || !identifier(raw.namespace) || !identifier(raw.sourceId)
    || !instant(raw.observedAt) || !sha(raw.revision) || !sha(raw.contentSha256)
    || !text(raw.citation) || typeof raw.summary !== 'string' || !sha(raw.receiptId)
    || !Array.isArray(raw.items) || !raw.items.length) return undefined;
  if (raw.items.some(item => !object(item) || !keys(item, itemKeys)
    || !text(item.dedupeKey) || !text(item.contentRef) || !text(item.title)
    || !instant(item.occurredAt) || typeof item.summary !== 'string')) return undefined;
  const receipt = raw as unknown as KnowledgeFeedReceipt;
  const items = receipt.items;
  const sorted = [...items].sort((a, b) => a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0);
  if (JSON.stringify(items) !== JSON.stringify(sorted) || new Set(items.map(item => item.dedupeKey)).size !== items.length
    || hash(items) !== receipt.contentSha256) return undefined;
  if (receipt.version === 1) {
    const summaries = [items.flatMap(item => [item.title, item.summary]).filter(Boolean).join('\n'),
      items.map(item => item.summary || item.title).join('\n')];
    if (items[0]!.contentRef !== receipt.citation || !summaries.includes(receipt.summary)) return undefined;
  } else {
    const expected = citationItems(items);
    if (!Array.isArray(receipt.citationItems) || receipt.citationItems.length !== items.length
      || receipt.citationItems.some(citation => !object(citation)
        || !keys(citation, ['itemKey', 'contentRef', 'itemContentSha256']))
      || JSON.stringify(receipt.citationItems) !== JSON.stringify(expected)
      || receipt.citation !== citationIdentity(items, expected) || receipt.summary !== mappedSummary(items)) return undefined;
  }
  if (hash(receiptCore(receipt)) !== receipt.receiptId) return undefined;
  return structuredClone(receipt);
}

/** Assemble a v2 receipt from the existing feeds.collect item identity, without new wire fields. */
export function createKnowledgeFeedReceipt(input: {
  namespace: string; sourceId: string; observedAt: string; revision: string; items: readonly KnowledgeFeedItem[];
}): KnowledgeFeedReceiptV2 {
  const items = input.items.map(itemCore).sort((a, b) => a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0);
  const citations = citationItems(items);
  if (!items.length) throw new TypeError('Feed receipt requires cited items');
  const core = {version: 2 as const, kind: 'feeds.collect' as const, namespace: input.namespace,
    sourceId: input.sourceId, observedAt: input.observedAt, revision: input.revision,
    contentSha256: hash(items), citation: citationIdentity(items, citations), summary: mappedSummary(items),
    items, citationItems: citations};
  const receipt = {...core, receiptId: hash(core)};
  if (!parseKnowledgeFeedReceipt(receipt)) throw new TypeError('Feed receipt identity is incomplete');
  return receipt;
}

/** Normalize one complete feeds.collect body. Execution/Policy provenance remains a host responsibility. */
export function createKnowledgeFeedReceiptFromCollectResult(input: {
  namespace: string; sourceId: string; result: unknown;
}): KnowledgeFeedReceiptV2 | undefined {
  const result = input.result;
  if (!identifier(input.namespace) || !identifier(input.sourceId) || !object(result)
    || !object(result.collection) || result.collection.state !== 'fetched'
    || result.collection.subscriptionId !== input.sourceId || !instant(result.collection.fetchedAt)
    || result.hasMore !== false || !text(result.nextCursor) || !Array.isArray(result.items)
    || !result.items.length || !object(result.collection.validators)) return undefined;
  const validators = result.collection.validators;
  if (!['etag', 'lastModified'].every(key => Object.hasOwn(validators, key)
    && (validators[key] === null || text(validators[key])))) return undefined;
  const items: KnowledgeFeedItem[] = [];
  for (const raw of result.items) {
    if (!object(raw) || !object(raw.record) || !text(raw.record.dedupeKey)
      || !text(raw.record.contentRef) || !instant(raw.record.occurredAt) || !text(raw.title)
      || (Object.hasOwn(raw, 'summary') && typeof raw.summary !== 'string')
      || (Object.hasOwn(raw.record, 'accountRef') && raw.record.accountRef !== input.sourceId)
      || (Object.hasOwn(raw.record, 'fetchedAt') && raw.record.fetchedAt !== result.collection.fetchedAt)) return undefined;
    items.push({dedupeKey: raw.record.dedupeKey, occurredAt: raw.record.occurredAt as string,
      contentRef: raw.record.contentRef, title: raw.title.slice(0, 200),
      summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 500) : ''});
  }
  items.sort((a, b) => a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0);
  const contentSha256 = hash(items);
  const revision = text(validators.etag) || text(validators.lastModified)
    ? hash({etag: validators.etag ?? null, lastModified: validators.lastModified ?? null})
    : hash({body: contentSha256});
  try {
    return createKnowledgeFeedReceipt({namespace: input.namespace, sourceId: input.sourceId,
      observedAt: result.collection.fetchedAt as string, revision, items});
  } catch { return undefined; }
}

/** Trusted root reader: rebuild ONLY from the original confirmed tool result and persisted input identity. */
export function readConfirmedFeedCollection(input: {
  namespace: string; sourceId: string; taskId: string; runId: string; toolVersion: string;
  query: Record<string, unknown>; scopeRef: string;
  runtime: Pick<TaskRuntime, 'getTask' | 'readToolExecutions' | 'matchesToolExecutionInput' | 'loadCheckpoint' | 'readEvidence'>;
}): CollectResult | undefined {
  const {namespace, sourceId, taskId, runId, toolVersion, query, scopeRef, runtime} = input;
  if (!identifier(namespace) || !identifier(sourceId) || !text(taskId) || !text(runId)
    || !text(toolVersion) || !text(scopeRef) || !object(query) || query.subscriptionId !== sourceId
    || Object.keys(query).some(key => !['subscriptionId', 'cursor', 'limit'].includes(key))) return undefined;
  try {
    const task = runtime.getTask(taskId);
    const record = runtime.readToolExecutions(taskId).find(item => item.evidenceId === runId);
    if (task.taskId !== taskId || task.cancelRequested || ['failed', 'cancelled'].includes(task.state)
      || !task.evidenceRefs.includes(runId) || !record || record.taskId !== taskId
      || record.evidenceId !== runId || record.toolName !== 'feeds.collect' || record.toolVersion !== toolVersion
      || record.policyDecision !== 'allow' || record.executionStarted !== true || record.state !== 'confirmed'
      || !instant(record.finishedAt) || !runtime.matchesToolExecutionInput(record, {arguments: query, scopeRef})
      || !runtime.readEvidence(taskId).some(item => item.evidenceId === runId && item.kind === 'execution'
        && item.sourceRef === 'feeds.collect')) return undefined;
    const saved = runtime.loadCheckpoint(taskId, `tool-result-${runId}`);
    if (!object(saved) || !object(saved.result) || !Array.isArray(saved.result.items)) return undefined;
    // Preserve original classification. Neither a locator nor sessionAllowed makes an item PUBLIC.
    if (saved.result.items.some(item => !object(item) || !object(item.record)
      || item.record.accountRef !== sourceId || !instant(item.record.fetchedAt)
      || !['public', 'private', 'restricted'].includes(item.record.sensitivity as string))) return undefined;
    const result=saved.result;
    if(!Array.isArray(result.items)||!object(result.collection)||result.collection.subscriptionId!==sourceId
      ||!['fetched','unchanged'].includes(result.collection.state as string)||!instant(result.collection.fetchedAt)
      ||typeof result.hasMore!=='boolean'||!text(result.nextCursor)
      ||result.collection.state==='unchanged'&&(result.items.length!==0||result.hasMore))return undefined;
    return result as unknown as CollectResult;
  } catch { return undefined; }
}

/** Complete knowledge snapshots keep their existing nonempty, final-page contract. */
export function createKnowledgeFeedReceiptFromConfirmedExecution(input: Parameters<typeof readConfirmedFeedCollection>[0]): KnowledgeFeedReceiptV2 | undefined {
  const result=readConfirmedFeedCollection(input);
  return result?createKnowledgeFeedReceiptFromCollectResult({namespace:input.namespace,sourceId:input.sourceId,result}):undefined;
}

/** Bind a structurally valid receipt to the exact consumer's observed context. Keep Runtime ownership checks outside. */
export function verifyKnowledgeFeedReceiptBinding(raw: unknown, expected: KnowledgeFeedReceiptBinding): KnowledgeFeedReceipt | undefined {
  const receipt = parseKnowledgeFeedReceipt(raw);
  if (!receipt || !['namespace', 'sourceId', 'observedAt', 'revision', 'contentSha256', 'citation', 'receiptId']
    .every(key => receipt[key as keyof KnowledgeFeedReceiptBinding] === expected[key as keyof KnowledgeFeedReceiptBinding])
    || expected.summary != null && expected.summary !== receipt.summary.slice(0, 2000)) return undefined;
  // Legacy multi-article receipts can recover unchanged, but their single citation cannot
  // substantiate a new page-level statement. Recollect to obtain the v2 map.
  if (receipt.version === 1 && new Set(receipt.items.map(item => item.contentRef)).size > 1) return undefined;
  return receipt;
}

/** Only original item text and its own locator/version/hash; never generated summaries or first-item attribution. */
export function knowledgeFeedReceiptItems(raw: unknown): KnowledgeFeedQuotedItem[] | undefined {
  const receipt = parseKnowledgeFeedReceipt(raw);
  if (!receipt || receipt.version === 1 && new Set(receipt.items.map(item => item.contentRef)).size > 1) return undefined;
  return receipt.items.map(item => ({itemKey: item.dedupeKey, contentSha256: hash(itemCore(item)),
    citation: item.contentRef, title: item.title, excerpt: item.summary, occurredAt: item.occurredAt,
    fetchedAt: receipt.observedAt, sourceId: receipt.sourceId,
    sourceRevision: receipt.revision, pageContentSha256: receipt.contentSha256, dataClass: 'untrusted_source_text'}));
}
