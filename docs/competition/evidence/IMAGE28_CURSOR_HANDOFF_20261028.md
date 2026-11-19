# PersonalAgent 28 图接线：Cursor 交接（2026-10-28）

## 先读：暂停时的真实状态

- Owner 在本轮授权直接代实现 goo122 及 Potatos498 负责但整图所需的公共口、CAS、memory/knowledge graph adapter 和业务薄适配，不等待对方 PR。目标是 `huawei_ict_agentarts` Competition Profile。原长期维护归属不变。用户最后明确要求**暂停所有开发与测试，写交接给 Cursor**；本文不是继续执行授权的替代品，Cursor 按用户后续指令继续。
- 实际隔离工作树：`D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring`。分支 `codex/image28-full-wiring`，基线 `4dbf01e1ffbb1179f8a600abf63db0fcd917afa5`（PR #522 merge）。本轮以 `git ls-remote origin refs/heads/main` 读回该 SHA；这是当时读回，不代表后续远端未变化。原外层工作树 `D:\worktree\1183\PersonalAgent` 为 detached HEAD，已有未跟踪 `.codex/`；不要清理它。`D:\PersonalAgent` 主树与其他工作树有他人未跟踪文件和分支，不要切换、清理或覆盖。
- **全部改动尚未提交、未 push、未开 PR、未合并。** 大量新文件为 untracked，`git diff` / `git diff --stat` 默认不包含它们，交接时必须保留整个工作树，不可只复制 tracked diff。`node_modules/`、`dist/`、`.cache/` 是被忽略的本地构建/测试产物；不要提交 `.env`、密钥、`credentials.csv`、Electron userData，也不要清理其他人的数据。最新 `git diff --check` 对 tracked diff 无输出；它不检查未跟踪文件。
- 本轮没有完成 28 图整体验收，也没有给 152 项清单打勾。逐项在 [152 项清单](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md)，来源为 `getOwnedWorkflowAdapterRequirements()`：111 host + 41 guard = 152；AgentArts 构建后已逐名核对。F20 为 0/0，仍需真实可信输入和完成核验。各图 registered/configured/tested/evidence/still-blocked 基线见 [28 图工作记录](IMAGE28_FULL_WIRING_20261028.md) 与 [原矩阵](../IMAGE28_CONVERSATION_WIRING_20261018.md)；注意本文后面关于最新 F15 主进程的暂停中间态优先于较早记录。
- 不要 Fake：禁止永远成功的 CAS、假签名/ASR/Evidence、把 AgentArts settled 当本地完成、把没有真实关机后云宿主的 `cloudPersistentHost.available` 写成 true。沿用现有 TaskRuntime、Policy、ToolGateway、HostBridge、Scheduler、ModelGateway，不新建并行任务库、调度器或 Agent loop；禁止 AgentArts 失败后回退 Local/Fake。用户未授权 push/PR/merge；完成实现和本地验证后才询问是否 push/PR。
- 暂停时中断了所有开发代理。最新 `Get-Process node,pwsh,powershell` 只显示 `pwsh` PID 31660，未显示 Node；这是一次受限只读快照，不能证明系统没有后台任务，也不能认定该 PowerShell 属于本任务。不要据此关闭用户进程。最后一次 Desktop 三文件测试于启动后约 0.3 秒被中断，平台提示可能仍有后台进程，**无测试结果**。

## 最急：最新 F15 Desktop 处于未验证中间态

