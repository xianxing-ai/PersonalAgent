// F06/F07/F08/F09/F11/F16 业务与开发工作流 host 端口定向测试与连接器 Schema 契约测试
// 运行：node --test packages/agentarts/test/business-workflow-hosts.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateToolValue} from '@personal-agent/contracts';
import {FakeStorage} from '@personal-agent/testkit';
import {
  register as registerCalendar,
  FakeCalendarProvider,
} from '../../connectors/calendar/dist/index.js';
import {inputSchema as githubInputSchema} from '../../connectors/github/dist/schemas.js';
import {register as registerProductivity} from '../../productivity/dist/index.js';
import {
  createTodoRegisteredWriteHostPort,
  createInMemoryTodoIdempotencyStore,
  createReminderClockRevisionHostPort,
  createCalendarFreshnessCheckHostPort,
  createCalendarRegisteredWriteHostPort,
  createCalendarUpdateAndInvalidateReminderHostPort,
} from '../dist/f06-f07-f11-business-hosts.js';
import {
  createMailRegisteredArchiveHostPort,
  createMailRegisteredSendHostPort,
  createFeedsValidateAndDeduplicateHostPort,
} from '../dist/f08-f09-business-hosts.js';
import {
  createGithubBoundCiFailureHostPort,
  createWorkspaceTestIntentCheckHostPort,
} from '../dist/f16-dev-workflows-hosts.js';

const deadline = new Date(Date.now() + 60_000).toISOString();
const signal = new AbortController().signal;
const context = (overrides = {}) => ({
  template: {workflowId: 'F06'},
  node: {id: 'F06_N03'},
  input: {},
  predecessorOutputs: {},
  availableTools: [],
  predecessorStates: {},
  deadline, signal, requestId: 'req-biz-1', mode: 'ordinary', namespace: 'ns-1',
  ...overrides,
});

function collectRealConnectorSchemas() {
  const schemas = new Map();
  const host = {
    register(tool) {
      schemas.set(tool.descriptor.name, tool.descriptor.inputSchema);
      return () => {};
    },
  };
  const unregisterCal = registerCalendar(host, {provider: new FakeCalendarProvider(), accountRef: 'cal'});
  const unregisterTodo = registerProductivity(host, {storage: new FakeStorage(), conversationId: 'conv-test'});
  unregisterCal();
  unregisterTodo();
  for (const op of ['actions.run.list', 'actions.job.list', 'actions.log.read']) {
    schemas.set(op, githubInputSchema(op));
  }
  return schemas;
}

test('契约校验：所有业务与开发 host 端口发出的工具载荷均通过真实连接器 inputSchema (validateToolValue) 校验', async () => {
  const schemas = collectRealConnectorSchemas();
  const validatedCalls = [];
  const assertValidPayload = (schemaName, payload) => {
    const schema = schemas.get(schemaName);
    assert.ok(schema, `missing schema for ${schemaName}`);
    validateToolValue(schema, payload);
    validatedCalls.push(schemaName);
  };

  // 1. todo.registered_write (create + update)
  let todoMode = 'create';
  const todoPort = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (op, input) => {
        assertValidPayload(op, input);
        return {id: 'todo-1', title: input.title, status: 'open'};
      },
    },
    resolveWrite: () =>
      todoMode === 'create'
        ? {title: '买牛奶', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'k-create', listId: 'inbox'}
        : {operation: 'todo.update', id: 'todo-1', title: '买燕麦奶', status: 'done', idempotencyKey: 'k-update'},
    idempotencyStore: createInMemoryTodoIdempotencyStore(),
  });
  assert.equal((await todoPort.read(context())).state, 'completed');
  todoMode = 'update';
  assert.equal((await todoPort.read(context())).state, 'completed');

  // 2. calendar.freshness_check
  const freshnessPort = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async (op, input) => {
        assertValidPayload(op, input);
        return {
          items: [
            {
              source: 'calendar',
              accountRef: 'cal',
              externalId: 'evt-1',
              dedupeKey: 'calendar:primary:evt-1:3',
            },
          ],
        };
      },
    },
    resolveTarget: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      expectedSequence: 3,
      window: {fromUtc: '2026-11-10T00:00:00.000Z', toUtc: '2026-11-17T00:00:00.000Z'},
    }),
  });
  const freshRes = await freshnessPort.read(context());
  assert.equal(freshRes.state, 'completed');
  assert.equal(freshRes.value.currentSequence, 3);
  assert.equal(freshRes.value.fresh, true);

  // 3. calendar.registered_write (create + update)
  let calWriteOp = 'calendar.create';
  const calWritePort = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      accountRef: 'cal',
      execute: async (op, input) => {
        assertValidPayload(op, input);
        return {
          item: {
            source: 'calendar',
            accountRef: 'cal',
            externalId: input.externalId ?? 'evt-created',
            dedupeKey: 'calendar:primary:evt-pre-1:0',
          },
          state: op === 'calendar.create' ? 'created' : 'updated',
        };
      },
    },
    resolveWrite: () => ({
      operation: calWriteOp,
      accountRef: 'cal',
      summary: '评审会',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
      externalId: 'evt-pre-1',
    }),
  });
  assert.equal((await calWritePort.read(context())).state, 'completed');
  calWriteOp = 'calendar.update';
  assert.equal((await calWritePort.read(context())).state, 'completed');

  // 4. calendar.update_and_invalidate_reminder
  const calSyncPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async (op, input) => {
        assertValidPayload(op, input);
        return {
          items: [
            {
              source: 'calendar',
              accountRef: 'cal',
              externalId: 'evt-1',
              dedupeKey: 'calendar:primary:evt-1:3',
            },
          ],
        };
      },
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async (op, input) => {
        assertValidPayload(op, input);
        return {
          item: {
            source: 'calendar',
            accountRef: 'cal',
            externalId: input.externalId,
            dedupeKey: 'calendar:primary:evt-1:4',
          },
          state: 'updated',
        };
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => ({reminderId: id, invalidated: true, state: 'invalidated'}),
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '改期后会议',
      startUtc: '2026-11-10T14:00:00.000Z',
      endUtc: '2026-11-10T15:00:00.000Z',
      reminderId: 'rem-1',
      previousSequence: 3,
    }),
  });
  assert.equal((await calSyncPort.read(context())).state, 'completed');

  // 5. github.bound_ci_failure
  const ghPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op, input) => {
        assertValidPayload(op, input);
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'a'.repeat(40), status: 'completed', conclusion: 'failure'}]};
        }
        if (op === 'actions.job.list') {
          return {items: [{id: 2001, name: 'verify', status: 'completed', conclusion: 'failure'}]};
        }
        if (op === 'actions.log.read') {
          return {text: 'Error: assertion failed', offset: 0, nextOffset: null, truncated: false};
        }
        throw new Error(`unexpected op: ${op}`);
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'a'.repeat(40)}),
  });
  assert.equal((await ghPort.read(context())).state, 'completed');

  assert.deepEqual(validatedCalls, [
    'todo.create',
    'todo.update',
    'calendar.events',
    'calendar.create',
    'calendar.update',
    'calendar.events',
    'calendar.update',
    'actions.run.list',
    'actions.job.list',
    'actions.log.read',
  ]);
});

