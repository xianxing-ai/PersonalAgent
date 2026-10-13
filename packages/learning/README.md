# @personal-agent/learning — provisional workflow candidate lifecycle

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
