// MOD-28 P5 Calendar 来源版本绑定口的定向测试。
// 运行：node --test packages/cognition/test/reviewed-meeting-source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {CognitionError} from '../dist/impact.js';
import {createTrustedMeetingSourceRevisionReader} from '../dist/reviewed-meeting-source.js';
import {createCommittedMeetingProjectionReader} from '../dist/reviewed-meeting.js';

const now = () => Date.parse('2026-11-07T08:00:00Z');
const deadline = '2026-11-07T08:01:00Z';
const signal = new AbortController().signal;
const context = {deadline, signal};
const event = {
  eventId: 'evt-1',
  source: 'caldav://account-1/calendar/uid-meeting-1.ics',
  meetingFactId: 'fact-meeting-1',
  originalSummary: '星河例会（旧）',
  newSummary: '星河例会（新时间）',
  sourceRevision: '7',
  detectedAt: '2026-11-07T07:59:00Z',
  deadline,
  signal,
};

const confirmedRead = (overrides = {}) => ({
  source: event.source,
  sequence: '7',
  externalId: 'uid-meeting-1.ics',
  accountRef: 'account-1',
  evidenceRefs: ['evidence-read-1', 'evidence-read-2'],
  currentSummary: event.newSummary,
  fetchedAt: '2026-11-07T07:59:30Z',
  ...overrides,
});

const fact = (overrides = {}) => ({
  id: 'fact-meeting-1',
  revision: 4,
  sourceRef: event.source,
  summary: event.newSummary,
  state: 'active',
  kind: 'fact',
  reason: 'meeting reschedule [sourceRevision: 7]',
  ...overrides,
});

// 语义：省略参数 = 用默认夹具；显式传 undefined = 该端口不返回数据（fail-closed 路径）
const reader = (...args) => {
  const read = args.length >= 1 ? args[0] : confirmedRead();
  const currentFact = args.length >= 2 ? args[1] : fact();
  return createTrustedMeetingSourceRevisionReader({
    namespace: 'p5-calendar',
    readConfirmedCalendarEvent: async () => (read === undefined ? undefined : structuredClone(read)),
    readMeetingFact: async () => (currentFact === undefined ? undefined : structuredClone(currentFact)),
    now,
  });
};

test('happy path：来源、sequence、Fact 与标记全部一致 → 返回精确绑定', async () => {
  const bound = await reader()(event, context);
  assert.deepEqual(bound, {source: event.source, sourceRevision: '7', meetingFact: {id: 'fact-meeting-1', revision: 4}});
});

test('与 createCommittedMeetingProjectionReader 组合：绑定通过且 store/facts 一致时读回 completed projection', async () => {
  const bound = await reader()(event, context);
  const factNode = {...fact(), graphRevision: 12};
  const snapshot = {namespace: 'p5-calendar', history: [factNode]};
  const receipt = {
    completed: {batchToken: 'batch-1', report: {}},
    projection: {graphRevision: 13, links: [{node: {id: 'fact-meeting-1', revision: 4}}]},
  };
  const readProjection = createCommittedMeetingProjectionReader({
    namespace: 'p5-calendar',
    store: {read: () => snapshot},
    facts: {listImpactReceipts: () => [receipt]},
    readSourceRevision: reader(),
  });
  const result = await readProjection(event, context);
  assert.equal(result.sourceRevision, '7');
  assert.deepEqual(result.meetingFact, {id: 'fact-meeting-1', revision: 4});
  assert.equal(result.input.projection.graphRevision, 13);
});

test('fail-closed：sequence 漂移（日历在事件观测后又变了）→ undefined，不猜版本', async () => {
  const bound = await reader(confirmedRead({sequence: '8'}))(event, context);
  assert.equal(bound, undefined);
});

test('fail-closed：无受信 confirmed 读 / 无 Evidence / fetchedAt 超前 / 非法 sequence', async () => {
  assert.equal(await reader(undefined)(event, context), undefined);
  assert.equal(await reader(confirmedRead({evidenceRefs: []}))(event, context), undefined);
  assert.equal(await reader(confirmedRead({fetchedAt: '2026-11-07T08:30:00Z'}))(event, context), undefined);
  assert.equal(await reader(confirmedRead({sequence: '07'}))(event, context), undefined);
});

test('fail-closed：来源不匹配 / Fact 缺失或非 active / 摘要不一致 / 缺 [sourceRevision] 标记', async () => {
  assert.equal(await reader(confirmedRead({source: 'caldav://other/uid.ics'}))(event, context), undefined);
  assert.equal(await reader(confirmedRead(), undefined)(event, context), undefined);
  assert.equal(await reader(confirmedRead(), fact({state: 'retired'}))(event, context), undefined);
  assert.equal(await reader(confirmedRead({currentSummary: '别的摘要'}))(event, context), undefined);
  // 事件 newSummary 与 Fact/confirmed 读三者必须一致
  assert.equal(await reader(confirmedRead(), fact({summary: '旧摘要'}))(event, context), undefined);
  // 通用 Memory 投影没有 Calendar 标记 → 拒绝（来源顺序约束）
  assert.equal(await reader(confirmedRead(), fact({reason: 'updated by projection'}))(event, context), undefined);
  // 标记 sequence 与 confirmed 读不一致 → 拒绝
  assert.equal(await reader(confirmedRead(), fact({reason: '[sourceRevision: 6]'}))(event, context), undefined);
});

test('构造缺 namespace/端口 → INVALID_ARGUMENT；不提供任何写路径', async () => {
  assert.throws(() => createTrustedMeetingSourceRevisionReader({namespace: '', readConfirmedCalendarEvent: async () => undefined, readMeetingFact: async () => undefined}), CognitionError);
  assert.throws(() => createTrustedMeetingSourceRevisionReader({namespace: 'p5', readConfirmedCalendarEvent: null, readMeetingFact: async () => undefined}), CognitionError);
});
