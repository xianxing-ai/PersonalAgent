# ADR-0003：Runtime 控制任务与工具执行

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
