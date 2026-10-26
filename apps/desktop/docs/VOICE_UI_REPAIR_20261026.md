# 启动语音取消与面板准备修复（2026-10-26）

目标 profile：`huawei_ict_agentarts`；模块为 MOD-14/15 的 Desktop 启动消费。
工作树 `<source-worktree>/.worktrees/large-control-20261026`，
分支 `codex/large-control-repair-20261026`，HEAD
`b2fb20dd094743c411656b7e7703c8aae7571a8e`。
实际源基线是该树已有 A10 未提交工作区快照，不能只凭 HEAD 复现。
本增量独立于已冻结的 Control 修复，状态为 `review`，由主代理集成。

## 失败行为与最小修复

1. **取消后的准备回调仍打开面板。** `start()` 已进入 Main 的 `prepare()`，
   正等待 `stopWakeVoice()` 时，停止、休眠或关闭可让原请求失效。旧代码只在
   `prepare()` 前后检查 revision；Wake 释放完成后，生产回调已经执行了
   `openPanel(true)`。使用真实启动宿主及 AST 抽取的生产 Main 回调，三个取消
   分支修复前均失败，实际各打开面板一次。既有准备后的检查仍挡住问候和 Live，
   本回归没有发现或声称发生了新的录音泄漏。

   启动宿主现在向准备回调传入只读 `isCurrent()`；Main 在等待 Wake 释放后，
   执行打开面板前复核它。正常准备仍打开面板、完成问候并启动原 Live 宿主。

2. **已确认释放的正常取消被误报为释放未知。** 问候进行中停止、休眠或关闭时，
   原控制器正确取消并确认输出句柄已释放，但 Desktop 启动宿主仍把 `CANCELLED`
   改成通用失败。Main 的原失败回调继而设置“语音资源释放未确认”。使用同一
   真实宿主与 AST 抽取的生产失败回调，三个分支修复前均错误发布该提示。

   仅当原请求已被更新的 revision 取代、错误码确为 `CANCELLED`，且控制器
   当前读回 `resourcesReleased === true`，才按正常取消返回。供应商错误、
   释放中与释放未知继续走失败路径。输出释放拒绝的反例仍报告
   `release_unconfirmed`，重复关闭不能把它改成成功。

## 文件与兼容性

- `electron/voice-startup-host.js`：传递准备阶段的当前性检查；限定正常取消分支。
- `electron/main.js`：仅更改 `prepare({isCurrent})` 签名并加等待后的检查。
  此 Main hunk 独立交付，不能覆盖集成树的 MCP 或其他现有修改。
- `test/xhigh-voice-startup-preparation.test.mjs` 与
  `test/xhigh-voice-startup-cancellation.test.mjs`：八项本地合成回归。

`prepare` 是受信宿主内部回调，原忽略参数的测试调用方保持兼容；生产 Main 与
宿主变更必须配套集成。没有新增公开 wire、Schema、依赖、迁移、授权路径或
Local fallback。未修改 Wake、听写、Live、语音审批桥、Renderer、Runtime 或
既有 Control 成果；原模块 provisional 和实体设备待验边界保留。

## 验证与源码绑定

固定环境：Windows，Node `24.15.0`，PowerShell `7.6.6`。使用隔离树已安装依赖和
既有 A10 `dist` 副本，没有重新构建或安装。

```powershell
& '<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe' --test --test-concurrency=1 `
  packages/voice/test/startup.test.mjs `
  apps/desktop/test/voice-startup-host.test.mjs `
  apps/desktop/test/live-voice-boot-history.test.mjs `
  apps/desktop/test/xhigh-voice-startup-preparation.test.mjs `
  apps/desktop/test/xhigh-voice-startup-cancellation.test.mjs
```

- 聚焦组合：37 pass、0 fail、0 skipped；其中新增回归八项。Node 汇总耗时
  `8552.5533ms`，不把该数值当作设备性能指标。
- Main、启动宿主 `node --check` 与相关 `git diff --check`：退出码 0。
- 八项新增回归的单独运行同样通过，不与组合计数相加。
- 准备阶段初始失败日志 `before-startup-preparation.log` 为 0 pass／3 fail；
  取消误报初始日志 `before-startup-cancellation.log` 为 1 pass／3 fail。

原日志、起始文件副本、精确增量、起止 SHA-256 与验证回执均位于本工作树
`.cache/xhigh-voice-ui-20261026/`。最终源码绑定以 `validation.json` 为准，
Main 装配 hunk 与其他增量分开；不得把 Git HEAD 当成未提交源码快照。

## 未验证及集成要求

这是生产 JavaScript 控制器与 Main 回调的本地合成验证，输出、Live、Wake 释放和
窗口是显式 Fake。没有启动 Electron、打开麦克风、播放扬声器、访问云服务或
真实账号，没有验证 Windows 系统休眠/恢复与最终桌面合成效果。

主代理集成后需按改动风险执行必要的 Desktop 组合/窗口检查，真实设备能力仍需
独立授权和验收。此增量不把正常取消等同于 `task.cancel`，也不修改原后台任务。
本次没有提交、推送或创建 PR。
