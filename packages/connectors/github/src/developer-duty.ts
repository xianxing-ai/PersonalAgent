import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

/** Fixture-level GitHub duty helpers. Nothing here calls a live GitHub account. */
export const DEVELOPER_DUTY_EVIDENCE_LEVEL = 'fixture' as const;
export const DUTY_STATUS_MARKER = '<!-- personal-agent:duty-status -->';

export interface DutyCursor {repo: string; deliveryId?: string; etag?: string}
export interface DutyEvent {
  id: string;
  repo: string;
  type: 'pull_request' | 'issue' | 'check_run' | 'workflow_run' | 'ping';
  deliveryId: string;
  receivedAt: string;
  action?: string;
  number?: number;
  headSha?: string;
}
export interface DutyPollPage {
  repo: string;
  connected: boolean;
  gap: boolean;
  rateLimited?: boolean;
  retryAfterMs?: number;
  previousDeliveryId?: string;
  next?: DutyCursor;
  events: DutyEvent[];
}
export type DutyPollStatus = 'advanced' | 'unchanged' | 'gap' | 'rate_limited';
export interface DutyPollResult {
  status: DutyPollStatus;
  cursor?: DutyCursor;
  events: DutyEvent[];
  /** True only when the source proved continuity and there were no new events. A gap is never no-change. */
  noChange: boolean;
  retryAfterMs?: number;
}

export interface RepoDutyPolicy {
  repo: string;
  allowed: boolean;
  comment: boolean;
  pushBranches: string[];
  /** Merge stays forbidden unless this is explicitly true. The default helper never sets it. */
  merge: boolean;
}
export interface BranchProtection {
  branch: string;
  protected: boolean;
  allowsForcePush: boolean;
  requiredReviews: number;
  restrictsPushes: boolean;
}
export interface StatusComment {id: number; body: string}
export interface StatusCommentAttempt {outcome: 'confirmed' | 'unknown'; commentId?: number; body: string}
export interface StatusCommentPlan {
  action: 'create' | 'edit' | 'read_back' | 'refuse';
  commentId?: number;
  body: string;
  reason: string;
}
export interface HeadBoundConclusion {
  repo: string;
  number: number;
  headSha: string;
  conclusion: string;
  state: 'current' | 'superseded';
}
export type CiFailureClass = 'flaky' | 'environment' | 'code' | 'unknown';
export interface DutyPersonalItem {
  repo: string;
  kind: 'assigned' | 'review_requested' | 'failing_pr';
  number: number;
  title: string;
  url: string;
  headSha?: string;
}
export interface DutyEvalCase {
  id: string;
  repo: string;
  headSha: string;
  failureClass: CiFailureClass;
  excerpt: string;
  expectedClass: CiFailureClass;
  source: 'historical_pr' | 'historical_ci';
}
export interface RemoteDutyRunner {
  readonly implementation: 'stub';
  describe(): {status: 'stub'; runsWhenLocalMachineOff: false; evidenceLevel: 'fixture'; note: string};
  submit(job: {repo: string; cursor?: DutyCursor}): Promise<{accepted: false; reason: 'stub'}>;
}

const fail = (code: 'INVALID_ARGUMENT' | 'SCOPE_DENIED' | 'RESULT_UNKNOWN' | 'UNSUPPORTED_CAPABILITY', message: string): never => {throw new ProtocolError(code, message);};
const repoName = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);

