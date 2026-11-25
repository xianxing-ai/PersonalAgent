# F06 原实际图设备入口交接

目标 profile：`huawei_ict_agentarts`。本增量只提取既有实际 Engine/Runtime/SQLite/AuthorizationQuestions/Todo/原 scheduler 场景，不增加生产执行链或改变提醒语义。场景为 `apps/desktop/test/fixtures/f06-runtime-scenario.mjs` 的 `scenario(t, options)`；保留全部原到期、未来、取消/编辑、拒绝、重启与 unknown 断言。

真实设备接点：`options.createChannel({getApplication,getNotificationHost,userData})` 返回原 `createDesktopNotificationPort`，沿 Main 相同 `onOutcome: outcome => getNotificationHost().receipt(outcome)` 消费异步 OS 回执；生产通知端口内部原 storage 持久回执，传入场景独立 `userData`。显式端口不可用会拒绝，不能回退 Fixture。`t.after(callback)` 接收原释放回调，真实设备脚本须执行它。返回值包含 `userData`、`sent`、原 `app/todoHost/notificationHost`、图子任务与 `restart()`；旧 `shown` 计数实际发送尝试，不等于 OS delivered，验收须读 `sent[0].roundId` 对应原 round 的 banner 状态和 evidenceRefs。

公开合成场景仅创建标题 `Original reminder` 的本机 Todo 和通知，根代理串行换入真实 Electron notifier 后确认：一项原 schedule、状态 fired、同原 round/banner delivered、有原设备 evidenceRefs，重启/tick 不重发；云 transport、候选内容/选择和授权响应仍是 Fixture。未来分支使用真实墙钟与原 scheduler，不提前改时钟；若选择此分支，图完成首先应为 scheduled/delivered=false，之后原 scheduler 才可投递。

本地验证包含注入原 DesktopNotificationPort 的单次发送/持久 round 读回/重启不重发、显式缺失端口拒绝、40ms 异步 show 回执从 unknown 到 delivered 且零重发；`node --test apps/desktop/test/business-workflow-f06-runtime.test.mjs` 共 11/11 通过，日志 `.cache/pr531-business/f06-channel-final.log`。notifier 仍为明确 Fixture。本记录不代表真实 OS、真实云或人工审批验收，真实设备结果由根集成记录。
