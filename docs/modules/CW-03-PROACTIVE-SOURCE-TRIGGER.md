# CW-03 来源变化触发层（离线）

- Profile：`huawei_ict_agentarts`。负责人：zemeng5208。模块：CW-03 / MOD-28，消费 MOD-20 日历与 MOD-21 邮件的公开只读工具结果。
- 状态：`in_progress`。本增量只证明离线 Fake 端口上的规范化、去重、限流、静默时段、规则匹配和风险分流。真实邮箱、日历账号、本机目录和 Laya 模型均未验收。
- 不修改 `apps/runtime`、`packages/policy`、Desktop renderer、Potatos498 的连接器实现，也不触及 MOD-19。

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

## 没有接线的部分

`connector.watch.start` 仍只声明 `mail` / `weather`。本层不扩展该工具，也不改 `ProactiveWorkflowEngine` 的四入口协议。Desktop 主进程和 Runtime Application 的生产组合不在本增量内，避免改到其他负责人的 renderer、Runtime 核心和连接器实现。后续宿主应把已批准的 `calendar.events` / `mail.inbox` 调用和用户授权目录注入本工厂，再把低风险 `submit` 接到现有 `SubmitTaskInput`，把高风险请求接到现有审批卡。

没有新依赖、数据库迁移或 Core wire。接口保持 provisional，Fake 通过不提升冻结等级。

## 验证

```sh
npm run test --workspace=@personal-agent/cognition
```

定向测试：`packages/cognition/test/proactive-source-trigger.test.mjs`。覆盖事件规范化、去重、规则与风险分流、静默释放、限流、无授权目录拒绝、符号链接越界拒绝，以及只调用 `calendar.events` / `mail.inbox`。

## 待办（真实环境，未执行）

- 用用户另行授权的一个日历账号，经现有 `calendar.events` 读回新会议、改期和会前窗口，核对本地任务受理与审批卡。本记录不能代替该读回。
- 用用户另行授权的一个邮箱，经现有 `mail.inbox` 核对新信头触发。不得把信头或正文写入公开证据。
- 在用户明确授权的一个本机目录上核对只读扫描；未授权目录必须继续拒绝。
- 把上述端口接到现有 Runtime 任务提交和审批卡后，再做一次离线组合回归。当前没有做这步生产接线。
