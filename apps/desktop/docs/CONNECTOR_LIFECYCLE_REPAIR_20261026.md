# 邮件云复核配置生命周期修复（2026-10-26）

目标 profile：`huawei_ict_agentarts`。本包为 Desktop 私有宿主修复，涉及 MOD-13 对邮件复核能力的消费接线；不改变业务连接器负责人、公共工具 Schema、Runtime 任务协议或数据库迁移。

实际工作树：`<source-worktree>/.worktrees/large-runtime-20261026`，分支 `codex/large-runtime-repair-20261026`。在主代理委派的文件范围内修改 `electron/mail-review-host.js`，新增 `test/xhigh-connectors-mail-review.test.mjs` 和本文。A10 邮件监测准备、跨对话 watch 停止及已冻结 Runtime 增量保持原样。本包未提交、推送或创建 PR，状态为待主集成审查。

## 已复现的问题

原 `configure()` 在等待确认时只检查来源配置和所选重试项，没有将确认绑定到当前配置操作。后发配置、显式撤销与正常关闭因此可能被旧确认覆盖。另一个确定的微任务窗口在确认成功后的 `await api.revoke()`：此时发生关闭或撤销，旧调用继续执行 `closed=false` 并写回启用状态。

最终新增测试在修改前源码上复现 4/4 失败：

- 撤销后，原确认的 `isCurrent()` 仍为 true，迟到的已接受布尔结果可重新启用。
- 后发选择已生效，旧确认仍能覆盖新的选择和配置 generation。
- 正常 async 确认返回后、最终配置提交前关闭宿主，旧调用把宿主重新打开。
- 同一窗口显式撤销，旧调用把持久策略重新启用。

后两条只使用普通 Promise 微任务顺序，不依赖确认端口忽略 AbortSignal。回归保留原代码失败日志，未通过真实邮箱或云发送来制造故障。

## 最小修复和接线

每次配置操作有独立 AbortController；新配置、撤销或关闭使旧操作失效。确认前、确认返回后以及停止旧执行的异步返回点均校验原操作身份、取消信号、期限、来源配置和所选重试依据。确认选项的缓存读取使用该操作信号，只有确认仍有效时才建立新的执行 controller 和配置 generation；关闭状态不会由配置调用清除。

已有 Main 接线已将 `signal` 和 `isCurrent` 原样交给 `confirmApplicationAuthorization('mail.review.configure', ...)`，无需新增装配。原 `submitHostToolTask`、Policy、ToolGateway、原任务终态、缓存复核记录、通知轮次和未知结果处理不变。未新增任务库、自动重试、后台计时器或 Local fallback。

新增测试的成功分支还验证后发选择进入唯一的原 Runtime host-tool 任务，保留精确参数并停在 `waiting_approval`；过期旧选择不产生任务，未批准时没有模型调用。

## 验证与证据

环境为 Windows、PowerShell 7.6.6、固定 Node 24.15.0；沿用已准备的依赖和 dist，未构建或启动 Electron。

- `node --test --test-concurrency=1 apps/desktop/test/xhigh-connectors-mail-review.test.mjs apps/desktop/test/mail-review-host.test.mjs`：12 pass，0 fail，0 skip。
- `node --test --test-concurrency=1 apps/desktop/test/mail-review-integration.test.mjs`：2 pass，0 fail，0 skip。使用原 Runtime、完整授权提问宿主和 SQLite，模型/邮箱为显式合成端口；精确结果应用成功，额外字段结果被拒绝。
- 最终新增测试原样放入隔离复现目录，导入本包修改前的宿主源码：4 fail，exit 1，与原始故障一致。
- 修改的宿主与新增测试 `node --check` 通过；本包差异检查通过。

独立证据目录为本工作树 `.cache/xhigh-connectors-20261026/`：`before-manifest.json` 保存接手时 6 个 owned 宿主的 SHA256；`before-final-tests.log`、`after-tests.log`、`integration-tests.log` 保存原失败和实际通过；`manifest.json` 绑定最终源码与日志，`connector-lifecycle.patch` 仅包含本包三文件增量。A10 的 83/83、6/6 渲染及整仓结果未在本包重跑，不据历史结果声称本包通过全仓检查。

## 限制

没有真实邮箱读取、真实账号操作、通知、模型请求或云上传；没有 Electron、实际 UI、平台部署、设备或全仓验收。取消已受理与外部执行真正停止仍沿原语义区分。

本包没有修改持久 `submitting` 条目缺少 `taskId` 时的既有保守阻塞行为。该崩溃窗口可能位于原任务已受理但宿主尚未保存身份之间；目前没有在本包证明可安全继续或重派，不能把它改为空闲、失败、删除记录或自动重试。恢复如需后续工作，必须先精确读回原命令、任务、执行和 unknown 依据。
