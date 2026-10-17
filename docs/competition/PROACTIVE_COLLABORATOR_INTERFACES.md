# 主动责任与无人值守：协作者接口

## 当前接线与真实边界（2026-10-15）

各MOD负责人自己完成实现、公开契约、实际调用方接线、必要测试、Evidence及文档；新具体分工见 [接线总包](COLLABORATOR_WIRING_PACKAGE.md)，逐MOD输入输出/调用方/命令/缺口见 [全MOD清单](../modules/CURRENT_MOD_WIRING_HANDOFF.md)。根composition协调共享入口，不替全部模块代接代验。

最新 [完整实测](evidence/test-image-v3-20261015/full-workflow-results.json) 与 [发布回执](evidence/test-image-v3-20261015/owned-release.json) 已证明ARM64镜像上传SWR、云精确版本目录与日志读回，以及同版镜像本机Docker+本机Runtime/Laya+AgentArts新代理的孙悟空/鹈鹕主影子和单次CAS，共41条Evidence。不是远端Runtime两条全链，不是28真实业务全部通过；各分支父succeeded，协调锚点created。鹈鹕首次partial失败保留。

本机Laya完整输入182–618ms未达150ms，未校准站点均实际升级DeepSeek；本轮主影子串行，日常机会/收益开关仍需真实消费验证。DeepSeek经AA代理，底层平台MaaS来源如实记录，无客户端直接fallback；语音百炼沿用公开端口，SIS经AA流式桥仍未验。新增接口仍provisional，缺provider能力unavailable；不改变Core wire冻结范围。

下文按原轮次保留具体接口/试验记录；其中“未发布”“模型未跑”“主影子未通过”只适用于其早期阶段，当前事实以上述回执为准。旧fixture不能扩展为真实账号、物理设备或平台服务验收。


状态：Competition Profile 的新增 overarching addon，接口仍为 provisional。实现、离线集成与真实账号/模型验收分开记录；不改变原 F01–F28 工作流及 185 节点的覆盖含义。最小修复算法保持暂停。本文件没有新增模型架构或产品发布决定。

## 模型与执行路径

当前用户明确分工：**DeepSeek 使用 AgentArts 已有模型入口，语音使用百炼，Laya 在本机运行**。本轮分工修订了此前笼统禁止平台内部 MaaS 来源/全部远端外接百炼的描述；不能自行把 DeepSeek 改接百炼。宿主通过现有 ModelGateway 与 AgentArts 真实模型入口请求 DeepSeek；如平台模型广场或实际 deployment 元数据标注底层 MaaS 来源，应保留事实，不改名或隐藏。AgentArts新代理已有公共编码夹具真实调用证据；这不等于主动真实来源/完整账号设备链验收，具体回执见本节最新实测链接。

凭据/URL 只来自受信启动配置；请求、模型文本、连接器数据不能增设 endpoint、key 或执行代码。AgentArts 不可用时明确 unavailable/waiting，宿主不得直接调用 MaaS 或模型提供商作为 fallback。语音百炼与本机 Laya 保留各自既有端口、授权和验证边界。配置模型、离线 Fake 和一次真实链路分别是不同证据。

本机 Laya 是现有分类/选择端口。入站先产生 Laya 候选；未验证类别、复杂/不确定问题、来源冲突与重要事件抑制必须交 DeepSeek 复核或接管。Laya 不可用时如实记录，只有实际可用的受信端口才能接管。成熟且有可信资格的契约可由 Laya 与代码处理，不为每件事件永久增加 Teacher 调用。独立问题可合批，有依赖的节点等待原状态，不盲合批。

工作流仅提出 host proposal。原 Runtime/Policy/ToolGateway 决定每次操作是否可执行；HMAC、模型选择、来源原话、推断兴趣和通知重要性均不授予权限。

## 所有权与公开入口

| 所有者/模块 | 公开入口 | 消费方职责 |
| --- | --- | --- |
| AgentArts 工作流 | `@personal-agent/agentarts`: `ProactiveWorkflowEngine`、`proactiveWorkflowDigest`、descriptor/adapter requirements | 保存并恢复返回的 sealed checkpoint，不自行声明实际执行成功 |
| 镜像服务 | `@personal-agent/agentarts-runtime/proactive-controller`: `createProactiveWorkflowController`、`createProactiveHostProofs` | 认证传输、绑定原 task/session/revision/deadline、验签输入和输出 |
| Runtime 持久会话 | `@personal-agent/runtime/application`: `createProactiveWorkflowSession` | 注入当前任务状态、image advancePort、响应验签及可选工具/Evidence adapter |
| 原子宿主状态 | `@personal-agent/runtime`: `createRuntimeAtomicStatePort` | 绑定既有 Runtime SQLite namespace；不新建任务库或调度器 |
| 主动来源 | `@personal-agent/connector-host`: `ConnectorHost`、`createProactiveConnectorHost`；Runtime application: `createRuntimeProactiveConnectorHost` | 受信 source 注册、读/watch 授权、持久 event sink、原 Scheduler 唤醒 |
| 通知宿主 | Runtime application: `createRuntimeNotificationHost`；底层 `@personal-agent/notifications`: `NotificationService` | 设备级原子状态、真实用户设置验证、静默 feed、额度和原通知渠道回执 |

