# F08 私密来源变化到 F03 Competition 审查

目标为 `huawei_ict_agentarts`。新增内部 provisional 来源类型 `competition_workflow`，只消费原配置图 F03_N02 的实际选择和原 Policy 工具回执，复用 `prepareReviewedRepair`、`cognition.commit_repair` 与原 CoordinationStore CAS。旧 `goal_review`/Laya 来源继续使用旧契约；不制造旧审查检查点，不新增任务库、调度器或授权层。

F08 原变化、用户曾明确选择的 Plan、私密 Fact 的失效版本和已完成 impact receipt 必须逐项读回。新 F03 请求只有原来源引用，不能指定任意 Plan。没有原 Plan/Fact 映射仍为 `requires_review`。现有最小修复算法只重新绑定同一依赖身份；失效 Fact 没有有效替代版本时不可偷偷删除依赖，原邮件副作用保留。

私密来源不变为 public。F03 初始上下文、每个回执和最终结果仍分别经过原出口确认。模型选择不授权 CAS，CAS 必须再次独立经过 Policy，并在等待审批后同步核对原来源、选择、期限、撤销和图 revision。未知 CAS 只读原历史图和执行身份，不重放；取消终态不重开。

兼容：新增只读 source/reference 和 repair 请求分支；无 SQLite schema 迁移。配置摘要更新使旧配置不能消费新回执。真实 AgentArts、邮箱和完整 F08→F03 现场验收尚未据本增量声明通过；本文件随必要本地检查补证。

## 必要本地检查

`npm run build --workspace=@personal-agent/runtime` 通过。新增 `apps/runtime/test/f03-competition-review.test.mjs` 单例通过：实际 Runtime/SQLite/独立原审批/CAS，原选择完成后图仍为 revision 3，第二张 CAS 审批后为 revision 4；来源替换拒绝；关闭重开 SQLite 后只读相同历史回执，原 CAS 执行记录始终一条。该例的 configured binding 和候选选择为明确 Fixture，不是 AgentArts 整图或实际邮件验收。

稳定接口：`sourceChanges.readReviewSource({graphTaskId,readRunId},context,atGraphRevision?)` 仅返回原私密来源的可核查投影；`readF03CompetitionReview(application,scope,source)` 从原 N02 回执产生 Competition 修复来源；`localRepair.competitionSource.resolve` 是同步写前源门；`readCompetitionWorkflowRepairReceipt(runtime,{taskId,sourceTaskId,sourceOperationId})` 只读原 CAS。未知结果不自动执行第二次，仍须后续原恢复入口核实。

F03 图工厂、原请求受理和 F08 N13 生产组合继续单独增量，不把本段 CAS 验证称为全部接线完成。缺有效替代 Fact 时仅能保留 `requires_review`，不删除原依赖。
