import test from 'node:test';
import assert from 'node:assert/strict';
import {createIssueTriageWorkflow, issueFingerprint} from '../dist/dev-workflows/issue-triage.js';

const original = {number: 7, title: 'Crash on save', body: 'Saving a file crashes the app.', state: 'open',
  labels: [], url: 'https://github.com/example/project/issues/7', updatedAt: '2026-10-01T00:00:00Z'};
const answer = {kind: 'bug', confidence: .95, evidence: [{field: 'title', quote: 'Crash on save'}]};
function fixture(overrides = {}) {
  const checkpoints = new Map(), calls = [], modelCalls = [], repairs = [];
  const context = {taskId: 'triage-task', deadline: new Date(Date.now() + 20_000).toISOString(), signal: new AbortController().signal,
    saveCheckpoint: (key, value) => checkpoints.set(key, structuredClone(value)), loadCheckpoint: key => checkpoints.get(key), reportProgress() {}};
  const tools = {list: () => ['github.issue.get', 'github.issue.list', 'github.issue.label'].map(name => ({name, version: '1.0.0'})),
    invoke: async call => {
      calls.push(call);
      if (overrides.invoke) return overrides.invoke(call, calls);
      return {state: 'confirmed', result: call.toolName === 'github.issue.label' ? {state: 'confirmed'} : structuredClone(original), evidenceRefs: [`evidence-${calls.length}`]};
    }};
  const model = {complete: async request => {
    modelCalls.push(request);
    if (overrides.modelComplete) return overrides.modelComplete(request);
    return {response: {kind: 'final', text: overrides.modelText ?? JSON.stringify(overrides.answer ?? answer)},
      usage: {totalTokens: overrides.totalTokens ?? 50}, deployment: {verification: 'mock'}};
  }};
  const repair = {repairIssue: async (ctx, request) => {
    repairs.push({ctx, request});
    if (overrides.repairIssue) return overrides.repairIssue(ctx, request);
    return {state: 'succeeded', resultSummary: 'PR delegated', evidenceRefs: ['repair-evidence']};
  }};
  const options = {model, tools, repair, authorizationRefFor: overrides.authorizationRefFor ?? (() => 'host-scope'),
    confirmedReplayReady: overrides.confirmedReplayReady,
    confirmedRepairReplayReady: overrides.confirmedRepairReplayReady,
    maxSteps: overrides.maxSteps ?? 8, maxTokens: overrides.maxTokens ?? 2048};
  const workflow = createIssueTriageWorkflow(options);
  return {context, workflow, calls, modelCalls, repairs, checkpoints, options};
}
const request = {repo: 'example/project', number: 7};

