import {isDeepStrictEqual} from 'node:util';
import {realpathSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, TaskSnapshot, ToolContext} from '@personal-agent/contracts';
import {RuntimeToolInvoker} from '@personal-agent/agents';
import type {AgentToolPort, AgentWorkerContext} from '@personal-agent/agents';
import {ModelGateway} from '@personal-agent/models';
import type {ModelProvider} from '@personal-agent/models';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createCiFixWorkflow, createCiRunDiscoveryWorkflow, createWorkspaceReadTool, createWorkspacePatchApplyTool, createWorkspacePatchPreviewTool,
  reconcileWorkspacePatchApply,
  createWorkspaceCommandTool, createGitTools, readGitWorkspaceFingerprint} from '@personal-agent/coding-tools';
import type {CiFixOptions, CiRunListRequest, WorkspaceReadOptions, WorkspacePatchApplyHostOptions,
  WorkspaceCommandOptions, GitToolsOptions, GitVerificationReceipt} from '@personal-agent/coding-tools';
import {register as registerGitHub, registerGitHubRepairLinks} from '@personal-agent/github';
import type {GitHubProvider, GitHubInputs, GitHubRepairIdentity} from '@personal-agent/github';
import {createCodeReviewWorkflow, createIssueTriageWorkflow} from '@personal-agent/cognition';
import type {CodeReviewInput, CodeReviewReport, IssueListRequest, IssueTriageRequest, IssueTriageOptions} from '@personal-agent/cognition';
import {TaskRuntime} from './index.js';
import {DevWorkflowPatchRecovery} from './dev-workflows-patch-reconciliation.js';
import type {DevWorkflowPatchReadback} from './dev-workflows-patch-reconciliation.js';
import type {WorkspacePatchReconciliationPort} from './application/workspace-patch-reconciliation.js';
export type {DevWorkflowPatchReadback} from './dev-workflows-patch-reconciliation.js';

export type DevWorkflowRequest =
  | {kind: 'ci_fix'; repository: string; runId: string}
  | {kind: 'ci_list'; input: CiRunListRequest}
  | {kind: 'ci_link_readback'; input: GitHubInputs['actions.repair.get']}
  | {kind: 'code_review'; input: CodeReviewInput; publish?: boolean}
  | {kind: 'issue_list'; input: IssueListRequest}
  | {kind: 'issue_triage'; input: IssueTriageRequest};

export interface DevWorkflowsRuntimeOptions {
  path: string;
  /** Explicit production or Fake provider, always wrapped in ModelGateway. */
  model: ModelProvider;
  /** Trusted host registrations, including GitHub and permitted workspace/Git tools. */
  tools?: readonly RegisteredTool[];
  github?: GitHubProvider;
  /** Explicit opt-in source-SHA repair association; requires separate Checks write permission. */
  githubRepairLinks?: boolean;
  workspace?: {read: WorkspaceReadOptions; patch: WorkspacePatchApplyHostOptions; command: WorkspaceCommandOptions};
  /** Trusted host can supply its pinned marker/ACL adapter; never accepted from workflow requests. */
  workspacePatchReconciliation?: WorkspacePatchReconciliationPort;
  git?: Omit<GitToolsOptions, 'readVerification'>;
  /** Trusted host maps an issue to an existing failed CI run; issue text cannot select credentials or commands. */
  failedRunForIssue?: (repo: string, number: number) => string | undefined;
  ciFix?: Omit<CiFixOptions, 'repository' | 'runId' | 'model' | 'tools' | 'authorizationRefFor'>;
  issueTriage?: Pick<IssueTriageOptions, 'repair' | 'minConfidence' | 'labels'>;
  maxSteps: number;
  maxTokens: number;
  now?: () => Date;
  idFactory?: () => string;
  /** Live trusted desktop/session presence. An approval alone does not imply presence. */
  isUserPresent?: () => boolean;
}

