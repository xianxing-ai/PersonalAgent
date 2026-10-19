# @personal-agent/learning — provisional workflow candidate lifecycle

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。
<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-09（goo122）。产品流程：F04、F05、F23、F27；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

提供作用域事实、版本、撤回、投影与流程候选；语义排序和取舍由原受信判断链建议，存储与权限由宿主控制。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

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
