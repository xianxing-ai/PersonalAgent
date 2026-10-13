# ADR-0013：常驻自主目标、Wiki 记忆与双通道

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

日期：2026-10-09。状态：产品方向已由用户确认；详细实现 proposed，未冻结接口或宣称真实可用。

## 决定

- 电脑运行时，系统在无人监管条件下观察已授权世界变化，增量修复计划并委派执行和监管任务。
- AgentArts 自有镜像承担语义编排；本地 Runtime 维护状态、Policy/Approval、ToolGateway、读回与 Evidence，不引入独立云电脑。
- 本地到 AgentArts 使用 WSS 主通道，HTTPS 同语义备用；降级可见，同部署/任务/幂等标识，未知副作用先协调，不切换另一 Profile。
- Laya 在有限合法候选中辅助结构化判断、弃权和升级，不签发授权；领域校准与用户设置待实现。
- Wiki 接入长期记忆，MOD-08 管理知识正文/版本，MOD-09 管理来源绑定投影和变化流，由 goo122 实施；MOD-27/28 通过公开端口消费。
- 两位协作者完成版本绑定本机阅读确认与审批后才可合并，禁止强制合并与管理员绕过，具体流程见阅读门槛文档。

## 兼容及当前状态

当前镜像公开接口是 HTTP `/ping`、`/invocations`；WSS、自动备用切换和 Wiki 自动同步为待实施目标，不因提交该 ADR 自动可用。ADR-0012 的自有镜像、现有公共端口、数据库记录与无静默回退边界继续有效。

不新增第二任务库，不把 Wiki 当权限或任务终态源，不把模型总结当 verified。跨 Wiki 文件与 SQLite 投影采用持久协调，不承诺天然原子性；现有会话写/出机许可不升级为永久许可。

## 依据与交付

[完整设计](../design/resident-developer-agent-20261008/DESIGN.md)、[Wiki 交接](../design/resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md)、[两人阅读门槛](../reviews/DESIGN_READING_GATE.md)。39 模块完成度为源码/记录工程估算，估算基线 2026-10-08；新增设计不提高百分比。
