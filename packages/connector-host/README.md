# 连接器宿主（MOD-05）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-05（goo122）。产品流程：F02、F14、F15、F21、F24、F25；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

`@personal-agent/connector-host` 提供连接器注册、能力发现、健康状态和连接生命周期。连接器工厂只能读取注册时声明的凭据引用；列表和健康结果不返回凭据。具体凭据由注入的 `SecretStorePort` 提供，Windows Credential Manager / DPAPI 实现仍归 MOD-16。

本包为当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 提供共享业务能力目录，但 AgentArts 不直接获得账号、凭据或连接器对象；只能消费经本地 Runtime/ToolGateway 暴露的受限工具。可选 Local Profile 不建立并行连接器宿主。

ConnectorPort、ConnectorHost 和 `SecretStorePort.read` 当前为 `provisional`。生产 Runtime 尚未公布 `connector.connect` / `connector.disconnect`，账号会话也未持久化；未公布 operation 必须按 `unavailable` 处理。见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

业务查询和写动作不从宿主直接暴露，必须注册为工具并经过 `@personal-agent/tool-gateway`，避免绕过授权策略。当前切片尚未持久化账号会话，也未接真实连接器。

验证：

```sh
npm run build --workspace=@personal-agent/connector-host
npm run test --workspace=@personal-agent/connector-host
```

## 2026-10-15 主动来源适配（provisional）

`ConnectorHost.register(factory, {secretRefs, proactive})` 在**原 registrations** 中声明主动来源；没有第二个连接器注册中心。注册只公布能力，不连接账号、不读取数据、不开始 watch。既有查询/写工具继续经过 Runtime/Policy/ToolGateway；本接口只负责已授权的源读取/订阅和可信事件入站，连接器内容不能签发权限。

每个 `proactive` 来源包含 `sourceId`、`accountRef`、`kind`、`mode`、`configurationRevision`，以及可选 `read/watch/reconcile` 公共适配函数。sourceId 在原 Host 内唯一，账号和配置修订绑定持久 checkpoint；换账号/配置不能直接套用旧游标。`kind` 支持 mail/calendar/todo/feeds/research/weather/file/wiki/git/ci/model_progress/other，是源分类，不代表这些 provider 已全部连接。

能力 mode 为 push、watch、poll-only、manual-only 或 unavailable。push/watch 必须有实际 watch adapter，否则公布 unavailable；manual-only 不接受 start。poll-only 的 start 只建立显式连接，不创建循环或默认间隔，取数由原 Scheduler/用户事件调用 tick。独立来源 tickMany 可并行，同来源读取/恢复有防重入；默认不打开任何真实账号、麦克风或用户应用。

### 实际公开端口匹配

| 来源 | 当前可复用能力与缺口 |
| --- | --- |
| 邮件 | 通过原 ConnectorHost 实例调用公开 `MailConnector.fetchChanges`，保留账号、UIDVALIDITY 游标及 ConnectorItem；实例由可信 factory 提供，不复制 IMAP 后端。无公开 watch 时为 poll-only，不称推送 |
| 日历 | 已有 CalendarConnector.fetchChanges，属于窗口分页；空的窗口结束 cursor 在下一次默认读取时视作未指定游标，不伪造永久增量/token。删除与窗口变化仍需对应 source adapter 对账 |
| Feeds | 既有 collect/poll manifest 可消费其 ConnectorPort.fetchChanges；需要 transport/stale 等额外语义时，配置 read adapter 复用公开 FeedService.collect 并照实披露错误，不能用缓存空页冒充在线无更新 |
| 研究、天气 | 现有按需公开服务需要检索词/地点等具体输入，不能仅因有 ConnectorPort 方法就宣布 watch。默认 manual-only；需要定时读取时由可信 read adapter 绑定完整用户参数/授权，由原 Scheduler 给出有理由的调用 |
| 待办 | 公开 TodoService/StoragePort 可由业务 owner 绑定 read/watch 投影；本包没有创建第二待办库或假订阅 |
| 文件/Wiki/Git/CI/模型进度 | 使用对应 owner 已公布的真实读取/订阅端口，投影为 ConnectorItem；未提供 adapter 就 unavailable。可通过 page.revisions 携带公开的源修订，不能凭接口名称伪造连接 |

### 公共工厂与持久顺序

```ts
createProactiveConnectorHost({
  host, // 现有 ConnectorHost
  checkpoints: {read(sourceId), compareAndSet(sourceId, expectedRevision, next)},
  events: {persist(batch, context)},
  authorize(sourceDescriptor, context), // 现有受信读取/订阅租约
  now?, onStage?
})
```

