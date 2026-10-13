# MOD-11～19：请求 goo122 提前交付并冻结独立开发接口包

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

日期：2026-09-08。提出方 / 消费者：`zemeng`；公共协议、SDK、fake 与根装配负责人：`goo122`。

状态：**请求 PR #32 已合并；批次 A 的查询/恢复子集已随 PR #34 交付并冻结**。批次 A 的最终签名见 [Runtime 公开查询接口](RUNTIME_QUERY_API.md)；逐项状态见[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。F01～F10 的其余部分仍为 `provisional` 或 `unavailable`，不宣称 MOD-11～19 已获得完整接口或全部开工授权。

Profile 更新：当前只实施 [Huawei ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)。本请求中已冻结的 Core Runtime 查询面继续作为比赛共享底座；后续新增接口先满足 MOD-29/30/32 的 `CoordinationPort`、`CloudAgentPort`、`ToolExecutionPort` 与 Evidence 最小消费语义。MOD-04B、MOD-27/28 随后接入持续认知；MOD-11～19 只按比赛 Golden Path 的实际依赖推进。通用 Local Profile 仅保留现有代码，当前不新增、不扩展，也不作为接收门槛。

## 1. 目的与边界

请 `goo122` 提前制定我负责的全部模块所需跨模块协议，并交付可直接消费的类型、Schema、fake、示例和兼容性记录，让 `zemeng` 在短期内不用等待真实 Runtime、模型、连接器或账号即可独立开发。

这里的“独立”是**依赖已冻结接口、使用可运行 fake 完成模块内实现和验收**，不是绕过网关，也不是宣称真实集成已完成。不要只回复“以后提供某端口”，也不要一次实现全部后端业务。

依据：[PRD](../PRD.md)、[架构](../ARCHITECTURE.md)、[模块分工](../MODULE_ASSIGNMENTS.md)、[开发协议](../DEVELOPMENT_PROTOCOL.md)、[目录规范](../PROJECT_STRUCTURE.md)。本文件是消费者请求；与已发布 Schema 不一致时以现行 Schema 为准，新语义经 goo122 评审发布后才能消费。

以下新增接口名称均是**建议能力名，不是已存在的 operation 或最终签名**。请 goo122 在交付 PR 中选择复用现有操作、增加公开方法或新增 capability，并明确最终导出位置；不要让消费方维护另一套 DTO。

### 处理结果（2026-09-09）

| 请求范围 | 处理结论 | 当前状态 |
| --- | --- | --- |
| F02 的 `task.list`、`conversation.list` 和固定水位分页 | PR #34 已实现、Desktop 已通过公开 Client 恢复 | `frozen` |
| F03 的 `approval.list` 脱敏查询和 revision 语义 | PR #34 已实现，Desktop 不再读取私有 approval/checkpoint | `frozen` |
| F01 Host 生命周期、F02 事件通道、F03 Evidence | 有部分本地实现，但语义或跨进程边界未闭合 | `provisional` / `unavailable`，按接口目录逐项判断 |
| F04～F08、F10 | 尚无完整公开类型、生产提供者和消费验收 | `unavailable`，不得由 UI 或模块自行猜测 |
| 盘古/Agent 工具链 | 只有 Fake 与文字 JSON 解析测试，真实脚本默认跳过 | `provisional`；不是原生 function calling 证据 |
| 新分工的 MOD-04B、MOD-27～32 | 已确定比赛架构和负责人，尚未实现公共端口或 AgentArts 适配 | `unavailable`；先做 MOD-29/30/32，再做 MOD-27/28；Local 不阻塞 |

因此这份文件继续保留为需求和缺口记录；已交付接口的规范性状态由接口目录接管。

## 2. 已核对的代码基线

本请求的原始代码基线：`2e449e9c7b0cda00f7dfc929652e20e688a47a36`。这是一份历史提交快照；当前交付状态由上方处理结果、现行接口目录和已合并 PR 共同说明。

