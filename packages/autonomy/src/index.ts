export {
  TOOL_CATEGORIES,
  IRREVERSIBLE_CATEGORIES,
  RISK_CLASSIFICATION_TABLE,
  classifyTool,
  isToolCategory,
} from './classification.js';
export type {
  ToolCategory,
  RiskTier,
  ToolSideEffect,
  IrreversibleCategory,
  CompensationAction,
  RiskTableEntry,
  ClassifiedToolInput,
  RiskClassification,
} from './classification.js';
export {
  AUTONOMY_STANCES,
  MemoryAutonomyConfigStore,
  AutonomyPolicyConfig,
  allowedDispositions,
} from './config.js';
export type {
  AutonomyStance,
  AutonomyDisposition,
  AutonomySettingsSnapshot,
  AutonomyConfigStore,
  AutonomyDecision,
  CategorySettingDescription,
  AutonomySettingsDescription,
  AutonomyAuditRecord,
  AutonomyNotificationRecord,
  AutomaticExecutionInput,
  AutonomyPolicyConfigOptions,
} from './config.js';
export {applyAutonomyGrant, createRiskAutonomyGate} from './grant.js';
export type {AutonomyGrantRequest, AutonomyGrantResult, RiskAutonomyInvocation, RiskAutonomyReview, RiskAutonomyGate} from './grant.js';
