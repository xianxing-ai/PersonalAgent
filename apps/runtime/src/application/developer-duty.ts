import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {
  assertDutyCredentialScope,
  bindHeadConclusions,
  buildOfflineEvalSet,
  buildPersonalView,
  classifyCiFailure,
  createStubRemoteDutyRunner,
  evaluateRepoDutyAction,
  executeStatusComment,
  reduceDutyPoll,
  type DutyCursor,
  type DutyEvalCase,
  type DutyEvent,
  type DutyPollPage,
  type HeadBoundConclusion,
  type RepoDutyPolicy,
  type DutyPollResult,
  type StatusCommentAttempt,
} from '@personal-agent/github';
import type {TaskRuntime} from '../index.js';
import {createKnowledgeFeedReceipt, type KnowledgeFeedReceiptV2} from './knowledge-feed-receipt.js';

const CURSOR = 'developer-duty-cursor:v1';
const GAP = 'developer-duty-gap:v1';
const FEED = 'developer-duty-feed:v1';
const HEADS = 'developer-duty-heads:v1';
const NOTICE = 'developer-duty-f12-intent:v1';
const COMMENT = 'developer-duty-comment:v1';
const EVAL = 'developer-duty-f23-dataset:v1';

export interface DeveloperDutyPorts {
  listComments: () => Promise<Array<{id: number; body: string}> | 'unknown'>;
  createComment: (body: string) => Promise<{state: 'confirmed' | 'unknown'; id?: number}>;
  editComment: (id: number, body: string) => Promise<{state: 'confirmed' | 'unknown'}>;
}

function fail(message: string): never {throw new ProtocolError('INVALID_ARGUMENT', message);}

/** F09 feed projection. A gap does not create a no-change receipt and does not advance the cursor. */
export function ingestDeveloperDutyPoll(runtime: TaskRuntime, taskId: string, previous: DutyCursor | undefined, page: DutyPollPage): DutyPollResult & {advanced: boolean; receipt: KnowledgeFeedReceiptV2 | undefined} {
  const result = reduceDutyPoll(previous ?? runtime.loadCheckpoint(taskId, CURSOR) as DutyCursor | undefined, page);
  if (result.status === 'gap' || result.status === 'rate_limited') {
    runtime.saveCheckpoint(taskId, GAP, {status: result.status, at: new Date().toISOString(), noChange: false});
    return {...result, advanced: false, receipt: undefined};
  }
  if (result.cursor) runtime.saveCheckpoint(taskId, CURSOR, result.cursor);
  if (!result.events.length) return {...result, advanced: result.status === 'unchanged', receipt: undefined};
  const receipt = createKnowledgeFeedReceipt({namespace: 'developer-duty', sourceId: page.repo.replace('/', '__'),
    observedAt: result.events[0]!.receivedAt, revision: createHash('sha256').update(JSON.stringify(result.cursor ?? result.events)).digest('hex'),
    items: result.events.map(event => ({dedupeKey: event.deliveryId, occurredAt: event.receivedAt,
      contentRef: `github://${event.repo}/delivery/${event.deliveryId}`, title: `${event.type} ${event.number ?? ''}`.trim(),
      summary: event.headSha ?? event.action ?? event.type}))});
  runtime.saveCheckpoint(taskId, FEED, receipt);
  return {...result, advanced: true, receipt};
}

export function recordDeveloperDutyConclusions(runtime: TaskRuntime, taskId: string, next: {repo: string; number: number; headSha: string; conclusion: string}): HeadBoundConclusion[] {
  const previous = runtime.loadCheckpoint(taskId, HEADS) as HeadBoundConclusion[] | undefined ?? [];
  const conclusions = bindHeadConclusions(previous, next);
  runtime.saveCheckpoint(taskId, HEADS, conclusions);
  return conclusions;
}

/** F12 intent only. Delivery remains the existing notification host; this does not claim a device showed it. */
export function queueDeveloperDutyNotification(runtime: TaskRuntime, taskId: string, summary: string, dedupeKey: string) {
  const current = runtime.loadCheckpoint(taskId, NOTICE) as {items?: Array<{dedupeKey: string; summary: string}>} | undefined;
  const items = current?.items ?? [];
  if (items.some(item => item.dedupeKey === dedupeKey)) return {channel: 'f12' as const, delivered: false, duplicate: true, summary};
  const next = [...items, {dedupeKey, summary}];
  runtime.saveCheckpoint(taskId, NOTICE, {channel: 'f12', items: next});
  return {channel: 'f12' as const, delivered: false, duplicate: false, summary};
}

/** F24 rule: unknown comment writes are read back and never posted again. */
export async function commitDeveloperDutyStatusComment(runtime: TaskRuntime, taskId: string, ports: DeveloperDutyPorts, desiredBody: string): Promise<StatusCommentAttempt> {
  const previous = runtime.loadCheckpoint(taskId, COMMENT) as StatusCommentAttempt | undefined;
  const attempt = await executeStatusComment(ports, desiredBody, previous);
  runtime.saveCheckpoint(taskId, COMMENT, attempt);
  if (attempt.outcome === 'unknown') throw new ProtocolError('RESULT_UNKNOWN', 'Duty status comment must be read back before another write');
  return attempt;
}

export function developerDutyToolIntent(policy: RepoDutyPolicy, action: 'comment' | 'push' | 'merge', branch?: string) {
  const decision = evaluateRepoDutyAction(policy, action, branch);
  const toolName = action === 'comment' && decision.allowed ? 'github.pr.comment' : undefined;
  return {...decision, toolName, mergeInvoked: false as const};
}

export function storeDeveloperDutyEvalSet(runtime: TaskRuntime, taskId: string, cases: readonly DutyEvalCase[]) {
  const dataset = buildOfflineEvalSet(cases);
  runtime.saveCheckpoint(taskId, EVAL, dataset);
  return dataset;
}

export function developerDutyCredential(input: {repo: string; credentialRef: string; policy: RepoDutyPolicy}) {
  return assertDutyCredentialScope(input);
}

export function developerDutyRemoteRunner() {return createStubRemoteDutyRunner();}

export function developerDutyPersonalView(input: Parameters<typeof buildPersonalView>[0]) {return buildPersonalView(input);}

export function developerDutyCiClass(input: {logExcerpt: string; annotations?: string[]}) {return classifyCiFailure(input);}

export function requireDutyEvent(event: DutyEvent | undefined): DutyEvent {
  if (!event) fail('Duty event is missing');
  return event;
}
