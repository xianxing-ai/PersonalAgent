# Desktop H6 原事件授权修复

Competition Profile 的持续工作流保留在原用户会话中。来源可以是原 `user-work` 子任务，
其独立子会话只用于原 source quote 和 parent 证据。Wake 必须匹配原工作流任务、持久
application state 和解析后的用户会话；原 fired schedule、proposal、Policy/Gateway 确认回执、
参数摘要、来源撤回及期限检查继续生效。

Connector 当前版本只由原 confirmed source router 的持久 `pending.heads/heads` 中
精确 `eventId + revision` 和原 confirmed feed 回执共同确认。两个版本的 `observedAt`
可以相同，不能用时间戳推断先后。Sink 通知发生在 acknowledgement 前，原 pending head
此时已持久化；确认后移动到 heads 应保持相同的原出机许可与来源证明。

本次不新增 registry、调度器、网络读取、重发、模型调用、协议或数据库迁移。Startup
仍只读原持久 workflow/session/ledger 与当前本机授权；真实云、模型和设备验收单独记录。

关键回归在 `test/harness-events-host.test.mjs` 和
`test/proactive-confirmed-source-router.test.mjs`：合法子任务来源 Wake、错误工作流／日程会话、
相同观察时间只接受当前 head，以及 pending acknowledgement 前后证明一致。
任务、Policy、工具回执和 ledger 使用实际 SQLite；事件正文、来源采集和交接显式为 Synthetic。

Node 24.15.0 定向检查：原 router pending acknowledgement 和新增相同观察时间的版本／ack
竞态两个小例 **2/2 通过**；两个源码与两个测试文件的 `node --check`、`git diff --check` 通过。
三个新增 Host 小例 **not_run**：本树尚缺 `apps/runtime/dist/application/harness-events.js`，
测试在模块加载时停止，未构建或手工转译替代 dist。后续统一构建后运行原测试。
完整检查与真实 UI、云、模型和设备验收均由整合阶段另记，本次不将其视为已通过。