/** Public in-process composition surface; declarations use public package types. */
export interface DevWorkflowsRuntime {
  profile: 'local';
  runtime: TaskRuntime;
  gateway: ToolGateway;
  model: ModelGateway;
  tools: AgentToolPort;
  submit(input: {request: DevWorkflowRequest; conversationId: string; idempotencyKey: string; deadline: string}): TaskSnapshot;
  start(taskId: string, resume?: boolean): Promise<TaskSnapshot>;
  resume(taskId: string): Promise<TaskSnapshot>;
  resumeConfirmed(taskId: string, receipt: Parameters<TaskRuntime['prepareConfirmedReplay']>[1]): Promise<TaskSnapshot>;
  reconcileWorkspacePatchTask(taskId: string, runId: string): Promise<DevWorkflowPatchReadback>;
  readResult(taskId: string): unknown;
  cancel(taskId: string, reason?: string): ReturnType<TaskRuntime['requestCancel']>;
  close(): Promise<void>;
}

const REQUEST_KEY = 'dev-workflows-request-v1';
const DEADLINE_KEY = 'dev-workflows-deadline-v1';
const RESULT_KEY = 'dev-workflows-result-v1';
const REPAIR_UNKNOWN_PREFIX = 'dev-repair-link-unknown:';
interface RepairUnknownCandidate {
  taskId: string;
  toolRunId: string;
  toolName: string;
  toolVersion: string;
  arguments: GitHubRepairIdentity;
  argumentsDigest: string;
  checkRunId: number;
}

