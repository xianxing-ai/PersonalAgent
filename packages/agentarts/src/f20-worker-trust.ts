// F20 worker 信任闭环适配（ownedWorkflowWorker 注入前提，缺一不可）。
// 依据 docs/competition/evidence/F20_WORKER_TRUST_GAPS_20261029.md 的实现方向 §1–§4：
//   §1 受限候选格式 + 候选与原始选择回执/两份源读取/原始配置绑定，源漂移与候选替换 fail-closed；
//   §2 候选转换成有精确 baseline 与受限路径的隔离 patch，复用 coding.repair.trial 的既有隔离检查宿主；
//   §3 completion 校验原始 task/operation/参数/源与候选摘要/确认回执，未知结果与取消语义保留；
//   §4 定向测试覆盖替换候选、源漂移、越界、缺检查、未知结果与授权撤销。
// 本模块只做纯绑定/校验/受限构造：不执行命令、不授权发布、不读取云节点状态；
// 任何前提缺失都以显式错误 fail-closed（unavailable/冲突），不提供“可用”假象。
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {harnessCandidateArtifactDigest,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateContext,HarnessCandidateTrial} from '@personal-agent/contracts/harness-candidates';
import type {CodingRepairPatch,CodingRepairRecipe,CodingRepairSnapshot} from '@personal-agent/contracts/coding-repair';
import {codingVerificationCurrent} from './coding-repair.js';

export const F20_WORKER_TRUST_VERSION = '0.1.0' as const;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const unavailable = (message: string): never => {throw new ProtocolError('UNSUPPORTED_CAPABILITY', message);};
const invalid = (message: string): never => {throw new ProtocolError('INVALID_ARGUMENT', message);};
const conflict = (message: string): never => {throw new ProtocolError('REVISION_CONFLICT', message);};

/** F20_N02 受限候选格式（gaps 文档 §1）：字段闭合；目标路径由宿主指定，不由模型指定。 */
export interface F20CandidateOutput {
  readonly docMarkdown: string;
  readonly sampleSnippet: string;
  readonly targetPath: string;
  readonly contentSha256: string;
}

/** 一份实际源文件的受信 HostBridge 读取回执。 */
export interface F20SourceRead {
  readonly path: string;
  readonly sha256: string;
  readonly readTaskId: string;
}

/** decision.choose_candidate 的原始绑定参数；只从原始绑定读取，不把单独云节点状态当权威。 */
export interface F20CandidateSelection {
  readonly operation: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly candidateValues: Readonly<Record<string, F20CandidateOutput>>;
  readonly selectedId: string;
  /** 原会话确认回执摘要；缺失时候选只能绑定、不得进入 trial/completion。 */
  readonly confirmationReceiptDigest?: string;
}

/** 宿主（非模型）指定的 F20 信任输入。 */
export interface F20WorkerTrustInput {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly inputDigest: string;
  readonly configurationDigest: string;
  readonly workflowVersion: string;
  readonly runtimeVersion: string;
  readonly selectionPolicy: 'unique_verified' | 'fewest_changed_files';
  readonly baselineSnapshotId: string;
  /** HostBridge 已读取的源快照（元数据，无内容；与 harness-candidates 现有约定一致）。 */
  readonly baseline: CodingRepairSnapshot;
  readonly sourceReads: readonly F20SourceRead[];
  readonly recipes: readonly CodingRepairRecipe[];
  /** 宿主允许的受限目标路径清单。 */
  readonly allowedTargetPaths: readonly string[];
}

export interface F20CandidateBinding {
  readonly candidate: F20CandidateOutput;
  readonly selectedId: string;
  readonly context: HarnessCandidateContext;
}

export interface F20CompletionVerdict {
  readonly state: 'completed' | 'failed' | 'unknown';
  readonly reason: string;
}

function parseCandidate(value:unknown,label:string):F20CandidateOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`F20 候选 ${label} 结构无效`);
  const v = value as Record<string,unknown>;
  for (const key of ['docMarkdown','sampleSnippet','targetPath','contentSha256']) {
    if (typeof v[key] !== 'string' || (v[key] as string).length === 0) invalid(`F20 候选 ${label} 缺少 ${key}`);
  }
  const candidate = {docMarkdown: v.docMarkdown as string, sampleSnippet: v.sampleSnippet as string, targetPath: v.targetPath as string, contentSha256: v.contentSha256 as string};
  if (!/^[a-f0-9]{64}$/.test(candidate.contentSha256)) invalid(`F20 候选 ${label} contentSha256 非法`);
  if (candidate.contentSha256 !== sha256(candidate.sampleSnippet)) conflict(`F20 候选 ${label} 被替换：contentSha256 与 sampleSnippet 不一致`);
  if (candidate.targetPath.includes('..') || candidate.targetPath.startsWith('/')) invalid(`F20 候选 ${label} targetPath 越界`);
  return candidate;
}

