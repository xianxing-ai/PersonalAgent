# 模块设计文档

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本目录保存需要补充设计细节的模块文档。负责人和状态仍以 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 与 [ROADMAP](../ROADMAP.md) 为唯一来源，避免维护冲突副本。

当前新增模块只服务[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)；通用 Local Profile 仅留存现有代码，只有产品负责人以后明确启用才产生新增工作。模块文档必须说明目标 profile，不能用 Local/Fake 结果替代 AgentArts 比赛验收。

新模块开工时复制 [模板](TEMPLATE.md)，文件名使用 `MOD-xx-short-name.md`。只需要 README 就能完整说明的简单模块，不重复创建文档。涉及跨模块接口时必须链接[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)，逐项标明 `frozen`、`provisional` 或 `unavailable`；Fake 可运行不等于生产能力可用，Competition 失败后静默回退 Local 不算通过。