test('F06_N03 todo.registered_write：注册待办写口、schema 对齐与宿主侧幂等账本', async () => {
  const calls = [];
  let currentInput = {title: '买牛奶', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'idem-1', listId: 'inbox'};
  const port = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (op, input) => {
        calls.push({op, input});
        return {id: 'todo-1', title: input.title, state: 'created'};
      },
    },
    resolveWrite: () => currentInput,
    idempotencyStore: createInMemoryTodoIdempotencyStore(),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.idempotencyKey, 'idem-1');
  assert.equal(res.value.replayed, false);
  assert.equal(res.value.source, 'todo_write_receipt');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.title, '买牛奶');
  assert.equal('idempotencyKey' in calls[0].input, false);
  assert.equal('listId' in calls[0].input, false);

  // 同幂等键同载荷再次调用：直接重放，不重复调用底层连接器
  const replayRes = await port.read(context());
  assert.equal(replayRes.state, 'completed');
  assert.equal(replayRes.value.replayed, true);
  assert.equal(calls.length, 1);

  // 同幂等键不同载荷：报错 todo_idempotency_conflict
  currentInput = {title: '买咖啡', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'idem-1', listId: 'inbox'};
  const conflictRes = await port.read(context());
  assert.equal(conflictRes.state, 'failed');
  assert.equal(conflictRes.value.reason, 'todo_idempotency_conflict');

  // 缺输入报错 unavailable
  const unavail = createTodoRegisteredWriteHostPort({
    write: {execute: async () => ({})},
    resolveWrite: () => undefined,
    idempotencyStore: createInMemoryTodoIdempotencyStore(),
  });
  assert.equal((await unavail.read(context())).state, 'unavailable');
});

test('F06_N03 todo.registered_write：未注入持久化账本或缺少原子 reserve 时 fail-closed，默认 Host 重建不会重复写入', async () => {
  let execCalls = 0;
  const write = {
    execute: async (_op, input) => {
      execCalls += 1;
      return {id: 'todo-default', title: input.title};
    },
  };
  const resolveWrite = () => ({title: '默认账本待办', idempotencyKey: 'idem-default'});

  // 连续创建两个未注入账本的默认 Host：均返回 unavailable，底层 execute 一次都不执行
  const first = await createTodoRegisteredWriteHostPort({write, resolveWrite}).read(context());
  const second = await createTodoRegisteredWriteHostPort({write, resolveWrite}).read(context());
  assert.equal(first.state, 'unavailable');
  assert.equal(first.value.reason, 'todo_idempotency_store_unavailable');
  assert.equal(second.state, 'unavailable');
  assert.equal(execCalls, 0);

  // 仅有 get/set、没有原子 reserve 的账本：返回 unavailable，不退化为“先 get 后 set”
  const backing = new Map();
  const noReserve = await createTodoRegisteredWriteHostPort({
    write,
    resolveWrite,
    idempotencyStore: {get: (k) => backing.get(k), set: (k, v) => backing.set(k, v)},
  }).read(context());
  assert.equal(noReserve.state, 'unavailable');
  assert.equal(noReserve.value.reason, 'todo_idempotency_atomic_reserve_required');
  assert.equal(execCalls, 0);
  assert.equal(backing.size, 0);

  // reserve 返回 undefined / true / 裸记录等非契约形状：一律 fail-closed，不视为抢到预留
  for (const badResult of [undefined, true, {fingerprint: 'x', state: 'reserved'}]) {
    const bad = await createTodoRegisteredWriteHostPort({
      write,
      resolveWrite,
      idempotencyStore: {get: () => undefined, set: () => {}, reserve: () => badResult},
    }).read(context());
    assert.equal(bad.state, 'failed');
    assert.equal(bad.value.reason, 'todo_idempotency_reservation_malformed');
  }
  assert.equal(execCalls, 0);
});

test('F06_N03 todo.registered_write：同一底层存储的独立 store 实例并发同键只写一次，异载荷判冲突', async () => {
  // 两个独立 store 包装对象共享同一底层 Map（模拟同一持久存储被多个 Host/进程访问），进程内锁互不共享
  const sharedBacking = new Map();
  let sameCalls = 0;
  const makeSamePort = () =>
    createTodoRegisteredWriteHostPort({
      write: {
        execute: async (_op, input) => {
          sameCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {id: 'todo-shared-1', title: input.title};
        },
      },
      resolveWrite: () => ({title: '共享存储同载荷', idempotencyKey: 'idem-shared-same'}),
      idempotencyStore: createInMemoryTodoIdempotencyStore(sharedBacking),
    });
  const [sameA, sameB] = await Promise.all([makeSamePort().read(context()), makeSamePort().read(context())]);
  assert.equal(sameCalls, 1);
  const sameStates = [sameA.state, sameB.state].sort();
  // 先到者 completed；后到者看到对方尚在进行中的 reserved 记录，返回 unknown 要求对账而不是再写一次
  assert.deepEqual(sameStates, ['completed', 'unknown']);
  const sameLoser = sameA.state === 'unknown' ? sameA : sameB;
  assert.equal(sameLoser.value.reason, 'todo_write_reconciliation_required');
  assert.equal(sameLoser.value.previousState, 'reserved');

  // 先到者完成后，第三个独立实例重试：从共享存储重放 completed，不再写
  const replay = await makeSamePort().read(context());
  assert.equal(replay.state, 'completed');
  assert.equal(replay.value.replayed, true);
  assert.equal(sameCalls, 1);

  // 同一底层存储、不同 store 实例并发同键异载荷：只写一次，另一方返回 todo_idempotency_conflict
  let diffCalls = 0;
  const makeDiffPort = (title) =>
    createTodoRegisteredWriteHostPort({
      write: {
        execute: async (_op, input) => {
          diffCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {id: 'todo-shared-2', title: input.title};
        },
      },
      resolveWrite: () => ({title, idempotencyKey: 'idem-shared-diff'}),
      idempotencyStore: createInMemoryTodoIdempotencyStore(sharedBacking),
    });
  const [diffA, diffB] = await Promise.all([
    makeDiffPort('买牛奶').read(context()),
    makeDiffPort('买咖啡').read(context()),
  ]);
  assert.equal(diffCalls, 1);
  assert.deepEqual([diffA.state, diffB.state].sort(), ['completed', 'failed']);
  const diffLoser = diffA.state === 'failed' ? diffA : diffB;
  assert.equal(diffLoser.value.reason, 'todo_idempotency_conflict');
});

