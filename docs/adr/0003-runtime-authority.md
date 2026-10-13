# ADR-0003：Runtime 控制任务与工具执行

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：Huawei ICT AgentArts Competition Profile 与可选 Local Profile；AgentArts 成为比赛主编排后端不改变 Runtime 的本地执行权威。

- 状态：accepted
- 日期：2026-09-06

## 背景

模型和外部内容不可信，桌面 Renderer 也不应拥有执行权限。任务取消、授权、未知写入结果和恢复需要统一事实来源。

## 决定

模型只能返回最终文本或工具提案。Runtime 持有任务状态和授权上下文，工具必须经 Runtime → Policy → ToolGateway → Connector 执行；真实执行结果决定任务是否完成。

## 影响

- UI 不持有密钥和可信授权。
- 模型不能签发授权或直接调用 Shell/连接器。
- pending/unknown 结果不能显示为成功。
- MCP、Skills、Windows 和未来连接器必须复用同一工具边界。
