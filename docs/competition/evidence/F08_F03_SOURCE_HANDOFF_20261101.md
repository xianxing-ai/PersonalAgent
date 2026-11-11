# F08 N13 到 F03 的原来源缺口与最小接线方案

状态：只读核对和方案，未新增生产来源或完成 N13。目标仅 `huawei_ict_agentarts`。基线为业务分支 `1c2dc189`；根确认 F03 没有比 `d9209664` 更新的生产 API。本记录不把邮箱内容改标 public，不新建 Local/Laya 邮件主控、调度、授权或任务库。

## 已有公共能力及实际装配

| 现有路径 / 类型 | 可复用内容与限制 |
| --- | --- |
| `packages/memory/src/index.ts`，`FactVersion` / `FactSensitivity` / `MemoryQueryPort` | Fact 有 `ref,summary,sourceRef,observedAt,validFrom,validUntil,sensitivity,state,confirmation,corrects`；敏感级别含 private。读取是精确版本查询，不构成写入许可或原邮箱来源证明。 |
| `packages/memory/src/feed.ts`，`FactChangeFeedPort` / `FactChangeBatch` / `ConfirmFactChangeBatchRequest` | 原批次含 eventId、FactRef、batchToken、watermark；持久处理后由可信宿主确认，读者无任意 ack。 |
| `packages/memory/src/sqlite.ts`，公开包 `@personal-agent/memory/sqlite` 的 `SqliteMemoryHost.append/bind/bindFeed/confirmFeedBatch` | 存储支持按既有敏感级别绑定，append 校验不可变版本并持久化。它是宿主原语，尚没有把 F08 原邮箱工具回执验证为 private Fact 的生产适配；不能由模型直接提交任意 Fact。 |
| `apps/runtime/src/application/sqlite-fact-projection.ts`，`SqliteFactProjectionHost`；`competition-fact-host.ts`，`CompetitionFactHost` | 前者当前 feed/query **固定 public**；后者 `recordPublicSource(TrustedPublicSource)` 是显式本地 vault/path/sourceRevision 公开来源。不能把邮箱、邮件哈希或私有摘要伪装成这条公开来源。private 原批次投影需要受信固定 scope 的独立装配，沿现有 Memory/Runtime 存储与迁移，不扩大默认 public consumer。 |
| `packages/goals/src/index.ts`，`NodeInput.dependencies: NodeRef[]`；`apps/runtime/src/coordination-store.ts`，原版本图存储 | 真实 Plan→Fact 依赖必须已经在原图的精确版本里。`plan-execution-source.ts` 的 `PlanExecutionSource` 沿现有 Plan 及传递依赖读取，Fact 通过原 `readNodeFact` 映射核对；不是从目标文字或邮件主题挑 Plan。 |
| `apps/runtime/src/application/proactive-cognition-host.ts`，`ProactiveCognitionReview` / `ProactiveCognitionHost` | 已有 consumeAndReview、readReview、handoffReview 和确定性范围检查。当前 `chooser` 类型为 `LayaActionChoiceService.choose`，不能将该既有本机实验路径直接指定为新的 Competition 邮件审查。 |
| `packages/cognition/src/reviewed-repair.ts`，`ReviewedRepairSelection` / `ReviewedRepairBinding` / `prepareReviewedRepair` | 验证原 REVISE 选项、受影响节点、graphRevision 和精确 dependencies；云候选只在已选结构范围内变化。`repair.ts` 的 `commitStoredRepair` 最终调用原 store.appendBatch CAS，修改已有节点版本，不凭空建立邮箱→Plan 关系。 |
| `apps/runtime/src/application/local-repair.ts`，`LocalRepairHostOptions` / `SubmitLocalRepairRequest` | 请求兼容 FactRepairRequest（sourceTaskId/evidenceId）和 ReviewedRepairRequest（sourceTaskId/reviewTaskId）。Fact 分支要求原 sourceTool/memory/resolveBinding/matchesSource。当前 Main 非 syntheticMvp 只注入 reviewedSource.resolve；不能把类型存在当生产 Fact 分支已可用。 |
| `apps/runtime/src/application/runtime-application.ts`，`readPlanExecutionBinding` / `submitLocalRepair` / `readF03PlanRepairReceipt` | 第一个读原用户所选 Plan；第二个只受理已有完成 repair candidate 与原来源；第三个只读对应已执行 CAS 的原回执，不创建或授权重规划。 |

