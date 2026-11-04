import {createHash} from 'node:crypto';
import {actionArgumentsDigest, buildInterestOptions, decideKnowledgeFreshness, LayaInterestDecisionService,
  planKnowledgeReevaluation} from '@personal-agent/cognition';

const PROFILE = 'huawei_ict_agentarts';
const KEY_PREFIX = 'knowledge-watch:v1:';
const KNOWLEDGE_RECHECK_RESULT_KEY = 'knowledge-recheck-result';
const KNOWLEDGE_RECHECK_RESULT_VERSION = 2;
const KNOWLEDGE_SOURCE_READ_PREFIX = 'knowledge-watch-source-read:';
const KNOWLEDGE_RECHECK_JUDGMENT_KEY = 'knowledge-recheck-judgment';
const FEED_CHECK_PREFIX = 'knowledge-watch-feed-check:';
const LABELS = {
  suggested: '待建议',
  tracked: '已跟踪',
  paused: '暂停',
  revoked: '撤销',
  expired: '过期',
  source_unavailable: '来源不可用',
  authorization_required: '待授权',
};
const WATCH_STATES = new Set(Object.keys(LABELS));
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

const fail = code => { throw Object.assign(new Error(code), {code}); };
const clone = value => structuredClone(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const sha = value => /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = ms => new Date(ms).toISOString();
const clip = (value, max = 240) => value.length <= max ? value : value.slice(0, max);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function knowledgeWatchCheckpointKey(namespace) {
  if (!text(namespace) || namespace.length > 200) fail('INVALID_ARGUMENT');
  return KEY_PREFIX + namespace;
}

/**
 * Explicit test double. Production wiring must not call it.
 * A missing production provider is unavailable; it is not this object.
 */
export function createUnavailableSourcePort(reason = 'source_provider_missing') {
  return Object.freeze({
    kind: 'fake',
    availability: 'unavailable',
    read() {
      return Promise.resolve({availability: 'unavailable', reason, provider: 'fake'});
    },
  });
}

export function knowledgeWatchConversationId(namespace) {
  if (!identifier(namespace)) fail('INVALID_ARGUMENT');
  return `knowledge-watch:${namespace}`;
}

/** Compose only existing native readers and the advisory chooser; this adapter cannot issue grants. */
export function createKnowledgeTrackingPorts({readTrackingGrant, readTrackingGrantSnapshot,
  layaChooser, now = Date.now} = {}) {
  if (typeof readTrackingGrant !== 'function' || typeof readTrackingGrantSnapshot !== 'function'
    || typeof layaChooser?.choose !== 'function' || typeof now !== 'function') fail('INVALID_ARGUMENT');
  return Object.freeze({readTrackingGrant, readTrackingGrantSnapshot,
    interestDecider: new LayaInterestDecisionService(layaChooser, now)});
}

/** One Runtime schedule. The host does not compute the next run or dispatch it. */
export function knowledgeWatchScheduleInput({namespace, runAt, checkId} = {}) {
  if (!identifier(namespace) || !identifier(checkId) || !Number.isFinite(instant(runAt))) fail('INVALID_ARGUMENT');
  return {
    scheduleId: `knowledge-watch:${namespace}:${checkId}`,
    goal: '检查已授权的公开订阅',
    conversationId: knowledgeWatchConversationId(namespace),
    runAt,
    timeZone: 'UTC',
    missedRunPolicy: 'run_once',
    taskIdempotencyKey: `knowledge-watch:${namespace}:${checkId}`,
  };
}

/** Uses the existing local Laya judgment port; missing/abstaining judgment is unavailable. */
export function createProductionKnowledgeReevaluator({layaChooser} = {}) {
  return async function reevaluateKnowledge(ctx) {
    if (ctx.signal?.aborted) {
      const error = new Error('Reevaluation cancelled');
      error.code = 'CANCELLED';
      throw error;
    }
    if (!layaChooser || typeof layaChooser.choose !== 'function') {
      const error = new Error('本地语义重评端口不可用');
      error.code = 'UNSUPPORTED_CAPABILITY';
      throw error;
    }
    if (!ctx.summary?.trim()) {
      const error = new Error('来源读回没有可供重评的标题或摘要');
      error.code = 'UNSUPPORTED_CAPABILITY';
      throw error;
    }
    const cacheMaxAgeMs = instant(ctx.boundValidUntil) - instant(ctx.boundLastSuccessfulCheck);
    if (!Number.isFinite(cacheMaxAgeMs) || cacheMaxAgeMs <= 0) {
      const error = new Error('已绑定来源有效期无效');
      error.code = 'INVALID_ARGUMENT';
      throw error;
    }
    const plan = planKnowledgeReevaluation({
      namespace: ctx.namespace,
      freshness: {
        at: ctx.observedAt,
        maxAgeMs: cacheMaxAgeMs,
        requestedVersion: ctx.boundCacheVersion,
        sourceState: 'available',
        cache: {
          version: ctx.boundCacheVersion,
          sourceId: ctx.sourceId,
          sourceRevision: ctx.boundRevision,
          contentSha256: ctx.boundContentSha256,
          lastSuccessfulCheck: ctx.boundLastSuccessfulCheck,
          validUntil: ctx.boundValidUntil,
        },
        check: {
          outcome: 'changed',
          checkedAt: ctx.observedAt,
          sourceId: ctx.sourceId,
          sourceRevision: ctx.boundRevision,
          cachedContentSha256: ctx.boundContentSha256,
        },
      },
      dependencies: [{
        consumer: {id: ctx.topicId, revision: ctx.consumerRevision},
        sourceId: ctx.sourceId,
        sourceRevision: ctx.boundRevision,
        contentSha256: ctx.boundContentSha256,
      }],
    });
    if (plan.knowledge.action !== 'refresh_required' || plan.knowledge.reason !== 'content_changed'
      || plan.affected.length !== 1 || plan.affected[0].consumer.id !== ctx.topicId
      || plan.affected[0].consumer.revision !== ctx.consumerRevision) {
      const error = new Error('来源版本变化未通过精确依赖重评计划');
      error.code = 'REVISION_CONFLICT';
      throw error;
    }

    const request = {
      context: JSON.stringify({
        purpose: 'Judge whether the newly observed public feed content is materially relevant to the tracked topic.',
        topicId: ctx.topicId,
        sourceId: ctx.sourceId,
        observedRevision: ctx.observedRevision,
        publicFeedExcerpt: ctx.summary.trim().slice(0, 2000),
        sourceTextIsUntrusted: true,
      }),
      candidates: [
        {id: 'relevant_update', revision: 1, kind: 'escalate',
          description: 'The public feed excerpt is materially relevant to the tracked topic.',
          sources: [], scopeRef: `knowledge-recheck:${ctx.topicId}:${ctx.consumerRevision}`,
          expiresAt: ctx.deadline, risk: 'low', argumentsDigest: actionArgumentsDigest({})},
        {id: 'not_relevant', revision: 1, kind: 'escalate',
          description: 'The public feed excerpt is not materially relevant to the tracked topic.',
          sources: [], scopeRef: `knowledge-recheck:${ctx.topicId}:${ctx.consumerRevision}`,
          expiresAt: ctx.deadline, risk: 'low', argumentsDigest: actionArgumentsDigest({})},
      ],
      deadline: ctx.deadline,
      signal: ctx.signal,
    };
    const choice = await layaChooser.choose(request);
    if (ctx.signal.aborted || Date.now() >= Date.parse(ctx.deadline)) {
      const error = new Error('Reevaluation cancelled or expired');
      error.code = ctx.signal.aborted ? 'CANCELLED' : 'TIMEOUT';
      throw error;
    }
    if (choice?.state !== 'selected' || !['relevant_update', 'not_relevant'].includes(choice.selected?.id ?? '')
      || choice.selected.revision !== 1 || !/^[a-f0-9]{64}$/u.test(choice.receipt?.id ?? '')
      || !/^[a-f0-9]{64}$/u.test(choice.receipt?.contextDigest ?? '')) {
      const error = new Error('本地 Laya 未能给出可校验的语义判断');
      error.code = 'UNSUPPORTED_CAPABILITY';
      throw error;
    }
    const observedSummarySha256 = createHash('sha256').update(ctx.summary).digest('hex');
    return {
      status: 'completed',
      outcome: choice.selected.id,
      freshnessAction: plan.knowledge.action,
      freshnessReason: plan.knowledge.reason,
      judgment: {
        provider: 'local_laya',
        modelReceiptId: choice.receipt.id,
        contextDigest: choice.receipt.contextDigest,
        observedSummarySha256,
      },
    };
  };
}

function adaptRuntimeWork(runtime, namespace) {
  const conversationId = knowledgeWatchConversationId(namespace);
  return {
    async read({idempotencyKey}) {
      try {
        const task = runtime.findTaskByIdempotencyKey(idempotencyKey);
        if (task === undefined) return {state: 'absent'};
        if (!text(task?.taskId) || (task.goal && task.goal !== `RECHECK ${idempotencyKey}`)
          || (task.conversationId && task.conversationId !== conversationId)) return {state: 'unknown'};
        const knowledgeRecheckResult = typeof runtime.loadCheckpoint === 'function'
          ? runtime.loadCheckpoint(task.taskId, KNOWLEDGE_RECHECK_RESULT_KEY) : undefined;
        const knowledgeRecheckJudgment = typeof runtime.loadCheckpoint === 'function'
          ? runtime.loadCheckpoint(task.taskId, KNOWLEDGE_RECHECK_JUDGMENT_KEY) : undefined;
        return {state: 'accepted', taskId: task.taskId,
          ...(text(task.state) ? {taskState: task.state} : {}),
          ...(knowledgeRecheckResult === undefined ? {} : {knowledgeRecheckResult: clone(knowledgeRecheckResult)}),
          ...(knowledgeRecheckJudgment === undefined ? {} : {knowledgeRecheckJudgment: clone(knowledgeRecheckJudgment)}),
          ...(Array.isArray(task.evidenceRefs) ? {taskEvidenceRefs: [...task.evidenceRefs]} : {})};
      } catch { return {state: 'unknown'}; }
    },
    async submit({idempotencyKey}) {
      const task = await runtime.submitTask({
        goal: `RECHECK ${idempotencyKey}`,
        conversationId,
        idempotencyKey,
      });
      if (!text(task?.taskId)) return {accepted: false};
      return {accepted: true, taskId: task.taskId};
    },
  };
}

function adaptNotificationService(service, namespace) {
  return {
    async send(notice) {
      if (!text(notice?.citation) || !sha(notice.id) || !Number.isFinite(instant(notice.createdAt))) {
        return {delivered: false, reason: 'citation_missing'};
      }
      const item = {
        source: 'knowledge-watch',
        accountRef: namespace,
        externalId: notice.id,
        occurredAt: notice.createdAt,
        fetchedAt: notice.createdAt,
        contentRef: notice.citation,
        sensitivity: 'public',
        dedupeKey: `${namespace}:${notice.id}`,
      };
      try {
        service.ingest([item]);
        const drained = service.drain();
        const batch = drained?.batches?.find(entry => entry?.state === 'ready_for_delivery'
          && text(entry.id) && Array.isArray(entry.itemRefs) && entry.itemRefs.includes(item.dedupeKey));
        if (!batch) return {delivered: false, reason: 'awaiting_batch'};
        return {delivered: false, receiptId: batch.id, deliveryState: 'ready_for_delivery'};
      } catch { return null; }
    },
    async read(notice) {
      try {
        const drained = service.drain();
        const batch = drained?.batches?.find(entry => entry?.id === notice?.receiptId);
        if (batch?.state === 'ready_for_delivery' && text(batch.id)) {
          return {delivered: false, receiptId: batch.id, deliveryState: 'ready_for_delivery'};
        }
        return {delivered: false, reason: 'acknowledgement_unknown'};
      } catch { return null; }
    },
  };
}

function plain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value) {
  return text(value) && value.length <= 200 && !RESERVED.has(value);
}
function instant(value) {
  if (!text(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function validFeedSourceReadReceipt(value) {
  if (!plain(value) || value.version !== 1 || value.kind !== 'feeds.collect'
    || !identifier(value.namespace) || !identifier(value.sourceId)
    || !Number.isFinite(instant(value.observedAt)) || !sha(value.revision)
    || !sha(value.contentSha256) || !text(value.citation) || typeof value.summary !== 'string'
    || !Array.isArray(value.items) || value.items.length === 0 || !sha(value.receiptId)
    || Object.keys(value).length !== 11
    || !['version', 'kind', 'namespace', 'sourceId', 'observedAt', 'revision', 'contentSha256',
      'citation', 'summary', 'items', 'receiptId'].every(key => own(value, key))) return false;
  const itemKeys = ['dedupeKey', 'occurredAt', 'contentRef', 'title', 'summary'];
  if (value.items.some(item => !plain(item) || Object.keys(item).length !== itemKeys.length
    || itemKeys.some(key => typeof item[key] !== 'string')
    || !text(item.dedupeKey) || !text(item.contentRef) || !text(item.title)
    || !Number.isFinite(instant(item.occurredAt)))) return false;
  const sorted = [...value.items].sort((left, right) => left.dedupeKey < right.dedupeKey ? -1
    : left.dedupeKey > right.dedupeKey ? 1 : 0);
  if (new Set(sorted.map(item => item.dedupeKey)).size !== sorted.length
    || new Set(sorted.map(item => item.contentRef)).size !== 1
    || JSON.stringify(sorted) !== JSON.stringify(value.items)
    || digest(value.items) !== value.contentSha256
    || value.items[0].contentRef !== value.citation
    || ![value.items.flatMap(item => [item.title, item.summary]).filter(Boolean).join('\n'),
      value.items.map(item => item.summary || item.title).filter(Boolean).join('\n')].includes(value.summary)) return false;
  const core = {version: value.version, kind: value.kind, namespace: value.namespace,
    sourceId: value.sourceId, observedAt: value.observedAt, revision: value.revision,
    contentSha256: value.contentSha256, citation: value.citation, summary: value.summary,
    items: value.items};
  return value.receiptId === digest(core);
}

function readFeedSourceReceipt(checkpoints, taskId, receiptId, knowledgeFeedReceipts = null) {
  if (!identifier(taskId) || !sha(receiptId)) return null;
  try {
    const receipt = checkpoints.loadCheckpoint(taskId, KNOWLEDGE_SOURCE_READ_PREFIX + receiptId);
    return knowledgeFeedReceipts ? knowledgeFeedReceipts.parseKnowledgeFeedReceipt(receipt) ?? null
      : validFeedSourceReadReceipt(receipt) ? receipt : null;
  } catch { return null; }
}

function validRecheckContext(value, workKey, namespace) {
  if (!plain(value) || value.version !== 1 || value.namespace !== namespace || value.workKey !== workKey
    || !identifier(value.topicId) || !Number.isSafeInteger(value.consumerRevision) || value.consumerRevision < 1
    || !identifier(value.sourceId) || !text(value.boundRevision) || !sha(value.boundContentSha256)
    || !text(value.boundCacheVersion) || !Number.isFinite(instant(value.boundLastSuccessfulCheck))
    || !Number.isFinite(instant(value.boundValidUntil))
    || !text(value.observedRevision) || !sha(value.observedContentSha256)
    || value.availability !== 'available' || !Number.isFinite(instant(value.observedAt)) || !text(value.citation)
    || !identifier(value.sourceReadTaskId) || !sha(value.sourceReadReceiptId)
    || value.summary !== undefined && typeof value.summary !== 'string') return false;
  const allowed = new Set(['version', 'namespace', 'workKey', 'topicId', 'consumerRevision', 'sourceId',
    'boundRevision', 'boundContentSha256', 'boundCacheVersion', 'boundLastSuccessfulCheck', 'boundValidUntil',
    'observedRevision', 'observedContentSha256', 'observedAt', 'availability', 'citation', 'summary',
    'sourceReadTaskId', 'sourceReadReceiptId']);
  return Object.keys(value).every(key => allowed.has(key));
}

function sameRecheckIdentity(left, right) {
  const keys = ['version', 'namespace', 'workKey', 'topicId', 'consumerRevision', 'sourceId',
    'boundRevision', 'boundContentSha256', 'boundCacheVersion', 'boundLastSuccessfulCheck',
    'boundValidUntil', 'observedRevision', 'observedContentSha256', 'observedAt', 'availability',
    'citation', 'sourceReadTaskId', 'sourceReadReceiptId', 'summary'];
  return plain(left) && plain(right) && keys.every(key => left[key] === right[key]);
}

function validKnowledgeRecheckResult(read, context, head) {
  const result = read?.knowledgeRecheckResult;
  const judgment = read?.knowledgeRecheckJudgment;
  const refs = result?.evidenceRefs;
  const taskRefs = read?.taskEvidenceRefs;
  const sourceReadRef = `knowledge-watch-source-read:${context.sourceReadReceiptId}`;
  const judgmentRef = `knowledge-recheck-judgment:${read?.taskId}`;
  return plain(result) && result.version === KNOWLEDGE_RECHECK_RESULT_VERSION
    && result.status === 'completed'
    && result.taskId === read.taskId && result.workKey === context.workKey
    && result.namespace === context.namespace && result.topicId === context.topicId
    && result.consumerRevision === context.consumerRevision
    && result.sourceId === context.sourceId && result.boundRevision === context.boundRevision
    && result.boundContentSha256 === context.boundContentSha256
    && result.boundCacheVersion === context.boundCacheVersion
    && result.boundLastSuccessfulCheck === context.boundLastSuccessfulCheck
    && result.boundValidUntil === context.boundValidUntil
    && result.observedRevision === context.observedRevision
    && result.observedContentSha256 === context.observedContentSha256
    && result.observedAt === context.observedAt
    && result.evaluatedContentSha256 === context.observedContentSha256
    && result.sourceReadTaskId === context.sourceReadTaskId
    && result.sourceReadReceiptId === context.sourceReadReceiptId
    && result.citation === context.citation && result.citation === head.citation
    && Number.isFinite(instant(result.evaluatedAt))
    && plain(result.evaluation) && Object.keys(result.evaluation).length > 0
    && ['relevant_update', 'not_relevant'].includes(result.evaluation.outcome)
    && result.evaluation.freshnessAction === 'refresh_required'
    && result.evaluation.freshnessReason === 'content_changed'
    && result.evaluation.topicId === context.topicId
    && result.evaluation.consumerRevision === context.consumerRevision
    && result.evaluation.sourceId === context.sourceId
    && result.evaluation.observedRevision === context.observedRevision
    && result.evaluation.observedSummarySha256 === judgment?.observedSummarySha256
    && Array.isArray(refs) && refs.length === 2 && refs.every(text)
    && refs.includes(sourceReadRef) && refs.includes(judgmentRef) && !refs.includes(context.citation)
    && new Set(refs).size === refs.length
    && Array.isArray(taskRefs) && refs.every(ref => taskRefs.includes(ref))
    && plain(judgment) && judgment.version === 1 && judgment.taskId === read.taskId
    && judgment.evidenceRef === judgmentRef && judgment.provider === 'local_laya'
    && judgment.outcome === result.evaluation.outcome
    && judgment.sourceReadReceiptId === context.sourceReadReceiptId
    && judgment.modelReceiptId === result.evaluation.modelReceiptId
    && judgment.contextDigest === result.evaluation.contextDigest
    && judgment.observedSummarySha256 === result.evaluation.observedSummarySha256
    && Number.isFinite(instant(judgment.evaluatedAt))
    && /^[a-f0-9]{64}$/u.test(judgment.modelReceiptId)
    && /^[a-f0-9]{64}$/u.test(judgment.contextDigest)
    && /^[a-f0-9]{64}$/u.test(judgment.observedSummarySha256);
}

function emptyDocument(namespace) {
  return {version: 1, namespace, watches: {}, sources: {}, reevaluations: {},
    submissions: {}, notices: {}, tombstones: {}};
}

function readableCheckpoint(raw, namespace) {
  if (raw === undefined) return {ok: true, empty: true};
  if (!plain(raw)) return {ok: false, reason: 'checkpoint_malformed'};
  const keys = Object.keys(raw);
  const expected = ['version', 'namespace', 'watches', 'sources', 'reevaluations',
    'submissions', 'notices', 'tombstones'];
  if (raw.version !== 1 || raw.namespace !== namespace || keys.length !== expected.length
    || expected.some(key => !own(raw, key))
    || [raw.watches, raw.sources, raw.reevaluations, raw.submissions, raw.notices, raw.tombstones]
      .some(value => !plain(value))) return {ok: false, reason: 'checkpoint_malformed'};
  for (const [topicId, tombstone] of Object.entries(raw.tombstones)) {
    if (!identifier(topicId) || !plain(tombstone) || tombstone.topicId !== topicId
      || !identifier(tombstone.id) || !Number.isFinite(instant(tombstone.revokedAt))) {
      return {ok: false, reason: 'checkpoint_tombstone_unreadable'};
    }
  }
  for (const [topicId, watch] of Object.entries(raw.watches)) {
    if (!identifier(topicId) || !plain(watch) || watch.topicId !== topicId
      || !WATCH_STATES.has(watch.state) || !text(watch.reason)
      || !Number.isSafeInteger(watch.revision) || watch.revision < 1) {
      return {ok: false, reason: 'checkpoint_watch_unreadable'};
    }
    if (watch.state === 'revoked' && !raw.tombstones[topicId]) {
      return {ok: false, reason: 'checkpoint_revocation_unreadable'};
    }
    if (watch.delivered === true) return {ok: false, reason: 'checkpoint_watch_unreadable'};
  }
  for (const notice of Object.values(raw.notices)) {
    if (!plain(notice) || !sha(notice.id) || notice.delivered === true && !text(notice.receiptId)) {
      return {ok: false, reason: 'checkpoint_notice_unreadable'};
    }
    if (notice.readAt !== undefined && !Number.isFinite(instant(notice.readAt))) {
      return {ok: false, reason: 'checkpoint_notice_unreadable'};
    }
  }
  for (const [workKey, submission] of Object.entries(raw.submissions)) {
    if (!plain(submission) || !['unknown', 'accepted'].includes(submission.state)
      || submission.state === 'accepted' && !text(submission.taskId)) {
      return {ok: false, reason: 'checkpoint_submission_unreadable'};
    }
    if (submission.recheckContext !== undefined
      && !validRecheckContext(submission.recheckContext, workKey, namespace)) {
      return {ok: false, reason: 'checkpoint_submission_unreadable'};
    }
  }
  return {ok: true, document: raw};
}

/**
 * Desktop consumer for interest decisions and knowledge reevaluation.
 * It does not poll, crawl, start Laya, or grant execution from source text.
 */
export function createKnowledgeWatchHost({
  profile,
  namespace,
  checkpointTaskId,
  checkpoints,
  now = Date.now,
  sourcePort = null,
  subscriptions = null,
  interestDecider = null,
  layaChooser = null,
  workPort = null,
  runtime = null,
  notificationPort = null,
  notificationService = null,
  policyPort = null,
  authorizationRef = null,
  policyToolName = null,
  policyScopes = null,
  readTrackingGrant = null,
  readTrackingGrantSnapshot = null,
  readFeedReceiptEvidence = null,
  readInterestSignal = null,
  feedCollect = null,
  feedSubscriptionId = null,
  scheduler = null,
  knowledgeFeedReceipts = null,
  knowledgeMaxAgeMs = 2 * 60 * 60 * 1000,
} = {}) {
  if (profile !== PROFILE || !identifier(namespace) || !identifier(checkpointTaskId)
    || typeof checkpoints?.loadCheckpoint !== 'function'
    || typeof checkpoints?.saveCheckpoint !== 'function'
    || typeof now !== 'function'
    || !Number.isFinite(knowledgeMaxAgeMs) || knowledgeMaxAgeMs <= 0) fail('INVALID_ARGUMENT');
  if (sourcePort && typeof sourcePort.read !== 'function') fail('INVALID_ARGUMENT');
  if (feedCollect && typeof feedCollect !== 'function') fail('INVALID_ARGUMENT');
  if (feedSubscriptionId !== null && !identifier(feedSubscriptionId)) fail('INVALID_ARGUMENT');
  if (subscriptions && typeof subscriptions.subscribe !== 'function') fail('INVALID_ARGUMENT');
  if (interestDecider && typeof interestDecider.choose !== 'function') fail('INVALID_ARGUMENT');
  if (layaChooser && typeof layaChooser.choose !== 'function') fail('INVALID_ARGUMENT');
  if (workPort && (typeof workPort.submit !== 'function' || typeof workPort.read !== 'function')) fail('INVALID_ARGUMENT');
  if (runtime !== null && !plain(runtime)) fail('INVALID_ARGUMENT');
  if (notificationPort && typeof notificationPort.send !== 'function') fail('INVALID_ARGUMENT');
  if (notificationService && (typeof notificationService.ingest !== 'function'
    || typeof notificationService.drain !== 'function')) fail('INVALID_ARGUMENT');
  if (policyPort && typeof policyPort.evaluate !== 'function' && typeof policyPort.authorize !== 'function') {
    fail('INVALID_ARGUMENT');
  }
  const policyConfigured = authorizationRef !== null || policyToolName !== null || policyScopes !== null;
  if (policyConfigured && (!text(authorizationRef) || !text(policyToolName) || !Array.isArray(policyScopes)
    || policyScopes.length === 0 || policyScopes.some(scope => !text(scope)))) fail('INVALID_ARGUMENT');
  if (readTrackingGrant && typeof readTrackingGrant !== 'function') fail('INVALID_ARGUMENT');
  if (readTrackingGrantSnapshot && typeof readTrackingGrantSnapshot !== 'function') fail('INVALID_ARGUMENT');
  if (readFeedReceiptEvidence && typeof readFeedReceiptEvidence !== 'function') fail('INVALID_ARGUMENT');
  if (readInterestSignal && typeof readInterestSignal !== 'function') fail('INVALID_ARGUMENT');
  if (knowledgeFeedReceipts && ['createKnowledgeFeedReceipt', 'parseKnowledgeFeedReceipt',
    'verifyKnowledgeFeedReceiptBinding', 'knowledgeFeedReceiptItems']
    .some(name => typeof knowledgeFeedReceipts[name] !== 'function')) fail('INVALID_ARGUMENT');
  if (scheduler && (typeof scheduler.createSchedule !== 'function'
    || typeof scheduler.listSchedules !== 'function'
    || typeof scheduler.reconcileSchedules !== 'function')) fail('INVALID_ARGUMENT');
  const wrappedLaya = !interestDecider && Boolean(layaChooser);
  if (wrappedLaya) interestDecider = new LayaInterestDecisionService(layaChooser, now);
  if (!workPort && typeof runtime?.submitTask === 'function'
    && typeof runtime?.findTaskByIdempotencyKey === 'function') {
    workPort = adaptRuntimeWork(runtime, namespace);
  }
  if (!notificationPort && notificationService) notificationPort = adaptNotificationService(notificationService, namespace);
  const boundScheduler = scheduler ?? (typeof runtime?.createSchedule === 'function'
    && typeof runtime?.listSchedules === 'function'
    && typeof runtime?.reconcileSchedules === 'function' ? runtime : null);

  const checkpointKey = knowledgeWatchCheckpointKey(namespace);
  let document = null;
  let health = {status: 'ready'};
  let running = false;
  let disposed = false;
  let unsubscribe = null;
  let controller = null;
  let chain = Promise.resolve();
  let subscriptionActive = false;
  let registeredSchedule = false;
  let life = 0;
  let feedReading = false;
  const activeFeedChecks = new Set();
  const activeInterestTasks = new Set();

  function clock() {
    const value = now();
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_ARGUMENT');
    return value;
  }
  function lock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }
  function load() {
    let raw;
    try { raw = checkpoints.loadCheckpoint(checkpointTaskId, checkpointKey); }
    catch { health = {status: 'unreadable', reason: 'checkpoint_load_failed'}; document = null; return; }
    const parsed = readableCheckpoint(raw, namespace);
    if (!parsed.ok) { health = {status: 'unreadable', reason: parsed.reason}; document = null; return; }
    health = {status: 'ready'};
    document = parsed.empty ? emptyDocument(namespace) : clone(parsed.document);
  }
  function persist(next) {
    checkpoints.saveCheckpoint(checkpointTaskId, checkpointKey, next);
    document = next;
  }
  function requireReady() {
    if (disposed) fail('DISPOSED');
    if (!running) fail('STOPPED');
    if (health.status !== 'ready' || !document) fail('CHECKPOINT_UNREADABLE');
  }
  function wiring() {
    return {
      profile: PROFILE,
      source: feedCollect ? 'feeds' : sourcePort ? 'injected' : 'unavailable',
      subscription: subscriptionActive,
      scheduler: Boolean(boundScheduler),
      layaChooser: wrappedLaya,
      interestDecider: Boolean(interestDecider),
      workPort: Boolean(workPort),
      notificationPort: Boolean(notificationPort),
      policyPort: Boolean(policyPort),
      main: false,
    };
  }
  function projectWatch(watch) {
    const current = clock();
    const state = watch.state === 'tracked' && watch.expiresAt && instant(watch.expiresAt) <= current
      ? 'expired' : watch.state;
    return {...clone(watch), state, label: LABELS[state]};
  }
  function sourceFreshness(binding) {
    const head = document.sources[binding.sourceId];
    const sourceState = head?.availability === 'withdrawn' ? 'withdrawn'
      : head?.availability === 'unavailable' ? 'unavailable' : 'available';
    const input = {at: iso(clock()), maxAgeMs: knowledgeMaxAgeMs, requestedVersion: binding.cacheVersion,
      sourceState, cache: {version: binding.cacheVersion, sourceId: binding.sourceId,
        sourceRevision: binding.revision, contentSha256: binding.contentSha256,
        lastSuccessfulCheck: binding.lastSuccessfulCheck, validUntil: binding.validUntil}};
    if (sourceState === 'available' && text(head?.revision) && sha(head?.contentSha256)
      && Number.isFinite(instant(head.observedAt))) {
      input.check = {outcome: head.revision === binding.revision && head.contentSha256 === binding.contentSha256
        ? 'unchanged' : 'changed', checkedAt: head.observedAt, sourceId: binding.sourceId,
        sourceRevision: binding.revision, cachedContentSha256: binding.contentSha256};
    }
    try {
      const decision = decideKnowledgeFreshness(input);
      return {action: decision.action, reason: decision.reason, sourceRevision: decision.sourceRevision,
        contentSha256: decision.contentSha256, lastSuccessfulCheck: decision.lastSuccessfulCheck};
    } catch {
      return {action: 'last_verified_only', reason: 'freshness_unknown'};
    }
  }
  function receiptForHead(head, sourceId) {
    if (!head) return null;
    let taskId = head.sourceReadTaskId;
    let receiptId = head.sourceReadReceiptId;
    if (!receiptId) {
      const candidates = Object.values(document.submissions).map(item => item.recheckContext).filter(ctx =>
        ctx?.sourceId === sourceId && ctx.observedRevision === head.revision
        && ctx.observedContentSha256 === head.contentSha256 && ctx.observedAt === head.observedAt
        && ctx.citation === head.citation && ctx.sourceReadTaskId === checkpointTaskId);
      const ids = [...new Set(candidates.map(ctx => ctx.sourceReadReceiptId))];
      if (ids.length !== 1) return null;
      taskId = checkpointTaskId;
      receiptId = ids[0];
    }
    if (taskId !== checkpointTaskId) return null;
    return readFeedSourceReceipt(checkpoints, taskId, receiptId, knowledgeFeedReceipts);
  }
  function trustedReceiptEvidence(head, sourceId, receipt = receiptForHead(head, sourceId)) {
    if (!receipt || receipt.version !== 2 || typeof readFeedReceiptEvidence !== 'function') return false;
    try {
      // P8 owns run/query/task binding. This synchronous reader rebuilds the receipt from actual Runtime records.
      const verified = readFeedReceiptEvidence({namespace, sourceId,
        sourceReadTaskId: checkpointTaskId, receiptId: receipt.receiptId});
      const parsed = knowledgeFeedReceipts?.parseKnowledgeFeedReceipt(verified);
      return parsed?.version === 2 && JSON.stringify(parsed) === JSON.stringify(receipt);
    } catch { return false; }
  }
  function dialogueView() {
    if (!document) return null;
    const items = Object.values(document.watches).map(watch => {
      const projected = projectWatch(watch);
      const binding = projected.boundSource;
      let grantCurrent = !readTrackingGrant || typeof readTrackingGrantSnapshot === 'function';
      if (projected.scope?.state === 'granted' && instant(projected.scope.expiresAt) <= clock()) grantCurrent = false;
      if (readTrackingGrantSnapshot && projected.state === 'tracked') {
        try {
          const identity = grantIdentity(projected);
          const grant = identity && readTrackingGrantSnapshot(identity);
          grantCurrent = plain(grant) && grant.state === 'granted' && grant.publicLowRiskTracking === true
            && grant.id === projected.scope?.id && grant.revision === projected.scope?.revision
            && grant.expiresAt === projected.scope?.expiresAt && instant(grant.expiresAt) > clock();
        } catch { grantCurrent = false; }
      }
      const bound = binding && text(binding.sourceId) && text(binding.revision) && sha(binding.contentSha256)
        && text(binding.cacheVersion) && Number.isFinite(instant(binding.lastSuccessfulCheck))
        && Number.isFinite(instant(binding.validUntil));
      const freshness = projected.state === 'revoked'
        ? {action: 'unavailable', reason: 'user_revoked'}
        : projected.state === 'expired' ? {action: 'last_verified_only', reason: 'watch_expired'}
        : projected.state === 'suggested' || !bound
          ? {action: 'not_bound', reason: projected.state === 'suggested' ? 'suggested_only' : 'no_source_binding'}
          : sourceFreshness(binding);
      const head = bound ? document.sources[binding.sourceId] : null;
      const sourceReceipt = receiptForHead(head, binding?.sourceId);
      const quotedItems = sourceReceipt && knowledgeFeedReceipts
        ? knowledgeFeedReceipts.knowledgeFeedReceiptItems(sourceReceipt) : null;
      const receiptMatchesHead = (!head?.sourceReadReceiptId && head?.provider !== 'feeds') || sourceReceipt
        && sourceReceipt.sourceId === binding.sourceId && sourceReceipt.revision === head.revision
        && sourceReceipt.contentSha256 === head.contentSha256 && sourceReceipt.citation === head.citation
        && sourceReceipt.observedAt === head.observedAt && sourceReceipt.namespace === namespace
        && (!knowledgeFeedReceipts || quotedItems?.length > 0);
      const same = !!(head && head.revision === binding.revision && head.contentSha256 === binding.contentSha256);
      const citation = same && text(head?.citation) ? head.citation : null;
      const unknown = bound && Object.values(document.submissions).some(item =>
        item.sourceId === binding.sourceId && item.state === 'unknown'
        && (!item.recheckContext || item.recheckContext.topicId === projected.topicId
          && item.recheckContext.consumerRevision === projected.consumer?.revision));
      const usableAsCurrentFact = projected.state === 'tracked' && freshness.action === 'use_cache'
        && Boolean(readTrackingGrant && readTrackingGrantSnapshot) && grantCurrent && text(citation) && !unknown && receiptMatchesHead
        && trustedReceiptEvidence(head, binding.sourceId, sourceReceipt);
      const notice = Object.values(document.notices)
        .filter(item => Array.isArray(item.topicIds) && item.topicIds.includes(projected.topicId))
        .sort((left, right) => instant(right.latest?.fetchedAt) - instant(left.latest?.fetchedAt))[0] ?? null;
      // A topic's notice may remain older while another consumer advances the shared head.
      // Head receipt quotes can substantiate only the notice with this exact source identity.
      const noticeMatchesHead = !!(notice && head && notice.sourceId === binding?.sourceId
        && notice.latest?.revision === head.revision && notice.latest?.contentSha256 === head.contentSha256
        && notice.latest?.fetchedAt === head.observedAt && notice.citation === head.citation
        && notice.latest?.availability === head.availability);
      const latestObservation = head ? {availability: head.availability, revision: head.revision ?? null,
        contentSha256: head.contentSha256 ?? null, fetchedAt: head.observedAt ?? null,
        citation: text(head.citation) ? head.citation : null, sameAsBinding: same} : null;
      const update = notice ? {noticeId: notice.id, knowledgeAction: notice.knowledge?.action ?? null,
        knowledgeReason: notice.knowledge?.reason ?? null, citation: text(notice.citation) ? notice.citation : null,
        sourceRevision: notice.latest?.revision ?? null, contentSha256: notice.latest?.contentSha256 ?? null,
        fetchedAt: notice.latest?.fetchedAt ?? null, availability: notice.latest?.availability ?? null,
        delivered: notice.delivered === true, deliveryReason: notice.deliveryReason ?? null,
        readAt: notice.readAt ?? null,
        usableAsLatestObservation: bound && projected.state === 'tracked'
          && text(notice.citation) && notice.latest?.availability === 'available' && !unknown
          && grantCurrent && receiptMatchesHead && noticeMatchesHead,
        dataClass: 'untrusted_source_text',
        untrustedExcerpt: projected.state === 'revoked' ? null : notice.untrustedExcerpt ?? null} : null;
      let answer;
      if (projected.state === 'revoked') answer = {kind: 'withheld', reason: 'user_revoked'};
      else if (projected.state === 'expired') answer = {kind: 'withheld', reason: 'watch_expired'};
      else if (projected.state === 'suggested') answer = {kind: 'withheld', reason: 'suggested_only'};
      else if (projected.state === 'paused') answer = {kind: 'withheld', reason: 'user_paused'};
      else if (projected.state === 'authorization_required') answer = {kind: 'withheld', reason: projected.reason};
      else if (!grantCurrent) answer = {kind: 'withheld', reason: 'authorization_required'};
      else if (!receiptMatchesHead) answer = {kind: 'withheld', reason: 'source_receipt_unavailable'};
      else if (projected.state === 'source_unavailable') answer = {kind: 'withheld', reason: freshness.reason};
      else if (unknown) answer = {kind: 'withheld', reason: 'submission_unknown'};
      else if (same && receiptMatchesHead && !trustedReceiptEvidence(head, binding.sourceId, sourceReceipt)) {
        answer = {kind: 'withheld', reason: 'source_evidence_unavailable'};
      }
      else if (usableAsCurrentFact) answer = {kind: 'current_fact', sourceId: binding.sourceId,
        sourceRevision: binding.revision, contentSha256: binding.contentSha256,
        fetchedAt: head.observedAt, citation};
      else if (update?.usableAsLatestObservation) answer = {kind: 'latest_observation',
        sourceId: binding.sourceId, sourceRevision: update.sourceRevision,
        contentSha256: update.contentSha256, fetchedAt: update.fetchedAt, citation: update.citation,
        boundRevision: binding.revision, boundContentSha256: binding.contentSha256};
      else if (latestObservation && !latestObservation.sameAsBinding && !text(latestObservation.citation)) {
        answer = {kind: 'withheld', reason: 'citation_missing'};
      } else if (freshness.action === 'use_cache' && !text(citation)) {
        answer = {kind: 'withheld', reason: 'citation_missing'};
      } else answer = {kind: 'withheld', reason: freshness.reason};
      if (['current_fact', 'latest_observation'].includes(answer.kind) && quotedItems?.length) {
        answer.items = clone(quotedItems);
        answer.citations = quotedItems.map(item => ({itemKey: item.itemKey, citation: item.citation,
          contentSha256: item.contentSha256, sourceRevision: item.sourceRevision}));
        if (new Set(quotedItems.map(item => item.citation)).size > 1) {
          answer.citationBundleRef = answer.citation;
          answer.citation = null;
        }
      }
      return {topicId: projected.topicId, state: projected.state, label: projected.label,
        reason: projected.reason, authorization: clone(projected.authorization ?? null),
        modelReceiptId: text(projected.modelReceiptId) ? projected.modelReceiptId : null,
        revocable: projected.state !== 'revoked', tombstoneId: projected.tombstoneId ?? null,
        usableAsCurrentFact, freshness, citation, answer,
        boundSource: bound ? {sourceId: binding.sourceId, revision: binding.revision,
          contentSha256: binding.contentSha256, validUntil: binding.validUntil,
          lastSuccessfulCheck: binding.lastSuccessfulCheck} : null,
        latestObservation, update, binding: bindingReadiness(projected, head)};
    }).sort((left, right) => left.topicId < right.topicId ? -1 : left.topicId > right.topicId ? 1 : 0);
    return {namespace, generatedAt: iso(clock()), dataClass: 'knowledge_watch_dialogue', items};
  }
  function snapshot() {
    const base = {namespace, running, disposed, health: clone(health), wiring: wiring(),
      checkpointKey, mountedInMain: false};
    if (!document) return {...base, watches: null, notices: null, submissions: null, sources: null, dialogue: null};
    return {...base,
      watches: Object.values(document.watches).map(projectWatch)
        .sort((a, b) => a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0),
      notices: Object.values(document.notices).map(clone),
      submissions: clone(document.submissions),
      sources: clone(document.sources),
      dialogue: dialogueView()};
  }
  function dialogueProjection() {
    if (!document) fail('CHECKPOINT_UNREADABLE');
    return dialogueView();
  }
  function listPending() {
    const view = snapshot();
    if (!document) fail('CHECKPOINT_UNREADABLE');
    return {
      watches: view.watches.filter(watch => ['suggested', 'authorization_required',
        'source_unavailable', 'paused'].includes(watch.state)),
      notices: view.notices.filter(notice => notice.delivered !== true || !notice.readAt),
      submissions: Object.values(view.submissions).filter(item => item.state === 'unknown'),
    };
  }
  function listWatches() {
    if (!document) fail('CHECKPOINT_UNREADABLE');
    return snapshot().watches;
  }

  function policyInput(signal, userEnable) {
    const watch = document.watches[signal.topicId];
    const tombstone = document.tombstones[signal.topicId];
    const input = {
      topicId: signal.topicId,
      at: signal.at,
      evidenceMaxAgeMs: signal.evidenceMaxAgeMs,
      watchDurationMs: signal.watchDurationMs,
      evidence: clone(signal.evidence),
      scope: clone(signal.scope),
    };
    if (signal.source) input.source = clone(signal.source);
    if (signal.classification) input.classification = clone(signal.classification);
    if (watch?.policyState) input.previous = {state: watch.policyState};
    if (tombstone) input.tombstone = clone(tombstone);
    if (userEnable) input.explicitEnable = clone(userEnable);
    return input;
  }
  function formalDecision(signal) {
    if (typeof policyPort?.authorize === 'function' && typeof policyPort.evaluate !== 'function') {
      if (!policyConfigured) return {allowed: false, reason: 'policy_request_incomplete'};
      try {
        const decision = policyPort.authorize({
          authorizationRef,
          taskId: checkpointTaskId,
          toolName: policyToolName,
          requiredScopes: [...policyScopes],
          now: clock(),
        });
        const scopes = Array.isArray(decision?.scopes) ? decision.scopes.filter(text) : [];
        if (policyScopes.every(scope => scopes.includes(scope))) {
          return {allowed: true, reason: 'authorized', scopes};
        }
        return {allowed: false, reason: 'scope_missing'};
      } catch (error) {
        return {allowed: false, reason: text(error?.code) ? error.code : 'policy_failed'};
      }
    }
    if (typeof policyPort?.evaluate !== 'function') return {allowed: false, reason: 'policy_port_missing'};
    let decision;
    try {
      decision = policyPort.evaluate({namespace, topicId: signal.topicId, action: 'track_public',
        risk: signal.source?.risk ?? 'low', scopeExpansion: signal.requestsScopeExpansion === true,
        sourceId: signal.source?.id ?? null});
    } catch { return {allowed: false, reason: 'policy_failed'}; }
    if (decision?.allowed === true) {
      return {allowed: true, reason: text(decision.reason) ? decision.reason : 'allowed'};
    }
    return {allowed: false, reason: text(decision?.reason) ? decision.reason : 'denied'};
  }
  function needsFormalPolicy(signal) {
    return signal.requestsScopeExpansion === true || signal.source?.risk === 'high'
      || signal.source?.visibility === 'private';
  }
  function sourceReady(signal) {
    const content = signal.sourceContent;
    return plain(content) && sha(content.contentSha256) && text(content.cacheVersion)
      && Number.isFinite(instant(content.lastSuccessfulCheck))
      && Number.isFinite(instant(content.validUntil));
  }
  function nextState(policy, signal, approach, blocked) {
    if (policy.state === 'revoked') return ['revoked', policy.reason];
    if (blocked) return ['authorization_required', blocked];
    if (policy.state === 'decay') return ['expired', policy.reason];
    if (policy.state === 'candidate') return ['suggested', policy.reason];
    if (policy.state === 'abstain') {
      if (policy.reason === 'public_source_not_verified') {
        if (signal.source?.risk === 'high' || signal.source?.visibility === 'private') {
          return ['authorization_required', policy.reason];
        }
        return ['source_unavailable', policy.reason];
      }
      if (policy.reason === 'tracking_scope_unavailable') return ['authorization_required', policy.reason];
      return ['suggested', policy.reason];
    }
    if (policy.state === 'watch_public' && approach === 'track_public') {
      if (!sourceReady(signal)) return ['suggested', 'source_identity_incomplete'];
      return ['tracked', policy.reason];
    }
    if (policy.state === 'watch_public') return ['suggested', interestDecider ? 'interest_decision_withheld' : 'decision_port_missing'];
    return ['suggested', policy.reason];
  }
  function authorizationFor(signal, state, formal) {
    if (formal) return {basis: 'formal_policy', allowed: formal.allowed === true, reason: formal.reason};
    if (state === 'tracked') return {basis: 'existing_public_low_risk_scope'};
    return {basis: 'interest_policy'};
  }
  function writeWatch(signal, policy, state, reason, approach, formal, choice) {
    const previous = document.watches[signal.topicId];
    if (previous?.state === 'paused' && state === 'tracked' && signal.resume !== true) {
      state = 'paused';
      reason = 'user_paused';
    }
    if (previous?.state === 'revoked' && state !== 'revoked' && !signal.userEnableApplied) {
      state = 'revoked';
      reason = 'user_revoked';
    }
    const revision = state === 'tracked' && (previous?.state !== 'tracked'
      || previous?.consumer?.intakeTaskId !== signal.intakeTaskId
      || ['id', 'revision', 'state', 'publicLowRiskTracking', 'expiresAt']
        .some(key => previous?.scope?.[key] !== signal.scope[key])) ? (previous?.revision ?? 0) + 1
      : previous?.revision ?? 1;
    const watch = {
      topicId: signal.topicId,
      state,
      label: LABELS[state],
      reason,
      policyState: state === 'revoked' ? 'revoked' : policy.state,
      evidence: clone(policy.evidence ?? []),
      scope: {id: signal.scope.id, revision: signal.scope.revision, state: signal.scope.state,
        publicLowRiskTracking: signal.scope.publicLowRiskTracking, expiresAt: signal.scope.expiresAt},
      revision,
      updatedAt: signal.at,
      authorization: authorizationFor(signal, state, formal),
    };
    if (policy.expiresAt) watch.expiresAt = policy.expiresAt;
    if (signal.source) watch.source = {id: signal.source.id, revision: signal.source.revision};
    if (state === 'tracked' && sourceReady(signal)) {
      watch.boundSource = {sourceId: signal.source.id, revision: signal.source.revision,
        contentSha256: signal.sourceContent.contentSha256, cacheVersion: signal.sourceContent.cacheVersion,
        lastSuccessfulCheck: signal.sourceContent.lastSuccessfulCheck,
        validUntil: signal.sourceContent.validUntil};
      watch.consumer = {id: signal.topicId, revision,
        ...(identifier(signal.intakeTaskId) ? {intakeTaskId: signal.intakeTaskId} : {})};
    } else if (previous?.boundSource && state !== 'tracked') {
      watch.boundSource = clone(previous.boundSource);
      watch.consumer = previous.consumer ? clone(previous.consumer) : {id: signal.topicId, revision: previous.revision};
    }
    if (approach) watch.selectedApproach = approach;
    if (choice?.receipt?.modelReceiptId && text(choice.receipt.modelReceiptId)) {
      watch.modelReceiptId = choice.receipt.modelReceiptId;
    }
    const next = clone(document);
    if (state === 'revoked') {
      if (!next.tombstones[signal.topicId]) {
        next.tombstones[signal.topicId] = {id: `policy-${digest([signal.topicId, reason, signal.at]).slice(0, 24)}`,
          topicId: signal.topicId, revokedAt: signal.at};
      }
      watch.revokedAt = next.tombstones[signal.topicId].revokedAt;
      watch.tombstoneId = next.tombstones[signal.topicId].id;
    }
    next.watches[signal.topicId] = watch;
    persist(next);
    return clone(watch);
  }

  function pickInterest(raw) {
    if (!plain(raw) || raw.namespace !== namespace) fail(raw?.namespace && raw.namespace !== namespace
      ? 'NAMESPACE_MISMATCH' : 'INVALID_ARGUMENT');
    if (!identifier(raw.topicId) || !Number.isFinite(instant(raw.at))) fail('INVALID_ARGUMENT');
    if (!Array.isArray(raw.evidence) || !plain(raw.scope)) fail('INVALID_ARGUMENT');
    const signal = {namespace, topicId: raw.topicId, at: raw.at,
      evidenceMaxAgeMs: raw.evidenceMaxAgeMs, watchDurationMs: raw.watchDurationMs,
      evidence: clone(raw.evidence), scope: clone(raw.scope)};
    if (plain(raw.source)) signal.source = clone(raw.source);
    if (plain(raw.classification)) signal.classification = clone(raw.classification);
    if (plain(raw.sourceContent)) signal.sourceContent = clone(raw.sourceContent);
    if (raw.requestsScopeExpansion === true) signal.requestsScopeExpansion = true;
    return signal;
  }
  function offered(policyOptions, selected) {
    return !!selected && policyOptions.some(option => option.id === selected.id
      && option.revision === selected.revision);
  }
  function commitInterest(signal, choice, userEnable) {
    requireReady();
    const current = clock();
    if (instant(signal.at) > current) fail('INVALID_ARGUMENT');
    const enablement = userEnable && userEnable.topicId === signal.topicId
      && identifier(userEnable.id) && Number.isFinite(instant(userEnable.occurredAt))
      ? {id: userEnable.id, topicId: signal.topicId, occurredAt: userEnable.occurredAt} : null;
    const input = policyInput({...signal, at: iso(current)}, enablement);
    let built;
    try { built = buildInterestOptions(input); }
    catch { fail('INVALID_ARGUMENT'); }
    const freshSelected = choice?.outcome === 'selected' && choice.requiresHostRevalidation === true
      && offered(built.options, choice.selected) ? choice.selected : null;
    const approach = built.policy.state === 'watch_public' && freshSelected?.id === 'track_public'
      ? 'track_public' : null;
    let formal = null;
    let blocked = null;
    if (needsFormalPolicy(signal)) {
      formal = formalDecision(signal);
      if (formal.allowed !== true) blocked = formal.reason;
    }
    if (approach !== 'track_public') formal = needsFormalPolicy(signal) ? formal : null;
    const selectedApproach = blocked ? null : approach;
    const [state, reason] = nextState(built.policy, signal, selectedApproach, blocked);
    const applied = {...signal, at: iso(current), userEnableApplied: Boolean(enablement)};
    const watch = writeWatch(applied, built.policy, state, reason, selectedApproach, formal, choice);
    return {accepted: true, watch};
  }

  function bindingKey(binding) {
    return `${binding.sourceId}\n${binding.revision}\n${binding.contentSha256}`;
  }
  function trackedGroups(sourceId) {
    const groups = new Map();
    for (const watch of Object.values(document.watches)) {
      if (watch.state !== 'tracked' || watch.boundSource?.sourceId !== sourceId) continue;
      const key = bindingKey(watch.boundSource);
      if (!groups.has(key)) groups.set(key, {binding: watch.boundSource, watches: []});
      groups.get(key).watches.push(watch);
    }
    return [...groups.values()];
  }
  function pickSource(raw) {
    if (!plain(raw) || !identifier(raw.sourceId)) fail('INVALID_ARGUMENT');
    if (raw.namespace !== namespace) fail('NAMESPACE_MISMATCH');
    if (!['available', 'unavailable', 'withdrawn'].includes(raw.availability)) fail('INVALID_ARGUMENT');
    if (!Number.isFinite(instant(raw.fetchedAt))) fail('INVALID_ARGUMENT');
    const event = {namespace, sourceId: raw.sourceId, availability: raw.availability, fetchedAt: raw.fetchedAt};
    if (text(raw.revision)) event.revision = raw.revision;
    if (typeof raw.contentSha256 === 'string') event.contentSha256 = raw.contentSha256;
    if (typeof raw.summary === 'string') event.summary = clip(raw.summary, 2000);
    if (plain(raw.citation) && text(raw.citation.locator)) event.citation = {locator: clip(raw.citation.locator, 500)};
    if (text(raw.cacheVersion)) event.cacheVersion = raw.cacheVersion;
    if (text(raw.requestedVersion)) event.requestedVersion = raw.requestedVersion;
    if (Number.isFinite(raw.maxAgeMs) && raw.maxAgeMs > 0) event.maxAgeMs = raw.maxAgeMs;
    if (text(raw.reason)) event.reason = clip(raw.reason, 200);
    if (text(raw.provider)) event.provider = clip(raw.provider, 80);
    if (text(raw.feedCursor)) event.feedCursor = raw.feedCursor;
    if (raw.sourceReadTaskId !== undefined || raw.sourceReadReceiptId !== undefined) {
      if (!identifier(raw.sourceReadTaskId) || !sha(raw.sourceReadReceiptId)) fail('INVALID_ARGUMENT');
      event.sourceReadTaskId = raw.sourceReadTaskId;
      event.sourceReadReceiptId = raw.sourceReadReceiptId;
    }
    if (plain(raw.check)) event.check = clone(raw.check);
    return event;
  }
  function freshnessFor(group, event) {
    const binding = group.binding;
    const changed = event.availability === 'available'
      && (event.contentSha256 ? event.contentSha256 !== binding.contentSha256
        : event.revision !== binding.revision);
    const check = changed ? {outcome: 'changed', checkedAt: event.fetchedAt, sourceId: binding.sourceId,
      sourceRevision: binding.revision, cachedContentSha256: binding.contentSha256} : event.check;
    return {at: event.fetchedAt, maxAgeMs: event.maxAgeMs ?? knowledgeMaxAgeMs,
      requestedVersion: event.requestedVersion ?? (changed && event.revision ? event.revision : binding.cacheVersion),
      sourceState: event.availability, cache: {version: binding.cacheVersion, sourceId: binding.sourceId,
        sourceRevision: binding.revision, contentSha256: binding.contentSha256,
        lastSuccessfulCheck: binding.lastSuccessfulCheck, validUntil: binding.validUntil},
      ...(check ? {check} : {})};
  }
  function recheckContextFor(work, event, binding) {
    const context = {version: 1, namespace, workKey: work.workKey,
      topicId: work.consumer?.id, consumerRevision: work.consumer?.revision,
      sourceId: work.source?.id, boundRevision: work.source?.revision,
      boundContentSha256: work.source?.contentSha256,
      boundCacheVersion: binding?.cacheVersion,
      boundLastSuccessfulCheck: binding?.lastSuccessfulCheck,
      boundValidUntil: binding?.validUntil,
      observedRevision: event.revision, observedContentSha256: event.contentSha256,
      observedAt: event.fetchedAt, availability: event.availability, citation: event.citation?.locator,
      sourceReadTaskId: event.sourceReadTaskId, sourceReadReceiptId: event.sourceReadReceiptId,
      ...(typeof event.summary === 'string' ? {summary: event.summary} : {})};
    return validRecheckContext(context, work.workKey, namespace) ? context : null;
  }
  function prepareSource(event) {
    requireReady();
    const at = instant(event.fetchedAt);
    if (at > clock()) fail('INVALID_ARGUMENT');
    expireDue();
    const head = document.sources[event.sourceId];
    if (head && instant(head.observedAt) > at) return {accepted: false, reason: 'stale_event', duplicate: false};
    const duplicate = !!(head && head.observedAt === event.fetchedAt && head.revision === (event.revision ?? null)
      && head.contentSha256 === (event.contentSha256 ?? null) && head.availability === event.availability);
    if (duplicate && !trustedReceiptEvidence(head, event.sourceId)) {
      return {accepted: true, reason: 'duplicate_event', duplicate: true, notified: false};
    }
    if (!duplicate && head && head.observedAt === event.fetchedAt) return {accepted: false, reason: 'ambiguous_timestamp'};
    if (event.availability === 'available' && event.revision && event.contentSha256
      && head?.revision === event.revision && head.contentSha256 && head.contentSha256 !== event.contentSha256) {
      return {accepted: false, reason: 'revision_hash_conflict'};
    }
    const plans = [];
    for (const group of trackedGroups(event.sourceId)) {
      if (event.availability === 'available' && event.revision === group.binding.revision
        && event.contentSha256 && event.contentSha256 !== group.binding.contentSha256) {
        return {accepted: false, reason: 'revision_hash_conflict'};
      }
      const prior = document.reevaluations[bindingKey(group.binding)];
      let plan;
      try {
        plan = planKnowledgeReevaluation({namespace, freshness: freshnessFor(group, event),
          dependencies: group.watches.filter(watch => watch.consumer).map(watch => ({
            consumer: {id: watch.consumer.id, revision: watch.consumer.revision}, sourceId: group.binding.sourceId,
            sourceRevision: group.binding.revision, contentSha256: group.binding.contentSha256})),
          ...(prior ? {checkpoint: clone(prior)} : {})});
      } catch { return {accepted: false, reason: 'invalid_source_event'}; }
      plans.push({group, plan});
    }
    const keys = [];
    const next = clone(document);
    for (const item of plans) {
      for (const work of item.plan.affected) {
        const recheckContext = recheckContextFor(work, event, item.group.binding);
        const existing = next.submissions[work.workKey];
        if (existing?.recheckContext && (!recheckContext
          || !sameRecheckIdentity(existing.recheckContext, recheckContext))) {
          return {accepted: false, reason: 'reevaluation_identity_conflict'};
        }
        if (duplicate && existing?.state === 'unknown' && !work.duplicate) {
          work.duplicate = true;
          item.plan.checkpoint.submittedWorkKeys = item.plan.checkpoint.submittedWorkKeys.filter(key => key !== work.workKey);
        }
        // Replaying a durable head may fill only a NEW consumer's work key. Never retry old unknown work.
        if (work.duplicate || existing?.state === 'accepted' || duplicate && existing) continue;
        next.submissions[work.workKey] = {...(existing ?? {}), state: 'unknown', namespace,
          attemptedAt: event.fetchedAt, sourceId: event.sourceId,
          ...((existing?.recheckContext ?? recheckContext)
            ? {recheckContext: existing?.recheckContext ?? recheckContext} : {})};
        keys.push(work.workKey);
      }
    }
    if (keys.length && !workPort && event.availability === 'available') {
      return {accepted: false, reason: 'work_port_missing', proceed: false};
    }
    const skipWork = keys.length > 0 && !workPort;
    if (keys.length && workPort) persist(next);
    return {accepted: true, proceed: true, plans, event, keys: workPort ? keys : [], skipWork};
  }
  // Only the trusted Runtime intake entry point can attach a task identity to a signal.
  const intakeTaskBinding = Symbol('knowledge-watch-intake-task');
  function grantIdentity(watch) {
    const sourceId = watch?.boundSource?.sourceId;
    const taskId = watch?.consumer?.intakeTaskId;
    return identifier(sourceId) && identifier(taskId) ? {namespace, sourceId, taskId} : null;
  }
  function grantMatches(grant, scope) {
    return plain(grant) && grant.state === 'granted' && grant.publicLowRiskTracking === true
      && identifier(grant.id) && Number.isSafeInteger(grant.revision) && grant.revision >= 1
      && Number.isFinite(instant(grant.expiresAt)) && instant(grant.expiresAt) > clock()
      && (!scope || grant.id === scope.id && grant.revision === scope.revision && grant.expiresAt === scope.expiresAt);
  }
  function sourceGrantWatches(sourceId) {
    return Object.values(document?.watches ?? {}).filter(watch => watch.state === 'tracked'
      && !document.tombstones[watch.topicId] && watch.boundSource?.sourceId === sourceId);
  }
  function sourceGrantCurrent(sourceId) {
    if (!readTrackingGrant) return true;
    if (!readTrackingGrantSnapshot) return false;
    const watches = sourceGrantWatches(sourceId);
    return watches.length > 0 && watches.every(watch => {
      const identity = grantIdentity(watch);
      try { return !!identity && activeTracking(watch) && grantMatches(readTrackingGrantSnapshot(identity), watch.scope); }
      catch { return false; }
    });
  }
  async function grantStatus(sourceId) {
    if (typeof readTrackingGrant !== 'function') return 'unchecked';
    if (!identifier(sourceId)) return 'revoked';
    const watches = sourceGrantWatches(sourceId).map(clone);
    if (!watches.length) return 'revoked';
    try {
      for (const watch of watches) {
        const identity = grantIdentity(watch);
        if (!identity || !activeTracking(watch)) return 'revoked';
        const grant = await readTrackingGrant(identity);
        const current = document?.watches[watch.topicId];
        if (!grantMatches(grant, watch.scope) || !activeTracking(current)
          || JSON.stringify(trackingIdentity(current)) !== JSON.stringify(trackingIdentity(watch))) {
          return 'revoked';
        }
      }
      return sourceGrantCurrent(sourceId) ? 'granted' : 'revoked';
    } catch { return 'unreadable'; }
  }
  async function boundStillTracked(work) {
    const watch = await lock(() => {
      if (!running || !document) return false;
      const topicId = work?.consumer?.id;
      if (!identifier(topicId) || document.tombstones[topicId]) return false;
      const watch = document.watches[topicId];
      return watch?.state === 'tracked' && (!watch.expiresAt || instant(watch.expiresAt) > clock())
        && instant(watch.scope?.expiresAt) > clock() && watch.consumer?.revision === work.consumer?.revision
        && (work.consumer?.intakeTaskId === undefined || watch.consumer?.intakeTaskId === work.consumer.intakeTaskId)
        && watch.boundSource?.sourceId === work.source?.id
        && watch.boundSource?.revision === work.source?.revision
        && watch.boundSource?.contentSha256 === work.source?.contentSha256 ? clone(watch) : false;
    });
    if (!watch) return false;
    if (!readTrackingGrant) return true;
    try {
      const identity = grantIdentity(watch);
      if (!identity) return false;
      const grant = await readTrackingGrant(identity);
      const current = document?.watches[watch.topicId];
      return activeTracking(current) && JSON.stringify(trackingIdentity(current)) === JSON.stringify(trackingIdentity(watch))
        && grantMatches(grant, watch.scope);
    } catch { return false; }
  }
  async function submitKeys(keys, plans, operation) {
    const accepted = new Set();
    const unknown = new Set();
    const skipped = new Set();
    const works = new Map();
    for (const item of plans) for (const work of item.plan.affected) works.set(work.workKey, work);
    for (const workKey of keys) {
      if (!(await operation.revalidate())) { unknown.add(workKey); continue; }
      const current = document.submissions[workKey];
      if (current?.state === 'accepted') { accepted.add(workKey); continue; }
      let verdict = 'absent';
      try {
        const read = await workPort.read({namespace, idempotencyKey: workKey, signal: operation.signal});
        if (!(await operation.revalidate())) { unknown.add(workKey); continue; }
        verdict = read?.state === 'accepted' && text(read.taskId) ? 'accepted'
          : read?.state === 'absent' ? 'absent' : 'unknown';
        if (verdict === 'accepted') {
          accepted.add(workKey);
          await lock(() => {
            if (!document?.submissions[workKey] || !operation.current()) return;
            const next = clone(document);
            next.submissions[workKey] = {...next.submissions[workKey], state: 'accepted', namespace,
              taskId: read.taskId, sourceId: current?.sourceId};
            persist(next);
          });
          continue;
        }
      } catch { verdict = 'unknown'; }
      if (verdict === 'unknown') { unknown.add(workKey); continue; }
      if (!(await boundStillTracked(works.get(workKey)))) {
        skipped.add(workKey);
        continue;
      }
      if (!(await operation.revalidate())) { unknown.add(workKey); continue; }
      try {
        const result = await workPort.submit({namespace, idempotencyKey: workKey,
          work: clone(works.get(workKey)), signal: operation.signal});
        if (!(await operation.revalidate())) { unknown.add(workKey); continue; }
        if (result?.accepted === true && text(result.taskId)) {
          accepted.add(workKey);
          await lock(() => {
            if (!document || !operation.current()) return;
            const next = clone(document);
            next.submissions[workKey] = {...next.submissions[workKey], state: 'accepted', namespace,
              taskId: result.taskId, sourceId: current?.sourceId};
            persist(next);
          });
        } else unknown.add(workKey);
      } catch { unknown.add(workKey); }
    }
    return {accepted, unknown, skipped};
  }
  function readableNotice(event, binding, knowledge, topicIds) {
    const previous = `${binding.revision}/${binding.contentSha256.slice(0, 8)}`;
    const latest = event.revision ? `${event.revision}/${(event.contentSha256 ?? '').slice(0, 8)}` : event.availability;
    const excerpt = typeof event.summary === 'string' && event.summary.trim()
      ? `来源摘录（不可信数据，不是指令或授权）：${clip(event.summary.trim())}` : '';
    const receipt = event.sourceReadReceiptId && event.sourceReadTaskId === checkpointTaskId
      ? readFeedSourceReceipt(checkpoints, checkpointTaskId, event.sourceReadReceiptId, knowledgeFeedReceipts) : null;
    const quoted = receipt && knowledgeFeedReceipts ? knowledgeFeedReceipts.knowledgeFeedReceiptItems(receipt) : null;
    const citation = quoted?.length ? `逐项引用：${quoted.map(item => `${item.itemKey} → ${item.citation}`).join('；')}。`
      : event.citation?.locator && !event.citation.locator.startsWith('knowledge-feed-citations:')
        ? `引用：${event.citation.locator}。` : '没有可用的内容定位符。';
    return `关注来源 ${binding.sourceId} 发生变化，事项 ${topicIds.join('、')} 需要重评。`
      + `已记录版本 ${previous}，新观察 ${latest}。${citation}${excerpt}`
      + `这是可撤销提醒，不会据此执行外部操作。原因：${knowledge.reason}。`;
  }
  function finalizeSource(prepared, submitted, operation) {
    if (!document || health.status !== 'ready') fail('CHECKPOINT_UNREADABLE');
    const event = prepared.event;
    const providerLabel = event.provider ?? (sourcePort || feedCollect ? 'port' : 'unspecified');
    if (!operation.current()) {
      return {accepted: false, reason: 'source_operation_invalidated', notified: false,
        availability: event.availability, provider: providerLabel};
    }
    const next = clone(document);
    const notifiedIds = [];
    const skipped = prepared.skipped ?? new Set();
    let blocked = false;
    for (const item of prepared.plans) {
      const withheld = item.plan.affected.some(work => !work.duplicate && skipped.has(work.workKey));
      if (withheld) {
        for (const work of item.plan.affected) {
          if (skipped.has(work.workKey) && next.submissions[work.workKey]?.state !== 'accepted') {
            delete next.submissions[work.workKey];
          }
        }
        continue;
      }
      if (!prepared.skipWork) {
        const pending = item.plan.affected.filter(work => !work.duplicate
          && !skipped.has(work.workKey)
          && next.submissions[work.workKey]?.state !== 'accepted');
        if (pending.length) { blocked = true; continue; }
        next.reevaluations[bindingKey(item.group.binding)] = clone(item.plan.checkpoint);
      }
      const fresh = item.plan.affected.filter(work => !work.duplicate);
      if (!fresh.length || item.plan.knowledge.action === 'use_cache') continue;
      const topicIds = item.group.watches.map(watch => watch.topicId)
        .filter(topicId => fresh.some(work => work.consumer.id === topicId)
          && (next.watches[topicId]?.state === 'tracked'
          || event.availability !== 'available' && next.watches[topicId]?.state !== 'revoked'));
      if (!topicIds.length) continue;
      const id = digest({namespace, sourceId: event.sourceId, binding: item.group.binding.revision,
        content: item.group.binding.contentSha256, reason: item.plan.knowledge.reason,
        workKeys: fresh.map(work => work.workKey)});
      const locator = event.citation?.locator ?? null;
      if (next.notices[id]) {
        if (!text(next.notices[id].citation) && text(locator) && next.notices[id].delivered !== true) {
          next.notices[id].citation = locator;
          next.notices[id].summary = readableNotice(event, item.group.binding, item.plan.knowledge, topicIds);
          next.notices[id].deliveryReason = 'pending';
          notifiedIds.push(id);
        }
        continue;
      }
      next.notices[id] = {id, namespace, topicIds: [...topicIds], sourceId: event.sourceId,
        previous: {revision: item.group.binding.revision, contentSha256: item.group.binding.contentSha256},
        latest: {revision: event.revision ?? null, contentSha256: event.contentSha256 ?? null,
          fetchedAt: event.fetchedAt, availability: event.availability},
        citation: locator,
        knowledge: {action: item.plan.knowledge.action, reason: item.plan.knowledge.reason},
        summary: readableNotice(event, item.group.binding, item.plan.knowledge, topicIds),
        untrustedExcerpt: typeof event.summary === 'string' ? clip(event.summary.trim()) : null,
        createdAt: event.fetchedAt, delivered: false,
        deliveryReason: locator ? 'pending' : 'citation_missing', revocable: true};
      notifiedIds.push(id);
    }
    const confirmsBoundCache = prepared.plans.some(item => item.group.binding.revision === event.revision
      && item.group.binding.contentSha256 === event.contentSha256);
    const existing = next.sources[event.sourceId];
    const preserveHead = existing?.revision && confirmsBoundCache && existing.revision !== event.revision;
    if (!blocked && !preserveHead) {
      if (event.availability !== 'available') {
        for (const watch of Object.values(next.watches)) {
          if (watch.state === 'tracked' && watch.boundSource?.sourceId === event.sourceId) {
            watch.state = 'source_unavailable';
            watch.label = LABELS.source_unavailable;
            watch.reason = event.availability === 'withdrawn' ? 'source_withdrawn' : (event.reason ?? 'source_unavailable');
            watch.updatedAt = event.fetchedAt;
          }
        }
      }
      next.sources[event.sourceId] = {sourceId: event.sourceId, observedAt: event.fetchedAt,
        availability: event.availability, revision: event.revision ?? null,
        contentSha256: event.contentSha256 ?? null, provider: providerLabel,
        citation: event.citation?.locator ?? null,
        feedCursor: event.feedCursor ?? existing?.feedCursor ?? null,
        untrustedExcerpt: typeof event.summary === 'string' ? clip(event.summary.trim()) : null,
        ...(event.sourceReadReceiptId ? {sourceReadTaskId: event.sourceReadTaskId,
          sourceReadReceiptId: event.sourceReadReceiptId} : {})};
    }
    persist(next);
    const provider = providerLabel;
    return {accepted: !blocked, reason: blocked ? 'submission_unverified' : 'observed',
      duplicate: false, notified: notifiedIds.length > 0, noticeIds: notifiedIds,
      availability: event.availability, provider,
      submitted: submitted ? [...submitted.accepted] : []};
  }
  async function deliverPending(operation) {
    if (!document) return;
    const pending = Object.values(document.notices).filter(notice => notice.delivered !== true);
    for (const notice of pending) {
      if (!(await operation.revalidate())) return;
      if (!text(notice.citation)) {
        await lock(() => {
          if (!document?.notices[notice.id] || !operation.current()) return;
          const next = clone(document);
          next.notices[notice.id].delivered = false;
          next.notices[notice.id].deliveryReason = 'citation_missing';
          persist(next);
        });
        continue;
      }
      if (typeof notificationPort?.send !== 'function') {
        await lock(() => {
          if (!document?.notices[notice.id] || !operation.current()) return;
          const next = clone(document);
          next.notices[notice.id].delivered = false;
          next.notices[notice.id].deliveryReason = 'notification_port_missing';
          persist(next);
        });
        continue;
      }
      let receipt = null;
      if (!(await operation.revalidate())) return;
      const delivery = await lock(() => {
        const saved = document?.notices[notice.id];
        if (!saved || saved.delivered === true || !operation.current()) return null;
        if (text(saved.receiptId) || saved.deliveryAttempted === true) {
          return typeof notificationPort.read === 'function' ? {kind: 'read', notice: clone(saved)} : null;
        }
        const next = clone(document);
        next.notices[notice.id].deliveryAttempted = true;
        next.notices[notice.id].deliveryReason = 'delivery_unknown';
        persist(next);
        return {kind: 'send', notice: clone(next.notices[notice.id])};
      });
      if (!delivery) continue;
      if (!operation.current()) return;
      try {
        receipt = delivery.kind === 'read' ? await notificationPort.read(delivery.notice, {signal: operation.signal})
          : await notificationPort.send(delivery.notice, {signal: operation.signal});
      } catch { receipt = null; }
      if (!(await operation.revalidate())) return;
      await lock(() => {
        if (!document?.notices[notice.id] || !operation.current()) return;
        const next = clone(document);
        const saved = next.notices[notice.id];
        if (saved.delivered === true || delivery.kind === 'read' && saved.receiptId !== delivery.notice.receiptId) return;
        if (receipt?.delivered === true && text(receipt.receiptId)) {
          saved.delivered = true;
          saved.receiptId = receipt.receiptId.trim();
          saved.deliveryReason = 'provider_receipt';
        } else if (text(receipt?.receiptId)) {
          saved.delivered = false;
          saved.receiptId = receipt.receiptId.trim();
          saved.deliveryReason = 'awaiting_acknowledgement';
        } else {
          saved.delivered = false;
          saved.deliveryReason = text(receipt?.reason) ? receipt.reason : (receipt ? 'invalid_receipt' : 'notification_failed');
          if (!text(saved.receiptId)) delete saved.receiptId;
        }
        persist(next);
      });
    }
  }
  function expireDue() {
    const current = clock();
    let changed = false;
    const next = clone(document);
    for (const watch of Object.values(next.watches)) {
      if (watch.state === 'tracked' && watch.expiresAt && instant(watch.expiresAt) <= current) {
        watch.state = 'expired';
        watch.label = LABELS.expired;
        watch.reason = 'watch_expired';
        watch.policyState = 'decay';
        changed = true;
      }
    }
    if (changed) persist(next);
  }

  async function scopeFromGrant(signal) {
    if (typeof readTrackingGrant !== 'function') return signal;
    if (!identifier(signal.intakeTaskId) || !identifier(signal.source?.id)) return null;
    let grant;
    try {
      grant = await readTrackingGrant({namespace, sourceId: signal.source.id, taskId: signal.intakeTaskId});
    } catch { return null; }
    if (!plain(grant) || !['granted', 'none', 'revoked'].includes(grant.state) || !identifier(grant.id)
      || !Number.isSafeInteger(grant.revision) || grant.revision < 1
      || typeof grant.publicLowRiskTracking !== 'boolean'
      || !Number.isFinite(instant(grant.expiresAt))) return null;
    return {...signal, scope: {state: grant.state, id: grant.id, revision: grant.revision,
      publicLowRiskTracking: grant.publicLowRiskTracking, expiresAt: grant.expiresAt}};
  }
  async function consumeInterestSignal(raw, request = {}) {
    let signal = pickInterest(raw);
    if (identifier(request[intakeTaskBinding])) signal.intakeTaskId = request[intakeTaskBinding];
    const userEnable = request.userEnable ?? null;
    await lock(() => { requireReady(); });
    const granted = await scopeFromGrant(signal);
    if (!granted) return {accepted: false, reason: 'grant_unreadable'};
    signal = granted;
    let choice = null;
    const preview = await lock(() => {
      requireReady();
      try { return buildInterestOptions(policyInput(signal, userEnable)); }
      catch { fail('INVALID_ARGUMENT'); }
    });
    if (request.revalidate && await request.revalidate() !== true) {
      return {accepted: false, reason: 'interest_context_invalidated'};
    }
    if (preview.policy.state === 'watch_public' && interestDecider) {
      if (!text(request.deadline) || !(request.signal instanceof AbortSignal)) fail('INVALID_ARGUMENT');
      const listen = AbortSignal.any([request.signal, controller.signal]);
      choice = await interestDecider.choose(policyInput(signal, userEnable),
        {deadline: request.deadline, signal: listen});
      if (!running || controller.signal.aborted || request.signal.aborted) return {accepted: false, reason: 'stopped'};
      if (!Number.isFinite(instant(request.deadline)) || instant(request.deadline) <= clock()) {
        return {accepted: false, reason: 'deadline_expired'};
      }
      const again = await scopeFromGrant(signal);
      if (!again) return {accepted: false, reason: 'grant_unreadable'};
      if (JSON.stringify(again.scope) !== JSON.stringify(signal.scope)) return {accepted: false, reason: 'grant_changed'};
      signal = again;
    }
    if (request.revalidate && await request.revalidate() !== true) {
      return {accepted: false, reason: 'interest_context_invalidated'};
    }
    const result = await lock(async () => {
      const fresh = await scopeFromGrant(signal);
      if (!fresh || JSON.stringify(fresh.scope) !== JSON.stringify(signal.scope)) {
        return {accepted: false, reason: 'grant_changed'};
      }
      if (readTrackingGrantSnapshot) {
        try {
          const grant = readTrackingGrantSnapshot({namespace, sourceId: signal.source.id, taskId: signal.intakeTaskId});
          if (!grantMatches(grant, signal.scope)) return {accepted: false, reason: 'grant_changed'};
        } catch { return {accepted: false, reason: 'grant_changed'}; }
      }
      if (request.commitCurrent && request.commitCurrent() !== true) {
        return {accepted: false, reason: 'interest_context_invalidated'};
      }
      if (request.signal?.aborted || request.deadline && clock() >= instant(request.deadline)) {
        return {accepted: false, reason: 'interest_context_invalidated'};
      }
      return commitInterest(signal, choice, userEnable);
    });
    if (result.watch?.state === 'tracked' && request.feedCheck) {
      result.feedCheck = registerFeedCheck({...request.feedCheck,
        subscriptionId: result.watch.boundSource?.sourceId, topicIds: [result.watch.topicId]});
    }
    return result;
  }
  /** Consume a trusted Runtime-backed interaction once; Renderer supplies neither signal nor grant. */
  async function consumeInterestTask(taskId, request = {}) {
    requireReady();
    if (!identifier(taskId) || !(request.signal instanceof AbortSignal)
      || !Number.isFinite(instant(request.deadline))) fail('INVALID_ARGUMENT');
    if (typeof runtime?.getTask !== 'function' || typeof readInterestSignal !== 'function'
      || typeof readTrackingGrant !== 'function') return {accepted: false, reason: 'interest_task_provider_missing'};
    if (activeInterestTasks.has(taskId)) return {accepted: false, reason: 'interest_task_in_progress'};
    activeInterestTasks.add(taskId);
    const operation = sourceOperation({...request, sourceId: undefined});
    try {
      let task;
      try {task = runtime.getTask(taskId);}
      catch (error) {
        if (error?.code !== 'NOT_FOUND') throw error;
        return {accepted: false, reason: 'interest_task_unavailable'};
      }
      if (!task || task.taskId !== taskId || task.cancelRequested || ['failed', 'cancelled'].includes(task.state)) {
        return {accepted: false, reason: 'interest_task_unavailable'};
      }
      let raw;
      try {raw = await readInterestSignal({namespace, taskId});}
      catch (error) {
        return {accepted: false, reason: 'interest_signal_unavailable', code: text(error?.code) ? error.code : 'EXTERNAL_FAILURE'};
      }
      if (!raw) return {accepted: false, reason: 'interest_signal_unavailable'};
      const signal = pickInterest(raw);
      const enablement = value => {
        if (value === undefined || value === null) return null;
        if (!plain(value) || !identifier(value.id) || value.topicId !== signal.topicId
          || !Number.isFinite(instant(value.occurredAt))) fail('INVALID_ARGUMENT');
        return {id: value.id, topicId: value.topicId, occurredAt: value.occurredAt};
      };
      const nativeEnable = enablement(raw.explicitEnable);
      const signalDigest = digest({...signal, explicitEnable: nativeEnable});
      const taskIdentity = value => digest({taskId: value?.taskId, conversationId: value?.conversationId ?? null,
        goal: value?.goal ?? null});
      const expectedTask = taskIdentity(task);
      const taskCurrent = () => {
        if (!operation.current() || clock() >= instant(request.deadline)) return false;
        try {
          const current = runtime.getTask(taskId);
          return !!current && !current.cancelRequested && !['failed', 'cancelled', 'cancelling'].includes(current.state)
            && taskIdentity(current) === expectedTask;
        } catch { return false; }
      };
      const revalidate = async () => {
        if (!taskCurrent()) return false;
        try {
          const currentSignal = await readInterestSignal({namespace, taskId});
          return !!currentSignal && digest({...pickInterest(currentSignal), explicitEnable: enablement(currentSignal.explicitEnable)})
            === signalDigest && taskCurrent();
        } catch { return false; }
      };
      if (!(await revalidate())) return {accepted: false, reason: 'interest_context_invalidated'};
      const key = `knowledge-watch-interest-task:${digest([namespace, taskId])}`;
      const previous = checkpoints.loadCheckpoint(checkpointTaskId, key);
      if (previous !== undefined) {
        if (!plain(previous) || previous.version !== 1 || previous.namespace !== namespace || previous.taskId !== taskId
          || previous.signalDigest !== signalDigest || previous.taskIdentity !== expectedTask || previous.topicId !== signal.topicId) {
          return {accepted: false, reason: 'interest_receipt_conflict'};
        }
        if (previous.state !== 'completed') return {accepted: false, reason: 'interest_consumption_unknown'};
        // Read the current watch: an old accepted receipt never reactivates a revoked/paused watch.
        return {accepted: true, duplicate: true, taskId, watch: clone(document.watches[signal.topicId] ?? null)};
      }
      const receipt = {version: 1, namespace, taskId, topicId: signal.topicId, signalDigest,
        taskIdentity: expectedTask, state: 'unknown'};
      const prepared = await lock(() => {
        if (!taskCurrent()) return false;
        checkpoints.saveCheckpoint(checkpointTaskId, key, receipt);
        return JSON.stringify(checkpoints.loadCheckpoint(checkpointTaskId, key)) === JSON.stringify(receipt);
      });
      if (!prepared) return {accepted: false, reason: 'interest_receipt_unavailable'};
      if (!operation.current()) return {accepted: false, reason: 'stopped'};
      const result = await consumeInterestSignal(signal, {...request, userEnable: nativeEnable,
        signal: operation.signal, revalidate, commitCurrent: taskCurrent, [intakeTaskBinding]: taskId});
      if (!result.accepted || !taskCurrent()) return {...result, accepted: false, taskId};
      const saved = await lock(() => {
        if (!taskCurrent()) return false;
        checkpoints.saveCheckpoint(checkpointTaskId, key, {...receipt, state: 'completed',
          modelReceiptId: result.watch?.modelReceiptId ?? null, consumerRevision: result.watch?.consumer?.revision ?? null});
        const readback = checkpoints.loadCheckpoint(checkpointTaskId, key);
        return readback?.state === 'completed' && readback.signalDigest === signalDigest && readback.taskIdentity === expectedTask;
      });
      return saved ? {...result, taskId} : {accepted: false, reason: 'interest_consumption_unknown', taskId};
    } finally { activeInterestTasks.delete(taskId); }
  }
  function sourceOperation(request = {}) {
    if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) fail('INVALID_ARGUMENT');
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const ticket = life;
    const current = () => running && ticket === life && !signal.aborted
      && (!request.deadline || Number.isFinite(instant(request.deadline)) && clock() < instant(request.deadline))
      && (!request.sourceId || sourceGrantCurrent(request.sourceId))
      && (!request.isCurrent || request.isCurrent() === true);
    return {signal, current, async revalidate() {
      if (!current()) return false;
      let valid;
      try { valid = !request.revalidate || await request.revalidate() === true; }
      catch { valid = false; }
      const grant = await grantStatus(request.sourceId);
      return valid && !['revoked', 'unreadable'].includes(grant) && current();
    }};
  }
  async function consumeSourceUpdate(raw, request = {}) {
    requireReady();
    const event = pickSource(raw);
    const operation = sourceOperation({...request, sourceId: event.sourceId});
    const invalidated = () => ({accepted: false, reason: 'source_operation_invalidated', notified: false});
    if (!(await operation.revalidate())) return invalidated();
    const prepared = await lock(() => operation.current() ? prepareSource(event) : invalidated());
    if (!prepared.proceed) return prepared;
    const submitted = prepared.keys?.length ? await submitKeys(prepared.keys, prepared.plans, operation) : null;
    if (submitted?.skipped) prepared.skipped = submitted.skipped;
    if (!(await operation.revalidate())) return invalidated();
    const result = await lock(() => finalizeSource(prepared, submitted, operation));
    if (!result.accepted) return result;
    if (!(await operation.revalidate())) return invalidated();
    await deliverPending(operation);
    if (!(await operation.revalidate())) return invalidated();
    return result;
  }
  async function refreshSource(sourceId, request = {}) {
    requireReady();
    if (!identifier(sourceId)) fail('INVALID_ARGUMENT');
    if (typeof sourcePort?.read !== 'function') {
      return {accepted: false, availability: 'unavailable', reason: 'source_provider_missing'};
    }
    const operation = sourceOperation({...request, sourceId});
    if (!await operation.revalidate()) return {accepted: false, reason: 'source_operation_invalidated'};
    let reading;
    try { reading = await sourcePort.read({namespace, sourceId, signal: operation.signal}); }
    catch (error) {
      if (!running || controller?.signal.aborted || error?.code === 'CANCELLED') {
        return {accepted: false, reason: 'stopped'};
      }
      if (['TIMEOUT', 'EXTERNAL_FAILURE', 'RATE_LIMITED'].includes(error?.code)) {
        return {accepted: false, availability: 'unavailable', reason: 'source_transient_failure', code: error.code};
      }
      return {accepted: false, availability: 'unavailable', reason: 'source_unavailable',
        ...(text(error?.code) ? {code: error.code} : {})};
    }
    if (!await operation.revalidate()) return {accepted: false, reason: 'source_operation_invalidated'};
    const availability = reading?.availability === 'withdrawn' ? 'withdrawn'
      : reading?.availability === 'available' ? 'available' : 'unavailable';
    const provider = text(reading?.provider) ? reading.provider : 'port';
    if (availability !== 'available') {
      return consumeSourceUpdate({namespace, sourceId, availability, fetchedAt: iso(clock()),
        reason: text(reading?.reason) ? reading.reason : 'source_unavailable', provider}, request);
    }
    return consumeSourceUpdate({...reading, namespace, sourceId, availability, provider}, request);
  }

  function mutateWatch(topicId, change) {
    requireReady();
    if (!identifier(topicId) || !document.watches[topicId] && change.requireWatch) fail('NOT_FOUND');
    const next = clone(document);
    change(next, topicId);
    persist(next);
    return clone(next.watches[topicId] ?? null);
  }
  function revoke(topicId, tombstone) {
    if (!identifier(topicId) || !plain(tombstone) || !identifier(tombstone.id)) fail('INVALID_ARGUMENT');
    const revokedAt = tombstone.revokedAt ?? iso(clock());
    if (!Number.isFinite(instant(revokedAt)) || instant(revokedAt) > clock()) fail('INVALID_ARGUMENT');
    return lock(() => {
      requireReady();
      return mutateWatch(topicId, next => {
        next.tombstones[topicId] = {id: tombstone.id, topicId, revokedAt};
        const previous = next.watches[topicId];
        next.watches[topicId] = {...(previous ?? {topicId, revision: 1, evidence: [],
          scope: {id: 'revoked', revision: 1, state: 'revoked', publicLowRiskTracking: false, expiresAt: revokedAt}}),
          topicId, state: 'revoked', label: LABELS.revoked, reason: 'user_revoked', policyState: 'revoked',
          revokedAt, tombstoneId: tombstone.id, updatedAt: revokedAt, selectedApproach: 'keep_revoked'};
      });
    });
  }
  function pause(topicId) {
    return lock(() => mutateWatch(topicId, (next, id) => {
      const watch = next.watches[id];
      if (!watch) fail('NOT_FOUND');
      if (watch.state === 'revoked') return;
      if (watch.state === 'paused') return;
      watch.revision += 1;
      if (watch.consumer) watch.consumer.revision = watch.revision;
      watch.state = 'paused';
      watch.label = LABELS.paused;
      watch.reason = 'user_paused';
      watch.updatedAt = iso(clock());
    }));
  }
  function resume(topicId) {
    return lock(() => mutateWatch(topicId, (next, id) => {
      const watch = next.watches[id];
      if (!watch) fail('NOT_FOUND');
      if (watch.state !== 'paused') return;
      if (readTrackingGrant) {
        const identity = grantIdentity(watch);
        try {
          if (!identity || !readTrackingGrantSnapshot || !grantMatches(readTrackingGrantSnapshot(identity), watch.scope)) return;
        } catch { return; }
      }
      if (next.tombstones[id]) {
        watch.state = 'revoked';
        watch.label = LABELS.revoked;
        watch.reason = 'user_revoked';
        watch.policyState = 'revoked';
        watch.revokedAt = next.tombstones[id].revokedAt;
        watch.tombstoneId = next.tombstones[id].id;
      } else if (watch.expiresAt && instant(watch.expiresAt) <= clock()) {
        watch.state = 'expired';
        watch.label = LABELS.expired;
        watch.reason = 'watch_expired';
        watch.policyState = 'decay';
      } else if (watch.selectedApproach === 'track_public' && watch.boundSource) {
        watch.revision += 1;
        if (watch.consumer) watch.consumer.revision = watch.revision;
        watch.state = 'tracked';
        watch.label = LABELS.tracked;
        watch.reason = 'user_resumed';
        watch.policyState = 'watch_public';
      } else {
        watch.state = 'suggested';
        watch.label = LABELS.suggested;
        watch.reason = 'user_resumed';
      }
      watch.updatedAt = iso(clock());
    }));
  }
  function enable(signal, enablement) {
    return consumeInterestSignal(signal, {userEnable: enablement, deadline: enablement?.deadline,
      signal: enablement?.signal});
  }

  function feedItemIdentity(item) {
    const record = item?.record;
    if (!plain(record) || !text(record.dedupeKey) || !text(record.contentRef)
      || !Number.isFinite(instant(record.occurredAt)) || !text(item.title)
      || own(item, 'summary') && typeof item.summary !== 'string') return null;
    return {dedupeKey: record.dedupeKey, occurredAt: record.occurredAt, contentRef: record.contentRef,
      title: clip(item.title, 200), summary: typeof item.summary === 'string' ? clip(item.summary, 500) : ''};
  }
  function opaqueFeedRevision(validators, contentSha256) {
    if (text(validators?.etag) || text(validators?.lastModified)) {
      return digest({etag: validators.etag ?? null, lastModified: validators.lastModified ?? null});
    }
    return digest({body: contentSha256});
  }
  function persistFeedReadReceipt(sourceId, collected, identities, revision, contentSha256, citation, summary, preparedReceipt = null) {
    const core = {version: 1, kind: 'feeds.collect', namespace, sourceId,
      observedAt: collected.collection.fetchedAt, revision, contentSha256, citation, summary, items: identities};
    const receipt = preparedReceipt ?? (knowledgeFeedReceipts
      ? knowledgeFeedReceipts.createKnowledgeFeedReceipt({namespace, sourceId,
        observedAt: collected.collection.fetchedAt, revision, items: identities})
      : {...core, receiptId: digest(core)});
    const key = KNOWLEDGE_SOURCE_READ_PREFIX + receipt.receiptId;
    const previous = checkpoints.loadCheckpoint(checkpointTaskId, key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(receipt)) fail('REVISION_CONFLICT');
    if (previous === undefined) checkpoints.saveCheckpoint(checkpointTaskId, key, receipt);
    const readback = readFeedSourceReceipt(checkpoints, checkpointTaskId, receipt.receiptId, knowledgeFeedReceipts);
    if (!readback || JSON.stringify(readback) !== JSON.stringify(receipt)) fail('SOURCE_READ_RECEIPT_UNAVAILABLE');
    return receipt;
  }
  function readCollectResult(value) {
    if (!plain(value) || !Array.isArray(value.items) || !plain(value.collection) || !text(value.nextCursor)) return null;
    const collection = value.collection;
    if (!['fetched', 'unchanged'].includes(collection.state) || !identifier(collection.subscriptionId)
      || !Number.isFinite(instant(collection.fetchedAt)) || typeof value.hasMore !== 'boolean') return null;
    const validators = collection.validators;
    if (!plain(validators) || !Object.hasOwn(validators, 'etag') || !Object.hasOwn(validators, 'lastModified')) return null;
    if (validators.etag !== null && !text(validators.etag)) return null;
    if (validators.lastModified !== null && !text(validators.lastModified)) return null;
    if (collection.state === 'unchanged' && value.items.length > 0) return null;
    return value;
  }
  async function refreshSubscribedFeed(request = {}, sourceScope) {
    requireReady();
    if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) fail('INVALID_ARGUMENT');
    const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
    const feedCurrent = () => !signal.aborted && ticket === life && running && sourceGrantCurrent(subscriptionId)
      && (!request.deadline || Number.isFinite(instant(request.deadline)) && clock() < instant(request.deadline))
      && (!request.isCurrent || request.isCurrent() === true);
    const stillCurrent = async () => {
      if (!feedCurrent()) return false;
      const valid = !request.revalidate || await request.revalidate() === true;
      const grant = await grantStatus(subscriptionId);
      return valid && !['revoked', 'unreadable'].includes(grant) && feedCurrent();
    };
    if (typeof feedCollect !== 'function') {
      return {accepted: false, availability: 'unavailable', reason: 'source_provider_missing'};
    }
    const subscriptionId = request.subscriptionId ?? feedSubscriptionId;
    if (!identifier(subscriptionId)) fail('INVALID_ARGUMENT');
    if (feedReading) return {accepted: false, reason: 'feed_read_in_progress'};
    feedReading = true;
    const ticket = life;
    try {
      const grant = await grantStatus(subscriptionId);
      if (grant === 'revoked') return {accepted: false, availability: 'unavailable', reason: 'authorization_required'};
      if (grant === 'unreadable') return {accepted: false, availability: 'unavailable', reason: 'grant_unreadable'};
      if (!(await stillCurrent())) return {accepted: false, reason: 'feed_check_invalidated'};
      const cursor = document?.sources?.[subscriptionId]?.feedCursor;
      const query = {subscriptionId};
      if (text(cursor)) query.cursor = cursor;
      let result;
      try { result = await feedCollect(query, signal, sourceScope); }
      catch (error) {
        if (ticket !== life || !running || signal.aborted || error?.code === 'CANCELLED') {
          return {accepted: false, reason: 'stopped'};
        }
        if (['TIMEOUT', 'EXTERNAL_FAILURE', 'RATE_LIMITED'].includes(error?.code)) {
          return {accepted: false, availability: 'unavailable', reason: 'source_transient_failure', code: error.code};
        }
        if (error?.code === 'NOT_FOUND') {
          if (!(await stillCurrent())) return {accepted: false, reason: 'feed_check_invalidated'};
          return consumeSourceUpdate({namespace, sourceId: subscriptionId, availability: 'withdrawn',
            fetchedAt: iso(clock()), reason: 'source_withdrawn', provider: 'feeds'}, request);
        }
        return {accepted: false, availability: 'unavailable', reason: 'source_unavailable',
          code: text(error?.code) ? error.code : 'EXTERNAL_FAILURE'};
      }
      if (ticket !== life || !running || signal.aborted) return {accepted: false, reason: 'stopped'};
      if (!(await stillCurrent())) return {accepted: false, reason: 'feed_check_invalidated'};
      const collected = readCollectResult(result);
      if (!collected || collected.collection.subscriptionId !== subscriptionId) {
        return {accepted: false, availability: 'unavailable', reason: 'invalid_feed_result'};
      }
      if (instant(collected.collection.fetchedAt) > clock()) {
        return {accepted: false, availability: 'unavailable', reason: 'feed_clock_ahead'};
      }
      if (collected.hasMore) {
        return lock(() => {
          if (!document || !feedCurrent()) return {accepted: false, reason: 'feed_check_invalidated'};
          const next = clone(document);
          const existing = next.sources[subscriptionId];
          if (existing) existing.feedCursor = collected.nextCursor;
          else next.sources[subscriptionId] = {sourceId: subscriptionId, observedAt: collected.collection.fetchedAt,
            availability: 'unavailable', revision: null, contentSha256: null, provider: 'feeds',
            feedCursor: collected.nextCursor, reason: 'feed_page_incomplete'};
          persist(next);
          return {accepted: true, reason: 'feed_page_incomplete', provider: 'feeds', availability: 'unavailable'};
        });
      }
      if (collected.collection.state === 'unchanged') {
        const unchanged = await lock(() => {
          if (!document || !feedCurrent()) return {accepted: false, reason: 'feed_check_invalidated'};
          const head = document.sources[subscriptionId];
          if (head?.availability !== 'available' || !text(head.revision) || !sha(head.contentSha256)) {
            return {accepted: false, availability: 'unavailable', reason: 'source_body_not_read', provider: 'feeds'};
          }
          // A conditional response contains no new body or source-read proof. Keep the
          // original observation/context and binding validity; only advance pagination.
          if (head.feedCursor !== collected.nextCursor) {
            const next = clone(document);
            next.sources[subscriptionId].feedCursor = collected.nextCursor;
            persist(next);
          }
          return {accepted: true, reason: 'unchanged', duplicate: true, notified: false,
            availability: 'available', provider: 'feeds', revision: head.revision, submitted: []};
        });
        if (!unchanged.accepted || !(await stillCurrent())) return unchanged;
        const recovered = await recheckCurrentSource(subscriptionId, {...request, signal});
        return {...unchanged, recovery: recovered, submitted: recovered.submitted ?? []};
      }
      let preparedReceipt = null;
      if (typeof knowledgeFeedReceipts?.createKnowledgeFeedReceiptFromCollectResult === 'function') {
        preparedReceipt = knowledgeFeedReceipts.createKnowledgeFeedReceiptFromCollectResult({namespace,
          sourceId: subscriptionId, result: collected});
        if (!preparedReceipt) return {accepted: false, availability: 'unavailable', reason: 'invalid_feed_result'};
      }
      const identities = preparedReceipt?.items ?? [];
      if (!preparedReceipt) {
        for (const item of collected.items) {
          const identity = feedItemIdentity(item);
          if (!identity) return {accepted: false, availability: 'unavailable', reason: 'invalid_feed_result'};
          identities.push(identity);
        }
      }
      identities.sort((left, right) => left.dedupeKey < right.dedupeKey ? -1 : left.dedupeKey > right.dedupeKey ? 1 : 0);
      // A v2 receipt port binds each article. Without it, the singular v1 locator
      // cannot substantiate a multi-article page.
      if (!knowledgeFeedReceipts && new Set(identities.map(item => item.contentRef)).size > 1) {
        return {accepted: false, availability: 'unavailable', reason: 'feed_citation_ambiguous', provider: 'feeds'};
      }
      const contentSha256 = preparedReceipt?.contentSha256 ?? digest(identities);
      const revision = preparedReceipt?.revision ?? opaqueFeedRevision(collected.collection.validators, contentSha256);
      const summary = identities.flatMap(item => [item.title, item.summary]).filter(Boolean).join('\n');
      if (!identities.length || !text(identities[0]?.contentRef)) {
        return {accepted: false, availability: 'unavailable', reason: 'source_body_not_read', provider: 'feeds'};
      }
      let sourceReadReceipt;
      try {
        if (!feedCurrent()) return {accepted: false, reason: 'feed_check_invalidated'};
        sourceReadReceipt = persistFeedReadReceipt(subscriptionId, collected, identities, revision,
          contentSha256, identities[0].contentRef, summary, preparedReceipt);
      } catch {
        return {accepted: false, availability: 'unavailable', reason: 'source_read_receipt_failed', provider: 'feeds'};
      }
      return consumeSourceUpdate({namespace, sourceId: subscriptionId, availability: 'available', revision,
        contentSha256, fetchedAt: collected.collection.fetchedAt, provider: 'feeds', feedCursor: collected.nextCursor,
        citation: {locator: sourceReadReceipt.citation}, summary: sourceReadReceipt.summary,
        sourceReadTaskId: checkpointTaskId, sourceReadReceiptId: sourceReadReceipt.receiptId}, request);
    } finally { feedReading = false; }
  }
  /** Reuse the exact persisted body for new consumer revisions; no 304 receipt or validity extension. */
  async function recheckCurrentSource(sourceId, request = {}) {
    if (!identifier(sourceId)) fail('INVALID_ARGUMENT');
    const operation = sourceOperation({...request, sourceId});
    if (!await operation.revalidate()) return {accepted: false, reason: 'source_operation_invalidated'};
    const saved = await lock(() => {
      requireReady();
      const head = document.sources[sourceId];
      const receipt = receiptForHead(head, sourceId);
      if (head?.availability !== 'available' || !trustedReceiptEvidence(head, sourceId, receipt)) return null;
      if (clock() - instant(receipt.observedAt) > knowledgeMaxAgeMs) return null;
      return {head: clone(head), receipt};
    });
    if (!saved) return {accepted: false, reason: 'source_evidence_unavailable'};
    const {head, receipt} = saved;
    return consumeSourceUpdate({namespace, sourceId, availability: 'available',
      revision: receipt.revision, contentSha256: receipt.contentSha256, fetchedAt: receipt.observedAt,
      provider: head.provider, ...(text(head.feedCursor) ? {feedCursor: head.feedCursor} : {}),
      citation: {locator: receipt.citation}, summary: receipt.summary,
      sourceReadTaskId: checkpointTaskId, sourceReadReceiptId: receipt.receiptId}, {...request,
        isCurrent: () => operation.current() && document?.sources[sourceId]?.revision === head.revision
          && document?.sources[sourceId]?.contentSha256 === head.contentSha256
          && document?.sources[sourceId]?.observedAt === head.observedAt});
  }
  function registerFeedCheck(input) {
    requireReady();
    if (!boundScheduler) return {accepted: false, reason: 'scheduler_missing'};
    let schedule;
    try { schedule = knowledgeWatchScheduleInput({namespace, runAt: input?.runAt, checkId: input?.checkId}); }
    catch (error) { return {accepted: false, reason: text(error?.code) ? error.code : 'INVALID_ARGUMENT'}; }
    const subscriptionId = input?.subscriptionId ?? feedSubscriptionId;
    let binding = null;
    if (subscriptionId !== null && subscriptionId !== undefined) {
      if (!identifier(subscriptionId)) return {accepted: false, reason: 'INVALID_ARGUMENT'};
      const candidates = Object.values(document.watches).filter(watch =>
        watch.state === 'tracked' && watch.boundSource?.sourceId === subscriptionId);
      const topicIds = input?.topicIds ?? candidates.map(watch => watch.topicId);
      if (!Array.isArray(topicIds) || !topicIds.length || new Set(topicIds).size !== topicIds.length
        || topicIds.some(id => !identifier(id))) return {accepted: false, reason: 'feed_check_consumers_missing'};
      const consumers = topicIds.map(id => candidates.find(watch => watch.topicId === id));
      if (consumers.some(watch => !activeTracking(watch))) {
        return {accepted: false, reason: 'feed_check_consumers_invalid'};
      }
      binding = {version: 1, namespace, schedule: clone(schedule), subscriptionId,
        consumers: consumers.map(watch => trackingIdentity(watch)).sort((a, b) => a.topicId.localeCompare(b.topicId))};
      const key = FEED_CHECK_PREFIX + digest(schedule.scheduleId);
      try {
        const previous = checkpoints.loadCheckpoint(checkpointTaskId, key);
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(binding)) {
          return {accepted: false, reason: 'REVISION_CONFLICT'};
        }
        if (previous === undefined) checkpoints.saveCheckpoint(checkpointTaskId, key, binding);
        if (JSON.stringify(checkpoints.loadCheckpoint(checkpointTaskId, key)) !== JSON.stringify(binding)) {
          return {accepted: false, reason: 'feed_check_binding_unreadable'};
        }
      } catch { return {accepted: false, reason: 'feed_check_binding_unreadable'}; }
    }
    try {
      const saved = boundScheduler.createSchedule(schedule);
      if (!plain(saved) || saved.scheduleId !== schedule.scheduleId) return {accepted: false, reason: 'scheduler_rejected'};
      registeredSchedule = true;
      return {accepted: true, schedule: clone(saved), bound: Boolean(binding)};
    } catch (error) {
      return {accepted: false, reason: text(error?.code) ? error.code : 'scheduler_failed'};
    }
  }
  function cancelFeedChecks() {
    if (!boundScheduler) return {accepted: false, reason: 'scheduler_missing'};
    const conversationId = knowledgeWatchConversationId(namespace);
    let existing;
    try { existing = boundScheduler.listSchedules(conversationId); }
    catch (error) { return {accepted: false, reason: text(error?.code) ? error.code : 'scheduler_failed'}; }
    if (!Array.isArray(existing)) return {accepted: false, reason: 'scheduler_rejected'};
    const prefix = `knowledge-watch:${namespace}:`;
    if (existing.some(item => !text(item?.scheduleId) || !item.scheduleId.startsWith(prefix))) {
      return {accepted: false, reason: 'scheduler_conversation_not_exclusive'};
    }
    try {
      const saved = boundScheduler.reconcileSchedules(conversationId, []);
      registeredSchedule = false;
      return {accepted: true, schedules: Array.isArray(saved) ? clone(saved) : []};
    } catch (error) {
      return {accepted: false, reason: text(error?.code) ? error.code : 'scheduler_failed'};
    }
  }
  function restoreFeedChecks() {
    if (!boundScheduler) return {accepted: false, reason: 'scheduler_missing'};
    try {
      const saved = boundScheduler.listSchedules(knowledgeWatchConversationId(namespace));
      if (!Array.isArray(saved)) return {accepted: false, reason: 'scheduler_rejected'};
      registeredSchedule = saved.some(item => item.status === 'pending'
        && item.scheduleId?.startsWith(`knowledge-watch:${namespace}:`));
      return {accepted: true, schedules: clone(saved)};
    } catch (error) {
      return {accepted: false, reason: text(error?.code) ? error.code : 'scheduler_failed'};
    }
  }
  function bindingReadiness(watch, head) {
    if (watch.state !== 'tracked' || !head || typeof runtime?.findTaskByIdempotencyKey !== 'function'
      || typeof runtime?.loadCheckpoint !== 'function') return {ready: false, reason: 'reevaluation_unavailable'};
    const keys = Object.entries(document.submissions).filter(([, item]) => {
      const ctx = item.recheckContext;
      return ctx?.topicId === watch.topicId && ctx.consumerRevision === watch.consumer?.revision
        && ctx.observedRevision === head.revision && ctx.observedContentSha256 === head.contentSha256;
    });
    if (keys.length !== 1) return {ready: false, reason: 'reevaluation_missing'};
    const [workKey, submission] = keys[0];
    const context = getRecheckContext(workKey);
    if (!context) return {ready: false, reason: 'reevaluation_binding_invalid'};
    try {
      const task = runtime.findTaskByIdempotencyKey(workKey);
      if (!task || task.taskId !== submission.taskId || task.state !== 'succeeded') {
        return {ready: false, reason: 'reevaluation_unconfirmed', taskState: task?.state ?? 'unknown'};
      }
      const result = runtime.loadCheckpoint(task.taskId, KNOWLEDGE_RECHECK_RESULT_KEY);
      const read = {taskId: task.taskId, knowledgeRecheckResult: result,
        knowledgeRecheckJudgment: runtime.loadCheckpoint(task.taskId, KNOWLEDGE_RECHECK_JUDGMENT_KEY),
        taskEvidenceRefs: task.evidenceRefs};
      if (!validKnowledgeRecheckResult(read, context, {...head, sourceId: context.sourceId})) {
        return {ready: false, reason: 'reevaluation_result_unavailable', taskState: task.state};
      }
      return {ready: result.evaluation.outcome === 'relevant_update',
        reason: result.evaluation.outcome === 'relevant_update' ? 'reevaluation_confirmed' : 'reevaluation_not_relevant',
        taskState: task.state};
    } catch { return {ready: false, reason: 'reevaluation_unavailable'}; }
  }
  function activeTracking(watch) {
    return watch?.state === 'tracked' && !document.tombstones[watch.topicId]
      && (!readTrackingGrant || !!grantIdentity(watch))
      && watch.consumer?.id === watch.topicId && Number.isSafeInteger(watch.consumer.revision)
      && watch.consumer.revision >= 1 && watch.scope?.state === 'granted'
      && watch.scope.publicLowRiskTracking === true
      && instant(watch.scope.expiresAt) > clock() && instant(watch.expiresAt) > clock();
  }
  function trackingIdentity(watch) {
    return {topicId: watch.topicId, consumer: clone(watch.consumer),
      boundSource: clone(watch.boundSource), scope: clone(watch.scope), expiresAt: watch.expiresAt};
  }
  /** Resolve only a task actually fired by this Runtime schedule; never trust event payload text. */
  function getFeedCheckContext(taskId) {
    if (!identifier(taskId) || !running || disposed || !document || health.status !== 'ready'
      || typeof runtime?.getTask !== 'function' || !boundScheduler) return null;
    try {
      const task = runtime.getTask(taskId);
      if (!['created', 'planning', 'running'].includes(task.state) || task.cancelRequested
        || task.conversationId !== knowledgeWatchConversationId(namespace)) return null;
      const matches = boundScheduler.listSchedules(task.conversationId).filter(schedule =>
        schedule.status === 'fired' && schedule.taskId === taskId
        && schedule.scheduleId?.startsWith(`knowledge-watch:${namespace}:`));
      if (matches.length !== 1) return null;
      const schedule = matches[0];
      const {status, taskId: firedTaskId, ...input} = schedule;
      const binding = checkpoints.loadCheckpoint(checkpointTaskId, FEED_CHECK_PREFIX + digest(schedule.scheduleId));
      if (!plain(binding) || binding.version !== 1 || binding.namespace !== namespace
        || !identifier(binding.subscriptionId) || JSON.stringify(binding.schedule) !== JSON.stringify(input)
        || task.goal !== schedule.goal || instant(schedule.runAt) > clock()
        || runtime.findTaskByIdempotencyKey(schedule.taskIdempotencyKey)?.taskId !== taskId
        || !Array.isArray(binding.consumers) || !binding.consumers.length
        || new Set(binding.consumers.map(item => item.topicId)).size !== binding.consumers.length) return null;
      if (binding.consumers.some(item => {
        const watch = document.watches[item.topicId];
        return !activeTracking(watch) || watch.boundSource?.sourceId !== binding.subscriptionId
          || JSON.stringify(item) !== JSON.stringify(trackingIdentity(watch));
      })) return null;
      if (!sourceGrantCurrent(binding.subscriptionId)) return null;
      return {...clone(binding), taskId};
    } catch { return null; }
  }
  /** Called by the Runtime Application worker with its cancellation signal. No task submission/terminal mutation. */
  async function consumeFeedCheck(taskId, {signal} = {}) {
    requireReady();
    if (!(signal instanceof AbortSignal)) fail('INVALID_ARGUMENT');
    const context = getFeedCheckContext(taskId);
    if (!context) return {accepted: false, reason: 'feed_check_binding_invalid'};
    if (activeFeedChecks.has(taskId)) return {accepted: false, reason: 'feed_check_in_progress'};
    activeFeedChecks.add(taskId);
    try {
      const result = await refreshSubscribedFeed({subscriptionId: context.subscriptionId, signal,
        isCurrent: () => JSON.stringify(getFeedCheckContext(taskId)) === JSON.stringify(context),
        revalidate: async () => {
          if (JSON.stringify(getFeedCheckContext(taskId)) !== JSON.stringify(context)) return false;
          if (typeof readTrackingGrant === 'function') {
            for (const consumer of context.consumers) {
              let grant;
              const identity = grantIdentity(consumer);
              if (!identity) return false;
              try { grant = await readTrackingGrant(identity); }
              catch { return false; }
              if (grant?.state !== 'granted' || grant.publicLowRiskTracking !== true
                || grant.id !== consumer.scope.id || grant.revision !== consumer.scope.revision
                || grant.expiresAt !== consumer.scope.expiresAt || instant(grant.expiresAt) <= clock()) return false;
            }
          }
          return JSON.stringify(getFeedCheckContext(taskId)) === JSON.stringify(context);
        }}, {trackingTaskIds: [...new Set(context.consumers.map(item => item.consumer.intakeTaskId))]});
      return {...result, taskId, scheduleId: context.schedule.scheduleId, subscriptionId: context.subscriptionId};
    } finally { activeFeedChecks.delete(taskId); }
  }
  /** A user reading a notice never supplies an OS delivery receipt or promotes a source revision. */
  function markNoticeRead(id) {
    if (!sha(id)) fail('INVALID_ARGUMENT');
    return lock(() => {
      requireReady();
      const notice = document.notices[id];
      if (!notice) return {accepted: false, reason: 'notice_not_found'};
      if (notice.readAt) return {accepted: true, reason: 'already_read', id, readAt: notice.readAt};
      const next = clone(document);
      const readAt = iso(clock());
      next.notices[id].readAt = readAt;
      persist(next);
      return {accepted: true, reason: 'read', id, readAt};
    });
  }
  function getRecheckContext(workKey) {
    if (!sha(workKey) || !document || health.status !== 'ready') return null;
    const submission = document.submissions[workKey];
    const context = submission?.recheckContext;
    if (!plain(submission) || !['unknown', 'accepted'].includes(submission.state)
      || submission.namespace !== namespace || submission.sourceId !== context?.sourceId
      || !validRecheckContext(context, workKey, namespace)
      || submission.state === 'accepted' && !text(submission.taskId)) return null;
    if (document.tombstones[context.topicId]) return null;
    const watch = document.watches[context.topicId];
    if (watch?.state !== 'tracked' || !plain(watch.consumer)
      || watch.consumer.id !== context.topicId || watch.consumer.revision !== context.consumerRevision
      || watch.boundSource?.sourceId !== context.sourceId
      || watch.boundSource?.revision !== context.boundRevision
      || watch.boundSource?.contentSha256 !== context.boundContentSha256
      || watch.boundSource?.cacheVersion !== context.boundCacheVersion
      || watch.boundSource?.lastSuccessfulCheck !== context.boundLastSuccessfulCheck
      || watch.boundSource?.validUntil !== context.boundValidUntil
      || watch.expiresAt && (!Number.isFinite(instant(watch.expiresAt)) || instant(watch.expiresAt) <= clock())) {
      return null;
    }
    if (readTrackingGrant) {
      const identity = grantIdentity(watch);
      if (!identity || !readTrackingGrantSnapshot) return null;
      try { if (!grantMatches(readTrackingGrantSnapshot(identity), watch.scope)) return null; }
      catch { return null; }
    }
    const head = document.sources[context.sourceId];
    if (head) {
      const headAt = instant(head.observedAt);
      if (!Number.isFinite(headAt)) return null;
      if (headAt >= instant(context.observedAt)
        && (head.availability !== 'available' || head.revision !== context.observedRevision
          || head.contentSha256 !== context.observedContentSha256 || head.citation !== context.citation)) return null;
    }
    if (context.sourceReadTaskId !== checkpointTaskId) return null;
    const sourceReceipt = readFeedSourceReceipt(checkpoints, context.sourceReadTaskId, context.sourceReadReceiptId, knowledgeFeedReceipts);
    if (!sourceReceipt || sourceReceipt.namespace !== context.namespace || sourceReceipt.sourceId !== context.sourceId
      || sourceReceipt.revision !== context.observedRevision
      || sourceReceipt.contentSha256 !== context.observedContentSha256
      || sourceReceipt.observedAt !== context.observedAt || sourceReceipt.citation !== context.citation
      || clip(sourceReceipt.summary, 2000) !== (context.summary ?? '')) return null;
    if (knowledgeFeedReceipts && !knowledgeFeedReceipts.verifyKnowledgeFeedReceiptBinding(sourceReceipt,
      {namespace, sourceId: context.sourceId, observedAt: context.observedAt, revision: context.observedRevision,
        contentSha256: context.observedContentSha256, citation: context.citation,
        receiptId: context.sourceReadReceiptId, summary: context.summary})) return null;
    return {...clone(context), taskId: submission.taskId ?? null};
  }
  async function bindObservedRevision(topicId) {
    if (!identifier(topicId)) fail('INVALID_ARGUMENT');
    if (!readTrackingGrant || !readTrackingGrantSnapshot) return {accepted: false, reason: 'authorization_required'};
    const tracked = await lock(() => {
      requireReady();
      const watch = document.watches[topicId];
      return watch?.consumer && watch.boundSource ? {consumer: clone(watch.consumer),
        source: {id: watch.boundSource.sourceId, revision: watch.boundSource.revision,
          contentSha256: watch.boundSource.contentSha256}} : null;
    });
    if (readTrackingGrant && (!tracked || !await boundStillTracked(tracked))) {
      return {accepted: false, reason: 'authorization_required'};
    }
    const prepared = await lock(() => {
      requireReady();
      if (document.tombstones[topicId]) return {accepted: false, reason: 'user_revoked'};
      const watch = document.watches[topicId];
      if (watch?.state === 'tracked' && watch.expiresAt && instant(watch.expiresAt) <= clock()) {
        return {accepted: false, reason: 'watch_expired'};
      }
      if (watch?.state !== 'tracked' || !watch.boundSource) return {accepted: false, reason: 'not_tracked'};
      if (!plain(watch.consumer) || watch.consumer.id !== topicId
        || !Number.isSafeInteger(watch.consumer.revision) || watch.consumer.revision < 1) {
        return {accepted: false, reason: 'reevaluation_consumer_missing'};
      }
      const binding = watch.boundSource;
      const head = document.sources[binding.sourceId];
      if (!head || head.availability !== 'available' || !text(head.revision) || !sha(head.contentSha256)
        || !text(head.citation) || !Number.isFinite(instant(head.observedAt))) {
        return {accepted: false, reason: 'observation_incomplete'};
      }
      if (head.revision === binding.revision && head.contentSha256 === binding.contentSha256) {
        return {accepted: false, reason: 'already_bound'};
      }
      if (instant(head.observedAt) < instant(binding.lastSuccessfulCheck)) {
        return {accepted: false, reason: 'observation_stale'};
      }
      const submittedKeys = document.reevaluations[bindingKey(binding)]?.submittedWorkKeys;
      if (!workPort || !Array.isArray(submittedKeys) || !submittedKeys.length
        || submittedKeys.some(key => !sha(key))) {
        return {accepted: false, reason: 'reevaluation_missing'};
      }
      const keys = submittedKeys.filter(key => {
        const context = document.submissions[key]?.recheckContext;
        return validRecheckContext(context, key, namespace)
          && context.topicId === topicId && context.consumerRevision === watch.consumer.revision
          && context.sourceId === binding.sourceId && context.boundRevision === binding.revision
          && context.boundContentSha256 === binding.contentSha256
          && context.observedRevision === head.revision
          && context.observedContentSha256 === head.contentSha256
          && context.citation === head.citation;
      });
      if (keys.length !== 1) return {accepted: false, reason: 'reevaluation_missing'};
      const submissions = Object.fromEntries(keys.map(key => [key, clone(document.submissions[key] ?? null)]));
      if (Object.values(submissions).some(submission => submission?.state !== 'accepted'
        || !text(submission.taskId) || submission.sourceId !== binding.sourceId
        || (submission.recheckContext && submission.recheckContext.topicId !== topicId))) {
        return {accepted: false, reason: 'reevaluation_missing'};
      }
      return {accepted: true, proceed: true, keys: [...keys], binding: clone(binding),
        consumer: clone(watch.consumer ?? null), submissions,
        head: {sourceId: binding.sourceId, revision: head.revision, contentSha256: head.contentSha256,
          observedAt: head.observedAt, citation: head.citation}};
    });
    if (!prepared.proceed) return prepared;
    const taskIds = [];
    const outcomes = [];
    for (const workKey of prepared.keys) {
      let read;
      try { read = await workPort.read({namespace, idempotencyKey: workKey}); }
      catch { read = {state: 'unknown'}; }
      if (read?.state !== 'accepted' || read.taskState !== 'succeeded' || !text(read.taskId)) {
        return {accepted: false, reason: 'reevaluation_unconfirmed',
          taskState: text(read?.taskState) ? read.taskState : (text(read?.state) ? read.state : 'unknown')};
      }
      if (read.taskId !== prepared.submissions[workKey]?.taskId) {
        return {accepted: false, reason: 'reevaluation_task_mismatch', taskState: read.taskState};
      }
      const context = prepared.submissions[workKey]?.recheckContext;
      const sourceReceipt = validRecheckContext(context, workKey, namespace)
        ? readFeedSourceReceipt(checkpoints, context.sourceReadTaskId, context.sourceReadReceiptId, knowledgeFeedReceipts) : null;
      if (!validRecheckContext(context, workKey, namespace) || !sourceReceipt
        || sourceReceipt.namespace !== context.namespace || sourceReceipt.sourceId !== context.sourceId
        || sourceReceipt.revision !== context.observedRevision
        || sourceReceipt.contentSha256 !== context.observedContentSha256
        || sourceReceipt.observedAt !== context.observedAt || sourceReceipt.citation !== context.citation
        || clip(sourceReceipt.summary, 2000) !== (context.summary ?? '')
        || knowledgeFeedReceipts && !knowledgeFeedReceipts.verifyKnowledgeFeedReceiptBinding(sourceReceipt,
          {namespace, sourceId: context.sourceId, observedAt: context.observedAt, revision: context.observedRevision,
            contentSha256: context.observedContentSha256, citation: context.citation,
            receiptId: context.sourceReadReceiptId, summary: context.summary})
        || !validKnowledgeRecheckResult(read, context, prepared.head)) {
        return {accepted: false, reason: 'reevaluation_result_unavailable', taskState: read.taskState};
      }
      taskIds.push(read.taskId);
      outcomes.push(read.knowledgeRecheckResult.evaluation.outcome);
    }
    if (outcomes.includes('not_relevant')) {
      return {accepted: false, reason: 'reevaluation_not_relevant', taskIds};
    }
    if (readTrackingGrant && !await boundStillTracked(tracked)) return {accepted: false, reason: 'authorization_required'};
    if (!trustedReceiptEvidence(document.sources[prepared.binding.sourceId], prepared.binding.sourceId)) {
      return {accepted: false, reason: 'source_evidence_unavailable'};
    }
    return lock(() => {
      requireReady();
      if (document.tombstones[topicId]) return {accepted: false, reason: 'user_revoked'};
      const watch = document.watches[topicId];
      if (watch?.state === 'expired') return {accepted: false, reason: 'watch_expired'};
      if (watch?.state !== 'tracked') return {accepted: false, reason: 'not_tracked'};
      if (watch.expiresAt && instant(watch.expiresAt) <= clock()) {
        return {accepted: false, reason: 'watch_expired'};
      }
      const binding = watch.boundSource;
      const head = binding ? document.sources[binding.sourceId] : null;
      if (!binding || binding.sourceId !== prepared.binding.sourceId
        || binding.revision !== prepared.binding.revision
        || binding.contentSha256 !== prepared.binding.contentSha256
        || binding.cacheVersion !== prepared.binding.cacheVersion
        || binding.lastSuccessfulCheck !== prepared.binding.lastSuccessfulCheck
        || binding.validUntil !== prepared.binding.validUntil
        || watch.consumer?.id !== prepared.consumer?.id
        || watch.consumer?.revision !== prepared.consumer?.revision
        || watch.consumer?.intakeTaskId !== prepared.consumer?.intakeTaskId
        || head?.revision !== prepared.head.revision || head?.contentSha256 !== prepared.head.contentSha256
        || head?.observedAt !== prepared.head.observedAt || head?.citation !== prepared.head.citation) {
        return {accepted: false, reason: 'observation_changed'};
      }
      try {
        const identity = grantIdentity(watch);
        const grant = identity && readTrackingGrantSnapshot(identity);
        if (!plain(grant) || grant.state !== 'granted' || grant.publicLowRiskTracking !== true
          || grant.id !== watch.scope?.id || grant.revision !== watch.scope?.revision
          || grant.expiresAt !== watch.scope?.expiresAt || instant(grant.expiresAt) <= clock()) {
          return {accepted: false, reason: 'authorization_required'};
        }
      } catch { return {accepted: false, reason: 'authorization_required'}; }
      const next = clone(document);
      const target = next.watches[topicId];
      target.boundSource = {...clone(target.boundSource), revision: head.revision,
        contentSha256: head.contentSha256, lastSuccessfulCheck: head.observedAt};
      target.reason = 'source_bound';
      target.updatedAt = iso(clock());
      persist(next);
      return {accepted: true, reason: 'bound', revision: head.revision, taskIds};
    });
  }
  /** Confirms notification delivery by batch receipt; it does not mean the user read it. */
  function observeNotificationAcknowledgement(batch) {
    return lock(() => {
      requireReady();
      if (!plain(batch) || !text(batch.id) || batch.state !== 'delivered') {
        return {accepted: false, reason: 'acknowledgement_not_confirmed'};
      }
      const next = clone(document);
      let matched = 0;
      for (const notice of Object.values(next.notices)) {
        if (notice.receiptId === batch.id && notice.delivered !== true) {
          notice.delivered = true;
          notice.deliveryReason = 'acknowledged';
          matched += 1;
        }
      }
      if (!matched) return {accepted: false, reason: 'notice_not_found'};
      persist(next);
      return {accepted: true, matched};
    });
  }

  function start() {
    if (disposed) fail('DISPOSED');
    if (running) return snapshot();
    running = true;
    controller = new AbortController();
    if (health.status === 'ready') {
      try { expireDue(); } catch { /* expire persists only a ready document */ }
    }
    if (subscriptions) {
      unsubscribe = subscriptions.subscribe(event => {
        if (!running) return;
        const route = event?.type === 'source' ? consumeSourceUpdate(event)
          : event?.type === 'interest' ? consumeInterestSignal(event) : Promise.resolve();
        route.catch(() => {});
      });
      if (typeof unsubscribe !== 'function') {
        running = false;
        controller.abort();
        fail('INVALID_SUBSCRIPTION');
      }
      subscriptionActive = true;
    }
    return snapshot();
  }
  function stop() {
    if (disposed) return snapshot();
    life += 1;
    running = false;
    controller?.abort();
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    subscriptionActive = false;
    if (registeredSchedule) cancelFeedChecks();
    return snapshot();
  }
  function dispose() {
    if (disposed) return snapshot();
    stop();
    disposed = true;
    subscriptions = null;
    return snapshot();
  }

  load();
  return Object.freeze({start, stop, dispose, snapshot, listPending, listWatches, dialogueProjection,
    consumeInterestSignal, consumeInterestTask, consumeSourceUpdate, refreshSource, refreshSubscribedFeed,
    recheckCurrentSource,
    registerFeedCheck, cancelFeedChecks, restoreFeedChecks, getFeedCheckContext, consumeFeedCheck,
    observeNotificationAcknowledgement, markNoticeRead,
    getRecheckContext, bindObservedRevision,
    revoke, pause, resume, enable});
}
