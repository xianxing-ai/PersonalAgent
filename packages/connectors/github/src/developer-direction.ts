import {createHmac, createHash, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {isAbsolute, relative, resolve} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {acceptGitHubWebhook, type DutyEvent} from './developer-duty.js';

export type TriggerSource = 'pr' | 'check_run' | 'workflow_run' | 'issue' | 'schedule' | 'manual';
export type TriggerWorkflow = 'ci_fix' | 'review' | 'triage' | 'api_docs' | 'custom_subagent';

export interface TriggerRule {
  id: string;
  source: TriggerSource;
  match: {repo?: string; branch?: string; conclusion?: string; labels?: readonly string[]; author?: string; action?: string};
  action: {workflow: TriggerWorkflow; typeName?: string};
  cooldownMs: number;
  maxConcurrentPerRepo: number;
}

export interface TriggerEvent {
  repo: string;
  source: TriggerSource;
  deliveryId: string;
  number?: number;
  headSha?: string;
  branch?: string;
  conclusion?: string;
  labels?: readonly string[];
  author?: string;
  action?: string;
  gap?: boolean;
}

export interface TriggerDispatch {
  dedupeKey: string;
  taskId: string;
  at: number;
  headSha?: string;
  ruleId: string;
}

export interface TriggerState {
  dispatched: TriggerDispatch[];
  activeByRepo: Record<string, number>;
}

export interface TriggerRoute {
  status: 'spawn' | 'deduped' | 'cooldown' | 'busy' | 'miss' | 'gap';
  dedupeKey?: string;
  supersededTaskId?: string;
  ruleId?: string;
  workflow?: TriggerWorkflow;
  typeName?: string;
}

export type CiLoopPhase = 'diagnose' | 'patch' | 'local_verify' | 'push' | 'await_ci' | 'green' | 'stopped';
export interface CiLoopState {
  repo: string;
  number: number;
  phase: CiLoopPhase;
  headSha?: string;
  round: number;
  maxRounds: number;
  flakyReruns: number;
  note: string;
}
export type CiLoopSignal = 'diagnosed' | 'patched' | 'verified' | 'verify_failed' | 'pushed' | 'ci_green' | 'ci_red' | 'ci_flaky';

export interface StableCiClass {
  class: 'flaky' | 'environment' | 'code' | 'unknown';
  evidenceExcerpt: string;
  reasons: string[];
  scores: {flaky: number; environment: number; code: number};
  rerun: {recommend: boolean; maxReruns: 1};
  evidenceLevel: 'fixture';
}

const fail = (message: string): never => {throw new ProtocolError('INVALID_ARGUMENT', message);};
function requireSha(value: string | undefined): string {
  if (typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)) return value;
  return fail('Pushed CI loop requires a head sha');
}

function score(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

/** 同时看多类标记，不再按第一条正则定类。flaky 只有在没有明确代码失败时才占优。 */
export function classifyCiFailureStable(input: {logExcerpt: string; annotations?: readonly string[]; rerunCount?: number}): StableCiClass {
  const excerpt = input.logExcerpt.slice(0, 2000);
  const haystack = `${excerpt}\n${(input.annotations ?? []).join('\n')}`.toLowerCase();
  const scores = {
    flaky: score(haystack, [/flaky/, /timed out/, /econnreset/, /socket hang up/, /intermittent/]),
    environment: score(haystack, [/no space left/, /runner/, /setup-node/, /rate limit/, /\b503\b/, /network/, /enospc/]),
    code: score(haystack, [/assertion/, /test failed/, /error ts/, /syntaxerror/, /cannot find module/, /expected/, /received/]),
  };
  let selected: StableCiClass['class'] = 'unknown';
  if (scores.code > 0 && scores.code >= scores.environment && scores.code >= scores.flaky) selected = 'code';
  else if (scores.environment > 0 && scores.environment >= scores.flaky) selected = 'environment';
  else if (scores.flaky > 0) selected = 'flaky';
  const reasons = (Object.entries(scores) as Array<[string, number]>).filter(([, value]) => value > 0).map(([name, value]) => `${name}:${value}`);
  const reruns = input.rerunCount ?? 0;
  return {
    class: selected,
    evidenceExcerpt: excerpt.slice(0, 500),
    reasons: reasons.length ? reasons : ['no stable class matched'],
    scores,
    rerun: {recommend: selected === 'flaky' && reruns < 1, maxReruns: 1},
    evidenceLevel: 'fixture',
  };
}

export function headShaFromWebhookPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const body = payload as {pull_request?: {head?: {sha?: string}}; check_run?: {head_sha?: string}; workflow_run?: {head_sha?: string}};
  const sha = body.pull_request?.head?.sha ?? body.check_run?.head_sha ?? body.workflow_run?.head_sha;
  return typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
}