| 事实与源码依据 | 对独立开发的影响 |
| --- | --- |
| [contracts Schema](../../packages/contracts/schema/protocol.json)、[导出与帧编解码](../../packages/contracts/src/index.ts)、[ports](../../packages/contracts/src/ports.ts) 已有 wire 1.0.0、任务/工具/授权/连接器/语音声明 | Schema 中出现操作，不代表真实 Runtime 已实现或握手公布 |
| [RuntimeApplication](../../apps/runtime/src/application/runtime-application.ts) 已公开 send、readEvents、activeTaskCount、close、configureText、testTextConnection、deployment | 固定可信 Host 边界即可，不必重写桌面传输层 |
| [Desktop Main](../../apps/desktop/electron/main.js) 的 applyEvent 读取 runtime.getApproval 和 agent-loop checkpoint | 审批详情依赖内部结构，必须补公共脱敏查询后迁移 |
| [Desktop conversations](../../apps/desktop/electron/conversations.js) 保存任务与界面/输入映射；主线 RuntimeApplication 仅把当前 goal 交给 startTask | UI 本地历史不能代替公共会话查询与上下文契约 |
| [Client/EventCursor](../../packages/client/src/index.ts) 有能力协商、请求取消与事件去重/缺口检查 | 需补可靠的快照水位与恢复协议，不能只从零回放恢复 UI |
| [FakeRuntime](../../packages/testkit/src/index.ts) 已有六场景及 settings；[fake ports](../../packages/testkit/src/ports.ts) 有 Clock、Storage、ToolHost、Connector | 增量补齐，不另造 SDK；FakeToolHost 不能冒充生产授权/写入结果核实 |
| [ConnectorHost](../../packages/connector-host/src/index.ts) 已有 SecretStorePort.read、工厂和注入；[Models](../../packages/models/src/index.ts) 的 ModelRequest 仍以文本消息为主 | 凭据读端口复用；凭据管理、视觉附件与流式输出仍需定边界 |
| 现有 packages 没有 voice、voice-wake、windows-client、traceguard、coding-tools；MOD-19 没有已交付安装包 | 先冻结最小依赖，不把规划目录或能力布尔值当作实现 |

另已检查并已合并的 **PR #31**（`codex/mod-04-conversation-context`，实现提交 `5828f1a43bd2853fd42723907b74392f456c5e2f`）：它给模型注入同会话最近成功任务历史并保存上下文 checkpoint，覆盖隔离与恢复测试；它没有新增 contracts/client 的会话管理 API。公开查询消费面随后由 PR #34 补齐；“成功历史”的模型上下文和 UI 完整历史仍是两个不同语义。其他连接器开放 PR 仍由各自负责人交付；本请求不接管它们。

## 3. 全部 zemeng 模块的依赖对照

| 模块 / zemeng 独占范围 | 请 goo122 提供或冻结 | 可独立验收的替身 |
| --- | --- | --- |
| MOD-11：electron / app 桌面外壳 | F01 Host 生命周期与版本；F02 状态重同步；F05 脱敏设置；F10 根装配入口 | 可连接、断连、重启、协议不匹配的 Fake Host |
| MOD-12：orb / conversation | F02 任务与会话查询、事件恢复、取消；F04 附件与输出投影 | 多会话、并发、审批、断流与未知结果夹具 |
| MOD-13：admin / ui | F03 审批/证据；F05 设置/能力/模型/连接器/通知管理读写面 | 各页面空/加载/不可用/冲突/成功/错误，无真实账号 |
| MOD-14：voice 与 voice UI | F04 音频流/Artifact；F06 语音注册、模型与凭据注入、文本提交关联 | Fake ASR/TTS、音频片段、停止/打断/背压 |
| MOD-15：voice-wake | F06 录音授权会话、唤醒事件和设置持久化边界 | Fake 时钟、授权撤销、回声/误触音频夹具 |
| MOD-16：windows-host / windows-client | F07 Host 通信、执行授权、独占/接管、视觉模型；F08 凭据与模块存储 | Fake Runtime/Policy/视觉/SecretStore + 协议帧夹具 |
| MOD-17：traceguard | F07 工具注册/受限执行；F03/F04 证据/工件；F08 存储 | 查询、保护拒绝、未知结果、恢复记录 fixture |
| MOD-18：coding-tools | F07 工作区授权/命令/补丁/资源锁；F03/F04 输出证据 | 临时仓库、Fake Policy/ToolHost、超时和取消 fixture |
| MOD-19：packaging / scripts/release | F10 产物、启动装配、运行时版本、目录迁移与升级退出契约 | 无账号的安装输入清单、启动自检、卸载保留数据 fixture |

MOD-20～26 不因此转给 zemeng。MOD-13 消费这些模块的后台与通知数据，由 goo122 冻结公共宿主面、`Potatos498` 提供领域配置 Schema/数据。MOD-26 平台子模块只有另行认领才增加 zemeng 的开发范围。

