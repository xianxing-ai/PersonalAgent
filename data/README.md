# 本地运行数据

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498；审查及合并规则以 [CONTRIBUTING](../CONTRIBUTING.md) 和 [AGENTS](../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

该目录只用于开发环境中的数据库、缓存、检查点和临时运行状态。除本说明外，目录内容默认被 Git 忽略。

该规则同时约束当前 [Huawei ICT AgentArts Competition Profile](../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：个人世界状态、授权、原始 Evidence、凭据和本地执行记录默认留在受信 Runtime；只向 AgentArts 发送完成当前步骤所需的最小脱敏数据或受控引用。Local Profile 仅为可选留存，不形成另一套数据目录或存储事实来源。

- 不保存源码、测试夹具或文档。
- 不提交 SQLite 数据库、WAL、密钥、Cookie、账号标识或私人内容。
- 自动化测试优先使用系统临时目录，并在测试结束后释放资源。
- 可复现的无敏感测试夹具应放在 `tests/fixtures/` 或所属模块的 `test/fixtures/`。
