import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageBudget} from '../dist/index.js';

function memoryStore() {
  let ledger = [], policy, notices = {};
  return {
    loadLedger: () => ledger.map(entry => ({...entry})),
    appendLedger(entry) {
      if (entry.seq !== ledger.length + 1) throw new Error('用量账本只能追加');
      ledger = [...ledger, {...entry}];
    },
    loadPolicy: () => policy ? {...policy} : undefined,
    savePolicy(value) { policy = {...value}; },
    loadNotices: () => ({...notices}),
    saveNotices(value) { notices = {...value}; },
    entries: () => ledger.map(entry => ({...entry})),
  };
}

const noon = '2026-11-11T04:00:00.000Z'; // 12:00 in Asia/Shanghai

test('ledger only appends and a restarted budget keeps every entry', () => {
  const store = memoryStore();
  const first = createUsageBudget({store, now: () => new Date(noon)});
  first.configure({dailyLimitYuan: null, monthlyLimitYuan: null, action: 'degrade'});
  first.recordModel({modelId: 'qwen-max', tokens: 1000, origin: 'user'});
  first.recordCloud({durationMs: 30_000, origin: 'autonomous'});
  const second = createUsageBudget({store, now: () => new Date(noon)});
  second.recordModel({modelId: 'qwen-turbo', tokens: 10, origin: 'user'});
  const entries = store.entries();
  assert.deepEqual(entries.map(entry => entry.seq), [1, 2, 3]);
  assert.equal(entries[0].modelId, 'qwen-max');
  assert.equal(entries[0].tokens, 1000);
  assert.equal(entries[1].kind, 'cloud_runtime');
  assert.equal(entries[1].origin, 'autonomous');
  assert.match(second.snapshot().usageLine, /1010 token/);
  assert.match(second.snapshot().usageLine, /云端 0\.5 分钟/);
});

test('an 80 percent crossing notifies once, and the next day can notify again', () => {
  const store = memoryStore();
  const notices = [];
  let clock = new Date(noon);
  const budget = createUsageBudget({store, now: () => clock, onNotice: notice => notices.push(notice)});
  budget.configure({dailyLimitYuan: 10, monthlyLimitYuan: null, action: 'degrade'});
  budget.recordModel({modelId: 'qwen-max', tokens: 1_000_000});
  assert.equal(notices.length, 1);
  assert.match(notices[0].id, /^usage-budget-approach-/);
  assert.match(notices[0].body, /接近上限/);
  assert.match(budget.snapshot().usageLine, /已接近上限/);
  budget.recordModel({modelId: 'qwen-turbo', tokens: 1});
  assert.equal(notices.length, 1);
  clock = new Date('2026-11-12T04:00:00.000Z');
  budget.recordModel({modelId: 'qwen-max', tokens: 1_000_000});
  assert.equal(notices.length, 2);
  assert.equal(store.entries()[0].at < store.entries()[2].at, true);
});

test('pause blocks autonomous work and still allows a user call with a prompt', () => {
  const store = memoryStore();
  const budget = createUsageBudget({store, now: () => new Date(noon)});
  budget.configure({dailyLimitYuan: 1, monthlyLimitYuan: 1, action: 'pause'});
  budget.recordModel({modelId: 'qwen-max', tokens: 1_000_000});
  const autonomous = budget.decide({origin: 'autonomous', modelId: 'qwen-max', candidates: ['qwen-max', 'qwen-turbo']});
  assert.equal(autonomous.allowed, false);
  assert.match(autonomous.prompt, /暂停/);
  const user = budget.decide({origin: 'user', modelId: 'qwen-max', candidates: ['qwen-max', 'qwen-turbo']});
  assert.equal(user.allowed, true);
  assert.equal(user.modelId, 'qwen-max');
  assert.match(user.prompt, /仍会执行/);
  assert.match(budget.snapshot().usageLine, /手动任务仍会执行/);
});

test('degrade selects a strictly cheaper candidate and keeps the requested model when none is cheaper', () => {
  const store = memoryStore();
  const budget = createUsageBudget({store, now: () => new Date(noon)});
  budget.configure({dailyLimitYuan: 1, monthlyLimitYuan: null, action: 'degrade'});
  budget.recordModel({modelId: 'qwen-max', tokens: 1_000_000});
  const decision = budget.decide({origin: 'autonomous', modelId: 'qwen-max', candidates: ['qwen-max', 'qwen-plus', 'qwen-turbo']});
  assert.equal(decision.allowed, true);
  assert.equal(decision.modelId, 'qwen-turbo');
  const cheapest = budget.decide({origin: 'user', modelId: 'qwen-turbo', candidates: ['qwen-max', 'qwen-turbo']});
  assert.equal(cheapest.modelId, 'qwen-turbo');
  assert.match(cheapest.prompt, /没有更便宜/);
});

test('Shanghai calendar day keeps the previous evening out of today', () => {
  const store = memoryStore();
  const evening = createUsageBudget({store, now: () => new Date('2026-11-10T15:30:00.000Z')});
  evening.recordModel({modelId: 'qwen-plus', tokens: 1_000_000});
  const morning = createUsageBudget({store, now: () => new Date('2026-11-10T16:30:00.000Z')});
  assert.match(morning.snapshot().usageLine, /今日 0\.00 元/);
  assert.match(morning.snapshot().usageLine, /本月 .*4\.00 元|本月 2\.00/);
  morning.recordCloud({durationMs: 1_000});
  assert.match(morning.snapshot().usageLine, /云端 1 秒/);
});
