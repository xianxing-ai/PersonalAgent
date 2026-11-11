import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {classifyTool} from './classification.js';
import type {ClassifiedToolInput, RiskClassification, ToolCategory} from './classification.js';
import {IRREVERSIBLE_CATEGORIES, TOOL_CATEGORIES, isToolCategory} from './classification.js';

export const AUTONOMY_STANCES = ['conservative', 'balanced', 'autonomous'] as const;
export type AutonomyStance = (typeof AUTONOMY_STANCES)[number];
export type AutonomyDisposition = 'execute' | 'execute_and_notify' | 'ask';

export interface AutonomySettingsSnapshot {
  stance: AutonomyStance;
  revoked: boolean;
  categoryOverrides: Partial<Record<ToolCategory, AutonomyDisposition>>;
  revision: number;
}

export interface AutonomyConfigStore {
  load(): AutonomySettingsSnapshot | undefined;
  save(snapshot: AutonomySettingsSnapshot): void;
}

export class MemoryAutonomyConfigStore implements AutonomyConfigStore {
  private snapshot: AutonomySettingsSnapshot | undefined;
  load(): AutonomySettingsSnapshot | undefined {
    return this.snapshot ? cloneSnapshot(this.snapshot) : undefined;
  }
  save(snapshot: AutonomySettingsSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot);
  }
}

export interface AutonomyDecision {
  disposition: AutonomyDisposition;
  stance: AutonomyStance;
  category: ToolCategory;
  tier: RiskClassification['tier'];
  irreversible: boolean;
  compensatable: boolean;
  overrideApplied: boolean;
  reason: string;
  compensation?: RiskClassification['compensation'];
}

export interface CategorySettingDescription {
  category: ToolCategory;
  floor: 'ask' | 'adjustable';
  allowedDispositions: readonly AutonomyDisposition[];
  override?: AutonomyDisposition;
}

export interface AutonomySettingsDescription {
  stance: AutonomyStance;
  stances: readonly AutonomyStance[];
  revoked: boolean;
  revision: number;
  categories: readonly CategorySettingDescription[];
}

export interface AutonomyAuditRecord {
  auditId: string;
  runId: string;
  at: string;
  taskId?: string;
  toolName: string;
  toolVersion: string;
  argumentsDigest: string;
  category: ToolCategory;
  tier: RiskClassification['tier'];
  disposition: 'execute' | 'execute_and_notify';
  stance: AutonomyStance;
  immediate: boolean;
  compensatable: boolean;
  compensation?: RiskClassification['compensation'];
  rollback: 'unavailable' | 'available' | 'requested';
}

export interface AutonomyNotificationRecord {
  notificationId: string;
  auditId: string;
  at: string;
  toolName: string;
  immediate: boolean;
  summary: string;
  undoAvailable: boolean;
}

export interface AutomaticExecutionInput extends ClassifiedToolInput {
  runId: string;
  toolVersion: string;
  argumentsDigest: string;
  taskId?: string;
}

const DIGEST = /^[a-f0-9]{64}$/;

const defaultSnapshot = (): AutonomySettingsSnapshot => ({
  stance: 'autonomous',
  revoked: false,
  categoryOverrides: {},
  revision: 0,
});

const cloneSnapshot = (snapshot: AutonomySettingsSnapshot): AutonomySettingsSnapshot => ({
  stance: snapshot.stance,
  revoked: snapshot.revoked,
  revision: snapshot.revision,
  categoryOverrides: {...snapshot.categoryOverrides},
});

export function allowedDispositions(category: ToolCategory): readonly AutonomyDisposition[] {
  if (category === 'read' || category === 'local_reversible_write') return ['execute', 'execute_and_notify', 'ask'];
  return ['ask'];
}

const assertDisposition = (value: string): AutonomyDisposition => {
  if (value !== 'execute' && value !== 'execute_and_notify' && value !== 'ask') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy disposition is invalid');
  }
  return value;
};

const assertOverrideAllowed = (category: ToolCategory, disposition: AutonomyDisposition): void => {
  if (!allowedDispositions(category).includes(disposition)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'This category cannot run automatically');
  }
  if (disposition === 'execute_and_notify' && category !== 'read' && category !== 'local_reversible_write') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Notify-after-execution requires a compensation action');
  }
  if ((IRREVERSIBLE_CATEGORIES as readonly string[]).includes(category) && disposition !== 'ask') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Irreversible actions cannot run automatically');
  }
};

const parseSnapshot = (raw: AutonomySettingsSnapshot): AutonomySettingsSnapshot => {
  if (!AUTONOMY_STANCES.includes(raw.stance)) throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy stance is invalid');
  if (typeof raw.revoked !== 'boolean') throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy revoked flag is invalid');
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy revision is invalid');
  const categoryOverrides: Partial<Record<ToolCategory, AutonomyDisposition>> = {};
  for (const [key, value] of Object.entries(raw.categoryOverrides ?? {})) {
    if (!isToolCategory(key) || typeof value !== 'string') throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy category override is invalid');
    const disposition = assertDisposition(value);
    assertOverrideAllowed(key, disposition);
    categoryOverrides[key] = disposition;
  }
  return {stance: raw.stance, revoked: raw.revoked, revision: raw.revision, categoryOverrides};
};

