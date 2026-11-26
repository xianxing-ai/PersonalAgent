import type { ToolContext } from '@personal-agent/contracts';

export interface GitHubReadContext { signal: AbortSignal; deadline: string }
export interface RepositoryInput { repo: string }
export interface PageInput extends RepositoryInput { page?: number; perPage?: number }
export interface NumberInput extends RepositoryInput { number: number }
export interface TextPage { text: string; offset: number; nextOffset: number | null; truncated: boolean }
export interface GitHubRepository { fullName: string; defaultBranch: string; private: boolean; url: string }
export interface GitHubRepositorySummary { repo: string; defaultBranch: string; private: boolean; url: string }
export interface GitHubRun { id: number; name: string; status: string; conclusion: string | null; headSha: string; url: string; createdAt: string }
export interface GitHubJob { id: number; runId: number; name: string; status: string; conclusion: string | null; url: string }
export interface GitHubIssue { number: number; title: string; body: string; state: string; labels: string[]; url: string; updatedAt: string }
export interface GitHubPullRequest { number: number; title: string; body: string; state: string; base: string; baseSha: string; head: string; headSha: string; url: string; draft: boolean; merged?: boolean; mergedAt?: string | null; mergeable?: boolean | null; mergeStateStatus?: string }
export interface GitHubPage<T> { items: T[]; page: number; nextPage: number | null; hasMore: boolean }
export interface GitHubWriteResult { state: 'confirmed' | 'unknown'; externalId?: string; url?: string; evidenceRefs: string[] }
/** Trusted workflow execution binds a repair association to one failed run attempt and reviewed PR head. */
export interface GitHubRepairIdentity extends RepositoryInput {
  runId: number;
  expectedRunAttempt: number;
  sourceSha: string;
  repairPrNumber: number;
  repairHeadSha: string;
  /** SHA-256 of the original stable workflow tool run identifier; never model supplied. */
  workflowExecutionId: string;
}
export interface GitHubRepairReceipt extends GitHubRepairIdentity {
  checkRunId: number;
  externalId: string;
  url: string;
  name: string;
  detailsUrl: string;
  status: 'completed';
  conclusion: 'neutral';
  evidenceRefs: string[];
}
export type GitHubRepairLinkResult = ({state: 'confirmed'} & GitHubRepairReceipt) | {
  state: 'unknown'; checkRunId?: number; externalId?: string; url?: string; evidenceRefs: string[];
};
export interface GitHubUser { login: string; name: string | null; url: string }
export interface GitHubContentEntry { type: 'file' | 'dir'; path: string; name: string; sha: string; size: number; url: string; content?: string; truncated?: boolean; offset?: number; nextOffset?: number | null }
export interface GitHubBranch { name: string; sha: string; protected: boolean }
export interface GitHubCommitFile { filename: string; status: string; additions: number; deletions: number; patch?: string }
export interface GitHubCommit { sha: string; message: string; authorName: string; authoredAt: string; url: string; files?: GitHubCommitFile[] }
export interface GitHubSearchCodeItem { repo: string; path: string; sha: string; url: string; matchedLines?: string[] }
export interface GitHubSearchIssueItem { repo: string; number: number; title: string; state: string; isPullRequest: boolean; labels: string[]; url: string; updatedAt: string }
export interface GitHubPullRequestFile { filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string }
export interface GitHubReviewCommentInput { path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' }
export interface GitHubInputs {
  'viewer.get': Record<string, never>;
  'repo.get': RepositoryInput;
  'repo.list': { page?: number; perPage?: number; sort?: 'created' | 'updated' | 'pushed' | 'full_name'; affiliation?: 'owner' | 'collaborator' | 'organization_member' | 'all' };
  'repo.contents': RepositoryInput & { path?: string; ref?: string; offset?: number; maxChars?: number };
  'branch.list': PageInput;
  'branch.create': RepositoryInput & { branch: string; fromSha: string };
  'commit.list': PageInput & { sha?: string; path?: string; author?: string };
  'commit.get': RepositoryInput & { sha: string };
  'search.code': { q: string; repo?: string; page?: number; perPage?: number };
  'search.issues': { q: string; repo?: string; page?: number; perPage?: number; sort?: 'created' | 'updated' | 'comments' };
  'actions.run.list': PageInput & { status?: 'queued' | 'in_progress' | 'completed' | 'failure' | 'success'; branch?: string };
  'actions.job.list': PageInput & { runId: number };
  'actions.log.read': RepositoryInput & { runId: number; jobId: number; offset?: number; maxChars?: number };
  'actions.repair.link': GitHubRepairIdentity;
  'actions.repair.get': GitHubRepairIdentity & {checkRunId: number};
  'issue.get': NumberInput;
  'issue.list': PageInput & { state?: 'open' | 'closed' | 'all'; labels?: string[] };
  'issue.create': RepositoryInput & { title: string; body?: string; labels?: string[]; assignees?: string[] };
  'issue.update': NumberInput & { expectedUpdatedAt: string; title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[] };
  'issue.label': NumberInput & { labels: string[]; expectedUpdatedAt: string };
  'issue.comment': NumberInput & { body: string };
  'issue.close': NumberInput & { expectedUpdatedAt?: string; comment?: string; stateReason?: 'completed' | 'not_planned' };
  'pr.get': NumberInput;
  'pr.list': PageInput & { state?: 'open' | 'closed' | 'all'; base?: string; head?: string; sort?: 'created' | 'updated' | 'popularity' | 'long-running' };
  'pr.files': PageInput & { number: number; includePatch?: boolean };
  'pr.diff': NumberInput & { expectedHeadSha: string; expectedBaseSha: string; offset?: number; maxChars?: number };
  'pr.create': RepositoryInput & { title: string; body: string; head: string; base: string; expectedHeadSha: string; draft?: boolean };
  'pr.comment': NumberInput & { body: string };
  'pr.review': NumberInput & { expectedHeadSha: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body?: string; comments?: GitHubReviewCommentInput[] };
  'pr.review.comment': NumberInput & { body: string; commitId: string; expectedBaseSha?: string; path: string; line: number; side?: 'LEFT' | 'RIGHT' };
  'pr.merge': NumberInput & { expectedHeadSha: string; mergeMethod?: 'merge' | 'squash' | 'rebase'; commitTitle?: string; commitMessage?: string };
}
export interface GitHubOutputs {
  'viewer.get': GitHubUser;
  'repo.get': GitHubRepository;
  'repo.list': GitHubPage<GitHubRepositorySummary>;
  'repo.contents': { kind: 'file' | 'dir'; path: string; ref?: string; text?: string; offset?: number; nextOffset?: number | null; truncated?: boolean; entries?: GitHubContentEntry[] };
  'branch.list': GitHubPage<GitHubBranch>;
  'branch.create': GitHubWriteResult;
  'commit.list': GitHubPage<GitHubCommit>;
  'commit.get': GitHubCommit;
  'search.code': GitHubPage<GitHubSearchCodeItem>;
  'search.issues': GitHubPage<GitHubSearchIssueItem>;
  'actions.run.list': GitHubPage<GitHubRun>;
  'actions.job.list': GitHubPage<GitHubJob>;
  'actions.log.read': TextPage;
  'actions.repair.link': GitHubRepairLinkResult;
  'actions.repair.get': GitHubRepairReceipt;
  'issue.get': GitHubIssue;
  'issue.list': GitHubPage<GitHubIssue>;
  'issue.create': GitHubWriteResult;
  'issue.update': GitHubWriteResult;
  'issue.label': GitHubWriteResult;
  'issue.comment': GitHubWriteResult;
  'issue.close': GitHubWriteResult;
  'pr.get': GitHubPullRequest;
  'pr.list': GitHubPage<GitHubPullRequest>;
  'pr.files': GitHubPage<GitHubPullRequestFile>;
  'pr.diff': TextPage;
  'pr.create': GitHubWriteResult;
  'pr.comment': GitHubWriteResult;
  'pr.review': GitHubWriteResult;
  'pr.review.comment': GitHubWriteResult;
  'pr.merge': GitHubWriteResult;
}
export type GitHubOperation = keyof GitHubInputs;
export interface GitHubPort {
  execute<K extends GitHubOperation>(operation: K, input: GitHubInputs[K], context: GitHubReadContext): Promise<GitHubOutputs[K]>;
}
export interface GitHubProvider extends GitHubPort { readonly verification: 'mock' | 'conditional'; dispose?(): void }
export type GitHubToolContext = ToolContext;
export const githubOperations: readonly GitHubOperation[] = ['repo.get', 'actions.run.list', 'actions.job.list', 'actions.log.read', 'issue.get', 'issue.list', 'issue.label', 'issue.comment', 'issue.close', 'pr.get', 'pr.diff', 'pr.create', 'pr.comment', 'pr.review.comment'];
export const githubExtendedOperations: readonly GitHubOperation[] = [
  'viewer.get', 'repo.list', 'repo.contents', 'branch.list', 'branch.create',
  'commit.list', 'commit.get', 'search.code', 'search.issues',
  'issue.create', 'issue.update', 'pr.list', 'pr.files', 'pr.review', 'pr.merge',
];
export const githubAllOperations: readonly GitHubOperation[] = [...githubOperations, ...githubExtendedOperations];
export const isGitHubWrite = (op: GitHubOperation): boolean => [
  'actions.repair.link', 'branch.create', 'issue.create', 'issue.update', 'issue.label', 'issue.comment', 'issue.close',
  'pr.create', 'pr.comment', 'pr.review', 'pr.review.comment', 'pr.merge',
].includes(op);
