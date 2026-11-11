import {ProtocolError} from '@personal-agent/contracts';
import type {AuthorizationGrantInput, AuthorizationPolicy} from '@personal-agent/policy';
import type {AutonomyAuditRecord, AutonomyDecision, AutonomyPolicyConfig, AutomaticExecutionInput} from './config.js';
import type {ToolSideEffect} from './classification.js';

export interface AutonomyGrantRequest {
  grant: AuthorizationGrantInput;
  toolVersion: string;
  runId: string;
  argumentsDigest: string;
  taskId?: string;
  action?: string;
  sideEffect?: ToolSideEffect;
  recoverySupport?: boolean;
  requiresPresence?: boolean;
}

export interface AutonomyGrantResult {
  granted: boolean;
  decision: AutonomyDecision;
  audit?: AutonomyAuditRecord;
}

/**
 * 把自主档决定交给现有 Policy。只有 execute / execute_and_notify 才调用 grant；
 * ask 与不可逆动作不签发授权。
 */
export function applyAutonomyGrant(
  policy: Pick<AuthorizationPolicy, 'grant'>,
  config: AutonomyPolicyConfig,
  request: AutonomyGrantRequest,
): AutonomyGrantResult {
  const execution: AutomaticExecutionInput = {
    toolName: request.grant.toolName,
    toolVersion: request.toolVersion,
    runId: request.runId,
    argumentsDigest: request.argumentsDigest,
    ...(request.taskId === undefined ? {} : {taskId: request.taskId}),
    ...(request.action === undefined ? {} : {action: request.action}),
    ...(request.sideEffect === undefined ? {} : {sideEffect: request.sideEffect}),
    ...(request.recoverySupport === undefined ? {} : {recoverySupport: request.recoverySupport}),
    ...(request.requiresPresence === undefined ? {} : {requiresPresence: request.requiresPresence}),
  };
  const decision = config.decide(execution);
  if (decision.disposition === 'ask' || decision.irreversible) return {granted: false, decision};
  const {audit} = config.recordAutomatic(execution);
  policy.grant(request.grant);
  return {granted: true, decision, audit};
}

/** Runtime 可选钩子使用的结构。未安装时原 automaticTools 行为不变。 */
export interface RiskAutonomyInvocation {
  taskId: string;
  runId: string;
  toolName: string;
  toolVersion: string;
  sideEffect: ToolSideEffect;
  recoverySupport: boolean;
  requiresPresence: boolean;
  argumentsDigest: string;
}

export interface RiskAutonomyReview {
  disposition: 'execute' | 'execute_and_notify' | 'ask';
  irreversible: boolean;
  compensatable: boolean;
}

export interface RiskAutonomyGate {
  review(input: RiskAutonomyInvocation): RiskAutonomyReview;
  recordGranted(input: RiskAutonomyInvocation & {disposition: 'execute' | 'execute_and_notify'}): void;
}

export function createRiskAutonomyGate(config: AutonomyPolicyConfig): RiskAutonomyGate {
  return {
    review(input) {
      const decision = config.decide(toClassified(input));
      return {disposition: decision.disposition, irreversible: decision.irreversible, compensatable: decision.compensatable};
    },
    recordGranted(input) {
      const decision = config.decide(toClassified(input));
      if (decision.disposition !== input.disposition || decision.irreversible) {
        throw new ProtocolError('UNAUTHORIZED', 'Automatic execution is no longer allowed');
      }
      config.recordAutomatic({
        ...toClassified(input),
        runId: input.runId,
        toolVersion: input.toolVersion,
        argumentsDigest: input.argumentsDigest,
        taskId: input.taskId,
      });
    },
  };
}

const toClassified = (input: RiskAutonomyInvocation) => ({
  toolName: input.toolName,
  sideEffect: input.sideEffect,
  recoverySupport: input.recoverySupport,
  requiresPresence: input.requiresPresence,
});
