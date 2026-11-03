# Issue #443 云端续接失败后 competition-cloud-inflight 释放调查与回归证据

日期：2026-11-04  
工作分支：`zemeng/443-cloud-inflight-release`（基于 PR #543 head `codex/pr531-cloud-persistent`，含 PR #535、#531、#448）  
Profile：`huawei_ict_agentarts`  
模块：MOD-03 / Competition Runtime / Application Coordination

---

## 1. 调查结论与事实核对

### 1.1 缺陷背景与现场根因
[GitHub Issue #443](https://github.com/xianxing-ai/PersonalAgent/issues/443) 报告了较旧的 main `9eb2fb08`（Windows 真机）上的现象：
- 父任务通过 `subagent.dispatch` 派发研究子智能体；子任务在本地已确认保留 `research.search` 本地工具回执（`tool-result-competition-tool-<child>-1`）；
- 子任务在下一步进行云端续接时遭遇 `wss_terminal_error`（明确的 WebSocket 终态错误，非结果未知）；
- 旧版 `holdCompetitionExport(taskId)` 未接收 `error` 参数，遇到该错误时盲目保存 `competition-export-withheld: {withheld: true}` 并将子任务置为 `waiting_reconciliation`，未释放 `competition-cloud-inflight` 与 `competition-cloud-received`；
- 父任务同刻进入 `waiting_reconciliation`，挂起在 `subagent-parent-wait`；
- 用户在主界面点击父任务「核实并结束」时，因子任务残留 `competition-cloud-inflight` 且未终态化，触发 `Only an inactive confirmed withheld subagent receipt can be reconciled` 必拒；子任务本身缺乏独立对账入口；`resumeConfirmedTask` 也因子任务残留 inflight 触发 `RESULT_UNKNOWN` 拒绝，单条任务链永久锁死。

### 1.2 当前基线代码审查结论
经对当前基线（分支 `zemeng/443-cloud-inflight-release`，已包含 PR #448 / commit `e2e54f6bfd`）源码的逐行审计：
**该问题在当前基线中已被修复，无需且严禁硬改生产代码。**

依据如下：
1. **新执行链路终端失败处理**：
   - `RuntimeApplication.executeCoordination` 在捕获到 `error` 后调用 `this.holdCompetitionExport(taskId, error)`；
   - 在 `runtime-application.ts`（约 line 2511-2513）中：
     ```ts
     if (error instanceof AgentArtsTerminalError
       && isDeepStrictEqual(this.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'), error.receipt)
       && isDeepStrictEqual(this.runtime.loadCheckpoint(taskId, 'competition-cloud-received'), error.receipt)) return;
     ```
     `holdCompetitionExport` 识别出匹配的 WSS terminal 错误后直接返回，**不再盲目将子任务置为 `waiting_reconciliation`**；
   - `coordination.exchange()` 捕获 `AgentArtsTerminalError` 并保存终态标记 `competition-cloud-terminal-error: {version: '1.0', kind: 'wss_terminal_error', receipt: ...}`，随后抛出 `ProtocolError('EXTERNAL_FAILURE', ...)`；
   - `TaskRuntime.runTask` 捕获该错误并将子任务正常终态化为 `failed`；
   - 在 `TaskRuntime.runTask` 的 `finally` 块（`index.ts:2110-2112`）中：
     ```ts
     const binding = this.getTask(taskId).state === 'failed' ? this.readReceivedCloudFailureBinding(taskId) : undefined;
     if (binding !== undefined) this.transaction(() => this.consumeReceivedCloudFailure(taskId, binding));
     ```
     通过 `consumeReceivedCloudFailure` 将 `competition-cloud-inflight` 和 `competition-cloud-received` 严格释放为 `null`，并持久化 `competition-cloud-received-failure`（`classification: 'transport_terminal_error'`，`cloudResent: false`）；
   - 子任务进入 `failed` 终态后，`refreshSubagentParent` 识别到所有子任务均已到达终态（`confirmedSubagentWait` 成立），自动调用 `resumeTask` 恢复父任务执行，父任务携带子任务失败 summary 顺利推进，不再挂起死锁。
2. **历史存量快照对账与释放**：
   - 在已存在的历史快照中（子任务已因历史 bug 处于 `waiting_reconciliation` 且留存 inflight）：
   - `reconcileConfirmedSubagentTermination` 增加了对处于 `waiting_reconciliation` 的子任务失败绑定识别（`readReceivedCloudFailureBinding(child.taskId, true)`）与原子消费（`finishReceivedCloudFailure`）；
   - 用户无论是对父任务发起对账，还是直接对子任务发起对账，均能原子触发 `consumeReceivedCloudFailure`，清除历史残留的 `competition-cloud-inflight` 为 `null`，将子任务转为 `failed`（或 `cancelled`），解除死锁。
3. **未知状态严格保持锁定保护**：
   - 当遇到真正的未知错误（`AgentArtsResultUnknownError`，如断开连接未收到明确 terminal 帧）：
   - `markCompetitionCloudUnknown` 记录 `competition-cloud-unknown` 并将任务转为 `waiting_reconciliation`；
   - `competition-cloud-inflight` **保持存在**，严禁释放、严禁盲目重放、严禁当成成功；对账入口严格保持锁定拒绝（`RESULT_UNKNOWN`），符合最高安全规范。

---

## 2. 改动文件清单与目的

| 文件路径 | 目的 |
| --- | --- |
| `apps/runtime/test/issue443-cloud-inflight-release.test.mjs` | **新增**专用离线回归测试套件（6 个用例），精准复现并覆盖 issue #443 场景，验证 inflight 释放、父任务自动恢复、历史存量对账、未知结果锁定保护与 SQLite 持久化 |
| `docs/competition/evidence/ISSUE443_CLOUD_INFLIGHT_RELEASE_20261104.md` | **新增**本证据文件，记录调查结论、源码依据、测试通过记录与未做项说明 |

*注：遵守规范“若基线已修好：不要硬改生产代码，只补回归测试，并如实说明依据”，本次未对生产源码（`apps/runtime/src/`）做多余修改。*

---

## 3. 本地实际运行通过的检查

所有检查均在本地离线环境（Node.js `v24.15.0`，Linux）执行通过：

### 3.1 编译检查
```bash
npm run build --workspace=@personal-agent/runtime
```
- 输出：`> @personal-agent/runtime@0.1.0-alpha.1 build > tsc -p tsconfig.json`
- 结果：退出码 0，编译无任何错误。

### 3.2 架构门禁检查
```bash
npm run check:architecture
```
- 输出：
  - `✔ workspace dependencies obey the documented architecture boundaries`
  - `✔ the standard check gates root integration tests after workspace build and tests`
  - `✔ the integration runner serially discovers every root integration test without filtering failures`
- 结果：3/3 passed，退出码 0。

### 3.3 新增专项回归测试
```bash
node --test apps/runtime/test/issue443-cloud-inflight-release.test.mjs
```
- 输出用例清单：
  - `✔ issue #443 reproduction: subagent retaining local research receipt releases competition-cloud-inflight upon WSS terminal error without locking reconciliation`
  - `✔ issue #443 historical snapshot reconciliation: legacy waiting_reconciliation child with held inflight releases inflight during parent reconciliation`
  - `✔ issue #443 historical snapshot direct child reconciliation: subtask can be reconciled directly and releases inflight`
  - `✔ safety invariant: unknown cloud continuation result remains locked and does NOT release inflight`
  - `✔ issue #443 SQLite reopen persistence: confirmed tool records and released inflight persist across restart`
  - `✔ issue #443 parent recovery: parent task resumes normally after child terminal failure and completes without being locked`
- 结果：6/6 passed，持续时间约 1.6 秒，退出码 0。

### 3.4 关联全量测试套件
```bash
node --test apps/runtime/test/issue443-cloud-inflight-release.test.mjs \
  apps/runtime/test/subagent-termination-reconciliation.test.mjs \
  apps/runtime/test/subagent-parent-resume.test.mjs \
  apps/runtime/test/subagent-task-binding.test.mjs \
  apps/runtime/test/default-coordination-subagents.test.mjs \
  apps/runtime/test/agentarts-websocket-application.test.mjs \
  apps/runtime/test/agentarts-status-application.test.mjs \
  apps/runtime/test/startup-recovery.test.mjs \
  apps/runtime/test/startup-recovery-core.test.mjs \
  apps/runtime/test/coordination.test.mjs \
  apps/runtime/test/competition-tool-loop.test.mjs
```
- 结果：147/147 passed，0 failed，0 cancelled，0 skipped，0 todo，耗时约 4.7 秒，退出码 0。

---

## 4. 未做项说明

1. **面板「核实并结束」按钮渲染条件与中文提示**：
   - Issue #443 诉求 2 指出前端面板把任何 `waiting_reconciliation` 任务都渲染成对账按钮，与 reconcile 入口窄合同不匹配；
   - 依据 `AGENTS.md` 与分工规定，Renderer / 前端 UI（`apps/desktop/src`、`renderer.js`、`view.js`）归属协作者 `2511375597-lab`，本工作包受硬性限制严格不修改前端 Renderer 代码。
2. **真机 Windows + 真实华为 AgentArts WSS 复验**：
   - 本任务为离线本地工程调查与测试加固，未获得华为云真实账户/模型调用委派；
   - 严格遵守安全规则：不连真实云、不读取凭据，真机平台真实环境需由负责人在真机环境中独立复验登记。
