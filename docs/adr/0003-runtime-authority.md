# ADR-0003：Runtime 控制任务与工具执行

<!-- current-design-alignment-20261015 -->
> 2026-10-15适用性：本页保留原日期、作者与accepted/proposed决定；仍适用的Runtime/权限/依赖边界不被撤销。
> 冲突的部署、默认模型、发布、完成事实及旧协作门槛已由[当前设计](../design/CURRENT_DESIGN_20261015.md)更新（superseded），
> 不把历史未验状态套到当前，也不把ADR存在当当前验收。[全部设计导航](../design/README.md)；当前接口另见[目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。


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
