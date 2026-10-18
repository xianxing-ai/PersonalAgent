# 比赛知识链路：公开演示资料

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-17）：[完整设计](../../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../design/resident-developer-agent-20261008/index.html) · [当前 PR 审查规则](../../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任意一位非作者对当前 head 有效批准；Owner 对具体 PR 的审核例外须留记录。拥有合并权限者（包括作者）可在最新必需技术 CI、主线同步、无冲突且阻断意见已处理后正常合并；禁止强推、直接推 main 或绕过技术检查。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`vault/` 中的内容由本项目为演示新写，全部为虚构示例；不摘录第三方作品、真实人员、账号或私人 Vault。允许在本项目的公开文档与比赛演示中展示。

可信宿主只能显式把 `vault/` 作为只读根目录注入 `knowledge.search`；本目录不会自动注册为生产知识源。当前集成测试使用 Fake Coordination 和注入的 HTTP 响应验证 AgentArts JSON 适配器，不调用真实 AgentArts。公开资料也不代表已授权真实付费云调用。