test('F06_N03 todo.registered_write：同实例并发串行化、存储失败保留回执/unknown 与跨重启对账', async () => {
  // 1. 同一实例并发同键同载荷：execute 仅调用 1 次，一次 replayed=false，一次 replayed=true
  let concurrentSameCalls = 0;
  const concurrentSamePort = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (_op, input) => {
        concurrentSameCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {id: 'todo-concurrent-1', title: input.title, state: 'created'};
      },
    },
    resolveWrite: () => ({title: '并发同载荷待办', idempotencyKey: 'idem-concurrent-same'}),
    idempotencyStore: createInMemoryTodoIdempotencyStore(),
  });
  const [sameA, sameB] = await Promise.all([
    concurrentSamePort.read(context()),
    concurrentSamePort.read(context()),
  ]);
  assert.equal(concurrentSameCalls, 1);
  assert.equal(sameA.state, 'completed');
  assert.equal(sameB.state, 'completed');
  assert.deepEqual([sameA.value.replayed, sameB.value.replayed].sort(), [false, true]);

  // 2. 写入成功但完成态 set 抛错：首次 unknown 并保留 receipt；同进程重试与重启后重试均 unknown，不重复 execute
  const persistentMap = new Map();
  let commitFailExecCalls = 0;
  const atomicBase = createInMemoryTodoIdempotencyStore(persistentMap);
  const commitFailStore = {
    get: atomicBase.get,
    reserve: atomicBase.reserve,
    set: (key, entry) => {
      if (entry.state === 'completed') throw new Error('disk_write_failed_on_commit');
      atomicBase.set(key, entry);
    },
  };
  const commitFailPort = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (_op, input) => {
        commitFailExecCalls += 1;
        return {id: 'todo-commit-fail-1', title: input.title, state: 'created'};
      },
    },
    resolveWrite: () => ({title: '写后落盘失败待办', idempotencyKey: 'idem-commit-fail'}),
    idempotencyStore: commitFailStore,
  });
  const firstCommitFail = await commitFailPort.read(context());
  assert.equal(commitFailExecCalls, 1);
  assert.equal(firstCommitFail.state, 'unknown');
  assert.equal(firstCommitFail.value.reason, 'todo_idempotency_commit_uncertain');
  assert.equal(firstCommitFail.value.receipt.id, 'todo-commit-fail-1');

  const retrySameProcess = await commitFailPort.read(context());
  assert.equal(commitFailExecCalls, 1);
  assert.equal(retrySameProcess.state, 'unknown');
  assert.equal(retrySameProcess.value.reason, 'todo_write_reconciliation_required');
  assert.equal(retrySameProcess.value.receipt.id, 'todo-commit-fail-1');

  // 模拟进程重启：新的 store 实例与 Host，底层持久存储只剩写前 reserved 记录
  let restartInput = {title: '写后落盘失败待办', idempotencyKey: 'idem-commit-fail'};
  const restartedPort = createTodoRegisteredWriteHostPort({
    write: {
      execute: async () => {
        commitFailExecCalls += 1;
        return {id: 'should-not-run'};
      },
    },
    resolveWrite: () => restartInput,
    idempotencyStore: createInMemoryTodoIdempotencyStore(persistentMap),
  });
  const retryAfterRestart = await restartedPort.read(context());
  assert.equal(commitFailExecCalls, 1);
  assert.equal(retryAfterRestart.state, 'unknown');
  assert.equal(retryAfterRestart.value.reason, 'todo_write_reconciliation_required');
  assert.equal(retryAfterRestart.value.previousState, 'reserved');

  restartInput = {title: '篡改后的待办标题', idempotencyKey: 'idem-commit-fail'};
  const conflictAfterRestart = await restartedPort.read(context());
  assert.equal(commitFailExecCalls, 1);
  assert.equal(conflictAfterRestart.state, 'failed');
  assert.equal(conflictAfterRestart.value.reason, 'todo_idempotency_conflict');

  // 3. 写前原子预留抛错：拒绝执行底层写（execute 0 次）
  let preFailExecCalls = 0;
  const preFailRes = await createTodoRegisteredWriteHostPort({
    write: {
      execute: async () => {
        preFailExecCalls += 1;
        return {id: 'should-not-run'};
      },
    },
    resolveWrite: () => ({title: '预留失败待办', idempotencyKey: 'idem-pre-fail'}),
    idempotencyStore: {
      get: () => undefined,
      set: () => {},
      reserve: () => {
        throw new Error('store_completely_unavailable');
      },
    },
  }).read(context());
  assert.equal(preFailExecCalls, 0);
  assert.equal(preFailRes.state, 'failed');
  assert.equal(preFailRes.value.reason, 'todo_idempotency_reservation_failed');

  // 4. reserve 报告记录已存在但回读失败：记录存在但内容未知，返回 unknown 要求对账，不写
  let existsExecCalls = 0;
  const existsRes = await createTodoRegisteredWriteHostPort({
    write: {
      execute: async () => {
        existsExecCalls += 1;
        return {id: 'should-not-run'};
      },
    },
    resolveWrite: () => ({title: '已存在待办', idempotencyKey: 'idem-exists'}),
    idempotencyStore: {
      get: () => {
        throw new Error('read_failed');
      },
      set: () => {},
      reserve: () => ({reserved: false}),
    },
  }).read(context());
  assert.equal(existsExecCalls, 0);
  assert.equal(existsRes.state, 'unknown');
  assert.equal(existsRes.value.reason, 'todo_write_reconciliation_required');

  // 5. 预留成功后底层写抛错（结果不确定）：首次 unknown，重试 unknown 对账且不重复 execute
  let uncertainExecCalls = 0;
  const uncertainPort = createTodoRegisteredWriteHostPort({
    write: {
      execute: async () => {
        uncertainExecCalls += 1;
        throw new Error('network_timeout_after_request_sent');
      },
    },
    resolveWrite: () => ({title: '网络超时待办', idempotencyKey: 'idem-uncertain'}),
    idempotencyStore: createInMemoryTodoIdempotencyStore(),
  });
  const firstUncertain = await uncertainPort.read(context());
  assert.equal(uncertainExecCalls, 1);
  assert.equal(firstUncertain.state, 'unknown');
  assert.equal(firstUncertain.value.reason, 'todo_write_outcome_uncertain');
  const retryUncertain = await uncertainPort.read(context());
  assert.equal(uncertainExecCalls, 1);
  assert.equal(retryUncertain.state, 'unknown');
  assert.equal(retryUncertain.value.reason, 'todo_write_reconciliation_required');

  // 6. 正常完成后跨进程重启：新 store 实例从持久存储重放 completed，不重复 execute
  const sharedDurableStore = new Map();
  let durableCalls = 0;
  const makeDurablePort = () =>
    createTodoRegisteredWriteHostPort({
      write: {
        execute: async (_op, input) => {
          durableCalls += 1;
          return {id: 'todo-durable-1', title: input.title, state: 'created'};
        },
      },
      resolveWrite: () => ({title: '持久化待办', idempotencyKey: 'idem-durable-1'}),
      idempotencyStore: createInMemoryTodoIdempotencyStore(sharedDurableStore),
    });
  const durableFirst = await makeDurablePort().read(context());
  assert.equal(durableCalls, 1);
  assert.equal(durableFirst.value.replayed, false);
  const durableAfterRestart = await makeDurablePort().read(context());
  assert.equal(durableCalls, 1);
  assert.equal(durableAfterRestart.state, 'completed');
  assert.equal(durableAfterRestart.value.replayed, true);
  assert.equal(durableAfterRestart.value.receipt.id, 'todo-durable-1');
});

