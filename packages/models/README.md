# Models

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-04A（goo122）。产品流程：F23、F27、F28；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用ModelPort/ModelGateway，映射真实供应商能力与原生思考参数，并向F27反馈上下文配置版本。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

MOD-04A（负责人 `goo122`）的模型 Provider 和模型网关实现。`ModelGateway` 只接受显式配置的 Provider，并在请求前校验文本、工具调用和结构化输出能力；Provider 返回的 deployment、verification 和 usage 会随结果保留。当前公开形状为 `provisional`：公开源码已有 `ModelPort = ModelProvider`；调用方具体依赖迁移仍需逐项核对。精确状态见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

通用文本 Provider 与 Agent 仍作为可选 Local Profile 和既有离线测试基线留存，当前不新增、不扩展，也不进入 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的比赛退出条件。既有原生 Live 语音入口经 Runtime 工厂接入 Competition，工具工作仍转交 AgentArts 与原 Runtime；真实语音、模型网络和比赛云端证据分别记录。比赛模型由 AgentArts 支持的 MaaS/模型配置承担。

当前验证等级：

- `FakeModelProvider`：`mock`，仅用于无网络测试。
- `UnavailableModelProvider`：明确返回不可用。
- `PanguModelProvider`：`conditional` 的盘古 V2 文本适配器。使用可信宿主注入的 API Key、base URL 和部署模型；当前不声明流式、工具调用、结构化输出或视觉能力。

模型不能提供 `scopeRef`、凭据或执行函数。工具提案必须由 Agent 根据 Runtime 提供的工具描述重新校验。

`StructuredToolProvider` 是显式的文字 JSON 提案适配器。它将工具目录写入宿主协议提示，严格校验 JSON、提案字段和参数，再交回 Agent；不声明盘古原生 function calling 已验证。Runtime Application 注入工具时为盘古启用该适配。`ModelGateway` 统一强制截止时间与取消，并对非协议异常脱敏；无响应的 Provider 也不能无限阻塞调用。真实盘古→提案→审批→工具→读回→回答尚无完成证据，因此不能把该适配器或 Model/Agent/Tool 链标为冻结。

离线验收和真实验收入口见 [MOD-04/05 验收记录](../../docs/modules/MOD-04-05-ACCEPTANCE.md)。当前流式/Live与PA-012宿主工厂按实际部署和消费状态核对，不由历史离线验收推定全链完成。

Provider 支持盘古原生 `/api/v2/chat/completions` 和 ModelArts MaaS 的 OpenAI 兼容 Endpoint（例如 `https://api.modelarts-maas.com/openai/v1`，适配器会追加 `/chat/completions`）非流式接口。单元测试只注入 Mock fetch，不发起网络请求；真实账号、Endpoint 和模型部署仍需单独授权验证，不能把本地 Mock 结果当作真实连通证据。

`maxOutputTokens` 是可选的本地请求预算。未配置时 Pangu 请求不发送 `max_tokens`，由实际模型服务执行其自身的上下文窗、输出上限和账户限流；显式配置时网关仍校验为正整数并传给 Provider。

## Competition 辅助模型的原生思考配置

PR #347/F28 的首批落地复用 Runtime `createConfiguredSubagentModelGateway`。受信宿主可为 OpenAI compatible 辅助模型传入 `nativeReasoning`：`thinking`（enabled/disabled）、显式 `supportedEfforts`、可选固定 `effort` 和 `outputTokenParameter`（max_tokens/max_completion_tokens）。仅支持声明范围内的 effort；关闭思考时不能同时声明 effort。配置先校验，再读凭据或发送网络请求，不按品牌或模型名猜支持。

配置存在时 Provider 发 `thinking.type`，按声明发 `reasoning_effort`；`maxOutputTokens` 只映射一个输出字段。`max_completion_tokens` 含思考输出，不是单独 `thinkingBudget`。本路径拒绝 thinkingBudget。无配置时保留旧请求字段；Pangu 历史路径不新增原生控制。