各MOD负责人随自己的工作包完成所需exports、依赖、实际消费映射和设备能力接线；根composition协调共享HTTP/WSS路由及配置，不能代验所有MOD。模块不得反向访问其他包私有实现。连接器与通知只通过公开 DTO/能力引用接线。注册不等于连接，镜像存在不等于云端持续运行。

## 四个入口与来源持久性

`ProactiveInputEvent.entry` 是 `connector | user_instruction | subtask_feedback | wake`。事件同时携带 `eventId/conversationId/sourceId/entityRef/sourceVersion/observedAt/change/payloadRef/payloadDigest/anchorRefs/responsibilityRefs/goalRefs/contractRef/priority/evidenceRefs/proof`；可选 `previousVersion/expiresAt`。`change` 保留 upsert/delete/retract/correction。摘要与引用供模型消费，原正文由受权检索端口按需要读取。

`ProactiveResponsibility` 携带实际对话、消息、原话引用与 SHA256、Goal 引用及来源权限类型。`explicit_instruction` 和 `inferred_interest` 分开；推断兴趣不能附带写权限。持续责任与来源消息不能被订阅表替代，没有订阅不等于不相关。

连接器原事件由既有 `ConnectorHost` source 注册产生，含 connector/account/source revision、标准 ConnectorItem、cursor 与 observedAt。root adapter 按下面顺序映射：

1. 来源页先写 pending checkpoint；event sink 按原 `batchId` 幂等持久化完整批次。
2. sink 返回 `{batchId,durable:true}` 后，才提交来源 cursor。丢失确认时保留原 pending，同批次恢复先于再次 fetch。
3. 从持久批次生成工作流事件引用，签 `event` proof。签名只证明受信宿主提交了这些字节，不能把外部邮件的授权声明提升为权限。
4. 同 eventId 不同输入冲突；相同实体/版本/摘要合并；新版本和删除、更正保留历史及依赖失效。已发出的未知写先核原回执，不从新版本盲重放。

离线、授权过期、cursor 失效、来源 unavailable 都有实际状态，不伪报 no_changes。source polling/watch 的生命周期不成为新调度器；下一次 reasoned wake 交原 Scheduler。

## 镜像 HTTP 与签名

`POST /invocations` 的外层为 `{query: JSON.stringify(value)}`；现有 HTTP 回包是事件数组，结果位于 `JSON.parse(events[0].data.text)`。既有传输凭据、session/request/deadline headers 继续有效；测试用 `x-pa-agent-token: Bearer <fixture token>`、`x-hw-agentarts-session-id`、`x-request-id`、`x-pa-deadline`。真实密钥不得进入文档、模型上下文或报告。

advance payload：

```js
{
  proactiveVersion: 1, operation: 'advance',
  taskId, controlRevision, taskDeadline, // 原任务固定期限
  checkpoint, events, responsibilities, receipts, control, // 按需出现
  hostFrame: proofs.sign('frame', {
    requestId,
    hostAvailability: {localDevice, cloudPersistentHost},
    availableCapabilities
  }, binding)
}
// binding = {taskId, sessionId, controlRevision, taskDeadline}
```

`sessionId/requestId/transport deadline/signal` 来自原 HTTP/WSS 调用上下文。capability 是受信当前宿主观测 `{kind,ref,location,effect}`，请求 JSON 不能单独新增工具。每个 event/responsibility/receipt/control 分别签其同名 kind。describe 操作不执行任务。响应使用：

```js
proofs.sign('advance_result', {proactiveVersion: 1, requestId, ...result}, binding)
```

宿主同时校验 `requestId` 与 `proofs.verify('advance_result', result, originalBinding)`，再提交 checkpoint。被签内容包含结果与整个 checkpoint/proposal 数据，不能仅校验一个 verified 标签。所有 deadline 都受原 taskDeadline 限制；重连、控制 revision 变化或模型调用不延长原执行期限。

## 宿主 proposal、回执与真实工具

