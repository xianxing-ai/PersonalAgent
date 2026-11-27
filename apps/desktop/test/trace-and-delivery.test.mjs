import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISPATCH_ACK,
  createDelegatedDeliveryTracker,
  delegatedDeliveryHtml,
  describeTraceStepLogo,
  describeTraceStepVerb,
  rememberActivity,
  replaceTraceBlock,
  syncTraceDisclosures,
  traceBlockHtml,
} from '../src/features/conversation/answer-block.js';
import {mainChatReplies} from '../src/features/conversation/result-text.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function parseTraceContainer(doc) {
  function parseBlock(html) {
    const detailsList = [];
    const regex = /<details class="([^"]+)" data-disclosure-key="([^"]+)"( open)?><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const [, className, key, openAttr] = match;
      const summary = {
        focus() { doc.activeElement = this; },
        closest(selector) { return selector.includes('details[data-disclosure-key]') ? detailsNode : null; },
      };
      const detailsNode = {
        className,
        open: Boolean(openAttr),
        dataset: {disclosureKey: key},
        hasAttribute(attr) { return attr === 'open' ? this.open : false; },
        setAttribute(attr) { if (attr === 'open') this.open = true; },
        querySelector(selector) { return selector === 'summary' ? summary : null; },
        closest(selector) { return selector.includes('details[data-disclosure-key]') ? this : null; },
      };
      detailsList.push(detailsNode);
    }
    const idMatch = /data-trace-for="([^"]*)"/.exec(html);
    const block = {
      html,
      dataset: {traceFor: idMatch?.[1] ?? ''},
      detailsList,
      contains(target) { return detailsList.some(d => d === target || d.querySelector('summary') === target); },
      querySelectorAll(selector) { return selector === 'details[data-disclosure-key]' ? detailsList : []; },
      replaceChildren() { this.html = ''; this.detailsList = []; },
      replaceWith(next) {
        this.replacedBy = next;
        if (container.current === this) container.current = next;
      },
    };
    return block;
  }
  const container = {
    current: null,
    parseBlock,
    querySelectorAll(selector) { return selector === '[data-trace-for]' && this.current ? [this.current] : []; },
  };
  return container;
}

test('traceBlockHtml merges reasoning, reasoning_summary, live tools and child steps without bodyWithheld leaks', () => {
  const store = new Map();
  const task = {
    taskId: 'parent-1',
    state: 'running',
    backgroundDelegation: true,
    steps: [
      {stepId: 'dispatch', toolName: 'subagent.dispatch', label: 'subagent.dispatch', state: 'succeeded'},
      {stepId: 's1', toolName: 'fs.read', label: '读取配置', state: 'running'},
    ],
  };
  rememberActivity(store, {taskId: 'parent-1', kind: 'reasoning_summary', text: '先检查配置文件，'});
  rememberActivity(store, {taskId: 'parent-1', kind: 'reasoning', text: '再汇总结果。'});
  rememberActivity(store, {taskId: 'parent-1', kind: 'tool_call', stepId: 's1', label: '读取配置', toolName: 'fs.read', argsSummary: 'config.json'});
  const children = [{
    parentTaskId: 'parent-1',
    taskId: 'child-1',
    state: 'running',
    steps: [{stepId: 's2', label: '扫描目录', state: 'succeeded'}],
    toolActivity: [{stepId: 's2', toolName: 'workspace.list', kind: 'tool_result', state: 'returned', label: '扫描目录'}],
  }];

  const html = traceBlockHtml(task, store.get('parent-1'), children, escape);
  assert.match(html, /正在思考/);
  assert.match(html, /先检查配置文件，再汇总结果。/);
  assert.match(html, /执行过程 · 2 步/);
  assert.match(html, /读取配置/);
  assert.match(html, /扫描目录/);
  assert.doesNotMatch(html, /subagent\.dispatch/);

  const withheld = traceBlockHtml({...task, bodyWithheld: true}, store.get('parent-1'), children, escape);
  assert.equal(withheld, '');
});