1. `apps/desktop/electron/main.js:1746` 新增 `verifyF15ViewerExecutable`，用 Windows Authenticode 检查固定 PowerShell；`main.js:1761` 附近为 reviewer snapshot/安装，`:2672` 起构造 reviewer/viewer/origin，`:3607` 起处理 `coding.review.configure` / `revoke` / `show`，`:4891` 附近关闭自己的宿主。`apps/desktop/src/app/workspace-controls.js` 新增审核配置和 pending 展示入口。**这是用户暂停前最后写入的改动**：代理报告两文件通过 `node --check`，但未做真实 Desktop 组合、授权卡、Native UI 渲染/可视检查。不要把它称为已交付。
2. `apps/desktop/electron/f15-review-config-host.js` 管理用户原生选择的 reviewer ID、策略、Ed25519 公钥和本地签名目录，加密持久化、撤销和等待原任务签名；`f15-review-origin-host.js` 复核原 F15 task/session、HostBridge intent、原快照/读取/preview、Policy 和授权后才允许 native 展示；`f15-review-native-view.js` 用固定 WinForms 脚本和私有 stdin 展示原源码/patch，不通过命令行、日志、Renderer 或文件传递；需要可信 `verifyExecutable`、原任务授权和 deadline。展示窗口关闭不是审查通过。`workspace-config-host.js` 新增 `assertF15ReviewWorkspacePermission`，要求原 workspace-session 许可仍有效。
3. 部署摘要只标识实际 AgentArts 执行配置，不证明自然人身份。reviewer 独立性以用户明确 native 确认 `user_confirmed` 为限，不可根据字符串不同冒称独立审计。实际审核者需在独立环境审阅原补丁并签名，产品不生成/持有私钥；无真实 reviewer 或权限保持 unavailable。本机 `C:\Program Files\PowerShell\7\pwsh.exe` 曾只读验证 Authenticode 为 Valid / Microsoft Corporation，这不证明新 main 接线或真实 WinForms 效果。
4. 暂停前计划的可视验收脚本**尚未创建，真实窗口没有启动或目视验收**。继续者应先只读审查上述最新 diff，确认 executable 签名/哈希检查、用户确认、origin 和旧任务撤销/重配的信任边界；再按用户授权用纯 Synthetic 内容做实际原生窗口可视验收，不能关闭用户已运行应用。低风险语法通过不能代替渲染与真实权限验证。
5. 最新被中断命令：`node --test apps/desktop/test/workspace-controls.test.mjs apps/desktop/test/f15-review-origin-host.test.mjs apps/desktop/test/f15-review-native-view.test.mjs`；无结果。前一版本 `f15-review-config-host.test.mjs` + `f15-review-origin-host.test.mjs` 沙箱外 6/6、viewer 代理报告 Synthetic 6/6；不是最新 main/Renderer 或真实 UI 验收。检查是否存在本任务残留进程时，先核实身份，不要停止无关进程。

## 已做的代码：按责任与具体位置

### 通用图与 F20

- `apps/runtime/src/application/owned-workflow-driver.ts`：复用原 WorkerContext，固定 workflow/session/deadline/image/input/catalog checkpoint，消费 frontier → HostBridge → 原 HostTask → receipt → advance；`confirmedOperations` 以 operationId 保留同工具多次结果；缺 adapter 时只以本地模板和原 catalog 生成结构化 unavailable，不信云端原因。新增 `authorizeProposal` 门禁、非 `awaiting_host` 提案拒绝，以及 F15 审核前置等待逻辑。未知写/未知发送不重放，cloud settled 仍依靠本地 `validateSettled`。
- `apps/runtime/src/application/owned-workflow-worker-capability.ts`：受限 F20 `workflow.image.execute`，只接受 `workflowId` 和可信 case `inputRef`；固定双源分别经原 HostBridge/Policy 读取，原审批、unknown 和重启绑定原操作；禁止模型提供任意路径、命令、receipt、checkpoint 或签名；本地原回执验证前驱、命令和源。缺可信 `resolveInput`、`authorizeExport`、`assertFrontier`、`verifyCompletion` 等 provider 不公布。`runtime-application.ts` 组合两个受限 worker、catalog、原 HostTask 审批与已核实原结果后的恢复。
- `apps/desktop/electron/f20-case-config-host.js` 与 `workspace-config-host.js`：仅有本机显式选择 case 的加密存储、工作区/recipe 绑定和解析；未接 main、用户选择 UI、实际前沿/出机/完成验证，不代表生产 F20 配置完成。`apps/desktop/test/f20-case-config-host.test.mjs` 首次沙箱 `realpathSync.native` 为 EPERM；后续沙箱外 1/1 通过。

### F15 独立审查与多轮修复