const stanceDisposition = (stance: AutonomyStance, classification: RiskClassification): AutonomyDisposition => {
  if (classification.floorAsk || classification.irreversible) return 'ask';
  if (stance === 'conservative') return 'ask';
  if (stance === 'balanced') return classification.tier === 'low' ? 'execute' : 'ask';
  if (classification.tier === 'low') return 'execute';
  if (classification.tier === 'medium' && classification.compensatable) return 'execute_and_notify';
  return 'ask';
};

export interface AutonomyPolicyConfigOptions {
  stance?: AutonomyStance;
  now?: () => Date;
  idFactory?: () => string;
  store?: AutonomyConfigStore;
}

export class AutonomyPolicyConfig {
  private snapshot: AutonomySettingsSnapshot;
  private readonly audits: AutonomyAuditRecord[] = [];
  private readonly notifications: AutonomyNotificationRecord[] = [];
  private readonly auditsByRun = new Map<string, AutonomyAuditRecord>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly store: AutonomyConfigStore | undefined;

  constructor(options: AutonomyPolicyConfigOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.store = options.store;
    const loaded = options.store?.load();
    if (loaded) this.snapshot = parseSnapshot(loaded);
    else {
      this.snapshot = defaultSnapshot();
      if (options.stance !== undefined) {
        if (!AUTONOMY_STANCES.includes(options.stance)) throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy stance is invalid');
        this.snapshot = {...this.snapshot, stance: options.stance};
      }
    }
  }

  getSettings(): AutonomySettingsSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  describeSettings(): AutonomySettingsDescription {
    return {
      stance: this.snapshot.stance,
      stances: AUTONOMY_STANCES,
      revoked: this.snapshot.revoked,
      revision: this.snapshot.revision,
      categories: TOOL_CATEGORIES.map(category => {
        const override = this.snapshot.categoryOverrides[category];
        return {
          category,
          floor: allowedDispositions(category).length === 1 ? 'ask' : 'adjustable',
          allowedDispositions: allowedDispositions(category),
          ...(override === undefined ? {} : {override}),
        };
      }),
    };
  }

  setStance(stance: AutonomyStance): AutonomySettingsSnapshot {
    if (!AUTONOMY_STANCES.includes(stance)) throw new ProtocolError('INVALID_ARGUMENT', 'Autonomy stance is invalid');
    this.snapshot = {...this.snapshot, stance, revision: this.snapshot.revision + 1};
    this.persist();
    return this.getSettings();
  }