test('replaceTraceBlock and syncTraceDisclosures preserve expanded states and summary focus across streaming increments', () => {
  const doc = {
    activeElement: null,
    createElement() {
      return {
        _html: '',
        set innerHTML(value) {
          this._html = value;
          this.firstElementChild = container.parseBlock(value);
        },
      };
    },
  };
  const container = parseTraceContainer(doc);
  const store = new Map();
  const task = {taskId: 'parent-stream', state: 'running'};
  rememberActivity(store, {taskId: 'parent-stream', kind: 'reasoning', text: '第一步思考'});
  rememberActivity(store, {taskId: 'parent-stream', kind: 'tool_call', stepId: 's1', label: '搜索代码'});

  container.current = container.parseBlock(traceBlockHtml(task, store.get('parent-stream'), [], escape));
  const processDetails = container.current.detailsList.find(d => d.dataset.disclosureKey === 'process');
  const thinkingDetails = container.current.detailsList.find(d => d.dataset.disclosureKey === 'thinking');
  assert.equal(processDetails.open, false);
  assert.equal(thinkingDetails.open, false);

  thinkingDetails.open = true;
  processDetails.open = true;
  processDetails.querySelector('summary').focus();

  rememberActivity(store, {taskId: 'parent-stream', kind: 'tool_result', stepId: 's1', resultSummary: '已返回', durationMs: 42});
  replaceTraceBlock(container.current, task, store.get('parent-stream'), [], escape, doc);

  const nextThinking = container.current.detailsList.find(d => d.dataset.disclosureKey === 'thinking');
  const nextProcess = container.current.detailsList.find(d => d.dataset.disclosureKey === 'process');
  assert.equal(nextThinking.open, true);
  assert.equal(nextProcess.open, true);
  assert.equal(doc.activeElement, nextProcess.querySelector('summary'));

  syncTraceDisclosures(container, store);
  const terminalHtml = traceBlockHtml({...task, state: 'succeeded'}, store.get('parent-stream'), [], escape);
  assert.match(terminalHtml, /思考过程/);
  assert.match(terminalHtml, /<details class="trace-disclosure trace-thinking" data-disclosure-key="thinking" open>/);
  assert.match(terminalHtml, /<details class="trace-disclosure trace-process" data-disclosure-key="process" open>/);
});

test('delegated delivery tracker stays silent for latest turns, emits completion chat message when user kept chatting, and resets on session switch', () => {
  const tracker = createDelegatedDeliveryTracker();
  const delegatedTask = {taskId: 't-bg', state: 'running', backgroundDelegation: true, userMessage: '分析日志'};
  const chatTurn = {taskId: 't-chat', state: 'succeeded', userMessage: '随便聊聊', resultSummary: '好的，我们继续聊'};
  const childrenByParent = new Map([['t-bg', [{parentTaskId: 't-bg', taskId: 'c-bg', state: 'running'}]]]);

  // 1. Observed while active
  tracker.observe([{kind: 'task', value: delegatedTask}], childrenByParent, mainChatReplies);
  assert.equal(tracker.list().length, 0);
  assert.match(DISPATCH_ACK, /子智能体/);

  // 2. If user didn't send any newer turns when it completes, do not duplicate at bottom
  const latestTracker = createDelegatedDeliveryTracker();
  latestTracker.observe([{kind: 'task', value: delegatedTask}], childrenByParent, mainChatReplies);
  latestTracker.observe([{kind: 'task', value: {...delegatedTask, state: 'succeeded'}}],
    new Map([['t-bg', [{parentTaskId: 't-bg', taskId: 'c-bg', state: 'succeeded', finalReply: '日志结论在这里'}]]]), mainChatReplies);
  assert.equal(latestTracker.list().length, 0);

  // 3. When user kept chatting in the meantime, completion appends a bottom delivery chat message
  tracker.observe(
    [{kind: 'task', value: delegatedTask}, {kind: 'task', value: chatTurn}],
    childrenByParent,
    mainChatReplies,
  );
  tracker.observe(
    [{kind: 'task', value: {...delegatedTask, state: 'succeeded'}}, {kind: 'task', value: chatTurn}],
    new Map([['t-bg', [{parentTaskId: 't-bg', taskId: 'c-bg', state: 'succeeded', finalReply: '找到 2 个根因'}]]]),
    mainChatReplies,
  );
  const deliveries = tracker.list();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].taskId, 't-bg');
  assert.equal(deliveries[0].reply, '找到 2 个根因');

  const panelMarkup = delegatedDeliveryHtml(deliveries, escape, 'panel');
  const workspaceMarkup = delegatedDeliveryHtml(deliveries, escape, 'workspace');
  assert.match(panelMarkup, /data-turn="delivery:t-bg"/);
  assert.match(panelMarkup, /data-ui-action="jump-turn"/);
  assert.match(workspaceMarkup, /data-jump-turn="t-bg"/);
  assert.match(workspaceMarkup, /找到 2 个根因/);

  tracker.reset();
  assert.equal(tracker.list().length, 0);
});