export function dutyDedupeKey(event: {repo: string; number?: number; headSha?: string; deliveryId: string}): string {
  if (event.number !== undefined && event.headSha) return `${event.repo}#${event.number}@${event.headSha}`;
  return `${event.repo}#delivery:${event.deliveryId}`;
}

export function dedupeDutyEvents<T extends {repo: string; number?: number; headSha?: string; deliveryId: string}>(seen: readonly string[], events: readonly T[]): {fresh: T[]; duplicateKeys: string[]; seen: string[]} {
  const known = new Set(seen);
  const fresh: T[] = [];
  const duplicateKeys: string[] = [];
  for (const event of events) {
    const key = dutyDedupeKey(event);
    const delivery = `delivery:${event.deliveryId}`;
    if (known.has(key) || known.has(delivery)) {
      duplicateKeys.push(key);
      continue;
    }
    known.add(key);
    known.add(delivery);
    fresh.push(event);
  }
  return {fresh, duplicateKeys, seen: [...known]};
}

export function verifyGitHubWebhookSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

export interface WebhookListener {
  url: string;
  close(): Promise<void>;
  seen(): readonly string[];
}

/** 本机 HTTP 接入。签名用原始 body。相同 delivery 或相同 headSha 不重复投递。未做公网验收。 */
export function createGitHubWebhookServer(options: {
  secret: string;
  port?: number;
  host?: string;
  now?: () => string;
  onEvent: (event: DutyEvent) => void | Promise<void>;
}): Promise<WebhookListener> {
  if (!options.secret) fail('Webhook secret is required');
  const seen: string[] = [];
  const server = createServer((request, response) => {void handleWebhook(request, response, options, seen);});
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new ProtocolError('EXTERNAL_FAILURE', 'Webhook listener has no port'));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}/github/webhook`,
        seen: () => [...seen],
        close: () => new Promise((done, cancel) => server.close(error => error ? cancel(error) : done())),
      });
    });
  });
}

async function readRaw(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, {'content-type': 'application/json'});
  response.end(JSON.stringify(body));
}

async function handleWebhook(request: IncomingMessage, response: ServerResponse, options: {secret: string; now?: () => string; onEvent: (event: DutyEvent) => void | Promise<void>}, seen: string[]): Promise<void> {
  if (request.method !== 'POST') {
    send(response, 405, {accepted: false, reason: 'method'});
    return;
  }
  const raw = await readRaw(request);
  const signature = request.headers['x-hub-signature-256'];
  const header = Array.isArray(signature) ? signature[0] : signature;
  if (!verifyGitHubWebhookSignature(raw, header, options.secret)) {
    send(response, 401, {accepted: false, reason: 'signature'});
    return;
  }
  let payload: unknown;
  try {payload = JSON.parse(raw.toString('utf8'));}
  catch {
    send(response, 400, {accepted: false, reason: 'malformed'});
    return;
  }
  const deliveryHeader = request.headers['x-github-delivery'];
  const eventHeader = request.headers['x-github-event'];
  const deliveryId = Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader;
  const eventName = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
  const accepted = acceptGitHubWebhook({
    ...(typeof deliveryId === 'string' ? {deliveryId} : {}),
    ...(typeof eventName === 'string' ? {eventName} : {}),
    payload,
    signatureOk: true,
  });
  if (!accepted.accepted) {
    send(response, 202, {accepted: false, reason: accepted.reason});
    return;
  }
  const headSha = accepted.event.headSha ?? headShaFromWebhookPayload(payload);
  const event: DutyEvent = {...accepted.event, receivedAt: options.now?.() ?? new Date().toISOString(), ...(headSha ? {headSha} : {})};
  const deduped = dedupeDutyEvents(seen, [event]);
  if (!deduped.fresh.length) {
    send(response, 200, {accepted: true, duplicate: true, key: dutyDedupeKey(event)});
    return;
  }
  seen.push(...deduped.seen.filter(key => !seen.includes(key)));
  await options.onEvent(deduped.fresh[0]!);
  send(response, 202, {accepted: true, duplicate: false, key: dutyDedupeKey(event)});
}

function sourceOf(event: TriggerEvent): boolean {
  return event.source === 'pr' || event.source === 'check_run' || event.source === 'workflow_run' || event.source === 'issue' || event.source === 'schedule' || event.source === 'manual';
}

function ruleMatches(rule: TriggerRule, event: TriggerEvent): boolean {
  if (rule.source !== event.source) return false;
  const match = rule.match;
  if (match.repo && match.repo !== event.repo) return false;
  if (match.branch && match.branch !== event.branch) return false;
  if (match.conclusion && match.conclusion !== event.conclusion) return false;
  if (match.action && match.action !== event.action) return false;
  if (match.author && match.author !== event.author) return false;
  if (match.labels && match.labels.some(label => !event.labels?.includes(label))) return false;
  return true;
}

export function emptyTriggerState(): TriggerState {
  return {dispatched: [], activeByRepo: {}};
}

export function routeTrigger(rules: readonly TriggerRule[], event: TriggerEvent, state: TriggerState, now: number): TriggerRoute {
  if (!sourceOf(event) || !event.repo || !event.deliveryId) fail('Trigger event is invalid');
  if (event.gap === true) return {status: 'gap'};
  const rule = rules.find(item => ruleMatches(item, event));
  if (!rule) return {status: 'miss'};
  const dedupeKey = dutyDedupeKey({repo: event.repo, deliveryId: event.deliveryId, ...(event.number === undefined ? {} : {number: event.number}), ...(event.headSha === undefined ? {} : {headSha: event.headSha})});
  const same = state.dispatched.find(item => item.dedupeKey === dedupeKey);
  if (same) return {status: 'deduped', dedupeKey, ruleId: rule.id};
  const family = event.number === undefined ? undefined : state.dispatched.filter(item => item.dedupeKey.startsWith(`${event.repo}#${event.number}@`)).at(-1);
  if (family && event.headSha && family.headSha === event.headSha && now - family.at < rule.cooldownMs) {
    return {status: 'cooldown', dedupeKey, ruleId: rule.id};
  }
  if (family && !event.headSha && now - family.at < rule.cooldownMs) return {status: 'cooldown', dedupeKey, ruleId: rule.id};
  const active = state.activeByRepo[event.repo] ?? 0;
  if (active >= rule.maxConcurrentPerRepo) return {status: 'busy', dedupeKey, ruleId: rule.id};
  const superseded = family && event.headSha && family.headSha && family.headSha !== event.headSha ? family.taskId : undefined;
  return {status: 'spawn', dedupeKey, ruleId: rule.id, workflow: rule.action.workflow, ...(rule.action.typeName ? {typeName: rule.action.typeName} : {}), ...(superseded ? {supersededTaskId: superseded} : {})};
}