上面是接口形状，函数需由真实宿主提供。checkpoints.read 返回 ProactiveCheckpoint 或 undefined；CAS expectedRevision 为当前 checkpoint.revision，next.revision 必须增加一。events.persist 必须按 **batchId 幂等地持久落入现有 Runtime checkpoint/事实投影** 后返回 `{batchId, durable:true}`；不能先应答再异步保存，也不能把内存队列冒充持久事实。

顺序为：读取原 checkpoint → 取一页实际源数据 → CAS 保存原 pending batch → events.persist 并确认原 batchId → CAS 提交 cursor 与 seen 去重。任何一步失败保留旧 cursor；即使 sink 已成功但 cursor CAS 失败，重启也先把相同 pending batch 交给幂等 sink 核实，再提交 cursor，不重复取页或漏掉事件。没有 pending 且 source 的 checkpoint 状态需要对账时，不自动跳过原游标。

事件是 host-only `ProactiveEvent`，不是新增冻结 wire：`kind:'source.changed'`、eventId、sourceId/connectorId/accountRef/sourceKind、sourceRevision、sourceRevisionKind、公开 ConnectorItem、cursor、observedAt。只去除 exact duplicate；新内容或新原生修订仍入站，**无 PlanStep 订阅不等于与目标/责任无关**。仅 fetchedAt 变化不制造新版本。原生 `page.revisions[dedupeKey]` 标为 provider_revision；默认只对公开条目投影（不含 fetchedAt）算摘要，明确标为 item_projection_digest，不冒充完整邮箱正文/Wiki页/Git对象的原生 revision。

默认 ConnectorPort.fetchChanges 没有 signal/deadline 参数，旧提供者的在途读取不保证立即中断；本包在返回后和每次落盘/游标提交前核对原取消/期限/租约，防止迟到结果提交。需要即时取消的来源应配置其真实支持取消的 read/watch adapter。没有新固定轮询间隔、重试次数或任务预算。

### 生命周期、恢复与调度

- `sources()` 公布原 Host 的能力；`status(sourceId)` 返回描述、原 checkpoint、monitoring/inFlight。
- `start(sourceId, {signal,deadline})` 显式连接/订阅；`tick(sourceId, {limit,signal,deadline})` 明确读取一页；`tickMany(requests, context)` 仅并行不同来源。
- `recover/wake(sourceId, reason, context)` 的 reason 为 reconnect、authorization_restored、cursor_expired、device_resume。先核实原 pending；没有公开 reconcile adapter 时返回 reconciliation_required，不伪造已恢复。
- reconcile 返回 `{state:'verified',evidenceRefs,cursor?}` 或显式 `resetCursor:true` 才可替换/重置过期游标；reset 与 cursor 不能同时提供。来源 owner 必须核实 epoch/版本和读取授权，不能用“重试成功”字符串替代 Evidence。
- `planWake(sourceId, at)` 只给 dueAt/idempotencyKey/missedRunPolicy=run_once 的建议，原 Scheduler 才负责执行；没有偷偷建立 setInterval。注册来源不等于开始监视。
- `stop/dispose` 撤销本工厂的 watch 并阻止迟到事件提交；原 ConnectorHost 的连接可能还供其他业务使用，因此最终 disconnect/unregister 仍由原注册 owner 管理。
- watch 的 signal/deadline 与启动租约绑定；授权恢复后的 recover 使用新请求核实事实，不自动续订旧 watch。恢复监视需宿主显式 stop 后以新租约 start。

状态包含 registered、active、changed、no_changes、offline、authorization_expired、cursor_expired、reconciliation_required、unavailable、stopped、cancelled。no_changes 只来自成功取页并完成持久去重流程；断连/异常/权限过期/游标失效绝不伪装无变化。错误只保留 code，不把凭据/提供者异常正文写入状态。

onStage 提供 connect/read/pending_persist/event_sink/cursor_commit/recover/next_wake 的真实 startedAt/endedAt/durationMs/outcome，只带 sourceId 和阶段，不记录正文或密钥；诊断 callback 失败不能改变已提交事实。

Runtime 配套的 `createProactiveCheckpointAdapter` / `createRuntimeProactiveConnectorHost` 位于 `apps/runtime/src/application/proactive-connector-host.ts`，只结构化注入原 atomicState port。其 envelope.revision 必须与 checkpoint.value.revision 相同；没有第二层额外 +1。根组合负责真实 SQLite CAS、事实 sink、公开 exports 和 Scheduler 接线。

新增测试使用显式 Fake 来源、公开 MailConnector + FakeMailProvider 与注入内存 CAS/sink；验证真实 Host/adapter 控制，不代表真实 QQ、日历、文件 watcher 或云服务已连接。真实 SQLite/Runtime 与实际来源验收须独立读回，不能以 register/start 返回代替。
