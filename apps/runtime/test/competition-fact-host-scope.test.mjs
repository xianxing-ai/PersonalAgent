import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createRuntimeApplication} from '../dist/application.js';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';

const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal});

test('fixed public Memory port excludes private/other namespaces and denies withdrawn history and closed reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-agent-public-memory-port-'));
  let app, host, writer;
  try {
    app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'), profile: 'huawei_ict_agentarts'});
    const options = {memoryPath: join(directory, 'memory.sqlite'), memoryNamespace: 'public-port',
      graphNamespace: 'public-port-graph', consumerKey: 'public-port-consumer'};
    host = app.createCompetitionFactHost(options);
    const source = {vaultId: 'fixture-vault', path: 'source.md', factId: 'public-one', sourceRevision: 'a'.repeat(64),
      line: 1, summary: 'Public source', observedAt: new Date().toISOString(), validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z', expectedFactRevision: null};
    host.recordPublicSource(source, context());
    writer = openSqliteMemoryHost(options.memoryPath);
    writer.createUserFact(options.memoryNamespace, {factId: 'private-one', operationId: 'fixture-private-create',
      summary: 'Private content must not enter public context', sourceRef: 'fixture:private',
      observedAt: source.observedAt, validFrom: source.validFrom, validUntil: source.validUntil, ...context()});
    writer.provision('other-public-port');
    writer.appendPublicSource('other-public-port', {...source, factId: 'other-public', ...context()});
    options.memoryNamespace = 'other-public-port';
    const query = host.publicMemory;
    assert.equal(Object.isFrozen(query), true);
    const readAt = new Date().toISOString();
    const page = await query.listCurrent({at: readAt, limit: 10, ...context()});
    assert.deepEqual(page.facts.map(fact => fact.ref.id), ['public-one']);
    await assert.rejects(query.getVersion({fact: {id: 'private-one', revision: 1}, ...context()}), {code: 'SCOPE_DENIED'});
    await assert.rejects(query.getVersion({fact: {id: 'other-public', revision: 1}, ...context()}), {code: 'SCOPE_DENIED'});
    await assert.rejects(query.listCurrent({at: new Date().toISOString(), limit: 10, namespace: 'other-public-port', ...context()}), {code: 'INVALID_ARGUMENT'});
    host.recordPublicSource({...source, sourceRevision: 'b'.repeat(64), summary: 'Corrected public source', expectedFactRevision: 1}, context());
    assert.equal((await query.listCurrent({factId: source.factId, at: new Date().toISOString(), limit: 1, ...context()})).facts[0].ref.revision, 2);
    host.withdrawPublicSource({vaultId: source.vaultId, path: source.path, factId: source.factId,
      withdrawalId: 'public-port-withdraw', expectedFactRevision: 2, observedAt: new Date().toISOString()}, context());
    assert.deepEqual((await query.listCurrent({factId: source.factId, at: new Date().toISOString(), limit: 1, ...context()})).facts, []);
    assert.deepEqual((await query.listCurrent({at: readAt, limit: 10,
      snapshot: page.snapshot, ...context()})).facts, [], 'an old public snapshot cannot replay corrected/withdrawn content');
    await assert.rejects(query.getVersion({fact: {id: source.factId, revision: 1}, ...context()}), {code: 'SCOPE_DENIED'});
    await assert.rejects(query.listHistory({factId: source.factId, limit: 10, ...context()}), {code: 'SCOPE_DENIED'});
    host.close();
    await assert.rejects(query.listCurrent({at: new Date().toISOString(), limit: 10, ...context()}), {code: 'UNSUPPORTED_CAPABILITY'});
  } finally {
    writer?.close(); host?.close(); app?.close(); await rm(directory, {recursive: true, force: true});
  }
});

