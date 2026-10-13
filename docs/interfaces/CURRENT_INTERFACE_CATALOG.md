# 当前接口目录与冻结登记

版本：2026-10-13 · 代码核对基线：main 3275aa91。本文是接口成熟度及能力登记，不把目标设计转换为可调用API。

## 1. 状态与版本

frozen表示满足单一契约、生产实现、失败夹具、公开消费者、自审/CI及必要真实闭环的兼容承诺；provisional可在固定版本上消费，须记录迁移；unavailable表示未公布能力或缺所需生产语义。Schema/Fake/文档存在不构成能力。

部署profile与冻结集合不同：huawei_ict_agentarts是当前产品实施路径；Core Runtime Profile 1仅是下面的冻结子集。Local/DEV-WORKFLOWS既有实现保留，不静默回退。

本地wire 1.0.0、独立AgentArts transport 0.1.0、Windows内部帧及候选协议均按原单一Schema/解析器；本次不扩字段、枚举、operation、能力或冻结集合。

## 2. 当前main增量与证据

| 面 | 实现/公开消费入口 | 成熟度与验证范围 |
| --- | --- | --- |
| Runtime/工具 | TaskRuntime、application组合、Policy/ToolGateway、检查点与Evidence | 基础冻结子集如下；工具、持续授权和完整图恢复仍provisional |
| 模型 | ModelPort是ModelProvider公开别名，ModelGateway、Pangu/OpenAI-compatible/Live适配 | provisional；能力按真实deployment声明；新默认国内决策配置未接线 |
| 模型分派 | Runtime subagentModels/getModelGateway/getModelConfigurationRef/getModelReasoningEfforts | provisional；完整Competition多模型/原生参数/版本反馈待接线 |
| 云编排 | CoordinationPort、CloudAgentPort、AgentArts自有镜像、8 Workflow/3 Controller绑定 | provisional；固定公开文件Huawei WSS/MaaS/本地读取闭环有历史真实记录，不提升整链或全部绑定 |
| 知识 | KnowledgePort.search、Wiki来源/版本/受控写入恢复、本机配对桥及插件 | #320组合已进入main；host-only provisional，无新增公共wire；真实私人完整生命周期/云消费另验收 |
| 记忆 | MemoryQueryPort、FactChangeFeed、SQLite事实与投影/修订/撤回 | provisional；事实查询不等于向量检索；来源身份/出机许可和完整自动失效传播另验收 |
| MCP/Skills | 固定只读stdio、安装/启停/使用/卸载及受限Skill | #320组合已集成；provisional，任意脚本/远端写工具与真实云使用未由此证明 |
| 目标/认知 | 图存储appendBatch、影响/显式修复、持久事实批消费、有限建议适配 | provisional；Laya仍为存量，新的唯一决策配置迁移及完整责任循环待实施 |
| 语音 | Voice/Live/wake代码与宿主工厂 | provisional宿主面；wire voice操作仍未公布，问题绑定和实际设备同意/修改另验收 |
| Windows/补丁 | Named Pipe、目标读回、可信宿主尝试记录、Competition patch核实 | #332进入main；仅按模块明确场景记录，内部契约provisional，不概括为任意软件/写入可用 |
| 业务 | productivity、calendar、mail、feeds、notifications、research、weather、GitHub | 各包已存在；真实账号/网络、宿主注册、用户旅程分别核对，不能整体称unavailable或整体verified |
| 影子与上下文 | 当前轨迹/评估夹具、已有上下文与模型工厂可复用 | 新三模式独立影子宿主、摘要映射/缓存版本、责任编译为待接线能力 |

证据入口：[真实Huawei固定读取](../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)、[Wiki/Skill集成](../modules/MOD-06-07-SKILL-WIKI-INTEGRATION-20261013.md)、[Windows](../../apps/windows-host/ACCEPTANCE-20261013.md)、[补丁](../../packages/coding-tools/ACCEPTANCE-20261013.md)。历史测试不等于本轮重新运行。

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
| `voice.start` | `unavailable` | 否 | wire未公布；已有语音宿主代码不等于该wire操作可用 |
| `voice.stop` | `unavailable` | 否 | wire未公布；“停止播报”不能替代 `task.cancel` |

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
| `notification.created` | wire发布链未公布；已有NotificationService/宿主消费按各自契约核对 | 同上；不能因 Schema 存在显示为已接通 |

### 3.5 冻结范围之外

Core Runtime Profile 1 **不包含**模型工具调用、工具执行、持续授权、Evidence 内容、Artifact、设置管理、连接器账号、语音、MCP、Skills、知识/记忆、Windows Host、AgentArts 或打包生命周期。它们不得借用 wire 1.0.0 的版本号宣称已经冻结。



## 4. 本设计尚未公布的能力

| 目标 | 可复用入口 | 实施前状态 |
| --- | --- | --- |
| 自然语言责任编译/持久授权匹配 | Goal、Runtime、现有Policy | 完整目标消费unavailable；不得私设责任DTO/Renderer数据库 |
| 主动语音问题/操作/参数/revision绑定 | Voice宿主、authorization.respond | 新绑定未交付，语音意图不能直接签发授权 |
| 统一唯一决策服务及Laya迁移 | Cognition、CloudAgentPort、ModelGateway | 新默认配置未验证；只记录语义建议，保持旧消费者兼容 |
| 完整F28 Competition分派 | subagentModels及云编排 | 原生参数/能力/配置版本映射待接线，不扩ReasoningEffort枚举冒充支持 |
| F27可恢复摘要与版本缓存 | Memory/Knowledge/ModelPort | 完整宿主待交付；不是新MemoryQuery向量API |
| F22三模式影子 | 轨迹/评估/显式测试夹具 | 独立宿主与隔离证据未交付，不读写主状态/授权 |
| F23自动配置改进与晋升 | learning候选/验证端口 | 生产验证器/发布条件及回滚读回另验收；不是权重训练 |
| F24完整图推进/分支恢复 | TaskRuntime、检查点、原操作核实 | 保留原任务状态，不创建第二套调度器 |
| MaaS远端权重修改 | 无现有API | unavailable；独立训练工作包不能冒充API功能 |
| 云端持久回执自动恢复 | 云状态查询、本地发送意图 | restartRecovery:false；未知不重发，生产自动协调另验收 |

## 5. 能力发现、兼容与冻结

生产握手只公布实际支持的operation和ToolDescriptor；settings/connector/voice等Schema占位不能由文档启用。host-only工厂和wire能力分开，未公布返回UNSUPPORTED_CAPABILITY。

provisional变化固定提交和消费者；冻结字段变更需不兼容版本或明确协商。新增能力经单一Schema、生成器、失败夹具和消费接线交付后再登记。任务/工具语义和真实场景要分别验证；本轮文档重写不提升状态。

旧目录全文可从Git基线3275aa91读取，不继续将2026-09“尚无包/未进入main”等历史条目作为当前结论。公共契约仍以packages/contracts及公开exports为单一来源。