Competition 新模块优先级如下；它们不把本文件历史上的 MOD-11～19 接口请求改写为“已交付”：

| 模块 | 当前需要的最小公共边界 | 验收替身 / 真实门槛 |
| --- | --- | --- |
| MOD-29：AgentArts 云端基础 | `CloudAgentPort`、deployment/version/trace、身份与错误语义 | Fake CloudAgent；真实项目、部署与 API 读回 |
| MOD-30：AgentArts Agent/Workflow | Coordination→CloudAgent 请求、工具提案、知识/MCP/Skill 能力映射 | Fake Workflow；真实 AgentArts trace 与工具提案 |
| MOD-32：发布、观测与比赛验收 | profile、deployment、trace、usage、评估、失败与回滚 Evidence | Golden Path；AgentArts 失败时不静默回退 |
| MOD-27/28：世界状态与持续认知 | MemoryQuery/FactChange、Goal/Decision/Plan revision、KEEP/RECHECK/REVISE | 确定性 Fake；真实事件影响与最小计划修复 |
| MOD-04B：Competition Coordination | `CoordinationPort`、`ToolExecutionPort`、Evidence 消费语义 | Fake Runtime/Memory/Tool；真实 AgentArts 协调闭环 |

## 4. 按依赖包交付的具体要求

### F01 — 保留并发布可信 Runtime Application 边界（最高优先）

保留 `@personal-agent/client` 与 `@personal-agent/runtime/application` 的现有使用方式。请导出完整 Host 消费类型，冻结 `send(request, signal)`、`readEvents(afterSequence)`、`activeTaskCount`、`close()` 以及文本配置/连接测试/deployment 的参数、返回与错误。

- 说明 activeTaskCount 当前仅统计活动文本执行 Promise，是否包括 waiting_approval、waiting_external、waiting_reconciliation；提供可靠的退出/升级决策快照，不能把 0 直接理解成没有未结束任务。
- 说明连接成功/降级/不可用、初始化失败、关闭时未结束任务、恢复后任务处理、重复关闭和配置变更期间请求的行为。需要异步关闭时按兼容策略扩展，不静默改变旧签名。
- 连接测试不能等价于业务请求成功；配置保存不能改变 verification 为 verified；UI 不接收密钥回显。
- 当前保留进程内装配，不为接口冻结强制拆 Runtime 进程。未来外置适配维持同一消费端口。

### F02 — 任务、会话、输出与事件恢复（最高优先）

首先冻结现有 `system.handshake`、`task.submit/get/cancel`、`event.subscribe`、`capability.list`、`authorization.respond`、`tool.invoke` 的信封、幂等、deadline 和取消语义；沿用已有 11 个 TaskState，不为 UI 添加第二套真实任务状态。

请提供以下公开能力或说明明确的不支持边界：

- 任务列表/分页/过滤和按 ID 快照：需支持重启后找回未结束任务，而非要求 UI 预先知道所有 taskId。状态、会话关联、revision、结果/错误、已发生副作用来自 Runtime。
- 会话创建或 ID 归属规则、列表、消息/任务历史分页、新会话隔离；明确是否支持重命名、归档、删除及其作用于上下文还是仅列表。暂不支持的写能力返回不支持，不由 Desktop 猜测删除 Runtime 数据。
- 固定 conversationId 的模型历史策略、并发消息排序、当前任务重试/重复提交、失败/取消记录展示及上下文是否纳入；PR #31 的“成功历史”与 UI 完整历史不能混为一谈。
- 结构化输出投影：正文、模型身份、usage/verification、可展示步骤、错误、证据引用分离。不要让 UI 解析 resultSummary 尾部字符串取得协议字段；不要暴露隐藏推理。
- 明确 event.subscribe 后事件由何通道读取、如何取消订阅；流身份/重启后游标有效性、保留窗口、队列溢出、重复与乱序规则。
- 定义一致的“全量快照 + streamId/sequence 水位 → 从水位续订”流程，避免读快照和订阅之间漏事件。CURSOR_EXPIRED 时同一流程可恢复会话、任务、审批和通知。
- 请求 AbortSignal、停止播放、task.cancel 各自独立；任务终态与写入结果核实继续服从现行协议。新增任务重试必须创建新任务并关联来源，不重开终态任务。

### F03 — 审批、安全视图与证据（最高优先）

