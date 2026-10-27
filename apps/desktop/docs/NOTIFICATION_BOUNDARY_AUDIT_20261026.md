# 通知回执边界修复（2026-10-26）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/large-runtime-20261026`，分支：`codex/large-runtime-repair-20261026`，基线 HEAD `b2fb20dd094743c411656b7e7703c8aae7571a8e`。本包只修改 Desktop 系统通知端口、增加聚焦合成回归，并记录证据。没有公共接口、数据库迁移或新增依赖。Main 和 `notification-application-host.js` 只读核对，均不属于本包改动。

## 缺陷与修复

`desktop-notification-port.js` 原有持久意图、`show` 回执、用户点击和 `reconcile` 四种状态，但回调缺少终态与实例生命周期检查。聚焦测试在基线源码上 5/5 失败：失败后迟到点击可改成 delivered，可信失败核实后迟到 show 可覆盖失败，已释放实例的回调可覆盖重开后的存储，点击先于 show 可冒充投递回执，释放期间完成 `isSupported()` 仍可调用系统发送。原失败输出保留在 `.cache/xhigh-notification-audit-20261026/before-tests.log`。

- `dispose()` 后阻止新发送、状态写入和旧回调；在异步系统支持检查结束后再次检查实例状态，避免释放后开始 OS 发送。如果 `show()` 已被调用，意图仍保持原有 unknown 语义，不能据此重发。
- `show`、`failed`、`click` 回调在落盘前检查当前记录和终态，避免迟到回调将已失败或已核实的通知改写。`click` 先于 `show` 时只保存点击时间；只有真实 `show` 回执到达后才记录 delivered、已读和 `show` evidenceRef。
- 原有同 ID 幂等、意图先落盘、unknown 不重发和受信宿主 `reconcile` 入口继续使用。可选 `clickedAt` 写入既有本地 JSON 记录，没有 Schema 版本或外部协议变化。

现有 `notification-application-host.js` 在原轮次 `beginDelivery` 后调用端口，再读 `readDeliveryOutcome()`；unknown 只收敛为 unknown，只有 delivered/failed 回执推进轮次。Main 非合成路径注入该端口及 `onOutcome`。本包没有新增授权、通知源、后台重试或核实能力；`reconcile(id, delivered)` 的布尔值仍须由受信宿主以真实独立依据给出，不能从点击或调用过 `show()` 推断。

## 验证与界限

- 基线端口 + 五个新增回归：5 项失败，见 `before-tests.log`。修复后执行 `D:/PersonalAgent/.cache/toolchains/node-v24.15.0-win-x64/node.exe --test apps/desktop/test/xhigh-notification-boundary.test.mjs apps/desktop/test/desktop-notification-port.test.mjs apps/desktop/test/notification-application-host.test.mjs`，22/22 通过；日志、源码和补丁哈希见 `.cache/xhigh-notification-audit-20261026/delivery/manifest.json`。
- 测试注入的 notifier 是显式 Fake，仅模拟支持检查及 `show`、`click`、`failed` 回调顺序；应用宿主测试也使用本地 Runtime/Fake。没有观察真实 Electron Notification、Windows 通知中心、用户点击或重启后的 OS 投递读回；因此只确认代码边界，不称为真实 OS 通知验收。
- 未运行构建、桌面 GUI、真实模型/账号、云端或全量 `npm run check`。单纯读取旧记录与 `reconcile` 仍保留既有约束；历史 unknown 通知没有在本包中重发或强行结算。
