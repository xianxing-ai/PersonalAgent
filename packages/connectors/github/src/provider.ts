import type { ToolContext } from '@personal-agent/contracts';

export interface GitHubReadContext { signal: AbortSignal; deadline: string }
export interface RepositoryInput { repo: string }
export interface PageInput extends RepositoryInput { page?: number; perPage?: number }
export interface NumberInput extends RepositoryInput { number: number }
export interface TextPage { text: string; offset: number; nextOffset: number | null; truncated: boolean }
export interface GitHubRepository { fullName: string; defaultBranch: string; private: boolean; url: string }
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
export interface GitHubInputs {
  'repo.get': RepositoryInput;
  'actions.run.list': PageInput & { status?: 'queued' | 'in_progress' | 'completed' | 'failure' | 'success'; branch?: string };
  'actions.job.list': PageInput & { runId: number };
  'actions.log.read': RepositoryInput & { runId: number; jobId: number; offset?: number; maxChars?: number };
  'actions.repair.link': GitHubRepairIdentity;
  'actions.repair.get': GitHubRepairIdentity & {checkRunId: number};
  'issue.get': NumberInput;
  'issue.list': PageInput & { state?: 'open' | 'closed' | 'all'; labels?: string[] };
  'issue.label': NumberInput & { labels: string[]; expectedUpdatedAt: string };
  'issue.comment': NumberInput & { body: string };
  'issue.close': NumberInput & { expectedUpdatedAt?: string; comment?: string; stateReason?: 'completed' | 'not_planned' };
  'pr.get': NumberInput;
  'pr.diff': NumberInput & { expectedHeadSha: string; expectedBaseSha: string; offset?: number; maxChars?: number };
  'pr.create': RepositoryInput & { title: string; body: string; head: string; base: string; expectedHeadSha: string; draft?: boolean };
  'pr.comment': NumberInput & { body: string };
  'pr.review.comment': NumberInput & { body: string; commitId: string; expectedBaseSha?: string; path: string; line: number; side?: 'LEFT' | 'RIGHT' };
}
export interface GitHubOutputs {
  'repo.get': GitHubRepository;
  'actions.run.list': GitHubPage<GitHubRun>;
  'actions.job.list': GitHubPage<GitHubJob>;
  'actions.log.read': TextPage;
  'actions.repair.link': GitHubRepairLinkResult;
  'actions.repair.get': GitHubRepairReceipt;
  'issue.get': GitHubIssue;
  'issue.list': GitHubPage<GitHubIssue>;
  'issue.label': GitHubWriteResult;
  'issue.comment': GitHubWriteResult;
  'issue.close': GitHubWriteResult;
  'pr.get': GitHubPullRequest;
  'pr.diff': TextPage;
  'pr.create': GitHubWriteResult;
  'pr.comment': GitHubWriteResult;
  'pr.review.comment': GitHubWriteResult;
}
export type GitHubOperation = keyof GitHubInputs;
export interface GitHubPort {
  execute<K extends GitHubOperation>(operation: K, input: GitHubInputs[K], context: GitHubReadContext): Promise<GitHubOutputs[K]>;
}
export interface GitHubProvider extends GitHubPort { readonly verification: 'mock' | 'conditional'; dispose?(): void }
export type GitHubToolContext = ToolContext;
export const githubOperations: readonly GitHubOperation[] = ['repo.get', 'actions.run.list', 'actions.job.list', 'actions.log.read', 'issue.get', 'issue.list', 'issue.label', 'issue.comment', 'pr.get', 'pr.diff', 'pr.create', 'pr.comment', 'pr.review.comment'];
export const isGitHubWrite = (op: GitHubOperation): boolean => ['actions.repair.link', 'issue.label', 'issue.comment', 'issue.close', 'pr.create', 'pr.comment', 'pr.review.comment'].includes(op);