test('traceBlockHtml renders shimmer sweep when active, compact file/tool logos, and settled steps without inline styles', () => {
  assert.equal(describeTraceStepLogo({label: 'harness-controls.js #L1-100'}).kind, 'js');
  assert.equal(describeTraceStepLogo({label: 'usage-budget.ts #L220-310'}).kind, 'ts');
  assert.equal(describeTraceStepLogo({label: 'admin-redesign.css'}).kind, 'css');
  assert.equal(describeTraceStepLogo({label: 'package.json'}).kind, 'json');
  assert.equal(describeTraceStepLogo({toolName: 'exec.run', label: '运行测试'}).kind, 'term');
  assert.equal(describeTraceStepLogo({toolName: 'knowledge.search', label: '检索笔记'}).kind, 'search');

  assert.equal(describeTraceStepVerb({toolName: 'fs.read', label: '读取文件', state: 'running'}), '读取中');
  assert.equal(describeTraceStepVerb({toolName: 'fs.read', label: '读取文件', state: 'completed'}), '读取');
  assert.equal(describeTraceStepVerb({toolName: 'exec.run', label: '运行单元测试', state: 'running'}), '运行中');
  assert.equal(describeTraceStepVerb({toolName: 'fs.write', label: '修改配置', state: 'waiting_approval'}), '待确认');

  const store = new Map();
  const task = {taskId: 't-shimmer', state: 'planning'};
  rememberActivity(store, {taskId: 't-shimmer', kind: 'reasoning', text: '正在规划分析'});
  rememberActivity(store, {taskId: 't-shimmer', kind: 'tool_call', stepId: 's-js', label: 'harness-controls.js #L1-100', toolName: 'fs.read', argsSummary: 'path=<script>x</script>'});

  const liveHtml = traceBlockHtml(task, store.get('t-shimmer'), [], escape);
  assert.match(liveHtml, /data-live="true"/);
  assert.match(liveHtml, /trace-label is-shimmer/);
  assert.match(liveHtml, /trace-step-verb is-shimmer/);
  assert.match(liveHtml, /data-logo="js"/);
  assert.match(liveHtml, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(liveHtml, /<script>x<\/script>/);
  assert.doesNotMatch(liveHtml, /style="/);

  const waitingHtml = traceBlockHtml({...task, state: 'waiting_approval'}, store.get('t-shimmer'), [], escape);
  assert.match(waitingHtml, /等待你的授权/);
  assert.doesNotMatch(waitingHtml, /is-shimmer|正在思考/);
  const waitingChild = [{taskId:'child',state:'waiting_approval'}];
  const delegatedWait = traceBlockHtml(task, store.get('t-shimmer'), waitingChild, escape);
  assert.match(delegatedWait, /子任务等待你的授权/);
  assert.doesNotMatch(delegatedWait, /is-shimmer/);
  const emptyTrace = traceBlockHtml(task, undefined, waitingChild, escape);
  assert.match(emptyTrace, /子任务等待你的授权/);
  assert.doesNotMatch(emptyTrace, /子智能体执行中|子智能体正在后台处理/);
  assert.doesNotMatch(traceBlockHtml({...task,state:'cancelling',cancelRequested:true}, undefined, waitingChild, escape), /等待你的授权/);

  rememberActivity(store, {taskId: 't-shimmer', kind: 'tool_result', stepId: 's-js', resultSummary: '完成', durationMs: 12});
  const settledHtml = traceBlockHtml({...task, state: 'succeeded'}, store.get('t-shimmer'), [], escape);
  assert.match(settledHtml, /data-live="false"/);
  assert.doesNotMatch(settledHtml, /is-shimmer/);
  assert.match(settledHtml, /12ms/);
  assert.doesNotMatch(settledHtml, /style="/);
});

test('mainChatReplies prefers parent model answer, suppresses failed child error bubbles, and strips technical tags on model failure', () => {
  const failedChild = {
    parentTaskId: 'p1',
    taskId: 'c1',
    state: 'failed',
    finalReply: '外部服务执行失败；请检查服务状态 [stage=task; code=EXTERNAL_FAILURE]',
  };
  assert.deepEqual(mainChatReplies({taskId: 'p1', state: 'running'}, [failedChild]), []);
  assert.deepEqual(
    mainChatReplies({taskId: 'p1', state: 'succeeded', resultSummary: '刚才编译子任务遇阻，我已经整理了排查建议。'}, [failedChild]),
    ['刚才编译子任务遇阻，我已经整理了排查建议。'],
  );
  const modelUnavailable = mainChatReplies({
    taskId: 'p2',
    state: 'failed',
    error: {message: '云端已返回明确失败：外部服务执行失败；请检查服务状态 [stage=task; code=EXTERNAL_FAILURE] [cloud: transport=wss code=EXTERNAL_FAILURE]'},
  }, []);
  assert.deepEqual(modelUnavailable, ['外部服务执行失败；请检查服务状态']);
});
