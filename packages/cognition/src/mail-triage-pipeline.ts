import {createHash} from 'node:crypto';
import {
  LayaTriageService,
  type LayaTriageMessage,
  type LayaTriageRequest,
  type LayaTriageResult,
  type LayaTriageOptions,
} from './laya-triage.js';
import type {LayaInferencePort} from './laya-decision.js';
import {CognitionError} from './impact.js';

export interface MailClassifierPort {
  classify(request: LayaTriageRequest): Promise<readonly LayaTriageResult[]>;
}

export interface MailTriageCheckpointPort {
  load(): Record<string, LayaTriageResult> | Promise<Record<string, LayaTriageResult>>;
  save(results: Record<string, LayaTriageResult>): void | Promise<void>;
}

export interface MailTriagePipelineOptions extends LayaTriageOptions {
  readonly inference?: LayaInferencePort | undefined;
  readonly classifier?: MailClassifierPort | undefined;
  readonly checkpoint?: MailTriageCheckpointPort | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly now?: (() => number) | undefined;
}

export interface MailTriageProgress {
  readonly processedCount: number;
  readonly totalCount: number;
  readonly cachedCount: number;
  readonly newlyClassifiedCount: number;
  readonly classifiedCount: number;
  readonly needsReviewCount: number;
  readonly highImpactCount: number;
  readonly uncertainCount: number;
  readonly abstainedCount: number;
  readonly highImpactNotices: readonly MailHighImpactNotice[];
}

export interface MailBatchTriageRequest {
  readonly messages: readonly LayaTriageMessage[];
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly onProgress?: ((progress: MailTriageProgress) => void) | undefined;
}

export interface MailCursorRef {
  readonly uidValidity: number;
  readonly lastUid: number;
}

export interface MailPageBatch {
  readonly messages: readonly LayaTriageMessage[];
  readonly nextCursor?: MailCursorRef | undefined;
  readonly hasMore: boolean;
}

export interface MailPagedTriageRequest {
  /** Supplies one page at a time with backpressure. */
  readonly fetchPage: (cursor?: MailCursorRef | undefined) => Promise<MailPageBatch>;
  readonly initialCursor?: MailCursorRef | undefined;
  /** Maximum pages to consume in this run (bounds execution). */
  readonly maxPages?: number | undefined;
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly onProgress?: ((progress: MailTriageProgress) => void) | undefined;
  readonly onPageCompleted?: ((pageInfo: {
    readonly cursor?: MailCursorRef | undefined;
    readonly hasMore: boolean;
    readonly processedCount: number;
  }) => void | Promise<void>) | undefined;
}

export interface MailHighImpactNotice {
  readonly messageId: string;
  readonly source: string;
  readonly sourceRevision: string;
  readonly label: string | null;
  readonly candidateLabel?: string | null | undefined;
  readonly route: 'main_agent' | 'review';
  readonly reason: string;
  readonly confidence: number | null;
}

export interface MailBatchTriageSummary {
  readonly total: number;
  readonly cachedCount: number;
  readonly newlyClassifiedCount: number;
  readonly classifiedCount: number;
  readonly highImpactCount: number;
  readonly uncertainCount: number;
  readonly abstainedCount: number;
  readonly needsReviewCount: number;
  readonly results: readonly LayaTriageResult[];
  readonly highImpactNotices: readonly MailHighImpactNotice[];
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly throughput: {
    readonly totalDurationMs: number;
    readonly inferenceDurationMs: number;
    readonly messagesPerSecond: number;
  };
}

export interface MailPagedTriageSummary extends MailBatchTriageSummary {
  readonly pagesProcessed: number;
  readonly lastCursor?: MailCursorRef | undefined;
  readonly hasMore: boolean;
  readonly stoppedReason: 'completed' | 'cancelled' | 'deadline' | 'max_pages' | 'classification_unavailable';
}

export const MAIL_TRIAGE_STRATEGY_VERSION = 'mail-triage-strategy-v2';

/**
 * Note: A 'meeting' label indicates that the message requires main-agent inspection
 * for potential calendar relevance. It does NOT represent a confirmed reschedule event,
 * nor does it constitute authorization to mutate the coordination graph or calendar.
 */
