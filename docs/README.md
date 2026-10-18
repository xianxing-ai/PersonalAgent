# 项目文档

<!-- current-design-20261009 -->
> 当前入口：[详细设计](design/CURRENT_DESIGN_20261015.md) · [逐图状态](design/WORKFLOW_STATUS_20261015.md) · [当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) · [历史设计导航](design/README.md)。协作者 zemeng5208、goo122、Potatos498、2511375597-lab 的审批与 Owner 逐 PR 审核例外按 [CONTRIBUTING](../CONTRIBUTING.md) / [AGENTS](../AGENTS.md)；必需技术 CI 不豁免。设计、代码合入与真实验收分别记录，旧阅读/合并规则不作为当前门槛。

当前主架构文档来自 2026-10-13 方案；本机 Laya 已确认为本地运行方案，外部比赛资格及真实平台验收仍须核证。阅读顺序如下：

| 文档 | 回答的问题 |
| --- | --- |
| [当前设计与状态](CURRENT_DESIGN_CONTEXT.md) | 方向、代码基线和未完成事项 |
| [PRD](PRD.md) | 用户能力、需求编号与验收 |
| [主架构](design/workflow-architecture-20261013/DESIGN.md) | 唯一决策、并行图、语音、记忆、影子与云/本地边界 |
| [工作流](design/workflow-architecture-20261013/WORKFLOWS.md) | 28功能全部185个详细节点和条件/恢复边；总图另有12个共享节点，40个总览节点、130条关系，展开为225个节点 |
| [总图](design/workflow-architecture-20261013/index.html) | 全部功能在一张图上的连接 |
| [架构契约](ARCHITECTURE.md) | 工程模块、依赖与事实来源 |
| [公共协议](DEVELOPMENT_PROTOCOL.md) | 已发布Schema和待适配设计的关系 |
| [接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) | frozen/provisional/unavailable与证据 |
| [模块分工](MODULE_ASSIGNMENTS.md) | 39模块与负责人 |
| [目录规范](PROJECT_STRUCTURE.md) | 实际workspace与测试位置 |
| [Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) | AgentArts实施路径和比赛验证 |
| [重构接线](design/workflow-architecture-20261013/IMPLEMENTATION.md) | 兼容迁移、工作包和验证 |
| [ROADMAP](ROADMAP.md) | 实际执行状态与历史记录 |
| [ADR](adr/README.md) | 长期决定和替代关系 |
| [协作规则](../CONTRIBUTING.md) | 审查、交付与合并 |

[文档清单](design/workflow-architecture-20261013/DOCUMENTATION_INVENTORY.md)覆盖当前规范、模块API说明、历史设计与验收。Competition Profile 的目标链路经 CloudAgentPort 调用 AgentArts，设计由 AgentArts 承担 Agent/Workflow 编排、评估与部署；Local Profile 保留既有及已授权增量能力，不作为比赛失败后的隐式回退。历史实验与验收仍按原范围记录，不代表当前比赛路径已完成。

这里存放项目设计文档、接口约定、技术决策记录和开发说明。项目已有可运行模块；能力是否完成以进度和实际验收证据为准。

- [华为 ICT AgentArts Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：当前参赛目标架构、本机 Laya 与 Local Profile 的边界、云—本地信任边界和验收矩阵。
- [自有镜像资源绑定](competition/OWNED_IMAGE_BINDINGS.md)：8个Workflow与3个Controller的目录、调用、前置报告和实际执行边界。
- [PRD](PRD.md)：27 项产品需求与验收标准，包含版本化世界状态、持续认知和 AgentArts 边界。
- [模块分工](MODULE_ASSIGNMENTS.md)：主模块、MOD-04A/04B 工作面及 DEV-WORKFLOWS 的负责人、文件所有权与交付边界。
- [当前接口目录](interfaces/README.md)：接口冻结状态、生产可用性、证据与 unavailable 清单。
- [公共开发协议](DEVELOPMENT_PROTOCOL.md)：消息、状态、工具、授权、连接器及联调规范。
- [架构](ARCHITECTURE.md)：技术与进程边界。
- [项目目录规范](PROJECT_STRUCTURE.md)：目录职责、依赖方向、新模块结构与测试放置规则。
- [架构决策记录](adr/README.md)：长期架构决定及各自 proposed/accepted 状态，包括分层冻结、AgentArts 本地信任边界和 Competition Profile 优先级。
- [模块设计模板](modules/README.md)：新模块开工模板。
- [进度](ROADMAP.md)：执行状态、开工顺序与旧任务映射。
- [协作规范](../CONTRIBUTING.md)：认领、分支、评审与完成标准。

建议重要决策记录以下内容：背景、候选方案、最终决定、取舍和后续影响。

所有模块文档必须声明适用 profile。Competition Profile 是当前比赛新增能力与验收主路径；通用 Local Profile 保留既有 Agent、模型网关、Provider 和测试，不因参赛架构删除。已明确授权的 DEV-WORKFLOWS Local 增量按 MODULE_ASSIGNMENTS 保留其范围，其他新增 Local 能力须有对应明确授权。