export function rememberTrigger(state: TriggerState, dispatch: TriggerDispatch): TriggerState {
  return {
    dispatched: [...state.dispatched, dispatch],
    activeByRepo: {...state.activeByRepo, [dispatch.dedupeKey.split('#')[0] ?? '']: (state.activeByRepo[dispatch.dedupeKey.split('#')[0] ?? ''] ?? 0) + 1},
  };
}

export function finishTrigger(state: TriggerState, repo: string): TriggerState {
  const current = state.activeByRepo[repo] ?? 0;
  return {...state, activeByRepo: {...state.activeByRepo, [repo]: Math.max(0, current - 1)}};
}

export function initialCiLoop(input: {repo: string; number: number; maxRounds: number}): CiLoopState {
  if (!Number.isInteger(input.number) || input.number < 1 || !Number.isInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 5) fail('CI loop bounds are invalid');
  return {repo: input.repo, number: input.number, phase: 'diagnose', round: 1, maxRounds: input.maxRounds, flakyReruns: 0, note: 'waiting for diagnosis'};
}

export function stepCiLoop(state: CiLoopState, signal: CiLoopSignal, headSha?: string): CiLoopState {
  const bound = (next: CiLoopPhase, note: string, extra: Partial<CiLoopState> = {}): CiLoopState => ({...state, ...extra, phase: next, note});
  if ((signal === 'ci_green' || signal === 'ci_red' || signal === 'ci_flaky') && state.headSha && headSha && headSha !== state.headSha) {
    return {...state, note: 'ignored ci for a different head'};
  }
  if (signal === 'diagnosed' && state.phase === 'diagnose') return bound('patch', 'patch the failing head');
  if (signal === 'patched' && state.phase === 'patch') return bound('local_verify', 'run the local verification recipe');
  if (signal === 'verify_failed' && state.phase === 'local_verify') {
    if (state.round >= state.maxRounds) return bound('stopped', 'local verification failed and the round cap was reached');
    return bound('patch', 'local verification failed; iterate', {round: state.round + 1});
  }
  if (signal === 'verified' && state.phase === 'local_verify') return bound('push', 'local verification passed');
  if (signal === 'pushed' && state.phase === 'push') {
    return bound('await_ci', 'waiting for CI on the pushed head', {headSha: requireSha(headSha)});
  }
  if (signal === 'ci_green' && state.phase === 'await_ci') return bound('green', 'CI passed on the bound head');
  if (signal === 'ci_flaky' && state.phase === 'await_ci') {
    if (state.flakyReruns < 1) return bound('await_ci', 'flaky failure reruns once', {flakyReruns: state.flakyReruns + 1});
    return stepCiLoop({...state, flakyReruns: state.flakyReruns}, 'ci_red', headSha);
  }
  if (signal === 'ci_red' && state.phase === 'await_ci') {
    if (state.round >= state.maxRounds) return bound('stopped', 'CI stayed red and the round cap was reached');
    return bound('diagnose', 'CI failed on the bound head; iterate', {round: state.round + 1, ...(headSha ? {headSha} : {})});
  }
  return {...state, note: `signal ${signal} does not apply to ${state.phase}`};
}

