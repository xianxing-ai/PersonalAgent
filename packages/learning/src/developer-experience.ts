import {isDeepStrictEqual} from 'node:util';
import {LearningError, type LearningContext, type SqliteLearningHost, type WorkflowVersion,
  type ActivateWorkflowRequest, type StopWorkflowRequest, type ProposeWorkflowRequest} from './index.js';

/** Host-only source identities. This is descriptive policy, never a tool grant or wire operation. */
export interface DeveloperExperienceScope {
  readonly workspaceId: string;
  readonly workspaceDigest: string;
  readonly configurationDigest: string;
  readonly workflowVersion: string;
  readonly runtimeVersion: string;
  readonly recipeFingerprint: string;
}
export interface DeveloperExperienceSource {
  readonly sourceRef: string;
  readonly scope: DeveloperExperienceScope;
  readonly requiredRecipeIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}
export interface DeveloperExperienceLease {
  readonly namespace: string;
  readonly workflowId: string;
  readonly revision: number;
  readonly activationSequence: number;
  readonly source: DeveloperExperienceSource;
}
export interface DeveloperExperiencePorts {
  /** Original Runtime confirmed executions and selected artifact, under the original mutation fence.
   * Synchronous: do not combine async cached source/workspace/configuration authorities. */
  readConfirmedSource(sourceRef: string, context: LearningContext): DeveloperExperienceSource | undefined;
  /** A host/native decision obtained separately from candidate validation; never an LLM boolean. */
  confirmActivation(candidate: WorkflowVersion, context: LearningContext): Promise<boolean>;
}