proposal 含 `proposalId/operationId/itemIds/stage/capabilityRef/capabilityKind/effect/location/arguments/argumentsDigest/originControlRevision/taskDeadline/createdAt`。阶段为 retrieve、laya、teacher、action、update、wake；实际能力需求从 `getProactiveWorkflowAdapterRequirements()`读取，不能猜通知或连接器私有参数格式。

| 能力 | 原宿主应返回的实际结果 |
| --- | --- |
| retrieve_context | `contextRef/sourceVersions/sourceQuotes/goalRefs/memoryRefs/experienceRefs/scopeRefs`，可附真实依赖与已有事项 readback |
| local_decision_batch / teacher_decision | `selections[]`，每项绑定原 item/candidate，含 actual decidedBy、decisionRef、uncertain/complex/importance/authorityRequired |
| continue/research/delegate/local_plan/shadow/notify/request_user 等 | `status: completed/changed/pending/blocked/waiting_user`、`resultRef`，按实际需要附带有理由的 nextWake |
| update_item | 原事项写入后返回 `{itemId,stateRef}` |
| schedule_wake | 调原 TaskRuntime.createSchedule 后返回 `{scheduleId,runAt,state}`，保留 taskIdempotencyKey |

receipt 为 `{proposalId,operationId,argumentsDigest,state,result,observedAt,evidenceRefs,proof}`。state 为 confirmed/failed/unknown。真实运行记录和 Evidence 由受信执行路径读取并绑定原参数；模型成功声明不是 Evidence。unknown 写留在 waiting_reconciliation，其他独立事项仍可继续。通知动作只生成原通知宿主中的请求/事项；实际 banner/voice delivery 仍需要各自原工具与权限。

## Runtime 会话、CAS 与恢复

```js
createProactiveWorkflowSession({
  atomicState, binding,
  assertActive,          // 读真实任务取消/终态及当前控制版本
  advancePort, verifyAdvance,
  pureAdvance: {kind: 'signed_frontier_no_effects'}, // 仅可信纯 frontier adapter 可声明；可省略
  execution: {tools, resolveInvocation, readExecution} // 可选现有 AgentToolPort
})
```

advance 先持久 request pending，再调用 image。完整响应验签后，**CAS 提交当前 checkpoint 成功才把新 proposal 返回执行方**。CAS 失败不得执行或展示新 proposal。相同 requestId/参数返回原已提交结果，参数改变冲突；checkpoint 只能由会话从原 Runtime 状态注入。可信控制 revision 向前推进仍沿用原 checkpoint，但旧 proposal 不能发起新执行。

可选 executeProposal 仅接受已提交 proposal，经受信 resolver 绑定原 ToolGateway/Policy 授权；先保存 operation pending，再实际调用。原 runId 不能绑定另一输入。unknown/pending 只读原执行状态，不重复 invoke；confirmed/failed 必须有原 Evidence。

`reconcileOperation(operationId,{signal,deadline})` 是单独的历史只读入口。它从持久 operation 取原 task/run/参数/proposal，调用受信 Evidence reader，不调用 resolver 或 tools.invoke。控制 revision 增加、原任务取消或原执行期限结束，都不阻断原执行状态核实；新 deadline 仅限定这次读取，不续原执行期限。

image advance 传输丢失或进程在回包提交前崩溃，会留下 pending request，阻止普通 advance。通用 advancePort 不能假定没有副作用；默认不会重试。当前没有原 image 历史结果读回端口，`reconcileRequest()` 仍明确返回 UNSUPPORTED_CAPABILITY。

**当前专用纯计算恢复**：可信 composition 可以显式声明 `pureAdvance: {kind:'signed_frontier_no_effects'}`，且该端口只能运行现有签名 frontier 计算，不能执行模型、工具或外部写。此时 `recoverPendingRequest(requestId,{signal})` 从 SQLite 读取原冻结 input/digest/checkpointDigest，保留原 task/session/controlRevision/deadline，用原 checkpoint 重算；不能注入新的来源/availability/receipt 或延长期限。跨控制 revision、取消或过期不发起重算。并发旧/新响应复用同一 pending CAS 槽，只允许完整签名结果与其 checkpoint 整组提交一次，CAS loser 不释放 proposal。已有工具 operation 与未知写完全不重执行。

恢复日志与持久回执标记为 `recompute_after_lost_pure_frontier_response`，不是 historical_response_replay。operationId 来源于 task/control revision/items/stage/attempt/argumentsDigest，createdAt 不在其中；重新计算的时间线和签名 checkpoint 会改变。来源跨 expiresAt 后，needsRefresh 变化还可能改变 argumentsDigest/operationId，因此不能声称找回了字节相同的历史响应。`inspect()` 可读原 intent；缺纯计算 capability 或缺原冻结数据的旧 pending 保持 unavailable/conflict，不能删除后盲重试。

