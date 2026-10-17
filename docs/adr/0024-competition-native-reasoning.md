# ADR-0024：Competition 辅助模型的原生思考配置

日期：2026-10-13。状态：proposed；本工作包实现及离线验证不提升真实能力或接口冻结等级。

## 背景

PR #347 的 F28 将原生思考、Agent 步骤预算和验证强度分开。主线已有 ModelGateway、配置化子模型工厂和配置版本恢复，但文本 Provider 只发送 `reasoning_effort` 和 `max_tokens`，不能表示原生思考开关及不同输出预算字段。

## 决定

- 仅为 `huawei_ict_agentarts` 的既有辅助子任务入口增加受信 `nativeReasoning` 配置，复用 ModelGateway、StructuredToolProvider、TaskRuntime 和 Desktop 加密模型配置。
- 配置包含 `thinking: enabled|disabled`、可选 `effort`、显式 `supportedEfforts` 和 `outputTokenParameter: max_tokens|max_completion_tokens`。不根据模型名称猜能力，不建立品牌许可名单。
- 原生配置由用户在模型设置中确认，绑定目的地、模型与配置版本。原生配置存在时，子任务 `thinkingDepth` 只控制步骤预算，不覆盖原生配置；旧配置的 depth→effort 映射保持原行为。
- Provider 在读凭据或发送请求前拒绝未声明的 effort、关闭思考与 effort 的冲突，以及不支持的 `thinkingBudget`。输出预算只映射一个字段，不同时发送两者。
- 原生配置写入安全能力说明与子任务模型绑定；恢复时配置版本或原生配置变化即拒绝，不更换模型、不切换 Local、不重新签发授权。
- 只支持当前 OpenAI compatible 辅助模型路径；Pangu 历史适配和默认 AgentArts Worker 不改变。原生 function calling、思维链展示和真实模型验收不在本包。

## 兼容与迁移

新增配置和 TypeScript 能力字段均为可选，不新增 wire capability、Schema、数据库迁移或依赖。旧加密记录正常恢复；每次配置修改沿用现有新 bindingId 和撤销在途调用机制。无原生配置时请求字段保持旧语义。不扩大 16000 字符公共输入边界。

`max_completion_tokens` 表示包含思考在内的输出上限，不能解释为独立 thinkingBudget。返回能力保持 conditional；供应商文档不证明当前账户或区域可用。

## 替代方案与复审

不采用模型名自动映射，因为同名模型的区域、端点和版本支持可能不同；不新增 Provider/角色注册体系。未来支持动态逐任务原生控制时，先明确公开契约和用户确认语义。真实验收仍待对应授权。

依据：[PR #347](https://github.com/zemeng5208/PersonalAgent/pull/347)、[华为 MaaS 参数说明](https://support.huaweicloud.com/model-call-maas/model-call-019.html)。
