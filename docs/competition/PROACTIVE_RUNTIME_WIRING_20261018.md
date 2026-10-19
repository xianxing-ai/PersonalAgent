# 持续责任的原 Scheduler 与 confirmed 来源消费（2026-10-18）

这是 Desktop main 的可信组合适配器，不新增模型工具、授权来源、定时器或任务数据库。
模型仍经 `proactive.workflow.*` 和原 Policy 调用；内部动作仍由签名 frontier 与原 ToolGateway 执行。
本包不配置业务连接器，不实现新的判断引擎或高级主控。

## 原 Scheduler 的调用入口

`createDesktopProactiveRuntimePump({getApplication,getWorkflow,resolveUserConversation,recoverSources?,now?})`
位于 `apps/desktop/electron/proactive-runtime-pump.js`。main 在现有事件 poll 调用 `await pump.tick()`，
不另建 interval。并发 tick 合并，每轮最多十页原 Runtime tasks，未完扫描在下一轮继续原 snapshot。

host 的 `maintenancePage()` 只读原 `desktop-proactive-workflow-v1` 绑定；
`acquireMaintenance(taskId,{signal,deadline})` 恢复相同签名 host。新责任持久化非密钥 imageBinding，
配置变化拒绝恢复；旧绑定缺 imageBinding 时不自动恢复，需要原显式 native resume。
用户撤回、取消、终态、过期、无法解析的源会话不会自动启动。

pump 使用原 `recoverMissedSchedules/dispatchDueSchedules/getSchedule`，只把该责任自身已登记、
确实 fired 且具有原 task idempotency 绑定的 schedule 送入原 `ingestWake`。
原 `runtime-wake:<scheduleId>` durable entry 去重。已有 worker 通过原 notify 唤醒；
需重新进入的原 worker 每个 pump 生命周期只尝试一次，不按 poll 重放未知操作。
这不承诺机器关机后继续工作；缺 `cloudPersistentHost` 仍不可用。

## confirmed 公开来源的调用入口

`createDesktopProactiveConfirmedSourceRouter({getApplication,getWorkflow,namespace,
resolveUserConversation,readSourceBinding,readTrackingGrant,now?})`
位于 `apps/desktop/electron/proactive-confirmed-source-router.js`。
两个 feed reader 必须直接使用原 feeds host 的公开方法；不能传入模型自报的分类或 grant。

main 仅在原 `admitNativeFeedInterest` 明确的 `trackingTaskId` 入口，将第三个 scope 参数交给
`feedCollect(query,signal,{trackingTaskId})`。原 `prepareHostToolTask` 后、`finalizeHostToolTask` 前调用：

```js
router.bindPreparedFeedRead({
  taskId: prepared.taskId, expectedTaskRevision: prepared.revision,
  trackingTaskId, commandId, toolVersion, arguments: query,
});
```

此同步方法只在原 created revision 冻结来源绑定，不改变 task revision，不授 Policy 许可。
已执行后不能补绑定，原 command、namespace、工具版本和参数摘要不能替换。
无第三个 scope 的后台 collect 不自动投递，不把 namespace 的 knowledge-watch grant 用于其他责任。

原 `readHostToolTask` 得到 `read.confirmed` 后，遍历原 workflow sessions，先用
`router.matchesTrackingTask(session.sourceTaskId,trackingTaskId)` 验证准确的原任务或历史父子绑定。
此检查使用公开 `readSubagentConversation` 验证持久结构，不按 ID 前缀或同 UI 推定身份。
随后调用：

```js
await router.routeConfirmedFeed({
  workflowTaskId: session.taskId, taskId: prepared.taskId,
  runId: read.confirmed.runId, toolVersion,
  arguments: query, scopeRef: read.confirmed.runId, trackingTaskId,
}, {signal, deadline});
```

普通模型读取也可消费其原 confirmed task/run；上述 host read 必须另有原 prepared 绑定。
不替换 actual read taskId、runId、原参数、Evidence 或 scopeRef。
当前来源必须 public、无凭据、配置一致；原 native tracking grant 必须准确属于原 tracking task、
相同 purpose/configuration/revision、未过期；同 UI 的另一个任务不共享此许可。

router 使用 Runtime 原 `createKnowledgeFeedReceiptFromConfirmedExecution` 复核真实 Policy allow、
confirmed tool record、参数、scope 与 Evidence，再用 feeds 的 `assertFeedSourceReceiptMatches`
检查原生 public transport receipt 与内容摘要。缺完整 receipt、空/局部页或来源证明时返回 unavailable；
不会把未支持的输入伪造成 no_changes。业务 provider 的真实性仍由原 host/receipt 保证。

事件只包含原 public connector item；revision 明确标为 `item_projection_digest`，不伪造 provider 版本。
同一内容稳定 eventId；相同 receipt 或内容不会重复制造事件。原 cursor 只随事件传递，不代 provider 推进游标。
原 Runtime atomic host state 先保存 exact pending batch，再送原 `eventSink.persist`；只有原 durable ack 后提交头。
丢 ack 后恢复原 invoke（可跨 Runtime reopen）先重放 exact pending batch，不重新执行原 provider 操作。
main 在 pump 构造注入 `recoverSources:(taskId,context)=>router.recoverPending(taskId,context)`。
每次已核原 image/TTL/来源的普通 poll，从原 Runtime atomic host state 的有界 pending 索引读取原
pending.origin，再读回原 host-tool-intent/prepared 绑定、版本、参数、scope 与 receipt。
恢复复用同一来源 mutex，再核相同 grant revision/current source/撤回标记及原 confirmed Evidence，
只 persist 原批次；不调用 collect，不建新任务/计时器。调用失败或返回 unavailable 不记成已投递。
撤回检查同时覆盖 responsibility source、实际 read 与原 tracking parent。
历史头限 1000、最近 receipt 限 64、每责任待确认来源限 64；超界或配置变化明确要求 reconciliation。

## 验证与剩余条件

定向 Node 24.15.0 Local/Synthetic 测试使用原 Runtime/SQLite/Policy/Evidence、签名 Engine 和 Scheduler。
来源正文、native 分类/grant 与 teacher/action 为明确替身；没有真实外网来源、云模型、账号、Laya 或实体设备。
测试覆盖原 Scheduler wake 去重、配置/期限/撤回/legacy 拒绝、bounded scan 续页、confirmed 来源、
原 host prepare 绑定、同 UI 越权拒绝、SQLite reopen 后普通 poll 补取丢失 ack、
tracking parent 撤回/原 grant 撤销拒绝和 unchanged item 去重。
main 最终组合由 Root 完成；模块通过不等于真实业务或关机持续执行验收。

`controller.consume/report` 仍缺真实 Desktop consumer。Runtime `ingestSubtaskFeedback` 先验证原 dispatch
Evidence 与 child revision，保存原 report 和 feedback event；没有 controller 时返回 pending/unavailable。
原 `reconcileControllerReport(eventId,context)` 只 `readReceipt`，不重新发送不确定 consume。
真实 port 必须返回持久 `receiptRef` 和 `continue/summary/notify_controller/request_controller` action；
仅 progress、测试 helper 或模型口头总结不能充当高级主控接管回执。本包不实现该缺失服务。
