# Agents

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

MOD-04B（后续负责人 `zemeng`）当前继承 MOD-04 历史工作包的单主 Agent 有界执行循环：模型返回最终回答或结构化工具提案，提案经工具描述和参数校验后，通过 `RuntimeToolInvoker` 发送公开的 `tool.invoke` 请求。历史实现由 `goo122` 交付，归属不追溯改写。

该既有循环现在只作为可选 Local Profile 基线留存，当前不新增、不扩展，也不构成 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的比赛实现。Competition Coordination 后续通过公共 `CloudAgentPort` 使用 AgentArts；不得用本包完成核心编排后再把装饰性调用记为 AgentArts 证据。

本包拥有 `AgentWorkerContext`、`AgentToolInvocation` 等消费端口，不依赖具体 Runtime 应用。Runtime 提供结构兼容的上下文和公共请求通道完成接入；这保持 `packages → apps` 的单向依赖边界。当前 Agent API 为 `provisional`，`AgentRunOptions.model` 仍接受具体 `ModelGateway`；计划中的 ModelPort、ToolExecutionPort 与 CoordinationPort 尚未交付，均为 `unavailable`。

执行边界包括 `maxSteps`、deadline、取消信号和一次默认提案修复机会；可信宿主可选传入 `maxTokens` 来增加本地 Token 预算。未配置时 Agent 不另设 Token 上限，仍受模型服务的上下文窗、输出限制和账户配额约束。授权引用由可信宿主通过 `authorizationRefFor` 提供，模型不得自行生成授权。工具返回 `unknown` 时必须由宿主转入 `waiting_reconciliation`，不能生成成功回答。

本包的测试只使用 Fake 模型、Fake 天气 Provider 和本地 Runtime；这不代表真实盘古或第三方平台已连通，也不构成模型工具调用冻结证据。状态与待交付端口见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

Runtime Application 可通过 `AgentRunOptions.initialMessages` 注入已由 Runtime 选定的对话上下文。Agent 只负责把这些消息与当前目标组成模型请求；恢复任务时，已持久化的 `agent-loop` 检查点优先于新的初始消息，避免重复执行或改变原有工具提案。
