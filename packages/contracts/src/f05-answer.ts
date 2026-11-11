import {validateToolValue} from './index.js';
import schema from './f05-answer.schema.js';
import type {F05AnswerCandidate} from './f05-answer.generated.js';

export type {F05AnswerCandidate} from './f05-answer.generated.js';
export function f05AnswerCandidateSchema():Record<string,unknown> {return structuredClone(schema);}
/** Candidate source IDs are references to original host receipts, never paths or authority. */
export function parseF05AnswerCandidate(value:unknown):F05AnswerCandidate {
  validateToolValue(schema,value);
  return structuredClone(value) as F05AnswerCandidate;
}