- 增加审批列表/详情/恢复公开读面（或等效富事件 + 可重同步快照）：approvalId、taskId、可用于 respond 的 revision、动作/工具版本、受限范围、到期时间、当前状态、脱敏参数摘要及参数绑定摘要。哪些字段必需/可选由 Schema 固定。
- 明确 respond.expectedRevision 指向哪个实体；过期、撤销、已处理、重复决定、任务已结束和参数变更如何返回。UI 不能从旧请求重新构造授权。
- 原始参数按敏感性处理；路径、私人正文、令牌不因“审批详情”无条件下发。UI 不再读取 getApproval/loadCheckpoint 或 agent-loop.pending。
- 公开 Evidence 元数据查询与受控内容读取：证据类型、时间、来源、verification、敏感性、不可访问/已过期/已删除的区分。审批“允许”不等于工具成功，执行记录不等于后置验证。
- 明确模块如何提交证据、由谁签发 ID 和验证等级、如何绑定 task/run/artifact。工具不得自行提升 mock 为真实验证，也不得任意引用他人证据。
- 给出 unknown 写入的核实入口/状态投影及恢复动作的再授权规则；不以普通“重试”按钮重放副作用。

### F04 — Artifact、流式数据与附件（MOD-12/14/16/17/18 共用）

现有开发协议有 artifactRef 原则，但还不足以实现互通。请冻结创建/上传或宿主生成、受限读取、释放/过期、元数据与错误处理。引用绑定任务或会话、调用主体和访问目的；不把任意外部路径当可信引用。

为截图、音频、附件、命令输出制定 MIME/编码、长度/配额、chunk 序号、结束/错误帧、背压、取消、断流是否允许续传及清理责任。JSONL 每帧 1 MiB 已有实现，不能把大音频塞进该信封；实际分片限制由 goo122 交付，不在消费端各定一份。

提供内存 Artifact/stream fake 与越权/过期/超限/乱序夹具。音频真实采集与 Windows 截图由 zemeng 实现；公共引用服务与校验由 goo122 提供。敏感工件不默认进入日志或模型上下文。

### F05 — 管理后台所需公共面（不能把页面占位当后端）

| 管理领域 | goo122 需要冻结的最小边界 |
| --- | --- |
| 设置 | settings namespace 目录、每个 namespace 的 Schema/默认值/可写项、expectedRevision 原子冲突、事件或刷新方式；区分设备本地 UI 设置与 Runtime 业务设置；密钥不可混入普通 patch |
| 模型 / Agent | 脱敏部署列表、能力与验证等级、启停/配置/测试的 Host 入口；思考强度、快速模式、输出/预算参数何者支持、何者拒绝；保持未配置预算不自动另加固定限额；专业 Agent 列表/可配置项由 MOD-04 提供 |
| 工具 / MCP / Skills | 稳定 manifest、健康/启停/版本、配置 Schema、安装与启用的授权区别；未实现管理动作明确不支持；界面不解析内部配置文件来替代服务 |
| 连接器 / 账号 | capability.list + connect/disconnect 与账号引用、交互式认证状态、撤销/清理结果、账号归属的映射；现有 ConnectorHost.disconnect(connectorId) 与 wire accountRef 必须由宿主适配，不能让 UI 猜 |
| 通知 | notification.created 外的列表/恢复、已读/隐藏等是否支持、关联任务/会话、脱敏内容、去重键；策略由 MOD-23，调度由 MOD-03，Desktop 只展示/跳转 |
| 知识 / 记忆 / 学习 / 日程等业务页 | 统一配置 Schema 和可用状态，必要的只读列表/详情及显式写入口由所属模块经宿主公开；未实现先提供同协议 fixture，不让 UI 读 Vault、数据库或私有类 |

不要求 goo122 代写连接器业务或 UI。请在能力清单标出“可冻结现有 / 新增 fake / 真实已接入 / 暂不支持”，并给出 MOD-13 每个导航领域的对应项；拒绝用无约束 Record<string, unknown> 作为所有页面的最终协议。

### F06 — Voice 与 Wake 的跨模块边界

`voice.start/stop` 已在 Schema 中，但不能代表已可用。ASR/TTS 和 VoicePort 的实现归 zemeng；goo122 负责公共注册、网关/凭据注入与 Runtime 关联。

