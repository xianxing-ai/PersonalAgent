import test from 'node:test';
import assert from 'node:assert/strict';
import {getOwnedWorkflowTemplate} from '../dist/owned-workflow-templates.js';
import {workflowCandidateMetadata} from '../dist/owned-workflows.js';
import {f20DocumentCandidateSchema} from '@personal-agent/contracts/f20-candidate';

test('F20 workflow template binds N03 to coding.repair.trial and defines bounded candidate schema',()=> {
  const template=getOwnedWorkflowTemplate('F20');
  assert.equal(template.workflowId,'F20');
  assert.equal(template.nodes.length,4);

  const [n01,n02,n03,n04]=template.nodes;
  assert.equal(n01.id,'F20_N01');
  assert.equal(n02.id,'F20_N02');
  assert.equal(n03.id,'F20_N03');
  assert.equal(n04.id,'F20_N04');

  // N01 reads contract/implementation
  const n01Tools=n01.capabilities.filter(c=>c.kind==='tool');
  assert.deepEqual(n01Tools.map(t=>t.name),['workspace.read_text']);

  // N03 MUST use coding.repair.trial, NOT workspace.run_allowed_command
  const n03Tools=n03.capabilities.filter(c=>c.kind==='tool');
  assert.deepEqual(n03Tools.map(t=>t.name),['coding.repair.trial']);
  assert.equal(n03Tools.some(t=>t.name==='workspace.run_allowed_command'),false);

  // N02 and N04 candidate value metadata matches public @personal-agent/contracts/f20-candidate
  const expectedSchema=f20DocumentCandidateSchema();
  const n02Meta=workflowCandidateMetadata(n02,[]);
  const n04Meta=workflowCandidateMetadata(n04,[]);
  assert.deepEqual(n02Meta.candidateValueSchema,expectedSchema);
  assert.deepEqual(n04Meta.candidateValueSchema,expectedSchema);

  // Constraints enforce typed object and retaining original candidate or abstaining
  assert.match(n02Meta.candidateConstraint,/Include a TypeScript example with an explicitly typed object/);
  assert.match(n04Meta.candidateConstraint,/Retain the exact original selected F20 document candidate/);

  // Transitions enforce linear dependency N01 -> N02 -> N03 -> N04
  const edges=template.transitions.map(e=>`${e.source}->${e.target}`);
  assert.ok(edges.includes('F20_N01->F20_N02'));
  assert.ok(edges.includes('F20_N02->F20_N03'));
  assert.ok(edges.includes('F20_N03->F20_N04'));
});
