# Live 直接开启与正式应用重启读回

Competition Profile，工作树 `D:/worktree/f809/PersonalAgent`，分支 `codex/autonomous-change-loop`。

用户要求主动点击 Live 不再追加麦克风用途卡，完全访问自动通过应用层审批，决定后的卡片离开对话。
实现提交 `045a57fc`、`accefb8f`、`9698831f`，本次正式启动 Git head 为 `6b9a9e44`。
完整构建两次成功；新增完全访问策略之后另行构建 Runtime 成功。Desktop 原生 JS 直接加载，语法检查通过。

旧正式进程已不在运行。首次用原加密配置启动更新应用后，实际 Live 卡可持久化并由界面决定，
观察到 allowed、WSS connected、物理 microphone ready；期间存在用户并行操作，验收脚本没有冒领人工决定。
随后通过原应用正常 stop/quit、草稿 preflight 和释放流程退出，没有强杀。

最终版本于 2026-10-22T07:48:07Z 用原用户目录重新启动，Runtime、AgentArts、Live、SIS 就绪。
验收于 07:49:03Z 点击实际生产面板的 Live 按钮，07:49:06Z 读回：

- `live.status = listening`、`live.active = true`。
- `live.diagnostic = {stage: microphone, status: ready, elapsedMs: 1310}`。
- `voice.capture.active = true`、`authorized = true`、`subscriberCount = 1`。
- 本次新增应用授权卡 **0**；没有调用批准 IPC、伪造音频、替换网关或使用 Fake。

原始本机回执在 `.cache/live-direct-start-app-6d228c7c0be24d9488d83ab4b3fdce34/`，包含私有应用元数据，
不提交用户历史、任务标识或数据库。前置脚本曾把按钮模式误写为 `voice`，在点击前拒绝；
核对生产按钮的 `live` 模式后重试，旧脚本失败原样保留在本机回执。

本记录证明当前真实应用已直接开启 Live、连接真实 WSS 并采集物理麦克风；不代替听辨、双向转写、
语音业务请求或其他设备的完整验收。应用保留运行，未为取证关闭用户会话。

自动批准策略及卡片交互的其他证据分别记录：Runtime/Policy + 显式 Fake 日历流程 22/22，
其中 full-access 修改日程零卡、受限修改两卡且拒绝不写；麦克风/用途/设备权限测试 14/14，均零跳过。
真实 CalDAV 修改及独立读回另行执行，不能由本文件的 Fake 测试推定通过。
