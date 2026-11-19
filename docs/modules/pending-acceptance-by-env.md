# 真环境待验收总表

<!-- generatedAt: 2026-11-07T04:56:11.353Z -->
> 生成时间：`2026-11-07T04:56:11.353Z` · 依据规范：[AGENTS.md](../../AGENTS.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · 扫描范围：仅当前工作树

> [!IMPORTANT]
> 本总表由离线工具 `scripts/acceptance/build-pending-acceptance-index.mjs` 静态扫描生成。
> **核心声明**：仅假设这些文件合入后的离线输入汇总、非真实验收、非已合并主干。
> **安全红线**：未连接任何真机/华为云环境，未读取密钥凭据，未执行任何规划文本内的指令（所有输入文件纯粹作为静态文本读取，严禁 import/eval/执行）。
> **诚实原则**：`closedLoop: false` 属于合规待真实验收状态；缺失真环境独立读回证据前，工具绝不推断或背书「已闭环」。

## 1. 扫描与待验收概览

| 指标 | 数量 | 说明 |
| --- | --- | --- |
| 扫描文件总数 | 2462 | 排除 .git / node_modules / dist / .worktrees |
| 合规待验收规划 | 0 | 结构完整、字段齐全的规划记录 |
| 校验异常/缺字段项 | 4 | 识别为规划但缺 closedLoop/环境/步骤/证据等字段 |
| 跳过的历史非规划文件 | 734 | 历史证据/回执/矩阵，不作为规划执行 |

## 2. 各环境待验收规划汇总

### Windows 真机环境 (`windows_real_machine`，共 0 项)

*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*

### 华为云 / AgentArts 云端环境 (`huawei_cloud`，共 0 项)

*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*

### 真实账号 / 凭据授权 (`real_account`，共 0 项)

*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*

### 权利人 / 人工审批与复核 (`rights_holder_or_human`，共 0 项)

*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*

### 其他物理或定制环境 (`other`，共 0 项)

*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*

## 4. 已知未合并验收规划 PR（待合并后自动纳入）

以下分支/PR 包含 zemeng 离线规划纯函数及标准 Markdown 验收规划。当前**尚未合并至 main**，本工具遵循诚实原则**未将其作为工作树已有文件纳入上表统计**。待合入后无需修改本工具即可自动纳入：

| PR | 分支 / 描述 | 规划目标 | 涉及环境 | 状态 | 核心函数/依据 |
| --- | --- | --- | --- | --- | --- |
| **#594** | `zemeng/mod19-sqlite-smoke-plan` | MOD-19 打包后 Electron SQLite 烟测离线规划 | `windows_real_machine` | `open_pending_merge` | `planPackagedSqliteSmoke` |
| **#596** | `zemeng/mod29-deployment-readback-plan` | MOD-29 云端部署与版本读回离线规划 | `huawei_cloud` | `open_pending_merge` | `planDeploymentReadback` |
| **#598** | `zemeng/mod19-release-acceptance-plans` | MOD-19 安装/升级/卸载全生命周期离线规划 | `windows_real_machine` | `open_pending_merge` | `planReleaseLifecycleAcceptance` |
| **#599** | `zemeng/mod16-live-acceptance-plan` | MOD-16 真实记事本 UIA/原生窗口读回规划 | `windows_real_machine` | `open_pending_merge` | `planNotepadLiveAcceptance` |
| **#602** | `zemeng/mod27-privacy-deletion-plan` | MOD-27 隐私擦除与数据持久化清空规划 | `windows_real_machine` | `open_pending_merge` | `planPrivacyDeletionAcceptance` |
| **#604** | `zemeng/mod18-windows-sandbox-acceptance-plan` | MOD-18 Windows 沙箱安全隔离执行规划 | `windows_real_machine` | `open_pending_merge` | `planWindowsSandboxAcceptance` |
| **#605** | `zemeng/f09-cloud-prefix-acceptance-plan` | F09 订阅云前缀与会话授权读回离线规划 | `huawei_cloud`, `real_account` | `open_pending_merge` | `planF09CloudPrefixAcceptance` |
| **#606** | `zemeng/cloudpersist-acceptance-plan` | MOD-04B 关机后云持续离线验收规划 | `huawei_cloud` | `open_pending_merge` | `planCloudPersistentAcceptance` |
| **#607** | `zemeng/mod04b-agentarts-acceptance-plan` | MOD-04B AgentArts 端到端云编排验收规划 | `huawei_cloud` | `open_pending_merge` | `planMod04bAgentArtsAcceptance` |
| **#572** | `zemeng/real-acceptance-guide` | 真实验收指引（指引规范，非闭环记录） | `windows_real_machine`, `huawei_cloud`, `real_account`, `rights_holder_or_human` | `open_pending_merge` | `guideline_only` |

## 5. 扫描校验异常清单 (4 项)

> [!CAUTION]
> 以下文件被识别为验收规划候选，但因字段缺失、分支歧义或防伪校验失败而报错。工具已如实记录，绝不静默跳过、绝不猜测默认分支、绝不伪造字段：

| 来源路径 | 规划标题 | 缺失字段 | 无法确认原因 (cannot_confirm) | 错误详情 |
| --- | --- | --- | --- | --- |
| `docs/modules/DEV-WORKFLOWS-PLAN-20261002.md` | DEV-WORKFLOWS：开发工作流自动化功能群（2026-10-02 登记） | `id`, `closedLoop`, `status`, `requiredEnvironments`, `acceptanceSteps`, `evidenceRequirements` | `id`: missing_id<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | Missing or empty id； Missing closedLoop boolean (must be explicitly true or false; never default to true or guess from partial conditions)； Missing status string； Missing or empty requiredEnvironments (must be a non-empty array of environment enums)； Missing or empty acceptanceSteps (must contain at least one step string)； Missing or empty evidenceRequirements (must contain at least one requirement string) |
| `packages/agentarts/src/prompts.ts` | （未显式声明标题） | `id`, `title`, `closedLoop`, `status`, `requiredEnvironments`, `acceptanceSteps`, `evidenceRequirements` | `id`: missing_id<br/>`title`: missing_title<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | Missing or empty id； Missing or empty title； Missing closedLoop boolean (must be explicitly true or false; never default to true or guess from partial conditions)； Missing status string； Missing or empty requiredEnvironments (must be a non-empty array of environment enums)； Missing or empty acceptanceSteps (must contain at least one step string)； Missing or empty evidenceRequirements (must contain at least one requirement string) |
| `packages/cognition/src/knowledge-reevaluation.ts` | （未显式声明标题） | `id`, `title`, `closedLoop`, `status`, `requiredEnvironments`, `acceptanceSteps`, `evidenceRequirements` | `id`: missing_id<br/>`title`: missing_title<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | Missing or empty id； Missing or empty title； Missing closedLoop boolean (must be explicitly true or false; never default to true or guess from partial conditions)； Missing status string； Missing or empty requiredEnvironments (must be a non-empty array of environment enums)； Missing or empty acceptanceSteps (must contain at least one step string)； Missing or empty evidenceRequirements (must contain at least one requirement string) |
| `tests/manual/agentarts/MVP-ACCEPTANCE.md` | Competition MVP: one acceptance path | `id`, `closedLoop`, `status`, `requiredEnvironments`, `acceptanceSteps`, `evidenceRequirements` | `id`: missing_id<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | Missing or empty id； Missing closedLoop boolean (must be explicitly true or false; never default to true or guess from partial conditions)； Missing status string； Missing or empty requiredEnvironments (must be a non-empty array of environment enums)； Missing or empty acceptanceSteps (must contain at least one step string)； Missing or empty evidenceRequirements (must contain at least one requirement string) |

## 6. 跳过的历史验收文件清单 (共 734 篇)

历史中存在若干名称包含 `ACCEPTANCE` 但仅为执行回执/证据/矩阵、不构成待验收规划的文件，已做区分并安全跳过（未标为已验收）：

| 文件路径 | 识别结果 / 跳过理由 |
| --- | --- |
| `.github/pull_request_template.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `AGENTS.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `CONTRIBUTING.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `README.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/agentarts-runtime/README.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/README.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/CHANGE_WATCH_PERSISTED_CURSOR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/CHANGE_WATCH_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/COMMAND_CENTER_PREVIEW_20261022.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/COMPUTER_VISION_LIFECYCLE_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/CONNECTOR_LIFECYCLE_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/CONTROL_BOUNDARY_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/CONVERSATION_DELIVERY_20261021.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/DESKTOP_PERFORMANCE_20261023.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/FRONTEND_LAYOUT_20261017.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/HARNESS_DESKTOP_COMPOSITION_20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/HISTORY_RESOURCE_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/INTERACTION_POLISH_20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/MAIL_BASELINE_STATUS_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/MEMORY_RENDERING_20261024.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/NOTIFICATION_BOUNDARY_AUDIT_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/NOTIFICATION_CLICK_EVIDENCE_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/PANEL_LIQUID_GLASS_20261021.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/PR376_REGRESSION_FIXES_20261017.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/PR404_QUIT_FOLLOWUP_20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/PR434_FOLLOWUP_20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/PR438_CI_20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/SNAPSHOT_RESOURCE_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/SOLID_GLASS_SETTINGS_20261027.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/VOICE_UI_REPAIR_20261026.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/WORKSPACE-PATCH-RECOVERY-20261015.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/WORKSPACE-PATCH-RECOVERY-IPC-WIP-20261015.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/agentarts-settings.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/calendar-meeting-integration.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/cloud-knowledge-memory-handoff.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/competition-text-deadline-20260927.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/computer-control-lease-20261018.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/developer-settings-20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/developer-tools-wiring-20261018.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/feeds-settings.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/goal-cloud-consumption.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/goal-cloud-tools.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/harness-events-authorization-20261020.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/issue-474-time-context-20261021.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/knowledge-watch-integration.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/laya-settings-startup-20261021.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/live-history-recovery-20260930.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/live-proactive-20260927.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/mail-analysis.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| `apps/desktop/docs/mail-triage-host.md` | `historical_acceptance_evidence_or_receipt_not_a_plan` |
| ...等共 734 篇 | 更多历史回执已保留 |