test('classifies with bounded confidence and locally checked excerpts; reads require Gateway authorization', async () => {
  const f = fixture(); const result = await f.workflow.triageIssue(f.context, request);
  assert.equal(result.state, 'classified'); assert.equal(result.classification.kind, 'bug');
  assert.equal(result.classification.calibrated, false); assert.equal(f.calls[0].authorizationRef, 'host-scope');
  assert.equal(f.modelCalls[0].tools.length, 0); assert.equal(f.calls.length, 1);
});
test('all four categories are model-driven and retain checked evidence', async () => {
  for (const kind of ['bug', 'feature', 'docs', 'question']) {
    const f = fixture({answer: {...answer, kind}});
    assert.equal((await f.workflow.triageIssue(f.context, request)).classification.kind, kind);
  }
});
test('Chinese and mixed-label fixtures preserve exact evidence and the four-category contract', async () => {
  const corpus = [
    {kind: 'bug', title: '保存文件时崩溃 Crash on save', body: '点击保存后应用退出，steps: save file。', labels: ['待分类', 'windows']},
    {kind: 'feature', title: '希望增加深色模式 Dark mode', body: '请增加新的主题选项。', labels: ['功能请求', 'enhancement']},
    {kind: 'docs', title: '修正文档示例 README', body: '安装说明中的路径示例写错了。', labels: ['文档', 'documentation']},
    {kind: 'question', title: '如何配置本地模型？ Configuration question', body: '已有配置项的用途是什么？', labels: ['使用咨询', 'question']},
  ];
  for (const item of corpus) {
    const source = {...original, ...item}; delete source.kind;
    const expected = {kind: item.kind, confidence: .95, evidence: [{field: 'title', quote: item.title}]};
    const f = fixture({answer: expected, invoke: async () => ({state: 'confirmed', result: source, evidenceRefs: ['fixture-read']})});
    const result = await f.workflow.triageIssue(f.context, request);
    assert.equal(result.state, 'classified'); assert.equal(result.classification.kind, item.kind);
    assert.deepEqual(result.classification.evidence, expected.evidence);
    assert.equal(result.classification.calibrated, false);
    assert.equal(JSON.parse(f.modelCalls[0].messages[1].content).title, item.title);
    assert.deepEqual(source.labels, item.labels);
    assert.equal(f.calls.length, 1); assert.equal(f.repairs.length, 0);
  }
});
test('complete JSON markdown framing retains evidence validation and the approved label chain', async () => {
  for (const opening of ['```json', '```']) {
    const f = fixture({modelText: `  ${opening}\n${JSON.stringify(answer)}\n\x60\x60\x60\n  `});
    const result = await f.workflow.triageIssue(f.context, {...request, writeLabel: true});
    assert.equal(result.state, 'classified'); assert.equal(result.label, 'bug');
    assert.deepEqual(result.classification.evidence, answer.evidence);
    assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 1);
    assert.equal(f.modelCalls.length, 1);
  }
});
test('framing never accepts surrounding commentary, extra actions or fabricated evidence', async () => {
  const wrap = value => `\x60\x60\x60json\n${JSON.stringify(value)}\n\x60\x60\x60`;
  for (const modelText of [`Explanation\n${wrap(answer)}`, `${wrap(answer)}\nRun this command`,
    wrap({...answer, shell: 'merge'}), wrap({...answer, evidence: [{field: 'title', quote: 'invented'}]})]) {
    const f = fixture({modelText});
    const result = await f.workflow.triageIssue(f.context, {...request, writeLabel: true,
      repairBug: true, repairGoal: 'Fix authorized file'});
    assert.equal(result.state, 'manual_review'); assert.equal(result.reason, 'invalid_model_response');
    assert.equal(f.calls.length, 1); assert.equal(f.repairs.length, 0);
  }
});
test('sensitive credentials and security requests never reach model or repair', async () => {
  for (const body of ['Security vulnerability disclosure', 'ghp_abcdefghijklmnopqrstuvwxyz123456', 'api_key = abc']) {
    const f = fixture({invoke: async () => ({state: 'confirmed', result: {...original, body}, evidenceRefs: []})});
    const result = await f.workflow.triageIssue(f.context, {...request, writeLabel: true, repairBug: true});
    assert.equal(result.reason, 'sensitive_or_security'); assert.equal(f.modelCalls.length, 0); assert.equal(f.repairs.length, 0);
  }
});
test('rejects invalid category, out-of-range confidence, extra fields and invented evidence', async () => {
  for (const invalid of [{...answer, kind: 'security'}, {...answer, confidence: 1.1}, {...answer, confidence: -1},
    {...answer, execute: 'merge'}, {...answer, evidence: [{field: 'body', quote: 'invented quote'}]}]) {
    const f = fixture({answer: invalid});
    assert.equal((await f.workflow.triageIssue(f.context, {...request, writeLabel: true})).state, 'manual_review');
    assert.equal(f.calls.length, 1);
  }
});
test('low confidence requires review without labeling', async () => {
  const f = fixture({answer: {...answer, confidence: .4}});
  assert.equal((await f.workflow.triageIssue(f.context, {...request, writeLabel: true})).reason, 'low_confidence');
  assert.equal(f.calls.length, 1);
});
test('revalidates full issue fingerprint and binds label write to original timestamp', async () => {
  const f = fixture(); const result = await f.workflow.triageIssue(f.context, {...request, writeLabel: true});
  assert.equal(result.label, 'bug'); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].arguments.expectedUpdatedAt, original.updatedAt);
  assert.equal(result.fingerprint, issueFingerprint(original));
});
test('changed content at same timestamp stops every write', async () => {
  const f = fixture({invoke: async (_call, calls) => ({state: 'confirmed',
    result: calls.length === 1 ? original : {...original, body: 'Changed while classifying'}, evidenceRefs: []})});
  assert.equal((await f.workflow.triageIssue(f.context, {...request, writeLabel: true})).reason, 'issue_changed');
  assert.equal(f.calls.length, 2);
});
test('no grant pauses before a label write', async () => {
  const f = fixture({authorizationRefFor: name => name === 'github.issue.label' ? undefined : 'read-scope'});
  assert.equal((await f.workflow.triageIssue(f.context, {...request, writeLabel: true})).state, 'waiting_approval');
  assert.equal(f.calls.length, 1);
});
test('prewrite approval resumes durable classification without another model budget', async () => {
  let prewriteReads = 0;
  const f = fixture({totalTokens: 1800, invoke: async call => {
    if (call.toolName === 'github.issue.label') return {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['label']};
    if (call.runId.endsWith(':prewrite') && ++prewriteReads === 1) return {state: 'pending', evidenceRefs: []};
    return {state: 'confirmed', result: original, evidenceRefs: ['read']};
  }});
  const write = {...request, writeLabel: true};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  assert.equal(f.modelCalls.length, 1);
  // JSON checkpoint round-trip represents a new caller after a host restart.
  for (const [key, value] of f.checkpoints) f.checkpoints.set(key, JSON.parse(JSON.stringify(value)));
  const restarted = fixture({totalTokens: 1800, invoke: async call => ({state: 'confirmed',
    result: call.toolName === 'github.issue.label' ? {state: 'confirmed'} : original, evidenceRefs: ['restart-read']})});
  restarted.context.loadCheckpoint = f.context.loadCheckpoint;
  restarted.context.saveCheckpoint = f.context.saveCheckpoint;
  const result = await restarted.workflow.triageIssue(restarted.context, write);
  assert.equal(result.label, 'bug');
  assert.equal(restarted.modelCalls.length, 0);
  assert.equal(restarted.calls.filter(call => call.toolName === 'github.issue.label').length, 1);
});
test('classification waiting for a grant is reused but changed issue facts block every effect', async () => {
  let labelAllowed = false, changed = false;
  const f = fixture({authorizationRefFor: name => name === 'github.issue.label' && !labelAllowed ? undefined : 'scope',
    invoke: async call => ({state: 'confirmed', result: call.toolName === 'github.issue.label'
      ? {state: 'confirmed'} : {...original, body: changed ? 'Issue changed after classification' : original.body}, evidenceRefs: []})});
  const write = {...request, writeLabel: true};
  for (let i = 0; i < 3; i++) assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  assert.equal(f.modelCalls.length, 1);
  labelAllowed = true; changed = true;
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'issue_changed');
  assert.equal(f.modelCalls.length, 1);
  assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
  assert.equal(f.repairs.length, 0);
});
test('interrupted model reservation persists and never blind resubmits the unknown call', async () => {
  let release;
  const f = fixture({modelComplete: () => new Promise(resolve => {release = resolve;})});
  const controller = new AbortController(); f.context.signal = controller.signal;
  const first = f.workflow.triageIssue(f.context, {...request, writeLabel: true});
  for (let i = 0; !release && i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(release); controller.abort();
  assert.equal((await first).state, 'manual_review');
  const restarted = new AbortController(); f.context.signal = restarted.signal;
  release({response: {kind: 'final', text: JSON.stringify(answer)}, usage: {totalTokens: 50}});
  await Promise.resolve(); await Promise.resolve();
  const resumed = f.workflow.triageIssue(f.context, {...request, writeLabel: true});
  try {
    const result = await Promise.race([resumed, new Promise(resolve => setImmediate(() => resolve({reason: 'still-waiting'})))]);
    assert.equal(result.reason, 'classification_result_unknown');
    assert.equal(f.modelCalls.length, 1);
    assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
  } finally {restarted.abort(); await resumed;}
});
test('resumed classification rechecks prewrite facts at the same timestamp', async () => {
  let resumed = false;
  const f = fixture({invoke: async call => {
    if (call.toolName === 'github.issue.label') return {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: []};
    if (call.runId.endsWith(':prewrite')) return resumed
      ? {state: 'confirmed', result: {...original, body: 'New facts at the original timestamp'}, evidenceRefs: []}
      : {state: 'pending', evidenceRefs: []};
    return {state: 'confirmed', result: original, evidenceRefs: []};
  }});
  const write = {...request, writeLabel: true, repairBug: true, repairGoal: 'authorized repair'};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  resumed = true;
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'issue_changed');
  assert.equal(f.modelCalls.length, 1);
  assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
  assert.equal(f.repairs.length, 0);
});
test('classification journal rejects corrupted evidence, budget or task binding without another model', async () => {
  for (const mutate of [journal => {journal.classification.evidence[0].quote = 'invented';},
    journal => {journal.tokens = -1;}, journal => {journal.maxTokens++;},
    journal => {journal.taskId = 'other-task';}, journal => {journal.phase = 'invalid';}]) {
    const f = fixture({authorizationRefFor: name => name === 'github.issue.label' ? undefined : 'scope'});
    const write = {...request, writeLabel: true};
    await f.workflow.triageIssue(f.context, write);
    const [key, journal] = [...f.checkpoints].find(([key]) => key.endsWith(':classification-v1'));
    mutate(journal); f.checkpoints.set(key, JSON.parse(JSON.stringify(journal)));
    assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'invalid_classification_checkpoint');
    assert.equal(f.modelCalls.length, 1);
    assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
  }
});
test('settled invalid model reply consumes its reservation and is not retried', async () => {
  for (const override of [{modelText: 'not JSON'}, {totalTokens: 4096}]) {
    const f = fixture(override); const write = {...request, writeLabel: true};
    const first = await f.workflow.triageIssue(f.context, write);
    assert.equal(first.state, 'manual_review');
    assert.equal((await f.workflow.triageIssue(f.context, write)).reason, first.reason);
    assert.equal(f.modelCalls.length, 1);
    assert.equal(f.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
  }
});
test('a narrower restart budget cannot reuse the old classification reservation', async () => {
  const f = fixture({authorizationRefFor: name => name === 'github.issue.label' ? undefined : 'scope'});
  const write = {...request, writeLabel: true};
  await f.workflow.triageIssue(f.context, write);
  const restarted = fixture({maxTokens: 1024});
  restarted.context.loadCheckpoint = f.context.loadCheckpoint;
  restarted.context.saveCheckpoint = f.context.saveCheckpoint;
  assert.equal((await restarted.workflow.triageIssue(restarted.context, write)).reason, 'invalid_classification_checkpoint');
  assert.equal(restarted.modelCalls.length, 0);
  assert.equal(restarted.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
});
test('unknown label result is retained and never repeated', async () => {
  const f = fixture({invoke: async call => call.toolName === 'github.issue.label'
    ? {state: 'unknown', evidenceRefs: ['unknown-evidence']} : {state: 'confirmed', result: original, evidenceRefs: []}});
  const write = {...request, writeLabel: true};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  assert.equal(f.calls.filter(c => c.toolName === 'github.issue.label').length, 1);
});
test('pending label resumes only through identical Gateway run ID and arguments', async () => {
  let writes = 0;
  const f = fixture({invoke: async call => call.toolName === 'github.issue.label'
    ? (++writes === 1 ? {state: 'pending', evidenceRefs: []} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: []})
    : {state: 'confirmed', result: original, evidenceRefs: []}});
  const write = {...request, writeLabel: true};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  assert.equal((await f.workflow.triageIssue(f.context, write)).label, 'bug');
  const calls = f.calls.filter(c => c.toolName === 'github.issue.label');
  assert.equal(calls[0].runId, calls[1].runId); assert.deepEqual(calls[0].arguments, calls[1].arguments);
  assert.equal(f.modelCalls.length, 1);
});
test('unknown label requires exact host confirmed receipt before cached original run replay', async () => {
  let ready = false, writes = 0;
  const checked = [];
  const f = fixture({confirmedReplayReady: (runId, context) => {checked.push({runId, taskId: context.taskId}); return ready;},
    invoke: async call => call.toolName === 'github.issue.label'
      ? (++writes === 1 ? {state: 'unknown', evidenceRefs: []} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['confirmed-cache']})
      : {state: 'confirmed', result: original, evidenceRefs: []}});
  const write = {...request, writeLabel: true};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  await f.workflow.triageIssue(f.context, write); assert.equal(writes, 1);
  ready = true;
  assert.equal((await f.workflow.triageIssue(f.context, write)).label, 'bug');
  const calls = f.calls.filter(c => c.toolName === 'github.issue.label');
  assert.equal(calls[0].runId, calls[1].runId); assert.deepEqual(calls[0].arguments, calls[1].arguments);
  assert.equal(checked[0].runId, calls[0].runId); assert.equal(checked[0].taskId, f.context.taskId);
});
test('unknown MOD-34 repair stays paused until original checkpoint receipts are confirmed', async () => {
  let ready = false, attempts = 0;
  const f = fixture({confirmedRepairReplayReady: (ctx, issue) => ready && ctx.taskId === 'triage-task' && issue.number === 7,
    repairIssue: async () => (++attempts === 1
      ? {state: 'waiting_reconciliation', resultSummary: 'Original MOD34 run unknown', evidenceRefs: []}
      : {state: 'succeeded', resultSummary: 'Original MOD34 cached confirmed', evidenceRefs: ['repair-cache']})});
  const repair = {...request, repairBug: true, repairGoal: 'host-authorized repair'};
  assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'waiting_reconciliation');
  await f.workflow.triageIssue(f.context, repair); assert.equal(attempts, 1);
  ready = true;
  assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'repair_requested');
  assert.equal(f.repairs[0].ctx.taskId, f.repairs[1].ctx.taskId);
  assert.deepEqual(f.repairs[0].request, f.repairs[1].request);
});
test('new factory after JSON restart retains the original repair binding when labels and timestamps change', async () => {
  const repair = {...request, writeLabel: true, repairBug: true, repairGoal: 'host-authorized repair'};
  let labelled = false;
  const first = fixture({invoke: async call => {
    if (call.toolName === 'github.issue.label') {labelled = true; return {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['label']};}
    return {state: 'confirmed', result: {...original, labels: labelled ? ['bug'] : [],
      updatedAt: labelled ? '2026-10-01T01:00:00Z' : original.updatedAt}, evidenceRefs: ['read']};
  }, repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'original MOD34 approval pending', evidenceRefs: ['repair-pending']})});
  assert.equal((await first.workflow.triageIssue(first.context, repair)).state, 'waiting_approval');
  const persisted = new Map(JSON.parse(JSON.stringify([...first.checkpoints])));
  const restarted = fixture({invoke: async () => ({state: 'confirmed', result: {...original, labels: ['bug', 'triaged'],
    updatedAt: '2026-10-01T02:00:00Z'}, evidenceRefs: ['restart-read']})});
  restarted.context.loadCheckpoint = key => persisted.get(key);
  restarted.context.saveCheckpoint = (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value)));
  assert.equal((await restarted.workflow.triageIssue(restarted.context, repair)).state, 'repair_requested');
  assert.deepEqual(restarted.repairs[0].request, first.repairs[0].request);
  assert.equal(restarted.modelCalls.length, 0);
  assert.equal(restarted.calls.filter(call => call.toolName === 'github.issue.label').length, 0);
});
test('unknown repair source survives restart and metadata changes without replay until host confirmation', async () => {
  const repair = {...request, repairBug: true, repairGoal: 'host-authorized repair'};
  const first = fixture({repairIssue: async () => ({state: 'waiting_reconciliation', resultSummary: 'original run unknown', evidenceRefs: []})});
  await first.workflow.triageIssue(first.context, repair);
  const persisted = new Map(JSON.parse(JSON.stringify([...first.checkpoints])));
  let confirmed = false;
  const restarted = fixture({confirmedRepairReplayReady: () => confirmed, invoke: async () => ({state: 'confirmed',
    result: {...original, labels: ['triaged'], updatedAt: '2026-10-01T01:00:00Z'}, evidenceRefs: ['current-read']})});
  restarted.context.loadCheckpoint = key => persisted.get(key);
  restarted.context.saveCheckpoint = (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value)));
  assert.equal((await restarted.workflow.triageIssue(restarted.context, repair)).state, 'waiting_reconciliation');
  assert.equal(restarted.calls.length, 0); assert.equal(restarted.repairs.length, 0);
  confirmed = true;
  assert.equal((await restarted.workflow.triageIssue(restarted.context, repair)).state, 'repair_requested');
  assert.deepEqual(restarted.repairs[0].request, first.repairs[0].request);
  assert.equal(restarted.modelCalls.length, 0);
});
test('repair recovery still rejects changed content, closed issues and sensitive facts before delegating', async () => {
  for (const change of [{body: 'Changed crash description'}, {state: 'closed'}, {body: 'security vulnerability disclosure'}]) {
    const f = fixture({repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'pending repair', evidenceRefs: []})});
    const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
    await f.workflow.triageIssue(f.context, repair);
    const restarted = fixture({invoke: async () => ({state: 'confirmed', result: {...original, ...change}, evidenceRefs: []})});
    restarted.context.loadCheckpoint = f.context.loadCheckpoint; restarted.context.saveCheckpoint = f.context.saveCheckpoint;
    assert.equal((await restarted.workflow.triageIssue(restarted.context, repair)).reason, 'issue_changed_before_repair');
    assert.equal(restarted.repairs.length, 0); assert.equal(restarted.modelCalls.length, 0);
  }
});
test('confirmed run-ID read caches cannot hide changed issue facts after a repair approval restart', async () => {
  for (const change of [{body: 'Changed crash description'}, {state: 'closed'}, {body: 'security vulnerability disclosure'},
    {labels: ['triaged'], updatedAt: '2026-10-01T01:00:00Z'}]) {
    const cache = new Map(), dispatchedReads = [];
    let current = original;
    const invoke = async call => {
      if (cache.has(call.runId)) return structuredClone(cache.get(call.runId));
      dispatchedReads.push(call.runId);
      const outcome = {state: 'confirmed', result: structuredClone(current), evidenceRefs: ['fresh-read']};
      cache.set(call.runId, outcome); return structuredClone(outcome);
    };
    const first = fixture({invoke, repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'repair approval pending', evidenceRefs: []})});
    const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
    await first.workflow.triageIssue(first.context, repair);
    assert.equal(dispatchedReads.length, 3);
    const persisted = new Map(JSON.parse(JSON.stringify([...first.checkpoints])));
    current = {...original, ...change};
    const restarted = fixture({invoke});
    restarted.context.loadCheckpoint = key => persisted.get(key);
    restarted.context.saveCheckpoint = (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value)));
    const result = await restarted.workflow.triageIssue(restarted.context, repair);
    assert.equal(dispatchedReads.length, 4);
    assert.ok(dispatchedReads[3].endsWith(':repair-read-1'));
    if (change.labels) {
      assert.equal(result.state, 'repair_requested');
      assert.deepEqual(restarted.repairs[0].request, first.repairs[0].request);
    } else {
      assert.equal(result.reason, 'issue_changed_before_repair'); assert.equal(restarted.repairs.length, 0);
    }
    assert.equal(restarted.modelCalls.length, 0);
  }
});
test('fresh repair read approvals retain one identity and one reserved step across repeated JSON recovery', async () => {
  const cache = new Map(), pendingIds = [];
  let approved = false, repairAttempts = 0;
  const f = fixture({maxSteps: 7, invoke: async call => {
    if (cache.has(call.runId)) return structuredClone(cache.get(call.runId));
    if (call.runId.endsWith(':repair-read-1') && !approved) {pendingIds.push(call.runId); return {state: 'pending', evidenceRefs: []};}
    const outcome = {state: 'confirmed', result: structuredClone(original), evidenceRefs: ['read']};
    cache.set(call.runId, outcome); return structuredClone(outcome);
  }, repairIssue: async () => ({state: ++repairAttempts === 1 ? 'waiting_approval' : 'succeeded', resultSummary: 'original repair', evidenceRefs: []})});
  const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
  await f.workflow.triageIssue(f.context, repair);
  for (let i = 0; i < 3; i++) {
    for (const [key, value] of f.checkpoints) f.checkpoints.set(key, JSON.parse(JSON.stringify(value)));
    assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'waiting_approval');
    const journal = [...f.checkpoints.values()].find(value => value.pendingRepair);
    assert.equal(journal.steps, 6); assert.equal(journal.repairRead.generation, 1); assert.equal(journal.repairRead.reserved, true);
  }
  assert.equal(new Set(pendingIds).size, 1); assert.equal(repairAttempts, 1);
  approved = true;
  assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'repair_requested');
  assert.equal(repairAttempts, 2); assert.deepEqual(f.repairs[0].request, f.repairs[1].request);
});
test('repair generations and fresh reads stop at the original persisted step budget', async () => {
  const cache = new Map(), reads = [];
  const f = fixture({maxSteps: 7, invoke: async call => {
    if (cache.has(call.runId)) return structuredClone(cache.get(call.runId));
    reads.push(call.runId);
    const outcome = {state: 'confirmed', result: structuredClone(original), evidenceRefs: ['read']};
    cache.set(call.runId, outcome); return structuredClone(outcome);
  }, repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'same pending repair', evidenceRefs: []})});
  const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
  await f.workflow.triageIssue(f.context, repair); await f.workflow.triageIssue(f.context, repair);
  for (let i = 0; i < 4; i++) {
    for (const [key, value] of f.checkpoints) f.checkpoints.set(key, JSON.parse(JSON.stringify(value)));
    assert.equal((await f.workflow.triageIssue(f.context, repair)).reason, 'step_budget_exhausted');
  }
  assert.equal(f.repairs.length, 2); assert.equal(reads.length, 4);
  const journal = [...f.checkpoints.values()].find(value => value.pendingRepair);
  assert.equal(journal.steps, 7); assert.equal(journal.repairRead.generation, 2);
});
test('legacy repair checkpoints get a fresh read instead of their cached repair-read snapshot', async () => {
  const cache = new Map(); let current = original;
  const f = fixture({invoke: async call => {
    if (cache.has(call.runId)) return structuredClone(cache.get(call.runId));
    const outcome = {state: 'confirmed', result: structuredClone(current), evidenceRefs: ['read']};
    cache.set(call.runId, outcome); return structuredClone(outcome);
  }, repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'original repair', evidenceRefs: []})});
  const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
  await f.workflow.triageIssue(f.context, repair);
  const [key, journal] = [...f.checkpoints].find(([, value]) => value.pendingRepair);
  delete journal.repairRead; delete journal.steps; delete journal.maxSteps;
  f.checkpoints.set(key, JSON.parse(JSON.stringify(journal)));
  current = {...original, state: 'closed'};
  assert.equal((await f.workflow.triageIssue(f.context, repair)).reason, 'issue_changed_before_repair');
  assert.ok(f.calls.at(-1).runId.endsWith(':repair-read-1')); assert.equal(f.repairs.length, 1);
});
test('damaged repair generation or budget cannot request a new read or delegate', async () => {
  for (const mutate of [value => {value.repairRead.generation = -1;}, value => {value.repairRead.steps = 0;},
    value => {value.repairRead.reserved = 'yes';}, value => {value.repairRead.maxSteps++;}, value => {value.steps++;}]) {
    const f = fixture({repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'original repair', evidenceRefs: []})});
    const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
    await f.workflow.triageIssue(f.context, repair);
    const [key, journal] = [...f.checkpoints].find(([, value]) => value.pendingRepair);
    mutate(journal); f.checkpoints.set(key, JSON.parse(JSON.stringify(journal)));
    const calls = f.calls.length;
    assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'manual_review');
    assert.equal(f.calls.length, calls); assert.equal(f.repairs.length, 1);
  }
});
test('legacy repair checkpoints resume identical metadata but never guess a changed MOD34 binding', async () => {
  for (const changed of [false, true]) {
    const f = fixture({repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'pending repair', evidenceRefs: []})});
    const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
    await f.workflow.triageIssue(f.context, repair);
    const [key, journal] = [...f.checkpoints].find(([key]) => !key.endsWith(':classification-v1'));
    delete journal.pendingRepairSource;
    f.checkpoints.set(key, JSON.parse(JSON.stringify(journal)));
    const restarted = fixture({invoke: async () => ({state: 'confirmed', result: {...original,
      labels: changed ? ['triaged'] : [], updatedAt: changed ? '2026-10-01T01:00:00Z' : original.updatedAt}, evidenceRefs: []})});
    restarted.context.loadCheckpoint = f.context.loadCheckpoint; restarted.context.saveCheckpoint = f.context.saveCheckpoint;
    const result = await restarted.workflow.triageIssue(restarted.context, repair);
    assert.equal(result.state, changed ? 'manual_review' : 'repair_requested');
    assert.equal(restarted.repairs.length, changed ? 0 : 1);
    if (changed) assert.equal(result.reason, 'repair_checkpoint_source_missing');
    else assert.deepEqual(restarted.repairs[0].request, f.repairs[0].request);
  }
});
test('a corrupted persisted repair source cannot replace the original issue facts', async () => {
  for (const mutate of [source => {source.body = 'Different original source';}, source => {source.labels.push('changed-binding');},
    source => {source.updatedAt = '2026-10-01T01:00:00Z';}]) {
    const f = fixture({repairIssue: async () => ({state: 'waiting_approval', resultSummary: 'pending repair', evidenceRefs: []})});
    const repair = {...request, repairBug: true, repairGoal: 'authorized repair'};
    await f.workflow.triageIssue(f.context, repair);
    const [key, journal] = [...f.checkpoints].find(([key]) => !key.endsWith(':classification-v1'));
    mutate(journal.pendingRepairSource);
    f.checkpoints.set(key, JSON.parse(JSON.stringify(journal)));
    assert.equal((await f.workflow.triageIssue(f.context, repair)).state, 'manual_review');
    assert.equal(f.repairs.length, 1);
  }
});
test('read pending and unknown remain Runtime pause states', async () => {
  for (const [state, expected] of [['pending', 'waiting_approval'], ['unknown', 'waiting_reconciliation']]) {
    const f = fixture({invoke: async () => ({state, evidenceRefs: []})});
    assert.equal((await f.workflow.triageIssue(f.context, request)).state, expected); assert.equal(f.modelCalls.length, 0);
  }
});
test('bug repair delegates exactly once with non-closing PR issue backlink', async () => {
  const f = fixture(); const repair = {...request, repairBug: true, repairGoal: 'Fix save crash in authorized workspace'};
  const result = await f.workflow.triageIssue(f.context, repair);
  assert.equal(result.state, 'repair_requested'); assert.equal(f.repairs.length, 1);
  assert.match(f.repairs[0].request.pullRequestBody, /Related issue: https:\/\/github.com\/example\/project\/issues\/7/);
  assert.doesNotMatch(f.repairs[0].request.pullRequestBody, /(?:Fixes|Closes) #/);
  await f.workflow.triageIssue(f.context, repair); assert.equal(f.repairs.length, 1);
});
test('feature request never invokes bug repair', async () => {
  const f = fixture({answer: {...answer, kind: 'feature'}});
  await f.workflow.triageIssue(f.context, {...request, repairBug: true, repairGoal: 'host goal'});
  assert.equal(f.repairs.length, 0);
});
test('step and token budgets prevent effects and model overrun', async () => {
  const steps = fixture({maxSteps: 2});
  assert.equal((await steps.workflow.triageIssue(steps.context, {...request, writeLabel: true})).reason, 'step_budget_exhausted');
  const tokens = fixture({maxTokens: 64});
  assert.equal((await tokens.workflow.triageIssue(tokens.context, request)).reason, 'token_budget_exhausted');
  assert.equal(tokens.modelCalls.length, 0);
});
test('cancelled and expired contexts cannot invoke tool or model', async () => {
  for (const expired of [false, true]) {
    const f = fixture();
    if (expired) f.context.deadline = '2000-01-01T00:00:00Z';
    else {const controller = new AbortController(); controller.abort(); f.context.signal = controller.signal;}
    assert.equal((await f.workflow.triageIssue(f.context, request)).state, 'manual_review');
    assert.equal(f.calls.length, 0); assert.equal(f.modelCalls.length, 0);
  }
});
test('list preserves remote page cursor and tool evidence', async () => {
  const f = fixture({invoke: async () => ({state: 'confirmed', result: {items: [original], page: 2, nextPage: 3, hasMore: true}, evidenceRefs: ['list-evidence']})});
  const result = await f.workflow.listIssues(f.context, {repo: request.repo, page: 2, perPage: 10});
  assert.equal(result.state, 'listed'); assert.equal(result.nextPage, 3); assert.equal(result.items[0].number, 7);
  assert.deepEqual(result.evidenceRefs, ['list-evidence']);
});

test('pending label approval refreshes same-timestamp body, labels and state without reclassifying', async () => {
  for (const change of [{body: 'Security vulnerability password token leaked'}, {body: 'Now asks for documentation'},
    {labels: ['question']}, {state: 'closed'}]) {
    let resumed = false, writes = 0;
    const f = fixture({invoke: async call => call.toolName === 'github.issue.label'
      ? (++writes === 1 ? {state: 'pending', evidenceRefs: ['pending-label']} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: []})
      : {state: 'confirmed', result: {...original, ...(resumed ? change : {})}, evidenceRefs: ['fresh-read']}});
    const write = {...request, writeLabel: true};
    assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
    resumed = true;
    assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'issue_changed');
    assert.equal(writes, 1); assert.equal(f.modelCalls.length, 1);
  }
});
test('confirmed unknown label consumes original receipt before rejecting changed sensitive facts', async () => {
  let ready = false, writes = 0;
  const f = fixture({confirmedReplayReady: () => ready, invoke: async call => call.toolName === 'github.issue.label'
    ? (++writes === 1 ? {state: 'unknown', evidenceRefs: ['unknown-write']} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['original-receipt']})
    : {state: 'confirmed', result: {...original, ...(ready ? {body: 'Security vulnerability password token leaked'} : {})}, evidenceRefs: ['fresh-read']}});
  const write = {...request, writeLabel: true, repairBug: true, repairGoal: 'Fix authorized file'};
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  ready = true;
  const result = await f.workflow.triageIssue(f.context, write);
  assert.equal(result.reason, 'issue_changed'); assert.equal(result.state, 'manual_review');
  assert.equal(result.label, 'bug'); assert.ok(result.evidenceRefs.includes('original-receipt'));
  assert.equal(f.repairs.length, 0); assert.equal(writes, 2);
  const labels = f.calls.filter(c => c.toolName === 'github.issue.label');
  assert.equal(labels[0].runId, labels[1].runId); assert.deepEqual(labels[0].arguments, labels[1].arguments);
  assert.equal(f.calls.at(-1).toolName, 'github.issue.get');
});
test('unknown approval refreshes reserve unique reads and exhaust durable budget without new writes', async () => {
  let paused = false, writes = 0;
  const f = fixture({maxSteps: 6, invoke: async call => call.toolName === 'github.issue.label'
    ? (++writes, {state: 'pending', evidenceRefs: []})
    : paused ? {state: 'unknown', evidenceRefs: ['unknown-read']} : {state: 'confirmed', result: original, evidenceRefs: []}});
  const write = {...request, writeLabel: true};
  await f.workflow.triageIssue(f.context, write); paused = true;
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_reconciliation');
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'step_budget_exhausted');
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'step_budget_exhausted');
  const reads = f.calls.filter(c => c.runId.includes('label-resume-read'));
  assert.equal(reads.length, 2); assert.notEqual(reads[0].runId, reads[1].runId);
  assert.equal(writes, 1); assert.equal(f.modelCalls.length, 1);
});
test('cancelled post-receipt refresh preserves receipt and advances the next read identity', async () => {
  let ready = false, writes = 0, stalled = false, release;
  const f = fixture({confirmedReplayReady: () => ready, invoke: async call => {
    if (call.toolName === 'github.issue.label') return ++writes === 1
      ? {state: 'unknown', evidenceRefs: []} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['receipt']};
    if (stalled) return new Promise(resolve => {release = resolve;});
    return {state: 'confirmed', result: original, evidenceRefs: ['read']};
  }});
  const write = {...request, writeLabel: true};
  await f.workflow.triageIssue(f.context, write); ready = true; stalled = true;
  const controller = new AbortController(); f.context.signal = controller.signal;
  const attempt = f.workflow.triageIssue(f.context, write);
  for (let i = 0; !release && i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(release); controller.abort(); await attempt;
  f.context.signal = new AbortController().signal; stalled = false;
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'label_confirmed');
  release({state: 'confirmed', result: {...original, body: 'late result'}, evidenceRefs: []});
  const reads = f.calls.filter(c => c.runId.includes('label-resume-read'));
  assert.equal(reads.length, 2); assert.notEqual(reads[0].runId, reads[1].runId);
  assert.equal(writes, 2); assert.equal(f.modelCalls.length, 1);
});
test('pending resume GET consumes its approved cache once before the next approval uses a new read', async () => {
  let writes = 0, approvedRead;
  const f = fixture({maxSteps: 6, invoke: async call => {
    if (call.toolName === 'github.issue.label') return ++writes < 3
      ? {state: 'pending', evidenceRefs: ['label-pending']} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: []};
    if (call.runId.includes('label-resume-read') && call.runId !== approvedRead) return {state: 'pending', evidenceRefs: ['read-pending']};
    return {state: 'confirmed', result: original, evidenceRefs: ['approved-read']};
  }});
  const write = {...request, writeLabel: true};
  await f.workflow.triageIssue(f.context, write);
  for (let i = 0; i < 3; i++) assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  const first = f.calls.at(-1).runId;
  assert.equal(new Set(f.calls.filter(c => c.runId.includes('label-resume-read')).map(c => c.runId)).size, 1);
  approvedRead = first;
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'label_approval_pending');
  assert.equal(writes, 2);
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  const second = f.calls.at(-1).runId; assert.notEqual(second, first);
  approvedRead = second;
  assert.equal((await f.workflow.triageIssue(f.context, write)).reason, 'label_confirmed');
  assert.equal(writes, 3); assert.equal(f.modelCalls.length, 1);
});
test('post-receipt pending GET retains read approval and never reconsumes label receipt', async () => {
  let ready = false, writes = 0, approvedRead;
  const f = fixture({confirmedReplayReady: () => ready, invoke: async call => {
    if (call.toolName === 'github.issue.label') return ++writes === 1
      ? {state: 'unknown', evidenceRefs: ['unknown-label']} : {state: 'confirmed', result: {state: 'confirmed'}, evidenceRefs: ['receipt']};
    if (ready && call.runId !== approvedRead) return {state: 'pending', evidenceRefs: ['pending-read']};
    return {state: 'confirmed', result: original, evidenceRefs: ['read']};
  }});
  const write = {...request, writeLabel: true};
  await f.workflow.triageIssue(f.context, write); ready = true;
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  const pendingRun = f.calls.at(-1).runId;
  assert.equal((await f.workflow.triageIssue(f.context, write)).state, 'waiting_approval');
  assert.equal(f.calls.at(-1).runId, pendingRun); assert.equal(writes, 2);
  approvedRead = pendingRun;
  const result = await f.workflow.triageIssue(f.context, write);
  assert.equal(result.reason, 'label_confirmed'); assert.ok(result.evidenceRefs.includes('receipt'));
  assert.equal(writes, 2);
});

