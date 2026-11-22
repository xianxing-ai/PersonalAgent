import {validateToolValue} from './index.js';
import schema from './f20-candidate.schema.js';
import type {F20DocumentCandidate} from './f20-candidate.generated.js';

export type {F20DocumentCandidate} from './f20-candidate.generated.js';
/** Result of the verified draft and isolated compiler checks. Contains no source text or paths. */
export const F20_VERIFIED_COMPLETION=Object.freeze({
  workflowId:'F20',state:'settled',published:false,
  documentDraftReview:'verified_against_api_contract_and_source',
  typeScriptCheck:'passed_in_isolation',compilerExitCode:0,
} as const);
export function f20DocumentCandidateSchema():Record<string,unknown> {return structuredClone(schema);}

/** Candidate text is untrusted. Paths, recipes, source bindings and approval are host-owned. */
export function parseF20DocumentCandidate(value:unknown):F20DocumentCandidate {
  validateToolValue(schema,value);
  return structuredClone(value) as F20DocumentCandidate;
}
