import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openReadOnlyWiki} from '@personal-agent/knowledge/wiki';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {TaskRuntime} from '@personal-agent/runtime';
import {ingestConfirmedPrivateCitation, revalidateWikiFact, createMemoryProjectionApplication,
  createPendingImpactApplication} from '@personal-agent/runtime/application';

const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
test('confirmed Wiki changes use existing durable Feed/Goal impact with no duplicate event or unrelated impact', async t => {
  const base = await mkdtemp(join(tmpdir(), 'pa-wiki-projection-'));
  const root = join(base, 'vault'); await mkdir(root);
  const file = join(root, 'one.md'); await writeFile(file, 'hello synthetic original');
  const memory = openSqliteMemoryHost(join(base, 'memory.sqlite'));
  const runtime = new TaskRuntime(join(base, 'runtime.sqlite'));
  t.after(async () => {memory.close(); runtime.close(); await rm(base, {recursive: true, force: true});});
  const wiki = await openReadOnlyWiki({rootPath: root, vaultId: 'synthetic-vault', sourceId: 'synthetic-source',
    namespace: 'synthetic', configRevision: 1, dataLevel: 'private', validUntil: '2099-01-01T00:00:00.000Z', isCurrent: () => true});
  memory.provision('synthetic');
  const source = (await wiki.search({query: 'hello', limit: 5, ...context()})).hits[0].source;
  const now = new Date().toISOString();
  await ingestConfirmedPrivateCitation({vault: wiki, memory, namespace: 'synthetic', factId: 'one', expectedRevision: null,
    source, observedAt: now, validFrom: now, validUntil: '2099-01-01T00:00:00.000Z',
    confirm: async () => ({operationId: 'synthetic-confirmed', summary: 'Synthetic confirmed summary'})}, context());
  // Private projection is explicitly scoped for this synthetic test; Desktop does not bind it automatically.
  const query = memory.bind('synthetic', {allowedSensitivities: ['private']});
  const feed = memory.bindFeed('synthetic', {consumerId: 'synthetic-impact', allowedSensitivities: ['private']});
  const projection = runtime.provisionFactProjectionStore('primary'), coordination = runtime.bindCoordinationStore('primary');
  const application = createMemoryProjectionApplication({consumerKey: 'synthetic-impact', memoryNamespace: 'synthetic',
    feed, memory: query, projection, confirmation: {confirm: request => memory.confirmFeedBatch('synthetic', 'synthetic-impact', request)}});
  const impact = createPendingImpactApplication({coordination, projection});
  const first = await application.consume({...context(), limit: 20});
  impact.process({...context(), at: new Date().toISOString(), limit: 20});
  const node = (id, dependencies) => ({id, kind: 'goal', summary: 'Synthetic goal', sourceRef: 'synthetic-goal',
    validFrom: now, validUntil: '2099-01-01T00:00:00.000Z', sensitivity: 'private', state: 'active', reason: 'Synthetic dependency', dependencies});
  coordination.append(first.projection.graphRevision, node('affected-goal', [first.projection.links[0].node]));
  coordination.append(first.projection.graphRevision + 1, node('unrelated-goal', []));
  await writeFile(file, 'hello synthetic edited');
  const invalidation = await revalidateWikiFact({wiki, memory, namespace: 'synthetic', fact: {id: 'one', revision: 1}, assertCurrent: () => {}}, context());
  assert.equal(invalidation.state, 'withdrawn');
  const second = await application.consume({...context(), limit: 20});
  assert.deepEqual(second.batch.entries.map(entry => entry.fact), [{id: 'one', revision: 2}]);
  const reports = impact.process({...context(), at: new Date().toISOString(), limit: 20});
  assert.deepEqual(reports.flatMap(report => report.items.filter(item => item.action === 'RECHECK').map(item => item.node.id)), ['affected-goal']);
  assert.equal(reports[0].items.find(item => item.node.id === 'unrelated-goal').action, 'KEEP');
  assert.equal((await revalidateWikiFact({wiki, memory, namespace: 'synthetic', fact: invalidation.fact.ref, assertCurrent: () => {}}, context())).appended, false);
  assert.equal((await feed.read({...context(), limit: 20})).entries.length, 0);
  assert.equal((await query.listCurrent({...context(), at: new Date().toISOString(), limit: 20})).facts.length, 0);
});
