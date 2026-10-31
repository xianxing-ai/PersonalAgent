# #531 业务图端口增量（2026-10-31）

后续 F06 未来调度分支、实际图执行引擎与原审批来源预检增量见 [F06 记录](F06_FUTURE_REMINDER_20261031.md)。本页早期范围与未验项保留作当时证据，不代表后续增量已经完成云端或系统设备验收。

目标 profile：`huawei_ict_agentarts`。工作树：`.worktrees/pr531-business`，基线 `3268b028`；只读原图绑定依赖 `9a4f5414`（本工作树拣选为 `53a1fea2`）。此记录只描述业务端口增量，不宣布 #531 整图接线或真实验收完成。

## 本次实现

- F06：N03 显式 `remindUtc` 转发至原 `todo.create`，截止日期不会暗中变成提醒。持久记录原 todo、revision、reminderScheduleId。Desktop 端口使用独立 child Policy bridge；N05 只核实原 N04 ready、原通知 batch/round 和设备投递回执，不重复发通知。
- F07：`calendar.events` 在无 cursor 的完整窗口返回可选 `sourceVersion`。版本覆盖窗口、账号、事件修订、内容及时间，排除读取时间；分页不提供版本。N04 在 execute/before_export/after_export 三个固定动作分别独立通过 Policy 读取原窗口，N05 复用 `calendar.create` 的写后读回。
- F11：新增 N05 工厂，原 `calendar.update` 确认后才调用 `todo.update(clearReminder)`。完成守卫同时核实真实 Runtime calendar 执行记录、原日历条目、原 Todo 无提醒和旧 schedule 已 cancelled。已 fired 的旧提醒不能冒充成功作废。两个写操作分别取得 child Policy 授权，部分成功保留原身份。
- F12：设备宿主持久化 begin/complete 的顺序由现有 Desktop notification host 负责；图只比对同 round/channel 的持久结果。缺回执或 unknown 返回 `RESULT_UNKNOWN`；原轮次恢复只读回，不再次发送。

不新增调度器、任务库、依赖或迁移。通用 bridge、Main、Runtime composition 及每图 worker 注册由集成工作包接入，当前文件不擅自修改这些共享入口。

## 集成契约

各 Desktop 工厂读取 `application.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId,sessionId,signal})`；它验证原 worker、描述符、输入及已确认执行证据。`authorizeExport` 仍须由受信宿主提供精确出机授权，不能使用恒真生产回调。

原图输入分别至少包含：

| 图 | 原始可信输入 |
| --- | --- |
| F06 | `todoTitle`、可选 `due`、显式 `remindUtc`；N05 仅接受原 `{todoId,revision}` |
| F07 | `calendarReadArguments`（完整有界窗口）、`title`、`slot` |
| F11 | `update` 和 `reminder:{todoId,revision,scheduleId,conversationId}`；提醒必须来自原授权计划 |
| F12 | 原 `roundId,itemId,channel,policyRevisionDigest,title,body,source`；round 已由现有通知宿主预留 |

通用 child bridge 的固定动作映射：

| actionKey | 原节点/工具 | 业务工具 |
| --- | --- | --- |
| `f06.todo.create` | F06_N03 / workflow.host.f06_n03 | todo.create |
| `f07.calendar.recheck.execute`、`.before_export`、`.after_export` | F07_N04 / workflow.host.f07_n04 | calendar.events |
| `f07.calendar.create` | F07_N05 / workflow.host.f07_n05 | calendar.create |
| `f11.calendar.update` | F11_N05 / workflow.host.f11_n05 | calendar.update |
| `f11.reminder.clear` | F11_N05 / workflow.host.f11_n05 | todo.update |

工具版本必须取当前原始注册描述符。bridge 返回原 `{result,taskId,runId,toolName,toolVersion,arguments,scopeRef,evidenceRefs}`；参数改变不得新造 child 身份。F07 两次出机阶段后验只允许新增 read 子任务，不能因原 host 成功而获得新的写权限。

## 验证边界与剩余项

首轮定向验证 20/20 通过，补充 F07/F11 守卫及工厂回归 10/10，最终 Desktop 端口回归 6/6（含 Runtime 绑定前惰性装配）。覆盖 F06 显式提醒与原绑定、F07 完整窗口版本、F11 原日历与旧提醒读回、F12 本地 SQLite/通知宿主投递和 unknown 不重发。设备事件、账号数据、图输入和 bridge 在这些边界测试中使用明确夹具，不是实际用户账号、实际 OS 通知或华为整图验收。

`npm run check` 已使用 .NET 8、PowerShell 7、OpenSSL 及仓库外 TEMP 完整退出 0：汇总 6436 项，6392 通过、44 门控跳过、0 失败，包含末尾 integration 57/57。日志位于本工作树 `.cache/pr531-business/check.log`。该检查使用首批 `fd9ad9e0` 的构建产物；后续 F08 邮件增量单独构建与验证，不挪用此结果。`git -c core.whitespace=cr-at-eol diff --check` 通过：calendar 的既有文件在 Git 中本身采用 CRLF，保留其原行尾，不为本任务整文件格式化。

- F08 在后续独立增量补充真实 `mail.send`、`mail.archive` 及原发送身份桥，见 [F08 增量证据](IMAGE531_F08_MAIL_PORTS_20261031.md)。不得用 save_draft/mark_seen 代替；没有向真实收件人发送邮件。
- F06 真正到时的既有提醒 tick、F07 真实 CalDAV 账号、F11 原日历与交通提醒映射、F12 实际设备事件仍须由集成环境验收。
- 窗口摘要不是整个账号的版本，也不是跨读写的原子锁；CalDAV 更新继续以原强 ETag 防覆盖，不能从摘要推断创建操作具有原子冲突排除。
- 尚未声明任一相关整图 done；#531 必须继续完成生产装配和用户要求的真实验收后才能合并。