实际依赖建立点是原图 NodeInput 的 `dependencies` 被受信写入/原 CAS 持久化时；F08 worker、mail-triage、mail-review 当前没有建立或持有 mailbox source→Fact→Plan 映射。Goal UI 的 `goal-host-core.js` 创建/修改 Goal，并可执行**已有** Plan；`executePlan` / `PlanExecutionSource` 不创建计划或猜依赖。没有此原关系的普通 F08 请求应保持 `requires_review`。

## 为什么不能直接套会议适配

`apps/desktop/electron/goal-cognition-host.js` 的 `meetingReviewedRepairPort` 严格核对已提交 `meetingFact`、原 projection batch、会议范围及同一 review，再走原 handoff/repair。其 Main 装配依赖 `localLaya`，当前设计只保留既有有界场景；代码存在不代表它可作为新 Competition 邮件规划主控。可借鉴原检查点、幂等和 CAS 读回验证，不复用其会议来源或默认 Laya 语义决定。

依据 `CURRENT_DESIGN_20261015.md` 与 `HUAWEI_ICT_AGENTARTS_PROFILE.md` 当前限定：新增邮件变更语义审查必须由已配置 AgentArts Agent/Workflow 经原 CloudAgentPort 承担；本机只验证来源、结构范围与执行授权，云失效不可改走 Local。

## 最小新增纵向包（尚未实现）

1. **原来源与因果绑定。** 在 F08 既有当前 inbox 读回处，验证原 N01/对应 change-check 的 task/run/args/Policy/完整结果与配置代次，记录原基线、当前 revision、已发生 archive/send 原 operation/effect 身份。只读原 `readPlanExecutionBinding` 及持久 Fact 映射；缺映射返回 requires_review。用户撤销、来源擦除、会话变化、截断结果或未知写入都不能生成新的确定性“未发送”结论。
2. **private FactChange。** 新 host-only 生产口接收上述固定 MailChangeProof，而非任意 summary/Fact DTO；由原宿主许可决定写入，保持 private，并用既有 Memory append/feed/Runtime projection 持久化与确认。明确默认 public consumer 不变；已投影而回调未知时只读原 batch/FactRef，不能另造 eventId 或重复 append。
3. **Competition 审查与原修复。** 原 AgentArts 路径仅接收精确许可的 bounded projection/原 Plan 结构，不携带私有邮件原文。新 mail scoped review consumer 核对原 MailChangeProof、Fact batch、affected Plan refs、deployment、会话和期限，再消费真实原审查/选项回执，复用 `prepareReviewedRepair` 与 `submitLocalRepair`、`cognition.commit_repair` 的原 Policy/CAS。不能人工写 `proactive-cognition-review-v1` 或固定 Fake 选择来取得生产资格；不能以 `meetingReviewedRepairPort` 的 Laya 替代 Competition 审查。
4. **N13 读回。** 固定的 original effect chain 必须关联该 source/review/repair task 三者，受理、待批、unknown、CAS 确认分别表示。只有原 `readF03PlanRepairReceipt` 证明对应 CAS，才能声称计划已修订；受理本身不代表执行。新 Plan 不能自动重发旧 mail.send。若原图因来源失效已停，独立 review/repair 仍使用原 TaskRuntime 生命周期，不能重开原终态或扩大旧 grant。

建议新增的业务边界仅是固定邮件 `readChangeProof(scope)`、`submitReview(proof,context)`、`readReviewReceipt(reference,context)`，其精确公共类型必须随上述实际生产 provider 一起交付；现在不注册空 available 工厂，也不向模型开放任意 source/review 引用。

## 必要验收

真实 Engine/Runtime/Policy/SQLite/Memory 组合覆盖：原 Plan 无映射不挑计划；跨账号/会话/Fact/Plan 替换拒绝；私有邮箱内容不进入 public feed 或未批准出机；来源版本 CAS 冲突；等云/等审批时撤销；投影完成回调未知只读恢复；发送未知与已归档效果不重放；N10 前、N07 前、N13 检查时三个变化时点；原图停后不借旧审批重开。AgentArts 语义/部署与真实 mailbox 另外验收，Fixture 仅验证消费边界。

本提交仅文档：依据当前代码只读核对，`git diff --check` 通过；未运行真实服务，未宣称 private Fact 或 N13/F03 接线完成。
