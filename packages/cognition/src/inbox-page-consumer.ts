import {CognitionError} from './impact.js';
import type {MailClassifierPort} from './mail-triage-pipeline.js';
import type {LayaTriageRequest} from './laya-triage.js';
import {withCognitionDeadline} from './deadline.js';

export interface InboxPageContext {deadline: string; signal: AbortSignal;}
export interface InboxPageScope extends InboxPageContext {accountRef: string; folder: string;}
/** Structural public view of Runtime's InboxTriagePipeline. Runtime owns cursor/cache/outbox. */
export interface CognitionInboxPipelinePort<Item = unknown, Summary = unknown> {
  readCursor(input: InboxPageScope): string | undefined;
  processPage(input: InboxPageScope & {cursor?: string | undefined; nextCursor: string;
    hasMore: boolean; items: readonly Item[]}): Promise<{
      classified: number; reused: number; complete: boolean;
      cursorAdvanced: boolean; nextCursor: string | undefined; hasMore: boolean; summary: Summary;
    }>;
  snapshot(): Summary;
}
export interface InboxPageStreamRequest<Item = unknown> extends InboxPageScope {
  fetchPage(input: InboxPageScope & {cursor?: string | undefined; limit: number}): Promise<{
    items: readonly Item[]; nextCursor: string; hasMore: boolean;
  }>;
  /** Bound one call, never an unbounded background schedule. */
  maxPages?: number;
  pageSize?: number;
  onPageCompleted?(input: {cursor: string; hasMore: boolean; pagesProcessed: number}): void | Promise<void>;
}
export interface InboxPageStreamResult<Summary = unknown> {
  pagesProcessed: number;
  classified: number;
  reused: number;
  cursor?: string | undefined;
  hasMore: boolean;
  stoppedReason: 'completed' | 'paused' | 'cancelled' | 'deadline' | 'max_pages' | 'classification_unavailable';
  summary: Summary;
}
const invalid = (): never => {throw new CognitionError('INVALID_ARGUMENT');};
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Backpressure/pause wrapper only. No alternate cache, checkpoint, cursor format or scheduler. */
export function createInboxPageConsumer<Item, Summary>(options: {
  pipeline: CognitionInboxPipelinePort<Item, Summary>; now?: () => number;
}) {
  if (typeof options?.pipeline?.readCursor !== 'function' || typeof options.pipeline.processPage !== 'function'
    || typeof options.pipeline.snapshot !== 'function') return invalid();
  const pipeline = options.pipeline, now = options.now ?? Date.now;
  let paused = false, closed = false, running = false;
  const lifecycle = (input: InboxPageContext): InboxPageStreamResult['stoppedReason'] | undefined =>
    input.signal.aborted || closed ? 'cancelled' : now() >= Date.parse(input.deadline) ? 'deadline'
      : paused ? 'paused' : undefined;
  const validate = (input: InboxPageScope): void => {
    if (!input || !text(input.accountRef) || !text(input.folder) || !(input.signal instanceof AbortSignal)
      || !Number.isFinite(Date.parse(input.deadline))) return invalid();
  };
  return Object.freeze({
    pause() {paused = true;},
    resume() {if (closed) return invalid(); paused = false;},
    close() {closed = true; paused = true;},
    snapshot: () => ({paused, closed, running, inbox: pipeline.snapshot()}),
    /** One page uses precisely the Runtime pipeline validation and atomic checkpoint. */
    processPage: (input: Parameters<typeof pipeline.processPage>[0]) => {
      validate(input);
      input = {...input, items: Array.isArray(input.items) ? [...input.items] : input.items};
      if (running || lifecycle(input)) return Promise.reject(new CognitionError('NOT_APPLICABLE'));
      running = true;
      return withCognitionDeadline(input, context => pipeline.processPage({...input, ...context}), now)
        .finally(() => {running = false;});
    },
    async processStream(request: InboxPageStreamRequest<Item>): Promise<InboxPageStreamResult<Summary>> {
      validate(request);
      const maxPages = request.maxPages ?? 100, pageSize = request.pageSize ?? 4;
      if (running || closed || typeof request.fetchPage !== 'function' || !Number.isSafeInteger(maxPages)
        || maxPages < 1 || maxPages > 1000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return invalid();
      // Copy identities before the first await. Untrusted page content cannot swap scope.
      const context = {accountRef: request.accountRef, folder: request.folder,
        deadline: request.deadline, signal: request.signal};
      running = true;
      try {
        const initialStop = lifecycle(context);
        if (initialStop) return {pagesProcessed: 0, classified: 0, reused: 0, hasMore: true,
          stoppedReason: initialStop, summary: pipeline.snapshot()};
        let cursor = pipeline.readCursor(context), hasMore = true;
        let pagesProcessed = 0, classified = 0, reused = 0;
        let stoppedReason: InboxPageStreamResult['stoppedReason'] = 'completed';
        while (hasMore && pagesProcessed < maxPages) {
          const stopped = lifecycle(context);
          if (stopped) {stoppedReason = stopped; break;}
          let page = await withCognitionDeadline(context,
            bounded => request.fetchPage({...context, ...bounded, cursor, limit: pageSize}), now);
          const afterFetch = lifecycle(context);
          if (afterFetch) {stoppedReason = afterFetch; break;}
          if (!page || !Array.isArray(page.items) || page.items.length > pageSize
            || !text(page.nextCursor) || typeof page.hasMore !== 'boolean'
            || (page.hasMore && page.nextCursor === cursor)) return invalid();
          page = {...page, items: [...page.items]};
          const result = await withCognitionDeadline(context, bounded => pipeline.processPage({...context, ...bounded, cursor,
            items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore}), now);
          classified += result.classified; reused += result.reused;
          // Failed/partial classification NEVER acknowledges this source page.
          if (!result.complete || !result.cursorAdvanced || result.nextCursor !== page.nextCursor) {
            stoppedReason = lifecycle(context) ?? 'classification_unavailable'; break;
          }
          cursor = result.nextCursor; hasMore = page.hasMore; pagesProcessed++;
          // Cursor is already durably advanced by Runtime, including if the callback
          // pauses/cancels. Reopening resumes from this exact confirmed source cursor.
          if (request.onPageCompleted) await withCognitionDeadline(context,
            async () => {await request.onPageCompleted!({cursor: cursor!, hasMore, pagesProcessed});}, now);
          const afterPage = lifecycle(context);
          if (afterPage) {stoppedReason = afterPage; break;}
          if (hasMore && pagesProcessed >= maxPages) stoppedReason = 'max_pages';
        }
        return {pagesProcessed, classified, reused, cursor, hasMore, stoppedReason, summary: pipeline.snapshot()};
      } finally {running = false;}
    },
  });
}

export interface TriageCallMetrics {
  classifyCalls: number;
  submittedCount: number;
  inferredCount: number;
  classifyWallMs: number;
}
/** Measures real public classify awaits; cache reads call no classifier and count zero. */
export function measureTriageClassifier(classifier: MailClassifierPort, clock: () => number = () => performance.now()) {
  if (typeof classifier?.classify !== 'function') return invalid();
  const metrics: TriageCallMetrics = {classifyCalls: 0, submittedCount: 0, inferredCount: 0, classifyWallMs: 0};
  return Object.freeze({
    snapshot: (): TriageCallMetrics => ({...metrics}),
    async classify(request: LayaTriageRequest) {
      const started = clock();
      metrics.classifyCalls++; metrics.submittedCount += request.messages.filter(message => message.text.trim()).length;
      try {
        const results = await classifier.classify(request);
        metrics.inferredCount += results.filter(result => !['unavailable', 'invalid_response', 'cancelled', 'deadline', 'insufficient_input'].includes(result.reason)).length;
        return results;
      } finally {metrics.classifyWallMs += Math.max(0, clock() - started);}
    },
  });
}
