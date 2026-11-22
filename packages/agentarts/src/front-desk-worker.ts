/**
 * Competition Profile front-desk / peer-assistant / fixed-worker boundaries.
 * Shared by local Runtime and the owned AgentArts image so tool surfaces stay aligned.
 */

export type WorkerDriverPreference =
  | 'agentarts'
  | 'codex'
  | 'claude'
  | 'opencode'
  | 'grok'
  | 'gemini'
  | 'acp-generic';

export type WorkerRole = 'researcher' | 'coder' | 'reviewer' | 'planner' | 'coordinator';

export interface WorkerDefinition {
  readonly workerId: string;
  readonly displayName: string;
  readonly role: WorkerRole;
  readonly instructions: string;
  /** Prefer AgentArts owned-image routing; local Crew drivers are fallbacks. */
  readonly preferredDriver: WorkerDriverPreference;
  readonly kind: 'builtin';
}

/** Fixed backend workers. Reuse these before creating a user-named worker. */
export const DEFAULT_WORKERS: readonly WorkerDefinition[] = [
  {
    workerId: 'worker-researcher',
    displayName: '资料工人',
    role: 'researcher',
    preferredDriver: 'agentarts',
    kind: 'builtin',
    instructions: '检索、核对与整理资料；给出依据，不编造来源。',
  },
  {
    workerId: 'worker-coder',
    displayName: '编码工人',
    role: 'coder',
    preferredDriver: 'codex',
    kind: 'builtin',
    instructions: '阅读与修改代码、运行允许的检查，并说明改动与验证。',
  },
  {
    workerId: 'worker-reviewer',
    displayName: '审查工人',
    role: 'reviewer',
    preferredDriver: 'agentarts',
    kind: 'builtin',
    instructions: '审查正确性、风险与遗漏；先指出问题再给结论。',
  },
  {
    workerId: 'worker-planner',
    displayName: '规划工人',
    role: 'planner',
    preferredDriver: 'agentarts',
    kind: 'builtin',
    instructions: '把目标拆成可执行步骤，标出依赖与风险。',
  },
  {
    workerId: 'worker-coordinator',
    displayName: '协作工人',
    role: 'coordinator',
    preferredDriver: 'agentarts',
    kind: 'builtin',
    instructions: '在多个工人之间传递任务并汇总结论，不代替专业判断。',
  },
];

/** Main / front-desk conversation: chat, light reads, and dispatch to workers. */
export const FRONT_DESK_TOOL_NAMES: ReadonlySet<string> = new Set([
  'conversation.read_history',
  'weather.forecast',
  'notifications.status',
  'assistant.message',
  'subagent.dispatch',
]);

/** Peer assistants: talk to user / main / each other only. */
export const ASSISTANT_CHAT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'conversation.read_history',
  'assistant.message',
]);

export type FrontDeskSurface = 'front_desk' | 'assistant_chat' | 'worker';

export function classifyToolSurface(input: {
  hasAssistantTurn: boolean;
  hasSubtaskParent: boolean;
}): FrontDeskSurface {
  if (input.hasAssistantTurn) return 'assistant_chat';
  if (input.hasSubtaskParent) return 'worker';
  return 'front_desk';
}

export function allowedToolNamesForSurface(surface: FrontDeskSurface): ReadonlySet<string> | undefined {
  if (surface === 'front_desk') return FRONT_DESK_TOOL_NAMES;
  if (surface === 'assistant_chat') return ASSISTANT_CHAT_TOOL_NAMES;
  return undefined;
}

export function isToolAllowedOnSurface(surface: FrontDeskSurface, toolName: string): boolean {
  const allowed = allowedToolNamesForSurface(surface);
  return allowed === undefined || allowed.has(toolName);
}

export function workerById(workerId: string): WorkerDefinition | undefined {
  return DEFAULT_WORKERS.find(item => item.workerId === workerId);
}

export function workerByRole(role: string): WorkerDefinition | undefined {
  return DEFAULT_WORKERS.find(item => item.role === role);
}

/**
 * Resolve which fixed worker to reuse.
 * Prefer an explicit workerId, then role, then leave undefined so the host can ask the user.
 */
export function resolveBuiltinWorker(input: {
  workerId?: string;
  role?: string;
  createIfMissing?: boolean;
}): {worker?: WorkerDefinition; action: 'reuse' | 'missing' | 'needs_user'} {
  if (typeof input.workerId === 'string' && input.workerId.trim()) {
    const worker = workerById(input.workerId.trim());
    return worker ? {worker, action: 'reuse'} : {action: 'missing'};
  }
  if (typeof input.role === 'string' && input.role.trim()) {
    const worker = workerByRole(input.role.trim());
    if (worker) return {worker, action: 'reuse'};
    return input.createIfMissing ? {action: 'needs_user'} : {action: 'missing'};
  }
  return {action: 'needs_user'};
}

/** Read-only projection for Desktop / Renderer. Not a permission grant. */
export interface WorkerView {
  workerId: string;
  displayName: string;
  role: WorkerRole;
  kind: 'builtin' | 'user';
  preferredDriver: WorkerDriverPreference;
  instructions: string;
  status: 'idle' | 'working' | 'waiting_approval' | 'unavailable';
  activeTaskId?: string;
  parentTaskId?: string;
  lastSummary?: string;
  updatedAt?: string;
}

export function projectBuiltinWorkers(
  overlay?: ReadonlyMap<string, Partial<Pick<WorkerView, 'status' | 'activeTaskId' | 'parentTaskId' | 'lastSummary' | 'updatedAt'>>>,
): WorkerView[] {
  return DEFAULT_WORKERS.map(worker => {
    const live = overlay?.get(worker.workerId) ?? overlay?.get(worker.role);
    return {
      workerId: worker.workerId,
      displayName: worker.displayName,
      role: worker.role,
      kind: worker.kind,
      preferredDriver: worker.preferredDriver,
      instructions: worker.instructions,
      status: live?.status ?? 'idle',
      ...(live?.activeTaskId ? {activeTaskId: live.activeTaskId} : {}),
      ...(live?.parentTaskId ? {parentTaskId: live.parentTaskId} : {}),
      ...(live?.lastSummary ? {lastSummary: live.lastSummary} : {}),
      ...(live?.updatedAt ? {updatedAt: live.updatedAt} : {}),
    };
  });
}
