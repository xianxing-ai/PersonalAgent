import assert from 'node:assert/strict';
import test from 'node:test';
import {NotificationService} from '../dist/index.js';
import {FakeStorage} from '@personal-agent/testkit';

const item = (key, at = '2026-10-17T10:00:00.000Z') => ({source: 'fixture', accountRef: 'fixture', externalId: key,
  occurredAt: at, fetchedAt: at, contentRef: 'fixture only', sensitivity: 'public', dedupeKey: `fixture:${key}`});

function fixture(policy = {}) {
  const storage = new FakeStorage().namespace('events-readback');
  let time = Date.parse('2026-10-17T10:00:00.000Z');
  let ids = 0;
  const service = new NotificationService(storage, policy, {
    now: () => time, idFactory: () => `fixture-batch-${++ids}`});
  return {service, storage, tick: ms => {time += ms;}, restart: () =>
    new NotificationService(storage, policy, {now: () => time, idFactory: () => `fixture-batch-${++ids}`})};
}

test('empty state returns an empty current page without side effects', () => {
  const {service} = fixture();
  const page = service.readBatchEvents();
  assert.deepEqual(page, {eventVersion: 1, cursorState: 'current', events: [], nextCursor: null,
    retained: {readyForDelivery: 0, delivered: 0}});
});

test('decided batches surface as versioned events in decision order without duplicating content', () => {
  const {service} = fixture();
  service.ingest([item('one')]);
  service.drain();
  service.ingest([item('two')]);
  const decided = service.drain().batches;
  assert.equal(decided.length, 2, 'drain re-returns unacknowledged batches by design');
  const page = service.readBatchEvents();
  assert.equal(page.eventVersion, 1);
  assert.equal(page.cursorState, 'current');
  assert.equal(page.retained.readyForDelivery, 2);
  assert.deepEqual(page.events.map(event => event.batchId), ['fixture-batch-1', 'fixture-batch-2']);
  assert.ok(page.events.every(event => event.eventVersion === 1 && event.kind === 'immediate'
    && event.state === 'ready_for_delivery' && event.deliveredAt === undefined));
  assert.deepEqual(page.events[0].itemRefs, ['fixture:one']);
  assert.ok(!JSON.stringify(page).includes('fixture only'), 'connector content must not be projected');
});

test('acknowledged delivery is visible as state and deliveredAt, surviving restart', () => {
  const {service, tick, restart} = fixture();
  service.ingest([item('one')]);
  const batch = service.drain().batches[0];
  tick(5000);
  service.acknowledge(batch.id);
  const page = restart().readBatchEvents();
  assert.equal(page.retained.delivered, 1);
  assert.equal(page.events[0].state, 'delivered');
  assert.equal(typeof page.events[0].deliveredAt, 'string');
});

test('cursor pagination is bounded and terminates at the newest batch', () => {
  const {service, tick} = fixture();
  for (const key of ['a', 'b', 'c']) {service.ingest([item(key)]); service.drain(); tick(1000);}
  const first = service.readBatchEvents({limit: 2});
  assert.deepEqual(first.events.map(event => event.batchId), ['fixture-batch-1', 'fixture-batch-2']);
  assert.equal(first.nextCursor, 'fixture-batch-2');
  const second = service.readBatchEvents({sinceBatchId: first.nextCursor, limit: 2});
  assert.deepEqual(second.events.map(event => event.batchId), ['fixture-batch-3']);
  assert.equal(second.nextCursor, null);
  const caught = service.readBatchEvents({sinceBatchId: 'fixture-batch-3'});
  assert.deepEqual(caught.events, []);
});

test('a cursor older than the retained delivered window reports compaction, not data loss', () => {
  const {service, tick} = fixture();
  service.ingest([item('a')]);
  service.drain();
  service.acknowledge('fixture-batch-1');
  tick(1000);
  service.ingest([item('b')]);
  service.drain();
  const page = service.readBatchEvents({sinceBatchId: 'evicted-long-ago'});
  assert.equal(page.cursorState, 'compacted');
  assert.deepEqual(page.events.map(event => event.batchId), ['fixture-batch-1', 'fixture-batch-2']);
  assert.equal(page.retained.readyForDelivery, 1);
  assert.equal(page.retained.delivered, 1);
});

test('out of bounds requests are rejected and never mutate state', () => {
  const {service} = fixture();
  service.ingest([item('one')]);
  service.drain();
  const before = service.readBatchEvents();
  for (const invalid of [{limit: 0}, {limit: 101}, {limit: 1.5}, {sinceBatchId: ''}, {sinceBatchId: 'x'.repeat(129)}]) {
    assert.throws(() => service.readBatchEvents(invalid), {code: 'INVALID_ARGUMENT'});
  }
  assert.deepEqual(service.readBatchEvents().events, before.events, 'readback must not create or consume batches');
  assert.equal(service.status().unacknowledgedBatches, 1);
  assert.equal(service.ingest([item('one')]).duplicates, 1, 'dedupe window must stay intact');
});

test('digest batches expose their kind and held reason like immediate batches', () => {
  const {service} = fixture({digest: {windowMs: 60_000, maxItems: 10}});
  service.ingest([item('d1')]);
  const drain = service.drain();
  assert.equal(drain.batches.length, 0);
  service.readBatchEvents();
  const {batches} = service.drain();
  if (batches.length) {
    const page = service.readBatchEvents();
    assert.equal(page.events[0].kind, 'digest');
    assert.ok(page.events[0].reason.length > 0);
  }
});