export function defaultRepoDutyPolicy(repo: string): RepoDutyPolicy {
  if (!repoName(repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
  return {repo, allowed: false, comment: false, pushBranches: [], merge: false};
}

export function reduceDutyPoll(previous: DutyCursor | undefined, page: DutyPollPage): DutyPollResult {
  if (!repoName(page.repo) || (previous && previous.repo !== page.repo)) fail('INVALID_ARGUMENT', 'Duty poll repository is inconsistent');
  const cursor = previous === undefined ? {} : {cursor: previous};
  if (page.rateLimited) return {status: 'rate_limited', ...cursor, events: [], noChange: false, ...(page.retryAfterMs === undefined ? {} : {retryAfterMs: page.retryAfterMs})};
  if (!page.connected || page.gap || (previous?.deliveryId !== undefined && page.previousDeliveryId !== previous.deliveryId)) {
    return {status: 'gap', ...cursor, events: [], noChange: false};
  }
  if (!page.events.length) return {status: 'unchanged', ...cursor, events: [], noChange: true};
  if (!page.next?.deliveryId) return {status: 'gap', ...cursor, events: [], noChange: false};
  return {status: 'advanced', cursor: {...page.next, repo: page.repo}, events: page.events, noChange: false};
}

export function acceptGitHubWebhook(input: {deliveryId?: string; eventName?: string; payload?: unknown; signatureOk: boolean}):
  {accepted: true; event: DutyEvent} | {accepted: false; reason: string} {
  if (input.signatureOk !== true) return {accepted: false, reason: 'signature'};
  if (!input.deliveryId || !input.eventName || !input.payload || typeof input.payload !== 'object') return {accepted: false, reason: 'malformed'};
  const payload = input.payload as {repository?: {full_name?: string}; action?: string; number?: number; pull_request?: {number?: number; head?: {sha?: string}}};
  const repo = payload.repository?.full_name;
  if (!repo || !repoName(repo)) return {accepted: false, reason: 'repository'};
  const type = input.eventName === 'pull_request' || input.eventName === 'issue' || input.eventName === 'check_run'
    || input.eventName === 'workflow_run' || input.eventName === 'ping' ? input.eventName : undefined;
  if (!type) return {accepted: false, reason: 'event'};
  return {accepted: true, event: {id: input.deliveryId, repo, type, deliveryId: input.deliveryId, receivedAt: new Date(0).toISOString(),
    ...(payload.action ? {action: payload.action} : {}),
    ...(payload.pull_request?.number ?? payload.number ? {number: payload.pull_request?.number ?? payload.number} : {}),
    ...(payload.pull_request?.head?.sha ? {headSha: payload.pull_request.head.sha} : {})}};
}

export function evaluateRepoDutyAction(policy: RepoDutyPolicy, action: 'comment' | 'push' | 'merge', branch?: string): {allowed: boolean; reason: string} {
  if (!policy.allowed) return {allowed: false, reason: 'repository is not allowlisted'};
  if (action === 'merge') return {allowed: policy.merge === true, reason: policy.merge === true ? 'merge explicitly allowed' : 'merge is forbidden by default'};
  if (action === 'comment') return {allowed: policy.comment === true, reason: policy.comment ? 'comment allowed' : 'comment is not allowed'};
  if (!branch || !policy.pushBranches.includes(branch)) return {allowed: false, reason: 'branch is not in the push allowlist'};
  return {allowed: true, reason: 'push branch allowed by policy'};
}

export function assessDutyPush(policy: RepoDutyPolicy, protection: BranchProtection | 'unknown', branch: string, force = false): {allowed: boolean; reason: string} {
  const policyDecision = evaluateRepoDutyAction(policy, 'push', branch);
  if (!policyDecision.allowed) return policyDecision;
  if (protection === 'unknown') return {allowed: false, reason: 'branch protection is unknown'};
  if (protection.branch !== branch) return {allowed: false, reason: 'branch protection describes a different branch'};
  if (force || protection.allowsForcePush && force) return {allowed: false, reason: 'force push is refused'};
  if (force) return {allowed: false, reason: 'force push is refused'};
  if (protection.restrictsPushes) return {allowed: false, reason: 'branch protection restricts pushes'};
  return {allowed: true, reason: 'push is within policy and known branch protection'};
}

export function planStatusComment(input: {desiredBody: string; existing: StatusComment[] | 'unknown'; previousAttempt?: StatusCommentAttempt}): StatusCommentPlan {
  const body = `${DUTY_STATUS_MARKER}\n${input.desiredBody.trim()}`;
  if (input.previousAttempt?.outcome === 'unknown' || input.existing === 'unknown') {
    return {action: 'read_back', ...(input.previousAttempt?.commentId === undefined ? {} : {commentId: input.previousAttempt.commentId}), body, reason: 'unknown outcome must be read back'};
  }
  const matches = input.existing.filter(comment => comment.body.includes(DUTY_STATUS_MARKER));
  if (matches.length > 1) return {action: 'refuse', body, reason: 'more than one status comment exists'};
  if (matches.length === 1) {
    const current = matches[0]!;
    if (current.body === body) return {action: 'read_back', commentId: current.id, body, reason: 'status comment already matches'};
    return {action: 'edit', commentId: current.id, body, reason: 'edit the single status comment'};
  }
  return {action: 'create', body, reason: 'create the single status comment'};
}

export async function executeStatusComment(ports: {
  writeAvailable?: boolean;
  listComments: () => Promise<StatusComment[] | 'unknown'>;
  createComment: (body: string) => Promise<{state: 'confirmed' | 'unknown'; id?: number}>;
  editComment: (id: number, body: string) => Promise<{state: 'confirmed' | 'unknown'}>;
}, desiredBody: string, previous?: StatusCommentAttempt): Promise<StatusCommentAttempt> {
  const existing = await ports.listComments();
  const remembered = previous?.commentId === undefined ? {} : {commentId: previous.commentId};
  if (existing === 'unknown') return previous?.outcome === 'unknown' ? previous : {outcome: 'unknown', body: `${DUTY_STATUS_MARKER}\n${desiredBody.trim()}`, ...remembered};
  if (previous?.outcome === 'unknown') {
    const matches = existing.filter(comment => comment.body.includes(DUTY_STATUS_MARKER));
    const original = matches[0];
    if (matches.length !== 1 || original?.body !== previous.body
      || (previous.commentId !== undefined && original.id !== previous.commentId)) return previous;
  }
  const plan = planStatusComment({desiredBody, existing});
  if (plan.action === 'refuse') fail('RESULT_UNKNOWN', plan.reason);
  if (plan.action === 'read_back') return {outcome: 'confirmed', body: plan.body, ...(plan.commentId === undefined ? {} : {commentId: plan.commentId})};
  if (ports.writeAvailable === false) fail('UNSUPPORTED_CAPABILITY', 'Duty comment requires original ToolGateway content authorization');
  if (plan.action === 'edit' && plan.commentId !== undefined) {
    const written = await ports.editComment(plan.commentId, plan.body);
    return {outcome: written.state, commentId: plan.commentId, body: plan.body};
  }
  const created = await ports.createComment(plan.body);
  return {outcome: created.state, body: plan.body, ...(created.id === undefined ? {} : {commentId: created.id})};
}

export function bindHeadConclusions(previous: readonly HeadBoundConclusion[], next: {repo: string; number: number; headSha: string; conclusion: string}): HeadBoundConclusion[] {
  const kept = previous.map(item => item.repo === next.repo && item.number === next.number && item.headSha !== next.headSha
    ? {...item, state: 'superseded' as const} : item);
  const current = kept.find(item => item.repo === next.repo && item.number === next.number && item.headSha === next.headSha);
  if (current) return kept.map(item => item === current ? {...next, state: 'current' as const} : item);
  return [...kept, {...next, state: 'current'}];
}

export function classifyCiFailure(input: {logExcerpt: string; annotations?: string[]}): {class: CiFailureClass; evidenceExcerpt: string; reasons: string[]} {
  const excerpt = input.logExcerpt.slice(0, 500);
  const haystack = `${excerpt}\n${(input.annotations ?? []).join('\n')}`.toLowerCase();
  if (/flaky|timed out|econnreset|rerun/.test(haystack)) return {class: 'flaky', evidenceExcerpt: excerpt, reasons: ['intermittent failure marker']};
  if (/no space left|runner|setup-node|rate limit|503|network/.test(haystack)) return {class: 'environment', evidenceExcerpt: excerpt, reasons: ['environment marker']};
  if (/assertion|test failed|error ts|syntaxerror|cannot find module/.test(haystack)) return {class: 'code', evidenceExcerpt: excerpt, reasons: ['code failure marker']};
  return {class: 'unknown', evidenceExcerpt: excerpt, reasons: ['no fixture class matched']};
}

export function interpretGitHubRateLimit(input: {status?: number; headers?: Record<string, string | undefined>; transportError?: boolean}):
  {limited: boolean; disconnected: boolean; treatAsNoChange: false; retryAfterMs?: number; remaining?: number} {
  if (input.transportError) return {limited: false, disconnected: true, treatAsNoChange: false};
  const remainingText = input.headers?.['x-ratelimit-remaining'];
  const remaining = remainingText !== undefined && /^\d+$/.test(remainingText) ? Number(remainingText) : undefined;
  const reset = input.headers?.['x-ratelimit-reset'];
  const retryAfterMs = input.headers?.['retry-after'] && /^\d+$/.test(input.headers['retry-after']) ? Number(input.headers['retry-after']) * 1000
    : reset && /^\d+$/.test(reset) ? Math.max(0, Number(reset) * 1000 - Date.now()) : undefined;
  const limited = remaining === 0 || input.status === 429 || (input.status === 403 && remaining === undefined);
  return {limited, disconnected: false, treatAsNoChange: false, ...(retryAfterMs === undefined ? {} : {retryAfterMs}), ...(remaining === undefined ? {} : {remaining})};
}

export function buildPersonalView(input: {login: string; assigned?: Array<{repo: string; number: number; title: string; url: string}>;
  reviewRequested?: Array<{repo: string; number: number; title: string; url: string; headSha?: string}>;
  failing?: Array<{repo: string; number: number; title: string; url: string; headSha: string; author: string}>}): DutyPersonalItem[] {
  const items: DutyPersonalItem[] = [];
  for (const item of input.assigned ?? []) items.push({...item, kind: 'assigned'});
  for (const item of input.reviewRequested ?? []) items.push({repo: item.repo, number: item.number, title: item.title, url: item.url, kind: 'review_requested', ...(item.headSha ? {headSha: item.headSha} : {})});
  for (const item of input.failing ?? []) if (item.author === input.login) items.push({repo: item.repo, number: item.number, title: item.title, url: item.url, headSha: item.headSha, kind: 'failing_pr'});
  return items;
}

export function buildOfflineEvalSet(cases: readonly DutyEvalCase[]): {datasetId: string; kind: 'evaluation.dataset_snapshot'; cases: DutyEvalCase[]; contentSha256: string; evidenceLevel: 'fixture'} {
  if (!cases.length) fail('INVALID_ARGUMENT', 'Evaluation set needs at least one historical case');
  const contentSha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
  return {datasetId: contentSha256.slice(0, 16), kind: 'evaluation.dataset_snapshot', cases: cases.map(item => ({...item})), contentSha256, evidenceLevel: 'fixture'};
}

export function assertDutyCredentialScope(input: {repo: string; credentialRef: string; policy: RepoDutyPolicy}): {repo: string; credentialRef: string; comment: boolean; pushBranches: string[]; merge: false} {
  if (input.policy.repo !== input.repo) fail('SCOPE_DENIED', 'Credential scope repository does not match the policy');
  if (/ghp_|github_pat_|gho_|Bearer\s+|token=/i.test(input.credentialRef)) fail('SCOPE_DENIED', 'Credential material cannot enter the duty scope');
  return {repo: input.repo, credentialRef: input.credentialRef, comment: input.policy.comment, pushBranches: [...input.policy.pushBranches], merge: false};
}

export function createStubRemoteDutyRunner(): RemoteDutyRunner {
  return {implementation: 'stub', describe: () => ({status: 'stub', runsWhenLocalMachineOff: false, evidenceLevel: 'fixture',
    note: 'No remote runner is deployed. Local duty stops when this machine is off.'}),
  submit: async () => ({accepted: false, reason: 'stub'})};
}
