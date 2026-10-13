# MOD-16：本地就绪与现场边界（2026-10-13）

目标 `huawei_ict_agentarts`；负责人 zemeng。工作树 `.worktrees/zemeng-windows-tools-completion`，
分支 `codex/zemeng-windows-tools-completion`，起点 `5b581139`。未修改 Host 生产代码或 Desktop 配置。
本记录不把结构测试或握手提升为 UIA 完整验收，MOD-16 仍为 in_progress。

## 本轮实际验证

Windows `10.0.26200.0` / .NET SDK `8.0.424` / PowerShell `7.6.6`。
宿主令牌检查 `AdminToken=false`。HostFixture 与 Bridge Release 构建成功，0 警告、0 错误。

```powershell
dotnet build apps/windows-host/host/test/WindowsHost.HostFixture.csproj -c Release
dotnet apps/windows-host/host/test/bin/Release/net8.0-windows/WindowsHost.HostFixture.dll packages/contracts/schema/windows-host.json packages/contracts/fixtures/windows-host.json
dotnet build apps/windows-host/host/bridge/WindowsHost.PipeBridge.csproj -c Release
pwsh -NoProfile -NonInteractive -File apps/windows-host/host/bridge/test/HandshakeProbe.ps1 -BridgeExe apps/windows-host/host/bridge/bin/Release/net8.0-windows/WindowsHost.PipeBridge.exe -HostExe apps/windows-host/host/bin/Release/net8.0-windows/WindowsHost.Host.exe
```

fixture 输出 `Windows Host portable contract and durable-run fixture passed`。
真实握手输出 `bridge_readiness=VERIFIED`、关联一致的 `hello_ack`、`bridge_exit=0`，退出码 0。
仅启动本工作树的 Host/Bridge；未发送 observe/execute，未打开 Notepad，未输入 F9，未关闭用户应用。
首次 fixture 调用漏传 Schema/fixture 两个参数而失败，按已有入口修正后通过；这不是源码故障。
受限执行环境中的构建/子进程失败通过平台授权机制重试，不修改系统策略。

## 正式现场验收入口

当前 Desktop 已消费公开 `createWindowsHostBridgeTransport`、`createWindowsHostNotepadAdapter`
及 Runtime durable attempt store，固定 Release 产物存在时装配。无需重复建工具或任务库。
`apps/desktop/electron/main.js` 在 Notepad 装配前要求有效 AgentArts Runtime 配置。
本独立工作树没有主对话的加密云凭据，未复制；不要通过空 userData、Fake 或 synthetic 模式冒充正式入口。

主对话在已确认的可信配置宿主启动当前代码后，由用户现场完成：

1. 设置/管理后台 → 电脑操控 → 写入新记事本，填写公开合成文本，点击“新建并准备写入”。
2. 亲眼确认新建的独立、空白、单标签窗口，保持前台，亲按 F9。不能由脚本或代理代按。
3. 读回 Runtime 任务、Policy 授权消费、Host UIA 原目标写后读回及 Evidence，并由用户目视确认。
4. 分别验目标过期、接管/切换窗口、取消与错误目标拒绝。未知结果用原任务“核实执行结果”恢复，禁止重复写入。

同一 userData 的第二实例可能只激活既有窗口，不能据启动请求声称使用了本分支；不得擅自关闭原实例。
无法识别现代 Notepad 单标签/唯一可写 ValuePattern 时应保留拒绝，不能改选私人窗口。
当前缺现场 F9、目标确认、真实 UIA 写入和设备恢复回执；本地握手通过不代表 PA-016 完成。
