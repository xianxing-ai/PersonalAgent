# 架构决策记录

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

ADR 记录已经采纳且会长期影响多个模块的决定。编号递增，合并后不重写历史；后续决策使用新的 ADR 标记替代关系。

当前只实施 Huawei ICT AgentArts Competition Profile，Local Profile 仅可选留存现有代码且当前不新增。ADR-0001～0006 的通用边界继续适用，ADR-0007 规定比赛主路径和当前范围。

每份 ADR 包含：状态、背景、决定、理由、影响、替代方案和复审条件。

- [ADR-0001：采用模块化单体](0001-modular-monolith.md)
- [ADR-0002：依赖方向与应用装配](0002-dependency-direction.md)
- [ADR-0003：Runtime 控制任务与工具执行](0003-runtime-authority.md)
- [ADR-0004：持久授权、工具证据与审批恢复](0004-persistent-tool-approval.md)
- [ADR-0005：采用分层接口冻结与显式不可用状态](0005-layered-interface-freeze.md)
- [ADR-0006：核心认知依赖倒置与 AgentArts 本地信任边界](0006-coordination-and-agentarts-boundary.md)
- [ADR-0007：华为 ICT AgentArts Competition Profile 优先](0007-huawei-ict-agentarts-competition-profile.md)
- [ADR-0012：自有 AgentArts 镜像](0012-owned-agentarts-image.md)
- [ADR-0013：常驻助手、Wiki 与双通道](0013-resident-agent-wiki-wss.md)
- [ADR-0014：AgentArts WSS 主通道](0014-agentarts-wss-transport.md)
- [ADR-0015：自有镜像 Workflow/Controller 可执行绑定](0015-owned-workflow-controller-bindings.md)