test('F06_N04 reminder.current_clock_and_revision：实际时钟、版本到期核对与非法时间失败', async () => {
  const port = createReminderClockRevisionHostPort({
    reminderPort: {
      getReminder: async () => ({reminderId: 'rem-1', revision: 2, dueUtc: '2026-11-09T12:00:00.000Z', state: 'active'}),
      nowUtc: () => '2026-11-09T13:00:00.000Z',
    },
    resolveTarget: () => ({reminderId: 'rem-1', expectedRevision: 2}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.isDue, true);
  assert.equal(res.value.revisionMatch, true);
  assert.equal(res.value.source, 'reminder_clock_readback');

  const badPort = createReminderClockRevisionHostPort({
    reminderPort: {
      getReminder: async () => ({reminderId: 'rem-bad', revision: 1, dueUtc: 'not-a-valid-date', state: 'active'}),
      nowUtc: () => '2026-11-09T13:00:00.000Z',
    },
    resolveTarget: () => ({reminderId: 'rem-bad'}),
  });
  const badRes = await badPort.read(context());
  assert.equal(badRes.state, 'failed');
  assert.equal(badRes.value.reason, 'reminder_due_utc_invalid');
});

test('F07_N04 calendar.freshness_check：基于 calendar.events 的 ConnectorItem dedupeKey 序列号提取与未知态校验', async () => {
  let eventsInput = null;
  const port = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async (op, input) => {
        eventsInput = input;
        if (op === 'calendar.events') {
          return {
            items: [
              {
                source: 'calendar',
                accountRef: 'cal-acc',
                externalId: 'evt-1',
                dedupeKey: 'calendar:primary:evt-1:3',
                contentRef: '晨会',
              },
            ],
          };
        }
        throw new Error(`unexpected op: ${op}`);
      },
    },
    resolveTarget: () => ({accountRef: 'cal-acc', externalId: 'evt-1', expectedSequence: 3}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.fresh, true);
  assert.equal(res.value.currentSequence, 3);
  assert.equal(res.value.source, 'calendar_readback');
  assert.equal('accountRef' in eventsInput, false);
  assert.equal('externalId' in eventsInput, false);

  // 缺失 sequence 与 dedupeKey 时返回 unknown（不回退为 0）
  const noSeqPort = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async () => ({items: [{externalId: 'evt-1', title: '无序列号日程'}]}),
    },
    resolveTarget: () => ({accountRef: 'cal-acc', externalId: 'evt-1', expectedSequence: 0}),
  });
  const noSeqRes = await noSeqPort.read(context());
  assert.equal(noSeqRes.state, 'unknown');
  assert.equal(noSeqRes.value.reason, 'calendar_sequence_unavailable');
});

test('F07_N05 calendar.registered_write：注册日历创建/更新写口、写前可信账户绑定核验且不向工具载荷注入 accountRef', async () => {
  let receivedInput = null;
  const port = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      accountRef: 'cal',
      execute: async (op, input) => {
        receivedInput = {op, input};
        return {item: {externalId: input.externalId ?? 'evt-new', accountRef: 'cal', title: input.summary}, state: 'created'};
      },
    },
    resolveWrite: () => ({
      accountRef: 'cal',
      summary: '产品评审',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
      externalId: 'evt-pre-1',
    }),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.externalId, 'evt-pre-1');
  assert.equal(res.value.accountRef, 'cal');
  assert.equal('accountRef' in receivedInput.input, false);
  assert.equal(res.value.source, 'calendar_write_receipt');

  // 负例 1（错账户）：目标账户为 cal-a，但端口绑定为 cal-b -> 写前直接拒绝，execute 调用为 0
  let wrongAccountCalls = 0;
  const wrongAccountPort = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      accountRef: 'cal-b',
      execute: async () => {
        wrongAccountCalls += 1;
        return {item: {externalId: 'evt-wrong', accountRef: 'cal-b'}, state: 'created'};
      },
    },
    resolveWrite: () => ({
      accountRef: 'cal-a',
      summary: '不该写入 B 账户的日程',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
    }),
  });
  const wrongAccountRes = await wrongAccountPort.read(context());
  assert.equal(wrongAccountCalls, 0);
  assert.equal(wrongAccountRes.state, 'failed');
  assert.equal(wrongAccountRes.value.reason, 'calendar_account_mismatch');
  assert.equal(wrongAccountRes.value.expectedAccountRef, 'cal-a');
  assert.equal(wrongAccountRes.value.boundAccountRef, 'cal-b');

  // 负例 2（缺失账户绑定）：calendarPort 未声明 accountRef 且未提供 boundAccountRef -> 写前返回 unavailable，execute 调用为 0
  let unboundCalls = 0;
  const unboundPort = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      execute: async () => {
        unboundCalls += 1;
        return {item: {externalId: 'evt-unbound', accountRef: 'cal-a'}, state: 'created'};
      },
    },
    resolveWrite: () => ({
      accountRef: 'cal-a',
      summary: '未绑定账户的日程',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
    }),
  });
  const unboundRes = await unboundPort.read(context());
  assert.equal(unboundCalls, 0);
  assert.equal(unboundRes.state, 'unavailable');
  assert.equal(unboundRes.value.reason, 'calendar_account_binding_unavailable');

  // 正反例 3（resolveCalendarPort 按账户选择实例）：存在绑定时调用对应实例，不存在时写前返回 unavailable（execute 为 0）
  let routedCalls = 0;
  let targetAcc = 'cal-work';
  const routedPort = createCalendarRegisteredWriteHostPort({
    resolveCalendarPort: (acc) =>
      acc === 'cal-work'
        ? {
            accountRef: 'cal-work',
            execute: async (_op, input) => {
              routedCalls += 1;
              return {item: {externalId: 'evt-routed', accountRef: 'cal-work', title: input.summary}, state: 'created'};
            },
          }
        : undefined,
    resolveWrite: () => ({
      accountRef: targetAcc,
      summary: '按账户路由日程',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
    }),
  });
  assert.equal((await routedPort.read(context())).state, 'completed');
  assert.equal(routedCalls, 1);
  targetAcc = 'cal-missing';
  const missingRouteRes = await routedPort.read(context());
  assert.equal(missingRouteRes.state, 'unavailable');
  assert.equal(missingRouteRes.value.reason, 'calendar_account_binding_unavailable');
  assert.equal(routedCalls, 1);

  // 负例 4（写后回执账户异常）：写前绑定匹配但底层返回了异常回执账户 -> 保留 receipt 并返回 unknown 进入可对账状态
  const postMismatchPort = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      accountRef: 'cal-a',
      execute: async () => ({item: {externalId: 'evt-post-mismatch', accountRef: 'cal-unexpected'}, state: 'created'}),
    },
    resolveWrite: () => ({
      accountRef: 'cal-a',
      summary: '回执账户异常日程',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
    }),
  });
  const postMismatchRes = await postMismatchPort.read(context());
  assert.equal(postMismatchRes.state, 'unknown');
  assert.equal(postMismatchRes.value.reason, 'calendar_account_mismatch');
  assert.equal(postMismatchRes.value.reconciliationRequired, true);
  assert.equal(postMismatchRes.value.receipt.item.externalId, 'evt-post-mismatch');
});