能力中的 `nativeReasoning` 是条件性配置说明，经过 StructuredToolProvider 保留；不证明真实原生工具调用、原生思考支持或端点可用。Competition 子任务的步骤档位不覆盖固定原生配置，配置版本与原生说明参与持久绑定。见 [ADR-0024](../../docs/adr/0024-competition-native-reasoning.md) 和 [本包验收](../../docs/modules/MOD-04A-NATIVE-REASONING-20261013.md)。Local Profile 不新增执行入口，真实云验收仍待授权。

## Competition 可见请求预算（provisional）

`OpenAICompatibleModelProviderOptions.requestTokenBudget` 是受信宿主的 `VisibleRequestTokenBudget`，包含 model、tokenizerRef、configurationRef、reservedOutputTokens 与同步 countInputTokens(serializedBody)。必须显式提供 contextLimitTokens，且模型身份一致；声明不是已验证 tokenizer。计量器解析完整 Provider JSON，并按实际模型模板计量输入，不能用字符比例或 JSON 字节数冒充精确 token。

计量位于 StructuredToolProvider 包装之后，包含工具目录、可见系统提示、消息和已确认继续回执。每次调用在凭据之前检查 `inputTokens <= contextTokens - 实际输出预留`，等待凭据后复测；漂移拒绝发送。请求体提前生成且不再读取可变消息。未传 maxOutputTokens 时使用宿主预留，传入值只能收窄；原生声明决定唯一输出字段。历史无计量配置保持字段兼容，ModelResult.requestBudget 明确 unmeasured。

ModelCapabilities.requestTokenBudget 只含版本与预算元数据，ModelResult.requestBudget 记录测量结果；scope 为 provider-body，hiddenContext 始终 unknown，不覆盖平台隐藏提示，也不替代累计 usage。宿主更换模型、tokenizer 或配置时须更换版本并重建网关，Competition 的原子任务恢复比较该声明。没有新增持久正文、wire Schema、迁移或依赖；生产真实计量器尚未注入，Desktop 仅展示绑定一致的最近观测，无观测或重启仍显示未计量。见 [ADR-0026](../../docs/adr/0026-visible-model-request-budget.md)。

Competition 可信宿主可显式选择 `requestFormat:'huawei-maas-deepseek-thinking-v1'`，将既有 MaaS DeepSeek 的 `reasoning_effort:none` 转为 `chat_template_kwargs.thinking:false`，再序列化、计量与发送。Provider 不按域名或模型名推断支持；未声明时保持原行为。格式进入能力、预算和恢复绑定，格式增加/移除使旧提案恢复拒绝。注入 fetch 必须原样传输已计量正文；镜像包装器只拒绝重定向。此兼容转换不证明完整模板或 MaaS tokenizer 匹配，见 [ADR-0028](../../docs/adr/0028-final-visible-request-body.md)。

## 原生 Live 响应生命周期

`QwenRealtimeModelGateway` 保持现有公开请求/会话/事件形状。工具请求关联当前 `response_id`，同一 `call_id` 只执行和回传一次；当前 response 完成且本轮所有工具已回传后才发送一次续答。旧/重复完成事件不能清空新 response 或重复 drain，取消的 response 不被记作完成。

用户打断使旧工具结果失去自动续答资格；已经开始的工作不由网关取消，会话仍有效时结果可回传，不能抢占新问题。关闭、abort 和期限到达后禁止传输；尚未开始的工具不会在关闭后启动。未完成、失败与工具异常保留脱敏错误；本地测试不证明模型不会编造口头结果。

官方 [客户端事件](https://www.alibabacloud.com/help/en/model-studio/client-events) 只公布取消当前 response，未承诺定向取消指定 ID；[服务端事件](https://www.alibabacloud.com/help/en/model-studio/server-events) 的 created/done 使用嵌套 response.id。续答已发送而 created 尚未收到时发生打断，网关停止通话并提示重新开启，原 Runtime 后台任务保留。公开函数和 wire Schema 无变化、无迁移或新依赖。Fake Socket 回归与实际宿主/SQLite 的组合测试见 [交接及验收记录](../../docs/modules/MOD-04A-LIVE-RESPONSE-RECOVERY-20261008.md)；真实 Live 设备与服务验收仍待单独授权。
