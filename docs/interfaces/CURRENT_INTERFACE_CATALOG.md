# 当前接口目录与冻结登记

## 2026-10-17 F15 预览结果投影修复（provisional）

注册的 `coding.repair.preview` 与 Desktop N04 别名在原 ToolGateway 保存执行结果及签署工作流回执前，仅投影会话确认和各补丁路径、前后 SHA、变更标记；不返回完整预览正文。宿主本地预览和补丁/CAS 校验不变，实际源码导出仍需原精确原生许可。未新增 Core wire、依赖或迁移；本地回归不代表真实镜像/华为整图已复测，不提升冻结状态。

## 2026-10-17 镜像 F15 编码最小修复（provisional）

[V6 接线](../competition/CODING_MINIMAL_REPAIR_V6.md)说明原 F15 的多轮失败修复、原子任务入口 `coding.repair.workflow`、独立编码宿主与包级验证指纹。新增 `@personal-agent/contracts/coding-repair` v1 是进程/工具数据，不增加 Core wire 或数据库迁移。镜像实际消费 jsdiff 与 TypeScript Compiler API；原本机 Runtime/Policy/ToolGateway/Evidence 继续负责授权和可信执行。

主分支交付需当前 required 验证 VALID、相关用户基线 CAS 及逐文件读回；isolated 影子只产出验证 artifact、不发布主目录。固定版 AgentArts WSS/HTTPS、原生精确源码与元数据出机门禁继续保留。实现、分项测试、完整图和真实云发布分别登记，不扩大冻结范围，不据此宣称28条全部业务已验。

## 2026-10-16 远程 MCP 有界缓存与原 Runtime 回执（provisional）

`RemoteReadonlyMcpOptions.readRunReceipt` 为受信宿主同步只读查询，绑定 task/run 与原参数摘要；只回收持久 confirmed/failed 的本地缓存，unknown 保留。`TaskRuntime.isToolExecutionActive` 只观察当前进程首次 Gateway 分派的精确输入标记，不授予执行权限、不从 SQLite 恢复；Desktop 消费原执行记录、原结果 checkpoint 和该标记。无 wire、Schema、迁移或新依赖；接口继续 provisional，真实平台/真人及完整 MOD-06 验收未由合成容量回归完成。见 [修复与验证](../modules/MOD-06-CAPACITY-RECEIPTS-20261016.md)。

## 2026-10-17 审批恢复与 WSS 结果预算修复（provisional）

AgentArts Runtime 工厂增加仅可信组合可注入的非秘密 `deploymentVersion` 与同步 `assertDeploymentBinding`，复用原 `coordinationBinding` 和任务 checkpoint；HTTPS/WSS 固定版本，同版凭据可刷新。Competition 任务在批准写入前、直接恢复前及云端发送前核对原配置；缺失或失配返回 `REVISION_CONFLICT`，不重新绑定旧任务，不先消费授权。显式模型子任务也按原父派发、原选择及执行种类恢复。

`OwnedWorkflowAdvanceRequest.resultFits` 仅由可信传输组合注入，workflow JSON 白名单仍拒绝该字段。WSS 对完整事件数组执行现有 64,000 字节预算；输入摘要只还原同绑定原输入，工具结果引用保留原操作摘要和 Evidence。不可交付的新节点明确 unavailable 并保留可续检查点，unknown 不重放；HTTP 原容量与小结果形状保留。未增加 Core wire、数据库迁移、第二任务库或协议容量，也未扩大冻结范围。具体行为与验证边界见 [V5 接线](../competition/DESKTOP_AGENTARTS_MODELS_V5.md)。

## 2026-10-16 Desktop WSS／语音／模型目录增量（provisional）

Desktop 多会话、草稿、原生推理强度与音频诊断均复用私有 IPC；任务、审批及听写结果绑定原对话，不新增 Core wire 或执行循环。对话存储 v4 保留 v1–v3 历史及迁移前备份；回退不能直接用旧版读取 v4。

Huawei SIS 增加兼容的 `HuaweiSisRequestAuthPort`，由可信宿主对固定区域、项目的 ASR/TTS 请求签名，与原 `HuaweiSisTokenPort` 二选一。Desktop 长期访问密钥以独立 safeStorage 密文保存；不向 Renderer 返回密钥或签名头。此端口仍 provisional；配置、鉴权探针、实体设备及 AgentArts 转发分别验收，长期凭据不证明已有 AgentArts→SIS 接口。

[V5 接线说明](../competition/DESKTOP_AGENTARTS_MODELS_V5.md)记录固定版本 WSS 主通道、同版原生语音转发、受信模型目录与加密默认选择。
原 query 增加可选 `executionModel`，原 `subagent.dispatch` 增加可选 `reasoningEffort`；旧输入兼容，原 Core wire、WS 帧和数据库迁移不变。
主／子模型选择绑定目录 revision 并持久化在原 checkpoint；未知结果不换模型重试。`readSubagentTasks()` 只投影原任务。
目录可见不等于模型授权或真实推理通过；原 API 配置保留。新增接线保持 provisional，真实云端、设备与模型能力分别验收，不扩大冻结范围。

本机 `task.reconcile.finish` 是私有 Desktop IPC，只能由原面板/工作区对已取消或过期的 confirmed subagent export-withheld 任务发起。原回执、所有子任务绑定及完整读集 CAS 通过后，原任务才进入 cancelled/failed；已收到的历史失败回执在同事务留下失败消费审计，不重发云请求或工具。未来 WSS 明确终态错误与应用解析失败分别处理，unknown 仍保留 hold。没有新增 Core wire 或数据库迁移；实现与真实验证分开见 V5 说明。

## 2026-10-16 V4 生产消费接口（provisional）

[V4 接线](../competition/WORKFLOW_WIRING_V4.md)新增 Runtime Application 的主动 host/原任务生命周期、
真实 HTTP/SSE 镜像签名适配、原决策工具组合、公开 Memory/当前上下文校验和 OwnedWorkflowHostBridge 工厂。
同次影子意图经原 ToolGateway 回执、可信资源/用户比较设置及 checkpoint 进入 Engine；F23_N04 为写、N05 只读原 operation。
Desktop 通知/语音当前参数确认及旧 Todo 策略复用同一 NotificationService/原 CAS。
这些是进程内及现有镜像协议增量；没有新增 Core wire operation、替代数据库、静默模型回退或冻结能力。
实际模型/账号/设备/平台验收和本轮构建、PR、发布分别记录；旧 V3 云版本不代表本轮已部署。

## 2026-10-15 当前真实证据与各MOD消费责任（不扩冻结）

[完整实测汇总](../competition/evidence/test-image-v3-20261015/full-workflow-results.json) 与 [发布回执](../competition/evidence/test-image-v3-20261015/owned-release.json) 证明新ARM64 SWR/云精确版本目录、真实AgentArts新代理及同版镜像本机Docker+本机Runtime/Laya两条公共编码主影子/CAS，共41条Evidence。两条全链不在远端Runtime跑；各分支父succeeded，协调锚点created。Laya全链输入182–618ms未达150ms，未校准站点真实升级DeepSeek。首轮鹈鹕partial失败保留。

所有新增工作流、签名host、平台服务和主动接口保持provisional；缺真实provider/账号/授权的具体能力仍unavailable。28图185节点保留且串行，不能当全部真实业务完成；日常影子收益机会开关尚未验。本节覆盖后续下文“未发布/主影子未通过”等早期时间状态，但不覆盖原始失败，也不新增wire冻结。

每个MOD负责人自己接实际调用方、跑必要消费测试并交Evidence/文档，具体唯一责任与公开依赖见 [十项接线包](../competition/COLLABORATOR_WIRING_PACKAGE.md)、[全MOD交接](../modules/CURRENT_MOD_WIRING_HANDOFF.md)。平台MCP、原生知识、trace与效果评估应逐面绑定受信adapter并独立读回；本机Wiki/本地MCP或模型代理均不能代替相应平台验收。


## 2026-10-15 V3 主动责任与通知接线（provisional）