- `apps/runtime/src/application/coding-repair-frontier.ts`：在提交 HostBridge 前，以原 `coding.repair.start` 记录、task/session、N01 snapshot、N02/N03 原选择、N03 source 读取、N04 preview 的实际原 intent/HostTask/Policy/Evidence 验证 scope、patch 和 SHA；旧轮记录不得用于新轮。下一轮 snapshot 必须来自上一轮原 N05 失败检查读回，与 preview 的 before/after 对应。N05/N06 前还要精确独立 review、原检查和原发布读回。
- `coding-repair-signed-review.ts`：严格验证已配置 Ed25519 reviewer 的外部签名、审查者/作者、task/session/snapshot/patchDigest、policy/expiry 和撤销；不生产私钥或签名。`coding-repair-application.ts` 用原 HostBridge/Policy 提交审查前置操作，保留审批/unknown，不重放；`coding-repair-frontier.ts` 保留原 review EvidenceRefs 并重验授权、deadline、审查有效期。独立审查配置缺失继续 unavailable。
- `runtime-application.ts`：`readCodingRepairExecutionIdentity()` 返回真实 coordinator/image 绑定（不证明人类身份）；`configureCodingRepairIndependentReview()` 使用启动时已经注册的 host-only 固定 bridge，provider 只能在无未终态任务时变更，不改冻结的 ToolGateway descriptor，不得暴露给模型 catalog。首次动态注册曾失败 `UNAUTHORIZED Registered tool set changed`，改固定 bridge 后相关合成组合及 F09/F20/F15/F02 32/32；最新 Desktop main/UI 接线另未验证。
- `tests/manual/agentarts/coding-repair-full-graph.mjs` 和 `apps/runtime/test/coding-repair-worker-capability.test.mjs` 的夹具补齐真实前驱、原 Gateway 和明确 Synthetic 临时 Ed25519 review，保留原断言；绝非真实独立审查者或云验收。

### F01 / F02 与原责任状态（原 goo122 公共口及 Owner 模块代实现）

- `workflow-f01-context-host.ts`：F01_N02 可选 host，仅从当前原 HostTask/intent 和受限公开 MemoryQueryPort 读取；责任/模型/query 都需受信端口；授权导出前后重读并检查撤销、版本、factId/sourceRef 与敏感异常脱敏。`workflow-f01-context-sources.ts` 复用持久 proactive 责任、原会话/quote SHA 和真实 ModelGateway 声明；必须验证同名模型与原 AgentArts 实际 deployment 一一对应，conditional 不升级 verified。`workflow-f01-query-binding.ts` 使用 Runtime SQLite 原生选择绑定/CAS，拒绝模型自选事实。`proactive-workflow-application.ts` 在既有原子状态添加 responsibility lifecycle：原用户来源、版本、期限、撤销和幂等；旧记录不回填 active，Policy 另行判断。
- F01 的可信原生用户 fact 选择、责任 lifecycle 真实授权、具体 AgentArts deployment↔gateway 对应及精确出机 provider 尚未在 Desktop 生产组合全接；不可用时不注册。近期 `workflow-f01-query-binding.test.mjs`、`workflow-f01-context-host.test.mjs`、`workflow-f01-context-sources.test.mjs` 定向 14/14；F01/proactive/F15 相关 5 文件组合 39/39（不同测试批次，不能相加为整图验收）。
- F02：`workflow-f02-question-host.ts` N01 读取真实 `AuthorizationQuestions` 和 Runtime 原 pending approval，验证问题/审批各自 revision、参数和期限；`workflow-f02-confirmation-host.ts` N05 只观察真实用户答复、已消费 requirement 与原 Policy 当前 grant，不签发授权；`workflow-f02-transcript-host.ts` N03 要求原真实 final 事件、原问题、声学与播报证明和独立精确出机授权。`apps/desktop/electron/live-voice-host.js` 保存绑定真实 Live `final/input_audio`、item/start/stop 的受限本地回执；**echo=unknown、questionPlaybackVerified=false**，缺实际声学/播报证明时 N03 unavailable。N02 播报宿主暂停时还未开始编码；不得把文本历史、模型确认或合成音频冒充 ASR/用户授权。F02 N01/N05 4/4，N03 guard 2/2（Synthetic graph 源与出口，真实 Runtime/AuthorizationQuestions 局部）；Live 回执 2/2、旧 live host 34/34 由代理记录，未验真实设备/云/麦克风/播报。

### F06 / F09（原 Potatos498 侧代实现）

