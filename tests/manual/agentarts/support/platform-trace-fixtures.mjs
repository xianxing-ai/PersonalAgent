// Derived from the public ShowOpsTrace response table and 200 example:
// https://support.huaweicloud.com/api-agentarts/ShowOpsTrace.html
// Document updated 2026-09-24; saved HTML inspected 2026-10-07. The published
// example has total=5 with one returned span. All content and IDs below are
// synthetic. These fixtures establish no runtime/request/deployment join.
const TRACE_ID = 'synthetic-showops-trace-1';

function span(spanId) {
  return {trace_id: TRACE_ID, parent_span_id: null, span_id: spanId,
    span_type: 'workflow', span_name: 'SyntheticInput', status_code: 'STATUS_CODE_OK',
    status_message: 'Synthetic span status', input: 'Synthetic input', output: 'Synthetic output',
    session_id: 'synthetic-session-1', start_time: 1791360000000, call_type: 'debug',
    label: [], resource_id: '00000000-0000-4000-8000-000000000001',
    resource_name: 'Synthetic workflow', resource_type: 'workflow'};
}

/** Fresh plain response bodies for explicit Fake fetch consumers; no network. */
export function buildPlatformTraceFixtures() {
  const privateCanaries = [
    'synthetic-private-input-canary', 'synthetic-private-output-canary',
    'synthetic-private-metadata-canary', 'synthetic-private-name-canary',
    'synthetic-private-status-canary', 'synthetic-private-session-canary',
    'synthetic-private-resource-canary', 'synthetic-private-model-canary',
    'synthetic-private-label-canary',
  ];
  const partial = {total: 5, span_list: [{...span('synthetic-partial-span-1'),
    duration: 5, tokens: 0, input_tokens: 0, output_tokens: 0, is_error: false}]};
  // The official table declares Integer/Boolean metrics, without a nullable
  // guarantee. Unknown summary metrics are exercised through missing fields,
  // rather than describing raw metric:null as an official response contract.
  const mixedMetrics = {total: 3, span_list: [
    {...span('synthetic-numeric-span'), duration: 125, tokens: 7,
      input_tokens: 4, output_tokens: 3, is_error: true},
    span('synthetic-unknown-span'),
    {...span('synthetic-partial-metrics-span'), duration: 0, is_error: false},
  ]};
  const privateFields = {total: 1, span_list: [{...span('synthetic-private-fields-span'),
    duration: 9, tokens: 5, input_tokens: 2, output_tokens: 3, is_error: false,
    input: privateCanaries[0], output: privateCanaries[1],
    metadata: JSON.stringify({note: privateCanaries[2]}),
    span_name: privateCanaries[3], status_message: privateCanaries[4],
    session_id: privateCanaries[5], resource_name: privateCanaries[6],
    model_name: privateCanaries[7], label: [{trace_id: TRACE_ID,
      span_id: 'synthetic-private-fields-span', start: 1791360000000,
      last_update_time: 1791360000000, label: 'synthetic-note', string_value: privateCanaries[8]}],
  }]};
  return {traceId: TRACE_ID, partial, mixedMetrics, privateFields,
    empty: {total: 0, span_list: []}, privateCanaries};
}