/** Optional Local composition. TaskRuntime owns all task states and durable execution receipts. */
export function createDevWorkflowsRuntime(options: DevWorkflowsRuntimeOptions): DevWorkflowsRuntime {
  if (!Number.isSafeInteger(options.maxSteps) || options.maxSteps < 1
    || !Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Positive workflow budgets required');
  }
  if ((options.githubRepairLinks !== undefined && typeof options.githubRepairLinks !== 'boolean')
    || (options.githubRepairLinks === true && !options.github)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Repair links require an explicit GitHub provider and boolean opt-in');
  }
  const now = options.now ?? (() => new Date());
  if (options.git && options.workspace) {
    const root = realpathSync(options.git.rootPath);
    if (realpathSync(options.workspace.read.rootPath) !== root || realpathSync(options.workspace.command.rootPath) !== root
      || options.ciFix?.sourcePaths.some(path => !options.git!.allowedPaths.includes(path))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Workspace, verification command and Git source paths must share the trusted root');
    }
  }
  const model = options.model instanceof ModelGateway ? options.model : new ModelGateway(options.model);
  let gateway!: ToolGateway;
  const runtime = new TaskRuntime(options.path, {now,
    ...(options.idFactory ? {idFactory: options.idFactory} : {}),
    createToolGateway: policy => {
      gateway = new ToolGateway({policy, now: () => now().getTime()});
      return {list: () => gateway.list(), invoke: invocation => gateway.invoke({...invocation,
        userPresent: options.isUserPresent?.() === true})};
    },
  });
  const registrations: (() => void)[] = [];
  let patchRecovery: DevWorkflowPatchRecovery | undefined;
  function boundRepairExecution(candidate: RepairUnknownCandidate, observing = false): boolean {
    try {
      const input = candidate.arguments;
      const task = runtime.getTask(candidate.taskId);
      const request = runtime.loadCheckpoint(candidate.taskId, REQUEST_KEY) as DevWorkflowRequest | undefined;
      const journal = runtime.loadCheckpoint(candidate.taskId, 'ci-fix-v1') as {identity?: string; inflight?: string} | undefined;
      const descriptor = gateway.list().find(tool => tool.name === 'github.actions.repair.link');
      const record = runtime.readToolExecutions(candidate.taskId).find(item => item.evidenceId === candidate.toolRunId);
      return !task.cancelRequested && !!input && Number.isSafeInteger(candidate.checkRunId) && candidate.checkRunId > 0
        && request?.kind === 'ci_fix' && request.repository === input.repo && Number(request.runId) === input.runId
        && journal?.inflight === 'source-backlink' && typeof journal.identity === 'string' && /^[a-f0-9]{64}$/u.test(journal.identity)
        && candidate.toolRunId === `${candidate.taskId}:ci-fix:${journal.identity}:source-backlink`
        && candidate.toolName === descriptor?.name && candidate.toolVersion === descriptor.version
        && candidate.argumentsDigest === toolArgumentsDigest(input)
        && input.workflowExecutionId === createHash('sha256').update(candidate.toolRunId).digest('hex')
        && !!record && record.taskId === candidate.taskId && record.toolName === candidate.toolName
        && record.toolVersion === candidate.toolVersion && record.executionStarted && record.policyDecision === 'allow'
        && (record.state === 'started' || record.state === 'unknown')
        && runtime.matchesToolExecutionInput(record, {arguments: {...input}, scopeRef: candidate.toolRunId})
        && task.state === (observing ? 'running' : 'waiting_reconciliation');
    } catch { return false; }
  }
  function observeRepairUnknown(input: GitHubRepairIdentity, checkRunId: number | undefined, context: ToolContext): undefined {
    if (checkRunId === undefined || context.signal.aborted || !Number.isFinite(Date.parse(context.deadline))
      || now().getTime() >= Date.parse(context.deadline) || context.authorizationRef !== context.runId
      || context.argumentsDigest !== toolArgumentsDigest(input)) return undefined;
    const descriptor = gateway.list().find(tool => tool.name === 'github.actions.repair.link');
    if (!descriptor) return undefined;
    const candidate: RepairUnknownCandidate = {taskId: context.taskId, toolRunId: context.runId,
      toolName: descriptor.name, toolVersion: descriptor.version, arguments: structuredClone(input),
      argumentsDigest: context.argumentsDigest, checkRunId};
    if (boundRepairExecution(candidate, true)) {
      const key = REPAIR_UNKNOWN_PREFIX + context.runId;
      if (!runtime.saveCheckpointOnce(context.taskId, key, candidate)
        && !isDeepStrictEqual(runtime.loadCheckpoint(context.taskId, key), candidate)) {
        runtime.saveCheckpointOnce(context.taskId, key + ':conflict', true);
      }
    }
    return undefined;
  }
  const initialize = <T>(factory: () => T): T => {
    try { return factory(); }
    catch (error) {
      // Roll back every acquired registration, even if a provider's disposal fails.
      for (const dispose of [...registrations].reverse()) {
        try { dispose(); } catch { /* Continue releasing remaining registrations. */ }
      }
      try { runtime.close(); } catch { /* Preserve the original initialization error. */ }
      throw error;
    }
  };
  initialize(() => {
    let recoveryPort = options.workspacePatchReconciliation;
    if (!recoveryPort && options.workspace) {
      const {read, patch} = options.workspace;
      const paths = [read.rootPath, patch.recoveryRootPath, patch.powerShellPath,
        ...(patch.helperScriptPath ? [patch.helperScriptPath] : [])];
      const identity = () => JSON.stringify(paths.map(value => {
        const canonical = realpathSync.native(value), stat = statSync(canonical, {bigint: true});
        return [canonical, String(stat.dev), String(stat.ino), String(stat.birthtimeNs),
          ...(stat.isFile() ? [String(stat.size), String(stat.mtimeNs)] : [])];
      }));
      const pinned = identity();
      recoveryPort = {bindingId: createHash('sha256').update(pinned).digest('hex'),
        async reconcile(input) {
          if (identity() !== pinned) throw new ProtocolError('REVISION_CONFLICT', 'Trusted patch host binding changed');
          return reconcileWorkspacePatchApply({rootPath: read.rootPath, recoveryRootPath: patch.recoveryRootPath,
            powerShellPath: patch.powerShellPath, ...input});
        }};
    }
    if (recoveryPort) {
      const preview = options.workspace ? createWorkspacePatchPreviewTool(options.workspace.read)
        : options.tools?.find(tool => tool.descriptor.name === 'workspace.preview_text_patch');
      if (!preview || preview.descriptor.version !== '1.0.0') {
        throw new ProtocolError('INVALID_ARGUMENT', 'Patch recovery requires a trusted workspace preview');
      }
      patchRecovery = new DevWorkflowPatchRecovery(runtime, recoveryPort, preview);
    }
    if (options.github) registrations.push(registerGitHub(gateway, {provider: options.github}));
    if (options.githubRepairLinks === true) {
      registrations.push(registerGitHubRepairLinks(gateway, {provider: options.github!,
        observeUnknown: (input, result, context) => observeRepairUnknown(input, result.checkRunId, context)}));
    }
    if (options.workspace) {
      registrations.push(gateway.register(createWorkspaceReadTool(options.workspace.read)));
      const apply = createWorkspacePatchApplyTool({...options.workspace.read, ...options.workspace.patch});
      registrations.push(gateway.register(patchRecovery ? patchRecovery.bind(apply) : apply));
    }
    let gitTools: ReturnType<typeof createGitTools> | undefined;
    if (options.git) {
      const readVerification: GitToolsOptions['readVerification'] = async (context, runId) => {
        const record = runtime.readToolExecutions(context.taskId).find(item => item.evidenceId === runId);
        const cached = runtime.loadCheckpoint(context.taskId, `tool-result-${runId}`) as {result?: {exitCode?: number}} | undefined;
        const receipt = runtime.loadCheckpoint(context.taskId, `dev-git-verification:${runId}`) as GitVerificationReceipt | undefined;
        if (!record || record.state !== 'confirmed' || !record.executionStarted || record.policyDecision !== 'allow'
          || record.toolName !== 'workspace.run_allowed_command' || cached?.result?.exitCode !== 0
          || receipt?.taskId !== context.taskId || receipt.runId !== runId || receipt.exitCode !== cached.result.exitCode) return undefined;
        return receipt;
      };
      gitTools = createGitTools({...options.git, readVerification});
      for (const tool of Object.values(gitTools)) registrations.push(gateway.register(tool));
    }
    if (options.workspace) {
      const command = createWorkspaceCommandTool(options.workspace.command);
      const git = options.git;
      const head = gitTools?.head;
      registrations.push(gateway.register({...command,
        descriptor: {...command.descriptor, requiredScopes: [...new Set([...command.descriptor.requiredScopes,
          ...(git && head ? ['workspace:git:read'] : [])])]},
        async execute(input, context) {
        if (!git || !head) return command.execute(input, context);
        const beforeHead = await head.execute({repository: git.repository}, context) as {headSha: string};
        const before = await readGitWorkspaceFingerprint(git.rootPath, git.allowedPaths);
        const result = await command.execute(input, context) as {exitCode: number};
        const afterHead = await head.execute({repository: git.repository}, context) as {headSha: string};
        const after = await readGitWorkspaceFingerprint(git.rootPath, git.allowedPaths);
        if (result.exitCode === 0 && beforeHead.headSha === afterHead.headSha && before.fingerprint === after.fingerprint) {
          runtime.saveCheckpoint(context.taskId, `dev-git-verification:${context.runId}`, {
            taskId: context.taskId, runId: context.runId, toolName: 'workspace.run_allowed_command',
            status: 'confirmed', exitCode: 0, headSha: afterHead.headSha, files: after.files,
          } satisfies GitVerificationReceipt);
        }
        return result;
      }}));
    }
    for (const tool of options.tools ?? []) registrations.push(gateway.register(patchRecovery ? patchRecovery.bind(tool) : tool));
  });
  const invoker = new RuntimeToolInvoker(runtime, gateway.list());
  const tools: AgentToolPort = {
    list: () => gateway.list(),
    async invoke(invocation) {
      const tool = gateway.list().find(item => item.name === invocation.toolName);
      if (!tool || tool.version !== invocation.toolVersion) {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Workflow tool is not registered');
      }
      const ref = invocation.runId;
      const confirmed = runtime.readToolExecutions(invocation.taskId).some(record =>
        record.evidenceId === ref && record.state === 'confirmed' && record.executionStarted
        && record.policyDecision === 'allow' && record.toolName === tool.name && record.toolVersion === tool.version
        && runtime.matchesToolExecutionInput(record, {arguments: invocation.arguments as Record<string, unknown>, scopeRef: ref}));
      if (!confirmed && !runtime.policy.get(ref)) {
        const approval = runtime.requestToolApproval(ref, invocation.taskId, tool,
          invocation.deadline, toolArgumentsDigest(invocation.arguments));
        if (approval.state !== 'pending') throw new ProtocolError('UNAUTHORIZED', 'Workflow approval denied or grant revoked');
        return {state: 'pending', evidenceRefs: []};
      }
      return invoker.invoke({...invocation, authorizationRef: ref});
    },
  };
  // The per-invocation adapter above chooses the actual run-bound reference; workflows never mint grants.
  const authorizationRefFor = (_name: string, context: AgentWorkerContext) => context.taskId;
  const confirmedReplayReady = (taskId: string, runId: string) => {
    const record = runtime.readToolExecutions(taskId).find(item => item.evidenceId === runId);
    return record?.state === 'confirmed' && record.executionStarted && record.policyDecision === 'allow'
      && runtime.loadCheckpoint(taskId, `tool-result-${runId}`) !== undefined;
  };
  // CI's shared input/output budget can exceed the review provider's single-output ceiling.
  const review = initialize(() => createCodeReviewWorkflow({model, tools, maxTokens: Math.min(options.maxTokens, 32_000)}));
  const ciOptions = options.ciFix ? {...options.ciFix,
    ...(!options.ciFix.gitTools && options.git ? {gitTools: {head: 'workspace.git.head', commit: 'workspace.git.commit',
      push: 'workspace.git.push', pullRequest: 'github.pr.create', backlink: 'github.pr.comment'}} : {}),
  } : undefined;
  const repair = options.issueTriage?.repair ?? (ciOptions && (options.failedRunForIssue || ciOptions.expectedHeadSha) ? {
    async repairIssue(context: AgentWorkerContext, request: {repo: string; number: number; issueUrl: string;
      issueFingerprint: string; goal: string; pullRequestBody: string}) {
      const {repo, number, issueUrl, issueFingerprint, goal, pullRequestBody} = request;
      const runId = options.failedRunForIssue?.(repo, number);
      if (!runId && !ciOptions.expectedHeadSha) return {state: 'unsupported', resultSummary: 'No trusted source revision is bound to this issue', evidenceRefs: []};
      const outcome = await createCiFixWorkflow({...ciOptions, repository: repo, ...(runId ? {runId} : {}), model, tools,
        authorizationRefFor, maxSteps: options.maxSteps, maxTokens: options.maxTokens,
        repairGoal: goal, pullRequestBody,
        issue: {url: issueUrl, number, repository: repo, fingerprint: issueFingerprint},
        confirmedReplayReady: id => confirmedReplayReady(context.taskId, id)}).run(context);
      return {state: outcome.status, resultSummary: outcome.reason, evidenceRefs: outcome.evidenceRefs};
    },
  } : undefined);
  const triage = initialize(() => createIssueTriageWorkflow({model, tools, authorizationRefFor,
    maxSteps: options.maxSteps, maxTokens: options.maxTokens, ...options.issueTriage, ...(repair ? {repair} : {}),
    confirmedReplayReady: (runId, context) => confirmedReplayReady(context.taskId, runId),
    confirmedRepairReplayReady: context => {
      const receipt = runtime.loadCheckpoint(context.taskId, 'dev-confirmed-replay-receipt-v1') as
        Parameters<TaskRuntime['prepareConfirmedReplay']>[1] | undefined;
      if (!receipt || !receipt.runId.startsWith(`${context.taskId}:ci-fix:`)) return false;
      const records = runtime.readToolExecutions(context.taskId).filter(record => record.evidenceId.startsWith(`${context.taskId}:ci-fix:`));
      const original = records.find(record => record.evidenceId === receipt.runId);
      return !!original && original.toolName === receipt.toolName && original.toolVersion === receipt.toolVersion
        && runtime.matchesToolExecutionInput(original, {arguments: receipt.arguments, scopeRef: receipt.runId})
        && records.every(record => confirmedReplayReady(context.taskId, record.evidenceId));
    }}));
  const ciDiscovery = initialize(() => createCiRunDiscoveryWorkflow({tools, authorizationRefFor,
    maxSteps: options.maxSteps, now: () => now().getTime(),
    confirmedReplayReady: (runId, context) => confirmedReplayReady(context.taskId, runId)}));
  const active = new Map<string, Promise<TaskSnapshot>>();

  async function executeWorkflow(context: AgentWorkerContext) {
    const request = runtime.loadCheckpoint(context.taskId, REQUEST_KEY) as DevWorkflowRequest;
    let result: unknown;
    if (request.kind === 'ci_fix') {
      if (!ciOptions) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Trusted CI workspace/Git configuration unavailable');
      result = await createCiFixWorkflow({...ciOptions, repository: request.repository,
        runId: request.runId, model, tools, authorizationRefFor,
        confirmedReplayReady: runId => confirmedReplayReady(context.taskId, runId),
        maxSteps: options.maxSteps, maxTokens: options.maxTokens}).run(context);
    } else if (request.kind === 'ci_list') {
      result = await ciDiscovery.listFailedRuns(context, request.input);
    } else if (request.kind === 'ci_link_readback') {
      const descriptor = tools.list().find(tool => tool.name === 'github.actions.repair.get' && tool.sideEffect === 'read');
      if (!descriptor) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Opt-in original repair association readback unavailable');
      const readback = await tools.invoke({toolName: descriptor.name, toolVersion: descriptor.version,
        arguments: {...request.input}, taskId: context.taskId, runId: `${context.taskId}:repair-link-readback`,
        authorizationRef: context.taskId, deadline: context.deadline, signal: context.signal});
      // A checked object is evidence for the trusted host, never automatic confirmation of another task's write.
      result = {state: readback.state === 'confirmed' ? 'checked' : readback.state,
        ...(readback.state === 'confirmed' ? {receipt: readback.result} : {}), evidenceRefs: readback.evidenceRefs};
    } else if (request.kind === 'issue_list') {
      result = await triage.listIssues(context, request.input);
    } else if (request.kind === 'issue_triage') {
      result = await triage.triageIssue(context, request.input);
    } else if (request.kind === 'code_review') {
      const access = {runId: `${context.taskId}:review`, authorizationRef: context.taskId,
        confirmedReplayReady: (runId: string) => confirmedReplayReady(context.taskId, runId)};
      let report = context.loadCheckpoint('dev-code-review-report-v1') as CodeReviewReport | undefined;
      if (!report) {
        const prepared = await review.prepare(request.input, context, access);
        if (prepared.state !== 'prepared') result = prepared;
        else { report = prepared.report; context.saveCheckpoint('dev-code-review-report-v1', report); }
      }
      if (report) {
        result = {state: 'prepared', report, evidenceRefs: report.evidenceRefs};
        if (request.publish) {
          const publicationEvidence = [...report.evidenceRefs];
          const confirmedFindingIndexes: number[] = [];
          for (let index = 0; index < report.findings.length; index++) {
            const published = await review.publish(report, index, context,
              {...access, runId: `${context.taskId}:review:publish:${index}`});
            if ('evidenceRefs' in published) publicationEvidence.push(...published.evidenceRefs);
            if (published.state === 'confirmed') confirmedFindingIndexes.push(index);
            result = {...published, report, evidenceRefs: [...new Set(publicationEvidence)],
              publication: {findingIndex: index, totalFindings: report.findings.length,
                confirmedFindingIndexes: [...confirmedFindingIndexes]}};
            if (published.state !== 'confirmed') break;
          }
        }
      }
    } else throw new ProtocolError('INVALID_ARGUMENT', 'Unknown development workflow');
    context.saveCheckpoint(RESULT_KEY, result);
    const outcome = result as {state?: string; status?: string; reason?: string; evidenceRefs?: readonly string[]};
    const state = outcome.state ?? outcome.status;
    if (state === 'waiting_approval' || state === 'pending') {
      if (runtime.getTask(context.taskId).state === 'running') runtime.transitionTask(context.taskId, 'waiting_approval');
    } else if (state === 'waiting_reconciliation' || state === 'unknown') {
      if (runtime.getTask(context.taskId).state === 'running') runtime.transitionTask(context.taskId, 'waiting_reconciliation');
    } else if (['unsupported', 'verification_failed', 'stale'].includes(state ?? '')) {
      throw new ProtocolError(state === 'unsupported' ? 'UNSUPPORTED_CAPABILITY' : 'EXTERNAL_FAILURE', outcome.reason ?? 'Workflow could not complete');
    }
    return {resultSummary: outcome.reason ?? `Development workflow ${request.kind}: ${state ?? 'completed'}`,
      evidenceRefs: outcome.evidenceRefs ?? []};
  }

  async function worker(context: AgentWorkerContext) {
    try { return await executeWorkflow(context); }
    catch (error) {
      // A public port may signal a pause by throwing. Preserve the state already recorded by Runtime.
      const task = runtime.getTask(context.taskId);
      if (task.state === 'waiting_approval' || task.state === 'waiting_reconciliation') {
        return {resultSummary: `Development workflow ${task.state}`, evidenceRefs: task.evidenceRefs};
      }
      throw error;
    }
  }

  function start(taskId: string, resume = false): Promise<TaskSnapshot> {
    const existing = active.get(taskId);
    if (existing) return existing;
    const deadline = runtime.loadCheckpoint(taskId, DEADLINE_KEY);
    if (typeof deadline !== 'string' || runtime.loadCheckpoint(taskId, REQUEST_KEY) === undefined) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Task is not a bound development workflow');
    }
    const run = runtime.runTask(taskId, worker, {deadline, sideEffect: 'external_write', ...(resume ? {resume: true} : {})})
      .finally(() => active.delete(taskId));
    active.set(taskId, run);
    return run;
  }

  return {
    profile: 'local' as const, runtime, gateway, model, tools,
    submit(input: {request: DevWorkflowRequest; conversationId: string; idempotencyKey: string; deadline: string}) {
      if (!Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline) <= now().getTime()) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Future absolute deadline required');
      }
      const request = structuredClone(input.request);
      const task = runtime.submitTaskWithCheckpoint({goal: `DEV ${request.kind}`, conversationId: input.conversationId,
        idempotencyKey: input.idempotencyKey}, REQUEST_KEY, request);
      const old = runtime.loadCheckpoint(task.taskId, DEADLINE_KEY);
      if (old !== undefined && old !== input.deadline) throw new ProtocolError('REVISION_CONFLICT', 'Workflow deadline changed');
      if (!isDeepStrictEqual(runtime.loadCheckpoint(task.taskId, REQUEST_KEY), request)) {
        throw new ProtocolError('REVISION_CONFLICT', 'Workflow request changed');
      }
      runtime.saveCheckpointOnce(task.taskId, DEADLINE_KEY, input.deadline);
      return task;
    },
    start,
    resume(taskId: string) { return start(taskId, true); },
    /** Trusted host must first reconcile and persist original execution Evidence. Unknown writes never retry. */
    resumeConfirmed(taskId: string, receipt: Parameters<TaskRuntime['prepareConfirmedReplay']>[1]) {
      runtime.prepareConfirmedReplay(taskId, receipt);
      runtime.saveCheckpoint(taskId, 'dev-confirmed-replay-receipt-v1', receipt);
      return start(taskId, true);
    },
    reconcileWorkspacePatchTask(taskId: string, runId: string) {
      if (active.has(taskId)) throw new ProtocolError('REVISION_CONFLICT', 'Original workflow is still active');
      if (!patchRecovery || runtime.loadCheckpoint(taskId, REQUEST_KEY) === undefined) {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Trusted workflow patch recovery is unavailable');
      }
      return patchRecovery.reconcile(taskId, runId);
    },
    readResult(taskId: string) {
      const result = runtime.loadCheckpoint(taskId, RESULT_KEY);
      if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
      // This field is derived from current trusted bindings, never accepted from a cached result.
      const {sourceRunLinkHint: _cachedHint, ...visibleResult} = result as Record<string, unknown>;
      const journal = runtime.loadCheckpoint(taskId, 'ci-fix-v1') as {identity?: string} | undefined;
      const runId = `${taskId}:ci-fix:${journal?.identity}:source-backlink`;
      const candidate = runtime.loadCheckpoint(taskId, REPAIR_UNKNOWN_PREFIX + runId) as RepairUnknownCandidate | undefined;
      if (!candidate || runtime.loadCheckpoint(taskId, REPAIR_UNKNOWN_PREFIX + runId + ':conflict') !== undefined
        || candidate.taskId !== taskId || candidate.toolRunId !== runId || !boundRepairExecution(candidate)) return visibleResult;
      // Candidate metadata is unverified. Only a separately approved read can check the original object.
      return {...visibleResult, sourceRunLinkHint: {state: 'unverified', toolRunId: runId,
        input: {...candidate.arguments, checkRunId: candidate.checkRunId}}};
    },
    cancel(taskId: string, reason?: string) { return runtime.requestCancel(taskId, reason); },
    async close() {
      for (const taskId of active.keys()) runtime.requestCancel(taskId, 'Development workflow host closing');
      await Promise.allSettled([...active.values()]);
      for (const dispose of registrations.reverse()) dispose();
      runtime.close();
    },
  };
}
