# PR #503 与已合 #509 / #521 的最小整合

2026-10-26 UTC；Profile `huawei_ict_agentarts`。本轮在新独占 worktree
`.worktrees/pr503-main521-integration-20261026`、分支
`codex/pr503-main521-integration-20261026`，从 #503 实际远端 head
`6dd4b9794b8b5f927c31b656c2c19f02b3bc3971` 普通合并实际 main
`24fbd4115653ea578aa3b4aa581143fdd21077c4`。开始前复核 AGENTS、CONTRIBUTING、
CODEOWNERS、模块接口、原 #503 Evidence 与最新 PR 评论，旧 worktree 保留未改。
不提前纳入尚未合并的 #511，不推送、改 PR、重跑 CI 或批准，由 root 统一发布。

## 唯一冲突与兼容取舍

唯一文本冲突为 `apps/desktop/electron/runtime.js` 的新任务总预算：

- #503 的 `6722d700` 将 Competition 新任务从 180 秒提高到 1800 秒，覆盖云工作流和
  后续本地处理；普通 `task.get` 仍为 Client 默认 10 秒。
- #521 在旧 180 秒基线上为已配置摘要宿主的任务采用 **600 秒总预算**；其原说明并未将
  600 秒称为最低预算。其目的在于给确认、分段摘要和后续回答留出时间。
- 本次兼容整合选择保留 #503 更长的 1800 秒整轮上限，将 #521 的 600 秒作为条件最低预留：
  `contextCompaction ? Math.max(competitionTimeoutMs, 600_000) : competitionTimeoutMs`。
  当前两种 Competition 模式均为 1800 秒；Local/Fake 等其他 profile 不设置新超时。
  没有新 API、配置或第二套计时机制；不是直接采用任一侧完整文件。

保留 #521 的 Main 配置判定、摘要确认最多 180 秒、重复 prepare 只收紧决定期限，以及
每次摘要实际请求 `min(原任务剩余时间, 180 秒)`。原任务、该任务的 continuation/恢复及
其派生子任务沿原绝对 deadline，不在运行中延长；**独立重新授权的子对话新 turn** 可以
获得新期限，相关原有正例继续验证。Live 独立 120 秒路径未改。

其余源码正常自动合并：原事件轮询按既有 `task.get` 补读非终态并重新发布快照；
保留旧 revision 不覆盖新状态、Runtime 更换后拒绝旧异步结果，以及不重发业务操作。
#509 天气城市入口与读回 revision 保护保留。#503 mail orphan 的原幂等键/完整 intent 精确
核对、unknown 不重发、Laya 纯读 snapshot/身份核查 fixture，以及 AgentArts server 原
deadline/显式较短上限均未改；与 #503 parent 逐文件比对一致。

## 本树依赖与验证

固定 Node **24.15.0** / npm **11.12.1**；本树独立 `npm ci --ignore-scripts`，
独立缓存和 dist，未借其他 worktree 产物。先按实际 Runtime/Client/Testkit 依赖闭包构建
26 个 workspace，再补 Desktop Todo 依赖 productivity，共 27 个所需 workspace。
未执行全仓 `npm run check` 或全量桌面测试。

先用最终预算测试只替换导入为实际 main #521 的原 `runtime.js`，生成在忽略目录，
验证机械采用 main 会破坏 #503 的 1800 秒约定：6 项中 4 过 / 2 失败，实际分别为
180000 和 600000、预期 1800000。这是**版本兼容性 red**，不声称 #521 在原基线有缺陷。
原 main 文件 SHA256 `e7f346b1f6d6613808ac3f2d6605a6989480b226ee7388371ef264b612215f0a`。
修复的预算与单调授权小组 12/12 通过。真实 Client 配合 **FakeRuntime** 仅证明请求预算，
不冒称 SQLite 持久化或真实云任务验收。

最小组合命令（15 个文件）：

```sh
node --test --test-concurrency=1 \
  apps/desktop/test/desktop.test.mjs \
  apps/desktop/test/authorization-question-host.test.mjs \
  apps/desktop/test/authorization-runtime-integration.test.mjs \
  apps/desktop/test/harness-context-host.test.mjs \
  apps/desktop/test/conversation-main-actions.test.mjs \
  apps/desktop/test/panel-event-readback-order.test.mjs \
  apps/desktop/test/panel-task-progress.test.mjs \
  apps/desktop/test/panel-task-refresh-order.test.mjs \
  apps/desktop/test/workspace-weather-readback-order.test.mjs \
  apps/desktop/test/connector-empty-state.test.mjs \
  apps/desktop/test/mail-review-host.test.mjs \
  apps/desktop/test/laya-controls.test.mjs \
  apps/desktop/test/laya-local-host.test.mjs \
  apps/desktop/test/mail-review-integration.test.mjs \
  apps/agentarts-runtime/test/request-deadline-model.test.mjs
```

