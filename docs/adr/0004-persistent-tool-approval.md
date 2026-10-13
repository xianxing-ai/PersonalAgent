# ADR-0004：持久授权、工具证据与审批恢复

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：Huawei ICT AgentArts Competition Profile 与可选 Local Profile；云端工具提案必须复用本 ADR 的持久审批和结果核实语义。

- 状态：accepted（PR #26 已由非作者评审并合并）；真实模型工具能力仍为 `provisional`。
- 负责人：goo122。

Runtime 继续拥有唯一任务数据库。Policy 消费事务存储端口，SQLite 适配由 Runtime 注入；原有内存策略保留供隔离测试。授权读校验与次数消费处于同一事务，重启不会重置次数。撤销删除授权记录，审批记录单独保留。

Runtime 在调用工具前持久化运行标识和输入摘要，执行结束后将结果检查点与执行记录原子保存。同一运行标识只重放已确认结果，未知执行转入待核实，不自动重发。工具结果检查点属于本地任务数据，公开 Evidence 只返回状态摘要，不返回参数、正文或密钥。

Runtime Application 创建审批，Agent 保存原提案及步骤预算检查点后暂停。公开 authorization.respond 按 revision 幂等处理，允许一次后恢复同一提案，拒绝则取消任务。连接器只在 ToolGateway 授权后执行。重启后可重新提交相同审批响应以继续已批准任务。

盘古工具调用使用显式启用的文字 JSON 提案适配器，字段与工具参数经过验证；这不表示盘古原生支持 function calling。真实能力仍需单独验证。当前无流式 wire 事件，保留非流式输出；多 Agent 委派保持后续 PA-012 工作范围。

本 ADR 接受的是持久授权、证据和恢复的本地架构语义，不等于盘古已能调用工具。当前接口冻结状态及真实验收缺口以[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)为准。

本变更新增内部端口及数据库迁移，不改变 wire 1.0.0 的公开字段。现有 Desktop 通过显式 `--weather-tools` 启用天气组合入口，审批沿用既有后台页面。
