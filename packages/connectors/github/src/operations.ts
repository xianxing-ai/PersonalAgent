import { ProtocolError } from '@personal-agent/contracts';
import type {
  GitHubBranch,
  GitHubCommit,
  GitHubCommitFile,
  GitHubContentEntry,
  GitHubInputs,
  GitHubIssue,
  GitHubOperation,
  GitHubOutputs,
  GitHubPage,
  GitHubPullRequest,
  GitHubPullRequestFile,
  GitHubReadContext,
  GitHubRepository,
  GitHubRepositorySummary,
  GitHubSearchCodeItem,
  GitHubSearchIssueItem,
  TextPage,
} from './provider.js';
import { redactGitHubText } from './redact.js';
import { executeGitHubRepairLink, getGitHubRepairLink } from './repair-link.js';

export type RecordValue = Record<string, unknown>;
export type ApiCall = (
  endpoint: string,
  method?: string,
  payload?: unknown,
  raw?: boolean | string,
) => Promise<unknown>;

export function asObject(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub response');
  }
  return value as RecordValue;
}

export function asString(value: unknown): string {
  if (typeof value !== 'string') throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub string');
  return value;
}

export function asPositiveInt(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub identifier');
  }
  return Number(value);
}

export function asNonNegativeInt(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub count');
  }
  return Number(value);
}

export function asNullableString(value: unknown): string | null {
  return value === null ? null : asString(value);
}

export function asBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub boolean');
  return value;
}

export function asArray(value: unknown, maxLength = 100): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub page');
  }
  return value;
}

export function isRepoAllowed(repositories: readonly string[], repo: string): boolean {
  return repositories.includes('*') || repositories.includes(repo);
}

export function parseRepository(raw: unknown): GitHubRepository {
  const r = asObject(raw);
  return {
    fullName: asString(r.full_name),
    defaultBranch: asString(r.default_branch),
    private: asBool(r.private),
    url: asString(r.html_url),
  };
}

export function parseRepositorySummary(raw: unknown): GitHubRepositorySummary {
  const repo = parseRepository(raw);
  return {
    repo: repo.fullName,
    defaultBranch: repo.defaultBranch,
    private: repo.private,
    url: repo.url,
  };
}

export function parseIssue(raw: unknown): GitHubIssue {
  const r = asObject(raw);
  return {
    number: asPositiveInt(r.number),
    title: asString(r.title),
    body: r.body === null ? '' : asString(r.body),
    state: asString(r.state),
    labels: asArray(r.labels).map(label => (typeof label === 'string' ? label : asString(asObject(label).name))),
    url: asString(r.html_url),
    updatedAt: asString(r.updated_at),
  };
}

export function parsePull(raw: unknown): GitHubPullRequest {
  const r = asObject(raw), base = asObject(r.base), head = asObject(r.head);
  return {
    number: asPositiveInt(r.number),
    title: asString(r.title),
    body: r.body === null ? '' : asString(r.body),
    state: asString(r.state),
    base: asString(base.ref),
    baseSha: asString(base.sha),
    head: asString(head.ref),
    headSha: asString(head.sha),
    url: asString(r.html_url),
    draft: asBool(r.draft),
    ...(typeof r.merged === 'boolean' ? { merged: r.merged } : {}),
    ...(r.merged_at === null || typeof r.merged_at === 'string' ? { mergedAt: r.merged_at } : {}),
    ...(r.mergeable === null || typeof r.mergeable === 'boolean' ? { mergeable: r.mergeable } : {}),
    ...(typeof r.mergeable_state === 'string' ? { mergeStateStatus: r.mergeable_state } : {}),
  };
}

export function paginate<T>(items: T[], input: { page?: number; perPage?: number }, remoteCount = items.length): GitHubPage<T> {
  const page = input.page ?? 1, hasMore = remoteCount === (input.perPage ?? 30);
  if (hasMore && page >= 10000) throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub pagination limit reached');
  return { items, page, nextPage: hasMore ? page + 1 : null, hasMore };
}

export function textPage(text: string, input: { offset?: number; maxChars?: number }): TextPage {
  const offset = input.offset ?? 0, size = input.maxChars ?? 16384;
  if (offset > text.length) throw new ProtocolError('INVALID_ARGUMENT', 'Text offset exceeds content length');
  const end = Math.min(text.length, offset + size);
  return { text: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, truncated: end < text.length };
}

function encodeRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function parseContentEntry(raw: unknown): GitHubContentEntry {
  const r = asObject(raw);
  const typeValue = asString(r.type);
  const type: 'file' | 'dir' = typeValue === 'dir' ? 'dir' : typeValue === 'file' ? 'file' : (() => {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Unsupported GitHub content entry type');
  })();
  return {
    type,
    path: asString(r.path),
    name: asString(r.name),
    sha: asString(r.sha),
    size: asNonNegativeInt(r.size),
    url: asString(r.html_url),
  };
}

function parseCommitSummary(raw: unknown): GitHubCommit {
  const r = asObject(raw);
  const commit = asObject(r.commit);
  const author = commit.author ? asObject(commit.author) : null;
  const authorName = author && typeof author.name === 'string' ? author.name : 'unknown';
  const authoredAt = author && typeof author.date === 'string' ? author.date : '';
  const files = Array.isArray(r.files)
    ? r.files.slice(0, 300).map((f): GitHubCommitFile => {
        const entry = asObject(f);
        return {
          filename: asString(entry.filename),
          status: asString(entry.status),
          additions: asNonNegativeInt(entry.additions),
          deletions: asNonNegativeInt(entry.deletions),
          ...(typeof entry.patch === 'string' ? { patch: entry.patch.slice(0, 65536) } : {}),
        };
      })
    : undefined;
  return {
    sha: asString(r.sha),
    message: asString(commit.message).slice(0, 65536),
    authorName,
    authoredAt,
    url: asString(r.html_url),
    ...(files ? { files } : {}),
  };
}

function parseRepoFromUrl(apiUrl: unknown): string {
  const raw = asString(apiUrl);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub repository URL');
  }
  const match = /^\/repos\/([^/]+\/[^/]+)\/?$/.exec(parsed.pathname);
  if (!match?.[1]) throw new ProtocolError('EXTERNAL_FAILURE', 'Malformed GitHub repository URL');
  return match[1];
}

function buildSearchQuery(q: string, repo: string | undefined, repositories: readonly string[]): string {
  const parts = [q.trim()];
  if (repo) {
    if (!q.includes(`repo:${repo}`)) parts.push(`repo:${repo}`);
    return parts.join(' ');
  }
  if (!repositories.includes('*')) {
    if (repositories.length > 10) {
      throw new ProtocolError('SCOPE_DENIED', 'Specify repo when GitHub scope has more than 10 repositories');
    }
    for (const allowed of repositories) parts.push(`repo:${allowed}`);
  }
  return parts.join(' ');
}

export interface ExecuteOperationArgs<K extends GitHubOperation> {
  op: K;
  input: GitHubInputs[K];
  context: GitHubReadContext;
  token: string;
  repositories: readonly string[];
  api: ApiCall;
  writeDispatched: () => boolean;
  readJobLog: (input: GitHubInputs['actions.log.read'], job: RecordValue, context: GitHubReadContext) => Promise<string>;
}

