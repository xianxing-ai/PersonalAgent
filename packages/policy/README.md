# 授权策略（MOD-05）

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/policy` 提供任务级授权策略。授权绑定 `authorizationRef`、任务、工具、scope、到期时间和可选使用次数、参数摘要；支持立即撤销。工具调用方不能把自报 scope 当作授权。

本包是当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的共享本地信任边界：AgentArts 只能提出动作，不能生成或消费本地授权。正式比赛链路必须经过本策略并保留决策证据；可选 Local Profile 不建立另一套授权体系。

当前策略实现及端口为 `provisional`：任务级持久授权和一次性事务消费已有离线证据，但跨任务持续授权、撤销管理面和真实模型/工具宿主消费尚未完成。冻结状态见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

`AuthorizationPolicy` 消费 `AuthorizationStore` 事务端口；Runtime 注入 SQLite 存储，一次性授权的检查和消费在同一事务内完成，重启不会重置次数。`InMemoryAuthorizationPolicy` 保留为隔离测试实现。授权当前仍绑定单个任务和工具，跨任务持续授权管理不是已完成能力。

验证：

```sh
npm run build --workspace=@personal-agent/policy
npm run test --workspace=@personal-agent/policy
```