初次组合实际 104 项通过，授权集成文件因本树尚无 productivity dist 而加载失败；
原 `ERR_MODULE_NOT_FOUND` 日志保留。补构建该依赖后，原授权集成文件 6/6 通过，
未改源码或断言。该组使用实际本地 Runtime/Policy/SQLite 和合成数据，包含原摘要确认到期、
过期卡拒绝和零执行；邮件两项 SQLite 合成集成没有注入 orphan 崩溃窗口，不能将 P2
structuredClone fixture 提升为 SQLite 崩溃验收。

另用 `--test-name-pattern` 精确执行 `subagent-task-binding` 的原 approved-child resume
和 default-worker deadline 两例、`subagent-conversation` 独立新 turn 一例，以及
`coordination` 原 request deadline 一例，4/4 通过、0 skip；没有将未选 case 计入通过。
修改的 JavaScript 语法、冲突标记及 `git diff --check` 均通过。

## 日志、提交绑定与未验项

原日志和每条命令的完整 argv、UTC/wall/exit/logSHA 均保存在本树忽略目录
`.cache/pr503-main521-integration/`。下表为提交前实际结果：

| 日志 | UTC 起止 | wall / exit | SHA256 |
| --- | --- | --- | --- |
| `npm-ci.log` | 06:02:41–06:02:44 | 3.298s / 0 | `05fd21707ad6a17df8657ede399c7cd2b8187f0fbca99a457a017a25de395d54` |
| `dependency-build.log` | 06:03:51–06:04:58 | 67.081s / 0 | `ae37357917a016bca75dfd30e4ad4646c0bdf85ac754f2bf521896bf0c0223e2` |
| `compatibility-red.log` | 06:08:37–06:08:39 | 1.122s / 1 | `9a8d7e63d649013ba63491435d97ec47dbb7608a1f9c52c62a017299d8d991fd` |
| `combined.log`（含前置缺失） | 06:08:52–06:09:02 | 10.141s / 1 | `20310a9a45ac0196efb05006a1ea36e4c36c1366f7c5e6803500a071a6c8cde1` |
| `deadline-inheritance.log` | 06:08:53–06:08:56 | 3.315s / 0 | `5d276fe33a0eabb6d08721d3921e1a0062d0750346a689fa4a0cb604da04d353` |
| `productivity-build.log` | 06:09:39–06:09:41 | 2.439s / 0 | `185ef80395bec9128b6538fdc459de35d708e27d966ebde4472d81b3ec4960dc` |
| `authorization-green.log` | 06:10:28–06:10:30 | 1.973s / 0 | `b534915bde5ceb6946936cab28025c46dad25af79216d0e02892e4568fc6a9e1` |
| `syntax-diff.log` | 06:11:29–06:11:30 | 0.532s / 0 | `51ee6cc6e7442d14162dc4dbd9d929cd368208a06c65bf75d9c1ed3c788cd320` |

测试在普通 merge commit 之前执行，其后只新增本 Evidence；没有为 commit 再重复测试。
为避免本文件嵌入自身 commit SHA 的循环，最终普通双父 merge head、parents、tree、
干净状态及已测文件一致性绑定记录在 `final-head.json`，不把提交前测试冒称提交后重跑。
上述主要命令前后记录 HEAD 和完整 tracked 文件 SHA 清单；只排除本 Evidence 文件的
自引用，源码/测试/既有文档 fingerprint 固定为
`dd063898e5c1bcd37ba906799e0b8bbbaa0a6bc17e19958355dccc8893129d8c`。
没有以旧 head 的 CI 作为新整合 head 的 CI；新 head 正式必需 CI 仍由正常发布后另验。

新证据均为 Linux Synthetic/Fake/本地 SQLite/注入 HTTP 或时钟，不调用真实模型、账号、
云端部署或实体设备；未运行窗口渲染、真实 Windows、Live 音频、真实邮箱、新摘要云验收，
也未发布新镜像。历史真实回执保持原版本范围；接口仍 provisional，无 Schema、迁移、
锁文件或 CI 配置改动，未提升整模块完成等级。
