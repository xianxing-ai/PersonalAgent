# MOD-15 唤醒期限与启动取消修复

目标 profile：`huawei_ict_agentarts`。范围为 MOD-15/Wake 与 Desktop 生命周期消费，基线
`ad1a045e`；PR #512 仅作兼容参考，本增量没有移植其文字任务播报改动。

`start()` 等待原启动控制器释放时，`stop()`、`suspend()` 或 `dispose()` 可使请求
失效。此前等待完成后仍执行 `prepare()`；生产组合中的 prepare 会停止 Wake 并
调用 `openPanel(true)`，因此已取消启动仍可能打开面板。现在在准备之前校验原请求
revision 和 disposed；准备之后的既有失效、配置及授权校验继续保留。

复现使用实际 `createDesktopVoiceStartupHost` 与明确的 Fake Live/output/prepare，
依次发起 start 后立即 stop、suspend、dispose，观察 prepare、greet 和 live-start。
修复前新增三项均失败（prepare 被调用）；修复后三项均通过。没有新增公共接口、
依赖、权限或录音路径。

Wake 控制器另一项修复覆盖宿主挂起越过期限、到期定时回调尚未执行时的观察者注册：
此前 `subscribeLifecycle()` 的初始回执可能仍为过期 listening。现在先核对墙钟期限并
调用既有 expire，再发布初始状态；原订阅释放一次，已有观察者收到 disabled，新
观察者立即得到 disabled，迟到 wake 回调不产生新唤醒。Fake 时钟回归验证此行为；
当前 Desktop 在创建控制器后立即订阅，不能将这项 API 修复称为真实设备恢复已验收。

组合源码提交为 `981f148b0b982c49e43ae7df5954ffd26b262089`，normal merge 的两个
父提交分别为 Desktop `e0ac50789cd84127a1a14aec61aed7eb425a530e` 和 Wake core
`85b8e8b54aa4dab703f1a242dd7cf05e442b2a7c`。后续仅证据文档提交不改变此源码。

2026-10-25 Linux、固定 Node 24.15.0 / npm 11.12.1 本地验证：

- 构建 contracts、client、voice-wake、voice：退出码 0；Windows speech 原生编译按
  平台明确 skipped，不是 Windows 设备验证。
- `node --test apps/desktop/test/{voice-startup-host,wake-voice-host,wake-voice-host-integration,voice-input-core,sis-config-wake-lifecycle,wake-feedback-ownership}.test.mjs`：
  73/73 通过，0 skipped，含新取消测试及现有重复唤醒、晚就绪、晚 ASR、释放失败、
  配置撤销与反馈归属用例。
- Desktop 工作区 typecheck、架构检查 3/3、`git diff --check`：退出码 0。

独立验收者在固定组合源码 SHA 上于 `2026-10-25T05:43:41Z` 至
`2026-10-25T05:43:47Z` 执行组合复核（Node 24.15.0）：voice-wake build/typecheck、
Desktop typecheck、`node --check apps/desktop/electron/voice-startup-host.js` 和
`git diff --check` 均退出 0；受影响组合测试 109/109，fail/cancel/skip 均 0。
Node 测试汇总耗时 `1326.995975ms`；整体命令未单独计时，不把该值用作完整检查耗时。
组合测试覆盖两处回归、Wake binding、启动、权限、host、实际 host 的 Fake 集成和
SIS 配置。原日志 `/tmp/wake-acceptance-combined.log` 的 SHA-256 为
`dda594a92c3766d138aefbf8f12d4f322886cd9e4d03cbdc9c91b8fae8963b93`。

复现组合测试前使用上述固定 Node 工具链、独立依赖，依次构建
contracts/windows-client/client/voice-wake/voice；随后在仓库根目录运行：

```sh
node --test packages/voice-wake/test/*.test.mjs \
  packages/voice/test/wake-binding.test.mjs packages/voice/test/startup.test.mjs \
  apps/desktop/test/voice-startup-host.test.mjs \
  apps/desktop/test/microphone-permission.test.mjs \
  apps/desktop/test/wake-voice-host.test.mjs \
  apps/desktop/test/wake-voice-host-integration.test.mjs \
  apps/desktop/test/sis-config-wake-lifecycle.test.mjs
```

另对组合源码与 PR #512 固定 head `c8172cb43b84cd6cb3042f66efdb6b8375e75989`
执行 `git merge-tree --write-tree`：退出 0，tree
`a132836fd763cd0a94b3d80a5e77426a078bf54f`。这只证明 Git 无冲突，并非合并后行为验收；
本分支未合入 PR #512。

这是生产 host 的受控消费测试，不是实际 Electron/Chromium 窗口、中文唤醒、云端
SIS/Live、实体麦克风、扬声器或回声验收；未调用真实模型、云服务或开启设备。
MOD-14/15 保持原 provisional/实体设备待验边界。

另行评估项：当前 powerMonitor suspend 接线直接消费启动语音宿主的 suspend；
Wake/手动听写的系统挂起策略及设备释放需要单独核验，不能直接用聚合 stop 替换，
以免丢失启动监听的 resumeAllowed。本增量未改变这项策略，也未宣称完成其设备验证。
