import assert from 'node:assert/strict';
import test from 'node:test';
import {parseAgentInput,repairInput} from '../dist/input.js';
const node=(id,revision,kind,summary)=>({id,revision,kind,summary,state:'active',
  validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'});
const reference=(id,revision)=>({id,revision});
function fixture() {
  return {repairContext:{expectedGraphRevision:6,targets:[{node:reference('goal',1),requestedSummary:'Updated goal',
    requestedDependencies:[reference('fact',2)]}],allowedDependencies:[reference('fact',2),reference('goal',1),reference('goal',2)]},
    repairSources:{sourceVersion:'1.0',expectedGraphRevision:6,nodes:[node('fact',1,'fact','Old fact'),
      node('fact',2,'fact','New fact'),node('goal',1,'goal','Old goal')]}};
}
const parse=result=>repairInput(parseAgentInput(JSON.stringify({continuation:{proposalId:'p',state:'confirmed',result}})));
test('versioned continuation sources preserve actual baselines and classify next revisions as prospective',()=>{
  const value=fixture(),parsed=parse(value);
  assert.equal(parsed.sources.length,3);
  assert.deepEqual(parsed.prospectiveDependencies,[reference('goal',2)]);
  assert.equal(parsed.sources.some(source=>source.node.id==='goal'&&source.node.revision===2),false);
  delete value.repairSources;
  assert.deepEqual(parse(value).sources,[]);
});
test('continuation rejects duplicate, stale, withdrawn, fabricated dependency and unknown version or fields',()=>{
  for(const mutate of [
    value=>value.repairSources.nodes.push(value.repairSources.nodes[0]),
    value=>value.repairSources.nodes.push(node('goal',2,'goal','New goal')),
    value=>value.repairSources.nodes[2].state='withdrawn',
    value=>value.repairContext.allowedDependencies.push(reference('absent',1)),
    value=>value.repairSources.sourceVersion='2.0',
    value=>value.repairSources.expectedGraphRevision++,
    value=>value.repairSources.extra=true,
    value=>value.repairSources.nodes[0].extra=true,
    value=>value.repairContext.fact=reference('fact',2),
    value=>value.repairContext.targets[0].summary='Old goal',
  ]) {const value=fixture();mutate(value);assert.throws(()=>parse(value),{code:'INVALID_ARGUMENT'});}
});