export const DEFAULT_MAIL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  meeting: 'Meeting invitations, rescheduling, calendar events, agenda coordination, and appointments',
  work: 'Engineering development, code reviews, pull requests, tasks, and deliverables',
  subscription: 'Newsletters, weekly digests, technology news, and updates',
  transaction: 'Invoices, receipts, billing statements, orders, and payment records',
  personal: 'Personal emails, private conversations, family and friends',
  other: 'Unclear, vague, or miscellaneous messages requiring review',
});

export const DEFAULT_MEETING_LABELS: readonly string[] = Object.freeze(['meeting']);

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const transientReasons = new Set(['cancelled', 'deadline', 'unavailable', 'invalid_response']);

function compileNotices(results: readonly LayaTriageResult[]): MailHighImpactNotice[] {
  const notices: MailHighImpactNotice[] = [];
  for (const res of results) {
    if (res.route === 'main_agent' || res.reason === 'high_impact') {
      notices.push({
        messageId: res.messageId,
        source: res.source,
        sourceRevision: res.sourceRevision,
        label: res.label,
        candidateLabel: res.candidateLabel,
        route: res.route === 'group' ? 'main_agent' : res.route,
        reason: res.reason,
        confidence: res.scores?.answerConfidence ?? null,
      });
    }
  }
  return notices;
}

/**
 * Bounded mail triage pipeline using real Laya SLM classification.
 * - Structured key binding source, messageId, revision, and label/model/strategy fingerprint
 * - Transactional checkpointing: cache is updated only AFTER durable save succeeds
 * - In-batch duplicate message deduplication
 * - Strictly separated model inference throughput calculation from cache hits
 * - High-impact notification summaries without text or header leakage
 */
export class MailTriagePipeline {
  private readonly triageService: MailClassifierPort;
  private readonly checkpointPort?: MailTriageCheckpointPort | undefined;
  private readonly labels: Readonly<Record<string, string>>;
  private readonly chunkSize: number;
  private readonly minimum: number;
  private readonly margin: number;
  private readonly now: () => number;
  private readonly configDigest: string;
  private cache = new Map<string, LayaTriageResult>();
  private checkpointLoaded = false;
  private batchTail: Promise<void> = Promise.resolve();