export function commentWriteAvailable(input: {policyComment: boolean; autonomy?: {allow: boolean; mode: string; risk: string}}): boolean {
  return input.policyComment === true && input.autonomy?.allow === true && input.autonomy.mode === 'auto' && input.autonomy.risk === 'reversible_write';
}

export interface EvalOutcome {id: string; fixed: boolean; rounds: number; cost: number}
export function summarizeDeveloperEval(input: {caseIds: readonly string[]; outcomes: readonly EvalOutcome[]}): {fixRate: number; meanRounds: number; totalCost: number; missing: string[]; evidenceLevel: 'fixture'} {
  if (!input.caseIds.length) fail('Evaluation summary needs cases');
  const missing = input.caseIds.filter(id => !input.outcomes.some(item => item.id === id));
  const known = input.outcomes.filter(item => input.caseIds.includes(item.id));
  const fixed = known.filter(item => item.fixed).length;
  const rounds = known.reduce((sum, item) => sum + item.rounds, 0);
  const totalCost = known.reduce((sum, item) => sum + item.cost, 0);
  return {fixRate: known.length ? fixed / known.length : 0, meanRounds: known.length ? rounds / known.length : 0, totalCost, missing, evidenceLevel: 'fixture'};
}

export function apiDocDigest(names: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([...names].sort())).digest('hex');
}

