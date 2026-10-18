import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPlatformTraceFixtures} from './platform-trace-fixtures.mjs';

const metricKeys = ['duration', 'tokens', 'input_tokens', 'output_tokens', 'is_error'];
// Public response table fields, not a new parser or wire schema.
const spanKeys = new Set(['trace_id', 'parent_span_id', 'span_id', 'span_type', 'span_name',
  'status_code', 'status_message', 'input', 'output', 'duration', 'session_id', 'tokens',
  'input_tokens', 'output_tokens', 'start_time', 'call_type', 'metadata', 'feedback_operation',
  'label', 'resource_id', 'resource_name', 'resource_type', 'model_name', 'is_error']);

test('official-derived bodies preserve partial totals and snake-case per-span metrics with synthetic identities', () => {
  const fixtures = buildPlatformTraceFixtures();
  assert.equal(fixtures.partial.total, 5);
  assert.equal(fixtures.partial.span_list.length, 1);
  assert.equal(fixtures.partial.span_list[0].duration, 5);
  assert.deepEqual(metricKeys.map(key => fixtures.partial.span_list[0][key]), [5, 0, 0, 0, false]);
  assert.deepEqual(fixtures.empty, {total: 0, span_list: []});
  for (const name of ['partial', 'mixedMetrics', 'privateFields', 'empty']) {
    const body = fixtures[name];
    assert.deepEqual(Object.keys(body), ['total', 'span_list']);
    assert.ok(Number.isSafeInteger(body.total) && body.total >= 0);
    for (const span of body.span_list) {
      assert.equal(span.trace_id, fixtures.traceId);
      assert.match(span.trace_id, /^synthetic-[A-Za-z0-9_-]+$/);
      assert.match(span.span_id, /^synthetic-[A-Za-z0-9_-]+$/);
      assert.equal(span.parent_span_id, null);
      assert.ok(Object.keys(span).every(key => spanKeys.has(key)));
      assert.equal(Object.hasOwn(span, 'metrics'), false);
      for (const key of metricKeys.filter(key => Object.hasOwn(span, key))) {
        assert.ok(key === 'is_error' ? typeof span[key] === 'boolean'
          : Number.isSafeInteger(span[key]) && span[key] >= 0);
      }
    }
  }
});

test('unknown metrics are absent rather than invented zeroes or undocumented raw nulls', () => {
  const [numeric, unknown, partial] = buildPlatformTraceFixtures().mixedMetrics.span_list;
  assert.deepEqual(metricKeys.map(key => numeric[key]), [125, 7, 4, 3, true]);
  assert.ok(metricKeys.every(key => !Object.hasOwn(unknown, key)));
  assert.equal(partial.duration, 0);
  assert.equal(partial.is_error, false);
  assert.ok(['tokens', 'input_tokens', 'output_tokens'].every(key => !Object.hasOwn(partial, key)));
});

test('private-field canaries use official string/label fields and every builder call is JSON-lossless and isolated', () => {
  const first = buildPlatformTraceFixtures();
  const second = buildPlatformTraceFixtures();
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  const span = first.privateFields.span_list[0];
  for (const key of ['input', 'output', 'metadata', 'span_name', 'status_message',
    'session_id', 'resource_name', 'model_name']) assert.equal(typeof span[key], 'string');
  assert.ok(Array.isArray(span.label));
  assert.ok(first.privateCanaries.every(canary => JSON.stringify(first.privateFields).includes(canary)));
  assert.doesNotMatch(JSON.stringify(first), /Authorization|Bearer|SDK-HMAC-SHA256|runtimeName|requestId|deploymentVersion/);
  first.privateFields.span_list[0].input = 'Caller replacement';
  first.privateFields.span_list[0].label[0].string_value = 'Caller label replacement';
  first.partial.span_list.length = 0;
  first.privateCanaries.length = 0;
  assert.deepEqual(second, buildPlatformTraceFixtures());
});
