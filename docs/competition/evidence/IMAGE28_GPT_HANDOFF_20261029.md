# PersonalAgent 28 图接线：GPT 交接（2026-10-29）

> 本文件取代暂停时的 [Cursor 交接](IMAGE28_CURSOR_HANDOFF_20261028.md) 作为**当前**继续入口。逐图矩阵仍以 [工作记录](IMAGE28_FULL_WIRING_20261028.md) 为准；152 项清单 [IMAGE28_HOST_GUARD_CHECKLIST_20261028.md](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md) **仍全部未勾选**（不得把 Synthetic/工厂存在当验收）。

## 0. 给 GPT 的硬约束（先读）

- Profile：`huawei_ict_agentarts`。Competition Golden Path；禁止 AgentArts 失败后静默回退 Local/Fake。
- **不要 Fake**：禁止永远成功的 CAS、假签名/ASR/Evidence、把 AgentArts settled 当本地完成、无真实关机后云宿主却把 `cloudPersistentHost.available=true`。
- 邮件/日历/订阅等业务连接器**允许**真实接线与调用（旧「本轮禁止邮件」是误留规则，已作废）。仍须经 Policy/授权；缺配置保持 unavailable。
- 沿用 TaskRuntime / Policy / ToolGateway / HostBridge / ModelGateway；不新建第二套任务库、调度器或 Agent loop。
- Renderer 不直连 Runtime；跨包只用公开 exports。
- **全部改动尚未 commit / push / 开 PR**。用户要求「先本地全部做完再 PR」；开 PR 前须用户明确说推送/开 PR。
- 保留他人工作树、未跟踪文件与 stash；不要清理 `D:\PersonalAgent` 主树或其他 `.worktrees`。
- 默认用中文回复用户。

## 1. 工作树与 Git

| 项 | 值 |
| --- | --- |
| 工作树 | `D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring` |
| 分支 | `codex/image28-full-wiring` |
| 基线 HEAD | `4dbf01e1ffbb1179f8a600abf63db0fcd917afa5`（PR #522 merge；**无新 commit**） |
| 状态 | 大量 **modified + untracked**；`git diff` 默认不含 untracked，交接必须保留整树 |
| stash | `stash@{0}`：`WIP on codex/image28-full-wiring: 4dbf01e1`（云迁移时留下；**勿 drop**，除非确认已完全 apply） |
| 勿动 | 外层 `D:\worktree\1183\PersonalAgent`（可能 detached）、`D:\PersonalAgent` 主树及其他协作者工作树 |

工具链（本机曾用）：

- Node：`D:\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64\node.exe`（24.15.0）
- npm wrapper：`D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring\.cache\npm-wrapper`（忽略产物）
- PATH 建议含：上述 Node、npm wrapper、`C:\msys64\ucrt64\bin`（OpenSSL/TLS 夹具）、`C:\Windows\System32`、`C:\Windows`

恢复后先：

```text
cd D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring
git status --short --branch
```

## 2. 本轮相对旧交接的进展（已落地）

### Desktop 生产组合（`apps/desktop/electron/main.js`）

- **F15 独立审核**：`f15-review-config-host.js` / `f15-review-origin-host.js` / `f15-review-native-view.js` 已接；IPC `coding.review.configure|revoke|show`；`workspace-controls.js` 审核 UI；关闭时 `close` viewer/host。
- **F09 N02 + worker ports**：`createF09FeedGraphHost`；`createF09WorkflowWorkerPorts` 经 `f09WorkflowWorkerPorts` 交给 AgentArts，有固定 `deploymentVersion` 时合并 ownedImage 注入 worker（仍在 F10 处 unavailable）。
- **F06 N04**：`createVerifyWorkflowReminderBinding` 已传给 `createDesktopTodoHost`；依赖同图 N03 checkpoint `f06:n03-todo:{session}`。
- **可选图组合**：`workflow-graph-composition.js` 条件注册 F08_N10 / F12_N02 / F13_N02（`getApplication` 惰性）。
- **F20 case**：`coding.f20.configure` IPC 已接。**未**注入 `ownedWorkflowWorker`（见 F20_WORKER_TRUST_GAPS）。
- **quit 夹具**：含 `f09FeedGraphHost`、`workflowGraphComposition`、`f15Review*`。

### Runtime / AgentArts（可选工厂，缺 provider → `tools:[]`）

导出见 `apps/runtime/src/application.ts`。共享 scope：`workflow-owned-host-scope.ts`。

