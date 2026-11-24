import { ProtocolError } from '@personal-agent/contracts';
import type { GitHubInputs, GitHubOperation, GitHubOutputs, GitHubProvider, GitHubReadContext, GitHubWriteResult } from './provider.js';
import { isGitHubWrite } from './provider.js';
import { executeGitHubOperation } from './operations.js';
import { redactGitHubText, redactValue } from './redact.js';
import { validateInput } from './schemas.js';
import { checkContext, withGitHubContext } from './service.js';

export interface GitHubRestOptions {
  /** Restricted credential accessor supplied by Connector Host, never tool input. */
  readToken: (context: GitHubReadContext) => Promise<string>;
  /** Explicit repository allowlist (`['*']` allows all repos accessible to the token). */
  repositories?: readonly string[];
  fetchImpl?: typeof fetch;
}

const API_ORIGIN = 'https://api.github.com';
const MAX_BODY_BYTES = 1048576;

function statusToCode(status: number, rateLimited: boolean): ProtocolError['code'] {
  if (status === 404) return 'NOT_FOUND';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 429 || (status === 403 && rateLimited)) return 'RATE_LIMITED';
  if (status === 403) return 'SCOPE_DENIED';
  if (status === 422 || status === 409 || status === 405) return status === 409 ? 'REVISION_CONFLICT' : 'INVALID_ARGUMENT';
  return 'EXTERNAL_FAILURE';
}

function isAllowedLogRedirect(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'pipelines.actions.githubusercontent.com'
    || host.endsWith('.actions.githubusercontent.com')
    || host.endsWith('.githubusercontent.com')
    || host.endsWith('.blob.core.windows.net')
  );
}

async function readBoundedText(response: Response): Promise<string> {
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub response exceeded byte limit');
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub response exceeded byte limit');
  }
  return text;
}

export class GitHubRestProvider implements GitHubProvider {
  readonly verification = 'conditional' as const;
  private disposed = false;
  private readonly repositories: readonly string[];
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubRestOptions) {
    if (!options?.readToken) {
      throw new ProtocolError('INVALID_ARGUMENT', 'GitHub REST provider requires explicit credentials');
    }
    const repos = options.repositories?.length ? [...options.repositories] : ['*'];
    for (const repo of repos) {
      if (repo !== '*') validateInput('repo.get', { repo });
    }
    this.repositories = repos;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Fetch implementation unavailable for GitHub REST provider');
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  async execute<K extends GitHubOperation>(
    op: K,
    input: GitHubInputs[K],
    context: GitHubReadContext,
  ): Promise<GitHubOutputs[K]> {
    validateInput(op, input);
    checkContext(context);
    if (this.disposed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub provider disposed');

    let token: string;
    try {
      token = await withGitHubContext(context, bounded => this.options.readToken(bounded));
    } catch (error) {
      if (error instanceof ProtocolError && ['TIMEOUT', 'CANCELLED'].includes(error.code)) throw error;
      throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable');
    }
    checkContext(context);
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n\x00]/.test(token)) {
      throw new ProtocolError('UNAUTHORIZED', 'GitHub credential unavailable');
    }

    let writeDispatched = false;
    const request = async (url: string, init: RequestInit, method: string): Promise<Response> => {
      try {
        return await withGitHubContext(context, async bounded => {
          if (method !== 'GET') writeDispatched = true;
          return this.fetchImpl(url, { ...init, signal: bounded.signal });
        });
      } catch (error) {
        if (method !== 'GET' && writeDispatched) {
          throw new ProtocolError('RESULT_UNKNOWN', 'GitHub write outcome unknown; reconcile before any retry');
        }
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub request failed');
      }
    };

    const api = async (
      endpoint: string,
      method = 'GET',
      payload?: unknown,
      raw: boolean | string = false,
    ): Promise<unknown> => {
      checkContext(context);
      const normalized = endpoint.replace(/^\/+/, '');
      const url = `${API_ORIGIN}/${normalized}`;
      const accept = typeof raw === 'string'
        ? raw
        : raw
          ? 'application/vnd.github.diff'
          : 'application/vnd.github+json';
      const response = await request(
        url,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: accept,
            'User-Agent': 'PersonalAgent-GitHubConnector/1.0',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
          redirect: 'error',
        },
        method,
      );

      let bodyText: string;
      try {
        bodyText = await readBoundedText(response);
      } catch (error) {
        if (method !== 'GET' && writeDispatched) {
          throw new ProtocolError('RESULT_UNKNOWN', 'GitHub write outcome unknown; reconcile before any retry');
        }
        throw error;
      }

      if (!response.ok) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const rateLimited = response.status === 429 || remaining === '0' || /rate limit/i.test(bodyText);
        const mapped = statusToCode(response.status, rateLimited);
        const code = method !== 'GET' && mapped === 'EXTERNAL_FAILURE' ? 'RESULT_UNKNOWN' : mapped;
        throw new ProtocolError(
          code,
          code === 'RESULT_UNKNOWN' ? 'GitHub write outcome unknown; reconcile before any retry' : 'GitHub request failed',
          method === 'GET' && code === 'RATE_LIMITED',
        );
      }

      if (raw === true) return redactGitHubText(bodyText, [token]);
      if (response.status === 204 || !bodyText) return {};
      try {
        return JSON.parse(bodyText) as unknown;
      } catch {
        throw new ProtocolError(method === 'GET' ? 'EXTERNAL_FAILURE' : 'RESULT_UNKNOWN', 'Malformed GitHub response');
      }
    };

    const readJobLog = async (r: GitHubInputs['actions.log.read'], job: Record<string, unknown>): Promise<string> => {
      const url = `${API_ORIGIN}/repos/${r.repo}/actions/jobs/${r.jobId}/logs`;
      const initial = await request(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'PersonalAgent-GitHubConnector/1.0',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          redirect: 'manual',
        },
        'GET',
      );

      let finalResponse = initial;
      if (initial.status >= 300 && initial.status < 400) {
        const location = initial.headers.get('location');
        if (!location || !isAllowedLogRedirect(location)) {
          throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub log redirect rejected');
        }
        // Never forward GitHub Authorization header to third-party log blob storage.
        finalResponse = await request(location, { method: 'GET', redirect: 'error' }, 'GET');
      }

      if (!finalResponse.ok) {
        throw new ProtocolError(statusToCode(finalResponse.status, finalResponse.status === 429), 'GitHub log read failed');
      }
      const text = await readBoundedText(finalResponse);
      if (text.includes('\x00')) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub log is not UTF-8 text');
      if (job.conclusion === 'failure' && !text.trim()) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub failed job log unavailable');
      }
      return text;
    };

    try {
      const result = await executeGitHubOperation({
        op,
        input,
        context,
        token,
        repositories: this.repositories,
        api,
        writeDispatched: () => writeDispatched,
        readJobLog,
      });
      return redactValue(result, [token]) as GitHubOutputs[K];
    } catch (error) {
      if (isGitHubWrite(op) && error instanceof ProtocolError && (error.code === 'RESULT_UNKNOWN' || (writeDispatched && error.code === 'EXTERNAL_FAILURE'))) {
        return { state: 'unknown', evidenceRefs: [] } as GitHubWriteResult as GitHubOutputs[K];
      }
      if (error instanceof ProtocolError) {
        throw new ProtocolError(error.code, 'GitHub operation failed', error.retryable, error.retryAfterMs);
      }
      throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub operation failed');
    }
  }
}