export type CiReadResult = 'green' | 'red' | 'flaky' | {status: 'green' | 'red'; logExcerpt: string};

export interface CiRepairPorts {
  diagnose(): Promise<'code' | 'flaky' | 'environment' | 'unknown'>;
  patch(): Promise<void>;
  verify(): Promise<boolean>;
  push(): Promise<string>;
  rerun(headSha: string): Promise<void>;
  readCi(headSha: string): Promise<CiReadResult>;
}

function interpretCiRead(value: {status: 'green' | 'red'; logExcerpt: string}, rerunCount: number): 'green' | 'red' | 'flaky' | 'environment' {
  if (value.status === 'green') return 'green';
  const classified = classifyCiFailureStable({logExcerpt: value.logExcerpt, rerunCount});
  if (classified.class === 'environment') return 'environment';
  if (classified.class === 'flaky' && classified.rerun.recommend) return 'flaky';
  return 'red';
}

/** 用注入端口走完诊断、补丁、本地验证、推送、等待 CI、flaky 重跑。环境失败不打补丁。不调用真实 Actions。 */
export async function runInjectedCiRepair(input: {repo: string; number: number; maxRounds?: number; currentHead?: string; ports: CiRepairPorts}): Promise<{state: CiLoopState; reruns: string[]; evidenceLevel: 'fixture'}> {
  let state = initialCiLoop({repo: input.repo, number: input.number, maxRounds: input.maxRounds ?? 3});
  const reruns: string[] = [];
  for (let guard = 0; guard < 12 && !['green', 'stopped'].includes(state.phase); guard += 1) {
    if (state.phase === 'diagnose') {
      const kind = await input.ports.diagnose();
      if (kind === 'environment') {
        state = {...state, phase: 'stopped', note: 'environment failure is not patched'};
        continue;
      }
      if (kind === 'flaky' && input.currentHead && state.note === 'waiting for diagnosis' && state.flakyReruns < 1) {
        state = {...state, phase: 'await_ci', headSha: input.currentHead, note: 'flaky diagnosis waits on the current head'};
        continue;
      }
      state = stepCiLoop(state, 'diagnosed');
    } else if (state.phase === 'patch') {
      await input.ports.patch();
      state = stepCiLoop(state, 'patched');
    } else if (state.phase === 'local_verify') {
      const ok = await input.ports.verify();
      state = stepCiLoop(state, ok ? 'verified' : 'verify_failed');
    } else if (state.phase === 'push') {
      const headSha = await input.ports.push();
      state = stepCiLoop(state, 'pushed', headSha);
    } else if (state.phase === 'await_ci') {
      const headSha = state.headSha;
      if (!headSha) break;
      const before = state.flakyReruns;
      const raw = await input.ports.readCi(headSha);
      const conclusion = typeof raw === 'string' ? raw : interpretCiRead(raw, before);
      if (conclusion === 'environment') {
        state = {...state, phase: 'stopped', note: 'environment failure is not patched'};
        continue;
      }
      if (conclusion === 'flaky' && before < 1) await input.ports.rerun(headSha).then(() => {reruns.push(headSha);});
      state = stepCiLoop(state, conclusion === 'green' ? 'ci_green' : conclusion === 'flaky' ? 'ci_flaky' : 'ci_red', headSha);
    } else break;
  }
  return {state, reruns, evidenceLevel: 'fixture'};
}

