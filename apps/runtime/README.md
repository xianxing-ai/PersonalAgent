# Runtime task core

`coordinationInput.readRequestContext(scope)` 是可选 provisional host-only 同步环境文本端口：每次 Competition 实际交换临时采样，通过原 goal 出口发送；完整发送串继续受原最终 lease/预算和出机守卫约束，稳定历史 checkpoint 不保存该正文。无 frozen wire 或 Schema 变化，旧调用保持原行为。时间/安全能力引导、卡授权依赖及验证状态见 [#474 记录](../desktop/docs/issue-474-time-context-20261021.md)。

2026-10-20 Competition 上下文增量：新增 host-only 事件截面读取，保留所有公开用户请求及其当时执行状态；共享编译器在普通对话中优先保留用户原文，Skill/私人预检维持严格预算；来源撤销贯穿旧助手与子任务。冻结 Core wire、原任务终态与旧迁移不变；可选续接历史默认关闭，新云端验收待完成。见 [实现与评估](../../docs/competition/CONTEXT_INTEGRITY_20261020.md)。

`delegateUserTasks:true` 是 Competition 可信组合选项：仅新用户任务冻结一次真实子任务委派，根任务经原 Policy/Gateway 派发后只汇总，模型、预算和恢复绑定保留。旧任务不补派；既有单任务私人记忆/Skill 许可不继承。`readDelegatedUserTaskParent()` 只提供经校验的公开历史范围。可信宿主通过 `readSubagentConversation` / `submitSubagentConversationMessage` / `cancelSubagentConversationTask` 访问同一子智能体的持久追加会话，每轮创建新任务，不重开原终态；`listSubagentConversations` 分页读取全部原子智能体，追加执行仍归原入口。实现、139 项定向验证（Runtime 51 项）及未知写/汇总失败恢复限制见 [子对话与委派说明](../desktop/docs/live-task-visibility-20261018.md)。


<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-03（goo122）、MOD-31（zemeng5208）。产品流程：F01、F03、F06、F12、F24、F22、F23、F28；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

执行模型协作与候选评估；不创建第二个最终语义裁决模型，建立独立影子宿主的能力与证据。

本机Laya已确定为本地运行方案，提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收；外部比赛资格及真实 AgentArts 端到端验收另行核证。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->
Competition 任务一旦保存 `competition-context:v1`，恢复和最终发送门禁都要求受信宿主继续装配 `coordinationInput`；缺失时拒绝发送，不降为原公开 goal。已确认工具回执保留，进入既有待核实路径，不重做工具。没有该检查点的旧任务仍允许沿原无 hooks 路径恢复。此为 host-only、provisional 加固，无新 wire/迁移；见 [F27 恢复加固记录](../../docs/modules/MOD-09-CONTEXT-BINDING-20261014.md#2026-10-16恢复-hooks-缺失加固)。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 首轮须有合资格非作者有效批准，后续仅修复 CI 的提交保留批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧审批人数与本机阅读门槛不作为现行要求。

Obsidian 本机桥接沿用 `createObsidianPairingHost` 与 `createTrustedKnowledgeTools`。
Desktop 根组合用公开 `@personal-agent/knowledge/bridge` 进行 TLS 证书指纹固定/一次性
密钥认证，再请求原生确认；检索任务仍由 Runtime/Policy/ToolGateway 决定。配对恒为
private、readonly，断连后 selected source 为 unavailable；旧任务不复用新 sourceId。
MOD-08O 将逐条记忆确认接入配对引用，文件源监视在插件模式暂停，不新增云能力或授权。
见 [MOD-08N](../../docs/modules/MOD-08N-AUTHENTICATED-BRIDGE-01.md) 与
[MOD-08O](../../docs/modules/MOD-08O-PAIRED-CITATION-MEMORY-01.md)，接口 provisional。

Wiki 来源增量提供可信 Application 入口 `revalidateWikiFact`：使用当前宿主 lease 精确读回
既有确认事实的来源，已知版本变化或读回证明的同卷移动追加观察撤回；临时缺失与扫描失败
保留历史并返回 source_unavailable。新事实仍通过 `ingestConfirmedPrivateCitation` 逐条确认，
持久来源引用不授予文件访问或云发送权限。Feed/Goal 复用既有投影应用；参见
[MOD-08H](../../docs/modules/MOD-08H-WIKI-MEMORY-PROJECTION-01.md)，接口 provisional。

`createTrustedKnowledgeTools(source, projectionPort?)` 可在原 TaskRuntime 检查点中分别记录
正文结果与投影进度。`recoverProjection` 只重校验已知回执的来源；unknown 必须先通过
原 `reconcileKnowledgeWriteTask` 真实读回及 finalize。投影失败保留待恢复记录，已知成功
回执按原输入匹配检查点，配置变化不阻断原 Runtime 结果确认；旧投影绑定不变。
原任务确认后调用 `recoverProjection`，仍检查当前配置/租约，不隐式重新绑定或授权。
已知写入不被重做。参见 [MOD-08I](../../docs/modules/MOD-08I-WIKI-WRITE-RECOVERY-01.md)。

`createWikiSourceMonitor` 由现有宿主 tick 驱动只读来源检查，30 秒节流；首次/重启检查
既有确认事实，之后仅重校验变化路径。扫描/投影失败保留上次快照，不推导删除或自动
确认新事实；关闭取消在途检查。参见 [MOD-08J](../../docs/modules/MOD-08J-WIKI-SOURCE-MONITOR-01.md)。


@personal-agent/runtime is the MOD-03 local task and event core for PA-004 and the scheduling boundary of PA-009.

Interface status is tracked per operation in the [current interface catalog](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md). The Core Runtime Profile 1 message, task, conversation, and approval-query subset is frozen. Event-channel lifecycle, model/tool execution, Evidence content, settings, connector routing, and external host boundaries remain provisional or unavailable.

当前新增装配只面向 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：Runtime 后续通过 `CoordinationPort` / `CloudAgentPort` 调用比赛编排，并继续拥有任务、授权、真实执行、读回和终态。现有本地 `runAgent()` 与模型装配仅作为可选基线留存，当前不扩展、不作为比赛验收路径；Competition 运行不得在 AgentArts 不可用时静默回退本地链路。

`createAgentArtsRuntimeApplication(options)` 是可信 Competition 文字装配入口：
它用显式的 HTTPS gateway、runtime 名称、调用模式和宿主
`AgentArtsAuthorizationProvider` 构造云适配器，再注入现有
`RuntimeApplication`。工厂不接受 Local text 配置，可注入本地
`RegisteredTool`；当前 HTTP Adapter 返回仍只是 `unverified` 文字，
任务持久化、授权、工具执行和终态继续由 TaskRuntime 决定。

## Implemented

### Provisional trusted-host Evidence metadata

`RuntimeApplication.createEvidenceReader({subjectRef, conversationId, taskId, authorize})`
returns a fixed-scope, read-only metadata reader. The trusted host must derive the
scope from its authenticated session and check `authorize` on every `list` or `get`.
The reader also compares the task's persisted conversation ID. It returns bounded
execution metadata with `conditional` verification, never tool arguments, results,
credentials or raw checkpoint content. Runtime does not store a subject ACL, so this
is not a Renderer/Client wire `EvidencePort` and cannot be enabled without a real
host authorization source. No Evidence capability is announced.

`RuntimeApplication.revokeHostAuthorization` is a separate trusted-host call.
It checks the authenticated subject through a caller-supplied callback, the
persisted task/conversation and approval revision, then removes the matching
SQLite-backed Policy grant and reads back its absence. Repeated calls return
`revoked: false`; an idempotent approval response cannot recreate the grant.
Revocation prevents later grant consumption. It does not roll back a tool that
has already started, so the task's cancellation and result reconciliation stay
separate. There is no public revoke wire operation or persisted subject ACL yet.

### Provisional graph storage

Trusted hosts may call `provisionCoordinationStore(namespace)` or
`bindCoordinationStore(namespace)` and pass only the returned
`CoordinationStorePort` to a consumer. Migration 5 stores immutable graph history
in the existing Runtime database, with transaction-protected revision comparison.
No wire capability or AgentArts integration is enabled by this host-only API.
See [COORDINATION-STORE-01](../../docs/modules/COORDINATION-STORE-01.md).

### Competition coordination and offline tool loop

`createAgentArtsRuntimeApplication()` now returns a compatible host-only extension:
`queryCompetitionCloudStatus(taskId, {expectedRevision, deadline, signal})`.
It reads the original persisted `competition-cloud-inflight` / `competition-cloud-unknown`
receipt and the dispatch-time `competition-cloud-dispatch-binding`; the caller cannot
substitute a receipt. The task must be `waiting_reconciliation` at the expected revision,
with the original Competition configuration binding. Missing legacy bindings or a
different configured deployment are rejected before lookup. Task revision and all
receipt/binding checkpoints are rechecked before recording a response.

This provisional API calls the existing WSS `queryStatus` with current host credentials.
It persists only the bounded `competition-cloud-status-observation` metadata summary
and returns the same body-free summary: original correlation, status/code, server
instance, task/configuration binding, observation time and `verification: unverified`.
Cloud events/model text never enter the returned value or observation checkpoint.
An unknown status may be a conservative local classification when the original server
instance is missing or changed, not a platform acknowledgement or proof of non-execution.

Every cloud state, including completed, leaves the local task and its original send
holds unchanged. There is no invoke replay, tool execution, new Evidence, task success,
automatic continuation, or clearing of inflight/unknown checkpoints. Old receipts with
no dispatch configuration binding cannot be retroactively attributed to the current
deployment. This is a trusted-host diagnostic consumer, not a Client/Renderer wire
operation, public capability, or automatic reconciliation/finalization implementation.
The trusted host must authorize access to the task before calling this method.

Each new WSS dispatch also records versioned `competition-cloud-dispatch-context`
after the host send guards and before the invoke frame is sent. It binds the original
invocation/configuration, request phase/revision/deadline, loop step/budget and
catalog/continuation checkpoint references and digests. No goal, tool arguments,
continuation body, cloud events or credentials are copied into this snapshot.
Status diagnostics reject changed snapshots or changed referenced checkpoints.

This path has no general durable public-input provenance contract, so every snapshot
records `privacyEligibility: {eligible: false, reason: 'public-provenance-unavailable'}`
and `recovery: 'unavailable'`. An unchanged goal or absent withdrawal marker cannot
establish public provenance. This snapshot records dispatch facts only; it neither
grants permission nor enables result recovery, replay, tool execution or finalization.
Legacy records remain diagnostic only and are never backfilled. Partial dispatch
records cannot supply missing recovery facts. Dynamic policy, tool availability and
ephemeral input leases still need fresh host checks in any future recovery consumer.

Trusted composition may pass `profile: 'huawei_ict_agentarts'`, an explicit
`coordination: CoordinationPort`, and local `RegisteredTool` values. Bounded text and
strict proposals are parsed; `unverified` proposals are denied by default. Runtime owns submission, deduplication, cancellation,
deadline and persisted terminal state. Missing coordination, or a proposal without a
trusted local tool, fails with UNSUPPORTED_CAPABILITY. Local text/model configuration APIs
remain rejected in Competition mode.

Adapters receive no Runtime object, authorization or attachments. For the offline
Fake path, Runtime checkpoints a proposal, enters `waiting_approval`, executes through the
existing Policy/ToolGateway after `allow_once`, accumulates trusted Evidence references,
and sends only a confirmed JSON result to the next coordination exchange. Unknown write
results remain in reconciliation. The real AgentArts HTTP adapter is still text-only;
deployment trace, usage and real cloud recovery remain unavailable. See
[work package](../../docs/modules/COMPETITION-TOOL-LOOP-01.md).

Trusted Competition composition can inject scoped conversation context as untrusted data.
`readConversationContext` uses the original task creation cutoff and successful history;
task-bound overlays must belong to that eligible history, so other conversations, unfinished,
failed, cancelled, current/later and withheld tasks cannot be restored through an overlay.
Host-scoped Live messages without a task binding remain the trusted host's responsibility.
The current reader preserves the complete eligible history; an explicitly configured source-message
range rejects overflow instead of silently keeping twenty messages. The compiled goal, prepared input
and history share a 128,000 UTF-16 character limit; this is not a model token-window claim.
Cancelled or expired reads are rejected. Context does not grant tool permissions or restore a private egress lease
after restart. See [context regression record](../../docs/modules/MOD-09-COMPETITION-CONTEXT-20261008.md).

Trusted composition can explicitly configure `competitionToolExports` for selected tools with
bounded result projections. Each binding fixes a tool name/version and an `exportPolicyVersion`, checks task/proposal/arguments with
`accepts`, and projects the confirmed result with `project`. This export permission does not
grant tool execution: local approval, deadline and Policy still apply. Only the bounded JSON
projection reaches continuation; raw results and Evidence remain local. Repeated confirmed
proposal IDs replay the saved projection and changed inputs are rejected. No export binding
is configured by default. The complete continuation JSON, including its envelope, is limited
to 8KiB. Change `exportPolicyVersion` when changing the export rules: saved projections with
a missing or different version are denied, never re-executed. Dynamic scope is checked again
at the adapter handoff after projection. `createAgentArtsRuntimeApplication` also forwards `workflowGoalInput`
and explicit `responseMode: 'tool-proposal-json'` (default `text`), and supplies a final
synchronous receipt/scope check after credential reads, immediately before the adapter fetch
to the cloud adapter. See [export work package](../../docs/modules/MOD-30-COMPETITION-EXPORT-01.md)
for the precise offline boundary and the unresolved real cloud/MCP lifecycle.

The trusted Windows composition may create a Notepad `RegisteredTool` with
`createWindowsHostNotepadAdapter`, pass `adapter.tool` in Runtime Application's
`tools`, and keep `adapter.observe`/`releaseObservation`/`recover` host-only. The bridge transport
starts the exact native PipeBridge executable, which launches the Host with a
random named pipe and verifies the connected server PID before exposing the
unchanged bounded JSONL frame stream. The adapter requires a
live local-presence callback, a short-lived Host target and a create-only Runtime
attempt checkpoint (`createRuntimeWindowsHostAttemptStore`). The mutually
authenticated Host issues `verified` only after its own same-target UIA text
readback; Runtime correlates that result and records the formal tool Evidence.
ToolGateway consumes the
one-use Policy grant before `RegisteredTool.execute`; a disconnect, cancel,
`not_found`, or uncertain write remains unknown and never triggers a replay.
Current `tool.invoke` has no trusted `userPresent` field, so this adapter checks
presence through the trusted host callback and keeps the descriptor's wire
presence flag false. MOD16 separately verified the native Pipe PID and hello
boundary; Node transport/bridge composition, Desktop, bind/observe and real
Notepad UIA execution remain unverified. The product capability is unavailable.

Optional `competitionToolAvailability` requires a trusted, task-specific readiness check for
each advertised tool. Runtime selects only registered descriptors with an explicit
result export binding and a ready provider, stores that selection with task revision/deadline,
and exposes `prepareCompetitionToolCatalog` as `{name,version,inputSchema}`. The input Schema
projection removes descriptions, examples, enums and patterns so private paths and hints do
not leave the host through catalog metadata. An unverified proposal is checked against the
persisted selection, the original local Schema and current readiness before local approval.
The cloud adapter must call `assertCompetitionToolCatalogAllowed` after credential reads and
immediately before sending an initial request with the directory. Catalog selection does not
grant tool execution or authorize sending tool results. Local and external writes can be
advertised only through these explicit bindings; each proposal still needs Policy approval,
and an unknown write result waits for reconciliation. Tools requiring a live presence signal
are omitted until the Runtime invocation carries that signal. The trusted AgentArts factory
requires `initialRequestMode: 'goal-with-tools-json'` whenever a catalog is configured.

- SQLite-backed tasks, checkpoints, events and one-shot schedules.
- `ingestConfirmedPrivateCitation` is a trusted-host bridge for one exact
  read-only Vault citation. Its injected confirmation callback must obtain a
  real user decision for that citation and the proposed summary. A decline
  writes nothing; a changed citation is rejected before a private Memory
  creation or revision. This does not register a Desktop or wire capability,
  authenticate the caller, or authorize cloud transfer.
- `createSqliteFactProjectionHost` binds a pre-provisioned public Memory namespace
  to one fixed consumer, the SQLite feed/query, durable Runtime graph projection,
  host-only confirmation and pending impact processor. `consume` advances one exact
  batch; `drain` catches up within an explicit batch limit and reports whether it
  reached the watermark. `processImpacts` filters pending items by the fixed
  consumer/Memory namespace before applying its limit and returns batch-tokened
  completed reports; `readCompletedImpact` reads one known token. For a crash after
  projection or completion commits but before the token is returned,
  `listImpactReceipts({afterGraphRevision, limit})` pages pending and completed
  receipts by increasing graph revision within that fixed consumer scope. The
  consumer persists its last fully handled graph revision only after processing
  the page. Batches without new Fact nodes need no cognition impact receipt.
  If a trusted Memory erasure intent rewrites a delivery, `consume` reads that
  exact token and atomically replaces stale, unactivated staging before replaying
  its surviving facts, including a batch confirmed before a crash. Already
  activated graph history and receipts still require separate erasure handling.
  After a trusted Memory erasure intent, `preflightErasure(factId, context)`
  reads the rewritten durable delivery and exact surviving FactVersions for
  activated receipts. It inventories stale staged batches, graph dependencies, other graph bindings,
  all graph impact records and untraced surviving text without writing either
  database. Missing delivery or mismatched survivor content fails closed. The
  graph-scoped result is evidence for planning, not permission to finalize
  deletion; cross-graph coordination and free-text source lineage remain unresolved.
  The trusted `FactProjectionStore.commitErasure` now performs the Runtime-only
  atomic cleanup for a verified single-graph subset: it keeps the graph revision
  high-water mark, removes target mappings, rewrites mixed receipts and impact
  records, and saves a content-free retry receipt. It rejects stale staging,
  every other populated graph or projection staging, and surviving text without
  proven lineage. The trusted
  `resumeFactErasure` host path reads back that receipt and then removes the
  pending fact's active Memory history and public-source mapping in a second
  transaction. A failure between commits stays pending and can be retried after
  restart with the same operation ID. The deletion path verifies SQLite
  `secure_delete=ON` before writes and requires successful `TRUNCATE` checkpoints
  of both WAL files before returning; a busy reader keeps the operation retryable.
  This is not a public deletion capability and does not clear older free-page
  traces or backups.
  A trusted host must trigger it after verified source
  changes and on startup recovery; it does not poll private sources or publish to
  AgentArts. Source correction and withdrawal remain append-only Fact revisions.
  The trusted Competition host can instead call
  `RuntimeApplication.createCompetitionFactHost({memoryPath, memoryNamespace,
  graphNamespace, consumerKey})`: this owns a separate Memory SQLite file and
  exposes `readPublicSourceHead`, `recordPublicSource` and `withdrawPublicSource`
  alongside the fixed-scope projection methods. The caller must independently
  reread and validate the approved local source, supply its SHA-256 revision and
  expected Fact revision, and close this host before closing the application.
- Explicit task transition rules and immutable terminal states.
- Submission idempotency: the same key and input returns the original task; different input is rejected.
- Ordered event replay after a persisted sequence.
- Abort propagation to an active worker. A task becomes cancelled only after the worker settles.
- Conservative restart recovery: interrupted work moves to waiting_reconciliation.
- External-write deadline handling that records RESULT_UNKNOWN and never retries automatically.
- One-shot schedule recovery with explicit run_once or skip policy.

## Verified commands

From the repository root:

    npm.cmd run check
    npm.cmd run demo:runtime

The test suite uses local fixtures and temporary SQLite files under the ignored .cache/ directory. It does not call a model, account, connector or paid service.

## Integration

Consumers create one TaskRuntime for a SQLite file, submit a task with an idempotency key, and call runTask with an injected worker. Workers receive an AbortSignal, deadline, checkpoint methods and progress reporting. MOD-04 and MOD-05 provide model and policy-checked tool workers; they must not bypass this Runtime with a second task store.

The Runtime Application text entrypoint is exported as `@personal-agent/runtime/text`. The higher-level `@personal-agent/runtime/application` entrypoint owns `TaskRuntime`, model composition and active executions. A successful `task.submit` dispatches automatically; optional trusted `tools` enable the approval-checked Agent loop. Desktop supplies configuration, submits tasks and subscribes to events. Duplicate submissions never start a second execution, cancellation is delegated to Runtime, and close rejects active work.

For an explicitly configured Competition host, `RuntimeApplicationOptions.hostUserNamespace` enables the host-only `submitHostToolTask({commandId, toolName, toolVersion, arguments, deadline})` entrypoint. The namespace is fixed by trusted composition, and the stable command ID identifies one task within it. Runtime commits the tool intent with task idempotency, validates the registered tool version and input Schema, requests the existing Policy approval, and resumes the same intent after `authorization.respond`. The caller can use `readHostToolTask(taskId)` to distinguish a pending approval, a confirmed tool result, and `waiting_reconciliation`; readback also includes the persisted command ID and tool name/version so the trusted host can choose a safe UI projection. `task.cancel` remains the cancellation path. After restart, the trusted host calls `resumeHostToolTask(taskId)` for a persisted allowed approval that was not yet dispatched. Repeating the original `submitHostToolTask` command also resumes that state. Neither path repeats a confirmed or unknown write. Tool output stays in the trusted host readback, not in the public task snapshot. Interrupted or unknown writes require reconciliation and are never automatically replayed. This host API does not publish a new wire capability or make any particular Goal/Windows tool available without explicit registration.

For tools that must observe a short-lived target using the real task ID, the trusted host calls `prepareHostToolTask({commandId, toolName, toolVersion, deadline})` first. This atomically creates a `created` task and preparation record without dispatching a tool or requesting approval. The host then calls its target observer with that `taskId`, and passes the returned `targetRef` together with all other arguments to `finalizeHostToolTask({taskId, commandId, expectedTaskRevision, arguments})`. Finalization freezes the complete validated arguments only while the task is still at the observed revision, then enters the same Policy/ToolGateway path as direct submission. A repeated finalization may resume only the identical frozen intent; changed arguments fail. If observation fails or the user abandons the operation, call `cancelPreparedHostToolTask(taskId, commandId, expectedTaskRevision)` and release the observer's target reference. The cancellation and intent freeze are mutually exclusive in one SQLite transaction. After finalization, use normal task cancellation and release the target reference on denial, cancellation, expiry or terminal readback. The Desktop must never invent a task ID, use a placeholder target reference, or submit another task for the same command ID.

Text tasks now build multi-turn context in Runtime Application from the same conversation's preceding successful tasks. The default window is the latest 20 turns; failed, cancelled and other-conversation tasks are excluded, and stored model metadata is stripped before messages are sent back to the model. The context is persisted as an application checkpoint so approval resume and Runtime Application restart retain the same input, while an `agent-loop` checkpoint remains authoritative for an already-started tool execution.

TaskRuntime implements the MOD-02 transport. With a tool gateway it also advertises capability.list, tool.invoke and authorization.respond. The weather entrypoint now uses Runtime-owned persistent policy. `createWeatherApplication` accepts an explicit provider; `createOpenMeteoApplication` uses strict location resolution. Tests pass Fake providers explicitly.

The base Runtime advertises only operations it implements. `settings.get`, `settings.update`, `connector.connect`, `connector.disconnect`, `voice.start`, and `voice.stop` are schema-known but unavailable in production and must return `UNSUPPORTED_CAPABILITY`. Tool operations are advertised only when a ToolGateway is configured; their interfaces remain provisional until the real model-to-tool path is verified.

Approvals persist for ten minutes and grant one use bound to task, tool and argument digest. Agent checkpoints retain the original proposal. After restart, repeating the matching approval response resumes an approved waiting task. Tool run IDs return confirmed stored results; unfinished runs require reconciliation. `readToolExecutions(taskId)` returns execution metadata and `readEvidence(taskId)` returns schema-valid summaries. Raw approved tool results are local task checkpoints, not public Evidence or logs.
Competition checkpoints separately retain the cloud proposal, step, continuation and Evidence references; approval resumes the Competition loop without invoking Local Agent.

dispatchDueSchedules() handles due schedules during normal operation. recoverMissedSchedules() is called after a stopped period and applies each schedule's run_once or skip policy atomically.

## DEV-WORKFLOWS patch recovery (Local Profile)

`DevWorkflowsRuntime.reconcileWorkspacePatchTask(taskId, runId)` observes the original
`workspace.apply_text_patch` execution using the trusted workspace/recovery/PowerShell binding.
An explicit `workspace` composition pins these identities and consumes the public coding-tools
reconciler. A host supplying its own `tools` can inject `workspacePatchReconciliation` plus
the trusted `workspace.preview_text_patch` implementation. Workflow requests cannot select
recovery paths, processes, credentials or a new run. The authorized apply records its exact
arguments and preview before dispatch. Fixed local `dev-patch-diagnostic:<runId>` categories
distinguish preview preflight, process identity, marker, helper input/exit and interruption
failures without exposing raw exceptions or private paths. The fixed `preview` stage covers
trusted preview, binding/candidate validation and original intent persistence before apply.
Diagnostics store only the stage and protocol error code; they do not establish `not_applied`,
create a marker or authorize replay. Preview failures retain the original unknown execution.

Unknown/in-progress polls retain the marker and execution state across SQLite restart.
An absent marker does not prove application. A `not_applied` result persists the original
failed execution before acknowledging the marker; it never silently retries.
An applied readback atomically confirms the same authorized execution and caches its exact
`WorkspacePatchApplyResult` while keeping the workflow in `waiting_reconciliation`. Pass the
returned bound `receipt` to `resumeConfirmed(taskId, receipt)` after restart to continue that
same workflow; it never authorizes a second apply or declares the CI repair complete. Verification,
commit, push, draft PR and backlink still require their original Policy approvals. The native Windows
unknown cause and the complete real repair chain remain unverified.

## Limits

### Obsidian pairing composition (MOD-08M)

`@personal-agent/runtime/application` exposes `createObsidianPairingHost({source, vaultIdentity,
confirmPairing})`. The trusted host supplies the existing native-selected Knowledge source, its
physical Vault identity, and an explicit native confirmation callback. `pair(peer, {deadline,
signal})` validates the public `@personal-agent/knowledge/pairing` descriptor and returns a fresh
private, read-only session. Pass the host's `source` to the existing `createTrustedKnowledgeTools`.
Pairing does not grant Policy permission; grants and task checkpoints remain required.

Confirmation is bounded to 30 seconds; sessions expire after 15 minutes. Source changes, peer
unload, cancellation, revocation and host shutdown invalidate leases. No state or credential is
persisted. The port remains provisional. MOD-08N adds authenticated loopback TLS and native pairing
UI; MOD-08O exposes `wikiSource.acquireWiki` for explicitly confirmed private citations. This lease
uses the original durable source identity and optional trusted `readPage`, while session task grants
retain fresh IDs. Only paired-folder hits are read; both local page versions and plugin excerpts must
agree. Missing metadata/citation support is unavailable, with no filesystem search or scan fallback.
Plugin change claims alone cannot withdraw facts. See [ADR-0019](../../docs/adr/0019-obsidian-runtime-pairing.md)
and [ADR-0021](../../docs/adr/0021-paired-citation-memory.md).

### Existing core limitations

- This is an in-process Runtime core, not a daemon or IPC server.
- Schedules are one-shot; recurring rules, wake timers and sleep detection are not implemented.
- Event history is retained without pruning, so CURSOR_EXPIRED is not produced yet.
- Restart recovery remains conservative: interrupted active work requires reconciliation; waiting approvals have an explicit resume path.
- SQLite migration ownership remains with goo122; other modules must not add competing root migration sequences.
- This work package verifies Fake model/tool behavior and Desktop smoke tests. Real model and external-write acceptance remain separate. Cross-task continuing grants and the Windows SecretStore adapter remain outside this slice.
- `event.subscribe` and `readEvents` have local replay tests, but no unsubscribe, pruning/expiry policy, or frozen cross-process stream lifecycle.

### Native developer harness: controlled executors (H1, provisional)

Competition composition can explicitly set `developerHarness: {workspaceRef, maxExecutorSteps, configurationRef?, assertCurrent?}`
alongside `delegateUserTasks: true`. `workspaceRef` identifies the workspace already confined by the
existing tool host; it grants no filesystem access. `maxExecutorSteps` is a required trusted aggregate
allowance for all execution plans owned by one `user-work` task. There is no new default allowance,
provider route, database, wire operation, or Local fallback.

The trusted host may instead provide synchronous `readDeveloperHarnessConfiguration: () => configuration | undefined`.
The two sources are mutually exclusive. A resolver registers the scoped broker even when initially disabled;
returning `undefined` hides it from the worker's usable catalog. Enabling it makes the next original user worker
eligible without recreating RuntimeApplication. Every admission, executor send/tool call, and approval recovery
rechecks the trusted snapshot. Plans and total reservations bind its workspace, budget, and opaque configuration
revision; changing or disabling the configuration fails closed for old work without increasing its allowance.
Original Runtime readback and cancellation remain available. `assertCurrent` must complete synchronously;
the model has no configuration mutation operation.

The interaction root still dispatches its exact original `user-work` and summarizes its receipt.
It cannot call `developer.harness.run`. Only that original worker can submit a plan through the normal
ToolGateway authorization path. The plan contains `planId`, an optional `expectedRevision` guard, and up to ten `tasks`;
each task supplies `id`, `role` (`researcher`, `coder`, or `reviewer`), `goal`, `dependsOn`, and `maxSteps`.
Model proposals cannot choose a parent, conversation, workspace, tool subset, provider, or deadline.
The broker validates the dependency graph, immutable owner binding, exact Gateway execution, tools,
configuration, and total step reservation before admitting work. All plans share the owner's durable
allowance; reservations are retained after failure, cancellation, and blocked dependencies.
The original proposal revision is always bound from Runtime's pending-loop record. Models need not
invent a revision absent from their public cloud input; an explicitly supplied different revision is rejected.

Executors are durable siblings in the original `desktop-subtask:<root>` conversation. Their
`developer-harness-executor:v1` marker must match the owner's persisted plan and exact definition.
They reuse TaskRuntime and the original Competition worker, with their allocated step limit and a
subset of the original tools. Neither ordinary recursive dispatch nor the broker tool is available
to executors. The generic `tool.invoke` path enforces the same subset. Independent eligible tasks may
run together; a dependent task starts only after its prerequisites actually succeed. The dependency
context cites their task IDs, revisions, and Evidence. Root dispatch checkpoints and receipts keep
their original `user-work` meaning; executor progress is stored in the owner's plan namespace.

`readSubagentTasks`, `listSubagentConversations`, `readSubagentConversation`,
`submitSubagentConversationMessage`, and `cancelSubagentConversationTask` consume the same durable
executor tasks. Results and progress return through the original worker to the interaction root.
Cancellation stops new admission and propagates to started tasks; Runtime facts remain authoritative.
Unknown writes retain `waiting_reconciliation`, block dependents, and are never retried by the broker.
Pending approvals retain `waiting_approval`. After the admitted executor group actually settles,
the original owner resumes its exact confirmed broker invocation and may admit newly eligible tasks;
the run identity, inputs, and total reservation remain unchanged. This does not reopen unknown
executors or automatically recover interrupted process work. Explicit child conversation messages
use the existing continuation API; they do not reopen the original plan or grant authority.

`test/developer-harness.test.mjs` exercises the actual RuntimeApplication/Gateway caller with explicit
Fake Coordination and SQLite, including dependency results, independent executors, scope rejection,
aggregate budget, cancellation, and unknown write preservation. This is local synthetic evidence;
real AgentArts/model invocation, Desktop composition enablement, native workspace isolation, and
complete developer harness acceptance require their own observations. The implementation follows
the project's original interaction-root/execution-child design and introduces no upstream code,
prompts, or execution configuration.

The native composition also connects `harnessCandidates` to the original Gateway catalog and canonical
run/session checkpoints. Trial, comparison, preparation, and the distinct original `coding.repair.publish`
remain separate executions. `isHarnessCodingRepairSession` is a synchronous host reader for the four
session operations `publish`, `snapshot`, `readback`, and `reconcile`: only the exact original owner/main
session prepared by a confirmed candidate operation uses the harness journal. HostBridge aliases retain
their existing F15 journal. Publication still requires original successful main-session verification,
Policy authorization, compare-and-swap, and readback; routing itself grants none of these.

The existing native `task.reconcile` surface can resolve an interaction root to its original unknown
candidate executors. It reads their original sessions without forging a running ToolContext or starting
a model/tool run. A clear stopped-operation observation permits the original Runtime atomic native
termination port to end the executor and fully stopped owner/root as failed or cancelled. Original
UNKNOWN tool records, caches, cloud markers, and side-effect Evidence are preserved. Unknown or active
readbacks remain unresolved; no successful outcome is inferred from a clear journal.

`configureHarnessExperience` composes once with the existing learning store. It proposes strategies only
after a succeeded original owner has exact confirmed trial/comparison/adoption/publication provenance.
Activation remains a separate native confirmation. Future workers read a current source-bound lease;
the model receives only the applicable verification recipe metadata and the original tool boundary
still applies. Final sends recheck the held lease. Source, configuration, or activation changes
invalidate its consumption rather than creating authority. Public strategy metadata does not become
private-memory content or bypass the original private-memory send guard.

An active guidance lease can enter a task-bound publication completion phase after its own canonical
confirmed adoption and original CAS publication/readback. The complete fresh workspace metadata must
equal that verified publication; a different configuration, external edit, revoked activation/source,
or UNKNOWN publication cannot enter this phase. The original lease stays immutable. Its frozen prompt
metadata is retained for the existing context binding, but every new tool request is refused and only
the original text completion can return. Final sends still check the same publication/source facts.
This is a narrow end of guidance consumption for one task, not applicability to the changed snapshot:
a later task must acquire its own strictly current lease through the unchanged learning lifecycle.

The H6 event composition submits an atomic original event-origin checkpoint before normal root
delegation. Startup observes that original record through pure readers, while live sends, tools, and
approval recovery recheck the current native source/responsibility authorization. Completion callbacks
only trigger receipt observation. Predispatch cancellation uses the exact original root activity and
cancellation facts; it creates no delivery receipt. All these final callers are source integration;
the combined pinned-runtime checks and real platform/device acceptance remain separate and pending.

The optional trusted `QQMailTriageHostOptions.batchAuthorization` composition separates mailbox
configuration readiness from page execution. It receives the original host-generated mail session,
its nonce, account/folder/query digest, actual page limit and original expiry. A first-page question
can cover that fixed manual batch; every following page retains its own Runtime tool run and exact
Policy grant, derived by the question host from the first confirmed receipt and original session
membership. Confirmed local classification uses a read-only receipt assertion, never a new execution
grant. Finishing, cancellation, configuration/revoke generation changes or the original expiry stop
the batch. Total mailbox size remains unknown; the page limit is not described as a total budget.
The port is host-only and optional for legacy compositions, with no Core wire or Schema change.
