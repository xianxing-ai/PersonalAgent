import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openSqliteMemoryHost} from '../dist/sqlite.js';

const context = patch => ({deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal, ...patch});
const at = '2026-10-10T00:00:00.000Z';
test('source invalidation is scoped, atomic, idempotent and never claims user confirmation', async t => {
  const base = mkdtempSync(join(tmpdir(), 'pa-source-invalidation-'));
  const host = openSqliteMemoryHost(join(base, 'memory.sqlite'));
  t.after(() => {host.close(); rmSync(base, {recursive: true, force: true});});
  host.provision('synthetic'); host.provision('other');
  host.createUserFact('synthetic', {factId: 'one', operationId: 'confirmed-one', summary: 'synthetic confirmed text',
    sourceRef: 'synthetic-source-v1', observedAt: at, validFrom: at, validUntil: '2099-01-01T00:00:00.000Z', ...context()});
  const request = {factId: 'one', expectedRevision: 1, sourceRef: 'synthetic-source-v1', observedAt: at, ...context()};
  const aborted = new AbortController(); aborted.abort();
  assert.throws(() => host.invalidateUserFactSource('synthetic', {...request, signal: aborted.signal}), {code: 'CANCELLED'});
  assert.throws(() => host.invalidateUserFactSource('synthetic', {...request, deadline: new Date(0).toISOString()}), {code: 'TIMEOUT'});
  assert.throws(() => host.invalidateUserFactSource('other', request), {code: 'SCOPE_DENIED'});
  assert.throws(() => host.invalidateUserFactSource('synthetic', {...request, sourceRef: 'substituted'}), {code: 'REVISION_CONFLICT'});
  assert.throws(() => host.invalidateUserFactSource('synthetic', {...request, summary: 'invented'}), {code: 'INVALID_ARGUMENT'});
  assert.equal(host.readUserFactHead('synthetic', 'one').ref.revision, 1);
  const result = host.invalidateUserFactSource('synthetic', request);
  assert.equal(result.appended, true); assert.equal(result.fact.ref.revision, 2);
  assert.equal(result.fact.summary, 'synthetic confirmed text');
  assert.equal(result.fact.confirmation, 'external_observation'); assert.equal(result.fact.state, 'withdrawn');
  assert.deepEqual(host.invalidateUserFactSource('synthetic', {...request, expectedRevision: 2}), {...result, appended: false});
  assert.throws(() => host.invalidateUserFactSource('synthetic', request), {code: 'REVISION_CONFLICT'});
  assert.deepEqual((await host.listUserFactHeads('synthetic', {...context(), at, limit: 20})).facts, [result.fact]);
  assert.equal((await host.bind('synthetic', {allowedSensitivities: ['private']})
    .listCurrent({...context(), at, limit: 20})).facts.length, 0);
  assert.equal((await host.bindFeed('synthetic', {consumerId: 'public-only', allowedSensitivities: ['public']})
    .read({...context(), limit: 20})).entries.length, 0);
});