/** §1：解析并校验 decision.choose_candidate 原始绑定；拒绝 abstain、重复 ID 与非当前图候选。 */
export function parseF20CandidateSelection(raw:unknown):F20CandidateSelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('F20 候选选择参数无效');
  const v = raw as Record<string,unknown>;
  const values = v.candidateValues;
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
    unavailable('F20 selection abstained：无候选可校验，worker 不注入');
  }
  const candidateValues: Record<string, F20CandidateOutput> = {};
  const digests = new Set<string>();
  for (const [id, value] of Object.entries(values as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9@][A-Za-z0-9_.:/@-]*$/.test(id)) invalid(`F20 候选 ID 非法：${id}`);
    const candidate = parseCandidate(value, id);
    if (digests.has(candidate.contentSha256)) conflict('F20 候选重复 ID：不同候选不得复用同一摘要');
    digests.add(candidate.contentSha256);
    candidateValues[id] = candidate;
  }
  const selectedId = v.selectedId;
  if (typeof selectedId !== 'string' || !(selectedId in candidateValues)) return conflict('F20 selectedId 不指向当前图候选');
  const selection: F20CandidateSelection = {
    operation: typeof v.operation === 'string' ? v.operation : 'decision.choose_candidate',
    workflowId: typeof v.workflowId === 'string' ? v.workflowId : 'F20',
    nodeId: typeof v.nodeId === 'string' ? v.nodeId : 'F20_N02',
    candidateValues,
    selectedId,
    ...(typeof v.confirmationReceiptDigest === 'string' ? {confirmationReceiptDigest: v.confirmationReceiptDigest} : {}),
  };
  if (selection.operation !== 'decision.choose_candidate') conflict(`F20 原始绑定 operation 非预期：${selection.operation}`);
  if (selection.workflowId !== 'F20' || selection.nodeId !== 'F20_N02') conflict(`F20 原始绑定图/节点非预期：${selection.workflowId}/${selection.nodeId}`);
  return selection;
}

/** §1：把候选与源读取、原始配置绑定成受信 HarnessCandidateContext；源漂移/越界/缺检查全部 fail-closed。 */
export function bindF20Candidate(selection:F20CandidateSelection,input:F20WorkerTrustInput):F20CandidateBinding {
  if (input.sourceReads.length < 2) unavailable('F20 需要两份实际源读取回执（gaps §1），当前不足');
  if (input.recipes.filter((r) => r.required).length === 0) unavailable('F20 缺少必需检查 recipe（gaps §4 缺检查项），worker 不注入');
  for (const read of input.sourceReads) {
    const file = input.baseline.files.find((f) => f.path === read.path);
    if (!file || file.sha256 !== read.sha256) conflict(`F20 源读取 ${read.path} 未进入 baseline 快照或摘要与回执不一致（源漂移）`);
  }
  const candidate = selection.candidateValues[selection.selectedId]!;
  if (!input.allowedTargetPaths.includes(candidate.targetPath)) unavailable(`F20 目标路径不在宿主允许清单：${candidate.targetPath}`);
  const context: HarnessCandidateContext = {
    binding: {
      version: 1,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      baselineSnapshotId: input.baselineSnapshotId,
      inputDigest: input.inputDigest,
      configurationDigest: input.configurationDigest,
      workflowVersion: input.workflowVersion,
      runtimeVersion: input.runtimeVersion,
      recipeFingerprint: harnessCandidateRecipeFingerprint(input.recipes),
      executionKind: 'real_host',
    },
    baseline: input.baseline,
    recipes: [...input.recipes],
    selectionPolicy: input.selectionPolicy,
  };
  return {candidate, selectedId: selection.selectedId, context};
}

/** §2：把候选转换成有精确 baseline 与受限路径的隔离 patch——只允许单文件、只允许候选目标路径。
 *  目标已存在时 baseline 只有元数据没有内容，必须由宿主提供受信内容读取（oldText）才能构造精确替换；否则显式 unavailable。 */
export function buildF20CandidatePatch(candidate:F20CandidateOutput,input:F20WorkerTrustInput,
  existingContent?:{readonly oldText:string;readonly oldSha256:string}):CodingRepairPatch {
  if (!input.allowedTargetPaths.includes(candidate.targetPath)) unavailable(`F20 目标路径不在宿主允许清单：${candidate.targetPath}`);
  const current = input.baseline.files.find((f) => f.path === candidate.targetPath);
  if (!current) return {path: candidate.targetPath, expectedSha256: null, edits: [], createText: candidate.sampleSnippet};
  if (!existingContent) return unavailable(`F20 目标已存在（${candidate.targetPath}）且 baseline 无内容：需宿主提供受信内容读取才能构造受限替换`);
  if (existingContent.oldSha256 !== current.sha256) conflict(`F20 内容读取与 baseline 摘要不一致：${candidate.targetPath}`);
  const {oldText, oldSha256} = existingContent;
  return {
    path: candidate.targetPath,
    expectedSha256: current.sha256,
    edits: [{oldText, newText: candidate.sampleSnippet}],
  };
}

