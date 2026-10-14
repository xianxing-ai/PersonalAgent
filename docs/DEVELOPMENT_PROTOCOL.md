# 公共开发协议与新架构适配

日期：2026-10-14。本次重新组织说明，不修改Schema/生成类型或新增公共DTO。单一来源：packages/contracts/schema/protocol.json、agentarts-transport.json、Windows内部Schema及各包exports；成熟度见[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 1. 通信分层

Renderer经安全Preload/Client提交请求与接收事实状态；Runtime管理可信生命周期。CoordinationPort/CloudAgentPort隔离云DTO，ModelGateway统一模型调用，ToolGateway执行受限工具。huawei_ict_agentarts不静默回退Local。

本地wire 1.0.0与AgentArts独立transport 0.1.0分别校验；WSS主通道与HTTPS备用保持同一业务身份。已发送结果未知不重发。Windows Pipe使用其内部契约及服务端身份核验，不因本机连接免检。

## 2. 已发布信封与操作

Request含kind、protocolVersion、requestId、taskId（适用时）、operation、deadline、idempotencyKey（适用时）和具体payload。Response区分outcome=ok/data与error/error，保留evidenceRefs。Event含eventId、streamId、sequence、type、occurredAt和具体payload。详细必需/可选约束以Schema为准。

requestId关联单次请求，业务幂等不以requestId代替；授权引用仅由可信Runtime执行路径注入。工具目录公布name/version/inputSchema/outputSchema/sideEffect/requiredScopes/idempotencySupport/recoverySupport/requiresPresence等既有字段，外部自报需宿主核验。

现有17个wire操作的状态见接口目录：7个任务/会话/审批查询基础操作frozen；event.subscribe与按装配公布的capability.list、authorization.respond、tool.invoke为provisional；settings、connector与voice操作未因本设计自动公布。

## 3. 任务与事件

状态来自Schema：created、planning、running、waiting_approval、waiting_external、waiting_reconciliation、verifying、cancelling、succeeded、failed、cancelled。TaskRuntime是唯一迁移者。受理不等于完成，cancelAccepted不等于执行停止；终态重试创建关联的新任务，不直接重开。

写入未知进入waiting_reconciliation并核对原执行；保留已经发生的副作用。审批/外部等待只阻塞相关节点。事件按eventId去重和sequence消费；快照分页保持snapshotSequence。服务端尚未交付的游标裁剪/unsubscribe能力不能根据目标语义宣布已有。

## 4. 新设计概念如何接线

| 概念 | 既有消费位置 | 适配要求 |
| --- | --- | --- |
| 用户目标/持续责任 | task.submit、Goal、可信配置与Policy | 责任字段是设计，不由Renderer生成新协议或授权 |
| 功能图节点 | Runtime步骤、图revision与checkpoint | 持久身份/条件/必需分支映射后才能执行 |
| 唯一决策建议 | Cognition/Coordination/CloudAgent | 节点、快照、版本和合法候选由宿主校验 |
| 模型与思考 | ModelRequest及subagentModels | 当前ReasoningEffort none/low/medium/high；供应商扩展先映射/兼容 |
| 上下文摘要/缓存 | MemoryQuery、Knowledge、模型请求 | 来源/目标/参数/配置版本匹配，不能解析resultSummary尾缀私设协议 |
| 语音同意 | Voice宿主与authorization.respond | 最终转写、问题/参数/revision绑定；decision仍按已有allow_once/deny语义 |
| 影子结果 | 独立评估/轨迹宿主 | 不写主任务/记忆/授权，缺反事实结果标未知 |

实际需新增字段时先记录公共行为、版本/消费者影响，按单一Schema和生成器交付；文档里的snapshot、question、resource键不自动成为公开类型。

## 5. 知识与记忆

KnowledgePort.search返回带来源候选；MemoryQueryPort提供事实当前/历史版本，FactChangeFeed提供变化及确认。Wiki正文、事实投影和Goal图各有身份，不能宣称跨库原子。实际写入回执先保留，再独立恢复派生投影；缺页/断连不推断删除。

用户保存事实不自动授予出机；出机按任务、目的地、精确版本及现有许可。删除核对副本和原版本，外部已发送内容不在本地撤回保证内。

## 6. 错误、取消和副作用

INVALID_REQUEST/版本不兼容拒绝；UNSUPPORTED_CAPABILITY不伪造降级；REVISION_CONFLICT重读后重算；限流遵循实际retryAfter/deadline与用户预算；RESULT_UNKNOWN先核实。TIMEOUT或retryable不能单独决定写入重试。

调用贯穿deadline和取消信号；同一操作标识绑定相同输入，重规划/重启不刷新成新写入。模型不提供scopeRef、凭据、授权或执行函数。桌面输入与同资源写入复用既有锁。

## 7. 证据与联调

Evidence区分来源/观察/执行及mock、conditional、verified；可信执行路径记录，模型自报只作候选。敏感正文、音频、密钥和隐藏推理不默认写日志，公开引用不暴露私人路径。

联调用现有Client/FakeRuntime/ToolHost和明确Unavailable，测试公开契约、分支、修订、取消、未知与恢复。真实模型/账号/设备及平台trace另验收。合并按CONTRIBUTING的一位合资格非作者有效批准和实际检查执行，不以两人本机阅读作为协议冻结门槛。


## 镜像内决策与平台适配

Laya通过现有LayaInferencePort接受有限choice问题，候选描述/身份、快照版本、deadline与取消由可信宿主装配；模型不生成任意执行函数、凭据、scopeRef或主任务终态。内服务鉴权只用受信宿主配置，不能进入Renderer/公开Evidence。ModelGateway统一国内MaaS执行调用；不能把Laya端口冒充原生function calling。

平台Inference Target、MCP协议协商/目录、Knowledge原文来源、OTel trace及evaluation结果都作为外部输入验证。KnowledgePort当前source形状为vaultId/path/line/revision，云来源需真实映射或版本化契约扩展；不能私造DTO。平台MCP gateway和Runtime入站WSS gateway职责不同，工具仍经既有ToolGateway。Trace是观测，评分是评估，二者不替代实际执行读回/Evidence。
