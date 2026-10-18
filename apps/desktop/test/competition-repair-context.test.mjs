import assert from 'node:assert/strict';
import test from 'node:test';
import {appendVersion, createGraph} from '@personal-agent/goals';
import {projectSyntheticRepairContext, projectSyntheticRepairWire} from '../electron/competition-repair-context.js';

function fixture() {
  let graph = createGraph('mvp-synthetic-meeting');
  const add = (id, kind, summary, dependencies = [], sourceRef = 'synthetic/mvp/explicit-plan') => {
    graph = appendVersion(graph, graph.revision, {id, kind, summary, dependencies, sourceRef,
      validFrom: '2026-09-24T00:00:00.000Z', validUntil: '2026-09-25T00:00:00.000Z',
      sensitivity: 'private', state: 'active', reason: 'Synthetic fixture'});
  };
  add('actual-projected-id', 'fact', 'Synthetic meeting starts at 15:00', [], 'synthetic/mvp/baseline');
  add('attend', 'goal', 'Attend meeting at 15:00', [{id: 'actual-projected-id', revision: 1}]);
  add('prepare', 'decision', 'Prepare one hour before meeting', [{id: 'attend', revision: 1}]);
  add('preparation', 'plan', 'Prepare at 14:00', [{id: 'prepare', revision: 1}]);
  add('unrelated', 'plan', 'PRIVATE UNRELATED DETAIL');
  add('actual-projected-id', 'fact', 'Synthetic meeting starts at 17:00', [], 'tool-evidence:local-only-id');
  const projection = {graphRevision: graph.revision, links: [{eventId: 'local-only-event',
    fact: {id: 'meeting/time', revision: 2}, node: {id: 'actual-projected-id', revision: 2}}]};
  return {graph, projection};
}

test('graph export uses actual snapshot versions and projection mapping, excluding local metadata and unrelated plans', () => {
  const {graph, projection} = fixture();
  const result = projectSyntheticRepairContext(graph, projection);
  assert.equal(result.expectedGraphRevision, graph.revision);
  assert.deepEqual(result.projectedFact, projection.links[0].node);
  assert.deepEqual(result.targets.map(item => item.node.id), ['attend', 'prepare', 'preparation']);
  assert.deepEqual(result.targets[0].dependencies, [{id: 'actual-projected-id', revision: 1}]);
  assert.deepEqual(result.targets.map(item => item.requestedSummary), [
    'Attend meeting at 17:00', 'Prepare one hour before 17:00 meeting', 'Prepare at 16:00']);
  assert.deepEqual(result.targets.map(item => item.requestedDependencies), [
    [{id: 'actual-projected-id', revision: 2}],
    [{id: 'attend', revision: 2}], [{id: 'prepare', revision: 2}]]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|local-only|sourceRef|sensitivity|unrelated/);
});

test('graph export rejects stale mappings, expanded summaries and unrelated dependency edges', () => {
  for (const mutate of [
    ({projection}) => projection.graphRevision--,
    ({projection}) => projection.links[0].node.revision = 1,
    ({projection}) => projection.links[0].fact.revision = 3,
    ({graph}) => graph.history[1].summary += ' PRIVATE',
    ({graph}) => graph.history[5].sourceRef = 'synthetic-label-from-cloud',
    ({graph}) => graph.history[3].dependencies.push({id: 'actual-projected-id', revision: 1}),
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => projectSyntheticRepairContext(data.graph, data.projection), /export denied/);
  }
});

test('wire context stays strict and sources are the five actual approved versions', () => {
  const {graph, projection} = fixture();
  const wire = projectSyntheticRepairWire(graph, projection);
  assert.deepEqual(Object.keys(wire.repairContext).sort(), ['allowedDependencies','expectedGraphRevision','targets']);
  assert.deepEqual(Object.keys(wire.repairContext.targets[0]).sort(), ['node','requestedDependencies','requestedSummary']);
  assert.equal(wire.repairSources.sourceVersion, '1.0');
  assert.equal(wire.repairSources.nodes.length, 5);
  assert.deepEqual(wire.repairSources.nodes.slice(0,2).map(node => node.revision), [1,2]);
  for (const node of wire.repairSources.nodes) {
    const source = graph.history.find(item => item.id === node.id && item.revision === node.revision);
    for (const field of Object.keys(node)) assert.deepEqual(node[field], source[field]);
  }
  assert.doesNotMatch(JSON.stringify(wire), /PRIVATE|local-only|sourceRef|sensitivity|unrelated|projectedFact/);
});
