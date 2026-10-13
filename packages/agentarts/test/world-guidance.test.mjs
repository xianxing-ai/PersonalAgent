import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedAgentOrchestrator} from '../dist/index.js';
import {worldGuidance} from '../dist/world-guidance.js';
import {FakeModelProvider} from '@personal-agent/models';
import {REPAIR_QUERY} from '../../../tests/manual/agentarts/owned-binding-live.mjs';
const ref=(id,revision=1)=>({id:id.repeat(64),revision});
const source=(id,revision,kind,summary,state='active')=>({node:ref(id,revision),kind,summary,state});

test('world vocabulary restricts source kinds and latest adjacent changes without preselecting impact',()=>{
  const sources=[source('a',1,'fact','first'),source('a',2,'fact','second'),source('a',3,'fact','latest'),
    source('b',1,'goal','same'),source('b',2,'goal','same'),source('c',1,'plan','plan'),
    source('d',1,'decision','decision'),source('e',1,'goal','goal')];
  const context={expectedGraphRevision:9,targets:['c','d','e'].map(id=>({node:ref(id),requestedDependencies:[]})),allowedDependencies:[]};
  const hints=worldGuidance(context,sources);
  assert.deepEqual(hints.changed_fact_candidates,[{previous:ref('a',2),current:ref('a',3)}]);
  assert.equal(hints.reportVersion,'1.2');
  assert.equal(hints.observed_fact_candidates.length,6);
  assert.deepEqual(hints.affected_item_candidates,[{node:ref('c'),kind:'plan_step'},{node:ref('d'),kind:'decision'},{node:ref('e'),kind:'goal'}]);
  assert.equal(Object.hasOwn(hints,'recommended_disposition'),false);
  assert.equal(Object.hasOwn(hints,'affected_items'),false);
  assert.deepEqual(worldGuidance({...context,targets:[]},[]),{reportVersion:'1.1',revision:9,
    observed_fact_candidates:[],changed_fact_candidates:[],affected_item_candidates:[]});
});

test('actual World binding sends derived vocabulary but still rejects a plan masquerading as a fact',async()=>{
  const invalid={reportVersion:'1.1',revision:7,
    observed_facts:[{node:ref('a'),fact:'14点准备',confidence:'explicit'}],changed_facts:[],affected_items:[],
    missing_information:['缺少变化依据'],recommended_disposition:'RECHECK',summary:'待核实'};
  const model=new FakeModelProvider([{kind:'final',text:JSON.stringify(invalid)}]);
  const agent=new OwnedAgentOrchestrator({fast:model,world:model,plan:model,review:model},2048);
  await assert.rejects(agent.invokeWorkflow({workflowId:'7d06153e-6262-4679-86ae-1914b38e11f3',query:REPAIR_QUERY,
    sessionId:'synthetic',requestId:'synthetic',deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal}),{code:'EXTERNAL_FAILURE'});
  assert.equal(model.requests.length,1);
  const body=JSON.parse(model.requests[0].messages[1].content);
  assert.equal(body.report_constraints.observed_fact_candidates.length,2);
  assert.deepEqual(body.report_constraints.changed_fact_candidates,[{previous:ref('b'),current:ref('b',2)}]);
  assert.equal(body.report_constraints.affected_item_candidates.every(item=>item.kind==='plan_step'),true);
  assert.equal(body.input.executed,false);
});
