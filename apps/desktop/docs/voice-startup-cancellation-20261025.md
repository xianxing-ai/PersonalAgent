# 启动语音取消后的窗口准备修复

目标 profile：`huawei_ict_agentarts`。范围为 MOD-15/Desktop 生命周期消费，基线
`ad1a045e`；PR #512 仅作兼容参考，本增量没有移植其文字任务播报改动。

`start()` 等待原启动控制器释放时，`stop()`、`suspend()` 或 `dispose()` 可使请求
失效。此前等待完成后仍执行 `prepare()`；生产组合中的 prepare 会停止 Wake 并
调用 `openPanel(true)`，因此已取消启动仍可能打开面板。现在在准备之前校验原请求
revision 和 disposed；准备之后的既有失效、配置及授权校验继续保留。

复现使用实际 `createDesktopVoiceStartupHost` 与明确的 Fake Live/output/prepare，
依次发起 start 后立即 stop、suspend、dispose，观察 prepare、greet 和 live-start。
修复前新增三项均失败（prepare 被调用）；修复后三项均通过。没有新增公共接口、
依赖、权限或录音路径。

2026-10-25 Linux、固定 Node 24.15.0 / npm 11.12.1 本地验证：

- 构建 contracts、client、voice-wake、voice：退出码 0；Windows speech 原生编译按
  平台明确 skipped，不是 Windows 设备验证。
- `node --test apps/desktop/test/{voice-startup-host,wake-voice-host,wake-voice-host-integration,voice-input-core,sis-config-wake-lifecycle,wake-feedback-ownership}.test.mjs`：
  73/73 通过，0 skipped，含新取消测试及现有重复唤醒、晚就绪、晚 ASR、释放失败、
  配置撤销与反馈归属用例。
- Desktop 工作区 typecheck、架构检查 3/3、`git diff --check`：退出码 0。

这是生产 host 的受控消费测试，不是实际 Electron/Chromium 窗口、中文唤醒、云端
SIS/Live、实体麦克风、扬声器或回声验收；未调用真实模型、云服务或开启设备。
MOD-14/15 保持原 provisional/实体设备待验边界。

另行评估项：当前 powerMonitor suspend 接线直接消费启动语音宿主的 suspend；
Wake/手动听写的系统挂起策略及设备释放需要单独核验，不能直接用聚合 stop 替换，
以免丢失启动监听的 resumeAllowed。本增量未改变这项策略，也未宣称完成其设备验证。
