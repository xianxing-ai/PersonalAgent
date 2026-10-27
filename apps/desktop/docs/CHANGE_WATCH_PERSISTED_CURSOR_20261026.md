# 持久邮件游标的监听首读基线（2026-10-26）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/large-runtime-20261026`，分支：`codex/large-runtime-repair-20261026`。本包延续 `CHANGE_WATCH_REPAIR_20261026.md` 的 v3 变化触发修复，只修改 Runtime 邮件批次宿主、Desktop 变化触发宿主和一项本地合成回归；没有公共 Schema、数据库迁移或新依赖。

## 故障

`MailTriageHost.startBatch()` 会从本地 pipeline 读取上次保存的分页 cursor 并交给 Runtime 首个 `mail.inbox` 页。真实 watch 可能因此先得到一张空的终结页，例如 `91:5` → `91:5`。v3 为防止任意调用者使用 cursor 假造已读水位，不允许非零 cursor 空页建立基线。结果是这个 watch 的下一轮首次得到 UID 6 时仍会将它当作首次基线，无法提名为新邮件。

修复前的端到端合成诊断使用实际 Runtime/SQLite/Policy/ToolGateway/MailService、watch 调度与 `FakeMailProvider`，通过正常 `MailTriageHost` 保存 `91:5` 后触发该故障。失败日志：`.cache/sol-next-wiring-audit-20261026/fixture-diagnostic-5.log`。这仅证明本地合成路径，不代表 QQ 邮箱或真实监听的线上验收。

## 修复边界

- Runtime `MailTriageHost` 只在本批次首个 `mail.inbox` 页、且本地 pipeline 确实返回持久 cursor 时，向该原 Runtime 任务写入一次私有 `mail-triage-persisted-cursor-v1` checkpoint。写入发生在可信的 `prepareAuthorization` 内、授权响应返回和提供者读取之前；由 Runtime 原 host-tool 读回验证任务归属，并匹配 session、batch generation、首个 command/task/run、账号、文件夹、limit、cursor、query digest、参数摘要和截止时间。写入后重核当前批次；旧值不相等则拒绝。邮件 metadata 域与 Runtime host 命名空间保持各自原有用途，不重新读邮箱，也不将 cursor 发给模型或 Renderer。
- Desktop 只在已确认、具有执行 Evidence 的原 watch 读页满足该私有 checkpoint、当前 watch 来源、邮件 lease、host-tool intent 与实际执行输入一致，且结果为空终结页并回显同一非零 cursor 时，把此 cursor 作为该 watch 的 UID 基线。没有私有 checkpoint 的 `mail.inbox` 直接调用或无授权宿主路径仍保守保持未初始化。错误 watch/lease/intent、迟到的旧 epoch 和回放不能借此建立当前基线。
- 既有 `mailEpochs` 指针仍按可信执行时序阻止旧 epoch 回退；同 epoch 乱序合并与空页不抬高任意调用者水位的 v3 规则保留。既有任务、Evidence、审批及通知回执不被改写。

## 验证与限制

- 第一版把邮件 metadata namespace 误等同 Runtime host namespace。将合成用例改成 Main 的双 namespace 后，该版首个 watch 页失败（1/1 红）；日志：`.cache/xhigh-change-watch-20261026/delivery-v4b/dual-namespace-before.log`。当前版改用 Runtime 原 host-tool 读回验证任务归属，再用相同用例转绿。
- 使用锁定的 Node 24.15.0 直接运行 Runtime 的 TypeScript 编译，成功。`npm run build --workspace=@personal-agent/runtime` 首次尝试因该工作树 npm 脚本内未找到 `tsc` 失败，随后同一工作树的 `node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json` 成功；失败日志及成功命令/退出码记录在 `.cache/xhigh-change-watch-20261026/delivery-v4b/`。
- 54 项聚焦合成测试通过，覆盖实际 `MailTriageHost` 持久 cursor → 首个空 watch 页 → 新 UID 提名，并使用不同的 metadata 与 Runtime host 命名空间模拟 Main 接线；同时覆盖缺失/错配私有 checkpoint、错误 watch/intent、旧 epoch、分页乱序、重开和现有通知回归。日志：`.cache/xhigh-change-watch-20261026/delivery-v4b/after-tests-final.log`。
- 未调用真实邮箱、真实 Laya/AgentArts、OS 通知、设备或 GUI；未运行全量 `npm run check`。公开 `mail.inbox` 仍允许任意合法 cursor，因此不把单个非零 cursor 空页视为普遍完成邮箱基线。`P1-MAIL-P5-PAGINATION` 仍为 provisional。
