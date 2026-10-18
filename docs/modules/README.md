# 模块设计文档

当前每位MOD负责人自行闭环公开契约、实现、实际调用方接线、必要测试、Evidence/文档，不交中央代验。参见 [全MOD交接清单](CURRENT_MOD_WIRING_HANDOFF.md) 与 [十项新接线包](../competition/COLLABORATOR_WIRING_PACKAGE.md)。本目录历史记录保留各自日期、作者和验收范围；旧集中验收/两人批准条款不作为当前要求。

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 需 goo122、zemeng5208、Potatos498、2511375597-lab 中任意一位非作者对当前提交有效批准；Owner 对具体 PR 的审核例外需在 PR 留记录，不伪称独立批准。有合并权限的协作者（包括作者）可在最新必需技术 CI 通过、严格同步主线、无冲突且阻断性意见已处理后合并；禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本目录保存需要补充设计细节的模块文档。负责人和状态仍以 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 与 [ROADMAP](../ROADMAP.md) 为唯一来源，避免维护冲突副本。

当前新增模块只服务[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)；通用 Local Profile 仅留存现有代码，只有产品负责人以后明确启用才产生新增工作。模块文档必须说明目标 profile，不能用 Local/Fake 结果替代 AgentArts 比赛验收。

新模块开工时复制 [模板](TEMPLATE.md)，文件名使用 `MOD-xx-short-name.md`。只需要 README 就能完整说明的简单模块，不重复创建文档。涉及跨模块接口时必须链接[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)，逐项标明 `frozen`、`provisional` 或 `unavailable`；Fake 可运行不等于生产能力可用，Competition 失败后静默回退 Local 不算通过。
