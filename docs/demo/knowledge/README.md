# 比赛知识链路：公开演示资料

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../design/workflow-architecture-20261013/index.html) · [接口状态](../../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`vault/` 中的内容由本项目为演示新写，全部为虚构示例；不摘录第三方作品、真实人员、账号或私人 Vault。允许在本项目的公开文档与比赛演示中展示。

可信宿主只能显式把 `vault/` 作为只读根目录注入 `knowledge.search`；本目录不会自动注册为生产知识源。当前集成测试使用 Fake Coordination 和注入的 HTTP 响应验证 AgentArts JSON 适配器，不调用真实 AgentArts。公开资料也不代表已授权真实付费云调用。
