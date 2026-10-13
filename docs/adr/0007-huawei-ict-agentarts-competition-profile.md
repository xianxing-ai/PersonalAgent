# ADR-0007：华为 ICT AgentArts Competition Profile 优先

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 状态：accepted
- 日期：2026-09-09
- 决策者：产品负责人（用户）
- 负责人：`zemeng`（Competition Profile 与 AgentArts）；`goo122`（共享 Runtime/端口）；`Potatos498`（业务连接器）

## 背景

项目参加华为 ICT 大赛创新赛道，并选择“基于华为云 AgentArts 智能体开发平台的 Agent 设计和应用”赛题。ADR-0006 已确定 AgentArts 不能继承本地授权或决定本地任务终态，但把它描述为通用架构中的可选云端 Provider，尚未表达参赛版本必须让 AgentArts 真正承担智能体构建、编排与部署。

现有 `runAgent()`、`ModelGateway`、盘古和自有模型适配仍有通用产品、本地开发、测试、Benchmark 与消融实验价值，不应因参赛架构被删除。

## 决定

采用两个显式部署 profile：

1. `huawei_ict_agentarts`：华为 ICT 创新赛当前唯一实施、交付和正式 Demo 路径。AgentArts 是智能体构建、Workflow/Agent 编排、评估与云端部署平台；不能只是装饰性 API。
2. `local`：只保留现有 Local Agent、`runAgent()`、`ModelGateway` 与 Provider 作为可选历史基线；当前不新增、不扩展、不纳入比赛退出条件。以后启用须由产品负责人另行明确。

两个 profile 共用 PersonalAgent 的 Runtime、世界状态/Memory/Goal/Event、Policy、Approval、ToolGateway、Connector、Evidence、Desktop 与 Voice。AgentArts 只产生文本、计划、工具提案和云端 trace；本地 Runtime 仍拥有权限校验、真实执行、目标系统读回和任务终态。

Competition Profile 不能在正式评测或证据记录中静默回退 Local Profile。AgentArts 尚未接通时应明确显示 `unavailable`。

## 影响

- 当前新增工作只交付 AgentArts Adapter、部署、API、Golden Path 和评估证据；Local 现有代码可继续构建和运行既有测试，但当前不产生新增兼容性或功能交付义务。
- `ModelGateway` 与自有模型不删除；只有在 AgentArts 支持的 API/MCP/Skill 路径实测后，才能宣称 Competition Profile 可调用它们。
- 桌面与 Evidence 必须标注实际运行 profile、AgentArts deployment/version 与 trace，避免把本地结果冒充比赛路径。
- 本 ADR 固定职责和信任边界，不冻结尚未交付的 `CoordinationPort`、`CloudAgentPort` 或外部 AgentArts API。
- 详细架构、顺序和验收见[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)。

## 未选择的方案

- 删除 Local Agent 和 ModelGateway：会破坏通用产品、离线测试和对照实验能力。
- 继续把 AgentArts 仅作为可选装饰性 Provider：不能证明所选赛题要求的构建、编排与部署价值。
- 把权限、凭据、Windows 控制和任务终态迁到云端：扩大隐私与安全风险，并破坏现有 Runtime 权威边界。
- 在没有平台实测前假定 AgentArts 可直接调用本机模型或工具：会把网络、身份和协议假设写成事实。
