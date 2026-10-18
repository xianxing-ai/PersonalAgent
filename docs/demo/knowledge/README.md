# 比赛知识链路：公开演示资料

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`vault/` 中的内容由本项目为演示新写，全部为虚构示例；不摘录第三方作品、真实人员、账号或私人 Vault。允许在本项目的公开文档与比赛演示中展示。

可信宿主只能显式把 `vault/` 作为只读根目录注入 `knowledge.search`；本目录不会自动注册为生产知识源。当前集成测试使用 Fake Coordination 和注入的 HTTP 响应验证 AgentArts JSON 适配器，不调用真实 AgentArts。公开资料也不代表已授权真实付费云调用。
