# MOD-28 一键暂停（总刹车）

目标 profile：`huawei_ict_agentarts`。负责模块：MOD-28（zemeng5208）。Desktop 界面按授权改了 renderer，请 2511375597-lab 审。Runtime 只加了暂停闸门和可恢复的 hold，请 goo122 审。

## 复用

- 对话里的「强制截断」仍走原来的 `task.cancel`，那是终态，总刹车不拿它当恢复。
- 进行中的工具调用继续走 TaskRuntime 每个任务的 `AbortController`，ToolGateway 原有的 abort 会收到这个信号。
- 断点仍写在原来的 `task_checkpoints`。`agent-loop` / `competition-loop` 保留。另外记一条 `operator-brake:v1`，说明这次是总刹车停下的。
- 恢复先把任务放回 `waiting_approval`，再调用原来的 `RuntimeApplication.resumeTask`。已确认的读取不重做。进行中的写入不自动重放，留在待核实。
- Scheduler 仍是 `dispatchDueSchedules` / `recoverMissedSchedules`。暂停时直接返回空，不把到期项标成 fired 或 skipped。
- 主动维护仍是 `proactive-runtime-pump`。暂停时这一拍直接返回，不 `resumeProactiveTask`。
- 暂停记录写在 Runtime 已有的 `trusted_host_state`（namespace `operator-brake`），没有新表，也没有第二套任务库。

## 接入点

| 位置 | 作用 |
| --- | --- |
| `packages/cognition` `createOperatorBrake` | 总开关编排。暂停先落盘，再逐个 checkpoint + abort；恢复时按记录 resume |
| `apps/runtime` `TaskRuntime` | `submitTask`、`runTask`、`tool.invoke`、`dispatchDueSchedules` 在暂停时拒绝新工作；`holdForOperatorPause` / `resumeOperatorHold` 复用现有断点 |
| `apps/desktop/electron/operator-brake-host.js` | 产品适配。启动后 `attach()`。IPC `operator.brake` 和托盘都调用它 |
| `apps/desktop/electron/main.js` | Runtime 创建后立刻 `attach()`。启动恢复在暂停时不 `resumeStartupTask`。维护轮询、主动泵、知识日程和连接器 tick 在暂停时不启动新工作。`task.submit` / `skill.run` 直接拒绝 |
| `apps/desktop/electron/preload.cjs` `setOperatorBrake` | 渲染进程唯一的暂停入口，走原来的 `desktop:action` |
| 面板按钮 `#operator-brake`、工作区状态行、托盘「暂停全部 / 恢复运行」 | 同一个开关和一句状态。没有统计、刷新或第二套设置页 |

PR #630 的风险档停止/恢复、#631 的来源触发、#633 的失败自愈都还没进 main。总刹车只留 `extensions.riskAutonomy` / `sourceTriggers` / `repair`。不传就不调用，也不引用那些未合入模块。它们以后只要在暂停时不再自行 `submitTask`，现有 Runtime 闸门就会挡住。

## 不做

不改 Policy 的 grant / authorize / revoke，不改业务连接器，不改 `packages/mcp`、`packages/skills`，不动 MOD-19。没有新的 wire capability，也没有数据库迁移。
