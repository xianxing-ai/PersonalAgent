import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext} from '@personal-agent/contracts';
import {DUTY_STATUS_MARKER, buildPersonalView, classifyCiFailure, defaultRepoDutyPolicy, planStatusComment, type DutyCursor, type DutyPollPage, type RepoDutyPolicy} from '@personal-agent/github';
import type {TaskRuntime} from '../index.js';
import {readCanonicalUserWorkParent} from './user-task-delegation.js';
import {commitDeveloperDutyStatusComment, commitPullRequestDutyComment, dutyPullCommentBody, ingestDeveloperDutyPoll, queueDeveloperDutyNotification, type DeveloperDutyPorts} from './developer-duty.js';

export const DUTY_WATCH = 'duty.watch';
export const DUTY_UNWATCH = 'duty.unwatch';
export const DUTY_POLICY_SET = 'duty.policy.set';
export const DUTY_PERSONAL_LIST = 'duty.personal.list';
export const DUTY_STATUS = 'duty.status';
export const DUTY_CI_TRIAGE = 'duty.ci.triage';
export const DUTY_COMMENT_PUBLISH = 'duty.comment.publish';
export const DUTY_TOOL_VERSION = '1.0.0';
const KEY = 'developer-duty-registry:v1';
const WATCH = 'developer-duty-watch:v1';
const POLICY = 'developer-duty-policy:v1';
const INTENTS = 'developer-duty-comment-intent-index:v1';
type CommentArguments = {repo: string; number: number; body: string; action: 'create' | 'edit'; commentId?: number};
type CommentIntent = CommentArguments & {state: 'requires_authorization' | 'confirmed' | 'unknown';
  source?: {repo: string; number: number; headSha: string; ci: string; conclusion: string}};
const intentKey = (repo: string, number: number) => `developer-duty-comment-intent:v1:${repo}#${number}`;
const commentArguments = ({repo, number, body, action, commentId}: CommentIntent): CommentArguments =>
  ({repo, number, body, action, ...(commentId === undefined ? {} : {commentId})});

export interface DeveloperDutyToolOptions {
  getRuntime: () => TaskRuntime;
  readPage?: (repo: string, cursor: DutyCursor | undefined) => Promise<DutyPollPage>;
  comments?: DeveloperDutyPorts;
  /** Real comment port for one repository. Undefined means the credential is not connected. */
  createComments?: (input: {repo: string; number?: number; context?: ToolContext; assertCurrent?: () => void}) => DeveloperDutyPorts | undefined | Promise<DeveloperDutyPorts | undefined>;
  readPersonal?: () => Promise<Record<string, unknown>>;
  /** Checkpoint-backed comment port. It does not call GitHub. */
  useFixtureComments?: boolean;
  now?: () => number;
  onNotify?: (notice: {channel: 'f12'; delivered: boolean; duplicate: boolean; summary: string; dedupeKey: string}) => void;
  onEvents?: (repo: string, events: readonly {deliveryId?: string; id?: string; headSha?: string; number?: number}[]) => Promise<void> | void;
  submitRemote?: (job: {kind: 'developer-duty'; idempotencyKey: string; taskId: string; repo: string; payload: Record<string, unknown>}) => Promise<{location: string; reason: string; receipt: Record<string, unknown>}>;
}

function fail(code: 'INVALID_ARGUMENT' | 'SCOPE_DENIED' | 'UNAUTHORIZED' | 'REVISION_CONFLICT' | 'UNSUPPORTED_CAPABILITY', message: string): never {throw new ProtocolError(code, message);}
const repoOk = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);