- `apps/desktop/electron/todo-host.js` 可选 F06_N04：只有可信 `verifyWorkflowReminderBinding` 可核对同图 N03 原 confirmed receipt 才注册；读原待办 revision/真实时钟，不触发 Scheduler 或冒称送达；当前 main 未注入，F06_N03/N05 仍缺。`apps/desktop/test/f06-reminder-adapter.test.mjs` 合成 2/2。
- `f09-feed-graph-host.js` N02 从同一 F09 session 的原 N01 `feeds.collect` HostTask/HostBridge/Policy 读回确认结果，完整数据只去精确重复、保留不同版本和分页。`feeds-host.js` 增加原源访问、精确 source export、派生访问与模型目标一致性检查；无法证明 source HostTask 和图 worker 的实际目标一致即拒绝，不能仅复用来源授权作为派生结果授权。
- `owned-workflow-f09-worker-capability.ts` 和 `runtime-application.ts` 添加受限 `workflow.feed.execute`，缺可信输入/原源出机/派生 receipt/前沿提供者时不公布。`packages/agentarts/src/owned-workflows.ts` 在 F09_N02 仅从已验证 N01 receipt 暴露 `predecessorOperations.F09_N01` 关联，`workflow-dataflow.ts` 根据其与公开 schema 确定性提出候选，仍需原 selector 和本机校验；`packages/agentarts/src/index.ts` 投影该字段。F09_N04 的真实 F10 入队/消费尚无，保持 unavailable；不能把普通 Scheduler fired 当 F10 完成。`owned-workflow-f09-runtime.test.mjs` 真实 Engine + Synthetic source/selector/host 覆盖到 N04 unavailable；AgentArts + F09/F20 回归 56/56。Desktop 许可/N02 组合曾有真实 SQLite Runtime/Policy/AuthorizationQuestions/HostBridge、Synthetic 订阅的 11/11；尚未验证真实订阅或云。

### F23 / F24 / F28（原 goo122 公共 Runtime 代实现）

- F23 `workflow-shadow-configuration.ts`：真实 Runtime SQLite 单键完整值 CAS，配置和不可变 operation 同事务，重复 ID/参数、revision、回滚锚及未知提交 readOperation 处理；`workflow-shadow-acceptance.ts` 是独立授权的版本化 acceptance，不代表测试通过。`workflow-shadow-authorization.ts` 绑定真实 HostBridge intent、HostTask、ToolGateway/Policy；`TaskRuntime.compareAndSetTrustedHostStateGuarded()` 在同 SQLite 写事务内重验原 intent/Policy/acceptance/revision 后 CAS，防撤销竞态；不接受跨 Runtime 的 guard。`workflow-shadow-verifiers.ts` 只验现有签名，并复核原 Runtime execution/Evidence、pair 上下文及独立测量 callback；签名不能证明测量本身。相关定向 15/15 为本地 SQLite + Synthetic 测量/授权。实际云配置消费者、版本发布与应用读回、真实评测 producer 和 Desktop 装配均未完成；不要把本机 F22 `shadowPolicy` 当 F23/Laya 云配置。详见 [F23 权威来源](F23_CONFIGURATION_AUTHORITY_20261028.md)。
- F24 `workflow-f24-reconciliation-host.ts` N09：只读取已独立核实的**原业务 task/run**，核对同图 HostTask namespace、双向 intent、参数摘要、Policy grant、verified observation、未篡改和精确出口；unknown/缺读回保持 unavailable，不新执行、不重试。真实 Runtime/HostBridge Synthetic 对账集成 1/1，加单测 6/6；实际原目标选择、readback verifier、出机许可和 graph driver/guard 尚未装配。
- F28 `apps/runtime/src/workflow-role-plan.ts`、`application/workflow-role-plan-host.ts`、`TaskRuntime.beginWorkflowRolePlanAttempt` / `freezeWorkflowRolePlan` / `submitTaskWithSubagentBinding`（`apps/runtime/src/index.ts:1277` 附近）在同 SQLite 事务预约原 operation/绑定摘要和 child ID，防 child-first、重放与替换；提交未知用独立授权只读对账，不把匹配配置等同操作成功或授权。`application/subagent-host.ts` 原 dispatch 走事务方法，普通历史幂等/attachment 和递归禁令保留。缺真实 HostBridge intent provider、执行前当前授权/catalog/预算 gate 时预留 child 在创建前 fail-closed。F28_N03 没有注册，不能称图接通。`workflow-role-plan.test.mjs` 13/13，旧 subagent 4 组 37/37，均合成任务 + 本机 SQLite。
- F03/F04/F05/F07/F08/F10/F11/F12/F13/F14/F16–F19/F21/F22/F25–F27 尚未在本轮交付完整图；逐图具体缺口见工作记录。F13 现有系统观察只有 CPU/内存/uptime，不含云、配额、锁，不能用它填三项；F17 的 `all6PassResolved` 不能由一次 repro exit 0 或日志解析冒充；F22 shadow 意图不是独立反事实执行或受信历史回放。电脑控制只用现有公开工具，不大改无关代码。

## 测试、首错与环境

