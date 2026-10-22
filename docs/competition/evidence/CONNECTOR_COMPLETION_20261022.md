# 邮件／天气变化提醒收口（2026-10-22）

状态：`in_progress`；profile：`huawei_ict_agentarts`。本地实施树为
`D:\worktree\f809\PersonalAgent\.worktrees\connector-real-completion`，
分支 `codex/connector-real-completion`，共同基线 `cb120aca060b6448852b2d1b9b5087c3b2b9d53e`。
本页仅记录所属连接器宿主、测试和验收入口；主进程的统一授权装配由本地主控单独集成。

## 实际修改

- 原事件保存 `notify` 后、主对话投影前退出，原决定任务可能已成功。恢复现在在同一
  `deliver` 收口中幂等投影原任务，再读取或发送原通知轮次；不会重做 Laya 判断。
- Electron `show` 常在 `sendAdvisoryNotification` 返回后到达。原回调可能已将批次标为
  delivered，下一次 `drain` 不再返回它。现在将原 `notificationBatchId` 在发送前保存于
  同一事件，后续只读回原 `deliverBatch` 轮次，确认迟到回执，不新建批次或重发 unknown。
- 两个既有真实 runner 改用统一授权卡，先核对原 task/run/tool、冻结参数 digest、期限、
  当前 revision 和可见启用按钮，再单次触发原 UI handler。未调用授权接口签发 grant，
  未再使用旧 `mail.enable` 开关或覆写原生出机确认弹窗。邮件云验收仍限一封 INBOX 信头，
  并额外读回原 `mail-export` 结果 digest/schema digest lease 和实际云续接身份。
- 新入口 `tests/manual/connectors/desktop-change-notification-live.cjs` 独立验收真实来源变化、
  原本机 Laya、原主对话和系统 `show` Evidence。原有限天气 runner 不因此升级为提醒闭环通过。

没有公共 wire/Schema、依赖、锁文件或数据库迁移。事件 host-state 只增加可选原批次标识。
旧未知投递和未决任务继续保留，不通过清库、改旧回执或重放来补成功。

## 主进程协作边界

统一授权已经取消旧全局 `sessionAllowed` 的读取依据，配置存在只表示可以请求授权。
主控另在 `main.js` 以原 `batchAuthorization.canRequest()` 判断邮件配置 readiness，并把原
`mail-local-batch` 资源 generation 纳入 `configurationRef`；撤销后即使配置仍可请求新卡，
旧 watch 也必须失效。实际每批读取仍由原统一批次卡、Runtime/Policy/ToolGateway执行。
邮件许可和活动 token 均不跨重启恢复。

主控另让授权卡优先解析原 watch／独立读取的主对话，最后才使用当前 panel。这里不重复编辑
主进程，也不以本页说明当作该接线已真实验收；集成后需核对用户切换主对话时的实际卡片归属。

## 真实变化入口与关键输入

入口需要由主控安排串行模型槽，并由受信宿主提供现存加密配置目录与 Electron 路径；
不向聊天提供授权码，也不读取或输出配置正文。隔离 userData 仅复制加密配置与 Local State，
不复制历史会话或业务库；本页没有启动它。

明确设置以下环境参数，再运行该 runner：

| 参数 | 含义 |
|---|---|
| `PA_MANUAL_CHANGE_NOTIFICATION_LIVE=1` | 本次真实来源／模型／系统通知执行许可 |
| `PA_CHANGE_SOURCE` | `mail` 或 `weather` |
| `PA_CHANGE_EVENT_PROVENANCE` | `natural`；邮件也可为 `controlled_public_mail`，这是操作人声明，分别记账 |
| `PA_CHANGE_WATCH_INTERVAL_MS`、`PA_CHANGE_WATCH_EXPIRES_AT` | 用户明确批准的间隔和 UTC 截止，进入原 start 参数 |
| `PA_CHANGE_ELECTRON`、`PA_CHANGE_SAVED_CONFIG_DIR` | 受信本机绝对路径，仅本机使用 |
| `PA_CHANGE_NOTIFICATION_POLICY_JSON` | 完整明确的隔离全局通知策略；mode=normal、channel=banner、无安静时段，额度由操作者明确给定 |
| `PA_CHANGE_PUBLIC_MAILBOX_ONLY=1` | 邮件必须是仅公开测试信头的专用 INBOX；不以此扩展私人邮箱授权 |
| `PA_CHANGE_WEATHER_QUERY_JSON` | 天气的明确公开测试地点 query，不代表用户位置 |

完整策略包含 `mode/maxInterruptions/windowMinutes/silentUntilUtc/preferredChannel/allowUrgentBreakthrough/digestMode/quietHours`。
策略通过原设置 UI 和原统一卡确认，只影响新建隔离实例，不能关闭用户现有应用的静默、暂停或额度门禁。

邮件先等待原首次完整基线；runner 输出 `baseline_ready` 后，需要用户或已授权发送方创建
一封新的公开测试邮件。runner 本身不发信、不改信、不读正文。每页最多 100 封、总量未知的
原本地批次范围必须在真实卡中明确；此前“一封信头到云端”的授权不自动覆盖它。

天气始终使用原 Open-Meteo 与原缓存行为，等同地点／日期／单位的自然显著变化；不改 UID、
缓存、日期、地点或 Provider 来制造变化。生产 adapter 没有受控远端天气事件入口，不能保证
在任意短时段出现显著变化。无事件、Laya 选择 defer/ignore、静默或原投递未知都不能强制 notify。

只有真实 baseline、新 event 原执行、实际本机决定、原主对话投影、同轮 native show、原 stop
后无新读和关闭后原 SQLite 读回全部满足，runner 才 exit 0。任一必验项未满足则 exit 1，
将缺项记为 `not_satisfied`；不以 Fake、跳过或模型自报成功填补。物理人工查看与按键单独记账，
原 Electron show 证明系统展示回执，不冒充人工看见或已读。

## 当前验证记录

- 所属生产宿主、三份相关测试、两个既有 runner、共享卡片 helper 和新变化 runner 的
  `node --check` 通过；`git diff --check` 通过。
- 新增离线行为回归：已成功 notify 的投影崩溃恢复、同进程迟到 show、邮件资源 generation
  撤销、卡片 run/tool/digest/期限替换拒绝、脱敏回执不投影合成私密内容。
  当前尚待主控串行资源槽执行；这些用例即使通过也不构成真实来源／模型／OS验收。
- 本页阶段没有安装依赖、构建、启动真实服务、读取真实配置或邮箱、发送邮件、推送或创建PR。
  真实自然事件、真实 Laya 判断、主对话与真实提醒仍未由本轮新入口取得回执。
