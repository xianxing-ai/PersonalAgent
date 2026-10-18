# @personal-agent/productivity

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

MOD-20 · 待办与提醒（PA-009，P0）。负责人 `Potatos498`，评审者 `goo122`。

## 职责

- 待办条目的创建、修改、取消与**读回**（状态机 `open → done | cancelled` 单向，终态不可逆；每次变更 revision 递增）。
- 时区正确的时间表达：接受 UTC 瞬间或「本地墙上时间 + IANA 时区」，统一解析为精确 UTC 瞬间并保留原始本地表示。
- **触发定义**（ReminderTrigger）：从待办条目生成结构兼容 Runtime `ScheduleInput`（MOD-03）的提醒规则——本包不调度、不持有计时器、不自建持久任务库。

## 非职责

- 调度执行与补跑/错过判定：MOD-03 Runtime（`SchedulerPort.dispatchDueSchedules / recoverMissedSchedules`）。
- 通知展示：MOD-23 与桌面端（`zemeng`）。
- Runtime 根装配接线：`goo122`。
- 日历同步：`@personal-agent/calendar`（本模块族的连接器，见其 README）。

## 公共入口

`src/index.ts` 导出 `TodoService`、`register`、`resolveWhen`、`localToUtc`、`buildReminderTrigger`、`reminderTriggers`、`applyReminderDispatches` 与全部类型。

### 工具

| 工具 | 版本 | Scope | 副作用 | 幂等 | 恢复 |
| --- | --- | --- | --- | --- | --- |
| `todo.list` | 0.1.0-alpha.1 | `todo:read` | read | ✓ | ✓ |
| `todo.create` | 0.1.0-alpha.1 | `todo:write` | local_write | ✗（重复调用创建多条） | ✗ |
| `todo.update` | 0.1.0-alpha.1 | `todo:write` | local_write | ✓（同 patch 重放 revision 不变时不写） | ✓ |

`register(host, options)`：`options.storage`（StoragePort，必填）与 `options.conversationId`（必填）缺失时抛 `INVALID_ARGUMENT`，不静默降级。时间入参三选一规则：`xxxCtc` 与 `xxxLocal + xxxTimeZone` 恰好提供一组。

### 时间语义（DST 边界）

- 秋季回拨（本地时刻出现两次）：取**较早**的一次（夏令时偏移）。
- 春季跳跃（本地时刻不存在）：**向前推**过跳跃（等价 Temporal 'compatible'）。
- 提醒时刻不能晚于 due；违反抛 `INVALID_ARGUMENT`。

### 触发定义与「不重复提醒」

- `scheduleId = taskIdempotencyKey = todo-reminder:<itemId>:<remindAtUtc>`——同一条目同一提醒时刻确定性相同；改提醒时刻即换新键。
- `missedRunPolicy`：`run_once`（休眠恢复补跑一次）/ `skip`（标记错过），对应 PA-009 的两种约定，由 Runtime 执行。
- `applyReminderDispatches` 把 Runtime 回执（`fired`/`skipped`）映射回条目（`delivered`/`missed`），已投递的提醒不再生成触发。
- 条目完结（done/cancelled）后触发自动撤销；装配方在 `clearReminder` 或条目完结时应同步移除对应 schedule（scheduleId 见工具返回）。

## 依赖

- 生产：`@personal-agent/contracts`（StoragePort、ToolHost、ProtocolError）。
- 测试：`@personal-agent/testkit`（FakeStorage、FakeToolHost）。
- 结构兼容 Runtime `ScheduleInput` 但**不导入** `apps/runtime`（ADR-0002）。

## 测试

`node --test test/*.test.mjs`（14 项）：CRUD 读回与 revision、终态约束、DST 四边界（纽约/悉尼春夏）、触发确定性与键稳定性、dispatch 映射、工具 schema/scope、缺参拒绝。全部离线，fake 时钟注入，无密钥无网络。

## 已知限制

- `todo.create` 无幂等键通道（ToolContext 不携带 idempotencyKey），重复投递会创建重复条目；装配方应经 Runtime 任务幂等约束。
- 存储为注入的 StoragePort KV（宿主决定持久化介质）；并发写同一条目无乐观锁外的仲裁——revision 只防回退。
- 真实提醒投递链路（Runtime 调度 → 桌面通知）未在本包验证，属集成工作包。
