import test from 'node:test';
import assert from 'node:assert/strict';
import {parseF20DocumentCandidate,f20DocumentCandidateSchema} from '../dist/f20-candidate.js';

test('F20 candidates contain bounded text only; host bindings cannot be supplied by the model',()=>{
  const candidate={version:1,docMarkdown:'# API\nExample',sampleSnippet:'export const example = true;'};
  const parsed=parseF20DocumentCandidate(candidate);
  assert.deepEqual(parsed,candidate);assert.notEqual(parsed,candidate);
  for(const change of [{path:'../outside.ts'},{recipeId:'arbitrary'},{approved:true},{sourceVersion:'forged'},
    {version:2},{docMarkdown:''},{docMarkdown:'\0'},{docMarkdown:'x'.repeat(262145)},
    {sampleSnippet:''},{sampleSnippet:'\0'},{sampleSnippet:'x'.repeat(65537)},
    {extraField:'injected'},{patches:[]},{targetDoc:'api.md'},{samplePath:'sample.ts'}])
    assert.throws(()=>parseF20DocumentCandidate({...candidate,...change}));
});

test('F20 candidate rejects non-object, missing required fields, and validates schema definition',()=>{
  const schema=f20DocumentCandidateSchema();
  assert.equal(schema.type,'object');
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(schema.required,['version','docMarkdown','sampleSnippet']);
  for(const invalid of [null,undefined,'',123,[],{},{version:1},{version:1,docMarkdown:'# A'},{version:1,sampleSnippet:'b'}]) {
    assert.throws(()=>parseF20DocumentCandidate(invalid));
  }
});
