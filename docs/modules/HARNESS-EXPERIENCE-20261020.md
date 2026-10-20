# H3 开发经验：来源、生命周期与消费接线

日期：2026-10-20。状态：review（源包；不代表整个 MOD 完成）。Profile：huawei_ict_agentarts。

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

H1/H2 共享入口已在 #451 `4d303170ec29a464bcd12f827816505c9c9a3c28` 接通：Runtime 原任务完成钩子幂等提议，原 checkpoint 冻结 lease/null，dispatch/send/resume 重验；Desktop 原管理 IPC、原生确认及设置页消费同一 learning 实例。源包可供审查，真实平台验收与整个 MOD 完成状态另行记录。无新增 store、调度器、授权器、Core wire Schema 或数据库迁移。

## 实现与验证状态

- 已实现 learning 生命周期适配、同一版本重激活的 sequence lease、原 Runtime 输入摘要/confirmed Evidence 检查、选中候选与重新验证和 CAS readback 绑定。
- 依赖现有 Windows/MOD31 交付的 `coding.repair.trial`、`harness.candidates.compare`、`coding.repair.prepare_adoption`、`coding.repair.publish`；它们仍由各自唯一 writer 负责实际注册和恢复。
- 回归源码：`packages/learning/test/developer-experience.test.mjs`、`apps/runtime/test/harness-experience.test.mjs`。Runtime 用实际 SQLite/Policy/Gateway 加显式合成工具，不冒充真实 F15、模型、云端或设备验收。
- 源包依赖闭包与 learning/Runtime 编译、两份源包测试 6/6 及 canonical journal 回归 2/2 已通过。#451 实际 Runtime 编译及 experience application consumer 3/3 通过，覆盖自动提议、原生确认后冻结 lease/停用拒绝，以及未配置普通任务冻结 null、中途启用不补绑。使用实际 Runtime/Gateway/SQLite 与明确 Synthetic coordination/host，未使用真实模型、云账号或设备，不构成真实 Windows/F15 发布验收。

## 原 receipts/session 适配（H3 owned）

`createHarnessExperienceBindings(runtime, canonicalReaders)` 在 `harness-experience-bindings.ts`，直接复用原 `application-tool-invocation:<runId>` 和原 ToolExecutionRecord 输入摘要。它完全只读，不写 canonical session、selection 或 owner index，不复制第二份 session/patch，也不提供 saveSession/saveSelection hooks。

canonicalReaders 最小接口：

1. `readOriginalSessionForProvenance({ownerTaskId,actualTaskId,runId}): CodingRepairInput | undefined`：MOD31 factory 顶层同步 host-only reader 验证 owner 原 `harness-candidates:session:<runId>` 的 `{operation,input}` 并返回原 input；不能使用等待核实专用 Recovery reader 代替。
2. `readAdoptionOrigin({ownerTaskId,actualTaskId,runId}): RuntimeHarnessCandidateAdoptionOrigin | undefined`：返回 MOD31 在实际 adoption.readSelection 核对原 confirmed trial/compare 后原子保存的 `harness-candidates:adoption-origin:<adoptionRunId>`。该唯一来源含 version、owner/adoption/trial/comparison refs、candidate/artifact 及原输入/配置 identity；经验端只读，不重定义或写另一份 envelope，仍由核心重复核对原 run/input/Evidence。
3. `publishedOrigins(ownerTaskId)` 从原 confirmed publish 的准确 sessionId 在 canonical session reader 中寻找唯一匹配的 adoption run；多个匹配拒绝，不选择最新。随后只读取该 adoption 的原 origin，不能另造 selection。
4. H1 不再重复 saveSession/saveSelection；原工具的 journal 写入全部保留 MOD31 唯一 writer。工厂注入 `readInvocation:bindings.readInvocation`、`readMainInput:bindings.readMainInput`，并保留 H1 settled owner/peer plan membership 的可信 `assertOrigin`。
5. 经验自己的持久内容仅是 `harness-experience:source:<digest>` 下的小来源/作用域引用，无 session、patch、正文或独立索引。configurationDigest 对齐 H1 稳定 `configurationRef`，不包含新任务或 goal；原 inputDigest 与 owner/plan 校验仍保留，不借用其他 owner 的回执。

## 实际同步 workspace fence（Windows owned 接口要求）

Windows 原 `workspace-config-host` 已公布 `readHarnessExperienceCurrentSync()`：返回 `{snapshot,versions:{workflowVersion,runtimeVersion,executionKind:'real_host'},configuration:{bindingId,workspaceId,recipeFingerprint}} | undefined`。复用 coding-tools `captureCodingRepairSnapshotSync` 原 metadata/包图/过滤/字段/SHA，并在当前 root/Node/consent/gen/config/同步版本前后双 fence；Promise 版本拒绝，不要求源 owner/task 仍 live。新增文件、删除、链接替换、依赖变化必须导致新快照或不可用，H3 不复制快照策略。

返回 `{scope,snapshot}`。scope.workspaceDigest 用 `harnessExperienceWorkspaceDigest(snapshot)`，configurationDigest 用稳定的 Runtime scope.configurationRef。不能把 `captureCodingRepairSnapshot()` 的异步旧结果保存后当当前同步 authority；尚无真实同步端口时必须返回 undefined，不能启用/消费经验。

## H2 最小管理挂载端口

- 独立宿主：`createHarnessExperienceAdminHost({getApplication,context})`，文件 `apps/desktop/electron/harness-experience-host.js`。getApplication 返回已装配的 Runtime 经验 application；context 由原受信主进程提供 deadline/signal。
- H2 在现有 admin sender gate 后把 `harness.experience.list/validate/activate/stop` 路由到 host.invoke，并在既有 snapshot 中放 host.snapshot 元数据。不改变公开 Core wire operation。
- 原设置页挂载 `mountHarnessExperienceControls(root,{invoke,status,onChanged})`；mount 自动只读刷新，离开页面调用 dispose，外部 metadata 更新调用 update。
- 控件通过真实 validate/activate/stop 调用后读取宿主状态；未验证禁用启用按钮，最终启用仍须 `confirmActivation` 原宿主确认，旧 active revision 通过 CAS 绑定。没有 UI 本地布尔假启用，也不向 Renderer 发送 patch/源正文/路径/凭据。

CI 报告的 learning strict narrowing 已通过改用明确 never 的函数声明修正；源 head `5aae4006` 的 Foundation 已通过。当前正常同步 main `85e686fc` 后需以新 HEAD 的实际必需 CI 为准；有效非作者批准仍是独立合并门禁，旧头成功不替代新头验证。维护证据位于 `.cache/pr-maintenance-20261020/pr452/`。