新增接口复用原 Runtime SQLite、ConnectorHost、Policy/ToolGateway、Evidence 和 Scheduler：
`createRuntimeProactiveConnectorHost`、`createRuntimeNotificationHost`、`createProactiveWorkflowSession`
由 `@personal-agent/runtime/application` 导出，`createRuntimeAtomicStatePort` 由 Runtime 公开入口导出。
镜像 `proactiveVersion:1` describe/advance 继续走原 `/invocations`，输入与结果签名绑定原
task/session/controlRevision/deadline；签名不授予工具权限。主动来源先持久化事件批次再推进 cursor，
未知操作读回原执行；无人值守/归来不续期限、不重发通知。静默 feed、用户打扰配额和多渠道同轮计数
使用同一原子状态，旧通道预占在实际发送前按最新策略复查。
完整形状、端口所有权和缺口见 [协作者接口](../competition/PROACTIVE_COLLABORATOR_INTERFACES.md)，
实现与验证记录见 [V3 测试说明](../competition/TEST_IMAGE_V3.md)。这些增量没有冻结新的 Core wire
operation，没有新增数据库迁移；离线真实 HTTP/SQLite 集成和容器目录检查不等于账号、设备、平台部署
或全部 28 条业务链验收。下节是早期全图增量的历史状态，不覆盖后续独立回执。

## 2026-10-15 本机 Laya／镜像全图增量（provisional）

Owner 指定本机 Laya，28 项工作流及 185 节点仍由自有镜像编排，单图串行推进。
`decision.choose_candidate` 与逐节点 `workflow.host.*` / `workflow.guard.*` 复用现有 Runtime、Policy、
ToolGateway 和签名 HostBridge 回执。catalog 新增 designCoverage 和 adapterRequirements；模板 `2026.10.15.2`
保留原图决策要点、模型分工、汇合及验收语义，提供逐图摘要。没有新增本地 wire 字段、数据库迁移或冻结能力。
旧模板或嵌入式 checkpoint 不在新配置下重放；未知写入继续在原版本核实。
本机 ARM64 目录验证通过，但 Laya 正反质量和鹈鹕主／影子完整修复仍未通过，镜像未发布。
接口、148 个绑定及真实失败证据见 [接线说明](../competition/LOCAL_LAYA_WORKFLOW_WIRING.md)。
## 2026-10-15 main 已合入增量（逐项保持原验证边界）

合入基线 `origin/main@8c395f5f` 已包含以下三个工作包；下文历史的“待评审/未集成”是当时记录，不能覆盖本节已合入事实。这里登记公开实现与主线状态，不新增 Core wire capability、数据库或冻结范围。

- **#350 原生 thinking**（`2009d4c1`）：沿现有 ModelGateway、Runtime 辅助子任务工厂及 Desktop 加密配置提供 host-only `nativeReasoning`，开关、支持列表、固定强度、输出预算和恢复身份绑定仍按原契约消费。已合入不证明所有真实模型端点支持；模型/工具链继续 provisional。
- **#361 请求级观测**（`fef57f61`）：公开 `@personal-agent/agentarts/observability` 的 `validateInvocationIdentity`、`projectTraceObservation`、`projectRunLogObservation`、`buildRunLogPath`，以及现有手工 reader 的 `readAgentArtsTraceObservation`/`readAgentArtsRunLogs`。读取有绝对 deadline、取消、大小上限、单次 GET、禁重定向和脱敏约束；实际 invocation 身份来自受信调用记录。平台日志关联回执不等于完整 trace、命中版本、成本、效果评估或原生知识已验证，缺字段/权限/adapter 仍明确 unknown/unavailable。见 [MOD-32](../modules/MOD-32-AGENTARTS-OBSERVABILITY.md)。
- **#359 取消后的补丁核实收口**（`8c395f5f`）：现有 `WorkspacePatchReconciliationAdapter.reconcile` 与 `TaskRuntime.reconcileToolExecution` 在 Competition 已申请取消时仍先保存原 applied 结果、普通工具结果与 marker 确认；仅无 started/unknown 工具和云端 inflight/unknown 后确认取消。未知写不重做，已发生副作用保留，补丁成功不等于任务成功；取消受理仍不等于执行已停止。见 [补丁恢复验收](../../packages/coding-tools/ACCEPTANCE-20261013.md)。
## 2026-10-15 最终可见请求格式（provisional）

可信 Competition 宿主显式选择的 requestFormat 在 Provider 序列化/计量之前完成既有 MaaS 思考开关转换，并参与模型、预算与子任务恢复绑定；镜像 fetch 不再改写正文。无新 wire operation、迁移或冻结项。完整官方模板、生产真实计量与 MaaS 匹配仍未验收，见 [工作包](../modules/MOD-04A-FINAL-REQUEST-BUDGET-20261015.md)。

## 2026-10-15 Competition 预算展示（provisional）

[预算展示工作包](../modules/MOD-04A-BUDGET-DISPLAY-20261014.md) 沿既有 modelApi.state / Admin snapshot 展示经过宿主校验的 Provider 计量元数据，保持原 IPC 和 wire Schema；不持久化新增采样、正文或凭据。默认 meter 未配置则未计量，隐藏上下文未知。固定官方词表的 Windows 原始文本核验不等于完整模板/MaaS 验收，生产不自动启用实验 meter。无新增 capability、迁移、产品依赖或冻结范围变化；原生 Electron/IPC 烟测通过，云调用 0。

## 2026-10-14 Competition 可见模型请求预算（provisional）

[F27 Provider 工作包](../modules/MOD-04A-VISIBLE-REQUEST-BUDGET-20261014.md) 增加 host-only `VisibleRequestTokenBudget`、`ModelCapabilities.requestTokenBudget` 和 `ModelResult.requestBudget`，沿 OpenAI compatible 序列化与 Competition 子任务工厂接线。明确模型/tokenizer/configuration 版本及显式窗口，计量工具提示包装之后的完整 Provider 请求；输出预留映射实际输出字段，凭据前/后校验，SQLite 恢复绑定预算描述。无计量器明确 unmeasured；hiddenContext 为 unknown，不能据此保证平台完整上下文窗。无新 wire capability、Schema、迁移、依赖或 frozen 范围变化；真实模型/tokenizer、自有镜像及 Desktop 展示仍待验收。见 [ADR-0026](../adr/0026-visible-model-request-budget.md)。

## 2026-10-14 Competition 编译上下文增量（provisional）

[F27 上下文工作包](../modules/MOD-09-CONTEXT-BINDING-20261014.md) 沿原 `coordinationInput` 与 TaskRuntime 增加 `competition-context:v1` 摘要绑定和 host-only `CoordinationGoalTokenBudget`。可信同步计数只覆盖最终编译 goal，加宿主输出预留；Desktop 未配置已验证 tokenizer 时记为 unmeasured。字符上限仍为 16000 UTF-16 units；发送、凭据等待与恢复比较版本，新检查点由原逐事实父/子任务删除链路清理。无 wire capability、Schema、迁移或冻结范围变更。真实云调用 0，非作者评审及集成待完成；见 [ADR-0025](../adr/0025-competition-context-binding.md)。
以上三个上下文/预算工作包随 `origin/main@18ec9efe` 合入本分支；原日期、作者记录和验证边界保留。“评审及集成待完成”为当时状态，不覆盖后续 Git 合入事实；不据此增加 frozen 范围或真实服务验收。

## 2026-10-13 Competition 辅助模型原生思考配置（provisional）

[MOD-04A 首批架构落地](../modules/MOD-04A-NATIVE-REASONING-20261013.md) 沿现有 Runtime 工厂、ModelGateway 和 Desktop 加密配置增加 host-only `nativeReasoning`（开关、支持列表、固定强度、输出预算字段）。原生配置与步骤预算独立，恢复绑定配置版本与声明；参数拒绝先于凭据/网络。无新增 wire capability、Schema、数据库迁移或依赖，Core Runtime Profile 1 冻结范围不变。该原始交付阶段真实云调用 0，配置和离线测试不证明真实端点支持；后续已由 #350 合入 main，见上节。边界见 [ADR-0024](../adr/0024-competition-native-reasoning.md)。

