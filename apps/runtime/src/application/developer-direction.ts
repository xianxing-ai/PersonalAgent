import {selectDeveloperModelGateway, type ModelGateway, type ModelRequest, type ModelResult} from '@personal-agent/models';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {
  ENROLLED_AUTONOMY_LEVEL, UNCONFIGURED_AUTONOMY_LEVEL, assertAutonomyChange, consumeAutonomyUse, createStandingGrant,
  decideAutonomy, revokeStandingGrant, type AutonomyDecision, type AutonomyLevel, type StandingAutonomyGrant,
} from '@personal-agent/policy';
import {argumentsDerivedFromUntrusted, renderUntrustedPrompt, wrapUntrusted, type UntrustedContent} from '@personal-agent/policy';
import {budgetSpent, estimateCost, reserveBudget, settleBudget, type BudgetState, type ModelPriceCard} from '@personal-agent/policy';
import {
  detectApiDocDrift, finishTrigger, initialCiLoop, knowledgeDrift, rememberTrigger, routeTrigger, scanKnowledgeDirectory, stepCiLoop, emptyTriggerState,
  type CiLoopState, type KnowledgeIndex, type KnowledgeScanPolicy, type TriggerRule, type TriggerEvent, type TriggerState,
} from '@personal-agent/github';
import {
  acceptDeveloperNotice, emptyDeveloperDelivery, setDeveloperSubscription,
  type DesktopNoticeChannel, type DeveloperDeliveryState, type DeveloperNoticeClass, type DeveloperNoticeKind,
} from '@personal-agent/notifications';

export interface GitWorkspacePort {
  evidenceLevel: 'fixture' | 'executed-local';
  ensureWorktree(input: {repoPath: string; baseSha: string; branch: string; path: string}): Promise<{baseSha: string}>;
  removeWorktree(input: {repoPath: string; path: string}): Promise<void>;
  headSha(repoPath: string): Promise<string | 'unknown'>;
  revertCommit?(input: {repoPath: string; sha: string}): Promise<{evidence: string}>;
  restoreBranch?(input: {repoPath: string; branch: string; sha: string}): Promise<{evidence: string}>;
}

export interface WorkspaceLease {
  repo: string;
  repoPath: string;
  baseSha: string;
  branch: string;
  path: string;
  ownerTaskId: string;
  executionEpoch: number;
  expiresAt: number;
  status: 'active' | 'handed_off' | 'released' | 'yielded';
}

export interface RepoLock {
  repo: string;
  ref: string;
  holderTaskId: string;
  mode: 'read' | 'write';
  epoch: number;
  heartbeatAt: number;
  expiresAt: number;
}

export interface DeveloperGoal {
  id: string;
  sentence: string;
  repo?: string;
  pullRequest?: number;
  issue?: number;
  branch?: string;
  doneWhen?: string;
  deadline?: string;
  budget?: number;
  status: 'open' | 'paused' | 'handed_off' | 'stopped' | 'done';
  taskId?: string;
  headSha?: string;
  step: string;
  nextGate?: string;
  controlRevision: number;
  parentTaskId?: string;
  subtaskId?: string;
}

export interface RepoProfile {
  repo: string;
  conventions: Array<{path: string; digest: string}>;
  buildRecipes: string[];
  testRecipes: string[];
  protectedBranches: string[];
  pastFixes: Array<{failureSignature: string; patchSummary: string; prUrl?: string}>;
  digest: string;
  privateRepo: boolean;
}

export interface DeveloperReport {
  goal: string;
  conclusion: string;
  changes: {summary: string; url?: string};
  verification: {commands: Array<{command: string; result: string}>; ciUrl?: string};
  risks: string[];
  cost: {currency: 'CNY'; amount: number; evidenceLevel: 'estimated'};
  compensations: Array<{id: string; label: string; available: boolean}>;
}

export interface SubagentControlPort {
  pause(parentTaskId: string, subtaskId: string): {phase: string; epoch: number; revision: number};
  resume(parentTaskId: string, subtaskId: string): {phase: string; epoch: number; revision: number};
  redirect(parentTaskId: string, subtaskId: string, instruction: string, expectedControlRevision: number): Promise<{phase: string; epoch: number; revision: number}>;
  stop(parentTaskId: string, subtaskId: string): {taskId: string; state: string};
  handoff?(parentTaskId: string, subtaskId: string): {phase: string; epoch: number; owner: 'user'};
  emergencyStop?(): unknown;
  list(): Array<Record<string, unknown>>;
}

export interface CompensationPort {
  deleteComment?(input: {repo: string; commentId: number}): Promise<{evidence: string}>;
  closePullRequest?(input: {repo: string; number: number}): Promise<{evidence: string}>;
}

const fail = (code: 'INVALID_ARGUMENT' | 'SCOPE_DENIED' | 'REVISION_CONFLICT' | 'UNSUPPORTED_CAPABILITY', message: string): never => {
  throw new ProtocolError(code, message);
};
const repoOk = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);

export function agentBranch(taskId: string, slug: string): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
  return `agent/${clean(taskId)}-${clean(slug)}`;
}

function runGit(args: readonly string[]): Promise<string> {
  const executable = args[0];
  if (!executable) return Promise.reject(new ProtocolError('INVALID_ARGUMENT', 'git argv is empty'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args.slice(1), {shell: false});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {stdout += String(chunk);});
    child.stderr.on('data', chunk => {stderr += String(chunk);});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new ProtocolError('EXTERNAL_FAILURE', stderr.trim() || `git exited ${code}`)));
  });
}

