import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {AgentToolPort, AgentWorkerContext} from '@personal-agent/agents';

export interface CiRunListRequest {repo: string; page?: number; perPage?: number; branch?: string}
export interface CiDiscoveredRun {
  id: number; name: string; status: 'completed'; conclusion: 'failure';
  headSha: string; url: string; createdAt: string;
}
export interface CiRunListResult {
  state: 'listed' | 'waiting_approval' | 'waiting_reconciliation';
  items: readonly CiDiscoveredRun[]; page: number; nextPage: number | null; hasMore: boolean;
  evidenceRefs: readonly string[];
}
export interface CiRunDiscoveryOptions {
  tools: AgentToolPort;
  maxSteps: number;
  authorizationRefFor(tool: string, context: AgentWorkerContext): string | undefined;
  /** Runtime confirms this original run has a durable confirmed receipt/cache. */
  confirmedReplayReady?(runId: string, context: AgentWorkerContext): boolean;
  now?: () => number;
}
export interface CiRunDiscoveryWorkflowPort {
  listFailedRuns(context: AgentWorkerContext, request: CiRunListRequest): Promise<CiRunListResult>;
}

const toolName = 'github.actions.run.list';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function invalid(): never {throw new ProtocolError('INVALID_ARGUMENT', 'Invalid CI discovery request, receipt or checkpoint');}
type Arguments = {repo: string; page: number; perPage: number; status: 'failure'; branch?: string};
function argumentsFor(request: CiRunListRequest): Arguments {
  if (!object(request) || Object.keys(request).some(k => !['repo', 'page', 'perPage', 'branch'].includes(k))
    || typeof request.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(request.repo)
    || (request.page !== undefined && (!positive(request.page) || request.page > 10000))
    || (request.perPage !== undefined && (!positive(request.perPage) || request.perPage > 30))
    || (request.branch !== undefined && (typeof request.branch !== 'string' || request.branch.length > 255
      || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(request.branch)))) invalid();
  return {repo: request.repo, page: request.page ?? 1, perPage: request.perPage ?? 30,
    status: 'failure', ...(request.branch === undefined ? {} : {branch: request.branch})};
}
function parseRun(value: unknown, repo: string): CiDiscoveredRun {
  if (!object(value) || !positive(value.id) || typeof value.name !== 'string' || value.name.length > 4096
    || value.status !== 'completed' || value.conclusion !== 'failure'
    || typeof value.headSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value.headSha)
    || typeof value.url !== 'string' || value.url.length > 2048
    || typeof value.createdAt !== 'string' || value.createdAt.length > 64 || !Number.isFinite(Date.parse(value.createdAt))) invalid();
  let url: URL;
  try {url = new URL(value.url);} catch {invalid();}
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash
    || url.pathname.toLowerCase() !== `/${repo}/actions/runs/${value.id}`.toLowerCase()) invalid();
  return {id: value.id, name: value.name, status: 'completed', conclusion: 'failure',
    headSha: value.headSha, url: value.url, createdAt: value.createdAt};
}
function parsePage(value: unknown, args: Arguments, evidenceRefs: readonly string[]): CiRunListResult {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > args.perPage || value.page !== args.page
    || typeof value.hasMore !== 'boolean' || (value.hasMore
      ? args.page >= 10000 || value.nextPage !== args.page + 1 : value.nextPage !== null)) invalid();
  const items = value.items.map(item => parseRun(item, args.repo));
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  return {state: 'listed', items, page: args.page, nextPage: value.nextPage as number | null,
    hasMore: value.hasMore, evidenceRefs: [...evidenceRefs]};
}
interface Journal {
  identity: string; steps: 1; phase: 'pending' | 'inflight' | 'unknown' | 'listed';
  evidenceRefs: string[]; page?: unknown;
}

