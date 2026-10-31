import type {ToolContext} from '@personal-agent/contracts';

export interface GitFileHash {path: string; sha256: string}
/** Produced by the Runtime gateway, never decoded from model tool arguments. */
export interface GitVerificationReceipt {
  taskId: string;
  runId: string;
  toolName: 'workspace.run_allowed_command';
  status: 'confirmed';
  exitCode: number;
  headSha: string;
  files: readonly GitFileHash[];
  /** Trusted original graph proof; source taskId/runId are never rewritten. */
  consumer?: {taskId:string;runId:string;argumentsDigest:string};
}
export interface GitPublicationBinding {selectionRef:string;branch:string;baseHeadSha:string;repairDigest:string}
export interface GitPublicationIntent {
  version:1;operation:'commit'|'push';taskId:string;runId:string;repository:string;remoteUrl:string;
  arguments:GitCommitInput|GitPushInput;publication:GitPublicationBinding;fingerprint:string;
  expected:GitCommitResult|GitPushResult;
}
/** Original Runtime checkpoint/authority adapters. No credentials or second task store. */
export interface GitPublicationPort {
  assertCurrent(context:ToolContext,publication:GitPublicationBinding):Promise<void>;
  load(context:ToolContext,target:{taskId:string;runId:string}):Promise<GitPublicationIntent|undefined>;
  saveOnce(context:ToolContext,intent:GitPublicationIntent):Promise<void>;
  observed(context:ToolContext,intent:GitPublicationIntent,result:{state:'applied'|'unknown'}):Promise<void>;
}
export interface GitToolsOptions {
  repository: string;
  rootPath: string;
  sourceBranch: string;
  remoteName: string;
  /** Exact credential-free https URL fixed by the host. */
  remoteUrl: string;
  allowedPaths: readonly string[];
  authorName: string;
  authorEmail: string;
  readVerification(context: ToolContext, runId: string): Promise<GitVerificationReceipt | undefined>;
  /** Trusted host secret adapter; never model input or ambient environment. */
  getCredentials?(context: ToolContext): Promise<{token: string} | undefined>;
  publication?:GitPublicationPort;
  now?: () => number;
}
export interface GitHeadResult {headSha: string; clean: boolean; workspaceClean: boolean; fingerprint: string}
export interface GitCommitInput {repository: string; expectedHeadSha: string; paths: string[]; message: string; verificationRunId: string;publication?:GitPublicationBinding}
export interface GitCommitResult {headSha: string; parentSha: string; branch: string}
export interface GitPushInput {repository: string; expectedHeadSha: string;publication?:GitPublicationBinding}
export interface GitPushResult {headSha: string; pushed: true}