test('mutable caller inputs cannot redirect a bound Competition Fact host', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-agent-fact-scope-'));
  let app;
  const hosts = [];
  try {
    app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'), profile: 'huawei_ict_agentarts'});
    const options = {memoryPath: join(directory, 'memory.sqlite'),
      memoryNamespace: 'synthetic-original', graphNamespace: 'synthetic-original-graph',
      consumerKey: 'synthetic-original-consumer'};
    const host = app.createCompetitionFactHost(options); hosts.push(host);
    const original = app.createCompetitionFactHost({...options}); hosts.push(original);
    const other = app.createCompetitionFactHost({...options,
      memoryNamespace: 'synthetic-other', graphNamespace: 'synthetic-other-graph',
      consumerKey: 'synthetic-other-consumer'}); hosts.push(other);
    const key = {vaultId: 'synthetic-vault', path: 'note.md', factId: 'synthetic-note'};
    const first = {...key, sourceRevision: 'a'.repeat(64), line: 1,
      summary: 'Synthetic original source', observedAt: '2026-09-25T00:00:00.000Z',
      validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
      expectedFactRevision: null};
    original.recordPublicSource(first, {...context(), factId: 'spoofed-note'});

    options.memoryNamespace = 'synthetic-other';
    options.graphNamespace = 'synthetic-other-graph';
    options.consumerKey = 'synthetic-other-consumer';
    assert.equal(host.readPublicSourceHead(key), 1);
    assert.equal(host.readPublicSourceHead({...key, factId: 'spoofed-note'}), null);
    assert.equal(host.recordPublicSource({...first, sourceRevision: 'b'.repeat(64),
      summary: 'Synthetic corrected source', expectedFactRevision: 1}, context()).fact.ref.revision, 2);
    assert.equal(original.readPublicSourceHead(key), 2);
    assert.equal(other.readPublicSourceHead(key), null);

    const withdrawn = host.withdrawPublicSource({...key, withdrawalId: 'synthetic-withdrawal',
      expectedFactRevision: 2, observedAt: '2026-09-25T01:00:00.000Z'},
    {...context(), factId: 'spoofed-note'});
    assert.equal(withdrawn.fact.state, 'withdrawn');
    assert.equal(original.readPublicSourceHead(key), 3);
    assert.equal(other.readPublicSourceHead(key), null);
    await host.drain({limit: 10, maxBatches: 5, ...context()});
    assert.ok(original.listImpactReceipts({afterGraphRevision: 0, limit: 10}).length > 0);
    assert.deepEqual(other.listImpactReceipts({afterGraphRevision: 0, limit: 10}), []);
  } finally {
    for (const host of hosts.reverse()) host.close();
    app?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('trusted Competition host starts and resumes an authorized fact erasure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-agent-fact-erasure-host-'));
  let app;
  let host;
  try {
    app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'),
      profile: 'huawei_ict_agentarts'});
    const options = {memoryPath: join(directory, 'memory.sqlite'),
      memoryNamespace: 'synthetic-user', graphNamespace: 'synthetic-user-graph',
      consumerKey: 'synthetic-user-consumer'};
    host = app.createCompetitionFactHost(options);
    const source = {vaultId: 'synthetic-vault', path: 'note.md', factId: 'synthetic-note',
      sourceRevision: 'a'.repeat(64), line: 1, summary: 'Synthetic fact',
      observedAt: '2026-09-25T00:00:00.000Z', validFrom: '2026-09-25T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z', expectedFactRevision: null};
    host.recordPublicSource(source, context());
    await host.drain({limit: 10, maxBatches: 2, ...context()});
    const erasure = {factId: source.factId, expectedRevision: 1,
      operationId: 'synthetic-erasure', ...context()};
    assert.throws(() => host.beginFactErasure({...erasure, memoryNamespace: 'other'}),
      {code: 'INVALID_ARGUMENT'});
    host.beginFactErasure(erasure);
    const inspection = await host.preflightErasure(source.factId, context());
    assert.equal(inspection.targetVersions, 1);
    await host.resumeFactErasure({...erasure,
      expectedGraphRevision: inspection.graphRevision});
    assert.equal(host.readPublicSourceHead({vaultId: source.vaultId,
      path: source.path, factId: source.factId}), null);
    assert.deepEqual(app.runtime.bindCoordinationStore(options.graphNamespace).read().history, []);
    host.beginFactErasure(erasure);
    await host.resumeFactErasure({...erasure,
      expectedGraphRevision: inspection.graphRevision});
  } finally {
    host?.close(); app?.close();
    await rm(directory, {recursive: true, force: true});
  }
});
