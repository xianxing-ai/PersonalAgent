/** Host-only provisional execution contract. Never accept this profile from tool/model input. */
export type NativeSandboxMode = 'read-only' | 'workspace-write' | 'full-access';
export type NativeSandboxBackend = 'windows-psec' | 'none';

export type NativeSandboxNetworkPolicy =
  | {readonly mode: 'deny'}
  | {readonly mode: 'allowlist'; readonly hosts: readonly string[]}
  | {readonly mode: 'unrestricted'};

export interface TrustedSandboxProfile {
  readonly sandboxRef: string;
  readonly revision: number;
  readonly mode: NativeSandboxMode;
  readonly backend: NativeSandboxBackend;
  readonly readRoots: readonly string[];
  readonly writeRoots: readonly string[];
  readonly executableAllowlist: readonly string[];
  readonly network: NativeSandboxNetworkPolicy;
}

export interface TrustedSandboxBinding {
  readonly sandboxRef: string;
  readonly revision: number;
  readonly taskId: string;
  readonly runId: string;
  readonly authorizationRef: string;
  readonly argumentsDigest: string;
  readonly deadline: string;
}

export interface TrustedSandboxExecutionRequest extends TrustedSandboxBinding {
  readonly profile: TrustedSandboxProfile;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly maxOutputBytes: number;
}

export interface SandboxExecutionResult {
  readonly backend: NativeSandboxBackend;
  /** True only for a target launched inside the requested OS boundary, never for JobObject alone. */
  readonly enforced: boolean;
  readonly outcome: 'exited' | 'cancelled' | 'timeout' | 'unknown' | 'unavailable';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly executionStarted: boolean;
  readonly stopped: boolean;
  readonly sideEffects: 'none' | 'possible' | 'unknown';
  readonly reason?: string;
}

export interface TrustedSandboxExecutor {
  execute(request: TrustedSandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

export interface WindowsNativeSandboxExecutorOptions {
  /** Installed, immutable helper outside all model-writable roots. */
  readonly helperPath: string;
  readonly helperSha256: string;
  /** Pins the framework-dependent helper's DLL, deps and runtimeconfig as well as its apphost. */
  readonly helperFilesSha256: Readonly<Record<string, string>>;
  /** Recheck original execution/profile/lease; do not consume the one-shot Policy grant twice. */
  readonly assertCurrent: (binding: TrustedSandboxBinding) => void | Promise<void>;
  readonly now?: () => number;
}
