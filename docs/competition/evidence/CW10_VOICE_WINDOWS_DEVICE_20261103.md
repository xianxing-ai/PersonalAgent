# CW-10 / MOD-11 / MOD-14～17：当前会话 final 与设备自检

- 目标 profile：`huawei_ict_agentarts`
- 范围：CW-10；MOD-11 受信主进程；MOD-14/15 语音与唤醒的设备边界；MOD-16/17 的 Windows 原生与状态读取边界
- 日期：2026-11-03
- 本记录只描述这次代码与本机命令的结果。夹具通过不是麦克风、扬声器、命名管道、UIA 或凭据库验收。

## 已实现（代码，未做真机验收）

当前 Live 会话的用户 final 由 `apps/desktop/electron/voice-session-final-host.js` 核验：

- 必须是 `live_input_audio`、`phase=final`、`origin=user`，摘要与原文一致，并绑定当前 `sessionId`、对话和通知策略 revision。
- `partial`、回声、空白、过期、旧 revision、其他会话、以及正在等待的业务卡，都不进入设置工具。
- 精确短语「暂停通知 / 开启静默 / 保持静默 / 恢复通知 / 取消静默」只改全局策略的 `mode` 与持续静默标记，其余已有字段保持原值。全局策略尚未配齐时拒绝，不补造额度。
- 其他句子只成为当前会话用户输入，供 `readCurrentInput()` 读取。它不调用 `task.submit`，也不代替 Live 的 `request_work`。
- 语音来源不调用 `authorization.respond`。人工业务批准仍走原对话卡；完全访问仍走既有策略。伪造的 `source=voice` 没有当前 final 账本时不能改策略。
- Live 生产事件的 `echo` 固定为 `unknown`。声学回声未证明时，路由器不修改通知策略。

## 未实现 / 未验收

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 物理麦克风、扬声器、回声、zh-CN 引擎 | 未验收 | 本环境是 Linux 云虚拟机，没有音频设备 |
| Live final 在生产路径上改通知策略 | 未启用 | 生产回声标记保持 `unknown`，故意失败关闭 |
| 语音 final 自动 `task.submit` | 未做 | 避免和既有 `request_work` 重复提交 |
| SIS 经 AgentArts 双工 | unavailable | 仍无流桥 |
| 命名管道、记事本 UIA、F9、输入接管 | 未验收 | 无 Windows 主机，且本环境没有 `dotnet` |
| Windows 凭据库适配 | 未实现 | 仍需独立边界；不能用夹具冒充安全存储 |
| 进程归因、磁盘 I/O、温度、网络活动 | 保持 unavailable | 既有 MOD-17 声明，本轮不把注入探针写成已观测 |
| 全量 `npm run check` 与 Windows CI | 未在本轮重跑 | 既有 Windows CI 失败见 IMAGE531 记录，与本增量分开 |

## 本环境实际命令

Node `v24.15.0`，npm `11.12.1`。

```text
node --test --test-isolation=none \
  apps/desktop/test/voice-session-final-host.test.mjs \
  apps/desktop/test/voice-command-host.test.mjs \
  apps/desktop/test/live-voice-final-receipt.test.mjs \
  apps/desktop/test/notification-application-host.test.mjs
```

结果：21 通过，0 失败，0 跳过。

```text
node --test --test-isolation=none \
  apps/desktop/test/live-voice-host.test.mjs \
  apps/desktop/test/voice-runtime-approval-bridge.test.mjs \
  apps/desktop/test/voice-final-approval-composition.test.mjs
```

结果：39 通过，0 失败，0 跳过。

```text
npm run typecheck --workspace=@personal-agent/desktop
npm run check:architecture
```

Desktop 类型检查退出码 0。架构检查 3 通过，0 失败。

```text
node packages/voice/scripts/check-audio-platform.mjs
node packages/windows-client/scripts/check-native-platform.mjs
```

两次均为 `acceptance=not_run`。音频脚本报告 `platform=linux`，未打开麦克风或扬声器。原生脚本报告 `dotnetError=ENOENT`，未打开命名管道、UIA 或凭据库。

## Windows CI 修复复验

Foundation `41618736633` 的三个失败均来自原 `initializeLiveVoice` 提取测试未声明新增宿主上下文。仅补齐 `notificationApplicationHost` 与 `voiceSessionFinalHost` 的未配置值，保留生产初始化器、历史恢复和零音频资源调用断言。

在 Windows 隔离工作树 `.worktrees/pr538-repair` 构建依赖后，`node --test apps/desktop/test/live-voice-boot-history.test.mjs` 为 3/3 通过。没有重复已通过的语音测试，也未把此结果计为麦克风、扬声器或云验收。当前提交完整 CI 仍由推送后单独确认。

## Windows 与音频真机步骤

在用户明确允许录音、播放和前台窗口操作后，于目标 Windows 机执行。不要把下面的命令输出写成已经发生。

1. 安装仓库要求的 Node 24.15.x / npm 11.12.x，以及 .NET 8 SDK 与 Windows Desktop 目标包。
2. `node packages/voice/scripts/check-audio-platform.mjs` 与 `node packages/windows-client/scripts/check-native-platform.mjs` 仍只证明脚本没有打开设备。`acceptance` 必须保持 `not_run`。
3. 引擎：`node packages/voice/scripts/check-wake-readiness.mjs`。缺 zh-CN 识别器时保持 unavailable，不用 Fake 顶替。
4. 可信面板打开 Live 或按键听写。结束后读回音轨 ended、AudioContext closed。说固定短句，确认草稿可编辑且未自动提交任务。播放一句测试回复，打断后没有后续片段。停止播报不取消已受理任务。
5. 唤醒默认关闭。显式启用后记录有限 `expiresAt`、双 ready 和单路采集。说「你好小派」，再分别关闭、撤销、等待原期限。读回 track ended 与检测器退出。正词、负词、噪声和播放回声要另计次数，不能把回调时抑制写成回声消除。
6. 通知：先在设置页保存完整全局策略。再说「保持静默」和「取消静默」。受限模式下决定仍在原对话卡；完全访问只沿既有自动同意。语音口播「同意」不能代替点卡。
7. 记事本：`dotnet build apps/windows-host/WindowsHost.csproj`，再按 `apps/windows-host/README.md` 的手工探测和 Timing 项目执行。确认新空白窗口、F9、UIA 读回和用户接管。探测程序不是生产授权链。
8. 状态：非管理员 PowerShell 运行 `packages/windows-client/scripts/capture-windows-evidence.mjs`，只保存脱敏元数据。进程归因、磁盘、温度和网络活动仍应标 unavailable。
