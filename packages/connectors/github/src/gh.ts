import { ProtocolError } from '@personal-agent/contracts';
import type { GitHubInputs, GitHubOperation, GitHubOutputs, GitHubProvider, GitHubReadContext, GitHubWriteResult } from './provider.js';
import { isGitHubWrite } from './provider.js';
import type { GhCommandRunner } from './runner.js';
import { executeGitHubOperation } from './operations.js';
import { checkContext, withGitHubContext } from './service.js';
import { validateInput } from './schemas.js';
import { redactValue, redactGitHubText } from './redact.js';

export interface GhProviderOptions {
  runner: GhCommandRunner;
  /** Restricted credential accessor supplied by Connector Host, never tool input. */
  readToken: (context: GitHubReadContext) => Promise<string>;
  /** Explicit repository allowlist supplied by trusted composition (`['*']` allows all repos). */
  repositories: readonly string[];
}
export class GhCliProvider implements GitHubProvider {
  readonly verification = 'conditional' as const;
  private disposed = false;
  private readonly runner: GhCommandRunner;
  constructor(private readonly options: GhProviderOptions) {
    if (!options.runner || !options.readToken || !options.repositories.length) throw new ProtocolError('INVALID_ARGUMENT', 'GitHub requires explicit runner, credentials and repositories');
    this.runner = options.runner;
    for (const repo of options.repositories) {
      if (repo !== '*') validateInput('repo.get', {repo});
    }
  }
  dispose(): void { this.disposed = true; this.runner.dispose?.(); }
  async execute<K extends GitHubOperation>(op: K, input: GitHubInputs[K], context: GitHubReadContext): Promise<GitHubOutputs[K]> {
    validateInput(op, input); checkContext(context);
    if (this.disposed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub provider disposed');
    let token: string;
    try { token = await withGitHubContext(context, bounded => this.options.readToken(bounded)); } catch (error) { if (error instanceof ProtocolError && ['TIMEOUT', 'CANCELLED'].includes(error.code)) throw error; throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable'); }
    checkContext(context);
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n\x00]/.test(token)) throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable');
    let writeDispatched = false;
    const api = async (endpoint: string, method = 'GET', payload?: unknown, raw: boolean | string = false): Promise<unknown> => {
      checkContext(context);
      const accept = typeof raw === 'string' ? raw : raw ? 'application/vnd.github.diff' : 'application/vnd.github+json';
      const args = ['api', '--hostname', 'github.com', '--method', method, endpoint, '-H', 'X-GitHub-Api-Version: 2022-11-28', '-H', `Accept: ${accept}`];
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
      if (raw === true) return redactGitHubText(result.stdout, [token]);
      if (!result.stdout) return {};
      try { return JSON.parse(result.stdout) as unknown; } catch { throw new ProtocolError(method === 'GET' ? 'EXTERNAL_FAILURE' : 'RESULT_UNKNOWN', 'Malformed GitHub response'); }
    };
    const readJobLog = async (r: GitHubInputs['actions.log.read'], job: Record<string, unknown>, boundedCtx: GitHubReadContext): Promise<string> => {
      // gh run view fetches text logs; the jobs/logs REST endpoint redirects
      // to a signed archive and must not be exposed as tool content.
      const args = ['run', 'view', String(r.runId), '--repo', r.repo, '--job', String(r.jobId), '--log-failed'];
      const result = await withGitHubContext(boundedCtx, bounded => this.runner.run({args, token, maxBytes: 1048576, context: bounded}));
      if (result.exitCode !== 0 || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1048576) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub log read failed');
      if (job.conclusion === 'failure' && !result.stdout.trim()) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub failed job log unavailable');
      return result.stdout;
    };
    try {
      const value = await executeGitHubOperation({
        op, input, context, token, repositories: this.options.repositories, api,
        writeDispatched: () => writeDispatched,
        readJobLog,
      });
      return redactValue(value, [token]) as GitHubOutputs[K];
    } catch (error) {
      if (isGitHubWrite(op) && error instanceof ProtocolError && (error.code === 'RESULT_UNKNOWN' || (writeDispatched && error.code === 'EXTERNAL_FAILURE'))) return {state: 'unknown', evidenceRefs: []} as GitHubWriteResult as GitHubOutputs[K];
      if (error instanceof ProtocolError) throw new ProtocolError(error.code, 'GitHub operation failed', error.retryable, error.retryAfterMs);
      throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub operation failed');
    }
  }
}