const fail = (code: 'INVALID_ARGUMENT' | 'NOT_VALIDATED' | 'REVISION_CONFLICT' | 'CANCELLED' | 'TIMEOUT'): never => {
  throw new LearningError(code);
};
const validText = (v: unknown, max = 128): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sameKeys = (v: object, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
function active(context: LearningContext): void {
  if (!context || typeof context.signal?.aborted !== 'boolean') fail('INVALID_ARGUMENT');
  if (context.signal.aborted) fail('CANCELLED');
  if (!Number.isFinite(Date.parse(context.deadline))) fail('INVALID_ARGUMENT');
  if (Date.now() >= Date.parse(context.deadline)) fail('TIMEOUT');
}
export function assertDeveloperExperienceScope(value: DeveloperExperienceScope): void {
  if (!value || typeof value !== 'object' || !sameKeys(value,
    ['workspaceId','workspaceDigest','configurationDigest','workflowVersion','runtimeVersion','recipeFingerprint'])
    || !validText(value.workspaceId) || !validText(value.workflowVersion) || !validText(value.runtimeVersion)
    || !sha(value.workspaceDigest) || !sha(value.configurationDigest) || !sha(value.recipeFingerprint)) fail('INVALID_ARGUMENT');
}
function checkedSource(sourceRef: string, value: DeveloperExperienceSource | undefined): DeveloperExperienceSource {
  // Reject thenables explicitly: an async implementation reopens source/activation races.
  if (!value || typeof value !== 'object' || !sameKeys(value,['sourceRef','scope','requiredRecipeIds','evidenceRefs'])
    || value.sourceRef !== sourceRef || !/^developer-experience:v1:[A-Za-z0-9_-]{1,344}:[a-f0-9]{64}$/.test(sourceRef)
    || !Array.isArray(value.requiredRecipeIds) || value.requiredRecipeIds.length < 1 || value.requiredRecipeIds.length > 16
    || value.requiredRecipeIds.some(id => !validText(id)) || new Set(value.requiredRecipeIds).size !== value.requiredRecipeIds.length
    || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 64
    || value.evidenceRefs.some(id => !validText(id,256)) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) fail('NOT_VALIDATED');
  assertDeveloperExperienceScope(value.scope);
  return structuredClone(value);
}
const summary = 'Original selected development artifact, freshly verified and published; retain the original validation and authorization boundaries.';
const steps = (source: DeveloperExperienceSource) => source.requiredRecipeIds.map(id => `verify:${id}`);

/** Reuses the existing candidate/validation/activation/stop lifecycle and database. */
export function createDeveloperExperienceApplication(options: {
  namespace: string; learning: SqliteLearningHost; ports: DeveloperExperiencePorts;
}) {
  const {namespace, learning, ports} = options;
  if (!validText(namespace)) fail('INVALID_ARGUMENT');
  const readSource = (sourceRef: string, context: LearningContext) => {
    active(context);
    learning.assertSourceAvailable(namespace, sourceRef);
    const value = checkedSource(sourceRef, ports.readConfirmedSource(sourceRef, context));
    active(context);
    return value;
  };
  const checkVersion = (version: WorkflowVersion, context: LearningContext) => {
    const source = readSource(version.sourceRef, context);
    if (version.namespace !== namespace || version.summary !== summary || !isDeepStrictEqual(version.steps, steps(source))
      || (version.validation === 'passed' && version.evidenceRef !== source.sourceRef)) fail('NOT_VALIDATED');
    return source;
  };
  return Object.freeze({
    propose(request: Omit<ProposeWorkflowRequest,'namespace'|'summary'|'steps'>): WorkflowVersion {
      const source = readSource(request.sourceRef, request);
      return learning.propose({...request,namespace,summary,steps:steps(source)});
    },
    async validate(workflowId: string, revision: number, context: LearningContext): Promise<WorkflowVersion> {
      active(context);
      const version = learning.readVersion(namespace,workflowId,revision);
      const original = checkVersion(version,context);
      // Even an already validated version must still have its original current source.
      const result = await learning.validate(namespace,workflowId,revision,{validate: async candidate => {
        const again = readSource(candidate.sourceRef,context);
        if (!isDeepStrictEqual(again,original)) fail('REVISION_CONFLICT');
        return {passed:true,evidenceRef:again.sourceRef};
      }},context);
      active(context);
      if (!isDeepStrictEqual(checkVersion(result,context),original)) fail('REVISION_CONFLICT');
      return result;
    },
    async activate(request: Omit<ActivateWorkflowRequest,'namespace'>) {
      active(request);
      const candidate = learning.readVersion(namespace,request.workflowId,request.revision);
      if (candidate.validation !== 'passed') fail('NOT_VALIDATED');
      const original = checkVersion(candidate,request);
      if (!await ports.confirmActivation(structuredClone(candidate),request)) fail('NOT_VALIDATED');
      active(request);
      if (!isDeepStrictEqual(checkVersion(candidate,request),original)) fail('REVISION_CONFLICT');
      return learning.activateVersion({...request,namespace});
    },
    stop(request: Omit<StopWorkflowRequest,'namespace'>): void {
      active(request);
      learning.stopWorkflow({...request,namespace});
    },
    readApplicable(workflowId: string, scope: DeveloperExperienceScope, context: LearningContext): DeveloperExperienceLease | null {
      active(context); assertDeveloperExperienceScope(scope);
      const current = learning.readActiveSelection(namespace,workflowId);
      if (!current) return null;
      const source = checkVersion(current.version,context);
      if (!isDeepStrictEqual(source.scope,scope)) fail('REVISION_CONFLICT');
      return {namespace,workflowId,revision:current.version.revision,activationSequence:current.sequence,source};
    },
    /** Invoke at dispatch, before every later consumption, and on resume. No permission is returned. */
    assertApplicable(lease: DeveloperExperienceLease, scope: DeveloperExperienceScope, context: LearningContext) {
      active(context); assertDeveloperExperienceScope(scope);
      if (!lease || lease.namespace !== namespace) fail('REVISION_CONFLICT');
      const selected = learning.readActiveSelection(namespace,lease.workflowId);
      if (!selected || selected.version.revision !== lease.revision || selected.sequence !== lease.activationSequence) fail('REVISION_CONFLICT');
      const source = checkVersion(selected.version,context);
      if (!isDeepStrictEqual(source,lease.source) || !isDeepStrictEqual(source.scope,scope)) fail('REVISION_CONFLICT');
      return Object.freeze({version:1 as const,requiredRecipeIds:Object.freeze([...source.requiredRecipeIds])});
    },
  });
}
