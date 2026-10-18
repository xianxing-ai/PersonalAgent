# @personal-agent/notifications

## 2026-10-15：用户打扰策略、通知中心与原子轮次

Competition Profile 增量在原 `NotificationService` 上扩展。既有 `ingest/drain/acknowledge/status/planSchedules`
继续保留；下方历史“运行期只读/不提供写工具”说明由本节的受信宿主设置入口补充。
通知静默仅控制打扰，不关闭连接器 ingest、不停止工作。`drain()` 仍只是待投递数据，不是投递证明。

`NotificationServiceOptions.atomicState` 注入同步 `NotificationAtomicStatePort`：

```ts
read(key: string): {revision: number; value: unknown} | undefined;
compareAndSet(key: string, expectedRevision: number | undefined, nextValue: unknown): boolean;
```

端口必须由原持久宿主实现跨进程原子 CAS（成功只递增一次 envelope revision）。全部新旧方法共享
`notifications:state`，保留原 `pending/batches/delivered`，追加 `interruption` 内的策略、操作回执、轮次和
feed 展示历史；没有第二套待裁队列或数据库。Runtime 组合使用原 SQLite 的
`createRuntimeAtomicStatePort(runtime,'device-notifications')`；旧未封装值可读为 revision 0。
CAS 冲突明确拒绝，不自动重复写入；写结果未知时先按原 operationId/roundId 读回。
所有同命名空间写入方必须采用相同 CAS 适配，不能让旧无 CAS 写入方同时覆盖新 envelope。

无原子端口时保留旧行为，但 `status().interruptionQuotaSafety` 为 `unavailable`，新策略写入、
read ack、撤回和轮次预占/投递状态写入均返回 `UNSUPPORTED_CAPABILITY`。
普通 `StoragePort.set` 的一次写入不被宣称为跨进程配额安全。

### 批次状态快照分页（F12）

`notifications.events` 返回保留批次的当前状态快照，包含 `ready_for_delivery` / `delivered` 与可选 `deliveredAt`，不表示不可变状态变更日志。首屏返回 `snapshotRevision`；旧持久状态缺少 revision 时按 0 读取，之后每次写入单调递增。续页必须同时传 `sinceBatchId` 和该 revision。若期间任一通知状态写入导致 revision 改变，返回 `cursorState: changed` 且不返回事件，消费端必须从第一页重读，并在 `nextCursor: null` 时才将该 revision 的分页视为完整快照。每轮从第一页对账可以读到先前确认后的 delivered 状态。

### 显式用户字段与继承

作用域为 `{kind:'global'}`、`{kind:'connector',connectorId}`、
`{kind:'responsibility',responsibilityId,connectorId?}`。顺序为 global → connector → responsibility。
首次创建 global 策略必须完整提供以下字段，局部/后续更新可用 patch；没有默认“每小时两次”等预算。

| 字段 | 含义 |
| --- | --- |
| `mode: normal \| silent` | silent 且 `silentUntilUtc=null` 为持续静默；有期限则期满重新裁定 |
| `maxInterruptions: 非负整数 \| null` | 0 不允许打扰；null 无数值上限 |
| `windowMinutes: 正有限数` | 用户明确选择的滚动窗口，每层不同窗口独立执行 |
| `silentUntilUtc: UTC \| null` | 到该时刻前静默；不重置其他策略、游标、未读或已占用轮次 |
| `preferredChannel: banner \| voice \| auto` | 明确通道要求 round 采用该通道；auto 可由可信宿主选择多通道 |
| `allowUrgentBreakthrough: boolean` | 仅允许可信 urgent 事件突破该层静默/quietHours；不突破配额 |
| `digestMode: on_return \| scheduled \| on_demand` | 仅选择摘要触发方式，scheduled 由原 Runtime 调度，不隐设周期 |
| `quietHours: QuietHours \| null` | 复用现 DST 安全墙钟窗口 |

父层静默、quietHours 和每层配额均保留为 `constraints`；局部 normal/null/允许紧急不能绕过全局限制。
显示用 effective 字段不替代多窗口约束。静态 legacy pause/quiet 在发送前仍执行。

Desktop 注入共享宿主时，原 Todo 已保存的 `quietHours/pauseUntilUtc/digest` 以
`{kind:'connector',connectorId:'productivity'}` 保留在同一个原子状态中；不会成为其他来源的规则，
也不要求用户先填写新增 global 额度。原 digest 的窗口、条数和 sources 按原语义继续生效。
受信 `importLegacyPolicy(scope,policy)` 只首次导入；重启不覆盖已由原 Gateway/CAS 修改的策略。
原设置页更新使用同一 `notifications.interruption_policy.set` 工具的 `legacyPolicy` 形态，
与 `patch` 互斥，仍绑定完整 operationId/revision/scope/参数与原用户授权。
用户明确修改同作用域新策略中的 mode/silentUntilUtc、quietHours 或 digestMode 时，分别替换旧暂停、
安静或摘要字段；其他旧字段继续保留。新 global 策略不会无声清除 productivity 的旧规则。

