# H3 开发经验：来源、生命周期与消费接线

日期：2026-10-20。状态：in_progress。Profile：huawei_ict_agentarts。

分支：`codex/harness-experience`，实施基线 `9eb2fb08`。
保留 goo122 的 learning 所有权及全部协作者修改；不修改 H1 独占的 RuntimeApplication/subagent-host 或 H2 独占的 Desktop 入口。

## 生产端口

- `@personal-agent/learning.createDeveloperExperienceApplication` 复用 `SqliteLearningHost`，提供 `propose/validate/activate/stop/readApplicable/assertApplicable`。
- `createRuntimeHarnessExperienceApplication` 位于 `apps/runtime/src/application/harness-experience.ts`，只从原 TaskRuntime 的确认记录、原参数摘要和工具结果检查点构造来源。
- `assertOrigin(origin, context)` 校验 H1 持久 owner/plan 与原选中 trial 的实际任务成员关系；`readInvocation({taskId,runId})` 返回原受信调用参数与 scopeRef，不能接受模型重构的跨任务身份或参数。
- `readMainInput(run: HarnessExperienceRun)` 按实际 `(taskId,runId)` 读原 prepare_adoption 持久 main F15 session；不能返回 isolated session，也不能猜同 owner 最新 session。
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

## 原 receipts/session 适配（H3 owned）

`createHarnessExperienceBindings(runtime)` 在 `harness-experience-bindings.ts`，直接复用原 `application-tool-invocation:<runId>` 和原 ToolExecutionRecord 输入摘要；无异步 journal 缓存、第二索引库或跨 owner 猜测。

H1/Windows 原 factory options 需要挂载以下实际调用：

1. 原 adoption `readSelection(context, trialRunId)` 已解析精确来源后，调用 `bindings.saveSelection(context,{ownerTaskId,trial:{taskId,runId},comparison:{taskId,runId}})`。此处正处原 started Gateway 调用，不能从模型参数接收 compare 身份。
2. 原 trial/adoption `saveSession(context,input)` 调用 `bindings.saveSession(context,ownerTaskId,input)`；`readSession(context)` 调用 `bindings.readSession({taskId:context.taskId,runId:context.runId})`。在 patch 执行前不可变保存。
3. 主 session 按 `harness-candidates:session:<runId>` 保存；owner 的 `harness-candidates:owner-session:<sessionId>` 引用真实 run。原选中回执按 `harness-candidates:selection:<adoptionRunId>` 固定。重试只读原 journal，不重放 patch。
4. owner settled 后调用 `bindings.publishedOrigins(ownerTaskId)`，只解析原 published CAS readback，再经 H1 `assertOrigin` 和 `proposeFromConfirmed` 严格验证；不存在“最新 compare/adoption”回退。
5. 工厂直接注入 `readInvocation:bindings.readInvocation` 与 `readMainInput:bindings.readMainInput`。configurationDigest 对齐 H1 稳定 `configurationRef`，不包含新任务或 goal；原 inputDigest 与 owner/plan 校验仍保留，不借用其他 owner 的回执。

## 实际同步 workspace fence（Windows owned 接口要求）

需要 Windows 原 `workspace-config-host` 提供 `readHarnessExperienceCurrentSync(ownerTaskId)`，在原工作区 identity/selection/consent 与版本配置 fence 下，当次同步读取完整源文件清单、每个内容 hash 和包依赖图，并在返回前复核目录身份、配置/recipe/部署版本。新增文件、删除、链接替换、依赖变化必须导致新快照或不可用。建议在原 coding-tools snapshot 实现旁复用相同忽略/密钥/路径规则提供同步捕获入口，不在 H3 复制一套快照策略。

返回 `{scope,snapshot}`。scope.workspaceDigest 用 `harnessExperienceWorkspaceDigest(snapshot)`，configurationDigest 用稳定的 Runtime scope.configurationRef。不能把 `captureCodingRepairSnapshot()` 的异步旧结果保存后当当前同步 authority；尚无真实同步端口时必须返回 undefined，不能启用/消费经验。

## H2 最小管理挂载端口

- 独立宿主：`createHarnessExperienceAdminHost({getApplication,context})`，文件 `apps/desktop/electron/harness-experience-host.js`。getApplication 返回已装配的 Runtime 经验 application；context 由原受信主进程提供 deadline/signal。
- H2 在现有 admin sender gate 后把 `harness.experience.list/validate/activate/stop` 路由到 host.invoke，并在既有 snapshot 中放 host.snapshot 元数据。不改变公开 Core wire operation。
- 原设置页挂载 `mountHarnessExperienceControls(root,{invoke,status,onChanged})`；mount 自动只读刷新，离开页面调用 dispose，外部 metadata 更新调用 update。
- 控件通过真实 validate/activate/stop 调用后读取宿主状态；未验证禁用启用按钮，最终启用仍须 `confirmActivation` 原宿主确认，旧 active revision 通过 CAS 绑定。没有 UI 本地布尔假启用，也不向 Renderer 发送 patch/源正文/路径/凭据。

CI 报告的 learning strict narrowing 已通过改用明确 never 的函数声明修正；本地仅 learning 与两份 H3 Runtime 源文件的定向 noEmit 类型检查、JS/MJS 语法检查通过（复用既有声明依赖，不构建）。新增管理控件回归源码未运行。完整 CI 和实际挂载/下一任务消费仍待统一集成验证。