- 确定语音会话与 conversationId/taskId 的绑定、start/stop 参数及幂等、设备不可用/权限拒绝/供应商不可用错误；音频格式的采样率、声道、编码与流 ID 明确可校验。
- 冻结 partial/final 转写、播放开始/完成/错误、打断、会话关闭事件；最终文本何时提交 task.submit、谁负责防止重复提交。
- ASR/TTS 请求由受信宿主注入供应商端口和凭据，经授权/调用网关；不让 Renderer 或 Wake 模块持有 key，不要求 goo122 另做第二套语音适配器。
- 连续监听必须单独授权且默认关闭；授权撤销/设备断开/应用退出停止采集。唤醒不自动授予私人数据读取或工具执行权限。
- Wake 只消费授权后的音频会话和 Voice 生命周期；冷却、防误触、回声抑制算法为模块内部实现，不强塞公共协议。提供允许/拒绝/撤销/打断时任务仍运行的 fixture。

### F07 — Windows、TraceGuard、Coding 的执行边界

沿用 ToolDescriptor、RegisteredTool、ToolContext、ToolHost；注册/注销和 outputSchema 校验不另造协议。请冻结宿主注入包，以及 Runtime→执行器内部授权、结果、后置验证和资源独占边界：

- Named Pipe：连接双方身份/ACL、握手与协议协商、会话失效、UTF-8 JSONL 帧、断连/超时、请求关联、事件和取消路由。已有 FrameDecoder 夹具应能被 C# 消费；本机管道不等于自动可信。
- authorizationRef/scopeRef 解析与绑定由 goo122 的 Policy 决定：任务、工具/版本、目标/参数摘要、调用主体、期限、用户在场、一次性使用、撤销。Host 只执行验证后的范围，不信任请求自报 scopes。
- 串行电脑输入和同资源写入锁的唯一仲裁者、获取/释放/过期/进程崩溃语义；用户接管暂停、任务取消、安全中止与断连后结果未知的区别。不得在 Host 和 Runtime 各建一套相互不知的锁。
- DesktopActionPort 的观察、目标引用/有效期、动作结果与后置验证接口由 zemeng 提供消费反馈，跨进程 Schema 由 goo122 发布。目标移动、窗口销毁、DPI/坐标空间变化必须拒绝陈旧目标或重新观测。
- MOD-16 的视觉定位通过 MOD-04 公开模型端口：Artifact 输入、模型支持探测、返回坐标空间/目标候选、失败与 deadline；现有 vision 布尔值不等于已有图像输入与定位结果协议。定位推断不能代替真实操作验证。
- MOD-17 保留普通用户与关键系统保护边界；读观察、受限变更、恢复作为不同副作用工具，返回真实来源、前后证据与恢复引用，不自动提权。
- MOD-18 使用被授权工作区引用、预期文件版本/digest、命令策略与受限环境；补丁预览/应用/验证结果区分，stdout/stderr/exit/截断与 artifact 规则固定。规划属 MOD-04，执行不自行调用新模型或覆盖用户改动。
- 写入开始后超时/取消/断连沿用 RESULT_UNKNOWN/核实流程；请明确幂等记录保存、查询和恢复端口，fake 与生产 ToolGateway 的差异必须被测试显式覆盖。

### F08 — 凭据、存储、日志与时钟注入

复用现有 ConnectorHost 的 `SecretStorePort.read(secretRef, signal)`，不要因文档只列端口名而重做。请固定拥有该接口的包与导出；若转公共位置，提供兼容导出与迁移说明。

- Windows 安全存储由 zemeng 实现；goo122 定义宿主可调用的保存/替换/删除/状态查询边界与主体/namespace 限制。读不到、解密失败、撤销、取消的结果明确；UI 只拿掩码/配置状态。
- 明确模型配置现有加密存储与未来 SecretStore 的迁移归属，禁止两份不同长期密钥来源并存且不知谁生效。
- 当前 StoragePort 仅 get/set/delete；请说明同步语义、值类型、命名空间隔离、容量/失败行为。需要 revision/事务/持久化的共享模块由 goo122 补充，不能假定 FakeStorage 已提供真实持久性。
- 提供受限 logger、clock 和必要事件发布端口的明确类型/注入示例；ToolContext 当前没有 logger 等这些字段，不允许消费者私自加约定。日志只记录关联 ID/脱敏摘要，外部内容不得变成权限。

### F09 — 可运行的冻结包，而不仅是文档

