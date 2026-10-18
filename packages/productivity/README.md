# @personal-agent/productivity

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-20（Potatos498）。产品流程：F06、F07；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

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
