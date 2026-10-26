# 2026-10-26 云端本地交接整合证据

Profile：`huawei_ict_agentarts`。这是送审前已保存回执的公开摘要；提交、Draft PR 与官方 Windows/Linux CI 的实际状态以对应 Git/PR 回执为准。本次交付不代表合并、部署或全部模块验收。[脱敏运行数据](CLOUD_HANDOFF_INTEGRATION_20261026.json)保存完整源快照 SHA、UTC、wall、exit code 和已核验的本轮日志 SHA；原始日志与私有缓存原样保留，不在此发布。

## 来源与实际基线

原 ZIP 为 5,130,842 bytes，SHA256 `b794f0a9fcdf411394ae386030b36d7ab82840e9241b12378817aa9e96eac922`；288 项 source、119 份 base 原文、32 项材料均按登记长度/哈希核验，base 另核 Git blob ID。来源声明的 `b2fb20dd094743c411656b7e7703c8aae7571a8e` 未能在本地 Git 或正常远端 commit 读取中核实，不能声称完整复原其树或 ancestry。

本次以实际 main `934b7c4403a3e2ceeea564ff342a193ff22ab506` 独立三方整合，分支 `codex/local-handoff-integration-20261026`。补本文前的 a2 清单为 282 个变更路径（115 修改、167 新增），逐项 bytes/SHA 与工作树一致；原包中已在 main 的路径保留。测试时最终 2,696 输入快照为 `f57f412dd2482bd9725fc40791449f47de5fb7bedcdef3b17cb12232f6a4efeb`，是未提交输入指纹，不是 Git commit，也不包含后来的两份公开证据文档及个人源路径脱敏。

整合保留当前 main 的事件读回/串行恢复、任务预算和压缩下限、stop/model picker 与安全错误语义，接入收到的 Desktop/Runtime/native/vision/mail 和会话 SQLite 增量。未补造未收到的历史 team/control/provider 基线。

## 已实际执行的 Linux 验证

环境为 Node 24.15.0、npm 11.12.1。一次根 `npm run build` exit 0；后续受影响 Runtime 局部 build 两次 exit 0。根 build 后的 11 个变化路径见 JSON，其中最后 Admin 导入/测试两路径未触发第二次根 build。构建的精确起止时间未记录，不能补造；Linux 未编译 Windows System.Speech，也未运行 Electron GUI。

| 运行 | 实际结果 | 当时输入 SHA256 | 边界 |
| --- | --- | --- | --- |
| focused-a1，94 文件 | 1008 total / 1000 pass / 6 fail / 2 skip，exit 1，82.941 s | `51bdd5af92f22860bd29f3b1a5a1d0aefbbdd8ff4289cce9cf9da5fb93d72bfb` | 原失败保留；不是全绿 |
| focused-repairs-a4，7 文件 | 40/40，exit 0，6.114 s | `ea3b334601af2d6fbe43e8832990e20e5b4ffc07fe183a1a4cf532117e913253` | native 固定安全原因在 task/执行 record 一致、getter 不执行、拒 grant，及授权/mail/进度/恢复回归 |
| admin-history-red-a1，1 文件 | 1 pass / 1 fail，exit 1，0.222 s | `2d01ecca7f4d0e1fdde5a3c2b702627ed0e1c30957fa2d11439e150689cafa91` | 实际 Admin factory 的拒绝分支复现缺少 `errorDisplayText` 导入 |
| admin-history-fixed-a2，1 文件 | 2/2，exit 0，0.240 s | `f57f412dd2482bd9725fc40791449f47de5fb7bedcdef3b17cb12232f6a4efeb` | 实际 mountAdmin → HistoryControls → page 拒绝；按钮释放/可重试、私有 canary 不回显；Linux FakeDOM 组件验证 |

以上运行各自 `changedInputs=[]`，不能累加重叠测试。a4 之后只改 `apps/desktop/src/features/admin/view.js` 与 `apps/desktop/test/approval-history-render.test.mjs`，a4 不反向覆盖这两个最终字节；没有在最终快照重跑完整 94 文件或历史 6194 项。