  setCategoryOverride(category: ToolCategory, disposition: AutonomyDisposition): AutonomySettingsSnapshot {
    if (!isToolCategory(category)) throw new ProtocolError('INVALID_ARGUMENT', 'Tool category is invalid');
    assertDisposition(disposition);
    assertOverrideAllowed(category, disposition);
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      categoryOverrides: {...this.snapshot.categoryOverrides, [category]: disposition},
    };
    this.persist();
    return this.getSettings();
  }

  clearCategoryOverride(category: ToolCategory): AutonomySettingsSnapshot {
    if (!isToolCategory(category)) throw new ProtocolError('INVALID_ARGUMENT', 'Tool category is invalid');
    const categoryOverrides = {...this.snapshot.categoryOverrides};
    delete categoryOverrides[category];
    this.snapshot = {...this.snapshot, categoryOverrides, revision: this.snapshot.revision + 1};
    this.persist();
    return this.getSettings();
  }

  /** 立即停止后续自动执行。已发生动作的补偿请求仍然可用。 */
  revoke(): AutonomySettingsSnapshot {
    this.snapshot = {...this.snapshot, revoked: true, revision: this.snapshot.revision + 1};
    this.persist();
    return this.getSettings();
  }

  restore(): AutonomySettingsSnapshot {
    this.snapshot = {...this.snapshot, revoked: false, revision: this.snapshot.revision + 1};
    this.persist();
    return this.getSettings();
  }

  reset(): AutonomySettingsSnapshot {
    this.snapshot = {...defaultSnapshot(), revision: this.snapshot.revision + 1};
    this.persist();
    return this.getSettings();
  }

  decide(input: ClassifiedToolInput): AutonomyDecision {
    const classification = classifyTool(input);
    if (this.snapshot.revoked) {
      return this.decision(classification, 'ask', false, 'autonomy revoked');
    }
    const override = this.snapshot.categoryOverrides[classification.category];
    if (override !== undefined) {
      if (classification.floorAsk || classification.irreversible) {
        return this.decision(classification, 'ask', false, 'irreversible or non-compensatable action stays gated');
      }
      if (override === 'execute_and_notify' && classification.category !== 'read' && !classification.compensatable) {
        return this.decision(classification, 'ask', false, 'notify-after-execution requires compensation');
      }
      return this.decision(classification, override, true, 'category override');
    }
    return this.decision(classification, stanceDisposition(this.snapshot.stance, classification), false,
      classification.floorAsk || classification.irreversible ? 'action stays gated' : 'stance default');
  }

  recordAutomatic(input: AutomaticExecutionInput): {audit: AutonomyAuditRecord; notification: AutonomyNotificationRecord} {
    const runId = requiredToken(input.runId, 'runId', 200);
    const toolVersion = requiredToken(input.toolVersion, 'toolVersion', 80);
    const argumentsDigest = input.argumentsDigest.trim();
    if (!DIGEST.test(argumentsDigest)) throw new ProtocolError('INVALID_ARGUMENT', 'argumentsDigest is invalid');
    const decision = this.decide(input);
    if (decision.disposition === 'ask' || decision.irreversible) {
      throw new ProtocolError('UNAUTHORIZED', 'Automatic execution is not allowed');
    }
    const existing = this.auditsByRun.get(runId);
    if (existing) {
      if (existing.toolName !== input.toolName.trim() || existing.argumentsDigest !== argumentsDigest
        || existing.toolVersion !== toolVersion || existing.disposition !== decision.disposition) {
        throw new ProtocolError('REVISION_CONFLICT', 'Automatic execution record changed');
      }
      const notification = this.notifications.find(item => item.auditId === existing.auditId);
      if (!notification) throw new ProtocolError('REVISION_CONFLICT', 'Automatic notification record is missing');
      return {audit: existing, notification};
    }
    const at = this.now().toISOString();
    const audit: AutonomyAuditRecord = {
      auditId: this.idFactory(),
      runId,
      at,
      toolName: input.toolName.trim(),
      toolVersion,
      argumentsDigest,
      category: decision.category,
      tier: decision.tier,
      disposition: decision.disposition,
      stance: decision.stance,
      immediate: decision.disposition === 'execute_and_notify',
      compensatable: decision.compensatable,
      rollback: decision.compensatable && decision.compensation ? 'available' : 'unavailable',
      ...(input.taskId === undefined ? {} : {taskId: requiredToken(input.taskId, 'taskId', 200)}),
      ...(decision.compensation ? {compensation: {action: decision.compensation.action, summary: decision.compensation.summary}} : {}),
    };
    const notification: AutonomyNotificationRecord = {
      notificationId: this.idFactory(),
      auditId: audit.auditId,
      at,
      toolName: audit.toolName,
      immediate: audit.immediate,
      undoAvailable: audit.rollback === 'available',
      summary: audit.immediate ? `已完成可回滚动作 ${audit.toolName}` : `已自动完成 ${audit.toolName}`,
    };
    this.audits.push(audit);
    this.notifications.push(notification);
    this.auditsByRun.set(runId, audit);
    return {audit, notification};
  }

  requestUndo(auditId: string): {auditId: string; state: 'rollback_requested'; compensation: {action: string; summary: string}} {
    const id = requiredToken(auditId, 'auditId', 80);
    const audit = this.audits.find(item => item.auditId === id);
    if (!audit) throw new ProtocolError('NOT_FOUND', 'Automatic execution record was not found');
    if (!audit.compensatable || !audit.compensation || audit.rollback === 'unavailable') {
      throw new ProtocolError('INVALID_ARGUMENT', 'This action has no compensation');
    }
    audit.rollback = 'requested';
    return {auditId: audit.auditId, state: 'rollback_requested', compensation: {...audit.compensation}};
  }

  listAudits(): readonly AutonomyAuditRecord[] {
    return this.audits.map(cloneAudit);
  }

  listNotifications(): readonly AutonomyNotificationRecord[] {
    return this.notifications.map(item => ({...item}));
  }

  private decision(classification: RiskClassification, disposition: AutonomyDisposition, overrideApplied: boolean, reason: string): AutonomyDecision {
    const safe = classification.floorAsk || classification.irreversible ? 'ask' : disposition;
    return {
      disposition: safe,
      stance: this.snapshot.stance,
      category: classification.category,
      tier: classification.tier,
      irreversible: classification.irreversible,
      compensatable: classification.compensatable,
      overrideApplied,
      reason: safe === 'ask' && disposition !== 'ask' ? 'action stays gated' : reason,
      ...(classification.compensation ? {compensation: {...classification.compensation}} : {}),
    };
  }

  private persist(): void {
    this.store?.save(this.getSettings());
  }
}

const requiredToken = (value: string, field: string, max: number): string => {
  const result = value.trim();
  if (!result || result.length > max) throw new ProtocolError('INVALID_ARGUMENT', `${field} is invalid`);
  return result;
};

const cloneAudit = (audit: AutonomyAuditRecord): AutonomyAuditRecord => ({
  ...audit,
  ...(audit.compensation ? {compensation: {...audit.compensation}} : {}),
});
