# @personal-agent/notifications

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-23（Potatos498）。产品流程：F12；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

MOD-23 · 通知汇总策略（PA-015，P1）。负责人 `Potatos498`，评审者 `goo122`。

## 2026-09-30 云端业务增量（待本地统一验收）

未确认批次在休眠/重启后重新 drain 仍尊重 quietHours/pauseUntilUtc；保持批次 ID，出窗再交付。
planSchedules 补充确定性的 pause-end（含仅剩未确认批次的情况）。
acknowledge 在首个确认时持久写入可选 deliveredAt，重复确认保留该时刻。
宿主必须在通知通道给出实际投递回执后确认；ready_for_delivery 只是排队。
实例复制装配策略，用户编辑后由宿主用同一存储重建服务，外部对象突变不绕过策略。
本轮没有运行新增用例或 Windows 通知验收。统一交接见
[业务接线说明](../connectors/mail/docs/cloud-business-handoff.md)。

## 职责

- 对 `ConnectorItem` 标准事件流按**用户规则**做裁定：立即交付、安静时段持有、暂停持有、聚合为摘要请求。
- 规则三件套（均装配期注入，运行期只读）：
  - **安静时段** `quietHours`：本地墙上时钟窗口 `HH:mm`＋IANA 时区；支持跨午夜（22:00→07:00＝「晚段或早段」）；判定经 `Intl` 换算 DST 安全（回拨夜的同一墙上时刻仍安静）；窗口含 start 不含 end。
  - **暂停** `pauseUntilUtc`：到时刻为止 hold 一切（含摘要），过期自动恢复，无需显式清除。
  - **聚合** `digest`：`windowMs`（自最早未裁事件起算）或 `maxItems`（先到先触发）产出一条摘要请求；`sources` 缺省聚合全部，可限定来源。
- **去重**：按事件 `dedupeKey`——已交付或待裁的重复事件静默忽略并计数披露；裁定后的条目持久标记，重复 `drain` 不重复产出新批次（未确认批次会再次返回，id 不变）。
- **批次生命周期**：`pending`（事件待裁）→ `ready_for_delivery`（已裁定并持久化，等待桌面取走并确认）→ `delivered`（已确认，保留最近 100 条作幂等记录后淘汰）。`status().unacknowledgedBatches` 披露未确认数。

## 非职责

- 调度执行：`planSchedules` 只产建议（见下），真正的定时由 MOD-03 Runtime 执行。
- 通知展示：`zemeng` 的桌面端消费 `drain` 的产出。
- 策略的运行期编辑：用户规则来自宿主设置（UI 归桌面端），本包不提供写工具。
- 事件采集：feeds/calendar 等连接器各自负责。

## 公共入口

`src/index.ts` 导出 `NotificationService`、`register`、`assertPolicyValid`、`quietHoursActive`、`nextQuietEndMs`、`localMinuteOfDay` 与全部类型。

### 服务（宿主在调度点调用）

| 方法 | 语义 |
| --- | --- |
| `ingest(items)` | 接收标准事件；重复 dedupeKey 忽略，返回 `{accepted, duplicates}` |
| `drain()` | 裁定并交付：立即条目＋摘要请求；返回 `{batches, held}`（held 按 quiet/paused/digest 分计数披露）。**批次持久化为 `ready_for_delivery`，桌面确认前 drain 原样返回（崩溃恢复），不删除通知** |
| `acknowledge(batchId)` | 桌面确认接收：批次置 `delivered`（幂等）；重复确认无副作用，未知 id 报 `NOT_FOUND` |
| `status()` | 只读状态：暂停至、安静至、待裁数、下一聚合窗口关闭时刻 |
| `planSchedules(conversationId)` | 结构兼容 Runtime `ScheduleInput` 的调度建议：`notifications:quiet-end:<时刻>` 与 `notifications:digest:<时刻>`，`missedRunPolicy: 'run_once'`，scheduleId＝幂等键（确定性） |

**裁定次序**：暂停 > 聚合 > 安静。聚合来源的事件不经安静直接入池（摘要本身在交付时尊重安静——窗口到了但仍在安静期则继续持有）；非聚合来源在安静期被持有，出窗后下一次 `drain` 交付。

### 工具

| 工具 | 版本 | Scope | 副作用 | 幂等 |
| --- | --- | --- | --- | --- |
| `notifications.status` | 0.1.0-alpha.1 | `notifications:read` | read | ✓ |

`register(host, options)`：`storage`（StoragePort）与 `policy` 必填且需过 `assertPolicyValid`，缺失/畸形抛 `INVALID_ARGUMENT`，不静默降级。

## 依赖

- 生产：`@personal-agent/contracts`（StoragePort、ConnectorItem、ToolHost）。
- 测试：`@personal-agent/testkit`（FakeStorage、FakeClock、FakeToolHost）。
- 不导入 `apps/runtime`（ADR-0002）：调度建议为结构兼容的自有类型，装配方直接交给 `SchedulerPort.createSchedule`。

## 取消、超时与重试

纯本地同步裁定，无出站请求：无取消/超时语义（宿主工具调用的取消由 ToolHost 门禁承担）。`drain`/`ingest` 幂等可重试；崩溃后待裁事件与已裁标记经 StoragePort 恢复。

## 测试

`node --test test/*.test.mjs`（12 项，全部离线）：安静窗口三类判定与边界、纽约回拨夜 DST、`localMinuteOfDay`/`nextQuietEndMs` 事实、立即交付与去重、安静持有→出窗交付、暂停含摘要并自动恢复、聚合窗口关闭/上限提前/来源筛选、聚合交付尊重安静、调度建议字段与 Runtime `ScheduleInput` 结构兼容且确定性、策略校验拒绝畸形、ingest 拒绝非 ConnectorItem、工具 schema/scope 与缺参拒绝。

## 已知限制

- 聚合窗口从「最早未裁事件的到达时刻」起算，非固定对齐墙钟（首个事件决定窗口相位）；跨重启相位由 StoragePort 恢复。
- 安静结束按「首个不再处于安静期的整分」扫描（60 秒粒度）：春季跳时当天 `endLocal` 可能不存在（纽约 2026-03-08 的 02:30 被跳过），在时钟越过 `endLocal` 的瞬间（03:00 EDT）释放；回拨夜在 `endLocal` 唯一一次出现时释放；极端未对齐秒级时刻取整到分。
- 暂停过期由下一次 `drain`/`status` 调用察觉，不产生主动唤醒（装配方可用 `pauseUntilUtc` 自行建一条 Runtime 建议，本包不越权）。
- 已交付标记无 TTL，StoragePort 长期增长由宿主清理策略负责。
