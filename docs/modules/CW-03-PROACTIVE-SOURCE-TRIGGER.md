# CW-03 来源变化触发层（离线）

- Profile：`huawei_ict_agentarts`。负责人：zemeng5208。模块：CW-03 / MOD-28，消费 MOD-20 日历与 MOD-21 邮件的公开只读工具结果。
- 状态：`in_progress`。离线触发层已接到 Desktop 宿主、现有任务提交和审批卡。真实邮箱、日历账号、本机目录和 Laya 模型均未验收。
- 不修改 Potatos498 的连接器实现，也不触及 MOD-19。Policy 核心未改。Runtime Application 只加了一处恢复短路，见下。Desktop renderer 按 Owner 本轮授权修改。

## 行为

`createProactiveSourceTrigger` 放在 `@personal-agent/cognition`。宿主注入只读端口、现有 `LayaActionChoiceService`（或同形 `choose`）、任务提交端口和审批请求端口。本层没有第二个任务库、调度器或授权中心。

| 来源 | 读取方式 | 变化 |
| --- | --- | --- |
| 日历 | 只调用公开工具名 `calendar.events`，校验 `ConnectorItem`。不导入日历连接器实现 | 新会议、改期（起止时间变化）、已见过且进入会前窗口的即将开始。首次成功读取只建基线 |
| 邮件 | 只调用公开工具名 `mail.inbox` | 新的 `dedupeKey`。不因已读状态或抓取时间另造事件。首次成功读取只建基线 |
| 文件 | 用户把目录标成 `authorized: true` 后，只用 `readdir` / `lstat` / `realpath` | 授权目录内文件的新增或大小、mtime 变化。首次扫描只建基线 |

事件摘要是固定短句。邮件主题、正文和日历标题不会进入 Laya 上下文、任务目标或审批摘要。

去重按事件标识保留已处理项。同一来源在窗口内超过 `maxPerSource` 的事件留到下一个窗口，不丢基线。静默时段内的事件保持待处理，时段结束后再交给 Laya；会前事件若已经错过开始时间则标为 `stale`，不补执行。

默认规则里，会前准备材料、登记新会议、摘要新邮件和审阅文件变化是只读低风险。会议改期，以及任何 `external_write` / `local_write` 规则，都不能被降成低风险。

Laya 在「发起该任务」和「暂不发起」之间选择：

- 低风险、Laya 明确选中且 `eligibleForRuntime` 为真：调用注入的任务端口 `submit({goal, conversationId, idempotencyKey})`。返回的 `submitted` 只表示端口受理，不是任务完成。
- 高风险：只调用审批端口，状态为 `waiting_approval`。`resumeApproved` 必须带上同一次审批的 `approvalId`、`revision` 和参数摘要；`allowed` 才提交同幂等键，`denied` 不提交。判断结果即使自称可以自动执行，也不能跳过这一步。
- 选择暂缓、不确定或模型不可用：不提交。不可用会保留事件并有限次重试。

## 产品接线

`createProactiveSourceHost` 在应用启动后挂到现有维护轮询，并用 Runtime `createSchedule` 安排下一次检查。用户设置保存在原 Runtime host-state，命名空间 `desktop-proactive-source`。

- 日历只调用已注册的公开工具 `calendar.events`，邮件只调用 `mail.inbox`。
- 低风险调用现有 `task.submit`。
- 改期和写操作先 `requestToolApproval`，沿用现有审批卡。`resumeApproved` 核对原来的 revision 和参数摘要后才 `task.submit`，并取消审批载体任务。
- `resumeTask` 见到检查点 `proactive-source-gate` 时直接返回，避免把审批载体当成普通对话任务重新跑起来。这是 `apps/runtime/src/application/runtime-application.ts` 的最小钩子，请 goo122 复核。Policy 的 grant/authorize/revoke 没有改。

PR #630 的 `@personal-agent/autonomy` 尚未进入 main。触发器保留可选 `risk.decide()`：返回 `ask` 只会把动作收紧为先问，不能把改期或写操作降成自动执行。没有复制 #630 的分类表或配置存储。

## 设置界面

入口在「连接与提醒」，没有新导航页。控件只有总开关、日历、邮件、22:00–07:00 不打扰、目录授权和每条目录的撤销。规则是四行只读说明，最近记录只显示状态。

没有单独的规则编辑器、自定义静默起止、轮询间隔、统计面板、刷新按钮或保存按钮。改开关即生效。

默认关闭。打开后日历和邮件默认参与，静默默认打开，目录必须单独授权。

## 没有接线的部分

`connector.watch.start` 仍只声明 `mail` / `weather`。本层不扩展该工具，也不改 `ProactiveWorkflowEngine` 的四入口协议。

没有新依赖、数据库迁移或 Core wire。接口保持 provisional，Fake 通过不提升冻结等级。

## 验证

```sh
npm run test --workspace=@personal-agent/cognition
node --test apps/desktop/test/proactive-source-host.test.mjs
```

定向测试覆盖事件规范化、去重、规则与风险分流、静默释放、限流、无授权目录拒绝、符号链接越界拒绝、只调用 `calendar.events` / `mail.inbox`，以及宿主的任务提交、审批摘要和设置控件。

## 待办（真实环境，未执行）

- 用用户另行授权的一个日历账号，经现有 `calendar.events` 读回新会议、改期和会前窗口。本记录不能代替该读回。
- 用用户另行授权的一个邮箱，经现有 `mail.inbox` 核对新信头触发。不得把信头或正文写入公开证据。
- 在用户明确授权的一个本机目录上核对只读扫描。
- 本机 Laya 未启动时，宿主按规则直接分流；有可用的动作选择端口后再接上。这不是模型判断已验收。