export interface SourcedCiEvalCase {
  id: string;
  sourcePath: string;
  excerpt: string;
  sourceKind: 'in-repo-fixture' | 'recorded-ci-summary';
  recordedRunId?: number;
}

function readRepoSource(root: string, sourcePath: string): string {
  if (!sourcePath || isAbsolute(sourcePath) || sourcePath.split(/[/\\]/).includes('..')) fail('Evaluation source path must stay inside the repository');
  const absolute = resolve(root, sourcePath);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('Evaluation source path must stay inside the repository');
  return readFileSync(absolute, 'utf8');
}

/**
 * 评测摘录必须是清单所引文件里的原文。清单可以指向仓库夹具，或已提交的 CI 结论摘要。
 * 这里不下载 Actions 日志，也不给没有原文依据的期望分类。
 */
export function loadSourcedCiEval(input: {root: string; manifestPath: string}): {evidenceLevel: 'fixture'; sourcesVerified: true; note: string; cases: SourcedCiEvalCase[]; evaluation: ReturnType<typeof runFixtureCiEval>} {
  const raw = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as {note?: string; cases?: SourcedCiEvalCase[]};
  const cases = raw.cases ?? [];
  if (!cases.length) fail('Sourced evaluation manifest is empty');
  for (const item of cases) {
    if (item.sourceKind !== 'in-repo-fixture' && item.sourceKind !== 'recorded-ci-summary') fail('Evaluation source kind is unknown');
    const text = readRepoSource(input.root, item.sourcePath);
    if (!item.excerpt.trim() || !text.includes(item.excerpt)) fail(`Excerpt for ${item.id} is not present in ${item.sourcePath}`);
  }
  return {
    evidenceLevel: 'fixture',
    sourcesVerified: true,
    note: raw.note ?? '',
    cases,
    evaluation: runFixtureCiEval(cases.map(item => ({id: item.id, sourcePath: item.sourcePath, excerpt: item.excerpt}))),
  };
}

export interface FixtureEvalCase {id: string; sourcePath: string; excerpt: string; expectedClass?: StableCiClass['class']}

/**
 * 评测只消费调用方给出的摘录。仓库夹具的来源必须写在 sourcePath。
 * 没有 expectedClass 时只报告观察到的分类，不算作命中或失败。
 */
export function runFixtureCiEval(cases: readonly FixtureEvalCase[]): {evidenceLevel: 'fixture'; results: Array<{id: string; sourcePath: string; observedClass: StableCiClass['class']; matched: boolean | null; rerun: boolean}>; matched: number; labeled: number} {
  if (!cases.length) fail('Evaluation needs at least one sourced excerpt');
  const results = cases.map(item => {
    if (!item.id.trim() || !item.sourcePath.trim() || !item.excerpt.trim()) fail('Evaluation case needs id, sourcePath and excerpt');
    const observed = classifyCiFailureStable({logExcerpt: item.excerpt});
    return {id: item.id, sourcePath: item.sourcePath, observedClass: observed.class, matched: item.expectedClass === undefined ? null : observed.class === item.expectedClass, rerun: observed.rerun.recommend};
  });
  const labeled = results.filter(item => item.matched !== null);
  return {evidenceLevel: 'fixture', results, matched: labeled.filter(item => item.matched).length, labeled: labeled.length};
}

export function detectApiDocDrift(input: {implemented: readonly string[]; documented: readonly string[]; previousDigest?: string}): {drift: boolean; missingInDocs: string[]; staleDigest: boolean; digest: string; evidenceLevel: 'fixture'} {
  const missingInDocs = input.implemented.filter(name => !input.documented.includes(name));
  const digest = apiDocDigest(input.implemented);
  const staleDigest = input.previousDigest !== undefined && input.previousDigest !== digest;
  return {drift: missingInDocs.length > 0 || staleDigest, missingInDocs, staleDigest, digest, evidenceLevel: 'fixture'};
}