export async function executeGitHubOperation<K extends GitHubOperation>({
  op,
  input,
  context,
  token,
  repositories,
  api,
  writeDispatched,
  readJobLog,
}: ExecuteOperationArgs<K>): Promise<GitHubOutputs[K]> {
  const inputRecord = input as Record<string, unknown>;
  const repo = typeof inputRecord.repo === 'string' ? inputRecord.repo : undefined;
  if (repo !== undefined && !isRepoAllowed(repositories, repo)) {
    throw new ProtocolError('SCOPE_DENIED', 'Repository is outside configured GitHub scope');
  }
  const root = repo ? `repos/${repo}` : '';
  const pageQuery = (r: { page?: number; perPage?: number }) => `per_page=${r.perPage ?? 30}&page=${r.page ?? 1}`;
  const checkPull = async (r: { number: number; expectedHeadSha: string; expectedBaseSha?: string }) => {
    const pr = parsePull(await api(`${root}/pulls/${r.number}`));
    if (pr.headSha !== r.expectedHeadSha || (r.expectedBaseSha !== undefined && pr.baseSha !== r.expectedBaseSha)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Pull request changed; refresh the proposal');
    }
    return pr;
  };
  const repairApi = (endpoint: string, method?: string, payload?: unknown) => api(endpoint, method, payload);

  const perform = async (): Promise<unknown> => {
  switch (op) {
    case 'viewer.get': {
      const r = asObject(await api('user'));
      return {
        login: asString(r.login),
        name: asNullableString(r.name ?? null),
        url: asString(r.html_url),
      };
    }
    case 'repo.get': {
      return parseRepository(await api(root));
    }
    case 'repo.list': {
      const r = input as GitHubInputs['repo.list'];
      const query = `${pageQuery(r)}${r.sort ? `&sort=${encodeURIComponent(r.sort)}` : ''}${r.affiliation ? `&affiliation=${encodeURIComponent(r.affiliation)}` : ''}`;
      const rows = asArray(await api(`user/repos?${query}`));
      const items = rows.map(parseRepositorySummary).filter(item => isRepoAllowed(repositories, item.repo));
      return paginate(items, r, rows.length);
    }
    case 'repo.contents': {
      const r = input as GitHubInputs['repo.contents'];
      const cleanPath = (r.path ?? '').replace(/^\/+|\/+$/g, '');
      const endpoint = `${root}/contents${cleanPath ? `/${encodeRef(cleanPath)}` : ''}${r.ref ? `?ref=${encodeURIComponent(r.ref)}` : ''}`;
      const payload = await api(endpoint);
      if (Array.isArray(payload)) {
        const entries = asArray(payload, 500).map(parseContentEntry);
        return { kind: 'dir', path: cleanPath, ...(r.ref ? { ref: r.ref } : {}), entries };
      }
      const file = asObject(payload);
      if (asString(file.type) !== 'file') {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Unsupported GitHub content object');
      }
      const encoded = typeof file.content === 'string' ? file.content.replace(/\s+/g, '') : '';
      const rawBuf = Buffer.from(encoded, 'base64');
      if (rawBuf.byteLength > 1048576 || rawBuf.includes(0)) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub file content unavailable or binary');
      }
      const decoded = rawBuf.toString('utf8');
      const paged = textPage(decoded, r);
      return {
        kind: 'file',
        path: asString(file.path),
        ...(r.ref ? { ref: r.ref } : {}),
        text: paged.text,
        offset: paged.offset,
        nextOffset: paged.nextOffset,
        truncated: paged.truncated,
      };
    }
    case 'branch.list': {
      const r = input as GitHubInputs['branch.list'];
      const rows = asArray(await api(`${root}/branches?${pageQuery(r)}`));
      const items: GitHubBranch[] = rows.map(value => {
        const b = asObject(value);
        return {
          name: asString(b.name),
          sha: asString(asObject(b.commit).sha),
          protected: typeof b.protected === 'boolean' ? b.protected : false,
        };
      });
      return paginate(items, r, rows.length);
    }
    case 'branch.create': {
      const r = input as GitHubInputs['branch.create'];
      const created = asObject(
        await api(`${root}/git/refs`, 'POST', { ref: `refs/heads/${r.branch}`, sha: r.fromSha }),
      );
      const createdSha = asString(asObject(created.object).sha);
      const url = typeof created.url === 'string' ? created.url : undefined;
      if (createdSha !== r.fromSha) {
        return { state: 'unknown', externalId: r.branch, ...(url ? { url } : {}), evidenceRefs: [] };
      }
      return { state: 'confirmed', externalId: r.branch, ...(url ? { url } : {}), evidenceRefs: [] };
    }
    case 'commit.list': {
      const r = input as GitHubInputs['commit.list'];
      const query = `${pageQuery(r)}${r.sha ? `&sha=${encodeURIComponent(r.sha)}` : ''}${r.path ? `&path=${encodeURIComponent(r.path)}` : ''}${r.author ? `&author=${encodeURIComponent(r.author)}` : ''}`;
      const rows = asArray(await api(`${root}/commits?${query}`));
      return paginate(rows.map(parseCommitSummary), r, rows.length);
    }
    case 'commit.get': {
      const r = input as GitHubInputs['commit.get'];
      return parseCommitSummary(await api(`${root}/commits/${encodeURIComponent(r.sha)}`));
    }
    case 'search.code': {
      const r = input as GitHubInputs['search.code'];
      const effectiveQ = buildSearchQuery(r.q, r.repo, repositories);
      const payload = asObject(
        await api(
          `search/code?q=${encodeURIComponent(effectiveQ)}&${pageQuery(r)}`,
          'GET',
          undefined,
          'application/vnd.github.text-match+json',
        ),
      );
      const rows = asArray(payload.items);
      const items: GitHubSearchCodeItem[] = [];
      for (const value of rows) {
        const entry = asObject(value);
        const entryRepo = asString(asObject(entry.repository).full_name);
        if (!isRepoAllowed(repositories, entryRepo)) continue;
        const matchedLines = Array.isArray(entry.text_matches)
          ? entry.text_matches
              .slice(0, 50)
              .map(m => asObject(m).fragment)
              .filter((f): f is string => typeof f === 'string')
              .map(f => f.slice(0, 2000))
          : undefined;
        items.push({
          repo: entryRepo,
          path: asString(entry.path),
          sha: asString(entry.sha),
          url: asString(entry.html_url),
          ...(matchedLines?.length ? { matchedLines } : {}),
        });
      }
      return paginate(items, r, rows.length);
    }
    case 'search.issues': {
      const r = input as GitHubInputs['search.issues'];
      const effectiveQ = buildSearchQuery(r.q, r.repo, repositories);
      const query = `q=${encodeURIComponent(effectiveQ)}&${pageQuery(r)}${r.sort ? `&sort=${encodeURIComponent(r.sort)}` : ''}`;
      const payload = asObject(await api(`search/issues?${query}`));
      const rows = asArray(payload.items);
      const items: GitHubSearchIssueItem[] = [];
      for (const value of rows) {
        const entry = asObject(value);
        const entryRepo = parseRepoFromUrl(entry.repository_url);
        if (!isRepoAllowed(repositories, entryRepo)) continue;
        items.push({
          repo: entryRepo,
          number: asPositiveInt(entry.number),
          title: asString(entry.title),
          state: asString(entry.state),
          isPullRequest: Boolean(entry.pull_request),
          labels: asArray(entry.labels).map(label => (typeof label === 'string' ? label : asString(asObject(label).name))),
          url: asString(entry.html_url),
          updatedAt: asString(entry.updated_at),
        });
      }
      return paginate(items, r, rows.length);
    }
    case 'actions.run.list': {
      const r = input as GitHubInputs['actions.run.list'];
      const payload = asObject(
        await api(
          `${root}/actions/runs?${pageQuery(r)}${r.status ? `&status=${encodeURIComponent(r.status)}` : ''}${r.branch ? `&branch=${encodeURIComponent(r.branch)}` : ''}`,
        ),
      );
      return paginate(
        asArray(payload.workflow_runs).map(value => {
          const run = asObject(value);
          return {
            id: asPositiveInt(run.id),
            name: run.name === null ? '' : asString(run.name),
            status: asString(run.status),
            conclusion: asNullableString(run.conclusion),
            headSha: asString(run.head_sha),
            url: asString(run.html_url),
            createdAt: asString(run.created_at),
          };
        }),
        r,
      );
    }
    case 'actions.job.list': {
      const r = input as GitHubInputs['actions.job.list'];
      const payload = asObject(await api(`${root}/actions/runs/${r.runId}/jobs?${pageQuery(r)}`));
      return paginate(
        asArray(payload.jobs).map(value => {
          const job = asObject(value);
          return {
            id: asPositiveInt(job.id),
            runId: asPositiveInt(job.run_id),
            name: asString(job.name),
            status: asString(job.status),
            conclusion: asNullableString(job.conclusion),
            url: asString(job.html_url),
          };
        }),
        r,
      );
    }
    case 'actions.log.read': {
      const r = input as GitHubInputs['actions.log.read'];
      const job = asObject(await api(`${root}/actions/jobs/${r.jobId}`));
      if (asPositiveInt(job.run_id) !== r.runId || asPositiveInt(job.id) !== r.jobId) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Job does not belong to requested run');
      }
      const logText = await readJobLog(r, job, context);
      return textPage(redactGitHubText(logText, [token]), r);
    }
    case 'actions.repair.link': {
      return await executeGitHubRepairLink(
        input as GitHubInputs['actions.repair.link'],
        repairApi,
        writeDispatched,
      );
    }
    case 'actions.repair.get': {
      return await getGitHubRepairLink(
        input as GitHubInputs['actions.repair.get'],
        repairApi,
      );
    }
    case 'issue.get': {
      const r = input as GitHubInputs['issue.get'];
      const value = asObject(await api(`${root}/issues/${r.number}`));
      if (value.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
      return parseIssue(value);
    }
    case 'issue.list': {
      const r = input as GitHubInputs['issue.list'];
      const rows = asArray(
        await api(
          `${root}/issues?${pageQuery(r)}&state=${r.state ?? 'open'}${r.labels ? `&labels=${encodeURIComponent(r.labels.join(','))}` : ''}`,
        ),
      );
      return paginate(rows.filter(value => !asObject(value).pull_request).map(parseIssue), r, rows.length);
    }
    case 'issue.create': {
      const r = input as GitHubInputs['issue.create'];
      const created = asObject(
        await api(`${root}/issues`, 'POST', {
          title: r.title,
          ...(r.body !== undefined ? { body: r.body } : {}),
          ...(r.labels !== undefined ? { labels: r.labels } : {}),
          ...(r.assignees !== undefined ? { assignees: r.assignees } : {}),
        }),
      );
      return {
        state: 'confirmed',
        externalId: String(asPositiveInt(created.number)),
        url: asString(created.html_url),
        evidenceRefs: [],
      };
    }
    case 'issue.update': {
      const r = input as GitHubInputs['issue.update'];
      const current = asObject(await api(`${root}/issues/${r.number}`));
      if (current.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
      if (asString(current.updated_at) !== r.expectedUpdatedAt) {
        throw new ProtocolError('REVISION_CONFLICT', 'Issue changed; refresh snapshot before updating');
      }
      const updated = asObject(
        await api(`${root}/issues/${r.number}`, 'PATCH', {
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.body !== undefined ? { body: r.body } : {}),
          ...(r.state !== undefined ? { state: r.state } : {}),
          ...(r.labels !== undefined ? { labels: r.labels } : {}),
        }),
      );
      return {
        state: 'confirmed',
        externalId: String(asPositiveInt(updated.number)),
        url: asString(updated.html_url),
        evidenceRefs: [],
      };
    }
    case 'pr.get': {
      const r = input as GitHubInputs['pr.get'];
      return parsePull(await api(`${root}/pulls/${r.number}`));
    }
    case 'pr.list': {
      const r = input as GitHubInputs['pr.list'];
      const query = `${pageQuery(r)}&state=${r.state ?? 'open'}${r.base ? `&base=${encodeURIComponent(r.base)}` : ''}${r.head ? `&head=${encodeURIComponent(r.head)}` : ''}${r.sort ? `&sort=${encodeURIComponent(r.sort)}` : ''}`;
      const rows = asArray(await api(`${root}/pulls?${query}`));
      return paginate(rows.map(parsePull), r, rows.length);
    }
    case 'pr.files': {
      const r = input as GitHubInputs['pr.files'];
      const rows = asArray(await api(`${root}/pulls/${r.number}/files?${pageQuery(r)}`));
      const items: GitHubPullRequestFile[] = rows.map(value => {
        const f = asObject(value);
        return {
          filename: asString(f.filename),
          status: asString(f.status),
          additions: asNonNegativeInt(f.additions),
          deletions: asNonNegativeInt(f.deletions),
          changes: asNonNegativeInt(f.changes),
          ...(typeof f.patch === 'string' ? { patch: f.patch.slice(0, 65536) } : {}),
        };
      });
      return paginate(items, r, rows.length);
    }
    case 'pr.diff': {
      const r = input as GitHubInputs['pr.diff'];
      await checkPull(r);
      const text = asString(await api(`${root}/pulls/${r.number}`, 'GET', undefined, true));
      await checkPull(r);
      return textPage(text, r);
    }
    case 'issue.label': {
      const r = input as GitHubInputs['issue.label'];
      const current = asObject(await api(`${root}/issues/${r.number}`));
      if (current.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
      if (asString(current.updated_at) !== r.expectedUpdatedAt) {
        throw new ProtocolError('REVISION_CONFLICT', 'Issue changed; refresh classification');
      }
      await api(`${root}/issues/${r.number}/labels`, 'POST', { labels: r.labels });
      return { state: 'confirmed', externalId: String(r.number), evidenceRefs: [] };
    }
    case 'issue.close': {
      const r = input as GitHubInputs['issue.close'];
      const current = asObject(await api(`${root}/issues/${r.number}`));
      if (current.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
      if (r.expectedUpdatedAt !== undefined && asString(current.updated_at) !== r.expectedUpdatedAt) {
        throw new ProtocolError('REVISION_CONFLICT', 'Issue changed; refresh snapshot before closing');
      }
      if (r.comment !== undefined) {
        await api(`${root}/issues/${r.number}/comments`, 'POST', { body: r.comment });
      }
      const closed = asObject(
        await api(`${root}/issues/${r.number}`, 'PATCH', {
          state: 'closed',
          state_reason: r.stateReason ?? 'completed',
        }),
      );
      const externalId = String(asPositiveInt(closed.number));
      const url = asString(closed.html_url);
      if (asString(closed.state) !== 'closed') return { state: 'unknown', externalId, url, evidenceRefs: [] };
      return { state: 'confirmed', externalId, url, evidenceRefs: [] };
    }
    case 'pr.create': {
      const r = input as GitHubInputs['pr.create'];
      const branch = asObject(await api(`${root}/git/ref/heads/${encodeRef(r.head)}`));
      if (asString(asObject(branch.object).sha) !== r.expectedHeadSha) {
        throw new ProtocolError('REVISION_CONFLICT', 'Head branch changed; refresh patch proposal');
      }
      const created = asObject(
        await api(`${root}/pulls`, 'POST', { title: r.title, body: r.body, head: r.head, base: r.base, draft: r.draft ?? false }),
      );
      const externalId = String(asPositiveInt(created.number));
      const url = asString(created.html_url);
      if (asString(asObject(created.head).sha) !== r.expectedHeadSha) {
        return { state: 'unknown', externalId, url, evidenceRefs: [] };
      }
      return { state: 'confirmed', externalId, url, evidenceRefs: [] };
    }
    case 'issue.comment':
    case 'pr.comment': {
      const r = input as GitHubInputs['pr.comment'];
      if (op === 'pr.comment') await api(`${root}/pulls/${r.number}`);
      else {
        const value = asObject(await api(`${root}/issues/${r.number}`));
        if (value.pull_request) throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
      }
      const comment = asObject(await api(`${root}/issues/${r.number}/comments`, 'POST', { body: r.body }));
      return {
        state: 'confirmed',
        externalId: String(asPositiveInt(comment.id)),
        url: asString(comment.html_url),
        evidenceRefs: [],
      };
    }
    case 'pr.review': {
      const r = input as GitHubInputs['pr.review'];
      await checkPull({ number: r.number, expectedHeadSha: r.expectedHeadSha });
      const review = asObject(
        await api(`${root}/pulls/${r.number}/reviews`, 'POST', {
          commit_id: r.expectedHeadSha,
          event: r.event,
          ...(r.body !== undefined ? { body: r.body } : {}),
          ...(r.comments?.length
            ? {
                comments: r.comments.map(c => ({
                  path: c.path,
                  line: c.line,
                  body: c.body,
                  side: c.side ?? 'RIGHT',
                })),
              }
            : {}),
        }),
      );
      return {
        state: 'confirmed',
        externalId: String(asPositiveInt(review.id)),
        url: asString(review.html_url),
        evidenceRefs: [],
      };
    }
    case 'pr.review.comment': {
      const r = input as GitHubInputs['pr.review.comment'];
      await checkPull({
        number: r.number,
        expectedHeadSha: r.commitId,
        ...(r.expectedBaseSha === undefined ? {} : { expectedBaseSha: r.expectedBaseSha }),
      });
      const comment = asObject(
        await api(`${root}/pulls/${r.number}/comments`, 'POST', {
          body: r.body,
          commit_id: r.commitId,
          path: r.path,
          line: r.line,
          side: r.side ?? 'RIGHT',
        }),
      );
      return {
        state: 'confirmed',
        externalId: String(asPositiveInt(comment.id)),
        url: asString(comment.html_url),
        evidenceRefs: [],
      };
    }
    case 'pr.merge': {
      const r = input as GitHubInputs['pr.merge'];
      const pr = await checkPull({ number: r.number, expectedHeadSha: r.expectedHeadSha });
      const merged = asObject(
        await api(`${root}/pulls/${r.number}/merge`, 'PUT', {
          sha: r.expectedHeadSha,
          ...(r.mergeMethod ? { merge_method: r.mergeMethod } : {}),
          ...(r.commitTitle !== undefined ? { commit_title: r.commitTitle } : {}),
          ...(r.commitMessage !== undefined ? { commit_message: r.commitMessage } : {}),
        }),
      );
      const externalId = typeof merged.sha === 'string' && merged.sha ? merged.sha : String(r.number);
      if (merged.merged !== true) {
        return { state: 'unknown', externalId, url: pr.url, evidenceRefs: [] };
      }
      return { state: 'confirmed', externalId, url: pr.url, evidenceRefs: [] };
    }
  }
  throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub operation unavailable');
  };
  return (await perform()) as GitHubOutputs[K];
}