/** §3：completion 校验——独立绑定当前源、实际候选与检查结果；exit code 为零单独不满足约束。 */
export function verifyF20CandidateCompletion(
  trial: HarnessCandidateTrial,
  selection: F20CandidateSelection,
  input: F20WorkerTrustInput,
  currentSourceDigests: Readonly<Record<string, string>>,
): F20CompletionVerdict {
  const expected = bindF20Candidate(selection, input).context.binding;
  const b = trial.binding;
  for (const key of ['taskId','workspaceId','baselineSnapshotId','inputDigest','configurationDigest','workflowVersion','runtimeVersion','recipeFingerprint','executionKind'] as const) {
    if (b[key] !== expected[key]) conflict(`F20 trial 绑定身份不一致：${key}`);
  }
  if (b.candidateId !== selection.selectedId) conflict('F20 trial 绑定的候选与当前选择不一致');
  if (b.artifactDigest !== harnessCandidateArtifactDigest(trial.checkReadback.snapshot)) conflict('F20 trial artifact 摘要与快照不一致');
  for (const read of input.sourceReads) {
    if (currentSourceDigests[read.path] !== read.sha256) conflict(`F20 当前源漂移：${read.path}`);
  }
  const snapshot = trial.checkReadback.snapshot;
  // 候选检查不得用原代码冒充：快照相对 baseline 只允许目标路径变化
  const changedPaths = [...new Set([...input.baseline.files, ...snapshot.files].map((f) => f.path))]
    .filter((path) => input.baseline.files.find((f) => f.path === path)?.sha256 !== snapshot.files.find((f) => f.path === path)?.sha256);
  const allowed = new Set([selection.candidateValues[selection.selectedId]!.targetPath]);
  if (changedPaths.length === 0 || changedPaths.some((path) => !allowed.has(path))) {
    return {state: 'unknown', reason: `F20 检查结果未针对候选目标（变更：${changedPaths.join(', ') || '无'}），不作为完成证据`};
  }
  const required = input.recipes.filter((r) => r.required);
  const rows = required.map((recipe) => trial.checkReadback.verification.find((r) => r.recipeId === recipe.recipeId));
  if (rows.some((row) => !row)) return {state: 'unknown', reason: 'F20 必需检查缺回执，完成性未知'};
  // “是否绑定当前快照”与状态解耦（对齐 compareHarnessCandidates 的 normalize 惯例），状态单独判定。
  const current = (row: NonNullable<(typeof rows)[number]>) =>
    codingVerificationCurrent({...row, status: 'VALID', exitCode: 0}, snapshot, trial.session.sessionId);
  const failed = rows.filter((row) => row!.status === 'FAILED' && row!.exitCode !== null && row!.exitCode !== 0 && current(row!));
  if (failed.length) return {state: 'failed', reason: `F20 必需检查失败：${failed.map((row) => row!.recipeId).join(', ')}`};
  const unknown = rows.filter((row) => !(row!.status === 'VALID' && row!.exitCode === 0 && current(row!)));
  if (unknown.length) return {state: 'unknown', reason: `F20 检查结果未知或过期：${unknown.map((row) => row!.recipeId).join(', ')}`};
  if (!selection.confirmationReceiptDigest) return {state: 'unknown', reason: 'F20 缺少原始确认回执，完成性未知'};
  return {state: 'completed', reason: 'F20 候选、当前源与全部必需检查已独立绑定'};
}

/** §3：数据出境授权门——没有既有 export authorization 授权范围内凭据时显式 unavailable。 */
export interface F20ExportGrant {
  readonly grantId: string;
  readonly scope: string;
  readonly revoked?: boolean;
}

export function assertF20ExportAuthorized(grants:readonly F20ExportGrant[]|undefined, requiredScope:string):F20ExportGrant {
  if (!grants || grants.length === 0) return unavailable(`F20 无数据出境授权（scope=${requiredScope}），不进行任何外发`);
  const grant = grants.find((g) => g.scope === requiredScope);
  if (!grant) return unavailable(`F20 授权范围不匹配：需要 ${requiredScope}`);
  if (grant.revoked) conflict(`F20 授权已撤销：${grant.grantId}`);
  return grant;
}
