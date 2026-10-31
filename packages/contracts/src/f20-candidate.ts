import {validateToolValue} from './index.js';
import schema from './f20-candidate.schema.js';
import type {F20DocumentCandidate} from './f20-candidate.generated.js';

export type {F20DocumentCandidate} from './f20-candidate.generated.js';

/** Candidate text is untrusted. Paths, recipes, source bindings and approval are host-owned. */
export function parseF20DocumentCandidate(value:unknown):F20DocumentCandidate {
  validateToolValue(schema,value);
  return structuredClone(value) as F20DocumentCandidate;
}