test('factory retains ports and validated budgets when caller reuses configuration during a read',async()=>{
  let release,entered;const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const f=fixture({invoke:async call=>{entered();await wait;return {state:'confirmed',result:call.toolName==='github.issue.label'?{state:'confirmed'}:original,evidenceRefs:['original-port']};}});
  const requestWithRepair={...request,writeLabel:true,repairBug:true,repairGoal:'Fix authorized file'};
  const running=f.workflow.triageIssue(f.context,requestWithRepair);await reached;
  let newCalls=0;
  f.options.model={complete:async()=>{newCalls++;throw Error('new model');}};
  f.options.tools={list:()=>[],invoke:async()=>{newCalls++;throw Error('new tools');}};
  f.options.repair={repairIssue:async()=>{newCalls++;throw Error('new repair');}};
  f.options.maxSteps=1;f.options.maxTokens=1;
  release();const result=await running;
  assert.equal(result.state,'repair_requested');assert.equal(result.classification.kind,'bug');
  assert.equal(newCalls,0);assert.equal(f.modelCalls.length,1);assert.equal(f.repairs.length,1);
  assert.ok([...f.checkpoints.values()].filter(v=>v.maxSteps!==undefined).every(v=>v.maxSteps===8));
  const next=createIssueTriageWorkflow(f.options);
  assert.equal((await next.triageIssue({...f.context,taskId:'new-factory'},request)).state,'manual_review');
});
test('captured tool port keeps authorization and capability revocation live across reads',async()=>{
  for(const revoke of ['authorization','capability']) {
    let release,entered;const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
    const f=fixture({invoke:async()=>{entered();await wait;return {state:'confirmed',result:original,evidenceRefs:[]};}});
    const running=f.workflow.triageIssue(f.context,{...request,writeLabel:true});await reached;
    if(revoke==='authorization')f.options.authorizationRefFor=name=>name==='github.issue.label'?undefined:'scope';
    else f.options.tools.list=()=>[{name:'github.issue.get',version:'1.0.0'}];
    release();const result=await running;
    assert.equal(result.state,revoke==='authorization'?'waiting_approval':'manual_review');
    assert.equal(f.calls.filter(c=>c.toolName==='github.issue.label').length,0);
  }
});
test('confirmed replay hook properties remain live after factory creation',async()=>{
  let writes=0;
  const f=fixture({invoke:async call=>call.toolName==='github.issue.label'
    ? (++writes===1?{state:'unknown',evidenceRefs:[]}:{state:'confirmed',result:{state:'confirmed'},evidenceRefs:['receipt']})
    : {state:'confirmed',result:original,evidenceRefs:[]}});
  const write={...request,writeLabel:true};
  assert.equal((await f.workflow.triageIssue(f.context,write)).state,'waiting_reconciliation');
  f.options.confirmedReplayReady=()=>true;
  assert.equal((await f.workflow.triageIssue(f.context,write)).reason,'label_confirmed');assert.equal(writes,2);
  let attempts=0;
  const repair=fixture({repairIssue:async()=>++attempts===1
    ? {state:'waiting_reconciliation',resultSummary:'unknown repair',evidenceRefs:[]}
    : {state:'succeeded',resultSummary:'confirmed repair',evidenceRefs:['repair-receipt']}});
  const requestRepair={...request,repairBug:true,repairGoal:'Fix authorized file'};
  assert.equal((await repair.workflow.triageIssue(repair.context,requestRepair)).state,'waiting_reconciliation');
  repair.options.confirmedRepairReplayReady=()=>true;
  assert.equal((await repair.workflow.triageIssue(repair.context,requestRepair)).state,'repair_requested');
  assert.equal(attempts,2);
});
