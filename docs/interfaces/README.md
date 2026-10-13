# 接口文档

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本目录是跨模块接口状态、兼容范围和可用性判定的唯一登记入口。接口在源码中出现、能够编译或存在 Fake，均不自动等于已冻结或生产可用。

当前只实施[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)，Local Profile 仅可选留存现有代码且当前不新增。部署 profile 的优先级不提升接口状态；AgentArts 在真实部署、API、trace 和本地可信工具闭环完成前仍为 `unavailable`。

- [当前接口目录与冻结登记](CURRENT_INTERFACE_CATALOG.md)：当前公开操作、TypeScript 端口、冻结证据、运行时可用性及未提供接口。
- [公共开发协议](../DEVELOPMENT_PROTOCOL.md)：请求、状态、授权、副作用与兼容性语义。
- [Runtime 查询接口](../modules/RUNTIME_QUERY_API.md)：PR #34 交付的任务、会话和审批恢复查询。
- [独立开发接口请求](../modules/zemeng-interface-freeze-request.md)：F01～F10 的历史请求、已交付项和剩余工作。

任何接口状态变化必须同时更新本目录、对应实现 README、[ROADMAP](../ROADMAP.md) 和实际验证证据。
