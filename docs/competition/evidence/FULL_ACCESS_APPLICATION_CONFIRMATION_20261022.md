# 完全访问的应用层确认来源

本工作包服务当前 Competition Profile，基于独立工作树 `psec-real-completion` 的 `309e5ebe`。
仅修改 Desktop presence/Notepad host、原 Windows Host adapter 的观察准备接口及直接测试。
Main、WindowsControlHost、Runtime Question/Policy 与授权 UI 的接线由主控及对应负责人完成。

## 行为与接口

- 两个 Desktop host 接收可信的 `isFullAccess(): boolean` 和 `readPolicyBinding(): string`。
  后者必须包含当前 selected sandbox revision/mode，不能来自工具参数；缺少绑定时完全访问拒绝。
- presence 保留 `readTaskBinding(taskId)` 的原 conversation 绑定。`requestPresence` 返回
  `{taskId, expiresAt, source}`，来源为 `native-gesture` 或 `full-access-policy`。
  完全访问直接发放原任务的短期 policy lease，不注册或调用 F9，不伪造物理用户事件。
  `desktop.request_presence` 输出 `present` 或 `policy_allowed`，`authorizationGranted` 均为 `false`。
  投影版本为 `task-presence-source-v2`，校验当前 receipt 来源、期限与输出精确一致。
- `isUserPresent` 每次核对任务、conversation、取消、单调时间及 policy revision/mode。
  完全访问回执另需当前仍为 full-access；旧 native 回执不会被转换为 policy 来源。
  可信配置/任务变更通知应调用新增 `presence.refresh()`，即时撤销回执并拒绝旧等待；
  新的 full-access request 本身也清理已经失效的 F9 等待。
- Notepad 完全访问先沿原 adapter hello/bind 建立旧窗口基线，再调用 `openNotepad`。
  新窗口启动回调可接收 `{taskId, deadline, signal}`；不改变 OS 权限或自动选择旧前台窗口。
  `prepareObservation` 可返回 `{waitForFreshTarget:true}`。adapter 仅在原 session 内、原期限内
  对原生 `NOT_FOUND` 继续元数据观察，不 reopen/rebind。50ms 仅为轮询间隔，成功必须来自实际
  `observed` 回执；歧义、旧/stale、未受信目标或任何其他拒绝立即停止。
- 完全访问在 `finalizeHostToolTask` 之前调用原 `checkObservationReady` 并重验策略和目标。
  后续只由原 Runtime `requestToolAuthorization`/Question 链处理精确授权，Notepad 不手工
  `respond`，不另签回执。受限模式保持原 F9 和 pending approval/respond 流程。
  `notepad.refresh()` 在策略/期限失效后取消原准备或原任务。
- 观察与 readiness 不读取正文；原生基线、foreground、身份和单标签检查保持不变。
  原 execute 参数继续固定 `expectedText:''`，写入前由原 native CAS 硬校验空白内容；
  不能把元数据观察成功称为已经验证空白，也不能在审批前读取正文。

无 Core wire、数据库迁移或第二套授权系统。工具版本保持 `1.0.0`，仅此 provisional
Desktop 工具的输出枚举兼容增加 `policy_allowed`；调用方必须按实际来源显示，不声称收到 F9。

## 本次验证

使用仓库 pinned Node 24.15.0，在此工作树执行 Runtime 单 workspace TypeScript 构建成功。
以下直接测试共 **69 passed / 0 failed / 0 skipped**：

```text
node --test --test-concurrency=1 apps/desktop/test/tool-presence-host.test.mjs apps/desktop/test/notepad-host.test.mjs apps/runtime/test/windows-host-adapter.test.mjs
```

覆盖 policy 来源且零 F9 注册、来源伪装拒绝、原任务/策略变化/取消/期限/关闭撤销、
旧 F9 等待被可信刷新取消、同一原 session 多次 NOT_FOUND 后观察成功、歧义/stale/未受信
立即拒绝、只消费一个原 Runtime grant、完全访问手工 respond 为 0，以及原受限 F9 与
未知结果仅核实不重放的既有回归。host JS 语法检查及 `git diff --check` 通过。

这里的 Windows Host 传输与授权回调是明确的 Fake；SQLite 和原 Runtime/Policy 路径实际运行。
没有启动记事本、Electron、模型、账号服务，没有读取私人配置/数据库。Main/WindowsControlHost
集成、真实桌面新窗口启动与原生执行验收尚未运行，本记录不宣称其通过。
