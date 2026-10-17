# 接口文档

当前协作者按 [具体接线包](../competition/COLLABORATOR_WIRING_PACKAGE.md) 自行完成提供者和实际消费方接线、必要测试、Evidence及文档。入口状态以 [目录最新增量](CURRENT_INTERFACE_CATALOG.md) 为准，不能把历史全局不可用或新目录存在当逐能力完成。

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-15）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 需四位协作者中任意一位非作者对当前提交的有效批准；Owner 可对具体 PR 作有记录的审核例外。拥有合并权限者（包括作者）可在最新必需技术 CI、主线更新、冲突及阻断意见解决后合并；四位协作者跨 PR 均衡承担评审与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本目录是跨模块接口状态、兼容范围和可用性判定的唯一登记入口。接口在源码中出现、能够编译或存在 Fake，均不自动等于已冻结或生产可用。

当前只实施[华为 ICT AgentArts Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)，Local Profile 仅可选留存现有代码且当前不新增。部署 profile 的优先级不提升接口状态；AgentArts 按具体能力登记：当前SWR/云版本目录及真实代理有独立回执；平台MCP/知识/trace/评估与远端完整业务链不能整体提升。未绑定具体provider的能力仍为 `unavailable`。

- [当前接口目录与冻结登记](CURRENT_INTERFACE_CATALOG.md)：当前公开操作、TypeScript 端口、冻结证据、运行时可用性及未提供接口。
- [公共开发协议](../DEVELOPMENT_PROTOCOL.md)：请求、状态、授权、副作用与兼容性语义。
- [Runtime 查询接口](../modules/RUNTIME_QUERY_API.md)：PR #34 交付的任务、会话和审批恢复查询。
- [独立开发接口请求](../modules/zemeng-interface-freeze-request.md)：F01～F10 的历史请求、已交付项和剩余工作。

任何接口状态变化必须同时更新本目录、对应实现 README、[ROADMAP](../ROADMAP.md) 和实际验证证据。