工具链：`D:\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64\node.exe`（24.15.0）；npm 11.12.0 CLI 为 `D:\PersonalAgent\.cache\toolchains\npm-11.12.0\node_modules\npm\bin\npm-cli.js`。本工作树 `.cache\npm-wrapper\npm.cmd` 是忽略的本地 wrapper，不在 Git。为子进程设置 Path 时应包含该 wrapper、Node、`C:\msys64\ucrt64\bin`（TLS OpenSSL 夹具）、`C:\Windows\System32` 和 `C:\Windows`；不要改全局 Node 或代理。恢复时按实际状态重检，不假设机器未变化。

- `npm run check` 曾以 Node 24.15/npm 11.12 执行：architecture 3/3、contract fixtures 4/4、generated 检查及构建/类型检查进入工作区测试后，coordination live HTTP/WS 出现 `EXTERNAL_FAILURE`（预期 `CANCELLED`/`TIMEOUT`）；knowledge `bridge.test.mjs` pinned TLS 与 cancellation 失败，之后长时间无输出而手动中断，**全量 check 未完成**。增加 OpenSSL PATH 后，沙箱内单独 pinned TLS 的实际错误 `KnowledgeError SOURCE_UNAVAILABLE`（测试第 26 行）；沙箱外针对 coordination peer close/WS stall/HTTP stall 9/9 和 knowledge 两项 2/2 通过，支持本机沙箱回环限制解释。不能把这些局部复测升级成完整 check。
- `agentarts-proposal-invocations.test.mjs` + `agentarts-status-recovery.test.mjs` 在含 OpenSSL PATH 下串行 54/54；全量首错输出被截断，不能断言这就是首错文件。`git diff --check` 最新无输出，只覆盖 tracked diff。
- Runtime 最新构建在最后 F15 main/设置 JS 编辑前通过；`coding-review-composition.test.mjs` + F09/F20/F15 worker + F02 transcript 32/32。F01 query/source/host 14/14；F02 question/confirmation 4/4；F24 host 6/6、真实 Runtime 合成 unknown 对账 1/1；F23 4 个测试文件 15/15；F28 role-plan 13/13 与原 subagent 37/37。F09 Engine/orchestrator/Runtime 合成组合和 F20 回归 56/56。各批次运行时源码版本不完全相同，**不要简单相加，也不要宣称这些结果覆盖最后 main/UI 编辑**。
- F15 `coding-repair-application.test.mjs` 沙箱外 28/28；旧 `coding-repair-worker-capability.test.mjs` 16/16，原断言未删除。首次 4 条旧 Synthetic 快捷 fixture 因新前沿门禁失败，夹具补齐原 HostBridge 前驱和 Synthetic 签名后通过；完整图首次缺独立审查失败、第二次多轮 snapshot 校验失败，修复后才 28/28。F20 case 沙箱外 1/1。不要掩盖这些首错。
- 所有 Synthetic、Fake provider、临时签名 key、静态来源或有条件回调仅证明对应本地边界，不是已配置真实账号、独立人类审查、云部署、真实模型、物理语音/Windows 设备或完整 28 图。`cloudPersistentHost` 未注入，因为没有可证明关机后持续运行的真实云宿主。

## 接手顺序建议（仅供用户恢复后）

1. `cd D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring`，重新读取当前 `git status --short --branch`、本文件、逐图工作记录和 152 清单；检查是否有并发修改。不要切换主树或清除未跟踪文件。
2. 优先审查暂停时最新 `main.js`、`workspace-controls.js`、F15 config/origin/native viewer 与 Runtime bridge。恢复用户授权后执行中断的定向测试、在真实 Windows 做 Synthetic 可视验收并检查原权限/撤销；不要使用真实账号或把 user-confirmed 标为独立身份已认证。
3. 接 F01 真实 native 选择/责任授权/模型 deployment 绑定；F02 原问题选择、真实播报/声学防回声与原授权消费；F09 真实来源许可和 F10 受信入队/消费；F20 可信 case/前沿/出口/完成校验；F23 真实消费者和评测 producer；F24 原目标/效果读回；F28 pre-execution gate。每图按实际配置 unavailable、真实 receipt 与 Evidence 分开验证。
4. 继续其余图的真实 host/guard，完成一项才更新 152 清单及逐图状态。公共接口/Runtime/桌面变更完成后用项目当前脚本执行必要定向测试和完整 `npm run check`；遇本机回环/文件系统沙箱阻断按平台权限机制处理，保留首错和真实边界，不删断言。正式云/设备/账号验收单列，不用 Fixture 冒充。
5. 用户最后明确：未经其说“推送/开 PR/合并”不得执行这些动作；本轮已暂停，先交接，不替用户新建 Cursor 任务或发送外部消息。
