# 业务连接器端口契约（Potatos 分区：F06/F07/F08/F09/F11/F12）

> 本文是 28 图中业务域能力名（`todo./reminder./calendar./mail./feeds./notification./research./weather.` 前缀）的接口约定登记。
> 机器校验：`node scripts/competition/verify-graph-capability-coverage.mjs --domain business`（tests/contracts/business-connector-graph-contract.test.mjs）。
> 数据来源：`docs/competition/workflow-wiring.json`（图声明）+ `docs/competition/evidence/graph-capability-gaps.json`（缺口登记）。
> 规则：缺受信口保持 unavailable，禁止 Fake/静默回退；每个缺口必须有归属（owners/status/note/sources），每个有提供者的名字必须从缺口登记移除。

## 1. 已提供（main 有生产实现，工具名与连接器操作对齐）

| 图能力 | kind | 提供者 | 说明 |
| --- | --- | --- | --- |
| `calendar.events` | tool | packages/connectors/calendar（`calendar.events` 操作） | 只读日历查询 |
| `calendar.create` / `calendar.update` / `calendar.cancel` | tool | packages/connectors/calendar | 受控写操作（经 Policy/审批，支持 externalId 与重放幂等） |
| `calendar.freshness_check` | host | packages/agentarts/src/f06-f07-f11-business-hosts.ts | 日历序列号与时间窗新鲜度校验 |
| `calendar.registered_write` | host | packages/agentarts/src/f06-f07-f11-business-hosts.ts | 受控日历创建/更新本地写口与回执 |
| `calendar.update_and_invalidate_reminder` | host | packages/agentarts/src/f06-f07-f11-business-hosts.ts | 日历改期与旧闹铃失效联动回执 |
| `todo.registered_write` | host | packages/agentarts/src/f06-f07-f11-business-hosts.ts | 待办注册写口（带幂等键）；必须注入实现存储层原子 `reserve` 的持久化 `idempotencyStore`，未注入或缺少原子 `reserve` 时返回 `unavailable` |
| `reminder.current_clock_and_revision` | host | packages/agentarts/src/f06-f07-f11-business-hosts.ts | 提醒真实时钟与版本到期核验 |
| `mail.inbox` / `mail.reconcile_send` | tool | packages/connectors/mail | 收件与 Sent 对账（reconcile 已有） |
| `mail.save_draft` / `mail.accounts` / `mail.mark_seen` | tool | packages/connectors/mail | 草稿/账户/已读 |
| `feeds.collect` / `feeds.subscriptions` | tool | packages/connectors/feeds | 订阅抓取与目录 |
| `feeds.validate_and_deduplicate` | host | packages/agentarts/src/f08-f09-business-hosts.ts | 确定性 SHA-256 哈希去重与格式校验 |
| `research.search` | tool | packages/connectors/research | 研究搜索 |
| `weather.forecast` | tool | packages/connectors/weather | 天气查询 |
| `notifications.events` / `notifications.status` / `notifications.interruption_policy.set` | tool | packages/notifications | 通知事件/状态/中断策略 |
| `todo.create` / `todo.list` / `todo.update` | tool | packages/productivity | 待办基础操作 |
| `github.bound_ci_failure` | host | packages/agentarts/src/f16-dev-workflows-hosts.ts | 提交版本与 CI 失败日志绑定读回（对齐 `actions.run.list`/`actions.job.list`/`actions.log.read`） |
| `workspace.test_intent_check` | host | packages/agentarts/src/f16-dev-workflows-hosts.ts | 审查修复补丁是否保留真实验收意图 |
| `weather.forecast` | tool（图未引用） | packages/connectors/weather | 连接器提供但当前 F11 未在图中引用；保留提供面 |

## 2. 已登记缺口（main 尚无提供者；状态见缺口登记 JSON，逐条含 owner/note/sources）

| 图能力 | 图 | 缺口（摘要） | 负责 |
| --- | --- | --- | --- |
| `mail.registered_archive` | F08 | host 口已就绪（`packages/agentarts/src/f08-f09-business-hosts.ts`），等真实提供者（mail 连接器尚无归档实现） | Potatos498（`registered:open`） |
| `mail.registered_send` | F08 | host 口已就绪（`packages/agentarts/src/f08-f09-business-hosts.ts`，对齐 `MailService.send` 的 `externalId`/`messageId`），等真实提供者接线 | Potatos498（`registered:open`） |
| `notification.deliver` | F06/F12 | N05 真实投递回执 | Potatos498 + goo122（#574 在途） |
| `notification.deliver_when_due` | F12 | 到期投递口（#574 在途） | Potatos498 |

## 3. 组合契约（谁注入什么）

1. 业务工具（第 1 节）经 ToolGateway/Policy 注册；本契约只约束名字与语义，不改变既有授权链。
2. 第 2 节 host 口在生产可用时，由 Runtime 侧 fail-closed 工厂提供（模式同 #531 链的 `createRuntimeF*`），并同步：
   - 在缺口登记 JSON 中移除该条目（校验器会 WARN 残留登记）；
   - 在本文第 1 节加行并注明提供位置与测试。
3. `notification.deliver` 的投递读回必须来自真实渠道回执（N05）；fixture 静默 0 send 不作为实机证明（与 CW-09 口径一致）。
4. 真实账号读回（邮件/日历/订阅）为真实验收项：无账号环境按 unavailable 处理，评测集对应用例按 RUBRIC 判 unavailable。

## 4. 维护方式

新增/改名业务能力时：先改 `docs/competition/workflow-wiring.json`（图契约源），再让覆盖校验失败驱动登记更新；不允许只改文档不改图。