/** 固定 argv 调 git，不用 shell。调用方负责给出真实仓库路径。 */
export function createNodeGitWorkspace(): GitWorkspacePort {
  return {
    evidenceLevel: 'executed-local',
    async ensureWorktree(input) {
      await runGit(['git', '-C', input.repoPath, 'worktree', 'add', '-b', input.branch, input.path, input.baseSha]);
      return {baseSha: input.baseSha};
    },
    async removeWorktree(input) {
      await runGit(['git', '-C', input.repoPath, 'worktree', 'remove', '--force', input.path]);
    },
    async headSha(repoPath) {
      try {return await runGit(['git', '-C', repoPath, 'rev-parse', 'HEAD']);}
      catch {return 'unknown';}
    },
    async revertCommit(input) {
      const evidence = await runGit(['git', '-C', input.repoPath, 'revert', '--no-edit', input.sha]);
      return {evidence: evidence || input.sha};
    },
    async restoreBranch(input) {
      await runGit(['git', '-C', input.repoPath, 'branch', input.branch, input.sha]);
      return {evidence: `${input.branch}@${input.sha}`};
    },
  };
}

export function createMemoryGitWorkspace(): GitWorkspacePort & {calls: string[]} {
  const calls: string[] = [];
  return {
    evidenceLevel: 'fixture',
    calls,
    async ensureWorktree(input) {
      calls.push(`add ${input.branch} ${input.path}`);
      return {baseSha: input.baseSha};
    },
    async removeWorktree(input) {calls.push(`remove ${input.path}`);},
    async headSha() {return 'a'.repeat(40);},
    async revertCommit(input) {calls.push(`revert ${input.sha}`); return {evidence: `reverted ${input.sha}`};},
    async restoreBranch(input) {calls.push(`restore ${input.branch}`); return {evidence: input.branch};},
  };
}

export const COMPENSATION_CATALOG = [
  {id: 'revert_commit', label: '还原这次提交', toolName: 'git.revert'},
  {id: 'delete_comment', label: '删除这条评论', toolName: 'github.comment.delete'},
  {id: 'close_pr', label: '关闭这个 PR', toolName: 'github.pr.close'},
  {id: 'restore_branch', label: '恢复这个分支', toolName: 'git.branch.restore'},
] as const;

export function buildDeveloperReport(input: {
  goal: string;
  conclusion: string;
  changes: {summary: string; url?: string};
  verification: {commands: Array<{command: string; result: string}>; ciUrl?: string};
  risks: string[];
  cost: {currency: 'CNY'; amount: number; evidenceLevel: 'estimated'};
  compensations: DeveloperReport['compensations'];
}): DeveloperReport {
  return input;
}

export function renderPullRequestBody(report: DeveloperReport): string {
  const commands = report.verification.commands.map(item => `- \`${item.command}\`：${item.result}`).join('\n') || '- 无';
  const compensations = report.compensations.map(item => `- ${item.label}${item.available ? '' : '（当前端口不可用）'}`).join('\n');
  return ['## 目标', report.goal, '## 结论', report.conclusion, '## 改动', report.changes.url ? `${report.changes.summary}\n${report.changes.url}` : report.changes.summary,
    '## 验证', commands, report.verification.ciUrl ? `CI：${report.verification.ciUrl}` : 'CI：未绑定',
    '## 风险与未完成', report.risks.map(item => `- ${item}`).join('\n') || '- 无',
    '## 成本', `${report.cost.amount} ${report.cost.currency}（${report.cost.evidenceLevel}，不是平台账单）`,
    '## 可撤销动作', compensations || '- 无'].join('\n\n');
}

export function renderPeriodReport(input: {period: 'daily' | 'weekly'; pulls: string[]; reviews: string[]; failing: string[]; actions: string[]}): string {
  const section = (title: string, rows: string[]) => `## ${title}\n${rows.length ? rows.map(item => `- ${item}`).join('\n') : '- 无'}`;
  return [`# 开发者${input.period === 'daily' ? '日报' : '周报'}`, section('我的 PR', input.pulls), section('待我评审', input.reviews), section('失败 CI', input.failing), section('智能体做了什么', input.actions)].join('\n\n');
}

export function developerWizardSteps(): Array<{id: string; title: string; fields: string[]}> {
  return [
    {id: 'github', title: '连接 GitHub', fields: ['credentialRef']},
    {id: 'repo', title: '选择仓库', fields: ['repo']},
    {id: 'profile', title: '生成仓库画像', fields: ['files']},
    {id: 'autonomy', title: '选择自主级别', fields: ['level', 'branchPattern']},
    {id: 'runner', title: '可选登记远端执行器', fields: ['runnerId']},
  ];
}

function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildRepoProfile(input: {repo: string; files: ReadonlyArray<{path: string; text: string}>; privateRepo?: boolean}): RepoProfile {
  if (!repoOk(input.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
  const conventions = input.files.filter(file => /(^|\/)(AGENTS|CONTRIBUTING)\.md$/i.test(file.path) || file.path.endsWith('ARCHITECTURE.md'))
    .map(file => ({path: file.path, digest: digestText(file.text)}));
  const packageJson = input.files.find(file => file.path.endsWith('package.json'));
  let scripts: Record<string, string> = {};
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson.text) as {scripts?: Record<string, string>};
      scripts = parsed.scripts ?? {};
    } catch {scripts = {};}
  }
  const buildRecipes = Object.keys(scripts).filter(name => /build|compile/.test(name));
  const testRecipes = Object.keys(scripts).filter(name => /test|check/.test(name));
  const protectedBranches = ['main', 'master'];
  const digest = digestText(JSON.stringify({conventions, buildRecipes, testRecipes}));
  return {repo: input.repo, conventions, buildRecipes, testRecipes, protectedBranches, pastFixes: [], digest, privateRepo: input.privateRepo === true};
}

