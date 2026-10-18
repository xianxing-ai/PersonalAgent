# 架构决策记录

<!-- current-design-alignment-20261015 -->
> 2026-10-15适用性：本页保留原日期、作者与accepted/proposed决定；仍适用的Runtime/权限/依赖边界不被撤销。
> 冲突的部署、默认模型、发布、完成事实及旧协作门槛已由[当前设计](../design/CURRENT_DESIGN_20261015.md)更新（superseded），
> 不把历史未验状态套到当前，也不把ADR存在当当前验收。[全部设计导航](../design/README.md)；当前接口另见[目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。


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
- [ADR-0023：本机 Skill 安装与 Competition 使用（proposed）](0023-local-skill-installation.md)
- [ADR-0024：Competition 辅助模型原生思考配置（proposed）](0024-competition-native-reasoning.md)
- [ADR-0025：Competition 编译上下文版本与预算绑定（proposed）](0025-competition-context-binding.md)
- [ADR-0029：远程 MCP 的首个只读传输纵片（proposed）](0029-remote-mcp-readonly-transport.md)
- [ADR-0030：本机 Laya、镜像串行工作流与外部宿主接口（实验候选，未定稿）](0030-local-laya-serial-image-workflows.md)
- [ADR-0033：镜像内编码最小修复与 F15 多轮工作流（实施中）](0033-coding-minimal-repair-workflow.md)
- [ADR-0031：远程 MCP 的加密宿主配置与会话恢复（proposed）](0031-remote-mcp-host-configuration.md)
- [ADR-0032：远程只读 MCP 的授权绑定与凭据引用（proposed）](0032-remote-mcp-bound-credentials.md)
- [ADR-0012：自有 AgentArts 镜像](0012-owned-agentarts-image.md)
- [ADR-0013：常驻助手、Wiki 与双通道](0013-resident-agent-wiki-wss.md)
- [ADR-0014：AgentArts WSS 主通道](0014-agentarts-wss-transport.md)
- [ADR-0015：自有镜像 Workflow/Controller 可执行绑定](0015-owned-workflow-controller-bindings.md)

- [ADR-0016：Wiki 写回与记忆投影恢复（proposed）](0016-wiki-write-projection-recovery.md)
- [ADR-0022：本机 Wiki 页面身份与读取版本（proposed）](0022-wiki-source-identity.md)

- [ADR-0017：Wiki 只读来源监视（proposed）](0017-wiki-source-monitor.md)
- [ADR-0018：应用记忆备份与临时知识索引（proposed）](0018-managed-backups-and-volatile-index.md)