## 无人值守、静默与打扰次数

enter_unattended/return/pause/resume/cancel 是受信控制消息，绑定原任务上下文。一个 waiting_user/waiting_device/unknown 事项不阻塞其他独立事项；取消请求与已经发生的副作用/设备停止分开。local_device 不可用时等待设备，只有实际 cloud_persistent host port 可用的分支才能继续；没有云持久宿主时不宣称镜像 24/7。

通知是设备级原状态 namespace，不能按重启/会话重新获得额度。设置由原 structured/最终 voice 用户命令验证，拒绝模型、回声、partial、过期、参数替换或缺权限来源。全局静默/额度不能被 connector/responsibility 子层放宽。

silent 模式继续 ingest、保存未读 feed 与有效性；没有 banner/voice delivery、不预留打扰额度。return digest 返回有效未读信息和 interruptionCount=0；阅读确认、实际渠道送达与工作流 return 是三种不同回执。return 合并 done/changed/pending/blocked 与新增 Evidence，不重新发送旧通知。渠道 delivery unknown 需独立读回，不能退款后换 round 重发。

## 时间记录与本次验证边界

工作流 timeline/onStage 含 stage/requestId/itemIds/startedAtUtc/finishedAtUtc/wallMs；receipt 阶段覆盖原 proposal 创建至宿主回执入站，包含队列/审批/执行与传输，不能当作纯模型耗时。ConnectorHost 的 onStage 含 sourceId/stage/startedAt/endedAt/durationMs/outcome；通知宿主 onStage 是 observedAt 事件点。消费方不得把只有单点的通知事件说成完整耗时；集成测试另用实际开始/结束时钟包裹通知及每个 host 节点。时间报告不包含私人正文或凭据。

新增集成入口：`tests/integration/proactive-image-host.test.mjs`。它使用真实本地 HTTP 服务、签名请求与响应、RuntimeAtomicState SQLite、ConnectorHost pending→sink→cursor、RuntimeApplication/Policy/ToolGateway/Evidence、NotificationHost/NotificationService 和原 Scheduler。六节点依次为 retrieve→Laya candidate→DeepSeek teacher→notify→update→wake；write 工具通过原 allow_once 审批。两个模型经显式 FakeModelProvider/ModelGateway，来源页与用户授权证明也是明确 fixture，无真实账号或模型费用。真实服务的质量、可用性、渠道通知、云部署与用户原工作区均不由该测试证明。

测试还覆盖 sink 已持久但确认丢失后，同批次 SQLite 重启恢复；静默 feed/零 quota reservation；第二次重启后的 return 与相同 request 回执幂等；不重复通知/调度；每阶段实际 timing。测试专用工具执行实际 Runtime 闭环，但不据此宣称所有生产连接器/通知渠道已装配。

当前增量已运行：core 模块目标测试此前 7/7；session 最新目标测试 10/10，加 image-host 集成 1/1，共 11/11（fail/cancel/skip 均 0）。真实 Runtime/连接器/通知/调度与 HMAC HTTP 协议参与，模型/source/account 授权输入为上述明确 fixture。纯恢复回归另使用真实 ProactiveWorkflowEngine 的 expiresAt 分支及实际 SQLite 重启，证明新时间导致结果变化时仍只有一份 CAS 提交；并发恢复后同 operation 工具调用总计一次。没有真实远端模型、本机 Laya/GPU、账号或渠道发送。

| 本次定向阶段 | UTC 开始 → 结束 | 实际 wallMs | 结果/日志 |
| --- | --- | --- | --- |
| Runtime TypeScript build | 2026-10-15T12:56:44.5202356Z → 12:56:47.2571077Z | 2727.1063 | exit 0；`.cache/proactive-pure-recovery-build.log` |
| session + image-host target | 2026-10-15T12:56:57.8869960Z → 12:56:59.8669291Z | 1968.5021 | exit 0；`.cache/proactive-session-image-host-target.log` |

target 日志 SHA256：`62fceff3c1db5618317455b848a20d99641ae757713293564300308a7ce56487`；阶段记录保存在 `.cache/test-image-v3-phases.jsonl`。集成单条测试耗时 962.3271ms，记录 6 个实际 host 工具任务、3 次 allow_once、1 次通知入 feed、1 条原 Scheduler schedule。该耗时是本次离线夹具执行，不能作为真实模型性能或云部署质量结论。全仓检查的最终快照与结果由根单独汇总，不把该 Runtime 后续增量冒充已在之前全仓快照验证。