  constructor(options: MailTriagePipelineOptions) {
    if (!options || (!options.inference && !options.classifier)) throw new CognitionError('INVALID_ARGUMENT');
    this.triageService = options.classifier ?? new LayaTriageService(options.inference!, options);
    this.checkpointPort = options.checkpoint;
    this.labels = {...(options.labels ?? DEFAULT_MAIL_LABELS)};
    this.chunkSize = Math.max(1, Math.min(options.chunkSize ?? 4, 16));
    this.minimum = options.minimumAnswerProbability ?? 0.7;
    this.margin = options.minimumMargin ?? 0.15;
    this.now = options.now ?? Date.now;

    const sortedLabels = Object.entries(this.labels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    this.configDigest = hash(JSON.stringify({
      strategyVersion: MAIL_TRIAGE_STRATEGY_VERSION,
      model: 'multilingual',
      minimumAnswerProbability: this.minimum,
      minimumMargin: this.margin,
      labels: sortedLabels,
      criteriaDigest: hash(JSON.stringify(this.labels)),
    }));
  }

  private makeKey(source: string, messageId: string, revision: string): string {
    return hash(JSON.stringify([source, messageId, revision, this.configDigest]));
  }

  /**
   * Processes a batch of projected mail messages with backpressure and bounded chunking.
   */
  async processBatch(request: MailBatchTriageRequest): Promise<MailBatchTriageSummary> {
    if (!request || !Array.isArray(request.messages)) throw new CognitionError('INVALID_ARGUMENT');
    request = {...request, messages: request.messages.map(message => ({...message}))};
    const result = this.batchTail.then(() => this.processBatchSerial(request));
    this.batchTail = result.then(() => {}, () => {});
    return result;
  }

  private async processBatchSerial(request: MailBatchTriageRequest): Promise<MailBatchTriageSummary> {
    if (!request || !Array.isArray(request.messages) || !(request.signal instanceof AbortSignal)
      || !Number.isFinite(Date.parse(request.deadline))) {
      throw new CognitionError('INVALID_ARGUMENT');
    }
    if (request.signal.aborted) throw new CognitionError('INVALID_ARGUMENT');
    const deadlineMs = Date.parse(request.deadline);
    if (this.now() >= deadlineMs) throw new CognitionError('INVALID_ARGUMENT');

    const startTime = this.now();

    // Load durable progress once if checkpoint port provided
    if (this.checkpointPort && !this.checkpointLoaded) {
      const persisted = await this.checkpointPort.load();
      const staged = new Map<string, LayaTriageResult>();
      if (persisted && typeof persisted === 'object') {
        for (const [key, val] of Object.entries(persisted)) {
          if (!val || typeof val !== 'object') throw new CognitionError('INVALID_ARGUMENT');
          if (!transientReasons.has(val.reason)) staged.set(key, structuredClone(val));
        }
      }
      this.cache.clear();
      for (const [key, val] of staged) this.cache.set(key, val);
      this.checkpointLoaded = true;
    }

    // Deduplicate duplicate messages within the batch request itself
    const uniqueMessages: LayaTriageMessage[] = [];
    const seenBatch = new Map<string, number>();
    for (const msg of request.messages) {
      if (!msg || typeof msg.source !== 'string' || typeof msg.messageId !== 'string'
        || typeof msg.sourceRevision !== 'string' || typeof msg.text !== 'string'
        || (msg.highImpact !== undefined && typeof msg.highImpact !== 'boolean')) {
        throw new CognitionError('INVALID_ARGUMENT');
      }
      const rawIdentity = JSON.stringify([msg.source, msg.messageId, msg.sourceRevision]);
      const previousIndex = seenBatch.get(rawIdentity);
      if (previousIndex === undefined) {
        seenBatch.set(rawIdentity, uniqueMessages.length);
        uniqueMessages.push(msg);
      } else {
        const previous = uniqueMessages[previousIndex]!;
        if (previous.text !== msg.text) throw new CognitionError('INVALID_ARGUMENT');
        if (msg.highImpact === true && previous.highImpact !== true) {
          uniqueMessages[previousIndex] = {...previous, highImpact: true};
        }
      }
    }

    const allResults: LayaTriageResult[] = [];
    const pendingMessages: LayaTriageMessage[] = [];
    let cachedCount = 0;

    // Filter out already processed messages (deduplication from cache)
    for (const msg of uniqueMessages) {
      const key = this.makeKey(msg.source, msg.messageId, msg.sourceRevision);
      const cached = this.cache.get(key);
      if (cached) {
        if (cached.source !== msg.source || cached.messageId !== msg.messageId
          || cached.sourceRevision !== msg.sourceRevision || cached.receipt?.contextDigest !== hash(msg.text)) {
          throw new CognitionError('INVALID_ARGUMENT');
        }
        if (msg.highImpact !== true && cached.reason === 'high_impact'
          && cached.impactScores?.choice === 'routine' && cached.candidateLabel !== 'meeting') {
          pendingMessages.push(msg);
          continue;
        }
        const result = structuredClone(cached);
        allResults.push(result.reason === 'insufficient_input'
          ? {...result, route: msg.highImpact === true ? 'main_agent' : 'review'}
          : msg.highImpact === true ? {...result, route: 'main_agent', reason: 'high_impact'} : result);
        cachedCount++;
      } else {
        pendingMessages.push(msg);
      }
    }

    let cumulativeInferenceMs = 0;
    const newlyClassified: LayaTriageResult[] = [];

    const emitProgress = () => {
      if (typeof request.onProgress !== 'function') return;
      const currentClassified = allResults.filter(r => Boolean(r.label)).length;
      const currentReview = allResults.filter(r => r.route === 'review').length;
      const currentHighImpact = allResults.filter(r => r.route === 'main_agent' || r.reason === 'high_impact').length;
      const currentUncertain = allResults.filter(r => r.reason === 'uncertain').length;
      const currentAbstained = allResults.filter(r => r.abstained).length;
      request.onProgress({
        processedCount: allResults.length,
        totalCount: uniqueMessages.length,
        cachedCount,
        newlyClassifiedCount: newlyClassified.length,
        classifiedCount: currentClassified,
        needsReviewCount: currentReview,
        highImpactCount: currentHighImpact,
        uncertainCount: currentUncertain,
        abstainedCount: currentAbstained,
        highImpactNotices: compileNotices(allResults),
      });
    };

    if (cachedCount > 0) {
      emitProgress();
    }

    // Process pending messages in bounded chunks
    for (let i = 0; i < pendingMessages.length; i += this.chunkSize) {
      if (request.signal.aborted || this.now() >= deadlineMs) {
        const remaining = pendingMessages.slice(i);
        const abortedReason = request.signal.aborted ? 'cancelled' : 'deadline';
        for (const msg of remaining) {
          allResults.push({
            source: msg.source,
            messageId: msg.messageId,
            sourceRevision: msg.sourceRevision,
            label: null,
            candidateLabel: null,
            route: msg.highImpact ? 'main_agent' : 'review',
            abstained: true,
            reason: abortedReason,
            calibrated: false,
            batching: 'multi_question',
            receipt: {
              id: hash(JSON.stringify([msg.source, msg.messageId, msg.sourceRevision, hash(JSON.stringify(this.labels)), msg.text])),
              promptVersion: 'mail-triage-v1',
              model: 'multilingual',
              candidateLabels: Object.keys(this.labels),
              criteriaDigest: hash(JSON.stringify(this.labels)),
              contextDigest: hash(msg.text),
            },
          });
        }
        emitProgress();
        break;
      }

      const chunk = pendingMessages.slice(i, i + this.chunkSize);
      const triageRequest: LayaTriageRequest = {
        messages: chunk.map(message => ({...message})),
        labels: {...this.labels},
        deadline: request.deadline,
        signal: request.signal,
      };

      const inferenceStart = this.now();
      const chunkResults = structuredClone(await this.triageService.classify(triageRequest));
      if (!Array.isArray(chunkResults) || chunkResults.length !== chunk.length) {
        throw new CognitionError('INVALID_ARGUMENT');
      }
      for (let index = 0; index < chunk.length; index++) {
        const message = chunk[index]!, result = chunkResults[index]!;
        if (!result || result.source !== message.source || result.messageId !== message.messageId
          || result.sourceRevision !== message.sourceRevision || result.receipt?.contextDigest !== hash(message.text)) {
          throw new CognitionError('INVALID_ARGUMENT');
        }
      }
      const inferenceEnd = this.now();
      cumulativeInferenceMs += Math.max(1, inferenceEnd - inferenceStart);

      // Persist to checkpoint BEFORE committing to in-memory cache
      // Only persist non-transient determinations (do NOT persist cancelled/deadline/unavailable)
      if (this.checkpointPort) {
        const snapshot: Record<string, LayaTriageResult> = {};
        for (const [k, v] of this.cache) snapshot[k] = v;
        for (const res of chunkResults) {
          if (!transientReasons.has(res.reason)) {
            snapshot[this.makeKey(res.source, res.messageId, res.sourceRevision)] = res;
          }
        }
        // If save fails, this.cache is preserved without partial unpersisted entries
        await this.checkpointPort.save(structuredClone(snapshot));
      }

      // Safe to update cache now
      for (const res of chunkResults) {
        if (!transientReasons.has(res.reason)) {
          const key = this.makeKey(res.source, res.messageId, res.sourceRevision);
          this.cache.set(key, structuredClone(res));
        }
        newlyClassified.push(res);
        allResults.push(res);
      }

      emitProgress();
    }

    const totalDurationMs = Math.max(1, this.now() - startTime);
    const newlyClassifiedCount = newlyClassified.length;

    // Pure model inference throughput: only newly classified messages divided by model inference time
    const messagesPerSecond = newlyClassifiedCount > 0
      ? Number(((newlyClassifiedCount / (cumulativeInferenceMs / 1000))).toFixed(2))
      : 0;

    // Compile summary and high impact notices
    let classifiedCount = 0;
    let highImpactCount = 0;
    let uncertainCount = 0;
    let abstainedCount = 0;
    let needsReviewCount = 0;
    const categoryCounts: Record<string, number> = {};
    const highImpactNotices: MailHighImpactNotice[] = [];

    for (const res of allResults) {
      if (res.abstained) {
        abstainedCount++;
      }
      if (res.label) {
        classifiedCount++;
        categoryCounts[res.label] = (categoryCounts[res.label] ?? 0) + 1;
      }

      if (res.route === 'review') {
        needsReviewCount++;
      }

      if (res.reason === 'uncertain') {
        uncertainCount++;
      }

      if (res.route === 'main_agent' || res.reason === 'high_impact') {
        highImpactCount++;
        highImpactNotices.push({
          messageId: res.messageId,
          source: res.source,
          sourceRevision: res.sourceRevision,
          label: res.label,
          candidateLabel: res.candidateLabel,
          route: res.route === 'group' ? 'main_agent' : res.route,
          reason: res.reason,
          confidence: res.scores?.answerConfidence ?? null,
        });
      }
    }

    return {
      total: allResults.length,
      cachedCount,
      newlyClassifiedCount,
      classifiedCount,
      highImpactCount,
      uncertainCount,
      abstainedCount,
      needsReviewCount,
      results: allResults,
      highImpactNotices,
      categoryCounts: Object.freeze(categoryCounts),
      throughput: {
        totalDurationMs,
        inferenceDurationMs: cumulativeInferenceMs,
        messagesPerSecond,
      },
    };
  }

  /**
   * Consumes a paged stream of mail messages with backpressure, progressive checkpoints,
   * cancellation and resumption.
   * - Does not load all messages into memory at once.
   * - Saves durable checkpoints after each chunk.
   * - Stops receiving new pages immediately when signal is aborted.
   * - Preserves already completed results on failure.
   */
  async processPagedStream(request: MailPagedTriageRequest): Promise<MailPagedTriageSummary> {
    if (!request || typeof request.fetchPage !== 'function' || !(request.signal instanceof AbortSignal)
      || !Number.isFinite(Date.parse(request.deadline))) {
      throw new CognitionError('INVALID_ARGUMENT');
    }
    if (request.signal.aborted) throw new CognitionError('INVALID_ARGUMENT');
    const deadlineMs = Date.parse(request.deadline);
    if (this.now() >= deadlineMs) throw new CognitionError('INVALID_ARGUMENT');

    const startTime = this.now();

    let currentCursor: MailCursorRef | undefined = request.initialCursor;
    let hasMore = true;
    let pagesProcessed = 0;
    let stoppedReason: MailPagedTriageSummary['stoppedReason'] = 'completed';

    const allResults: LayaTriageResult[] = [];
    let cachedCount = 0;
    let newlyClassifiedCount = 0;
    let cumulativeInferenceMs = 0;
    const maxPages = request.maxPages ?? Number.POSITIVE_INFINITY;

    while (hasMore && pagesProcessed < maxPages) {
      if (request.signal.aborted) {
        stoppedReason = 'cancelled';
        break;
      }
      if (this.now() >= deadlineMs) {
        stoppedReason = 'deadline';
        break;
      }

      const page = await request.fetchPage(currentCursor);
      if (request.signal.aborted) {
        stoppedReason = 'cancelled';
        break;
      }

      if (!page || !Array.isArray(page.messages) || typeof page.hasMore !== 'boolean'
        || (page.hasMore && (!page.nextCursor
          || (page.nextCursor.uidValidity === currentCursor?.uidValidity
            && page.nextCursor.lastUid === currentCursor?.lastUid)))) {
        throw new CognitionError('INVALID_ARGUMENT');
      }
      const pageMessages = page.messages;
      if (pageMessages.length > 0) {
        const pageSummary = await this.processBatch({
          messages: pageMessages,
          deadline: request.deadline,
          signal: request.signal,
          onProgress: request.onProgress ? (p) => {
            request.onProgress!({
              processedCount: allResults.length + p.processedCount,
              totalCount: allResults.length + p.totalCount,
              cachedCount: cachedCount + p.cachedCount,
              newlyClassifiedCount: newlyClassifiedCount + p.newlyClassifiedCount,
              classifiedCount: allResults.filter(r => Boolean(r.label)).length + p.classifiedCount,
              needsReviewCount: allResults.filter(r => r.route === 'review').length + p.needsReviewCount,
              highImpactCount: allResults.filter(r => r.route === 'main_agent' || r.reason === 'high_impact').length + p.highImpactCount,
              uncertainCount: allResults.filter(r => r.reason === 'uncertain').length + p.uncertainCount,
              abstainedCount: allResults.filter(r => r.abstained).length + p.abstainedCount,
              highImpactNotices: [...compileNotices(allResults), ...p.highImpactNotices],
            });
          } : undefined,
        });

        allResults.push(...pageSummary.results);
        cachedCount += pageSummary.cachedCount;
        newlyClassifiedCount += pageSummary.newlyClassifiedCount;
        cumulativeInferenceMs += pageSummary.throughput.inferenceDurationMs;
        // Do not acknowledge a page containing transient results. Restart rereads
        // the same page and the durable chunk cache skips only completed records.
        const transient = pageSummary.results.find(result => transientReasons.has(result.reason));
        if (transient) {
          stoppedReason = transient.reason === 'cancelled' ? 'cancelled'
            : transient.reason === 'deadline' ? 'deadline' : 'classification_unavailable';
          break;
        }
      }

      await request.onPageCompleted?.({
        cursor: page.nextCursor,
        hasMore: page.hasMore,
        processedCount: allResults.length,
      });
      currentCursor = page.nextCursor;
      hasMore = page.hasMore;
      pagesProcessed++;

      if (request.signal.aborted) {
        stoppedReason = 'cancelled';
        break;
      }
      if (this.now() >= deadlineMs) {
        stoppedReason = 'deadline';
        break;
      }
      if (hasMore && pagesProcessed >= maxPages) {
        stoppedReason = 'max_pages';
        break;
      }
    }

    const totalDurationMs = Math.max(1, this.now() - startTime);
    const messagesPerSecond = newlyClassifiedCount > 0
      ? Number(((newlyClassifiedCount / (cumulativeInferenceMs / 1000))).toFixed(2))
      : 0;

    let classifiedCount = 0;
    let highImpactCount = 0;
    let uncertainCount = 0;
    let abstainedCount = 0;
    let needsReviewCount = 0;
    const categoryCounts: Record<string, number> = {};
    const highImpactNotices: MailHighImpactNotice[] = [];

    for (const res of allResults) {
      if (res.abstained) abstainedCount++;
      if (res.label) {
        classifiedCount++;
        categoryCounts[res.label] = (categoryCounts[res.label] ?? 0) + 1;
      }
      if (res.route === 'review') needsReviewCount++;
      if (res.reason === 'uncertain') uncertainCount++;
      if (res.route === 'main_agent' || res.reason === 'high_impact') {
        highImpactCount++;
        highImpactNotices.push({
          messageId: res.messageId,
          source: res.source,
          sourceRevision: res.sourceRevision,
          label: res.label,
          candidateLabel: res.candidateLabel,
          route: res.route === 'group' ? 'main_agent' : res.route,
          reason: res.reason,
          confidence: res.scores?.answerConfidence ?? null,
        });
      }
    }

    return {
      total: allResults.length,
      cachedCount,
      newlyClassifiedCount,
      classifiedCount,
      highImpactCount,
      uncertainCount,
      abstainedCount,
      needsReviewCount,
      results: allResults,
      highImpactNotices,
      categoryCounts: Object.freeze(categoryCounts),
      throughput: {
        totalDurationMs,
        inferenceDurationMs: cumulativeInferenceMs,
        messagesPerSecond,
      },
      pagesProcessed,
      lastCursor: currentCursor,
      hasMore,
      stoppedReason,
    };
  }
}