| 区域 | 主要文件 |
| --- | --- |
| F01 | `workflow-f01-context-host.ts` / `context-sources.ts` / `query-binding.ts` |
| F02 | `workflow-f02-question|confirmation|transcript-host.ts`；Live 回执在 `live-voice-host.js` |
| F03–F07 | `workflow-f04-f05-recall-host.ts`（含 F03 memory）、`workflow-f06-todo-graph-host.ts`、`workflow-f07-calendar-graph-host.ts`；Desktop todo 可选 F06_N04（**main 未传** `verifyWorkflowReminderBinding`） |
| F08 | `workflow-f08-mail-graph-host.ts`（N03/N07/N10/N12/N13；可绑 `mail.mark_seen` / `mail.save_draft` / `mail.reconcile_send`） |
| F09/F20 worker | `owned-workflow-f09-worker-capability.ts`、`owned-workflow-worker-capability.ts`；**Desktop 未传** `f09WorkflowWorker` / `ownedWorkflowWorker` |
| F12/F13/F21/F25/F27/F28 | `workflow-f12-notification-*`、`f13-probe-*`、`f21-skill-*`、`f25-outbound-*`、`f27-model-*`、`f28-model-native-*` |
| F15 | frontier / signed-review / coding-repair application；Desktop review 已接 |
| F23 | `workflow-shadow-*.ts`；权威边界见 `F23_CONFIGURATION_AUTHORITY_20261028.md`；Desktop **未传** `workflowShadowRelease` |
| F24 | `workflow-f24-reconciliation-host.ts` |
| F28 底座 | `workflow-role-plan.ts` + TaskRuntime 事务预绑定；图 N03 可选工厂默认不注册 |
| AgentArts | F09 `predecessorOperations.F09_N01` 投影（`owned-workflows.ts` / `workflow-dataflow.ts`） |

### 验证（2026-10-29，含 OpenSSL PATH）

| 命令/范围 | 结果 |
| --- | --- |
| `npm run check` | **通过**（exit 0） |
| Desktop F06/F09/F15/F20 + workspace-controls | 定向曾 28/28；F15 review hosts 12/12；quit-preflight 33/33 |
| Runtime F01/F02/F09/F15/F20/F23/F24/F28 等相关 | 曾 85/85；F15 app+worker+AgentArts 等曾 92/92 |
| `workflow-optional-graph-hosts.test.mjs` | **13/13** |

说明：各批次源码版本不完全相同，不要简单相加当整图验收。Fake/Synthetic ≠ 真实账号/云/设备。

## 3. 仍缺（优先继续顺序）

1. **生产注入 worker（有完整受信口才传 options）**
   - `f09WorkflowWorker`：`image` + `resolveInput` + `authorizeSource/Receipt` + `assertFrontier` + `available/assertCurrent`（参照 `owned-workflow-f09-runtime.test.mjs`）。缺 F10 入队仍应对 N04 unavailable。
   - `ownedWorkflowWorker`：`resolveInput` ← `codingWorkspace.resolveF20Case`；补 `assertFrontier` / `authorizeExport` / `verifyCompletion`（参照 `owned-workflow-worker-runtime.test.mjs`）。缺则不公布 worker。
2. **F06**：实现并注入 `verifyWorkflowReminderBinding`（核对同图 N03 confirmed receipt）后再注册 N04；N03/N05 Desktop 原回执与真实送达。
3. **F01/F02/F08/F12/…**：把可选工厂在 Desktop `conversationTools` / Runtime options 中**条件注册**；F02 N03 无声学/播报证明则保持 unavailable。
4. **F08 Desktop**：将真实 mail 工具与 Policy scope 接到 `createRuntimeF08*`（允许真实调用，勿 Fake 成功发送）。
5. **F23**：仅当有真实 configuration consumer + 测量/test Evidence producer 时注入 `workflowShadowRelease`。
6. **F10/F11/F14/F16–F19/F22/F26 等**：多数尚无工厂；按清单补 fail-closed adapter，禁止空成功。
7. **Renderer**：F20/`coding.f20.configure`、F15 审核以外的设置入口；F15 真实 WinForms 目视验收（Synthetic 内容，勿冒充真人独立身份）。
8. **152 清单**：仅在「生产注册 + 真实宿主 + 约定测试证据」齐备后逐项勾选；当前全未勾。
9. 用户确认后：scoped commit → push → `gh pr create`（模板 `.github/pull_request_template.md`）；常规 PR 需非作者 Approve。

## 4. 关键入口文件（改组合时）

- Desktop 组合：`apps/desktop/electron/main.js`（tools 组装 ~2434+；F15 ~2672+；IPC coding.review / coding.f20 ~3607+；before-quit ~4885+）
- Feeds / F09：`feeds-host.js`、`f09-feed-graph-host.js`
- Workspace / F20 / F15 permission：`workspace-config-host.js`、`f20-case-config-host.js`
- Runtime 组合：`apps/runtime/src/application/runtime-application.ts`、`application.ts`、`agentarts.ts`
- 图驱动：`owned-workflow-driver.ts`
- 状态文档：本文件 + `IMAGE28_FULL_WIRING_20261028.md` + `IMAGE28_HOST_GUARD_CHECKLIST_20261028.md` + `docs/competition/IMAGE28_CONVERSATION_WIRING_20261018.md`

## 5. 建议接手命令

```text
cd D:\worktree\1183\PersonalAgent\.worktrees\image28-full-wiring
git status --short --branch
# PATH 含 Node 24.15 + npm-wrapper + C:\msys64\ucrt64\bin
npm run build --workspace=@personal-agent/runtime
node --test apps/runtime/test/workflow-optional-graph-hosts.test.mjs
node --test apps/desktop/test/f09-feed-runtime-integration.test.mjs apps/desktop/test/f15-review-*.test.mjs apps/desktop/test/quit-task-preflight.test.mjs
# 大改公共口/组合后再：
npm run check
```

## 6. 交付时向用户说明

- 目标 profile、工作树、主要改动、接口影响、验证结果、未验证项、剩余问题、commit/PR 状态。
- 未完成 28 图 / 未勾 152 项前，不得声称整图验收完成。