请交付到现有 contracts/client/testkit 及端口所属包，不预建空业务模块：

1. 每项 F01～F10 的最终类型/Schema/导出、实现负责人、消费者、当前支持状态；新增 operation/事件走能力发现。
2. 同一版本的 fake Host、任务/会话/审批/通知数据、Artifact/stream、模型/视觉/语音端口与受限凭据/存储替身。已有六场景复用并补缺口，不要求真实账号。
3. 正常、失败、权限拒绝/撤销、过期、版本冲突、取消但写入未知、断连/恢复、事件游标过期/快照并发、跨会话隔离、未注册能力的固定夹具；以 schema 校验拒绝坏输入。
4. 至少一个 Desktop 消费示例和一个 Windows/工具提供者示例；列出实际验证过的本地命令和依赖构建顺序。C# 使用同一 wire fixture，不自行翻译语义。
5. 版本号、提交号、冻结日期、兼容范围、废弃/替换映射和消费者迁移说明。生成产物同步并通过现有 check:generated；不能只合入 markdown 就标记接口可用。

### F10 — 打包与根装配输入（MOD-19）

由 goo122 固定根 workspace/锁文件/构建与模块注册顺序、生产入口和启动参数、Node/Electron/原生 ABI 与支持平台架构、必需构建产物/资源清单、配置与持久数据目录注入规则。当前根 engines 与桌面 Electron 内置 Node 不应未经验证就等同。

明确 dev/fake/production 选择、生产禁用 silent fake、健康/就绪与退出信号、活动任务升级阻断/恢复、迁移版本和旧版本拒绝策略、用户数据保留/卸载清理边界。安装器实现与真实安装验收归 zemeng；数据库迁移与根构建修改归 goo122。签名、发布账号与真实发布需另行授权，不是本 PR 的隐含工作。

## 5. 建议交付顺序与接收门槛

以下顺序已由 Competition Profile 覆盖：先交付比赛共享端口和 MOD-29/30/32 Golden Path，再按真实需要取用原 F01～F10。Local `ModelPort`、本地 Agent 新能力和与比赛无关的通用接口不进入当前批次。

| 批次 | 交付内容 | zemeng 可并行推进 |
| --- | --- | --- |
| P：比赛主路径 | Coordination/CloudAgent/ToolExecution/Evidence 最小边界、Fake 与 profile 语义 | MOD-29/30/32；真实 AgentArts 部署、API、trace 和只读工具 Golden Path |
| A：先消除当前耦合 | F01/F02/F03/F05 的桌面急需项 + 对应 F09 fake | MOD-11～13 公共数据/审批/恢复接入，不再钻 checkpoint |
| B：提前冻结执行与媒体边界 | F04/F06/F07/F08 的类型、协议与 fake | 经开工授权后的 MOD-14～18 独立模块实现 |
| C：冻结分发输入 | F10 清单、生命周期与无账号自检输入 | MOD-19 包装与隔离验收准备 |

请 goo122 在回复/交付 PR 中逐项填写：`F 编号 → 最终导出/Schema → fake 场景 → 已验证命令 → commit/version → 真实能力限制 → 待定项及负责人`。某项不需要新接口时，指向现有代码并说明如何满足消费场景；某项尚未确定时明确标为未冻结，不让 zemeng 反向猜字段。

接收标准：

- [ ] 当前比赛批次涉及的模块都有最终公共入口或明确的暂不支持边界，没有待猜测字段/错误语义；其余 MOD-11～19 需求不因未进入当前范围而伪装成完成。
- [ ] 新旧协议一致性、生成检查和对应契约测试通过；未公布 capability 时客户端可靠拒绝。
- [ ] zemeng 使用同一提交版本运行消费示例，不需要 goo122 的私人环境、密钥、真实模型或账号。
- [ ] 在 fake 下可验收重启/审批/取消/未知结果/恢复；fake 限制有显式说明。
- [ ] 已登记交叉评审与冻结记录；运行时真实实现状态单列，不能被“接口冻结完成”替代。

## 6. 本 PR 自身的验证与非目标

本 PR 为文档请求：核对模块所有权、主线代码/Schema/现有包导出及 PR #31 差异，检查相对链接、重复遗漏、差异空白和敏感内容。不修改 contracts、Runtime、根配置、锁文件、协作者模块或桌面视觉；不为了文档运行全量应用测试。不把申请发出等同于 goo122 已接受/交付/冻结。
