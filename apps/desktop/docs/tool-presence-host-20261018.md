# 共享原生在场确认（2026-10-18）

`createToolPresenceHost` 只消费主进程注入的 `registerNativeShortcut(handler) => unregister`、`isTaskCurrent(taskId)`、`readTaskBinding(taskId)` 和 `onPrompt`。主组合使用原持久任务的 canonical UI conversation reader；不按任务名前缀授权。宿主不自行抢占 F9、不读取模型自报在场状态。

公开方法为 `requestPresence({taskId,deadline,signal})`、`isUserPresent(taskId)`、`registerConfirmation(callback)` 和 `close()`。每次 F9 只确认当前队首，后续请求必须再按一次。Notepad 使用同一原生注册槽，不能从旧 callback 获得通用任务回执。关闭和取消释放注册、清除等待和回执。

回执绑定原 task、canonical identity、AbortSignal 和原 deadline，有效期至多 30 秒。任务失效、绑定变化、取消、过期和时钟回退均使回执失效。回执只证明短期在场，不创建 Policy grant。

集合 API 为 `.tools/.competitionToolAvailability/.competitionToolExports`。其中 `desktop.request_presence@1.0.0` 是严格空参数 read 工具；模型不能传入 task 或 conversation。其结果仅包含 `{state:'present',expiresAt,authorizationGranted:false}`，投影时再次验证原回执。主组合可显式将这个 read 加入 automaticTools；它不会自动批准后续写入。

Runtime 的目录只在存在可信 `isUserPresent(taskId)` 端口时公开 `requiresPresence:true` 的 Schema，即使当前回执为 false。Schema 可发现不表示已满足在场或已授权执行。`assertProposal` 仍要求真实在场为 true；原 Gateway 在即将执行时重新读取同一可信端口，并忽略调用参数自报的 userPresent。原 descriptor、Policy、64 项/24576 字节 wire 上限均不变。没有可信端口时不公开这些工具。

Local/Synthetic 验证：broker 使用假时钟和注入的原生 callback，不代表真实 F9、Windows 硬件或云端验收。定向测试覆盖 FIFO、旧 callback、Notepad 共用、取消/过期/身份变化、通用工具投影、原 Runtime 子任务请求确认后独立审批和结果续答，以及在场前提案/撤销后执行均零写入。