test('F11_N05 calendar.update_and_invalidate_reminder：host 侧写前账户绑定与新鲜度核对、序列号核对及部分写 unknown 保真', async () => {
  let invalidatedId = null;
  let calendarInput = null;
  const port = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async () => ({
        items: [{externalId: 'evt-1', accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:3'}],
      }),
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => {
        calendarInput = input;
        return {
          item: {externalId: input.externalId, accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:4'},
          state: 'updated',
        };
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        invalidatedId = id;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      startUtc: '2026-11-10T14:00:00.000Z',
      endUtc: '2026-11-10T15:00:00.000Z',
      reminderId: 'rem-old-1',
      previousSequence: 3,
    }),
  });
  const res = await port.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(res.state, 'completed');
  assert.equal('accountRef' in calendarInput, false);
  assert.equal(calendarInput.expectedSequence, 3);
  assert.equal(invalidatedId, 'rem-old-1');
  assert.equal(res.value.invalidationReceipt.reminderId, 'rem-old-1');
  assert.equal(res.value.source, 'calendar_reminder_sync');

  // 负例 0a（写前错账户）：calendarPort 绑定为 cal-b 而目标为 cal-a -> 写前直接拦截，execute 与 invalidate 均为 0
  let wrongAccUpdateCalls = 0;
  let wrongAccInvalidateCalls = 0;
  const wrongAccUpdatePort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      accountRef: 'cal-b',
      execute: async () => {
        wrongAccUpdateCalls += 1;
        return {};
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        wrongAccInvalidateCalls += 1;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal-a',
      externalId: 'evt-1',
      summary: '错账户改期',
      reminderId: 'rem-old-1',
    }),
  });
  const wrongAccUpdateRes = await wrongAccUpdatePort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(wrongAccUpdateCalls, 0);
  assert.equal(wrongAccInvalidateCalls, 0);
  assert.equal(wrongAccUpdateRes.state, 'failed');
  assert.equal(wrongAccUpdateRes.value.reason, 'calendar_account_mismatch');

  // 负例 0b（写前缺失绑定）：calendarPort 未绑定账户 -> 写前返回 unavailable，execute 调用为 0
  let unboundUpdateCalls = 0;
  const unboundUpdatePort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      execute: async () => {
        unboundUpdateCalls += 1;
        return {};
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => ({reminderId: id, invalidated: true, state: 'invalidated'}),
    },
    resolveInput: () => ({
      accountRef: 'cal-a',
      externalId: 'evt-1',
      summary: '缺失绑定改期',
      reminderId: 'rem-old-1',
    }),
  });
  const unboundUpdateRes = await unboundUpdatePort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(unboundUpdateCalls, 0);
  assert.equal(unboundUpdateRes.state, 'unavailable');
  assert.equal(unboundUpdateRes.value.reason, 'calendar_account_binding_unavailable');

  // 负例 0c（提供 previousSequence 但缺失 calendarReadPort）：强制要求可信读端口，缺失即返回 unavailable，写入与提醒作废调用均为 0
  let missingReadWriteCalls = 0;
  let missingReadInvalidateCalls = 0;
  const missingReadPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => {
        missingReadWriteCalls += 1;
        return {
          item: {externalId: input.externalId, accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:4'},
          state: 'updated',
        };
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        missingReadInvalidateCalls += 1;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '无读端口不可跳过预读',
      reminderId: 'rem-old-1',
      previousSequence: 3,
    }),
  });
  const missingReadRes = await missingReadPort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(missingReadRes.state, 'unavailable');
  assert.equal(missingReadRes.value.reason, 'calendar_read_port_unavailable');
  assert.equal(missingReadWriteCalls, 0);
  assert.equal(missingReadInvalidateCalls, 0);

  // 负例 1：写前读回的 sequence 与 previousSequence 不一致 -> 写前直接拦截
  let writeCalledOnStale = false;
  const stalePrePort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async () => ({
        items: [{externalId: 'evt-1', accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:9'}],
      }),
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async () => {
        writeCalledOnStale = true;
        return {};
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => ({reminderId: id, invalidated: true, state: 'invalidated'}),
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      reminderId: 'rem-old-1',
      previousSequence: 3,
    }),
  });
  const stalePreRes = await stalePrePort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(stalePreRes.state, 'failed');
  assert.equal(stalePreRes.value.reason, 'calendar_stale_sequence_before_update');
  assert.equal(writeCalledOnStale, false);

  // 负例 1b（预读后到写入前发生并发更新，服务端条件写 ETag/expectedSequence 拒绝）：不覆盖并发版本且提醒作废调用为 0
  const realProvider = new FakeCalendarProvider([
    {
      externalId: 'evt-race-1',
      calendarId: 'cal-work',
      title: '原始会议 v3',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
      timeZone: 'UTC',
      startLocal: '2026-11-10T09:00:00',
      endLocal: '2026-11-10T10:00:00',
      status: 'confirmed',
      sequence: 3,
      updatedUtc: '2026-11-09T08:00:00.000Z',
    },
  ]);
  const realTools = new Map();
  const unregisterRealCal = registerCalendar(
    {
      register(tool) {
        realTools.set(tool.descriptor.name, tool);
        return () => {};
      },
    },
    {provider: realProvider, accountRef: 'cal'},
  );
  let raceInvalidateCalls = 0;
  let capturedConditionalWriteInput = null;
  try {
    const racePort = createCalendarUpdateAndInvalidateReminderHostPort({
      calendarReadPort: {
        accountRef: 'cal',
        execute: async (op, input, ctx) => {
          const page = await realTools.get(op).execute(input, ctx);
          // 模拟写前预读刚返回后、写入执行前，另一客户端并发修改了该日程（sequence 从 3 升至 4）
          await realProvider.writes.updateEvent({uid: 'evt-race-1', summary: '并发修改后的版本 v4'});
          return {
            ...page,
            items: page.items.map((it) => ({...it, etag: '"evt-race-1:3"'})),
          };
        },
      },
      calendarPort: {
        accountRef: 'cal',
        execute: async (op, input, ctx) => {
          capturedConditionalWriteInput = input;
          return realTools.get(op).execute(input, ctx);
        },
      },
      invalidationPort: {
        invalidateReminder: async (id) => {
          raceInvalidateCalls += 1;
          return {reminderId: id, invalidated: true, state: 'invalidated'};
        },
      },
      resolveInput: () => ({
        accountRef: 'cal',
        externalId: 'evt-race-1',
        summary: '本应被拦截的旧版本改期',
        startUtc: '2026-11-10T14:00:00.000Z',
        endUtc: '2026-11-10T15:00:00.000Z',
        reminderId: 'rem-race-1',
        previousSequence: 3,
      }),
    });
    const raceRes = await racePort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
    assert.equal(capturedConditionalWriteInput.expectedSequence, 3);
    assert.equal(capturedConditionalWriteInput.ifMatch, '"evt-race-1:3"');
    assert.equal(raceRes.state, 'failed');
    assert.equal(raceRes.value.reason, 'calendar_update_revision_conflict');
    assert.equal(raceInvalidateCalls, 0);
    // 确认并发修改的版本 v4 未被覆盖
    assert.equal(realProvider.getEvent('cal', 'evt-race-1').title, '并发修改后的版本 v4');
    assert.equal(realProvider.getEvent('cal', 'evt-race-1').sequence, 4);
  } finally {
    unregisterRealCal();
  }

  // 负例 2：写已发生但回执里 dedupeKey 的 sequence 未递增 -> 保留 calendarReceipt 并返回需对账的 unknown（不作废提醒）
  let nonIncInvalidateCalls = 0;
  const nonIncPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async () => ({
        items: [{externalId: 'evt-1', accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:4'}],
      }),
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => ({
        item: {externalId: input.externalId, accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:4'},
        state: 'updated',
      }),
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        nonIncInvalidateCalls += 1;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      reminderId: 'rem-old-1',
      previousSequence: 4,
    }),
  });
  const nonIncRes = await nonIncPort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(nonIncRes.state, 'unknown');
  assert.equal(nonIncRes.value.reason, 'calendar_sequence_not_incremented');
  assert.equal(nonIncRes.value.reconciliationRequired, true);
  assert.equal(nonIncRes.value.calendarReceipt.item.externalId, 'evt-1');
  assert.equal(nonIncInvalidateCalls, 0);

  // 负例 2b：写已发生但回执序列号跳变（例如无条件写后端期间被并发更新）-> 保留 calendarReceipt 并返回 unknown 对账
  let jumpedInvalidateCalls = 0;
  const jumpedSeqPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async () => ({
        items: [{externalId: 'evt-1', accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:3'}],
      }),
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => ({
        item: {externalId: input.externalId, accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:5'},
        state: 'updated',
      }),
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        jumpedInvalidateCalls += 1;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '写后跳变检测',
      reminderId: 'rem-old-1',
      previousSequence: 3,
    }),
  });
  const jumpedRes = await jumpedSeqPort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(jumpedRes.state, 'unknown');
  assert.equal(jumpedRes.value.reason, 'calendar_concurrent_update_detected');
  assert.equal(jumpedRes.value.reconciliationRequired, true);
  assert.equal(jumpedRes.value.calendarReceipt.item.externalId, 'evt-1');
  assert.equal(jumpedInvalidateCalls, 0);

  // 负例 3：日历更新已成功但作废提醒失败 -> 返回 unknown 并保留 calendarReceipt 供对账
  const partialPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {
      accountRef: 'cal',
      execute: async () => ({
        items: [{externalId: 'evt-1', accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:4'}],
      }),
    },
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => ({
        item: {externalId: input.externalId, accountRef: 'cal', dedupeKey: 'calendar:primary:evt-1:5'},
        state: 'updated',
      }),
    },
    invalidationPort: {
      invalidateReminder: async () => ({reminderId: 'rem-old-1', invalidated: false, state: 'active'}),
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      reminderId: 'rem-old-1',
      previousSequence: 4,
    }),
  });
  const partialRes = await partialPort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(partialRes.state, 'unknown');
  assert.equal(partialRes.value.reason, 'reminder_invalidation_failed');
  assert.equal(partialRes.value.reconciliationRequired, true);
  assert.equal(partialRes.value.calendarReceipt.item.externalId, 'evt-1');

  // 负例 4：写前绑定通过但更新回执账户异常 -> 不触发提醒作废，保留 calendarReceipt 并返回 unknown 要求对账
  let postMismatchInvalidateCalls = 0;
  const postMismatchUpdatePort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      accountRef: 'cal',
      execute: async (_op, input) => ({
        item: {externalId: input.externalId, accountRef: 'cal-other', dedupeKey: 'calendar:primary:evt-1:5'},
        state: 'updated',
      }),
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        postMismatchInvalidateCalls += 1;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      reminderId: 'rem-old-1',
    }),
  });
  const postMismatchUpdateRes = await postMismatchUpdatePort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(postMismatchInvalidateCalls, 0);
  assert.equal(postMismatchUpdateRes.state, 'unknown');
  assert.equal(postMismatchUpdateRes.value.reason, 'calendar_account_mismatch');
  assert.equal(postMismatchUpdateRes.value.reconciliationRequired, true);
  assert.equal(postMismatchUpdateRes.value.calendarReceipt.item.externalId, 'evt-1');
});

