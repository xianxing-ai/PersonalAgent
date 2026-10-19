# 比赛知识链路：公开演示资料

<!-- current-design-20261015 -->
> 当前设计与协作入口：[当前详细设计](../../design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../design/WORKFLOW_STATUS_20261015.md) · [接口目录](../../interfaces/CURRENT_INTERFACE_CATALOG.md) · [模块分工](../../MODULE_ASSIGNMENTS.md) · [协作规则](../../../CONTRIBUTING.md)。当前协作者：zemeng5208、goo122、Potatos498、2511375597-lab；常规 PR 须取得一名合资格非作者对当前 head 的有效批准，Owner 对具体 PR 的审核例外须留记录且不豁免必需技术 CI。主线同步、无冲突及阻断项处理均为合并前提。Competition 设计路径由 AgentArts 承担构建、Agent/Workflow 编排、评估与部署；Laya 仅限 Local Profile，本轮不扩展，代码实现与真实验收另行核实。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`vault/` 中的内容由本项目为演示新写，全部为虚构示例；不摘录第三方作品、真实人员、账号或私人 Vault。允许在本项目的公开文档与比赛演示中展示。

可信宿主只能显式把 `vault/` 作为只读根目录注入 `knowledge.search`；本目录不会自动注册为生产知识源。当前集成测试使用 Fake Coordination 和注入的 HTTP 响应验证 AgentArts JSON 适配器，不调用真实 AgentArts。公开资料也不代表已授权真实付费云调用。
