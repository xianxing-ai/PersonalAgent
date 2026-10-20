# H3 开发经验：来源、生命周期与消费接线

日期：2026-10-20。状态：in_progress。Profile：huawei_ict_agentarts。

分支：`codex/harness-experience`，实施基线 `9eb2fb08`。
保留 goo122 的 learning 所有权及全部协作者修改；不修改 H1 独占的 RuntimeApplication/subagent-host 或 H2 独占的 Desktop 入口。

## 生产端口

- `@personal-agent/learning.createDeveloperExperienceApplication` 复用 `SqliteLearningHost`，提供 `propose/validate/activate/stop/readApplicable/assertApplicable`。
- `createRuntimeHarnessExperienceApplication` 位于 `apps/runtime/src/application/harness-experience.ts`，只从原 TaskRuntime 的确认记录、原参数摘要和工具结果检查点构造来源。
- `assertOrigin(origin, context)` 校验 H1 持久 owner/plan 与原选中 trial 的实际任务成员关系；`readInvocation({taskId,runId})` 返回原受信调用参数与 scopeRef，不能接受模型重构的跨任务身份或参数。
- `readMainInput(taskId)` 读原 prepare_adoption 持久 main F15 session；不能返回 isolated session。
- `readCurrent(ownerTaskId)` 同步返回 `{scope,snapshot}`。scope 为 `workspaceId/workspaceDigest/configurationDigest/workflowVersion/runtimeVersion/recipeFingerprint`；workspaceDigest 使用同文件导出的 `harnessExperienceWorkspaceDigest(snapshot)`，snapshot 必须覆盖原验证读集。失效、缺失或撤回必须返回不可用；不能组合缓存的异步快照。
- `confirmActivation` 沿原宿主显式确认。候选、验证通过及启用是不同操作；未验证不能启用。

## 实际调用点与共享文件交接

H1 在原 `user-work` 已 succeeded，且 F15 采用、完整重新验证、原 publish/readback 已确认后调用 `proposeFromConfirmed(origin, request)`；不得用 isolated trial、compare 建议或云端自报成功代替确认来源。origin 为 `{ownerTaskId,candidateId,trial,comparison,adoption,publication}`，四个引用均为原 `{taskId,runId}`。当前采用/发布工具属于原 owner；trial 可由经 H1 确认的 sibling 执行。
工厂在原 owner 的 TaskRuntime checkpoint 保存不可变来源引用；没有第二份数据库或独立任务索引。learning SQLite 只保存来源引用及描述性验证步骤，不复制 patch、正文或凭据。
H2 在原管理入口调用 `validate/activate/stop`，保持宿主确认与版本检查。
H1 在后续开发子任务取得 `readApplicable` 的版本 lease，沿原 TaskRuntime 检查点持久绑定，并在每次消费及恢复时调用 `assertApplicable`。
lease 仅提供描述性验证策略，不含 tools/scopes 或授权，也不能扩大原 Policy、ToolGateway、工作区、预算或期限。

在 H1/H2 共享入口完成接线、实际消费回归和 PR 前，本工作包不声明完成。无新增 store、调度器、授权器、Core wire Schema 或数据库迁移。

## 实现与验证状态

- 已实现 learning 生命周期适配、同一版本重激活的 sequence lease、原 Runtime 输入摘要/confirmed Evidence 检查、选中候选与重新验证和 CAS readback 绑定。
- 依赖现有 Windows/MOD31 交付的 `coding.repair.trial`、`harness.candidates.compare`、`coding.repair.prepare_adoption`、`coding.repair.publish`；它们仍由各自唯一 writer 负责实际注册和恢复。
- 回归源码：`packages/learning/test/developer-experience.test.mjs`、`apps/runtime/test/harness-experience.test.mjs`。Runtime 用实际 SQLite/Policy/Gateway 加显式合成工具，不冒充真实 F15、模型、云端或设备验收。
- 按用户最新优先级，未运行构建、完整测试、全量 check 或扩大 QA；源码接齐后由主控统一安排集成验证。当前共享入口的真实调用方接线仍交 H1/H2，不能把本工厂导出当作整包完成。