/** Single approved read. The host selects a run and submits a separate existing CI repair task. */
export function createCiRunDiscoveryWorkflow(options: CiRunDiscoveryOptions): CiRunDiscoveryWorkflowPort {
  if (!positive(options.maxSteps) || !options.tools || typeof options.authorizationRefFor !== 'function') invalid();
  const now = options.now ?? Date.now, maxSteps = options.maxSteps, tools = options.tools;
  function check(context: AgentWorkerContext) {
    if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'CI discovery cancelled');
    const deadline = Date.parse(context.deadline), current = now();
    if (!Number.isFinite(deadline) || !Number.isFinite(current) || current >= deadline) {
      throw new ProtocolError('TIMEOUT', 'CI discovery deadline exceeded');
    }
  }
  async function bounded<T>(context: AgentWorkerContext, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    check(context);
    const controller = new AbortController(), deadline = Date.parse(context.deadline);
    let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt = () => {};
    const abort = () => controller.abort();
    const interruptedError = () => new ProtocolError(timedOut ? 'TIMEOUT' : 'CANCELLED',
      timedOut ? 'CI discovery deadline exceeded' : 'CI discovery cancelled');
    const expire = () => {
      const remaining = deadline - now();
      if (!Number.isFinite(remaining) || remaining <= 0) {timedOut = true; controller.abort();}
      else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(interruptedError());
        controller.signal.addEventListener('abort', interrupt, {once: true});
        context.signal.addEventListener('abort', abort, {once: true});
        if (context.signal.aborted) abort();
        expire();
      });
      const operation = Promise.resolve().then(() => {
        check(context);
        if (controller.signal.aborted) throw interruptedError();
        return work(controller.signal);
      });
      try {
        const result = await Promise.race([interrupted, operation]);
        check(context);
        if (controller.signal.aborted) throw interruptedError();
        return result;
      } catch (error) {
        check(context);
        if (controller.signal.aborted) throw interruptedError();
        throw error;
      }
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', interrupt);
    }
  }
  return {async listFailedRuns(context, request) {
    check(context);
    const args = argumentsFor(request);
    const descriptor = tools.list().find(tool => tool.name === toolName);
    if (!descriptor || descriptor.sideEffect !== 'read') {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Registered read-only CI discovery tool unavailable');
    }
    const identity = createHash('sha256').update(JSON.stringify([args, maxSteps, descriptor.version])).digest('hex');
    const key = 'ci-run-discovery-v1', runId = `${context.taskId}:ci-run-list:${identity}`;
    const saved: unknown = context.loadCheckpoint(key);
    if (saved !== undefined && (!object(saved) || saved.identity !== identity || saved.steps !== 1
      || !['pending', 'inflight', 'unknown', 'listed'].includes(saved.phase as string)
      || !Array.isArray(saved.evidenceRefs) || !saved.evidenceRefs.every(ref => typeof ref === 'string'))) invalid();
    const journal: Journal = saved === undefined ? {identity, steps: 1, phase: 'pending', evidenceRefs: []}
      : structuredClone(saved) as unknown as Journal;
    const save = () => context.saveCheckpoint(key, structuredClone(journal));
    const pause = (state: 'waiting_approval' | 'waiting_reconciliation'): CiRunListResult => ({state, items: [],
      page: args.page, nextPage: null, hasMore: false, evidenceRefs: [...journal.evidenceRefs]});
    if (journal.phase === 'listed') return parsePage(journal.page, args, journal.evidenceRefs);
    const reconciling = journal.phase === 'inflight' || journal.phase === 'unknown';
    if (reconciling) {
      if (options.confirmedReplayReady?.(runId, context) !== true) return pause('waiting_reconciliation');
    }
    // Reserve once, before approval/dispatch. Resuming the original page never spends another read.
    const authorizationRef = options.authorizationRefFor(toolName, context);
    if (!authorizationRef) {if (!reconciling) journal.phase = 'pending'; save(); return pause('waiting_approval');}
    journal.phase = 'inflight'; save();
    const receipt = structuredClone(await bounded(context, signal => tools.invoke({toolName,
      toolVersion: descriptor.version, arguments: structuredClone(args), taskId: context.taskId, runId,
      authorizationRef, deadline: context.deadline, signal})));
    check(context);
    if (!object(receipt) || !['confirmed', 'pending', 'unknown'].includes(receipt.state as string)
      || !Array.isArray(receipt.evidenceRefs) || !receipt.evidenceRefs.every(ref => typeof ref === 'string')) invalid();
    journal.evidenceRefs = [...new Set([...journal.evidenceRefs, ...receipt.evidenceRefs])];
    if (receipt.state !== 'confirmed') {
      journal.phase = receipt.state === 'pending' && !reconciling ? 'pending' : 'unknown'; save();
      return pause(journal.phase === 'pending' ? 'waiting_approval' : 'waiting_reconciliation');
    }
    const result = parsePage(receipt.result, args, journal.evidenceRefs);
    journal.page = {items: structuredClone(result.items), page: result.page, nextPage: result.nextPage, hasMore: result.hasMore};
    journal.phase = 'listed'; save();
    return result;
  }};
}