test('F07_N05/F11_N05 日历写口：写入可能已发生时返回 unknown 对账，写前可判定未写入时返回 failed', async () => {
  const writeInput = {accountRef: 'cal', summary: '会议', startUtc: '2026-11-10T09:00:00.000Z', endUtc: '2026-11-10T10:00:00.000Z'};
  const writePortWith = (execute) => createCalendarRegisteredWriteHostPort({
    calendarPort: {accountRef: 'cal', execute},
    resolveWrite: () => writeInput,
  });

  // 写口：execute 超时/外部失败 -> unknown；参数错误（连接器写前拒绝）-> failed；回执非对象 -> unknown
  const timeoutRes = await writePortWith(async () => {
    throw Object.assign(new Error('socket hang up'), {code: 'EXTERNAL_FAILURE'});
  }).read(context());
  assert.equal(timeoutRes.state, 'unknown');
  assert.equal(timeoutRes.value.reason, 'calendar_write_outcome_uncertain');
  assert.equal(timeoutRes.value.reconciliationRequired, true);

  const invalidRes = await writePortWith(async () => {
    throw Object.assign(new Error('bad input'), {code: 'INVALID_ARGUMENT'});
  }).read(context());
  assert.equal(invalidRes.state, 'failed');
  assert.equal(invalidRes.value.reason, 'calendar_write_failed');

  const malformedRes = await writePortWith(async () => 'ok').read(context());
  assert.equal(malformedRes.state, 'unknown');
  assert.equal(malformedRes.value.reason, 'calendar_write_malformed');

  // 改期写口：预读端口未声明可信账户 -> 写前 unavailable，预读与写入均为 0 次
  let preReadCalls = 0;
  let updateCalls = 0;
  const unboundReadRes = await createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {execute: async () => { preReadCalls += 1; return {items: []}; }},
    calendarPort: {accountRef: 'cal', execute: async () => { updateCalls += 1; return {}; }},
    invalidationPort: {invalidateReminder: async (id) => ({reminderId: id, invalidated: true, state: 'invalidated'})},
    resolveInput: () => ({accountRef: 'cal', externalId: 'evt-1', reminderId: 'rem-1', previousSequence: 3}),
  }).read(context());
  assert.equal(unboundReadRes.state, 'unavailable');
  assert.equal(unboundReadRes.value.reason, 'calendar_account_binding_unavailable');
  assert.equal(preReadCalls, 0);
  assert.equal(updateCalls, 0);

  // 改期写口：预读端口绑定其他账户 -> 写前 failed，预读与写入均为 0 次
  const wrongReadRes = await createCalendarUpdateAndInvalidateReminderHostPort({
    calendarReadPort: {accountRef: 'cal-other', execute: async () => { preReadCalls += 1; return {items: []}; }},
    calendarPort: {accountRef: 'cal', execute: async () => { updateCalls += 1; return {}; }},
    invalidationPort: {invalidateReminder: async (id) => ({reminderId: id, invalidated: true, state: 'invalidated'})},
    resolveInput: () => ({accountRef: 'cal', externalId: 'evt-1', reminderId: 'rem-1', previousSequence: 3}),
  }).read(context());
  assert.equal(wrongReadRes.state, 'failed');
  assert.equal(wrongReadRes.value.reason, 'calendar_account_mismatch');
  assert.equal(preReadCalls, 0);
  assert.equal(updateCalls, 0);

  // 改期写口：更新请求已发出后异常 -> unknown 对账，且不作废旧提醒；写前可判定的参数错误 -> failed
  let invalidateCalls = 0;
  const updatePortWith = (execute) => createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {accountRef: 'cal', execute},
    invalidationPort: {invalidateReminder: async (id) => { invalidateCalls += 1; return {reminderId: id, invalidated: true, state: 'invalidated'}; }},
    resolveInput: () => ({accountRef: 'cal', externalId: 'evt-1', summary: '改期', reminderId: 'rem-1'}),
  });
  const uncertainUpdate = await updatePortWith(async () => {
    throw Object.assign(new Error('timeout'), {code: 'EXTERNAL_FAILURE'});
  }).read(context());
  assert.equal(uncertainUpdate.state, 'unknown');
  assert.equal(uncertainUpdate.value.reason, 'calendar_update_outcome_uncertain');
  assert.equal(uncertainUpdate.value.reconciliationRequired, true);
  const rejectedUpdate = await updatePortWith(async () => {
    throw Object.assign(new Error('missing event'), {code: 'NOT_FOUND'});
  }).read(context());
  assert.equal(rejectedUpdate.state, 'failed');
  assert.equal(rejectedUpdate.value.reason, 'calendar_update_invalidate_failed');
  const malformedUpdate = await updatePortWith(async () => null).read(context());
  assert.equal(malformedUpdate.state, 'unknown');
  assert.equal(malformedUpdate.value.reason, 'calendar_update_malformed');
  assert.equal(invalidateCalls, 0);
});

