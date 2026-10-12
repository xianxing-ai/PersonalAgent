# 文档

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

这里存放项目设计文档、接口约定、技术决策记录和开发说明。项目已有可运行模块；能力是否完成以进度和实际验收证据为准。

- [华为 ICT AgentArts Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：当前唯一实施的参赛架构、比赛与可选 Local 边界、云—本地信任边界和验收矩阵。
- [自有镜像资源绑定](competition/OWNED_IMAGE_BINDINGS.md)：8个Workflow与3个Controller的目录、调用、前置报告和实际执行边界。
- [PRD](PRD.md)：27 项产品需求与验收标准，包含版本化世界状态、持续认知和 AgentArts 边界。
- [模块分工](MODULE_ASSIGNMENTS.md)：32 个主模块及 MOD-04A/04B 独占工作面；`Potatos498` 的 MOD-20～26 不变。
- [当前接口目录](interfaces/README.md)：接口冻结状态、生产可用性、证据与 unavailable 清单。
- [公共开发协议](DEVELOPMENT_PROTOCOL.md)：消息、状态、工具、授权、连接器及联调规范。
- [架构](ARCHITECTURE.md)：技术与进程边界。
- [项目目录规范](PROJECT_STRUCTURE.md)：目录职责、依赖方向、新模块结构与测试放置规则。
- [架构决策记录](adr/README.md)：已采纳的长期架构决定，包括分层冻结、AgentArts 本地信任边界和 Competition Profile 优先级。
- [模块设计模板](modules/README.md)：新模块开工模板。
- [进度](ROADMAP.md)：执行状态、开工顺序与旧任务映射。
- [协作规范](../CONTRIBUTING.md)：认领、分支、评审与完成标准。

建议重要决策记录以下内容：背景、候选方案、最终决定、取舍和后续影响。

所有模块文档必须声明适用 profile。Competition Profile 是当前唯一新增能力和验收路径；Local Profile 仅留存现有本地 Agent、模型网关、Provider 和既有测试，当前不新增、不扩展，也不因参赛架构被删除。
