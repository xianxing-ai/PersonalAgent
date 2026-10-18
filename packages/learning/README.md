# @personal-agent/learning — provisional workflow candidate lifecycle

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

This Competition Profile package stores descriptive workflow candidates. It does not
execute steps, call tools, train a model, or register a Runtime/Desktop capability.

`SqliteLearningHost.propose()` appends an immutable version with source and operation
identity. Exact retries return the same version; a stale head or altered retry fails.
An injected, trusted `WorkflowValidatorPort` must return a pass plus an evidence
reference before `activateVersion()` can select that version. A failed validation
cannot activate it; a validator exception leaves it a candidate. A later validated
version can be activated, and an older validated version can be selected again to
roll back. Each switch has a durable, idempotent activation receipt.

`eraseWorkflow()` removes all candidate versions, validation references and
activation history for one exact workflow after a head revision check. It leaves a
content-free marker to prevent ID reuse and requires a successful WAL truncate before
reporting success. `secure_delete=ON` applies to writes by this host. Previously freed
pages and independent backup copies are outside this guarantee. No real user source,
authorization, production validator, or external readback has been supplied yet;
test validators are synthetic.

The package uses its own SQLite file and ordered migrations through
`@personal-agent/storage`. Do not share the file with another module's migration
sequence. The host is a trusted local API, not a consumer or wire protocol.

```powershell
npm.cmd run build --workspace=@personal-agent/learning
npm.cmd run test --workspace=@personal-agent/learning
```