### 新宿主 API

| 方法 | 返回/保证 |
| --- | --- |
| `getInterruptionPolicy(scope)` | state、作用域 revision（尚未建为0）、local/effective、全部 constraints、observedAt |
| `updateInterruptionPolicy({operationId,expectedRevision,scope,patch})` | 策略 revision CAS；同 operation 原样回放，替换参数拒绝；不清空 feed/轮次 |
| `getLegacyPolicy(scope)` / `updateLegacyPolicy({operationId,expectedRevision,scope,legacyPolicy})` | 原连接器/职责设置的独立 revision；与新策略共享原子 envelope、operation 回执和原 Gateway 授权 |
| `ingest(items,{scope?,validUntilUtc?,urgent?,supersedes?})` | 原事件入队，同时追加中心展示记录；supersedes 标记旧变化失效 |
| `notificationFeed({afterCursor?,unreadOnly?,scope?,limit?})` | 稳定递增 cursor、unread、active/withdrawn/expired 与 deliveredAt 分开；纯查询不计打扰 |
| `acknowledgeRead({operationId,itemIds})` | 已读独立于投递确认；跨重启保留，幂等 |
| `withdrawNotifications({operationId,itemIds})` | 保留原历史并标记撤回，不在归来摘要重复旧变化 |
| `getDigest({trigger,scope?})` | 仅仍有效且未读变化；on_return/scheduled 按用户配置筛选，on_demand 为用户查询；不计打扰 |
| `reserveInterruption({roundId,batchIds,scope,channels,expiresAt,urgent?})` | 原子预占一个通知轮次。channels 显式 banner/voice 数组；期限采用原宿主任务期限，无固定新上限 |
| `beginDelivery({roundId,channel})` | 发送前读最新策略/首选通道/配额/有效性，并先持久化 sending；仅 `maySend=true` 才能交原授权通道执行 |
| `completeDelivery({roundId,channel,state,evidenceRefs})` | 记录 delivered/unknown/failed；delivered 必须有可信通道 Evidence，仍不自动已读 |
| `getInterruptionRound(roundId)` | 原预占、发送、未知结果与各通道时间的读回，不重发 |

同轮多通道仅占一次配额，每通道只能开始一次；sending/unknown 阻止同通道或替代通道盲重发。
更换 roundId 不能绕过同一通知已存在的预占/发送/终态回执。未开始发送时新静默可释放预占；
一旦已开始发送，未知或失败均不退款。unknown 可以通过独立原操作读回补为 delivered/failed，不能重新 begin。
`acknowledge` 保留原批次投递确认 API，不能代替新 proactive 通道发送前的配额门禁。

旧 pending 含原内容，可保真迁移 feed。旧 ready 批次只存 itemRefs 时不编造来源内容；
收到实际源 ConnectorItem 重放后补展示记录，仍计 duplicate，不新增批次。缺原来源的批次不能凭空晋升为新配额投递。

`createNotificationSettingsTool(service,{requiredScopes,verifyUserCommand})` 提供原 RegisteredTool 形态
`notifications.interruption_policy.set`。原 ToolContext 必须有 scope、授权引用、期限、取消信号和与
ToolGateway 相同 canonical SHA256 的 `argumentsDigest`；operationId/revision/scope/patch 全部绑定。
`verifyUserCommand` 必须读取现宿主的结构化用户命令/最终语音证明，没有默认放行；模型提案不能改设置。
Runtime `createRuntimeNotificationHost` 同时拒绝 partial、echo、model origin、过期/未来命令，并要求
final voice 的 utteranceId/transcriptDigest 和调用者注入的可信证明验证；本模块不监听麦克风。
新旧两种互斥设置都可由当前唯一语音问题自然确认；Desktop 按实际形态生成摘要、读取该策略的
revision 并绑定完整参数 digest。模型自报 final 或把 legacy 参数替换进已授权 patch 均不放行。

重要状态返回 receivedAt/observedAt/decidedAt/reservedAt/attemptedAt/deliveredAt，并支持
`onStage({stage,observedAt,details})`，覆盖策略更新、预占、发送前复核、回执、静默入中心、已读和归来摘要。
遥测回调失败不会改变已持久化结果；回调不含语音正文/证明或通知正文。

2026-10-15 本模块离线检查：构建通过，发送前首选通道复检回归纳入模块定向测试；Runtime SQLite 组合夹具另行记录。
这些结果不是真实横幅、语音播放、麦克风、账号或生产平台验收。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

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