export function profilePrompt(profile: RepoProfile, experienceRecipes: readonly string[] = []): string {
  const files = profile.conventions.map(item => wrapUntrusted({source: 'repo-profile', uri: `${profile.repo}:${item.path}`, text: `${item.path} digest ${item.digest}`}));
  const recipes = experienceRecipes.length ? `\n已确认的开发经验配方：${experienceRecipes.join(', ')}` : '';
  return `${renderUntrustedPrompt(files)}${recipes}`;
}

/** 工具循环用。没有仓库，或该仓库没有常驻授权时返回 undefined，调用方保持逐次授权。 */
export function standingDecisionForTool(session: {decide(input: {repo: string; branch: string; toolName: string; action?: string; sideEffect?: 'read' | 'local_write' | 'external_write'; args?: unknown}): {allow: boolean; mode: 'deny' | 'suggest' | 'auto'; risk: 'read' | 'reversible_write' | 'irreversible' | 'privileged'; reason: string; audit: {reversibleClass: string}}}, input: {toolName: string; sideEffect: 'read' | 'local_write' | 'external_write'; arguments: unknown}): {allow: boolean; mode: 'deny' | 'suggest' | 'auto'; risk: 'read' | 'reversible_write' | 'irreversible' | 'privileged'; reason: string; audit: {reversibleClass: string}} | undefined {
  const args = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments) ? input.arguments as Record<string, unknown> : {};
  const repo = typeof args.repo === 'string' ? args.repo : typeof args.repository === 'string' ? args.repository : undefined;
  if (!repo) return undefined;
  const branch = typeof args.branch === 'string' ? args.branch : '*';
  const action = typeof args.action === 'string' ? args.action : undefined;
  const decision = session.decide({repo, branch, toolName: input.toolName, sideEffect: input.sideEffect, ...(action ? {action} : {}), args});
  if (decision.reason === 'repository has no standing grant' || decision.reason === 'standing grant does not cover this call') return undefined;
  return {allow: decision.allow, mode: decision.mode, risk: decision.risk, reason: decision.reason, audit: {reversibleClass: decision.audit.reversibleClass}};
}

const ESTIMATED_PRICE: ModelPriceCard = {model: 'estimated-default', currency: 'CNY', inputPerMillion: 1, outputPerMillion: 2};

export interface DeveloperDirectionSession {
  enroll(input: {repo: string; branchPattern?: string; level?: AutonomyLevel; credentialRef?: string}): StandingAutonomyGrant;
  setAutonomy(input: {repo: string; level: AutonomyLevel; present: boolean}): StandingAutonomyGrant;
  decide(input: {repo: string; branch: string; toolName: string; action?: string; sideEffect?: 'read' | 'local_write' | 'external_write'; args?: unknown; contents?: readonly UntrustedContent[]}): AutonomyDecision;
  emergencyStop(reason: string): {revoked: number; paused: number};
  submitGoal(input: {sentence: string; repo?: string; pullRequest?: number; issue?: number; branch?: string; doneWhen?: string; deadline?: string; budget?: number; parentTaskId?: string; subtaskId?: string}): DeveloperGoal;
  addDuty(input: {sentence: string; repo: string; branch?: string; conclusion?: string}): {goal: DeveloperGoal; rule: TriggerRule};
  routeEvent(event: TriggerEvent): Promise<{status: string; goal?: DeveloperGoal; superseded?: string}>;
  board(): Array<Record<string, unknown>>;
  pause(goalId: string): Promise<DeveloperGoal>;
  resume(goalId: string): Promise<DeveloperGoal>;
  redirect(goalId: string, instruction: string): Promise<DeveloperGoal>;
  handoff(goalId: string): Promise<DeveloperGoal>;
  stop(goalId: string): Promise<DeveloperGoal>;
  openLease(input: {repo: string; repoPath: string; baseSha: string; taskId: string; slug: string; epoch: number; ttlMs?: number}): Promise<WorkspaceLease>;
  releaseLease(taskId: string): Promise<void>;
  acquireLock(input: {repo: string; ref: string; taskId: string; mode: 'read' | 'write'; epoch: number; ttlMs?: number}): {status: 'acquired' | 'queued' | 'joined'; lock?: RepoLock; holderTaskId?: string};
  releaseLock(taskId: string, ref?: string): void;
  renewLock(taskId: string, ref: string): RepoLock;
  noteHumanPush(input: {repoPath: string; taskId: string}): Promise<{yielded: boolean; head: string | 'unknown'}>;
  reserveCost(input: {taskId: string; repo: string; model?: string; tokens: {input: number; output: number}}): {action: string; estimated: number; evidenceLevel: 'estimated'};
  settleCost(input: {reservationId: string; actual: number}): {currency: 'CNY'; amount: number; evidenceLevel: 'estimated'};
  rememberProfile(profile: RepoProfile): RepoProfile;
  rememberFix(repo: string, fix: {failureSignature: string; patchSummary: string; prUrl?: string}): RepoProfile;
  profileFor(repo: string): RepoProfile | undefined;
  repair(input: {repo: string; number: number; signal: Parameters<typeof stepCiLoop>[1]; headSha?: string; maxRounds?: number}): CiLoopState;
  executeRepoJob(input: {repo: string; repoPath: string; baseSha: string; taskId: string; recipeIds: string[]; slug: string}): Promise<{evidenceLevel: 'fixture' | 'executed-local'; diffSummary: string; testReport: string; artifactSummary: string; heartbeats: number; leaseExtended: boolean}>;
  checkApiDrift(input: {implemented: readonly string[]; documented: readonly string[]}): ReturnType<typeof detectApiDocDrift>;
  scanKnowledge(input: {repo: string; root: string; policy?: Partial<KnowledgeScanPolicy>}): {index: KnowledgeIndex; drift: ReturnType<typeof knowledgeDrift>; profile: RepoProfile};
  compensate(input: {action: (typeof COMPENSATION_CATALOG)[number]['id']; repo?: string; repoPath?: string; sha?: string; commentId?: number; number?: number; branch?: string}): Promise<{available: boolean; evidence?: string; reason: string}>;
  report(goalId: string, extra?: {risks?: string[]; commands?: Array<{command: string; result: string}>; ciUrl?: string; url?: string}): DeveloperReport;
  periodReport(input: {period: 'daily' | 'weekly'; pulls?: string[]; reviews?: string[]; failing?: string[]}): string;
  notify(input: {repo: string; kind: DeveloperNoticeKind; summary: string; evidenceRef?: string}): Promise<{delivered: boolean}>;
  taskContext(repo: string): string;
  completeModel(request: ModelRequest): Promise<{result: ModelResult; downgraded: boolean}>;
  subscribe(repo: string, classes: readonly DeveloperNoticeClass[]): void;
  timeline(): DeveloperDeliveryState['timeline'];
  applyWizard(input: {repo: string; credentialRef: string; files: ReadonlyArray<{path: string; text: string}>; level?: AutonomyLevel; branchPattern?: string; present?: boolean; runnerId?: string}): {profile: RepoProfile; grant: StandingAutonomyGrant; runnerId?: string; evidenceLevel: 'fixture'};
  listCompensations(): Array<{id: string; label: string; available: boolean}>;
  snapshot(): Record<string, unknown>;
}

