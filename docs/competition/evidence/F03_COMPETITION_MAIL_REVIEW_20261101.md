# F08 私密来源变化到 F03 Competition 审查

目标为 `huawei_ict_agentarts`。新增内部 provisional 来源类型 `competition_workflow`，只消费原配置图 F03_N02 的实际选择和原 Policy 工具回执，复用 `prepareReviewedRepair`、`cognition.commit_repair` 与原 CoordinationStore CAS。旧 `goal_review`/Laya 来源继续使用旧契约；不制造旧审查检查点，不新增任务库、调度器或授权层。

F08 原变化、用户曾明确选择的 Plan、私密 Fact 的失效版本和已完成 impact receipt 必须逐项读回。新 F03 请求只有原来源引用，不能指定任意 Plan。没有原 Plan/Fact 映射仍为 `requires_review`。现有最小修复算法只重新绑定同一依赖身份；失效 Fact 没有有效替代版本时不可偷偷删除依赖，原邮件副作用保留。

私密来源不变为 public。F03 初始上下文、每个回执和最终结果仍分别经过原出口确认。模型选择不授权 CAS，CAS 必须再次独立经过 Policy，并在等待审批后同步核对原来源、选择、期限、撤销和图 revision。未知 CAS 只读原历史图和执行身份，不重放；取消终态不重开。

兼容：新增只读 source/reference 和 repair 请求分支；无 SQLite schema 迁移。配置摘要更新使旧配置不能消费新回执。真实 AgentArts、邮箱和完整 F08→F03 现场验收尚未据本增量声明通过；本文件随必要本地检查补证。

## 必要本地检查

`npm run build --workspace=@personal-agent/runtime` 通过。新增 `apps/runtime/test/f03-competition-review.test.mjs` 单例通过：实际 Runtime/SQLite/独立原审批/CAS，原选择完成后图仍为 revision 3，第二张 CAS 审批后为 revision 4；来源替换拒绝；关闭重开 SQLite 后只读相同历史回执，原 CAS 执行记录始终一条。该例的 configured binding 和候选选择为明确 Fixture，不是 AgentArts 整图或实际邮件验收。

稳定接口：`sourceChanges.readReviewSource({graphTaskId,readRunId},context,atGraphRevision?)` 仅返回原私密来源的可核查投影；`readF03CompetitionReview(application,scope,source)` 从原 N02 回执产生 Competition 修复来源；`localRepair.competitionSource.resolve` 是同步写前源门；`readCompetitionWorkflowRepairReceipt(runtime,{taskId,sourceTaskId,sourceOperationId})` 只读原 CAS。未知结果不自动执行第二次，仍须后续原恢复入口核实。

F03 图工厂、原请求受理和 F08 N13 生产组合继续单独增量，不把本段 CAS 验证称为全部接线完成。缺有效替代 Fact 时仅能保留 `requires_review`，不删除原依赖。

## 原配置图工厂增量

`createF03MailReviewWorkflowPorts` 返回原 `configuredWorkflowWorkerPorts`、真实 host/guard 工具与 `competitionSource`；Main 追加 pinned image 并把后者注入原 localRepair。F03_N07～N10 使用原条件 guard，未提出补偿时不得擅自发送补偿动作。N03 的实际 CAS 与 N04 按新 Plan 版本受理依然是原 Runtime 路径，`scheduled` 仅表示受理，不表示后续计划完成。

可选 `readDecisionConfiguration(scope)` / `assertDecisionConfiguration(binding,scope)` 消费原 F23 配置，版本和顶层 `executionModel` 一次固定；未启用时沿用原模型入口，不造版本。新增 `f03-native-admission.ts` 复用原用户委派和 configured graph：只固定来源引用，之后必须得到原图确认回执才可总结，不许在总结阶段另发工具。RuntimeApplication 的 native 方法及 Main 注入由根集成。

新增 `apps/desktop/test/f03-mail-review-workflow.test.mjs` 单例通过：actual Engine/Runtime/SQLite/AuthorizationQuestions/Policy，N05/N02/N03/N06/N04 原回执及 N07/N08 条件读回，保留原效果并明确 `requires_review`；无 CAS、无邮件重发。初始、回执、完成出口分别消费；原配置随图输入固定。私密来源、候选选择、云、用户答卡响应为 Fixture。`npm run build --workspace=@personal-agent/agentarts` 通过。没有重跑已过矩阵或声称实机 AgentArts 验收。

## F08 消费与原受理恢复

`createBusinessWorkflowWorkerPorts` 新增 `f03MailReview` 注入。原 N10/N07/N13 的真实来源变化先保存既有变化/Fact/impact，再调用 `f03MailReview.submitChange(scope,result)`；只对实际 `reviewReference` 受理原 F03。没有原 Plan/Fact 映射时返回明确 `requires_review`，不自动选计划，不因已受理 F03 就把原 F08 未完成写入标成功。

N13 生产入参为 `{}`，可选 `resolveChange(scope)` 从原 Runtime 检查点提供 `changeReason/priorOperationId`，旧显式参数合同保留兼容。该变化使用 F08 配置 `business-20261101-f08-v4`，拒绝旧摘要。N13 仍沿独立 Policy 和原回执出口；后续发生变化的旧 F08 可以停止，同时保留真实副作用及独立 F03 审查任务。

会话控制补 `sourceActions.readReview({taskId},context)` 与 `submitReview({taskId,reviewId,commandId},context)`。前者仅沿原会话任务发现源，后者原 native 确认后复核版本；Renderer 不填内部 graph/session/操作引用。缺映射时 `canSubmit:false`、原原因明确，提示现有计划入口，不产生任意 Plan。Main 需注入 `f03MailReview` 与 `confirmReview(details,scope)`，scope 含原 deadline/signal/assertCurrent/control。

新增 `apps/desktop/test/f03-native-admission.test.mjs` 单例通过：使用根 `7cce7cd3` 的实际 Runtime native 入口（本隔离树依赖同步为 `3f5efdea`），模拟首次已受理后的回执丢失；同源重试只读原任务，同 key 替换 source 拒绝；原委派固定 source，原图仅一次请求；取消后 SQLite 重开仍读原状态，不重新提交。私密来源与 image transport 故障是 Fixture，真实邮箱/云未验。只运行此新增关键检查和必要 Runtime build，没有重跑旧图/全仓矩阵。
