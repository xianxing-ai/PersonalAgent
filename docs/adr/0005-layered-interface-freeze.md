# ADR-0005：采用分层接口冻结与显式不可用状态

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：Huawei ICT AgentArts Competition Profile 与可选 Local Profile；部署优先级不自动提升任何接口的冻结或可用状态。

- 状态：accepted
- 日期：2026-09-09
- 决策者：产品负责人；协议维护：`goo122`；消费评审：`zemeng`

2026-10-07 修订：按用户三人独立交付要求，同行评审为非阻塞建议；冻结仍以契约、实现和验证证据为准。本次不修改 wire 或已冻结接口语义。

## 背景

公共 Schema 已包含任务、工具、连接器、设置和语音等操作，但对应实现与验收成熟度不同。盘古文本 Provider 当前明确不支持原生工具调用和稳定结构化输出；文字 JSON 提案适配只有离线测试。如果把 wire 1.0.0 整体称为冻结，会让消费者误以为 Schema 中的所有能力均已稳定或可用。

## 决定

接口状态采用 `frozen`、`provisional`、`unavailable`、`deprecated` 四级登记，唯一目录为 [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

- 只冻结已经有单一来源、实现、Fake/失败测试、真实消费端、负责人自审和 CI 证据的子集。
- 外部行为会改变接口语义时，冻结还要求真实目标系统闭环。
- Schema 已声明但生产 Host 未公布的 operation 为 `unavailable`。
- Fake、编译和配置存在不能把状态提升为生产可用。
- capability discovery 决定可调用面；UI 不推测未公布能力。

当前只冻结 Core Runtime Profile 1 的消息、任务、会话和审批只读查询子集。模型工具调用、Agent/Tool 执行、连接器、语音、Evidence/Artifact、记忆、持续认知和 AgentArts 不进入冻结集合。

## 影响

- wire 1.0.0 不再被整体描述为“已冻结”或“未冻结”，而是按 profile 和接口逐项登记。
- 已冻结接口在同一主版本内保持兼容；未提供能力统一返回 `UNSUPPORTED_CAPABILITY`。
- 模块可以依赖冻结子集独立开发，同时不会把真实平台缺口隐藏在 Fake 后面。

## 复审条件

每次新增真实 Provider、跨进程 Host 或外部平台闭环时，按冻结门槛复审对应条目；不得顺带提升其他接口状态。
