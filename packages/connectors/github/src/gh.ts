import { ProtocolError } from '@personal-agent/contracts';
import type { GitHubInputs, GitHubOperation, GitHubOutputs, GitHubProvider, GitHubReadContext, GitHubPage, GitHubIssue, GitHubPullRequest, TextPage, GitHubWriteResult } from './provider.js';
import { isGitHubWrite } from './provider.js';
import type { GhCommandRunner } from './runner.js';
import { checkContext, withGitHubContext } from './service.js';
import { validateInput } from './schemas.js';
import { redactValue, redactGitHubText } from './redact.js';
import {executeGitHubRepairLink, getGitHubRepairLink} from './repair-link.js';

export interface GhProviderOptions {
  runner: GhCommandRunner;
  /** Restricted credential accessor supplied by Connector Host, never tool input. */
  readToken: (context: GitHubReadContext) => Promise<string>;
  /** Explicit repository allowlist supplied by trusted composition. */
  repositories: readonly string[];
}
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub response');
  return value as RecordValue;
}
function string(value: unknown): string { if (typeof value !== 'string') throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub string'); return value; }
function number(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub identifier'); return Number(value); }
function nullable(value: unknown): string | null { return value === null ? null : string(value); }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub boolean'); return value; }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 100) throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub page'); return value; }
function issue(raw: unknown): GitHubIssue {
  const r = object(raw);
  return {number: number(r.number), title: string(r.title), body: r.body === null ? '' : string(r.body), state: string(r.state), labels: array(r.labels).map(label => typeof label === 'string' ? label : string(object(label).name)), url: string(r.html_url), updatedAt: string(r.updated_at)};
}
function pull(raw: unknown): GitHubPullRequest {
  const r = object(raw), base = object(r.base), head = object(r.head);
  return {number: number(r.number), title: string(r.title), body: r.body === null ? '' : string(r.body), state: string(r.state), base: string(base.ref), baseSha: string(base.sha), head: string(head.ref), headSha: string(head.sha), url: string(r.html_url), draft: bool(r.draft)};
}
function paginate<T>(items: T[], input: {page?: number; perPage?: number}, remoteCount = items.length): GitHubPage<T> {
  const page = input.page ?? 1, hasMore = remoteCount === (input.perPage ?? 30);
  if (hasMore && page >= 10000) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub pagination limit reached');
  return {items, page, nextPage: hasMore ? page + 1 : null, hasMore};
}
function textPage(text: string, input: {offset?: number; maxChars?: number}): TextPage {
  const offset = input.offset ?? 0, size = input.maxChars ?? 16384;
  if (offset > text.length) throw new ProtocolError('INVALID_ARGUMENT', 'Text offset exceeds content length');
  const end = Math.min(text.length, offset + size);
  return {text: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, truncated: end < text.length};
}
export class GhCliProvider implements GitHubProvider {
  readonly verification = 'conditional' as const;
  private disposed = false;
  private readonly runner: GhCommandRunner;
  constructor(private readonly options: GhProviderOptions) {
    if (!options.runner || !options.readToken || !options.repositories.length) throw new ProtocolError('INVALID_ARGUMENT', 'GitHub requires explicit runner, credentials and repositories');
    this.runner = options.runner;
    for (const repo of options.repositories) validateInput('repo.get', {repo});
  }
  dispose(): void { this.disposed = true; this.runner.dispose?.(); }
  async execute<K extends GitHubOperation>(op: K, input: GitHubInputs[K], context: GitHubReadContext): Promise<GitHubOutputs[K]> {
    validateInput(op, input); checkContext(context);
    if (this.disposed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub provider disposed');
    if (!this.options.repositories.includes(input.repo)) throw new ProtocolError('SCOPE_DENIED', 'Repository is outside configured GitHub scope');
    let token: string;
    try { token = await withGitHubContext(context, bounded => this.options.readToken(bounded)); } catch (error) { if (error instanceof ProtocolError && ['TIMEOUT', 'CANCELLED'].includes(error.code)) throw error; throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable'); }
    checkContext(context);
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n\x00]/.test(token)) throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable');
    const root = `repos/${input.repo}`;
    let writeDispatched = false;
    const api = async (endpoint: string, method = 'GET', payload?: unknown, raw = false): Promise<unknown> => {
      checkContext(context);
      const args = ['api', '--hostname', 'github.com', '--method', method, endpoint, '-H', 'X-GitHub-Api-Version: 2022-11-28', '-H', `Accept: ${raw ? 'application/vnd.github.diff' : 'application/vnd.github+json'}`];
      if (payload !== undefined) args.push('--input', '-');
      let result;
      try { result = await withGitHubContext(context, bounded => { if (method !== 'GET') writeDispatched = true; return this.runner.run({args, token, ...(payload === undefined ? {} : {stdin: JSON.stringify(payload)}), maxBytes: 1048576, context: bounded}); }); }
      catch (error) {
        // Once a write is dispatched, transport failure does not prove no effect.
        if (method !== 'GET' && writeDispatched) throw new ProtocolError('RESULT_UNKNOWN', 'GitHub write outcome unknown; reconcile before any retry');
        if (error instanceof ProtocolError) throw new ProtocolError(error.code, 'GitHub read failed', error.retryable, error.retryAfterMs);
        throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub read failed');
      }
      if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1048576) throw new ProtocolError(method === 'GET' ? 'EXTERNAL_FAILURE' : 'RESULT_UNKNOWN', 'GitHub response exceeded byte limit');
      if (result.exitCode !== 0) {
        const status = /HTTP\s+(\d{3})/i.exec(result.stderr)?.[1];
        const code = status === '404' ? 'NOT_FOUND' : status === '401' ? 'UNAUTHORIZED' : status === '429' || (status === '403' && /rate limit/i.test(result.stderr)) ? 'RATE_LIMITED' : status === '403' ? 'SCOPE_DENIED' : status === '422' ? 'INVALID_ARGUMENT' : method !== 'GET' ? 'RESULT_UNKNOWN' : 'EXTERNAL_FAILURE';
        throw new ProtocolError(code, code === 'RESULT_UNKNOWN' ? 'GitHub write outcome unknown; reconcile before any retry' : 'GitHub request failed', method === 'GET' && code === 'RATE_LIMITED');
      }
      if (raw) return redactGitHubText(result.stdout, [token]);
      try { return JSON.parse(result.stdout) as unknown; } catch { throw new ProtocolError(method === 'GET' ? 'EXTERNAL_FAILURE' : 'RESULT_UNKNOWN', 'Malformed GitHub response'); }
    };
    const pageQuery = (r: {page?: number; perPage?: number}) => `per_page=${r.perPage ?? 30}&page=${r.page ?? 1}`;
    const checkPull = async (r: {number: number; expectedHeadSha: string; expectedBaseSha?: string}) => {
      const pr = pull(await api(`${root}/pulls/${r.number}`));
      if (pr.headSha !== r.expectedHeadSha || (r.expectedBaseSha !== undefined && pr.baseSha !== r.expectedBaseSha)) throw new ProtocolError('REVISION_CONFLICT', 'Pull request changed; refresh the proposal');
    };
    const perform = async (): Promise<unknown> => {
      switch (op) {
        case 'repo.get': { const r = object(await api(root)); return {fullName: string(r.full_name), defaultBranch: string(r.default_branch), private: bool(r.private), url: string(r.html_url)}; }
        case 'actions.run.list': {
          const r = input as GitHubInputs['actions.run.list'];
          const payload = object(await api(`${root}/actions/runs?${pageQuery(r)}${r.status ? `&status=${encodeURIComponent(r.status)}` : ''}${r.branch ? `&branch=${encodeURIComponent(r.branch)}` : ''}`));
          return paginate(array(payload.workflow_runs).map(value => { const run = object(value); return {id: number(run.id), name: run.name === null ? '' : string(run.name), status: string(run.status), conclusion: nullable(run.conclusion), headSha: string(run.head_sha), url: string(run.html_url), createdAt: string(run.created_at)}; }), r);
        }
        case 'actions.job.list': {
          const r = input as GitHubInputs['actions.job.list'];
          const payload = object(await api(`${root}/actions/runs/${r.runId}/jobs?${pageQuery(r)}`));
          return paginate(array(payload.jobs).map(value => { const job = object(value); return {id: number(job.id), runId: number(job.run_id), name: string(job.name), status: string(job.status), conclusion: nullable(job.conclusion), url: string(job.html_url)}; }), r);
        }
        case 'actions.log.read': {
          const r = input as GitHubInputs['actions.log.read'];
          const job = object(await api(`${root}/actions/jobs/${r.jobId}`));
          if (number(job.run_id) !== r.runId || number(job.id) !== r.jobId) throw new ProtocolError('INVALID_ARGUMENT', 'Job does not belong to requested run');
          // gh run view fetches text logs; the jobs/logs REST endpoint redirects
          // to a signed archive and must not be exposed as tool content.
          const args = ['run', 'view', String(r.runId), '--repo', r.repo, '--job', String(r.jobId), '--log-failed'];
          const result = await withGitHubContext(context, bounded => this.runner.run({args, token, maxBytes: 1048576, context: bounded}));
          if (result.exitCode !== 0 || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1048576) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub log read failed');
          if (job.conclusion === 'failure' && !result.stdout.trim()) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub failed job log unavailable');
          return textPage(redactGitHubText(result.stdout, [token]), r);
        }
        case 'actions.repair.link': return executeGitHubRepairLink(input as GitHubInputs['actions.repair.link'], api, () => writeDispatched);
        case 'actions.repair.get': return getGitHubRepairLink(input as GitHubInputs['actions.repair.get'], api);
        case 'issue.get': { const r = input as GitHubInputs['issue.get']; const value = object(await api(`${root}/issues/${r.number}`)); if (value.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request'); return issue(value); }
        case 'issue.list': {
          const r = input as GitHubInputs['issue.list'];
          const rows = array(await api(`${root}/issues?${pageQuery(r)}&state=${r.state ?? 'open'}${r.labels ? `&labels=${encodeURIComponent(r.labels.join(','))}` : ''}`));
          return paginate(rows.filter(value => !object(value).pull_request).map(issue), r, rows.length);
        }
        case 'pr.get': { const r = input as GitHubInputs['pr.get']; return pull(await api(`${root}/pulls/${r.number}`)); }
        case 'pr.diff': {
          const r = input as GitHubInputs['pr.diff']; await checkPull(r);
          const text = string(await api(`${root}/pulls/${r.number}`, 'GET', undefined, true)); await checkPull(r); return textPage(text, r);
        }
        case 'issue.label': {
          const r = input as GitHubInputs['issue.label']; const current = object(await api(`${root}/issues/${r.number}`));
          if (current.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
          if (string(current.updated_at) !== r.expectedUpdatedAt) throw new ProtocolError('REVISION_CONFLICT', 'Issue changed; refresh classification');
          await api(`${root}/issues/${r.number}/labels`, 'POST', {labels: r.labels}); return {state: 'confirmed', externalId: String(r.number), evidenceRefs: []};
        }
        case 'pr.create': {
          const r = input as GitHubInputs['pr.create'];
          const branch = object(await api(`${root}/git/ref/heads/${r.head.split('/').map(encodeURIComponent).join('/')}`));
          if (string(object(branch.object).sha) !== r.expectedHeadSha) throw new ProtocolError('REVISION_CONFLICT', 'Head branch changed; refresh patch proposal');
          const created = object(await api(`${root}/pulls`, 'POST', {title: r.title, body: r.body, head: r.head, base: r.base, draft: r.draft ?? false}));
          const externalId = String(number(created.number)); const url = string(created.html_url);
          if (string(object(created.head).sha) !== r.expectedHeadSha) return {state: 'unknown', externalId, url, evidenceRefs: []};
          return {state: 'confirmed', externalId, url, evidenceRefs: []};
        }
        case 'issue.comment':
        case 'pr.comment': {
          const r = input as GitHubInputs['pr.comment'];
          if (op === 'pr.comment') await api(`${root}/pulls/${r.number}`);
          else { const value = object(await api(`${root}/issues/${r.number}`)); if (value.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request'); }
          const comment = object(await api(`${root}/issues/${r.number}/comments`, 'POST', {body: r.body})); return {state: 'confirmed', externalId: String(number(comment.id)), url: string(comment.html_url), evidenceRefs: []};
        }
        case 'pr.review.comment': {
          const r = input as GitHubInputs['pr.review.comment']; await checkPull({number: r.number, expectedHeadSha: r.commitId,
            ...(r.expectedBaseSha === undefined ? {} : {expectedBaseSha: r.expectedBaseSha})});
          const comment = object(await api(`${root}/pulls/${r.number}/comments`, 'POST', {body: r.body, commit_id: r.commitId, path: r.path, line: r.line, side: r.side ?? 'RIGHT'}));
          return {state: 'confirmed', externalId: String(number(comment.id)), url: string(comment.html_url), evidenceRefs: []};
        }
      }
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub operation unavailable');
    };
    try { return redactValue(await perform(), [token]) as GitHubOutputs[K]; }
    catch (error) {
      if (isGitHubWrite(op) && error instanceof ProtocolError && (error.code === 'RESULT_UNKNOWN' || (writeDispatched && error.code === 'EXTERNAL_FAILURE'))) return {state: 'unknown', evidenceRefs: []} as GitHubWriteResult as GitHubOutputs[K];
      if (error instanceof ProtocolError) throw new ProtocolError(error.code, 'GitHub operation failed', error.retryable, error.retryAfterMs);
      throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub operation failed');
    }
  }
}
