# Agents

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-04B（zemeng5208）。产品流程：F01、F03、F28；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

MOD-04B（后续负责人 `zemeng`）当前继承 MOD-04 历史工作包的单主 Agent 有界执行循环：模型返回最终回答或结构化工具提案，提案经工具描述和参数校验后，通过 `RuntimeToolInvoker` 发送公开的 `tool.invoke` 请求。历史实现由 `goo122` 交付，归属不追溯改写。

该既有循环现在只作为可选 Local Profile 基线留存，当前不新增、不扩展，也不构成 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的比赛实现。Competition Coordination 后续通过公共 `CloudAgentPort` 使用 AgentArts；不得用本包完成核心编排后再把装饰性调用记为 AgentArts 证据。

本包拥有 `AgentWorkerContext`、`AgentToolInvocation` 等消费端口，不依赖具体 Runtime 应用。Runtime 提供结构兼容的上下文和公共请求通道完成接入；这保持 `packages → apps` 的单向依赖边界。当前 Agent API 为 `provisional`，`AgentRunOptions.model` 仍接受具体 `ModelGateway`；计划中的 ModelPort、ToolExecutionPort 与 CoordinationPort 尚未交付，均为 `unavailable`。

执行边界包括 `maxSteps`、deadline、取消信号和一次默认提案修复机会；可信宿主可选传入 `maxTokens` 来增加本地 Token 预算。未配置时 Agent 不另设 Token 上限，仍受模型服务的上下文窗、输出限制和账户配额约束。授权引用由可信宿主通过 `authorizationRefFor` 提供，模型不得自行生成授权。工具返回 `unknown` 时必须由宿主转入 `waiting_reconciliation`，不能生成成功回答。

本包的测试只使用 Fake 模型、Fake 天气 Provider 和本地 Runtime；这不代表真实盘古或第三方平台已连通，也不构成模型工具调用冻结证据。状态与待交付端口见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

Runtime Application 可通过 `AgentRunOptions.initialMessages` 注入已由 Runtime 选定的对话上下文。Agent 只负责把这些消息与当前目标组成模型请求；恢复任务时，已持久化的 `agent-loop` 检查点优先于新的初始消息，避免重复执行或改变原有工具提案。
