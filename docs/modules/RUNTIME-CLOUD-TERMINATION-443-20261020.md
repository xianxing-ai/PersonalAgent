# #443：已确认本地回执后的云续接终态恢复

日期：2026-10-20。Profile：`huawei_ict_agentarts`。模块：MOD-03 / Competition Runtime。交付分支：`codex/runtime-reconcile-443`；基线：`9eb2fb08505af94eb7bdee0c041973bf22422822`。

## 问题与实际边界

[实机报告 #443](https://github.com/zemeng5208/PersonalAgent/issues/443) 描述 Windows 上研究子任务的 `research.search` 已有本地 confirmed 回执，但 WSS 续接返回 `wss_terminal_error` 后，子任务及原派发父任务一直停在 `waiting_reconciliation`。报告是历史现场证据，本工作包没有连接云端复跑、读取用户数据库或重放现场工具。

代码原因是 `RuntimeApplication.executeCoordination()` 在抛出错误前先调用 `holdCompetitionExport()`；随后 `coordination.exchange()` 才保存严格绑定的终态错误 marker。`TaskRuntime.runTask()` 保留等待状态，而旧失败消费条件只接受 `failed`。父任务还有两个可达性缺口：子任务未终止时只记录 `subagent-parent-wait`，不一定存在 export-withheld；原已确认派发缓存仍保留当时的 pending 子任务汇总。

## 修复及原调用方

- 新发生的错误仅在 `AgentArtsTerminalError.receipt` 与原 inflight、received 完全一致时走原 Runtime 失败持久化路径。原本地工具、缓存及 Evidence 保留；未知传输和未知操作仍等待核实。
- 历史 held continuation 必须具备 `1.0` 终态 marker、匹配的 session/request/idempotency/digest/server instance、原 task/configuration/deadline、dispatch context 的 loop 摘要、原 run/tool/input 及全部 confirmed 缓存。缺失或错配拒绝结束；不迁移数据库，不推定云业务成功。
- `TaskRuntime.finishReceivedCloudFailure()` 在同一事务重新核对绑定，记录原错误与失败回执，然后只转为 `failed` 或已请求取消的 `cancelled`。它不提供执行、续接、授权或重试能力。
- 原 `RuntimeApplication.reconcileConfirmedSubagentTermination(taskId)` 同时消费上述历史子任务与原父任务的 confirmed dispatch wait。先核实全部子任务，再分别持久化有确证的子任务失败；父任务从原持久 children 重新投影当前终态，并在取消或到期条件下结束。原派发缓存不重写。如果父投影失败，已独立成立的子任务失败保留，父任务继续等待，后续仍可再次核实。
- 原桌面 `apps/desktop/electron/reconcile-task-action.js` 已调用该入口并从 `task.get`/refresh 读回；本包直接修复它消费的 Runtime 路径，没有新增 UI 按钮或公共 wire operation。主对话交互、产品子智能体执行的分工保持不变。

## 工程验证

负责人/执行者：zemeng5208 工作包 / Codex 受委派 Runtime 修复子智能体。由本工作包完成原调用方消费路径、定向测试、自审及本证据；协作者的真实账号验收不代签。

环境：Windows、Node `24.15.0`、npm `11.12.0`、TypeScript `5.9.3`；安装使用锁定的 Runtime 工作区依赖与 `--ignore-scripts`，没有 Electron/native 安装脚本、锁文件或依赖版本改动。

1. 在忽略目录内复制 Runtime 源码，并用 Git 读回基线原文件，独立编译未修改基线。同一组三个新回归实际失败：新 WSS confirmed-read 续接仍等待；旧父任务取消、到期两例均被原核实谓词拒绝。
2. 串行编译 Runtime 的 24 个依赖 workspace 与 Runtime；修复版编译通过。
3. 首轮修复版 `subagent-termination-reconciliation.test.mjs` 与 `agentarts-websocket-application.test.mjs`：58/58 通过。覆盖新终态失败、历史父子取消/到期、原缓存不变、直接子任务核实、SQLite 重开、混合 unknown 兄弟任务、身份/run/context/parent-wait 错配、投影失败后的再次核实及原有活动/未知/并发门禁。
4. 最终源码重新编译后，以下 8 份文件以 `node --test --test-concurrency=1` 串行运行：上述两份，加 `runtime.test.mjs`、`subagent-parent-resume.test.mjs`、`subagent-task-binding.test.mjs`、`default-coordination-subagents.test.mjs`、`agentarts-status-application.test.mjs` 及原 Desktop `reconcile-task-action.test.mjs`；110/110 通过，wall 53.723 秒。`node --test tests/architecture/*.test.mjs`：3/3 通过，wall 2.610 秒。最终没有追加生产源码修改。

本地日志位于工作树忽略目录 `.cache/runtime-443-validation.log`、`.cache/runtime-443-tests.log`、`.cache/runtime-443-final-tests.log` 与 `.cache/runtime-443-architecture.log`。这些均为 Synthetic WSS、显式 Fake 工具和实际 Runtime/SQLite 工程回归，不是 AgentArts 平台或真实研究工具的新验收。

最终定向回归日志 UTC 结束时间为 `2026-10-20T12:16:26Z`，SHA-256 为 `0efd27e2b722a2a2550aeb39e069d1974af36555b92cc01e56b195e7f046a1d9`；架构日志 UTC 结束时间为 `2026-10-20T12:16:29Z`，SHA-256 为 `30355de723bcb084a9db257048e00a10a10ed601417f7cff02177677637ca1f9`。两条命令退出码均为 0。

## 限制及恢复条件

- 华为评测集、评估任务、镜像部署、真实账号/云 API/trace、实体桌面操作及实机旧数据库：`not_run`。本包为本地生命周期与持久化修复，未获真实云/账号调用委派；必要工程验证无需先调用平台。平台效果与现场复测仍须对准实际部署版本独立登记。
- 未新增公共 Schema、迁移、工具权限、Local Profile、静默回退或第二套任务/执行库。接口继续 `provisional`。
- 缺少原终态 marker 或精确 dispatch context、仍 active/unknown、未确认写入或不匹配的子任务仍拒绝结束；不把清除 inflight 当作核实。
- 本包不恢复已失败的云业务，也不强置 `succeeded`。核实后的错误历史、终态 marker、原工具记录及缓存继续保留。
- 仓库全量 `npm run check`、非作者批准、合并与发布分别以本 PR 当前 CI/评审及实际集成状态为准；本地定向通过不代表整体 harness 或完整产品验收完成。

状态：`review`，等待 PR 技术检查、非作者审查与实际集成。
