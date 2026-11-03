import {ProtocolError} from '@personal-agent/contracts';

/**
 * 开发者方向的自主级别。未登记仓库保持 observe，避免改掉现有逐次授权。
 * 已登记仓库的产品默认档是 act_all_but_irreversible。不可逆动作在任何档位都不自动放行。
 */
export const AUTONOMY_LEVELS = ['observe', 'suggest', 'act_reversible', 'act_all_but_irreversible'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const UNCONFIGURED_AUTONOMY_LEVEL: AutonomyLevel = 'observe';
export const ENROLLED_AUTONOMY_LEVEL: AutonomyLevel = 'act_all_but_irreversible';

export type ToolRisk = 'read' | 'reversible_write' | 'irreversible' | 'privileged';
export type ToolSideEffect = 'read' | 'local_write' | 'external_write';

/** 这些动作在任何自主级别下都要人确认。名称和 action 两边都认。 */
export const IRREVERSIBLE_TOOL_NAMES = [
  'github.pr.merge',
  'git.push.force',
  'git.branch.delete',
  'github.release.publish',
  'github.permission.change',
  'mail.send',
  'messages.send',
] as const;

export const IRREVERSIBLE_ACTIONS = [
  'merge',
  'force_push',
  'delete_branch',
  'release',
  'permission_change',
  'external_message',
] as const;

const REVERSIBLE_TOOL_NAMES = new Set([
  'github.pr.comment',
  'github.pr.create',
  'github.issue.comment',
  'github.issue.label',
  'git.commit',
  'git.push',
  'duty.comment.publish',
]);

const PRIVILEGED_TOOL_NAMES = new Set([
  'github.permission.change',
  'git.push.force',
  'secrets.write',
]);

export interface AutonomyScope {
  repo: string;
  branchPattern: string;
  /** 空数组表示该仓库分支上的全部工具名都进入本授权，风险分类仍然生效。 */
  toolNames: readonly string[];
}

export interface AutonomyLimits {
  perDay: number;
  perHour: number;
}

export interface StandingAutonomyGrant {
  id: string;
  scope: AutonomyScope;
  level: AutonomyLevel;
  limits: AutonomyLimits;
  expiresAt: string;
  revoked: boolean;
  hourBucket: string;
  hourCount: number;
  dayBucket: string;
  dayCount: number;
}

export interface AutonomyAudit {
  grantId?: string;
  reversibleClass: string;
  compensation?: string;
}

export interface AutonomyDecision {
  allow: boolean;
  mode: 'deny' | 'suggest' | 'auto';
  level: AutonomyLevel;
  risk: ToolRisk;
  reason: string;
  audit: AutonomyAudit;
}

export interface StandingRoutineDecision {
  allow: boolean;
  mode: 'deny' | 'suggest' | 'auto';
  risk: ToolRisk;
  reason?: string;
  audit?: {reversibleClass?: string};
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const fail = (code: 'INVALID_ARGUMENT' | 'SCOPE_DENIED', message: string): never => {
  throw new ProtocolError(code, message);
};

export function autonomyRank(level: AutonomyLevel): number {
  const rank = AUTONOMY_LEVELS.indexOf(level);
  if (rank < 0) fail('INVALID_ARGUMENT', 'Autonomy level is invalid');
  return rank;
}

export function assertAutonomyChange(input: {from: AutonomyLevel; to: AutonomyLevel; present: boolean}): void {
  if (!AUTONOMY_LEVELS.includes(input.from) || !AUTONOMY_LEVELS.includes(input.to)) fail('INVALID_ARGUMENT', 'Autonomy level is invalid');
  if (autonomyRank(input.to) > autonomyRank(input.from) && input.present !== true) {
    fail('SCOPE_DENIED', 'Raising autonomy requires the user to be present');
  }
}

export function classifyToolRisk(input: {toolName: string; action?: string; sideEffect?: ToolSideEffect}): ToolRisk {
  const name = input.toolName.trim();
  const action = input.action?.trim();
  if ((IRREVERSIBLE_TOOL_NAMES as readonly string[]).includes(name) || (action !== undefined && (IRREVERSIBLE_ACTIONS as readonly string[]).includes(action))) {
    return 'irreversible';
  }
  if (PRIVILEGED_TOOL_NAMES.has(name) || action === 'privileged') return 'privileged';
  if (input.sideEffect === 'read' || name.endsWith('.read') || name.endsWith('.list') || name.endsWith('.get')) return 'read';
  if (REVERSIBLE_TOOL_NAMES.has(name) || input.sideEffect === 'local_write') return 'reversible_write';
  if (input.sideEffect === 'external_write') return 'privileged';
  return 'privileged';
}

function branchMatches(pattern: string, branch: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  const expression = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`;
  return new RegExp(expression).test(branch);
}

function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function hourBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}

function downgrade(level: AutonomyLevel): AutonomyLevel {
  const rank = autonomyRank(level);
  return AUTONOMY_LEVELS[Math.max(0, rank - 1)] ?? 'observe';
}

function decision(partial: Omit<AutonomyDecision, 'audit'> & {audit?: AutonomyAudit}): AutonomyDecision {
  return {...partial, audit: partial.audit ?? {reversibleClass: 'none'}};
}

export function createStandingGrant(input: {
  id: string;
  scope: AutonomyScope;
  level?: AutonomyLevel;
  limits: AutonomyLimits;
  expiresAt: string;
  now: number;
}): StandingAutonomyGrant {
  if (!input.id.trim() || input.id.length > 80) fail('INVALID_ARGUMENT', 'Standing grant id is invalid');
  if (!REPO.test(input.scope.repo)) fail('INVALID_ARGUMENT', 'Repository name is invalid');
  if (!input.scope.branchPattern.trim() || input.scope.branchPattern.length > 200) fail('INVALID_ARGUMENT', 'Branch pattern is invalid');
  if (input.scope.toolNames.some(name => !name.trim() || name.length > 120)) fail('INVALID_ARGUMENT', 'Tool name is invalid');
  const level = input.level ?? ENROLLED_AUTONOMY_LEVEL;
  if (!AUTONOMY_LEVELS.includes(level)) fail('INVALID_ARGUMENT', 'Autonomy level is invalid');
  if (!Number.isSafeInteger(input.limits.perDay) || input.limits.perDay < 1 || input.limits.perDay > 10_000) fail('INVALID_ARGUMENT', 'Daily limit is invalid');
  if (!Number.isSafeInteger(input.limits.perHour) || input.limits.perHour < 1 || input.limits.perHour > input.limits.perDay) fail('INVALID_ARGUMENT', 'Hourly limit is invalid');
  if (!Number.isFinite(Date.parse(input.expiresAt))) fail('INVALID_ARGUMENT', 'expiresAt must be an ISO timestamp');
  return {
    id: input.id.trim(),
    scope: {repo: input.scope.repo, branchPattern: input.scope.branchPattern, toolNames: [...input.scope.toolNames]},
    level,
    limits: {perDay: input.limits.perDay, perHour: input.limits.perHour},
    expiresAt: input.expiresAt,
    revoked: false,
    hourBucket: hourBucket(input.now),
    hourCount: 0,
    dayBucket: dayBucket(input.now),
    dayCount: 0,
  };
}

export function revokeStandingGrant(grant: StandingAutonomyGrant): StandingAutonomyGrant {
  return {...grant, revoked: true};
}

function usage(grant: StandingAutonomyGrant, now: number): {hour: number; day: number} {
  return {
    hour: grant.hourBucket === hourBucket(now) ? grant.hourCount : 0,
    day: grant.dayBucket === dayBucket(now) ? grant.dayCount : 0,
  };
}

export function consumeAutonomyUse(grant: StandingAutonomyGrant, now: number): StandingAutonomyGrant {
  const current = usage(grant, now);
  return {
    ...grant,
    hourBucket: hourBucket(now),
    hourCount: current.hour + 1,
    dayBucket: dayBucket(now),
    dayCount: current.day + 1,
  };
}

function effectiveRisk(level: AutonomyLevel, risk: ToolRisk): ToolRisk {
  if (level === 'act_all_but_irreversible' && risk === 'privileged') return 'reversible_write';
  return risk;
}

export function decideAutonomy(input: {
  grant?: StandingAutonomyGrant;
  toolName: string;
  action?: string;
  sideEffect?: ToolSideEffect;
  repo: string;
  branch: string;
  now: number;
  untrustedDerived?: boolean;
}): AutonomyDecision {
  const risk = classifyToolRisk({toolName: input.toolName, ...(input.action === undefined ? {} : {action: input.action}), ...(input.sideEffect === undefined ? {} : {sideEffect: input.sideEffect})});
  const reversibleClass = `${input.repo}@${input.branch}:${input.toolName}${input.action ? `:${input.action}` : ''}`;
  const grant = input.grant;
  if (!grant || grant.revoked || grant.scope.repo !== input.repo || !branchMatches(grant.scope.branchPattern, input.branch)
    || (grant.scope.toolNames.length > 0 && !grant.scope.toolNames.includes(input.toolName))
    || !Number.isFinite(input.now) || input.now >= Date.parse(grant.expiresAt)) {
    return decision({allow: risk === 'read', mode: risk === 'read' ? 'auto' : 'deny', level: UNCONFIGURED_AUTONOMY_LEVEL, risk, reason: grant ? 'standing grant does not cover this call' : 'repository has no standing grant', audit: {reversibleClass, ...(grant ? {grantId: grant.id} : {})}});
  }
  const level = input.untrustedDerived === true ? downgrade(grant.level) : grant.level;
  const seen = effectiveRisk(level, risk);
  const counts = usage(grant, input.now);
  if (counts.hour >= grant.limits.perHour || counts.day >= grant.limits.perDay) {
    return decision({allow: false, mode: 'deny', level, risk: seen, reason: 'standing grant rate limit reached', audit: {grantId: grant.id, reversibleClass}});
  }
  if (seen === 'irreversible' || risk === 'irreversible') {
    return decision({allow: false, mode: 'deny', level, risk: 'irreversible', reason: 'irreversible actions always require confirmation', audit: {grantId: grant.id, reversibleClass, compensation: 'listed'}});
  }
  if (level === 'observe') {
    return decision({allow: seen === 'read', mode: seen === 'read' ? 'auto' : 'deny', level, risk: seen, reason: seen === 'read' ? 'observe allows reads' : 'observe does not act', audit: {grantId: grant.id, reversibleClass}});
  }
  if (level === 'suggest') {
    return decision({allow: seen === 'read', mode: seen === 'read' ? 'auto' : 'suggest', level, risk: seen, reason: seen === 'read' ? 'suggest allows reads' : 'suggest records a proposal and does not write', audit: {grantId: grant.id, reversibleClass}});
  }
  if (seen === 'read' || seen === 'reversible_write') {
    return decision({allow: true, mode: 'auto', level, risk: seen, reason: input.untrustedDerived === true ? 'auto after untrusted content downgraded the level' : 'standing grant covers this reversible action', audit: {grantId: grant.id, reversibleClass}});
  }
  return decision({allow: false, mode: 'deny', level, risk: seen, reason: 'privileged action stays gated', audit: {grantId: grant.id, reversibleClass}});
}

/** 给 Runtime 例行放行用。不可逆、特权和需要在场的工具不会变成自动授权。 */
export function standingRoutineAllowed(input: {
  sideEffect: ToolSideEffect;
  requiresPresence: boolean;
  decision: StandingRoutineDecision | undefined;
}): boolean {
  const decision = input.decision;
  if (!decision || decision.allow !== true || decision.mode !== 'auto' || input.requiresPresence) return false;
  if (decision.risk === 'irreversible' || decision.risk === 'privileged') return false;
  if (input.sideEffect === 'read') return decision.risk === 'read';
  return decision.risk === 'reversible_write';
}