export function createDeveloperDutyTools(options: DeveloperDutyToolOptions): {tools: RegisteredTool[]; poll(): Promise<Array<Record<string, unknown>>>} {
  const runtime = () => options.getRuntime();
  const assertUserWorker = (taskId: string) => {
    if (runtime().getTask(taskId).conversationId?.startsWith('desktop-subtask:')
      && readCanonicalUserWorkParent(runtime(), taskId) === undefined)
      fail('UNAUTHORIZED', 'Duty is controlled by the original user task or its bound user worker');
  };
  const owner = () => runtime().findTaskByIdempotencyKey(KEY) ?? runtime().submitTask({conversationId: 'developer-duty', goal: '开发值班', idempotencyKey: KEY});
  const watches = (): string[] => (runtime().loadCheckpoint(owner().taskId, WATCH) as {repos?: string[]} | undefined)?.repos ?? [];
  const policies = (): Record<string, RepoDutyPolicy> => (runtime().loadCheckpoint(owner().taskId, POLICY) as {policies?: Record<string, RepoDutyPolicy>} | undefined)?.policies ?? {};
  const saveWatches = (repos: string[]) => runtime().saveCheckpoint(owner().taskId, WATCH, {repos});
  const saveIntent = (intent: CommentIntent) => {
    const taskId = owner().taskId, key = intentKey(intent.repo, intent.number);
    runtime().saveCheckpoint(taskId, key, intent);
    const keys = runtime().loadCheckpoint(taskId, INTENTS) as string[] | undefined ?? [];
    if (!keys.includes(key)) runtime().saveCheckpoint(taskId, INTENTS, [...keys, key]);
  };
  const pendingComments = () => (runtime().loadCheckpoint(owner().taskId, INTENTS) as string[] | undefined ?? [])
    .map(key => runtime().loadCheckpoint(owner().taskId, key) as CommentIntent)
    .filter(intent => intent?.state === 'requires_authorization' && watches().includes(intent.repo)).map(commentArguments);
  const commitIntent = (intent: CommentIntent, ports: DeveloperDutyPorts) => intent.source
    ? commitPullRequestDutyComment(runtime(), owner().taskId, ports, intent.source)
    : commitDeveloperDutyStatusComment(runtime(), owner().taskId, ports, intent.body.slice(DUTY_STATUS_MARKER.length + 1)).then(attempt => ({wrote: true, attempt}));
  const readPage = options.readPage ?? (async () => ({repo: '', connected: false, gap: true, events: []}));
  const descriptor = (name: string, read: boolean, input: {[k: string]: unknown}): RegisteredTool['descriptor'] => ({
    name, version: DUTY_TOOL_VERSION, inputSchema: input, outputSchema: {type: 'object', additionalProperties: true},
    sideEffect: read ? 'read' : 'local_write', requiredScopes: ['agent:delegate'], idempotencySupport: false, recoverySupport: true, requiresPresence: false});
  const object = (properties: Record<string, unknown>, required: string[]) => ({type: 'object', additionalProperties: false, properties, required});
  const commentsFor = (taskId: string): DeveloperDutyPorts | undefined => {
    if (options.comments) return options.comments;
    if (!options.useFixtureComments) return undefined;
    const key = 'developer-duty-fixture-comments:v1';
    const read = () => (runtime().loadCheckpoint(taskId, key) as {items?: Array<{id: number; body: string}>} | undefined)?.items ?? [];
    const write = (items: Array<{id: number; body: string}>) => runtime().saveCheckpoint(taskId, key, {items, evidenceLevel: 'fixture'});
    return {
      listComments: async () => read().map(item => ({...item})),
      createComment: async body => {
        const items = read();
        const id = (items.at(-1)?.id ?? 0) + 1;
        write([...items, {id, body}]);
        return {state: 'confirmed', id};
      },
      editComment: async (id, body) => {
        const items = read();
        if (!items.some(item => item.id === id)) return {state: 'unknown'};
        write(items.map(item => item.id === id ? {id, body} : item));
        return {state: 'confirmed'};
      },
    };
  };
  const notify = (taskId: string, summary: string, dedupeKey: string) => {
    const notice = queueDeveloperDutyNotification(runtime(), taskId, summary, dedupeKey);
    options.onNotify?.(notice);
    return notice;
  };
  const poll = async () => {
    const task = owner();
    const results = [];
    const comments = commentsFor(task.taskId);
    for (const repo of watches()) {
      const policy = policies()[repo] ?? defaultRepoDutyPolicy(repo);
      if (!policy.allowed) {results.push({repo, skipped: 'repository is not allowlisted'}); continue;}
      const stored = runtime().loadCheckpoint(task.taskId, 'developer-duty-cursor:v1') as DutyCursor | undefined;
      const cursor = stored?.repo === repo ? stored : undefined;
      const page = {...await readPage(repo, cursor), repo};
      const bucket = Math.floor((options.now?.() ?? Date.now()) / 60_000);
      const statusComment = (page as {statusComment?: {number?: number; body?: string; existing?: unknown; writeState?: string}; reason?: string; evidenceLevel?: string}).statusComment;
      const pullRequests = (page as {pullRequests?: Array<{number?: number; headSha?: string; ci?: string; conclusion?: string}>}).pullRequests;
      const evidenceLevel = (page as {evidenceLevel?: string}).evidenceLevel ?? 'fixture';
      const pageReason = (page as {reason?: string}).reason;
      const blocked = page.gap || page.connected === false || (page as {rateLimited?: boolean}).rateLimited === true;
      const writeComment = async (via: 'remote' | 'local'): Promise<{wrote: boolean; reason?: string}> => {
        if (blocked) return {wrote: false, reason: (page as {rateLimited?: boolean}).rateLimited ? 'rate limited' : 'gap is not a comment'};
        if (!policy.comment) return {wrote: false, reason: 'comment is off'};
        const attemptComment = async (ports: DeveloperDutyPorts, body: string, number: number, source?: CommentIntent['source']) => {
          const existing = await ports.listComments();
          const plan = planStatusComment({desiredBody: body, existing});
          const intent: CommentIntent = {repo, number, body: `${DUTY_STATUS_MARKER}\n${body.trim()}`,
            action: plan.action === 'edit' ? 'edit' : 'create', ...(plan.commentId === undefined ? {} : {commentId: plan.commentId}),
            state: 'requires_authorization', ...(source ? {source} : {})};
          try {
            await commitIntent(intent, {...ports, writeAvailable: false, listComments: async () => existing});
            saveIntent({...intent, state: 'confirmed'});
            return {wrote: false};
          } catch (error) {
            if (error instanceof ProtocolError && error.code === 'RESULT_UNKNOWN') return {wrote: false, reason: 'comment result requires readback'};
            if (!(error instanceof ProtocolError) || error.code !== 'UNSUPPORTED_CAPABILITY') throw error;
            saveIntent(intent);
            return {wrote: false, reason: 'comment requires ToolGateway content authorization'};
          }
        };
        if (Array.isArray(pullRequests)) {
          let wrote = false;
          let reason: string | undefined;
          for (const pull of pullRequests) {
            if (typeof pull.number !== 'number' || !Number.isInteger(pull.number) || typeof pull.headSha !== 'string' || !/^[0-9a-f]{40}$/i.test(pull.headSha) || typeof pull.ci !== 'string' || typeof pull.conclusion !== 'string') continue;
            const ports = await options.createComments?.({repo, number: pull.number}) ?? (via === 'local' ? comments : undefined);
            if (!ports) return {wrote, reason: 'not connected'};
            const input = {repo, number: pull.number, headSha: pull.headSha, ci: pull.ci, conclusion: pull.conclusion};
            const result = await attemptComment(ports, dutyPullCommentBody(input), pull.number, input);
            wrote = wrote || result.wrote;
            if ('reason' in result) reason = result.reason;
          }
          return {wrote, ...(reason ? {reason} : {})};
        }
        if (!statusComment?.body || !Number.isInteger(statusComment.number) || statusComment.number! < 1) return {wrote: false, reason: 'no exact comment target'};
        const ports = await options.createComments?.({repo, ...(Number.isInteger(statusComment.number) ? {number: statusComment.number} : {})}) ?? (via === 'local' ? comments : undefined);
        if (ports) {
          return attemptComment(ports, statusComment.body, statusComment.number!);
        }
        return {wrote: false, reason: 'not connected'};
      };
      if (options.submitRemote) {
        const remote = await options.submitRemote({kind: 'developer-duty', idempotencyKey: `duty-poll:${repo}:${cursor?.deliveryId ?? 'start'}:${bucket}`, taskId: task.taskId, repo,
          payload: {action: 'poll', repo, page, ...(cursor ? {cursor} : {})}});
        if (remote.location === 'remote') {
          const gap = remote.receipt.gap === true || remote.receipt.connected === false;
          const events = Array.isArray(remote.receipt.events) ? remote.receipt.events : [];
          if (!gap && events.length) {
            notify(task.taskId, `${repo} 有 ${events.length} 条新事件`, `duty:${repo}:${events.map(event => (event as {deliveryId?: string; id?: string}).deliveryId ?? (event as {id?: string}).id).join(',')}`);
            await options.onEvents?.(repo, events as Array<{deliveryId?: string; id?: string; headSha?: string; number?: number}>);
          }
          const comment = gap ? {wrote: false} : await writeComment('remote');
          results.push({repo, location: remote.location, reason: pageReason || comment.reason || remote.reason, gap, noChange: gap ? false : remote.receipt.noChange === true, evidenceLevel, ...(comment.wrote ? {comment: true} : {})});
          continue;
        }
        const local = ingestDeveloperDutyPoll(runtime(), task.taskId, cursor, page);
        if (local.advanced && local.receipt) notify(task.taskId, `${repo} 有新的值班事件`, `duty:${repo}:${page.events.map(event => event.deliveryId).join(',')}`);
        if (local.advanced) await options.onEvents?.(repo, page.events);
        const comment = page.gap || !page.connected ? {wrote: false} : await writeComment('local');
        results.push({repo, location: 'local', reason: pageReason || comment.reason || remote.reason || (page.gap || !page.connected ? 'gap is not no change' : 'local cursor'), gap: page.gap || !page.connected, noChange: local.noChange === true && page.connected === true && page.gap === false, evidenceLevel, ...(comment.wrote ? {comment: true} : {})});
        continue;
      }
      const local = ingestDeveloperDutyPoll(runtime(), task.taskId, cursor, page);
      if (local.advanced && local.receipt) notify(task.taskId, `${repo} 有新的值班事件`, `duty:${repo}:${page.events.map(event => event.deliveryId).join(',')}`);
      if (local.advanced) await options.onEvents?.(repo, page.events);
      const comment = page.gap || !page.connected ? {wrote: false} : await writeComment('local');
      results.push({repo, location: 'local', reason: pageReason || comment.reason || (page.gap || !page.connected ? 'gap is not no change' : 'local cursor'), gap: page.gap || !page.connected, noChange: local.noChange === true && page.connected === true && page.gap === false, evidenceLevel, ...(comment.wrote ? {comment: true} : {})});
    }
    return results;
  };
  const tools: RegisteredTool[] = [
    {descriptor: descriptor(DUTY_WATCH, false, object({repo: {type: 'string'}}, ['repo'])), execute: async (input, context) => {
      assertUserWorker(context.taskId);
      const repo = String((input as {repo?: string}).repo ?? '');
      if (!repoOk(repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
      const next = [...new Set([...watches(), repo])];
      saveWatches(next);
      const current = policies();
      if (!current[repo]) runtime().saveCheckpoint(owner().taskId, POLICY, {policies: {...current, [repo]: defaultRepoDutyPolicy(repo)}});
      return {repo, watched: true, merge: false};
    }},
    {descriptor: descriptor(DUTY_UNWATCH, false, object({repo: {type: 'string'}}, ['repo'])), execute: async (input) => {
      const repo = String((input as {repo?: string}).repo ?? '');
      saveWatches(watches().filter(item => item !== repo));
      return {repo, watched: false};
    }},
    {descriptor: descriptor(DUTY_POLICY_SET, false, object({repo: {type: 'string'}, comment: {type: 'boolean'}, pushBranches: {type: 'array', items: {type: 'string'}}, allowed: {type: 'boolean'}}, ['repo', 'allowed'])), execute: async (input) => {
      const raw = input as {repo?: string; comment?: boolean; pushBranches?: string[]; allowed?: boolean; merge?: boolean};
      if (!raw.repo || !repoOk(raw.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
      if (raw.merge === true) fail('SCOPE_DENIED', 'Merge stays forbidden by default');
      const policy: RepoDutyPolicy = {repo: raw.repo, allowed: raw.allowed === true, comment: raw.comment === true, pushBranches: Array.isArray(raw.pushBranches) ? raw.pushBranches.filter(branch => typeof branch === 'string') : [], merge: false};
      runtime().saveCheckpoint(owner().taskId, POLICY, {policies: {...policies(), [policy.repo]: policy}});
      return policy;
    }},
    {descriptor: descriptor(DUTY_PERSONAL_LIST, true, object({}, [])), execute: async () => options.readPersonal ? options.readPersonal() : ({items: buildPersonalView({login: 'fixture', assigned: [], reviewRequested: [], failing: []}), evidenceLevel: 'fixture', reason: 'fixture'})},
    {descriptor: {...descriptor(DUTY_COMMENT_PUBLISH, false, object({repo: {type: 'string'}, number: {type: 'integer', minimum: 1},
      body: {type: 'string', minLength: 1}, action: {enum: ['create', 'edit']}, commentId: {type: 'integer', minimum: 1}}, ['repo', 'number', 'body', 'action'])),
      sideEffect: 'external_write', requiredScopes: ['github:write'], requiresPresence: true}, execute: async (input, context) => {
      assertUserWorker(context.taskId);
      const args = input as CommentArguments;
      if (!args || !repoOk(args.repo) || !Number.isInteger(args.number) || args.number < 1 || typeof args.body !== 'string'
        || !['create', 'edit'].includes(args.action) || Object.keys(args).some(key => !['repo', 'number', 'body', 'action', 'commentId'].includes(key))
        || (args.action === 'edit' ? !Number.isInteger(args.commentId) || args.commentId! < 1 : args.commentId !== undefined)) fail('INVALID_ARGUMENT', 'Invalid exact duty comment intent');
      const taskId = owner().taskId, intent = runtime().loadCheckpoint(taskId, intentKey(args.repo, args.number)) as CommentIntent | undefined;
      if (!intent || intent.state !== 'requires_authorization' || !isDeepStrictEqual(commentArguments(intent), args)) fail('REVISION_CONFLICT', 'Original duty comment intent changed');
      const assertCurrent = () => {
        const policy = policies()[args.repo];
        if (!context?.authorizationRef || !context.scopes?.includes('github:write') || context.taskId === taskId
          || context.signal?.aborted || !(Date.parse(context.deadline) > Date.now())) fail('UNAUTHORIZED', 'Duty comment requires original user tool authorization');
        if (!watches().includes(args.repo) || !policy?.allowed || !policy.comment
          || !isDeepStrictEqual(runtime().loadCheckpoint(taskId, intentKey(args.repo, args.number)), intent)) fail('REVISION_CONFLICT', 'Original duty comment intent changed');
      };
      assertCurrent();
      const ports = await options.createComments?.({repo: args.repo, number: args.number, context, assertCurrent}) ?? commentsFor(taskId);
      if (!ports) fail('UNSUPPORTED_CAPABILITY', 'Duty comment host is unavailable');
      assertCurrent();
      const exact = (action: string, body: string, commentId?: number) => {
        assertCurrent();
        if (action !== args.action || body !== args.body || commentId !== args.commentId) fail('REVISION_CONFLICT', 'Approved duty comment target changed');
      };
      const result = await commitIntent(intent, {...ports,
        listComments: async () => {
          const existing = await ports.listComments();
          const plan = planStatusComment({desiredBody: args.body.slice(DUTY_STATUS_MARKER.length + 1), existing});
          if (plan.action === 'create' || plan.action === 'edit') exact(plan.action, plan.body, plan.commentId);
          else if (plan.action === 'read_back' && args.action === 'edit' && plan.commentId !== undefined && plan.commentId !== args.commentId)
            fail('REVISION_CONFLICT', 'Approved duty comment target changed');
          return existing;
        },
        createComment: body => {exact('create', body); return ports.createComment(body);},
        editComment: (id, body) => {exact('edit', body, id); return ports.editComment(id, body);}});
      saveIntent({...intent, state: 'confirmed'});
      return {state: 'confirmed', commentId: result.attempt?.commentId, wrote: result.wrote};
    }},
    {descriptor: descriptor(DUTY_STATUS, true, object({}, [])), execute: async () => {
      const task = owner();
      return {repos: watches(), policies: policies(), pendingComments: pendingComments(), cursor: runtime().loadCheckpoint(task.taskId, 'developer-duty-cursor:v1') ?? null,
        gap: runtime().loadCheckpoint(task.taskId, 'developer-duty-gap:v1') ?? null, evidenceLevel: 'fixture'};
    }},
    {descriptor: descriptor(DUTY_CI_TRIAGE, true, object({logExcerpt: {type: 'string'}}, ['logExcerpt'])), execute: async (input) => ({...classifyCiFailure({logExcerpt: String((input as {logExcerpt?: string}).logExcerpt ?? '')}), evidenceLevel: 'fixture' as const})},
  ];
  return {tools, poll};
}