test('F08_N03 mail.registered_archive：受控归档并读回核验', async () => {
  const port = createMailRegisteredArchiveHostPort({
    mailPort: {
      execute: async (_op, input) => ({archived: true, messageId: input.messageId, folder: input.targetFolder}),
    },
    resolveArchive: () => ({accountRef: 'mail-work', messageId: 'msg-123', targetFolder: 'Archive'}),
  });
  const res = await port.read(context({template: {workflowId: 'F08'}, node: {id: 'F08_N03'}}));
  assert.equal(res.state, 'completed');
  assert.equal(res.value.messageId, 'msg-123');
  assert.equal(res.value.confirmed, true);
  assert.equal(res.value.source, 'mail_archive_receipt');
});

test('F08_N07 mail.registered_send：兼容 externalId/messageId 发送回执与 unknown 态保真', async () => {
  const port = createMailRegisteredSendHostPort({
    mailPort: {
      execute: async () => ({state: 'confirmed', externalId: '<msg-sent-1@local>'}),
    },
    resolveSend: () => ({accountRef: 'mail', to: 'a@b.com', subject: 'hi', text: 'body', idempotencyKey: 'k1'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.state, 'confirmed');
  assert.equal(res.value.messageId, '<msg-sent-1@local>');
  assert.equal(res.value.externalId, '<msg-sent-1@local>');

  const unknownPort = createMailRegisteredSendHostPort({
    mailPort: {
      execute: async () => ({state: 'unknown', reason: 'timeout'}),
    },
    resolveSend: () => ({accountRef: 'mail', to: 'a@b.com', subject: 'hi', text: 'body', idempotencyKey: 'k2'}),
  });
  const unk = await unknownPort.read(context());
  assert.equal(unk.state, 'unknown');
  assert.equal(unk.value.state, 'unknown');
  assert.equal(unk.value.idempotencyKey, 'k2');
});

test('F09_N02 feeds.validate_and_deduplicate：哈希去重与格式校验', async () => {
  const port = createFeedsValidateAndDeduplicateHostPort();
  const items = [
    {feedId: 'tech', id: '1', title: '新闻1', url: 'https://news.com/1'},
    {feedId: 'tech', id: '1', title: '新闻1重复', url: 'https://news.com/1'},
    {feedId: 'tech', id: '2', title: '新闻2', url: 'https://news.com/2'},
    {invalid: true},
  ];
  const res = await port.read(context({input: items}));
  assert.equal(res.state, 'completed');
  assert.equal(res.value.totalCount, 4);
  assert.equal(res.value.validCount, 2);
  assert.equal(res.value.duplicateCount, 1);
  assert.equal(res.value.invalidCount, 1);
  assert.equal(res.value.source, 'feeds_validation_receipt');
});

test('F16_N01 github.bound_ci_failure：对齐 schemas.ts（无 owner/runId）、支持翻页查找与找不到返回 unavailable', async () => {
  let runListInput = null;
  let jobListInput = null;
  let logInput = null;
  const port = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op, input) => {
        if (op === 'actions.run.list') {
          runListInput = input;
          if (input.page === 1) {
            return {
              items: [{id: 999, headSha: 'other', status: 'completed', conclusion: 'failure'}],
              page: 1,
              nextPage: 2,
              hasMore: true,
            };
          }
          return {
            items: [{id: 1001, headSha: 'c0ffee', status: 'completed', conclusion: 'failure'}],
            page: 2,
            nextPage: null,
            hasMore: false,
          };
        }
        if (op === 'actions.job.list') {
          jobListInput = input;
          return {items: [{id: 2001, name: 'build-and-test', status: 'completed', conclusion: 'failure'}]};
        }
        if (op === 'actions.log.read') {
          logInput = input;
          return {text: 'Error: Test failed at line 42\nStack trace...', offset: 0, nextOffset: null, truncated: false};
        }
        throw new Error(`unsupported op: ${op}`);
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.conclusion, 'failure');
  assert.equal(res.value.headSha, 'c0ffee');
  assert.equal(res.value.failedJobCount, 1);
  assert.equal('owner' in runListInput, false);
  assert.equal('runId' in runListInput, false);
  assert.equal(runListInput.status, 'failure');
  assert.equal('owner' in jobListInput, false);
  assert.equal('owner' in logInput, false);
  assert.equal(logInput.jobId, 2001);
  assert.equal(logInput.repo, 'xianxing-ai/PersonalAgent');
  assert.match(res.value.logExcerpt, /Test failed/);
  assert.equal(res.value.source, 'ci_failure_readback');

  // 负例 0：翻完页仍找不到目标 run -> 返回 unavailable（而非 failed）
  const notFoundPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.list') {
          return {items: [], page: 1, nextPage: null, hasMore: false};
        }
        return {};
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'missing-sha'}),
  });
  const notFoundRes = await notFoundPort.read(context());
  assert.equal(notFoundRes.state, 'unavailable');
  assert.equal(notFoundRes.value.reason, 'ci_run_not_found');

  // 负例 1：runId 对应的 headSha 与绑定 commitSha 不一致 -> 必须报错 ci_run_head_sha_mismatch
  const mismatchPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'other-sha', status: 'completed', conclusion: 'failure'}]};
        }
        return {};
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee', runId: 1001}),
  });
  const mismatchRes = await mismatchPort.read(context());
  assert.equal(mismatchRes.state, 'failed');
  assert.equal(mismatchRes.value.reason, 'ci_run_head_sha_mismatch');

  // 负例 2：run.conclusion 缺失或为 success -> 严禁伪造 failure，必须报错 ci_run_not_failed
  const notFailedPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'c0ffee', status: 'in_progress', conclusion: null}]};
        }
        return {};
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee', runId: 1001}),
  });
  const notFailedRes = await notFailedPort.read(context());
  assert.equal(notFailedRes.state, 'failed');
  assert.equal(notFailedRes.value.reason, 'ci_run_not_failed');
});

