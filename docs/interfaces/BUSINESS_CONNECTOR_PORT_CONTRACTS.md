# 业务连接器端口契约（Potatos 分区：F06/F07/F08/F09/F11/F12）

> 本文是 28 图中业务域能力名（`todo./reminder./calendar./mail./feeds./notification./research./weather.` 前缀）的接口约定登记。
> 机器校验：`node scripts/competition/verify-graph-capability-coverage.mjs --domain business`（tests/contracts/business-connector-graph-contract.test.mjs）。
> 数据来源：`docs/competition/workflow-wiring.json`（图声明）+ `docs/competition/evidence/graph-capability-gaps.json`（缺口登记）。
> 规则：缺受信口保持 unavailable，禁止 Fake/静默回退。覆盖校验的源码命中只证明存在实现候选；在可信生产调用方接线前保留缺口登记。

## 1. 已提供（main 有生产实现，工具名与连接器操作对齐）

| 图能力 | kind | 提供者 | 说明 |
| --- | --- | --- | --- |
| `calendar.events` | tool | packages/connectors/calendar（`calendar.events` 操作） | 只读日历查询 |
| `calendar.create` / `calendar.update` / `calendar.cancel` | tool | packages/connectors/calendar | 受控写操作（经 Policy/审批，支持 externalId、重放幂等与 `expectedSequence`/`ifMatch` 条件写） |
| `mail.inbox` / `mail.reconcile_send` | tool | packages/connectors/mail | 收件与 Sent 对账（reconcile 已有） |
| `mail.save_draft` / `mail.accounts` / `mail.mark_seen` | tool | packages/connectors/mail | 草稿/账户/已读 |
| `feeds.collect` / `feeds.subscriptions` | tool | packages/connectors/feeds | 订阅抓取与目录 |
| `research.search` | tool | packages/connectors/research | 研究搜索 |
| `weather.forecast` | tool | packages/connectors/weather | 天气查询 |
| `notifications.events` / `notifications.status` / `notifications.interruption_policy.set` | tool | packages/notifications | 通知事件/状态/中断策略 |
| `todo.create` / `todo.list` / `todo.update` | tool | packages/productivity | 待办基础操作 |
| `weather.forecast` | tool（图未引用） | packages/connectors/weather | 连接器提供但当前 F11 未在图中引用；保留提供面 |

## 2. 已登记缺口与接线说明

`F06`/`F07`/`F08`/`F09`/`F11`/`F12` 的宿主实现（[packages/agentarts/src/f06-f07-f11-business-hosts.ts](../../packages/agentarts/src/f06-f07-f11-business-hosts.ts)、[packages/agentarts/src/f08-f09-business-hosts.ts](../../packages/agentarts/src/f08-f09-business-hosts.ts)、[packages/agentarts/src/f12-notification-hosts.ts](../../packages/agentarts/src/f12-notification-hosts.ts)）与开发工作流宿主端口（[packages/agentarts/src/f16-dev-workflows-hosts.ts](../../packages/agentarts/src/f16-dev-workflows-hosts.ts)、[packages/agentarts/src/f18-f19-github-hosts.ts](../../packages/agentarts/src/f18-f19-github-hosts.ts)）均已通过 [apps/desktop/electron/business-workflow-hosts.js](../../apps/desktop/electron/business-workflow-hosts.js) 及 [apps/desktop/electron/feeds-host.js](../../apps/desktop/electron/feeds-host.js) 完成桌面宿主接线与 SQLite/Loopback 回路实测，并在 [apps/desktop/test/business-workflow-hosts.test.mjs](../../apps/desktop/test/business-workflow-hosts.test.mjs) 与 [apps/desktop/test/feeds-host.test.mjs](../../apps/desktop/test/feeds-host.test.mjs) 持续回归。外部真云/真硬件/真实邮箱账号读回仍按真实环境独立验收：

| 图能力 | kind | 宿主实现与接线 | 说明 |
| --- | --- | --- | --- |
| `calendar.freshness_check` | host | `f06-f07-f11-business-hosts.ts` + `business-workflow-hosts.js` | 日历序列号与时间窗新鲜度校验（已接 `CalDavProvider`） |
| `calendar.registered_write` | host | `f06-f07-f11-business-hosts.ts` + `business-workflow-hosts.js` | 受控日历创建/更新写口与账户绑定（已接 `CalDavProvider`） |
| `calendar.update_and_invalidate_reminder` | host | `f06-f07-f11-business-hosts.ts` + `business-workflow-hosts.js` + `todo-host.js` | 条件更新 + `todoHost.invalidateReminder` 联动 |
| `todo.registered_write` | host | `f06-f07-f11-business-hosts.ts` + `business-workflow-hosts.js` | SQLite CAS（`RuntimeAtomicStatePort`）幂等写口 |
| `reminder.current_clock_and_revision` | host | `f06-f07-f11-business-hosts.ts` + `todo-host.js` | 真实时钟与 `todoHost.readReminderState` 读回 |
| `feeds.validate_and_deduplicate` | host | `f08-f09-business-hosts.ts` + `feeds-host.js` | `feed-source-grant` 租约与跨重启持久游标/指纹 |
| `notification.deliver` / `notification.deliver_when_due` | host | `f12-notification-hosts.ts` + `notification-application-host.js` + `desktop-notification-port.js` | OS 回执/点击/撤回账本接线（真机系统通知另行实测） |
| `mail.registered_archive` | host | `f08-f09-business-hosts.ts` + `packages/connectors/mail` (`archiveMessage`) + `business-workflow-hosts.js` | IMAP 真实归档方法已落盘，真实 QQ 账号联跑需配置环境变量 |
| `mail.registered_send` | host | `f08-f09-business-hosts.ts` + `business-workflow-hosts.js` | 对齐 `MailService.send` 与 `unknown` 对账态，真实发信需配置环境变量 |
| `github.bound_ci_failure` / `workspace.test_intent_check` | host | `f16-dev-workflows-hosts.ts` + `business-workflow-hosts.js` | F16 CI 失败日志读回与测试意图校验（已接 `GhCliProvider`/`GitHubService`） |

## 3. 组合契约（谁注入什么）

1. 业务工具（第 1 节）经 ToolGateway/Policy 注册；本契约只约束名字与语义，不改变既有授权链。
2. 第 2 节 host 口在生产可用时，由 Runtime 侧 fail-closed 工厂提供（模式同 #531 链的 `createRuntimeF*`），并同步：
   - 在缺口登记 JSON 中移除该条目（校验器会 WARN 残留登记）；
   - 在本文第 1 节加行并注明提供位置与测试。
3. `notification.deliver` 的投递读回必须来自真实渠道回执（N05）；fixture 静默 0 send 不作为实机证明（与 CW-09 口径一致）。
4. 真实账号读回（邮件/日历/订阅）为真实验收项：无账号环境按 unavailable 处理，评测集对应用例按 RUBRIC 判 unavailable。

## 4. 维护方式

新增/改名业务能力时：先改 `docs/competition/workflow-wiring.json`（图契约源），再让覆盖校验失败驱动登记更新；不允许只改文档不改图。
