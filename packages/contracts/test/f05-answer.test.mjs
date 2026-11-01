import test from 'node:test';
import assert from 'node:assert/strict';
import {parseF05AnswerCandidate,f05AnswerCandidateSchema} from '../dist/f05-answer.js';

const candidate={version:1,answer:'A supported statement.',claims:[{id:'claim-1',text:'A supported statement.',
  citations:[{sourceId:'initial:0',quote:'Original quotation.'}]}],unresolved:[]};
test('F05 candidate accepts source references and detached values, without source authority',()=>{
  const value=parseF05AnswerCandidate(candidate);value.claims[0].citations[0].quote='changed';
  assert.equal(candidate.claims[0].citations[0].quote,'Original quotation.');
  const schema=f05AnswerCandidateSchema();schema.additionalProperties=true;
  assert.equal(f05AnswerCandidateSchema().additionalProperties,false);
});
test('F05 candidate rejects source paths, fabricated reference formats, empty quotes and unsupported versions',()=>{
  for(const changed of [
    {...candidate,version:2},{...candidate,path:'private.md'},
    {...candidate,claims:[{...candidate.claims[0],citations:[{sourceId:'file:///private.md',quote:'text'}]}]},
    {...candidate,claims:[{...candidate.claims[0],citations:[{sourceId:'initial:0',quote:''}]}]},
    {...candidate,claims:[{...candidate.claims[0],citations:[]}]},
  ])assert.throws(()=>parseF05AnswerCandidate(changed));
});