test('F16_N04 workspace.test_intent_check：审查修复补丁是否保留真实验收意图（含整文件删除与 skip/only 检测）', async () => {
  const port = createWorkspaceTestIntentCheckHostPort();

  const cleanPatch = `
diff --git a/packages/core/src/service.ts b/packages/core/src/service.ts
--- a/packages/core/src/service.ts
+++ b/packages/core/src/service.ts
@@ -10,1 +10,1 @@
-return false;
+return true;
diff --git a/packages/core/test/service.test.mjs b/packages/core/test/service.test.mjs
--- a/packages/core/test/service.test.mjs
+++ b/packages/core/test/service.test.mjs
@@ -20,1 +20,2 @@
 assert.equal(result, true);
+assert.equal(extraCheck, 1);
`;
  const cleanRes = await port.read(context({input: cleanPatch}));
  assert.equal(cleanRes.state, 'completed');
  assert.equal(cleanRes.value.preserved, true);

  const deletedPatch = `
diff --git a/test/a.test.mjs b/test/a.test.mjs
--- a/test/a.test.mjs
+++ a/test/a.test.mjs
@@ -10,2 +10,0 @@
-assert.equal(foo, bar);
-assert.ok(valid);
`;
  const delRes = await port.read(context({input: deletedPatch}));
  assert.equal(delRes.state, 'failed');
  assert.equal(delRes.value.preserved, false);
  assert.match(delRes.value.violations[0], /Deleted test or assertion/);

  const skipPatch = `
diff --git a/test/a.test.mjs b/test/a.test.mjs
--- a/test/a.test.mjs
+++ b/test/a.test.mjs
@@ -10,1 +10,1 @@
+test.skip('flaky test', () => {});
`;
  const skipRes = await port.read(context({input: skipPatch}));
  assert.equal(skipRes.state, 'failed');
  assert.equal(skipRes.value.preserved, false);
  assert.match(skipRes.value.violations[0], /Added test skip/);

  const deleteFilePatch = `
diff --git a/test/foo.test.mjs b/test/foo.test.mjs
deleted file mode 100644
--- a/test/foo.test.mjs
+++ /dev/null
@@ -1,3 +0,0 @@
-test('must pass', () => {
-  assert.equal(1 + 1, 2);
-});
`;
  const deleteFileRes = await port.read(context({input: deleteFilePatch}));
  assert.equal(deleteFileRes.state, 'failed');
  assert.equal(deleteFileRes.value.preserved, false);
  assert.ok(deleteFileRes.value.violations.some((v) => v.includes('Deleted entire test file')));

  const optionSkipPatch = `
diff --git a/test/bar.spec.ts b/test/bar.spec.ts
--- a/test/bar.spec.ts
+++ b/test/bar.spec.ts
@@ -5,1 +5,2 @@
+test('bypass', {skip: true}, () => {});
+describe.only('focused suite', () => {});
`;
  const optionSkipRes = await port.read(context({input: optionSkipPatch}));
  assert.equal(optionSkipRes.state, 'failed');
  assert.equal(optionSkipRes.value.preserved, false);
  assert.equal(optionSkipRes.value.violations.length, 2);
});
