import test from 'node:test';
import assert from 'node:assert/strict';
import {parseF20DocumentCandidate} from '../dist/f20-candidate.js';

test('F20 candidates contain bounded text only; host bindings cannot be supplied by the model',()=>{
  const candidate={version:1,docMarkdown:'# API\nExample',sampleSnippet:'export const example = true;'};
  const parsed=parseF20DocumentCandidate(candidate);
  assert.deepEqual(parsed,candidate);assert.notEqual(parsed,candidate);
  for(const change of [{path:'../outside.ts'},{recipeId:'arbitrary'},{approved:true},{sourceVersion:'forged'},
    {version:2},{docMarkdown:''},{sampleSnippet:'\0'},{sampleSnippet:'x'.repeat(65537)}])
    assert.throws(()=>parseF20DocumentCandidate({...candidate,...change}));
});