## 2026-10-12 新版真实云场景登记（不提升冻结范围）

自有 ARM64 镜像源码 `194799c6979ed47d20dfd2d3ea17bbfd16f63fd6` 的未合并分支已取得真实 Huawei WSS → MaaS → 本地 Policy / 生产 workspace.read_text → Evidence → 云端续答证据，任务 succeeded，执行 1 次，Evidence 1 条，HTTPS 应用调用 0。重开 Runtime Application 后仅持久读回通过，不重放工具；真实云端 `/invocations/bindings?endpoint=Latest` 发现 8 Workflow / 3 Controller。详见 [验收记录](../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。

仅固定公开合成文件读取场景可记为真实验证，接口继续 provisional，Core Runtime Profile 1 冻结集合、wire 1.0.0 和候选 1.0 均不变；不能据此公布未注册能力或提升所有连接器/绑定的 verification。main 集成、完整自主修复、真实 Wiki、写入及平台 trace/评估仍待独立验收。下文旧日期 unavailable / 未验收条目是当时状态，不覆盖本增量，也不由本增量整体转为可用。

## 2026-10-12 镜像可执行绑定登记

`getOwnedBindings`、`OwnedAgentOrchestrator.invokeWorkflow/invokeController` 与受保护 `/bindings`
是 MOD-29/30/31 的镜像专用 provisional 增量，固定 8 Workflow/3 Controller；
绑定1.0.0信封通过现有 HTTP/WS query 消费，World/Plan报告与旧可执行结果隔离。
不进入 Core Runtime Profile 1 冻结集合，无数据库迁移，不扩 candidateVersion1.0。
目录和调用实现不等于真实 Provider、平台 Controller、账号工具或部署可用。
接口与验证边界见 [绑定接口](../competition/OWNED_IMAGE_BINDINGS.md)、[ADR-0015](../adr/0015-owned-workflow-controller-bindings.md)。

## 2026-10-09 自有镜像与 Wiki 状态补充

自有镜像实现 HTTP `/ping`、`/invocations`、WS `/ws` 和受保护 `/invocation-status`，复用 ModelGateway、Coordination 动态工具目录/继续轮次/修复候选；精确接口见 [镜像接口](../competition/OWNED_IMAGE_INTERFACES.md)。传输0.1.0为独立provisional契约，不扩展本地wire冻结集合。本地check与合成容器证据不能提升真实云状态，真实AgentArts仍unavailable。

WSS主通道、显式HTTPS备用、同会话复用、发送前持久身份与未知防重发已在本分支接线；公开网关路径、真实调用及自动status恢复消费者尚未验收/交付，不能公布生产capability。Wiki自动同步仍是设计：来源适配/Memory投影由goo122在MOD-08/09发布，复用既有公开端口；真实Wiki/云端出机与端到端失效传播另验收。

知识受控写入和固定 MCP/Skills已有受限增量，以当前公开源码/README为准；本文较旧历史矩阵不能抹去这些增量，也不能据存在代码冻结整个模块。合并确认是开发规则，不成为产品运行时授权或接口冻结证据。

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-15）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。每个 PR 需 goo122、zemeng5208、Potatos498 中任意一位非作者对当前提交的有效批准，并满足必要检查、冲突及未解决意见门槛；三人跨 PR 均衡承担评审与合并，禁止强制合并或管理员绕过。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

2026-10-11 [MOD-08O](../modules/MOD-08O-PAIRED-CITATION-MEMORY-01.md) 在 PR #322 上继续：
peer 可选 readCitation、桥接版本 2（PA2，旧 PA1 仅检索）与 Runtime `wikiSource.acquireWiki`。
TrustedKnowledgeSource 的读取租约可选提供既有 ReadOnlyPageVaultPort.readPage；缺少稳定页
身份或引用能力时记忆来源 unavailable。接入原 WikiSource/逐条确认，不增加 task wire
capability、迁移或依赖。接口保持 provisional，未完成真实用户/云端或主线集成验收；
方案见 [ADR-0021](../adr/0021-paired-citation-memory.md)。

2026-10-11 [PR #322](https://github.com/zemeng5208/PersonalAgent/pull/322) 已交付、待非作者评审/集成：[MOD-08M](../modules/MOD-08M-UNICODE-PAIRING-01.md)
新增 `@personal-agent/knowledge/pairing` 与 Runtime Application `createObsidianPairingHost`。
它们是 **host-only provisional** 组合端口，复用既有 KnowledgePort 和工具/Policy 链，
不新增 task wire operation、数据库迁移或云 capability。后续本地增量
[MOD-08N](../modules/MOD-08N-AUTHENTICATED-BRIDGE-01.md) 增加公开
`@personal-agent/knowledge/bridge` 的版本 1 回环 TLS 指纹/一次性密钥消息协议及原生配对窗口，
仅私人只读检索，仍 **provisional**；下方知识模块的完整可用性不提升为 frozen。方案见
[ADR-0020](../adr/0020-obsidian-authenticated-bridge.md) 与
[ADR-0019](../adr/0019-obsidian-runtime-pairing.md)。

版本：1.3 · 日期：2026-09-27 · 基线提交：`9c40a0853b8db9e05e91c978e35d8e1a40788b39`

协议负责人：`goo122` · 核心认知与 AgentArts 消费负责人：`zemeng` · 连接器消费负责人：`Potatos498`（2026-10-07 三人独立交付重置）

2026-10-07 协作规则修订：接口变更由实施者提供契约、兼容说明、自审和消费验证；不以指定协作者的 PR 批准为冻结或交付门槛。本文历史的非作者评审记录保留为事实，不再构成新工作的人员等待条件。

## 1. 目的

2026-10-08 自有云端镜像工作包（[记录](../modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md)）：
新编排包复用既有 ModelPort/Coordination 应用 JSON；HTTP 受信可选头 `X-PA-Deadline` 传递原期限，旧平台可忽略。
普通 confirmed 续答仅在含 repairContext 时进入修复提示；Schema 和冻结集合未改变。
本地 HTTP/Fake/文件验证不提升 AgentArts 真实 deployment、trace、评估或整链冻结状态。

本文是当前跨模块接口的唯一状态登记。它回答四个不同问题：

1. 接口形状是否已经冻结；
2. 本地生产实现是否存在并在握手中公布；
3. Fake、单元测试或真实外部服务分别验证了什么；
4. 尚未提供的能力应如何被消费者处理。

**冻结只承诺列出的接口形状和语义保持兼容，不代表盘古、AgentArts、第三方账号、语音或 Windows 执行已经可用。** Schema 中出现但生产 Runtime 未公布的 operation 一律按 `unavailable` 处理。

当前产品部署优先级由[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)定义：只实施 `huawei_ict_agentarts` 比赛主路径，`local` 作为可选保留。这里的 **Core Runtime Profile 1 是接口冻结集合**，不是部署 profile；两者不能混同。Competition 架构已接受不代表 AgentArts 能力已可用或接口已冻结。

### 1.1 部署 profile 状态

| 部署 profile | 优先级 | 当前能力 | 接口规则 |
| --- | --- | --- | --- |
| `huawei_ict_agentarts` | 当前唯一优先实现与比赛验收路径 | 架构 accepted；接口 `provisional`；#317 分支真实 WSS 文件读取闭环已验证，main 和其余场景未完成 | 只在明确已部署配置中使用上述场景；不静默回退，不扩大冻结集合 |
| `local` | 可选保留 | 现有 Agent/Model 部分实现为 `provisional` | 不删除既有代码；新增 Local 能力不阻塞 Competition，也不计入比赛验收 |

## 2. 状态定义与冻结门槛

### DEV-WORKFLOWS 开发增量（2026-10-03）

历史上 PR #276 的 MOD-33/34/36/38 Local Profile 增量由 zemeng 启动；2026-10-07 最新分工为 goo122 负责 MOD-33/36/37，Potatos498 负责 MOD-34/35/38，接口范围和历史证据不因交接改变。
公开 `@personal-agent/github`、`@personal-agent/coding-tools` 的开发修复与受控 Git 工厂、
`@personal-agent/cognition` 的 Review/Issue 工厂以及 `@personal-agent/runtime/dev-workflows`
新组合入口。精确输入输出以各包公开 exports 为单一来源，状态 **provisional / 待真实宿主闭环验证**；
不新增 wire operation，不更改 Competition 默认组合或冻结矩阵。

所有 GitHub/工作区/Git 工具经既有 Runtime / Policy / ToolGateway，缺宿主注册或配置返回
不支持；未知写入等待原执行核实，模型不能生成授权或验证回执。Windows Foundation 验证构建和
类型，Fake 测试覆盖受控工具路径；真实 GitHub 写入读回和普通 Windows 主机上的完整修复闭环仍未验收，
因此保持 provisional。模块与文件所有权、集中验证交接见
[本轮交接](../modules/DEV-WORKFLOWS-HANDOFF-20261003.md)。

### MOD-30-WORKFLOW-INPUT-01 开发增量

`AgentArtsRuntimeConfig` 和可信 Runtime 工厂新增可选 `workflowGoalInput`，将适配器构造的
请求文本映射为一个 Workflow 开始变量的 `inputs`；未配置继续使用智能体 `query`。此选项是
provisional 进程内配置，不是 wire operation、完整多输入映射或云端可用性证明。适配器与
工厂合成验证不冻结 CloudAgentPort，也不证明工具提案/恢复或真实 Workflow 接通。详见
[工作包与官方依据](../modules/MOD-30-WORKFLOW-INPUT-01.md)。

### 事实变化消费开发增量

2026-10-06 管理补修：SQLite host-only `listUserFactHeads` 通过现有受信私人管理入口
列出当前 user-confirmed/private 头，包含撤回及过期记录，以便重启后仍能精确删除历史。
复用已有有界快照分页，和消费查询 token 隔离；不扩展 `MemoryQueryPort` 或 wire capability，
不授予消费/出机权限，无迁移。增量待非作者评审，状态仍为 provisional。

PR #89～#91 已合入 provisional 的 `MemoryQueryPort`、`FactChangeFeedPort`、批次解析、
Fake、SQLite 提供者与可恢复投影。它区分 query snapshot、feed 水位、消费 checkpoint
和 graphRevision；读者不能任意 ack 序号。离线持久实现不证明真实事实来源或生产自动消费，
不得新增 wire capability 或宣称 frozen。详见
[MOD-28-FACT-CHANGE-FEED-01](../modules/MOD-28-FACT-CHANGE-FEED-01.md)。

| 状态 | 含义 | 消费者规则 |
| --- | --- | --- |
| `frozen` | 单一来源、实现、Fake/失败夹具、消费端验证、负责人自审和 CI 均有证据；外部行为会改变语义时还需真实目标验证 | 可以并行开发；同一主版本内只做向后兼容扩展 |
| `provisional` | 已有部分类型或实现，但仍缺消费验证、完整语义、真实关键路径或稳定注入边界 | 只用于受控开发；不得据此形成不可逆依赖 |
| `unavailable` | 没有生产提供者、没有能力公布，或关键接口尚未定义 | UI 显示不可用；调用返回 `UNSUPPORTED_CAPABILITY`；不得静默回退 Fake |
| `deprecated` | 已有替代接口并处于迁移期 | 只维持登记的兼容窗口，不新增消费者 |

冻结检查表：

- [x] JSON Schema 或公开 TypeScript 类型有单一来源；生成产物一致。
- [x] 对应生产实现存在并只公布实际支持的 capability。
- [x] Fake 和关键错误/取消/冲突路径可重复运行。
- [x] 至少一个真实消费端通过公开入口使用，没有读取私有数据库或 checkpoint。
- [x] 非作者评审与 CI 已通过，冻结基线可定位到提交。
- [ ] 对依赖外部平台且外部行为会影响接口语义的能力，完成真实目标系统闭环。

最后一项只适用于盘古工具调用、AgentArts、真实连接器、语音、Windows 操作等外部能力。它目前没有满足，因此这些能力不进入冻结集合。

## 3. 已冻结：Core Runtime Profile 1

冻结基线由 PR #1 的公共协议实现和 PR #34 的查询/恢复接口共同形成。PR #34 的精确实现提交为 `e5e20cad16566c6bdf821b7880efad96f0513ef1`，已由 `zemeng` 非作者批准，Foundation CI 通过并合并。PR #31 的 Runtime-owned 模型上下文也已合并，但它是内部编排策略，不属于本 profile 的冻结承诺。

### 3.1 消息与错误

| 接口 | 单一来源 | 冻结内容 | 运行时状态 |
| --- | --- | --- | --- |
| `Request` / `Response` / `Event` 信封 | `packages/contracts/schema/protocol.json` | `protocolVersion`、关联 ID、deadline、operation、结构化 data/error、`evidenceRefs` | `frozen` / 可用 |
| wire 主版本 | `PROTOCOL_VERSION = "1.0.0"` | 主版本不兼容拒绝；新增 operation 必须经能力发现 | `frozen` / 可用 |
| JSONL 帧 | `encodeFrame` / `FrameDecoder` | UTF-8、LF 分帧、最大 1 MiB、残帧拒绝 | `frozen` / 可用；不代表 Named Pipe 已实现 |
| 公共错误码 | contracts `Error.code` | 输入、版本、授权、范围、缺失、不支持、冲突、限流、超时、外部失败、结果未知、游标失效和取消的区分 | `frozen` / 可用 |

这里只冻结三类信封的公共字段和本 profile 所列 operation 的 payload/result；不把九类 Event 的所有业务 payload 或任何未公布 operation 一并冻结。错误码登记被冻结，但某个 capability 是否会产生特定错误仍由该 capability 的状态决定。

### 3.2 任务、会话和审批只读面

| operation | 冻结请求/结果 | 提供证据 | 可用性 |
| --- | --- | --- | --- |
| `system.handshake` | `supportedMajor`、客户端能力 → 协议版本、实际 capabilities、sessionRef | Runtime、Client、Fake、桌面 | 可用 |
| `task.submit` | goal、conversationId、附件引用、幂等键 → taskId/state/revision | Runtime 持久实现、Client/Fake | 可用 |
| `task.get` | taskId → TaskSnapshot | Runtime、Client/Fake | 可用 |
| `task.list` | conversationId/states/分页/固定水位 → 任务页 | PR #34 Runtime、Fake、Desktop 恢复 | 可用 |
| `conversation.list` | conversationId/分页/固定水位 → 会话及完整任务历史 | PR #34 Runtime、Fake、Desktop 恢复 | 可用 |
| `approval.list` | approvalId/taskId/state/分页 → 脱敏审批快照 | PR #34 Runtime、Fake、Desktop；不返回原始参数 | 可用；无工具审批时为空 |
| `task.cancel` | taskId/reason → cancelAccepted 与当前状态 | Runtime、Client/Fake | 可用；受理不等于已停止 |

冻结的 `TaskSnapshot` 基础字段为 taskId、state、revision、updatedAt、steps、evidenceRefs，以及当前可选的 goal、conversationId、attachmentRefs、resultSummary、error、cancelRequested。后续增加结构化结果只能作为兼容扩展；在新字段可用前，消费者不得解析 `resultSummary` 中的模型元数据尾缀形成新协议。

`task.list` 和 `conversation.list` 首次读取取得 `snapshotSequence`，续页保持同一水位，快照完成后从该水位读取任务事件。审批参数只暴露摘要哈希和固定的 `argumentSummary: "redacted"`。

### 3.3 全部 17 个 operation 状态矩阵

| operation | 契约状态 | 基础 Runtime 公布 | 条件公布 / 当前处理 |
| --- | --- | --- | --- |
| `system.handshake` | `frozen` | 是 | 返回实际 capability，不按 Schema 推测 |
| `task.submit` | `frozen` | 是 | 成功仅表示受理，自动分派由 Runtime Application 管理 |
| `task.get` | `frozen` | 是 | 返回持久 TaskSnapshot |
| `task.list` | `frozen` | 是 | 固定水位分页 |
| `conversation.list` | `frozen` | 是 | 固定水位分页；不是模型上下文策略 |
| `approval.list` | `frozen` | 是 | 返回持久脱敏记录；是否配置 ToolGateway 不改变只读查询能力 |
| `task.cancel` | `frozen` | 是 | `cancelAccepted` 不等于执行已停止 |
| `event.subscribe` | `provisional` | 是 | 需配合进程内 `readEvents`；完整生命周期未冻结 |
| `capability.list` | `provisional` | 否 | 仅配置 ToolGateway 时公布 |
| `authorization.respond` | `provisional` | 否 | 仅配置 ToolGateway 时公布 |
| `tool.invoke` | `provisional` | 否 | 仅配置 ToolGateway 时公布；真实模型工具链未验收 |
| `settings.get` | `unavailable` | 否 | Schema/Fake 已有；生产返回 `UNSUPPORTED_CAPABILITY` |
| `settings.update` | `unavailable` | 否 | Schema/Fake 已有；生产返回 `UNSUPPORTED_CAPABILITY` |
| `connector.connect` | `unavailable` | 否 | ConnectorHost 存在但未接 wire 路由 |
| `connector.disconnect` | `unavailable` | 否 | ConnectorHost 内部参数与 wire 账号语义尚未统一 |
| `voice.start` | `unavailable` | 否 | 只有 Schema；无 VoicePort 或生产提供者 |
| `voice.stop` | `unavailable` | 否 | 只有 Schema；“停止播报”不能替代 `task.cancel` |

### 3.4 九类事件状态矩阵

| event type | payload / 生产者状态 | 传输状态 |
| --- | --- | --- |
| `task.created` | Core Runtime payload `frozen` / 可产生 | `event.subscribe` 与 `readEvents` 仍为 `provisional` |
| `task.state_changed` | Core Runtime payload `frozen` / 可产生 | 同上 |
| `task.progress` | Core Runtime payload `frozen` / 可产生 | 同上 |
| `task.completed` | Core Runtime payload `frozen` / 可产生 | 同上 |
| `task.failed` | Core Runtime payload `frozen` / 可产生 | 同上 |
| `task.cancelled` | Core Runtime payload `frozen` / 可产生 | 同上 |
| `approval.requested` | `provisional` / 仅工具装配路径 | 同上 |
| `tool.completed` | `provisional` / 仅工具装配路径 | 同上 |
| `notification.created` | `unavailable` / 当前无生产通知模块 | 同上；不能因 Schema 存在显示为已接通 |

### 3.5 冻结范围之外

Core Runtime Profile 1 **不包含**模型工具调用、工具执行、持续授权、Evidence 内容、Artifact、设置管理、连接器账号、语音、MCP、Skills、知识/记忆、Windows Host、AgentArts 或打包生命周期。它们不得借用 wire 1.0.0 的版本号宣称已经冻结。

## 4. 已实现但尚未冻结

| 接口或实现 | 当前证据 | 未满足门槛 | 状态 |
| --- | --- | --- | --- |
| `event.subscribe`、`RuntimeApplication.readEvents`、Client `EventCursor` | 本地顺序、去重、缺口检测和桌面恢复测试 | 无 unsubscribe；服务端不裁剪事件，尚不产生真实 `CURSOR_EXPIRED`；未来跨进程通道未冻结 | `provisional` |
| `RuntimeApplicationTransport.send`、`activeTaskCount`、`close`、模型配置入口 | 进程内 Runtime Application 与 Desktop smoke | Host 健康/关闭/升级/未结束等待任务语义不完整 | `provisional` |
| `RuntimeApplication.submitHostToolTask`、`readHostToolTask` | DEP01 可信宿主单工具任务、SQLite checkpoint、既有审批/Policy/ToolGateway 恢复及定向测试 | 仅限宿主注入；Goal/Windows 等具体生产工具与 Desktop 消费、真实写入读回和非作者评审尚未完成；不公布新 wire capability | `provisional` |
| `authorization.respond` | SQLite 审批、revision、一次性授权、恢复测试 | 真实模型提出工具请求的闭环未验证；持续授权未实现 | `provisional` |
| `capability.list`、`tool.invoke` | ToolGateway、Policy、Runtime、Fake 工具闭环 | 真实盘古工具提案与真实工具读回未执行；核实入口不完整 | `provisional` |
| `RuntimeApplication.prepareCompetitionToolCatalog`、`assertCompetitionToolCatalogAllowed` | DEP05 按任务选择已注册 ToolDescriptor、显式结果出口和宿主动态可用性，持久绑定精简 Schema 并在提案前复核；写工具仍走本地 Policy 审批与结果核实 | AgentArts 初始目录载荷由 MOD-04B/30 另行接线与真实发布验收；目录本身不授予执行或外发结果权限 | `provisional` |
| `workspace.stage_text_patch`、`workspace.apply_text_patch` | PR #133/#147 已合入；Policy/ToolGateway 授权和合成工作区测试通过，合并后 Windows PowerShell 7 全仓检查中 coding-tools 33/33 通过、0 跳过 | #147 合并前缺非作者批准评审；未在 Runtime/Desktop 生产组合注册；恢复目录 ACL、写中崩溃对账、真实用户工作区与 AgentArts 工具闭环未验收 | `provisional` |
| `ToolDescriptor`、`RegisteredTool`、`ToolContext`、`ToolHost` | contracts 类型、FakeToolHost、生产 ToolGateway | Windows/MCP/Skill/第三方写工具尚未作为独立消费者验证 | `provisional` |
| Windows Host 内部 Pipe 帧 `0.1.0` 与 Runtime Notepad adapter | [独立 Schema 与关联校验](WINDOWS_HOST_CONTRACT.md)，受信 `RegisteredTool` 通过 ToolGateway/Policy 接入，运行身份先写入 Runtime create-only checkpoint，断线只查询状态；原生桥核对 Pipe 服务端 PID，Host `verified` 源自同一目标的 UIA 写后读回，Runtime 关联回执并记录执行 Evidence | MOD16 独立短链已真实核验 PID 与 hello；Node/Bridge 组合、正式 Desktop、bind/observe、真实记事本 UIA 与完成状态读回仍待验收；未改公共 wire 1.0.0 | `provisional` 契约；执行能力 `unavailable` |
| `PolicyPort`、`AuthorizationPolicy` | 参数摘要、任务/工具/scope/期限/次数绑定及 SQLite 事务测试 | 跨任务持续授权、撤销管理面和真实宿主消费未完成 | `provisional` |
| `ModelProvider`、`ModelGateway`、Agent 执行循环 | Fake Provider、Mock fetch、离线 Agent/工具测试 | Agent 依赖具体 `ModelGateway`；真实盘古工具调用未通过 | `provisional` |
| `StructuredToolProvider` | 严格 JSON 解析、工具名/版本/参数校验单测 | 只是文字 JSON 提案适配器；没有真实盘古闭环，不是原生 function calling | `provisional` |
| `ConnectorPort`、`ConnectorHost`、`SecretStorePort.read` | 类型、FakeConnector、宿主单测 | 账号会话未持久化；wire connect/disconnect 未接 Runtime；无真实账号 | `provisional` |
| `StoragePort` | contracts 类型、FakeStorage | 只有同步 get/set/delete；没有 revision、事务、容量和失败语义 | `provisional` |
| `CoordinationPort`、`CloudAgentPort`、Competition Runtime/工具循环 | PR #36、#49：Fake、审批恢复和 continuation 离线循环 | Workflow 输入 #72 与载荷边界 #80 尚未进入 main；真实 deployment/version/trace、成功云 API、MCP/Skill 和目标系统读回未验证 | `provisional` |
| `createSqliteFactProjectionHost`、`RuntimeApplication.createCompetitionFactHost`、`SqliteMemoryHost.withdrawPublicSource` | DEP02 将固定 public feed/query/确认和 Runtime 持久投影组合；PR #177 已将 Application 宿主工厂合入 main，管理独立 Memory SQLite，来源修订/撤回以 CAS 写入幂等 Fact 变化事件 | #177 合并前缺非作者批准评审；受信来源读回、生产触发/生命周期、真实来源撤回证明和完整目标系统读回仍待 Desktop 接线验证；不作为 Runtime wire capability | `provisional` |
| NotificationService | PR #27、#81：持久批次、ack、DST、摘要与毫秒窗口测试 | 无 Runtime wire 查询、Desktop 展示和真实通知通道 | `provisional` |

这些接口可以继续迭代，但消费者必须固定精确包版本或提交，并准备迁移；不能称为“冻结接口”。

## 5. 当前不可用接口与能力

下表中的条目可能已经在 Schema、设计文档或 UI 中出现，但当前没有满足要求的生产提供者。状态统一为 `unavailable`。

| 分组 | 不可用接口或能力 | 缺口 / 解锁条件 | 负责人 |
| --- | --- | --- | --- |
| 模型 | 盘古原生 function calling | Pangu Provider 明确声明 `toolCalling=false`；需真实部署能力探测和闭环验收 | MOD-04A `goo122` |
| 模型 | 盘古文字 JSON 工具提案的真实闭环 | 手动脚本默认 SKIPPED；需真实盘古→提案→审批→工具→读回→回答证据 | MOD-04A/04B |
| 模型 | 流式、视觉、稳定结构化输出 | 当前 Pangu Provider 均声明不支持 | MOD-04A `goo122` |
| Agent | 真实 AgentArts deployment/version/trace 与多 Agent 结果 | provisional Competition 适配和 Fake 已集成；真实云端成功路径、结果解析和完整 trace 未验收 | MOD-29～32 `zemeng` |
| 结果 | 结构化 `TaskResult` | 当前仅 `resultSummary` 字符串；需正文、模型、usage、verification、plan/evidence 分离 | MOD-02/03 `goo122` |
| 会话 | 显式创建、重命名、归档、删除、重试关联 | 当前只有 `task.submit` 携带 conversationId 和只读列表 | MOD-02/03 `goo122` |
| 调度 | 循环规则、唤醒计时器、睡眠恢复公共 API | Runtime 只有内部一次性调度，没有 wire operation | MOD-03 `goo122` |
| Evidence / 授权撤销 | 公开 list/get/content、提交与 revoke 端口 | 新增 provisional 宿主 `ScopedEvidenceReader` 元数据 list/get 与 `revokeHostAuthorization`，逐次要求宿主鉴权、核对持久审批并读回 grant 删除；Runtime 仍无主体 ACL、wire operation、内容读取或提交端口，生产宿主鉴权来源未接入 | MOD-03/05 `goo122` |
| Artifact | 创建、读取、过期、释放、分片和背压 | 仅有 attachment/artifact 引用原则，没有服务和 Fake | MOD-01/02/05 `goo122` |
| 设置 | 生产 `settings.get` / `settings.update` | Schema 和 Fake 存在；生产 Runtime 不公布也不处理 | MOD-02/03 `goo122` |
| 连接器 | 生产 `connector.connect` / `connector.disconnect` wire 路由 | Schema 与 ConnectorHost 存在，但 Runtime 未公布/分派，账号语义不一致 | MOD-05 `goo122` |
| 凭据 | SecretStore save/replace/delete/status 与迁移 | 只有 ConnectorHost 私有 read 端口；无公共管理面或 Windows 适配 | MOD-05 `goo122`、MOD-16 `zemeng` |
| 通知 | Runtime 列表/恢复、已读/隐藏、策略配置与 Desktop 展示 | NotificationService 已集成但尚未接 wire 或 Desktop；`notification.created` 仍无生产发布链 | MOD-23 `Potatos498`、MOD-13 `zemeng` |
| 语音 | `voice.start` / `voice.stop`、ASR/TTS 流和设备适配 | session/wake/transcript consumer 仍在冲突的堆叠分支，main 无生产提供者；真实供应商、流协议和设备验收未提供 | MOD-14/15 `zemeng` |
| 知识 | `KnowledgePort`、Obsidian/LLM Wiki | PR #93～#95、#97、#98 已合并：provisional KnowledgePort、只读 Vault、Policy 检索工具及公开资料 Fake Competition 链。[MOD-08G](../modules/MOD-08G-WIKI-SOURCE-REVISIONS-01.md)/[08H](../modules/MOD-08H-WIKI-MEMORY-PROJECTION-01.md)/[08I](../modules/MOD-08I-WIKI-WRITE-RECOVERY-01.md) 在 [PR #320](https://github.com/zemeng5208/PersonalAgent/pull/320) 提供 WikiPort、稳定来源引用、revalidateWikiFact 与 host-only 写回投影恢复；本机完整 check 通过，尚未评审/集成。[MOD-08J](../modules/MOD-08J-WIKI-SOURCE-MONITOR-01.md) 新增 host-only createWikiSourceMonitor、状态和批量 revalidateSources，沿用现有 tick 驱动只读来源检查；专项及真实合成 Electron 后台链路通过，完整门禁见工作包，已在 [PR #321](https://github.com/zemeng5208/PersonalAgent/pull/321) 堆叠交付，待评审/集成。仍 provisional，无新 wire capability。[MOD-08K](../modules/MOD-08K-BACKUPS-INDEX-PLUGIN-01.md) 通过 PR #321 提供应用 SQLite 备份协调、clearIndex 和临时全文索引及只读插件包；host-only provisional。[MOD-08L](../modules/MOD-08L-OBSIDIAN-INSTALLATION-01.md) 修复真实宿主相对 require，补齐显式安装/卸载，Obsidian 1.12.7 合成 Vault 验收通过；仍无新 wire 端口。整篇笔记备份保留并报告 pending；持久索引、插件 Runtime 配对、跨库投影、真实云消费与完整 LLM Wiki 仍 unavailable | MOD-08/09 `goo122` |
| 记忆 | 生产 `MemoryQueryPort` / `FactChangeFeed` 提供者、确认消费、修正/删除 | PR #89、#90、#91 已合并 provisional 端口、Fake、SQLite 恢复与确认后原子激活投影；DEP02 仅新增可信组合和显式撤回版本，生产 Runtime capability、自动触发、真实来源及撤回证明仍未提供 | MOD-09 `goo122` |
| MCP | 任意服务自动注册、OAuth、写工具及真实平台/真人完整验收 | main 已有固定官方只读 stdio；G10/G11/G14 分支有固定远程绑定、safeStorage、独立管理/生产注册和原 Runtime 审批读回；实际 Electron 验证与原生合成响应分开记录。独立 TLS 检查 5/5；新增 [Desktop/TLS 组合](../modules/MOD-06-PRODUCT-TLS-20261016.md) 用默认 fetch、进程专属 CA、实际 Electron/安全存储/SQLite，成功链路及四类证书/主机/目录/重定向拒绝通过。长驻 run 身份上限 64、重连不重置，修复已随 #369 普通推送并传递至 #373；服务/凭据仍合成，未验证第三方身份、OAuth/云出口，均 provisional，未宣称进入 main | MOD-06 `goo122` |
| Skills | 任意脚本引擎及真实云端使用 | main 已有 packages/skills 固定参考摘要；本机 SKILL.md 安装、资源本地预览和 Competition 使用增量在未合并 [PR #318](https://github.com/zemeng5208/PersonalAgent/pull/318)，见 [安装记录](../modules/MOD-07-LOCAL-INSTALLATION-20261009.md)，不冻结；原生完整安装、任意脚本与真实云验收未提供 | MOD-07 `goo122` |
| 决策 | 目标/事实/决策图谱的生产集成 | main 已有版本图及 SQLite/Fake 原子 `appendBatch`；自动事实投影、真实事实来源与生产消费未完成 | MOD-27 `zemeng`，存储 `goo122` |
| 认知 | 事件驱动的完整计划修复 | main 已有离线影响分析与显式修复预览/提交，并通过原子 `appendBatch` 写入；事实变化流、自动投影和真实 Evidence 未完成 | MOD-28 `zemeng` |
| AgentArts | Competition Profile 的真实身份、Agent/Workflow、MaaS/模型、知识、MCP/Skill、工具提案与多 Agent | main 已有 provisional adapter 和离线工具循环；Workflow 输入仍在堆叠分支，没有成功 deployment/API/trace 与真实 MCP/Skill 读回 | MOD-29～31 `zemeng` |
| AgentArts | Competition 发布、API、trace、评估、成本、回滚和端到端证据 | 无云资源读回、本地 Policy/ToolGateway 闭环或 profile 防静默回退证据 | MOD-32 `zemeng` |
| Windows | Named Pipe、DesktopActionPort、资源锁、用户接管 | 内部帧契约为 provisional；Host/Client 生产接线与真实应用验收未提供 | MOD-16 `zemeng` |
| TraceGuard | 公开工具和 Evidence/恢复端口 | 仓库适配 package 未提供 | MOD-17 `zemeng` |
| 编程 | 正文读取、patch、command、artifact 端口 | PR #83 已集成受限 `workspace.list` 与 `workspace.read_text`；两者仍为 provisional，patch、command、artifact 和完整隔离验收未提供 | MOD-18 `zemeng` |
| 分发 | 生产装配、安装、升级、卸载生命周期契约 | 无安装包与隔离安装证据 | MOD-19 `zemeng`、根装配 `goo122` |

生产 Runtime 对 Schema 已知但未公布的 operation 必须返回 `UNSUPPORTED_CAPABILITY`。管理界面可以展示规划项，但必须显示“不可用”，不能通过读取配置文件、私有数据库或启用 Fake 来伪装能力。

## 6. 已集成增量与下一冻结包

### 6.1 Competition 执行面（provisional）

PR #36、#49 已进入 main，提供文字 Coordination/CloudAgent 与 Runtime 审批工具循环。Workflow 输入 #72 和总载荷边界 #80 只合并到堆叠分支，尚未进入 main。现有 Fake 证据不包含成功真实 AgentArts 调用、deployment/version/trace、MCP/Skill 或目标系统读回。

### 6.2 世界状态与认知面（provisional）

main 已包含版本化 CoordinationStore、SQLite/Fake `AtomicCoordinationStorePort.appendBatch`、事务 revision 校验与 rollback，以及通过该原子端口执行的显式修复预览/提交；PR #89～#91 已合并 provisional Memory 端口/Fake、SQLite 查询与 delivery checkpoint、Goal 侧未生效暂存及确认后原子激活投影。生产自动消费、真实事实来源、删除和 AgentArts/Evidence 闭环仍未交付。

堆叠 PR #203 的 MOD-09G 增加受信宿主的删除发起、预检和恢复路径；`MemoryQueryErrorCode`
增补 `STORAGE_UNAVAILABLE` 表示 WAL 截断未完成。无 wire operation/capability，
Goal 稀疏 revision 仍需公开语义说明与消费契约验证，Memory/Goal/Runtime 均不因此冻结。

MOD-09H 继续在可信 `SqliteMemoryHost` 增加 `reviseUserFact` 与迁移 4：用户确认的更正或
撤回通过精确头版本和操作 ID 在同一事务写入事实、feed 事件及无正文回执；重试幂等，
来源拥有权冲突及待删除事实拒绝。它未注册 Desktop/wire capability，也不承担用户认证与
授权校验；真实私人来源和用户侧验收仍 `unavailable`。

MOD-09I 新增 `@personal-agent/learning` 的受信 SQLite 宿主：描述性候选版本、注入式验证、
验证通过后启用、旧已验证版本回退及工作流历史删除。该 API 为 `provisional`，
验证器和授权入口尚无生产装配；不暴露执行工具或 wire capability，也不等同 AgentArts Workflow。

MOD-09J 在受信宿主增加单条私人 Vault 引文的确认写入桥接，以及 Memory 迁移 5 的首次事实
创建回执。拒绝确认不写入；确认后只写 `private`、`user_confirmed` 事实，更正仍走精确头版本。
接口保持 `provisional`：正式 Competition 装配已有逐条原生确认、精确事实版本、逐任务许可与
最终发送检查；真实用户确认持久写入、生产身份及真实私人数据出机仍未完成验收。
真实 Vault 的只读检索不等于已确认持久写入。

MOD-09K 为 Desktop Competition 管理后台增加本机会话 Vault 选择和只读搜索；
原生确认及独立私人 Memory SQLite 写入由实际副本清单和删除准备状态控制；
清单未知、未接通副本或维护失败时拒绝写入。此本机管理入口为 `provisional`，并非 Runtime
wire capability；私人事实不进入当前仅公开敏感级别的 Goal 投影。AgentArts 消费另需精确任务、
事实版本和原生出机许可，保存本身不授予发送权限。真实 Vault 已验证只读检索、引文读回与
版本匹配；真实用户确认持久写入、原生完整生命周期及真实云消费仍未验收。

MOD-09L 为独立 Desktop 私人库增加分页列出已保存当前事实和原生逐条确认删除。
受信宿主按当前 revision 清除全部历史与受影响快照，WAL 截断后读回；合成数据验证旧
版本、旧快照不可读且无关事实保留。该入口不接入 Runtime 公共事实或 Vault 原文件删除；
私人写入仍受实际副本及删除准备门禁限制；关联 Runtime 副本通过原绑定、精确清除收据及
pending 重启恢复接线。#284 的同步门禁修复及实际 Runtime/Memory SQLite 父/子副本删除、无关事实
保留与恢复不重复发送的合成回归已通过 #285 非作者评审进入 main；真人全链路仍未验收。
私人 Memory 源库尚无生产 backup/restore 调用路径；外部独立副本与已发送正文不在本机清除保证内。

后续本地验收包 `memory-learning-mcp.test.mjs` 使用实际官方 filesystem stdio、Client 与 SQLite
Runtime 审批验证固定 Skill 学习、版本回滚、重启及流程删除；原生启用/删除回调为显式 Fake。
内部学习错误通过现有任务快照 Schema 校验后记录；契约未登记的码映射为 `EXTERNAL_FAILURE`，
不扩展公共错误码、权限或接口冻结范围，真实私人来源及云端验收仍未完成。

MOD-09M 在 Memory 受信 SQLite 宿主增加已提交删除回执的重启维护：若目标行仍存则拒绝，
否则重试 WAL 截断。Desktop 私人控制器在首次读取及提交后失败的后续操作前执行该检查。
合成旧读者测试验证恢复前拒绝、释放后完成且无关事实保留；不处理应用管理备份或
Runtime 公共事实的 `pending` 跨库对账。

### MOD-20B-CALENDAR-P5-PROJECTION-01 登记契约（2026-09-30）

P1 日历连接器与 P5 认知之间的投影消费契约固定为
[P1-CALENDAR-P5-PROJECTION.md](P1-CALENDAR-P5-PROJECTION.md)：P1 只提供版本化条目
（`dedupeKey` 携带 `sequence` 即 sourceRevision）与单条读回；**取消必须走单条
`getEventItem`**（列表路径过滤 cancelled）；`MeetingRescheduleEvent` 的生成是 P5 的投影职责。
含对 Issue #212 答复的更正：CalDAV 记录的 `timeZone` 是事件原始 TZID（订阅源才是恒 UTC）。
该契约为 `provisional`，升格冻结需 P1/P5 双侧消费契约验证、兼容说明、自审及 CI 证据。

### MOD-22B-MAIL-P5-PAGINATION-01 登记契约（2026-09-30）

P1 邮件连接器与 P5 邮件分类之间的分页与身份映射契约固定为
[P1-MAIL-P5-PAGINATION.md](P1-MAIL-P5-PAGINATION.md)：P5 分类输入
`{source, messageId, sourceRevision, text}` 分别映射 `accountRef`、`externalId`（`folder:uid`，
与 RFC `Message-ID`、裸 IMAP UID 三种身份不混用）、`String(uidValidity)`（epoch 修订）与
`contentRef` 信头投影（不含私人正文，4000 字符上限）。游标 `"{uidValidity}:{lastUid}"` 双向映射；
epoch 轮换抛 `CURSOR_EXPIRED` 且消费侧必须从头重建，不复用旧断点；`send` 为外部副作用
（unknown 先核对、同幂等键不盲重发）。2026-09-30 新授权码下 IMAP 只读读回复跑 23 项、22 过、1 跳过（SMTP 发送门控未开启）；
SMTP 尚未用新凭据复验，`verification` 仍为 `conditional`。该契约为 `provisional`，升格冻结需 P1/P5 双侧消费契约验证、兼容说明、自审及 CI 证据。

### 6.3 桌面、语音、工具与通知增量（provisional）

PR #54、#77、#81 已进入 main，分别补充取消受理、过期审批展示和通知时间精度；PR #83 已集成受限 `workspace.list` 与 `workspace.read_text`。旧 #63、#65 已关闭且未直接进入 main；语音/唤醒、转写消费和合成语音记录仍只存在于 #61 及其堆叠分支。

### 6.4 下一冻结候选

PR #84 已将这条离线 Competition 消费链合入 main：Runtime → Fake AgentArts → `workspace.read_text` proposal → waiting_approval → allow_once → ToolGateway → continuation → 最终回答/Evidence。该链仍保持 provisional/mock；只有真实 AgentArts 部署/API/trace 与目标系统读回完成，才重新评估相关外部语义。

| 待交付接口 | 语义提出方 | 公共类型/宿主提供方 | 下一验收 |
| --- | --- | --- | --- |
| Competition 工具消费链 | `zemeng` | `goo122` 维护 Runtime/Policy/Tool 边界 | PR #84 与 #86 已进入 main；离线 Fake 链保持 provisional，真实 AgentArts 验收按当前安排暂缓 |
| `EvidencePort` / `ArtifactPort` | 双方共同给出用例 | `goo122` | 越权、过期、超限、乱序、取消、敏感内容不入日志 |
| 真实 AgentArts adapter 验收 | `zemeng` | `zemeng`，`goo122` 复核本地终态边界 | deployment/version/trace、成功 API、失败读回、无静默 Local 回退 |
| 事实流投影与确认 | `zemeng` 提供消费语义 | `goo122` | 精确 FactRef 映射、事务 Inbox、待重检记录、崩溃重放和提交后 provider 确认 |
| `ModelPort` 最小稳定面 | 可选 Local Agent 提供消费场景 | `goo122` | 可选后续；不阻塞 Competition Profile |

## 7. 兼容与变更规则

### MOD-09B-MEMORY-PORTS-01 开发登记（2026-09-22）

`@personal-agent/memory` 公开 provisional `MemoryQueryPort`：`listCurrent`、`listHistory`、
`getVersion`，并由 `/testing` 提供显式 `FakeMemoryHost`。可信宿主预绑定 namespace 和允许的
sensitivity 集合；消费者无 namespace 选择、写入或出机许可入口。固定水位与不透明分页 token
仅存在于 Fake 内存，精确版本隐藏/不存在统一拒绝，返回副本隔离；详见
[工作包记录](../modules/MOD-09B-MEMORY-PORTS-01.md)。
同一包还公开 provisional `FactChangeFeedPort`、批次边界解析与 host-bound Fake 确认语义。
这些类型和离线 Fake 本身不代表生产事实库可用。PR #90 后，独立 SQLite 提供者、
持久确认和重启恢复已进入 main；Runtime 注入、Goal/认知投影、真实来源、删除及私人数据
验收仍未交付，运行能力继续 unavailable。无新增 wire Schema 或 capability；完整消费验收前不得冻结。

### MOD-09C-MEMORY-SQLITE-01 开发登记（2026-09-22）

PR #90 已由非作者批准并合并为 `f56059a`。`@personal-agent/memory/sqlite` 增加专用 SQLite 适配器：事实版本与变化事件
同事务追加，query snapshot/cursor、未确认批次、checkpoint 和幂等回执可跨重启恢复。
它复用 `@personal-agent/storage` 的有序迁移与 WAL，数据库文件不得与其他独立迁移序列共用。

本片仍不公布 Runtime capability，也不把端口升级为 frozen。delivery checkpoint 的持久 CAS
不等于 MOD-27/28 的 graph/impact 投影与确认同事务；真实 ingest、物理删除、保留/备份策略、
自动认知投影和私人数据验收继续 unavailable。详见
[MOD-09C 工作包](../modules/MOD-09C-MEMORY-SQLITE-01.md)。

### MOD-09D-MEMORY-GOAL-PROJECTION-01 开发登记（2026-09-22）

PR #91 已经非作者评审、Foundation CI 通过并合并；采用未生效暂存 → Memory provider
确认 → 本地原子激活：事实节点、精确 FactRef → NodeRef 映射、event/batch 去重、待重检
记录和本地回执同事务提交。确认拒绝不暴露旧 scope 事实；确认后、激活前中断从暂存恢复。
它不宣称跨数据库原子。修复后的 Runtime 68/68、架构门禁 3/3 与根 `npm run check`
已通过；本记录只覆盖离线与合成数据。
该入口仍为 provisional，未注册生产 composition、自动调度或 capability；详见
[MOD-09D 工作包](../modules/MOD-09D-MEMORY-GOAL-PROJECTION-01.md)。

1. `frozen` 项删除字段、改变字段含义、收窄原有合法输入或新增消费者无法处理的必需状态，必须升级不兼容版本。
2. 新增可选字段和新 operation 可以在 wire 1.x 中交付，但必须先通过 handshake/capability 公布；旧消费者可以忽略。
3. `provisional` 项仍需记录精确提交、迁移说明和消费影响，不能无提示破坏。
4. `unavailable` 项不得占用生产 capability；实现完成后按冻结检查表重新评估，不能直接从文档规划跳到 `frozen`。
5. Fake 只证明接口和状态分支。真实盘古、AgentArts、账号、Windows 或外部写入能力必须保留独立的 `conditional`/`verified` 证据。

## 8. 当前结论

### MOD-16-SYSTEM-OBSERVATION-01 开发登记（2026-09-17）

`@personal-agent/windows-client` 本机聚合状态只读工具正在独立工作包中实现，消费基线
`72cc76b` 的 `RegisteredTool`/`ToolContext`，不新增 wire operation，也不自动公布生产 capability。
范围仅 CPU、内存和 uptime 等必要聚合观测；不依赖独立 TraceGuard 项目，不读取身份、
进程命令行、文件或网络内容。PA-018 治理/恢复按用户修订排除。
提供者、Fake 与实际本机读取验收按 [模块记录](../modules/MOD-16-SYSTEM-OBSERVATION-01.md) 分别登记；
Competition 工具提案/Runtime Application/Desktop 装配仍未由此项交付，运行能力保持 unavailable。
本包接口保持 provisional，须按更新后的冻结证据门槛验收；不以另一位协作者签字作为前置。

截至 2026-09-27，**冻结范围仍只有 Core Runtime Profile 1 的消息、任务、会话与审批只读查询子集；不冻结整套协议、外部模型工具调用或 AgentArts 编排。** main 中已有 Competition 的离线 Coordination/审批工具循环、版本图、原子存储、显式修复预览/提交、受限工作区读取、公开演示知识检索，以及 provisional 的 SQLite 事实查询/变化流、可恢复投影和受信 Fact host 工厂；编码工具的补丁候选与独占 apply 也已合入 package，但尚未生产注册。生产事实自动消费、Runtime Memory capability、真实工作区写入与语音消费仍未完成验收。

真实 AgentArts deployment/API/trace、目标系统工具读回、完整 Evidence、真实语音设备和外部事实提供者仍 `unavailable`。Fake、合成评估、HTTP 200、配置成功或平台截图都不能提升这些状态；正式比赛路径不得静默回退 Local。
