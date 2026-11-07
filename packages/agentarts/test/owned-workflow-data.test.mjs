import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {OWNED_WORKFLOW_SOURCE} from '../dist/owned-workflow-data.js';
import {getOwnedWorkflowDesignCoverage} from '../dist/owned-workflow-templates.js';

const designKinds=new Set(['input','tool_exec','semantic_decision','deterministic_check','execution_model',
  'verification','wait_user','parallel_split','join','complete','checkpoint']);

test('generated workflow source stays detached pure JSON whose projection digest matches published design coverage',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(OWNED_WORKFLOW_SOURCE)),OWNED_WORKFLOW_SOURCE);
  const coverage=getOwnedWorkflowDesignCoverage();
  assert.equal(coverage.projectionSha256,createHash('sha256').update(JSON.stringify(OWNED_WORKFLOW_SOURCE)).digest('hex'));
});

test('every node and edge reference in the generated data resolves inside its own feature with a known design kind',()=>{
  for(const feature of OWNED_WORKFLOW_SOURCE) {
    const nodes=new Map(feature.nodes.map(node=>[node.id,node]));
    for(const node of feature.nodes) {
      assert.ok(designKinds.has(node.kind),`${feature.id} ${node.id} unknown design kind ${node.kind}`);
      assert.ok(node.evidenceRequirement,`${feature.id} ${node.id} declares its evidence requirement`);
      for(const field of ['dependencies','inputFields','outputFields','resourceKeys']) assert.ok(Array.isArray(node[field]),node.id+' '+field);
    }
    for(const edge of feature.edges) {
      assert.ok(nodes.has(edge.source)&&nodes.has(edge.target),`${feature.id} edge ${edge.source}->${edge.target} references an unknown node`);
      assert.notEqual(edge.source,edge.target,`${feature.id} edge self-loop ${edge.source}`);
    }
    for(const node of feature.nodes) for(const dependency of node.dependencies)
      assert.ok(feature.edges.some(edge=>edge.source===dependency&&edge.target===node.id),`${feature.id} dependency ${dependency}->${node.id} has a declared edge`);
    assert.ok(Array.isArray(feature.recovery)&&feature.recovery.every(item=>typeof item==='string'&&item.trim()),feature.id+' recovery');
  }
});