export function createDeveloperDirectionSession(options: {
  now?: () => number;
  git?: GitWorkspacePort;
  runRecipe?: (input: {recipeId: string; cwd: string}) => Promise<{exitCode: number; output: string}>;
  channel?: DesktopNoticeChannel;
  prices?: readonly ModelPriceCard[];
  subagentControl?: SubagentControlPort;
  prepareDependencies?: (path: string) => Promise<void>;
  compensation?: CompensationPort;
  maxConcurrent?: number;
  /** 只有同时给出备用网关时，超支才会改走备用模型。缺省仍暂停，不改模型。 */
  modelDowngrade?: {primary: ModelGateway; fallback: ModelGateway};
  readExperienceRecipes?: (repo: string) => readonly string[];
} = {}): DeveloperDirectionSession {
  const now = options.now ?? Date.now;
  const prices = options.prices ?? [ESTIMATED_PRICE];
  const channel = options.channel ?? {name: 'desktop', async send() {return {accepted: false, reason: 'no desktop channel configured'};}};
  let grants: StandingAutonomyGrant[] = [];
  let goals: DeveloperGoal[] = [];
  let rules: TriggerRule[] = [];
  let triggers: TriggerState = emptyTriggerState();
  let leases: WorkspaceLease[] = [];
  let locks: RepoLock[] = [];
  let profiles: RepoProfile[] = [];
  const knowledge = new Map<string, KnowledgeIndex>();
  let loops: CiLoopState[] = [];
  let budget: BudgetState = {reservations: []};
  let delivery: DeveloperDeliveryState = emptyDeveloperDelivery();
  let stopped = false;
  let activeJobs = 0;
  const waiters: Array<() => void> = [];
  const maxConcurrent = options.maxConcurrent ?? 2;
  const contents = new Map<string, UntrustedContent[]>();
  const reservationOf = new Map<string, string>();
  let downgradeModel = false;

  const goalOf = (id: string): DeveloperGoal => {
    const goal = goals.find(item => item.id === id);
    if (!goal) return fail('INVALID_ARGUMENT', 'Developer goal does not exist');
    return goal;
  };
  const revise = (goal: DeveloperGoal, patch: {status: DeveloperGoal['status']; step: string; controlRevision: number; nextGate?: string; headSha?: string}): DeveloperGoal => ({
    ...goal, ...patch, ...(patch.nextGate === undefined ? {} : {nextGate: patch.nextGate}), ...(patch.headSha === undefined ? {} : {headSha: patch.headSha}),
  }) as DeveloperGoal;
  const replaceGoal = (goal: DeveloperGoal) => {goals = goals.map(item => item.id === goal.id ? goal : item);};
  const grantFor = (repo: string) => grants.find(item => item.scope.repo === repo && !item.revoked);
    const control = async (goal: DeveloperGoal, method: 'pause' | 'resume' | 'redirect' | 'stop' | 'handoff', instruction?: string) => {
    const port = options.subagentControl;
    if (!port || !goal.parentTaskId || !goal.subtaskId) return;
    if (method === 'pause') port.pause(goal.parentTaskId, goal.subtaskId);
    else if (method === 'resume') port.resume(goal.parentTaskId, goal.subtaskId);
    else if (method === 'stop') port.stop(goal.parentTaskId, goal.subtaskId);
    else if (method === 'handoff') port.handoff?.(goal.parentTaskId, goal.subtaskId);
    else if (instruction !== undefined) await port.redirect(goal.parentTaskId, goal.subtaskId, instruction, goal.controlRevision);
  };

  return {
    enroll(input) {
      if (!repoOk(input.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
      if (input.credentialRef && /ghp_|github_pat_|gho_|Bearer\s+/i.test(input.credentialRef)) fail('SCOPE_DENIED', 'Credential material cannot enter the developer scope');
      const level = input.level ?? ENROLLED_AUTONOMY_LEVEL;
      const grant = createStandingGrant({id: `autonomy:${input.repo}`, scope: {repo: input.repo, branchPattern: input.branchPattern ?? '*', toolNames: []}, level, limits: {perDay: 200, perHour: 40}, expiresAt: new Date(now() + 30 * 24 * 3600_000).toISOString(), now: now()});
      grants = [...grants.filter(item => item.scope.repo !== input.repo), grant];
      return grant;
    },
    setAutonomy(input) {
      const current = grantFor(input.repo);
      const from = current?.level ?? UNCONFIGURED_AUTONOMY_LEVEL;
      assertAutonomyChange({from, to: input.level, present: input.present});
      if (!current) return this.enroll({repo: input.repo, level: input.level});
      const next = {...current, level: input.level};
      grants = grants.map(item => item.id === current.id ? next : item);
      return next;
    },
    decide(input) {
      if (stopped) return {allow: false, mode: 'deny', level: UNCONFIGURED_AUTONOMY_LEVEL, risk: 'privileged', reason: 'emergency stop revoked standing grants', audit: {reversibleClass: input.toolName}};
      const grant = grantFor(input.repo);
      const stored = contents.get(input.repo) ?? [];
      const untrustedDerived = argumentsDerivedFromUntrusted(input.args ?? {}, [...stored, ...(input.contents ?? [])]);
      const decision = decideAutonomy({...(grant ? {grant} : {}), toolName: input.toolName, ...(input.action === undefined ? {} : {action: input.action}), ...(input.sideEffect === undefined ? {} : {sideEffect: input.sideEffect}), repo: input.repo, branch: input.branch, now: now(), untrustedDerived});
      if (decision.allow && decision.mode === 'auto' && grant && decision.risk !== 'read') {
        const consumed = consumeAutonomyUse(grant, now());
        grants = grants.map(item => item.id === grant.id ? consumed : item);
      }
      if (input.contents?.length) contents.set(input.repo, [...stored, ...input.contents].slice(-20));
      return decision;
    },
    emergencyStop(reason) {
      const revoked = grants.filter(item => !item.revoked).length;
      grants = grants.map(revokeStandingGrant);
      let paused = 0;
      for (const goal of goals) {
        if (goal.status === 'open') {replaceGoal(revise(goal, {status: 'paused', step: reason, controlRevision: goal.controlRevision, nextGate: 'emergency stop'})); paused += 1;}
      }
      locks = [];
      stopped = true;
      options.subagentControl?.emergencyStop?.();
      return {revoked, paused};
    },
    submitGoal(input) {
      if (!input.sentence.trim() || input.sentence.length > 4000) fail('INVALID_ARGUMENT', 'Goal sentence is invalid');
      if (input.repo && !repoOk(input.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
      const goal: DeveloperGoal = {id: `goal-${goals.length + 1}-${randomUUID().slice(0, 8)}`, sentence: input.sentence.trim(), status: 'open', step: 'accepted', controlRevision: 0,
        ...(input.repo ? {repo: input.repo} : {}), ...(input.pullRequest === undefined ? {} : {pullRequest: input.pullRequest}),
        ...(input.issue === undefined ? {} : {issue: input.issue}), ...(input.branch ? {branch: input.branch} : {}),
        ...(input.doneWhen ? {doneWhen: input.doneWhen} : {}), ...(input.deadline ? {deadline: input.deadline} : {}),
        ...(input.budget === undefined ? {} : {budget: input.budget}), ...(input.parentTaskId ? {parentTaskId: input.parentTaskId} : {}),
        ...(input.subtaskId ? {subtaskId: input.subtaskId} : {})};
      goals = [...goals, goal];
      return goal;
    },
    addDuty(input) {
      const goal = this.submitGoal({sentence: input.sentence, repo: input.repo, ...(input.branch ? {branch: input.branch} : {})});
      const rule: TriggerRule = {id: `duty-${goal.id}`, source: 'check_run', match: {repo: input.repo, ...(input.branch ? {branch: input.branch} : {}), conclusion: input.conclusion ?? 'failure'}, action: {workflow: 'ci_fix'}, cooldownMs: 60_000, maxConcurrentPerRepo: 1};
      rules = [...rules, rule];
      return {goal, rule};
    },
    async routeEvent(event) {
      if (event.gap) return {status: 'gap'};
      const route = routeTrigger(rules, event, triggers, now());
      if (route.status !== 'spawn' || !route.dedupeKey || !route.ruleId || !route.workflow) return {status: route.status};
      const goal = this.submitGoal({sentence: `${route.workflow} ${event.repo}${event.number ? `#${event.number}` : ''}`, repo: event.repo, ...(event.number === undefined ? {} : {pullRequest: event.number}), ...(event.branch ? {branch: event.branch} : {}), ...(event.headSha ? {} : {})});
      const stored = revise(goal, {status: 'open', step: route.workflow, controlRevision: goal.controlRevision, ...(event.headSha ? {headSha: event.headSha} : {}), ...(route.supersededTaskId ? {nextGate: `supersedes ${route.supersededTaskId}`} : {})});
      replaceGoal(stored);
      triggers = rememberTrigger(triggers, {dedupeKey: route.dedupeKey, taskId: stored.id, at: now(), ruleId: route.ruleId, ...(event.headSha ? {headSha: event.headSha} : {})});
      if (route.supersededTaskId) {
        const previous = goals.find(item => item.id === route.supersededTaskId && item.status === 'open');
        if (previous) replaceGoal(revise(previous, {status: 'stopped', step: 'head changed', controlRevision: previous.controlRevision + 1}));
      }
      return {status: 'spawn', goal: stored, ...(route.supersededTaskId ? {superseded: route.supersededTaskId} : {})};
    },
    board() {
      const listed = options.subagentControl?.list() ?? [];
      return [...goals.map(goal => ({kind: 'goal', ...goal, cost: budgetSpent(budget, goal.repo ?? goal.id), evidenceLevel: 'fixture' as const})),
        ...listed.map(item => ({kind: 'subagent', ...item}))];
    },
    async pause(goalId) {
      const goal = goalOf(goalId);
      if (goal.status !== 'open') fail('REVISION_CONFLICT', 'Only an open goal can pause');
      await control(goal, 'pause');
      const next = revise(goal, {status: 'paused', step: 'paused', controlRevision: goal.controlRevision + 1});
      replaceGoal(next);
      return next;
    },
    async resume(goalId) {
      const goal = goalOf(goalId);
      if (goal.status !== 'paused' && goal.status !== 'handed_off') fail('REVISION_CONFLICT', 'Goal is not paused');
      await control(goal, 'resume');
      const next = revise(goal, {status: 'open', step: 'running', controlRevision: goal.controlRevision + 1});
      replaceGoal(next);
      return next;
    },
    async redirect(goalId, instruction) {
      const goal = goalOf(goalId);
      if (!instruction.trim()) fail('INVALID_ARGUMENT', 'Redirect instruction is empty');
      if (goal.status === 'done' || goal.status === 'stopped') fail('REVISION_CONFLICT', 'Finished goal cannot be redirected');
      await control(goal, 'redirect', instruction.trim());
      const next = revise(goal, {status: 'open', step: instruction.trim(), controlRevision: goal.controlRevision + 1});
      replaceGoal(next);
      return next;
    },
    async handoff(goalId) {
      const goal = goalOf(goalId);
      await control(goal, 'handoff');
      const next = revise(goal, {status: 'handed_off', step: 'user owns the worktree', controlRevision: goal.controlRevision + 1});
      replaceGoal(next);
      leases = leases.map(item => item.ownerTaskId === goal.id || item.ownerTaskId === goal.taskId ? {...item, status: 'handed_off'} : item);
      return next;
    },
    async stop(goalId) {
      const goal = goalOf(goalId);
      await control(goal, 'stop');
      const next = revise(goal, {status: 'stopped', step: 'stopped', controlRevision: goal.controlRevision + 1});
      replaceGoal(next);
      triggers = goal.repo ? finishTrigger(triggers, goal.repo) : triggers;
      return next;
    },
    async openLease(input) {
      const git = options.git;
      if (!git) return fail('UNSUPPORTED_CAPABILITY', 'Git workspace port is not configured');
      const branch = agentBranch(input.taskId, input.slug);
      const same = leases.find(item => item.repo === input.repo && item.branch === branch && item.status === 'active');
      if (same && same.ownerTaskId !== input.taskId) fail('REVISION_CONFLICT', 'That branch lease is already held');
      const path = `${input.repoPath.replace(/\/$/, '')}-worktrees/${branch.replace(/\//g, '-')}`;
      const created = await git.ensureWorktree({repoPath: input.repoPath, baseSha: input.baseSha, branch, path});
      if (options.prepareDependencies) await options.prepareDependencies(path);
      const lease: WorkspaceLease = {repo: input.repo, repoPath: input.repoPath, baseSha: created.baseSha, branch, path, ownerTaskId: input.taskId, executionEpoch: input.epoch, expiresAt: now() + (input.ttlMs ?? 3_600_000), status: 'active'};
      leases = [...leases.filter(item => item.ownerTaskId !== input.taskId), lease];
      return lease;
    },
    async releaseLease(taskId) {
      const lease = leases.find(item => item.ownerTaskId === taskId && item.status !== 'released');
      if (!lease || !options.git) return;
      await options.git.removeWorktree({repoPath: lease.repoPath, path: lease.path});
      leases = leases.map(item => item.ownerTaskId === taskId ? {...item, status: 'released'} : item);
    },
    acquireLock(input) {
      const owned = locks.find(item => item.holderTaskId === input.taskId && item.mode === 'write' && item.ref !== input.ref && item.expiresAt > now());
      if (owned) fail('REVISION_CONFLICT', 'A task may hold only one write lock');
      locks = locks.filter(item => item.expiresAt > now());
      const current = locks.find(item => item.repo === input.repo && item.ref === input.ref);
      if (current && current.holderTaskId !== input.taskId && (current.mode === 'write' || input.mode === 'write')) {
        return input.ref.startsWith('pr:') ? {status: 'joined', holderTaskId: current.holderTaskId} : {status: 'queued', holderTaskId: current.holderTaskId};
      }
      const lock: RepoLock = {repo: input.repo, ref: input.ref, holderTaskId: input.taskId, mode: input.mode, epoch: input.epoch, heartbeatAt: now(), expiresAt: now() + (input.ttlMs ?? 60_000)};
      locks = [...locks.filter(item => !(item.repo === input.repo && item.ref === input.ref && item.holderTaskId === input.taskId)), lock];
      return {status: 'acquired', lock};
    },
    releaseLock(taskId, ref) {locks = locks.filter(item => item.holderTaskId !== taskId || (ref !== undefined && item.ref !== ref));},
    renewLock(taskId, ref) {
      const lock = locks.find(item => item.holderTaskId === taskId && item.ref === ref);
      if (!lock) fail('REVISION_CONFLICT', 'Lock is not held');
      const next = {...lock, heartbeatAt: now(), expiresAt: now() + 60_000} as RepoLock;
      locks = locks.map(item => item === lock ? next : item);
      return next;
    },
    async noteHumanPush(input) {
      const lease = leases.find(item => item.ownerTaskId === input.taskId && item.status === 'active');
      if (!lease || !options.git) return {yielded: false, head: 'unknown' as const};
      const head = await options.git.headSha(input.repoPath);
      if (head === 'unknown' || head === lease.baseSha) return {yielded: false, head};
      leases = leases.map(item => item === lease ? {...item, status: 'yielded'} : item);
      locks = locks.filter(item => item.holderTaskId !== input.taskId);
      return {yielded: true, head};
    },
    reserveCost(input) {
      const price = prices.find(item => item.model === input.model) ?? ESTIMATED_PRICE;
      const estimated = estimateCost(price, input.tokens);
      const goalBudget = goals.find(item => item.id === input.taskId)?.budget;
      const perTask = goalBudget ?? 20;
      const policy = {scope: 'repo' as const, scopeId: input.repo || input.taskId, currency: 'CNY' as const, daily: Math.max(100, perTask), perTask, onExceed: options.modelDowngrade ? 'downgrade_model' as const : 'pause' as const};
      const id = `cost-${budget.reservations.length + 1}`;
      const result = reserveBudget(budget, policy, {id, taskId: input.taskId, model: price.model, estimated, now: now()});
      budget = result.state;
      if (result.reservation) reservationOf.set(input.taskId, result.reservation.id);
      if (result.decision.action === 'downgrade_model') downgradeModel = true;
      if (result.decision.action === 'pause') {
        const goal = goals.find(item => item.id === input.taskId || item.taskId === input.taskId);
        if (goal && goal.status === 'open') replaceGoal(revise(goal, {status: 'paused', step: 'budget exceeded', controlRevision: goal.controlRevision, nextGate: 'budget'}));
      }
      return {action: result.decision.action, estimated: result.decision.estimated, evidenceLevel: 'estimated'};
    },
    settleCost(input) {
      budget = settleBudget(budget, {id: input.reservationId, actual: input.actual});
      const reservation = budget.reservations.find(item => item.id === input.reservationId);
      return budgetSpent(budget, reservation?.scopeId ?? '');
    },
    rememberProfile(profile) {
      if (profile.privateRepo) contents.set(profile.repo, [wrapUntrusted({source: 'repo-profile', uri: profile.repo, text: 'private repository profile stays on this machine'})]);
      profiles = [...profiles.filter(item => item.repo !== profile.repo), profile];
      return profile;
    },
    rememberFix(repo, fix) {
      const profile = profiles.find(item => item.repo === repo) ?? buildRepoProfile({repo, files: []});
      const next = {...profile, pastFixes: [...profile.pastFixes, fix]};
      return this.rememberProfile(next);
    },
    profileFor(repo) {return profiles.find(item => item.repo === repo);},
    repair(input) {
      let loop = loops.find(item => item.repo === input.repo && item.number === input.number);
      if (!loop) loop = initialCiLoop({repo: input.repo, number: input.number, maxRounds: input.maxRounds ?? 3});
      const next = stepCiLoop(loop, input.signal, input.headSha);
      loops = [...loops.filter(item => !(item.repo === input.repo && item.number === input.number)), next];
      return next;
    },
    async executeRepoJob(input) {
      const git = options.git;
      const runRecipe = options.runRecipe;
      if (!git || !runRecipe) return fail('UNSUPPORTED_CAPABILITY', 'Repo task needs a git port and a recipe runner');
      if (activeJobs >= maxConcurrent) await new Promise<void>(resolve => waiters.push(resolve));
      activeJobs += 1;
      let heartbeats = 0;
      const heartbeat = () => {heartbeats += 1;};
      try {
        const lease = await this.openLease({repo: input.repo, repoPath: input.repoPath, baseSha: input.baseSha, taskId: input.taskId, slug: input.slug, epoch: 1, ttlMs: 120_000});
        heartbeat();
        const reports: string[] = [];
        for (const recipeId of input.recipeIds) {
          const result = await runRecipe({recipeId, cwd: lease.path});
          reports.push(`${recipeId} exit ${result.exitCode}: ${result.output.slice(0, 500)}`);
          heartbeat();
        }
        return {evidenceLevel: git.evidenceLevel, diffSummary: `worktree ${lease.branch} at ${lease.baseSha}`, testReport: reports.join('\n'), artifactSummary: `${reports.length} recipe receipts`, heartbeats, leaseExtended: heartbeats > 0};
      } finally {
        await this.releaseLease(input.taskId);
        activeJobs -= 1;
        waiters.shift()?.();
      }
    },
    checkApiDrift(input) {return detectApiDocDrift(input);},
    scanKnowledge(input) {
      if (!repoOk(input.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
      const previous = knowledge.get(input.repo);
      const index = scanKnowledgeDirectory({repo: input.repo, root: input.root, ...(previous ? {previous} : {}), ...(input.policy ? {policy: input.policy} : {})});
      knowledge.set(input.repo, index);
      const prior = profiles.find(item => item.repo === input.repo);
      return {index, drift: knowledgeDrift(index), profile: this.rememberProfile({
        repo: index.repo,
        conventions: index.files.filter(file => file.convention).map(file => ({path: file.path, digest: file.digest})),
        buildRecipes: [...index.buildRecipes],
        testRecipes: [...index.testRecipes],
        protectedBranches: prior?.protectedBranches ?? ['main', 'master'],
        pastFixes: prior?.pastFixes ?? [],
        digest: index.digest,
        privateRepo: prior?.privateRepo ?? false,
      })};
    },
    async compensate(input) {
      const known = COMPENSATION_CATALOG.find(item => item.id === input.action);
      if (!known) fail('INVALID_ARGUMENT', 'Compensation is unknown');
      if (input.action === 'revert_commit' && options.git?.revertCommit && input.repoPath && input.sha) {
        const result = await options.git.revertCommit({repoPath: input.repoPath, sha: input.sha});
        return {available: true, evidence: result.evidence, reason: 'git port reverted the commit'};
      }
      if (input.action === 'restore_branch' && options.git?.restoreBranch && input.repoPath && input.branch && input.sha) {
        const result = await options.git.restoreBranch({repoPath: input.repoPath, branch: input.branch, sha: input.sha});
        return {available: true, evidence: result.evidence, reason: 'git port restored the branch'};
      }
      if (input.action === 'delete_comment' && options.compensation?.deleteComment && input.repo && input.commentId) {
        const result = await options.compensation.deleteComment({repo: input.repo, commentId: input.commentId});
        return {available: true, evidence: result.evidence, reason: 'comment port deleted the comment'};
      }
      if (input.action === 'close_pr' && options.compensation?.closePullRequest && input.repo && input.number) {
        const result = await options.compensation.closePullRequest({repo: input.repo, number: input.number});
        return {available: true, evidence: result.evidence, reason: 'pull request port closed the pull request'};
      }
      return {available: false, reason: 'compensation port is not configured; nothing was sent'};
    },
    report(goalId, extra) {
      const goal = goalOf(goalId);
      const cost = budgetSpent(budget, goal.repo ?? goal.id);
      return buildDeveloperReport({
        goal: goal.sentence,
        conclusion: goal.step,
        changes: {summary: goal.headSha ? `绑定 ${goal.headSha}` : '没有代码差异回执', ...(extra?.url ? {url: extra.url} : {})},
        verification: {commands: extra?.commands ?? [], ...(extra?.ciUrl ? {ciUrl: extra.ciUrl} : {})},
        risks: extra?.risks ?? ['未做真实 GitHub 或远端机器验收'],
        cost,
        compensations: this.listCompensations(),
      });
    },
    periodReport(input) {
      return renderPeriodReport({period: input.period, pulls: input.pulls ?? [], reviews: input.reviews ?? [], failing: input.failing ?? [], actions: goals.map(goal => `${goal.sentence}：${goal.step}`)});
    },
    taskContext(repo) {
      const profile = profiles.find(item => item.repo === repo);
      const recipes = options.readExperienceRecipes?.(repo) ?? [];
      if (!profile) return recipes.length ? `已确认的开发经验配方：${recipes.join(', ')}` : '';
      return profilePrompt(profile, recipes);
    },
    async completeModel(request) {
      if (!options.modelDowngrade) return fail('UNSUPPORTED_CAPABILITY', 'Model downgrade is not configured; the original gateway stays in use');
      const gateway = selectDeveloperModelGateway({primary: options.modelDowngrade.primary, fallback: options.modelDowngrade.fallback, downgrade: downgradeModel});
      const result = await gateway.complete(request);
      return {result, downgraded: downgradeModel};
    },
    async notify(input) {
      const accepted = await acceptDeveloperNotice(delivery, {id: randomUUID(), repo: input.repo, kind: input.kind, summary: input.summary, at: new Date(now()).toISOString(), ...(input.evidenceRef ? {evidenceRef: input.evidenceRef} : {})}, {now: now(), channel});
      delivery = accepted.state;
      return {delivered: accepted.delivered};
    },
    subscribe(repo, classes) {delivery = setDeveloperSubscription(delivery, {repo, classes});},
    timeline() {return delivery.timeline;},
    applyWizard(input) {
      if (!input.credentialRef.trim()) fail('INVALID_ARGUMENT', 'Wizard needs a credential reference, not a token');
      const profile = this.rememberProfile(buildRepoProfile({repo: input.repo, files: input.files}));
      const level = input.level ?? ENROLLED_AUTONOMY_LEVEL;
      const existing = grants.find(item => item.scope.repo === input.repo && !item.revoked);
      if (existing) assertAutonomyChange({from: existing.level, to: level, present: input.present === true});
      else if (level !== ENROLLED_AUTONOMY_LEVEL) assertAutonomyChange({from: UNCONFIGURED_AUTONOMY_LEVEL, to: level, present: input.present === true});
      const grant = this.enroll({repo: input.repo, ...(input.branchPattern ? {branchPattern: input.branchPattern} : {}), level, credentialRef: input.credentialRef});
      return {profile, grant, ...(input.runnerId ? {runnerId: input.runnerId} : {}), evidenceLevel: 'fixture' as const};
    },
    listCompensations() {
      return COMPENSATION_CATALOG.map(item => ({id: item.id, label: item.label,
        available: item.id === 'revert_commit' ? Boolean(options.git?.revertCommit)
          : item.id === 'restore_branch' ? Boolean(options.git?.restoreBranch)
            : item.id === 'delete_comment' ? Boolean(options.compensation?.deleteComment)
              : Boolean(options.compensation?.closePullRequest)}));
    },
    snapshot() {
      return {stopped, goals, grants: grants.map(item => ({id: item.id, repo: item.scope.repo, level: item.level, revoked: item.revoked})), leases, locks, profiles: profiles.map(item => ({repo: item.repo, digest: item.digest, pastFixes: item.pastFixes.length, privateRepo: item.privateRepo})), loops, budget: budgetSpent(budget, goals[0]?.repo ?? ''), timeline: delivery.timeline, evidenceLevel: 'fixture'};
    },
  };
}
