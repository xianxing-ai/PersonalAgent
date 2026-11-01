# Windows Host / PipeBridge 独立自包含发布与只读握手

目标 profile：`huawei_ict_agentarts`；工作树 `.worktrees/pr531-native-helper`，父提交 `782123ac`；状态 `review`，Main 接线及真实 Notepad 写后读回由集成负责人继续。未全局安装运行库，未改 Windows 用户权限、PSEC 或保护项。

## 方案、兼容与信任边界

- 原 Host 和 PipeBridge 为独立 FDD 产物，不能复用 Desktop 或 Job 的 component 身份。原正式 `build-windows-host --publish-native-desktop` 入口增加独立 `resources/native-tools/windows-host/{host,bridge}`，固定 .NET / WindowsDesktop 8.0.30、win-x64；SDK 仅使用已安装的 .NET 8。
- 新发布目录必须不存在，完整 manifest 包含两个组件的运行库、程序集、配置、原 `windows-host.json`、许可与源文件摘要。发布前后源摘要一致才接受，不覆盖旧包；完整清单和固定许可原文与已有 Desktop 发布模式一致。
- `readWindowsHostComponent(resourcesPath)` 返回精确 `hostPath`、`bridgePath`、`manifestSha256`、同步 `assertCurrentBundle({hostPath,bridgePath})→true`。捕获后即使对方重算新清单，也不能替换原捕获身份。附加/缺失/替换文件、路径错配和清单变化均拒绝。
- 原 `createWindowsHostBridgeTransport` 新增这个受信完整性复核回调，在每次连接和发帧前执行。它不签发或替代 Policy，原 Windows pipe PID/session、普通用户、nonce、原任务和原参数检查保持。SC 产物缺少该回调拒绝启动。
- 子进程只继承 Windows 路径、临时目录及固定 .NET 基础设置，不继承 `DOTNET_ROOT`、启动钩子或其他环境变量。FDD 仍支持原路径，但必须有可被干净环境找到的全局运行库；不存在自动 SDK 环境回退。未改变原任务库、调度、租约或输入锁。

## 已完成验证

- Runtime TypeScript build exit 0。
- 正式发布函数在既有独立 Desktop resources 树实际生成 Host/Bridge，660 个文件完整核验；manifest `f4422507705200c3963da898846e5aa47d65a3f74f14106f501e7cb0e17a660d`。
- 实际目录：`C:\Users\李广威\.codex\worktrees\9477\Personal Agent\.worktrees\pr531-native-helper\.cache\native-desktop-publish\0a8c7a43-b3d8-46d8-9623-db2f1aca45b5\resources\native-tools\windows-host`。
- 真实 bridge `VERIFIED`、Host `hello_ack` request/nonce/version 关联及 EOF exit 0。使用私有合成 journal，显式将外部 DOTNET_ROOT 指向不存在的目录；只发 hello，未 bind、observe、target_ready 或 execute。
- 显式 `PA_TEST_WINDOWS_HOST_RESOURCES` 下运行 `node --test apps/desktop/test/native-windows-host-component.test.mjs apps/runtime/test/windows-host-adapter.test.mjs`：37 项全部通过。真实 Runtime transport 仍验证 stderr 的原 `VERIFIED` 帧；故意设置不存在的 `DOTNET_STARTUP_HOOKS` 不影响净化后的启动，原包复核撤销后 bind 未发出。普通用户检查由原 Bridge/Host 严格执行，未绕过。
- Synthetic 文件仅用于完整 inventory、缺 schema、替换运行库、附加文件、重新计算清单、跨路径绑定和不覆盖旧组件负例。其余原 Runtime/Policy、target、未知状态及不重放用例保留通过，Synthetic 不算真实窗口写后读回。
- 收尾增加“只剩 app-local hostfxr/hostpolicy 也不能伪装旧 FDD 入口”的前置拒绝回归：最终 Runtime build exit 0，专用文件 8 通过 / 1 显式真实资源未配置跳过；此前同正式包的真实测试仍按上行 37/37 单列。架构门禁 3/3 通过，`git diff --check` 通过。

缓存日志：`.cache/publish-windows-host.log`、`.cache/test-windows-host-component-real.log`、`.cache/build-windows-host-component.log`。完整产物与私有 journal 均未提交 Git。

## 继续入口

根 Main 选择上述正式 resources 后，使用同一 `readWindowsHostComponent` 结果建立原 transport；仍通过现有 `createDesktopNotepadHost` 和原卡/Policy 执行。没有新增真实 UI、自动批准或输入脚本。本包未验证真实 Notepad 写后读回、用户接管或安装/卸载；这些不能以 hello 成功替代。集成分支统一运行全仓 `npm run check`，本包不声称全仓通过。