首轮尚余 create-only 工作区工具的两项 leaf 及一个 parent 失败：生产注册需要 win32，Linux 未注册该工具。原断言和失败保留，未伪造平台、弱化断言或新增 skip；尚无其 Windows 通过证据。

独立 SQLite 持久化探针 8 组通过；来源与候选复跑是同组，不计成 16 组。实际 Main 回调配 FakeScope/EventEmitter 的退出探针通过，不能替代真实 Main/Electron 生命周期。Renderer 静态闭包为 100 文件/86 JS/133 边，缺导入、解析及未定义名/导入导出诊断为 0；这不是一般 checkJs 全绿（另有 582 条诊断），也不是 Windows GUI 实跑。

## #522 官方 Windows 首失败与最小断言修复

[Draft PR #522](https://github.com/xianxing-ai/PersonalAgent/pull/522) 的首轮来源为 `23dfce1db73cede45b0740c9e368ebdee031f5d1`。[官方 Foundation run 40360700498 / attempt 1](https://github.com/xianxing-ai/PersonalAgent/actions/runs/40360700498) 的 [Windows job 121705218579](https://github.com/xianxing-ai/PersonalAgent/actions/runs/40360700498/job/121705218579) exit 1；完整原日志已保留并核验为 878,684 bytes、SHA256 `43ff80c4f5269b869ef4a032ae282568a16ec106c627c98d6b547463f46a6858`。原 0-byte capture 不是日志证据。Desktop 为 2194 pass / 1 fail / 9 skip；其后 Runtime 1316/1316 实际完成。根 `npm run check` 因 workspace test 失败终止，位于 `&&` 后的根 `test:integration` 未启动。

唯一 Desktop 失败为 `authorization-native-execution.integration.test.mjs` 原第 98 行：旧断言期望 `REVISION_CONFLICT`，实际 task 与 preparation error 均为 `UNSUPPORTED_CAPABILITY`；原 approval 已 denied / revision 2。该 runner 的继承 token 为非管理员，no-sandbox baseline exited 0；readOnly、workspaceWrite、cancel 均返回 `native-create-environment:-2146233052`。这只定位到 native create-environment 阶段的 DLL 加载类 HRESULT（`0x80131524` / `COR_E_DLLNOTFOUND`）；具体宿主原因、哪个 DLL 或 API 环节未建立，不据此改变普通账号或 Job 限制。

因果是候选 Runtime 已将固定、安全的原生准备拒绝同时保存在 task.error 与拒绝执行 record 中，Desktop 的两处错误码断言和说明仍沿用旧 main 的通用 stale 错误。此次仅同步测试与本证据，未改生产代码。共享断言保留 failed、原审批 denied/rev2/system stale、同一 question-invalidation record、deny、executionStarted=false、无 command audit/marker/替换文件/Policy grant/提问卡，并追加旧 revision 1 与当前 revision 2 的迟到 allow 均被拒绝。未知结果仍不能通过该 failed 断言进入 skip。

新增跨平台回归用**显式 Fake 不可用探针**驱动实际 Runtime/Policy/ToolGateway、Question 与 native host，证明拒绝发生在业务工具执行之前；同命令重放保留同一终态，授权和探针各一次，工具执行与 executor 创建均为零。Fake 回执不证明 Windows 隔离，业务零分派也不说明 PSEC 内部探针调用到了哪个 API。

| 本轮 Linux 运行（Node 24.15.0 / npm 11.12.1） | 实际结果 | 输入 SHA256 | 边界 |
| --- | --- | --- | --- |
| pr522-native-consumer-red-a1 | 1 fail，exit 1，1.460 s | `e4dce71833646672feec172f665b45d05ea41e60cf0e525805fabeb74a85ecf1` | 实际消费链复现同一旧错误码断言；原输入与日志保留 |
| pr522-native-consumer-fixed-a2，6 文件 | 31 total / 30 pass / 0 fail / 1 skip，exit 0，4.134 s | `0fac5fd205fb7d3f9ae789b1b3ac0f92309eabc06f0e039a066a4eeea9b014e9` | 含真实消费链的 Fake 拒绝、readiness、授权、mail、固定安全错误与 getter=0 回归；唯一 skip 是 Linux 缺显式 Windows helper 的原真实测试 |

两次运行均 `changedInputs=[]`，使用现有候选构建，无生产改动或新增根 build；最终测试字节 SHA256 `264c42e80453ec92c1d91f92aa57266abb7e1c1d5df928edeea0c143b1fcf8e2`。精确 UTC、命令、日志与复用 dist 指纹见 JSON；此后只补公开证据文档，不追溯覆盖新的文档字节。真实 Windows 正向分支、`unsupportedPsec` allowlist、guard、deadline 与 CI 配置未变，未新增 skip 分支。相同不可用宿主通过这些拒绝断言后可能抵达既有 optional skip，不能据此宣布 strict PSEC 正例通过；required 模式或不匹配的失败仍阻断。修复后的官方 Windows/Linux CI 结果仍待新回执。

## 来源历史缺口与当前待验项

六份旧回执/输入/exit code 自洽，但旧完整 `.log` 未交付；未独立核实其全部 log SHA 或把作者 Windows 结果称为云端复跑。A12 的 6194 total / 6165 pass / 29 skip 仅是作者历史记录。

A12 相对当前 main 的 65 项追溯差异中，25 项可匹配 main 历史，6 项缺正文，34 项历史字节仍未匹配。若要求精确复原旧 A12 树，仍需 40 份正文（6+34）或完整可读 b2 基线；这属于历史来源缺口，**不是当前候选缺少 build 源码**。当前候选根 build 已通过，不应为复原旧树覆盖当前 main。

两项 `native-reasoning-slider-smoke.cjs`、`pr376-regressions-smoke.cjs` 仍需实际 Windows 串行运行，各生成新 a2 回执且 exitCode 0 / changedInputs=[]，保留原 a1 失败。当前官方 CI 的 Desktop 测试仅覆盖 `test/*.test.mjs`，没有运行这两个确切 `.cjs`；`test:native-reasoning-smoke` 指向另一个 product smoke，不能填平该 GUI 缺口。只读复核确认 PR376 在基线 HEAD 已有陈旧断言：`setFixture({})` 后打开 workspace，断言 `.workspace-composer textarea` 数量为 0，但实际无条件 mount composer 并创建 textarea。若 Windows 抵达该步预计失败；这是静态判断，没有本轮 Windows 运行红例，也不是本轮新增生产回归，未据此改断言或实现。PR376 使用生成 Main stub，即使通过也不等同真实 Root Main 生命周期。

[ADR-0041](../../adr/0041-desktop-conversation-incremental-persistence.md)仍 **proposed**，会话接口仍 provisional，最终公共 SQLite Evidence 仍 pending。来源合成 Windows/Node 数据仅支持稳态逻辑写入延迟改善；首次迁移、重开、峰值 RSS 和磁盘占用均有回退，canonical Map 仍常驻，逻辑序列化量不等于物理 I/O。完整最新历史 v5→v4 导出未实现；删除 DB/marker 或恢复迁移前备份不能保留迁移后的历史。

真实 Windows GUI、打包/冷启动、真实资料迁移恢复、机器断电、实体设备、真实邮箱/模型/AgentArts 服务均未由本记录验收。原 #510 服务/预算拒绝路径未重试；本次提交、推送和 Draft PR 授权不扩展到合并或部署。

公开前仅将 10 份既有 Markdown 中的个人源工作树根前缀替换为 `<source-worktree>`，共 21 次；相对入口、历史结果和日志 SHA 保留。原 ZIP/a2 封存不变，历史测试快照不被这些文档改动追溯覆盖。
