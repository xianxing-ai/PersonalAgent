# F08 原 SMTP 核实入口

Competition 增量，沿已有 `mail.reconcile_send` 与 `prepare/finalizeHostToolTask`，无新队列/任务库/授权。API 由 `createConnectorConversationTools` 返回：

- `readOriginalSendRecoveryAvailable(taskId)`：从 UI 原 root/graph 只读遍历公开 `readSubagentTasks` 和原双向 Host edge，验证原 host intent，只接受唯一持久 SMTP 身份（有界 128 个任务）；不枚举其他用户任务或由 UI 指定 Message-ID。
- `prepareOriginalSendReconciliation({taskId,runId?},{deadline,signal})`：接受原 root/graph 或发送 task，从上述原关系和 invocation/执行/身份 checkpoint 取固定参数，以稳定命令创建一个只读 Host 子任务，返回原 `HostToolTaskReadback`。多个 send 时必须指定 run；原发送仍 active 拒绝。重复只观察该 child，unknown 不重新派发。
- 在原 Main `requestToolAuthorization(scope)` 中先 `await connector.prepareOriginalSendReconciliationAuthorization(scope)`：匹配返回 true，跳过仅 graph 可用的 preflight；无关返回 false；之后均走原问题卡。该方法只准备精确原会话/来源 metadata，不能代替原独立 `mail:read` Policy。
- `readOriginalSendReconciliation({taskId,runId?})` 返回 `state: unavailable | pending | unknown | confirmed`、原 `readback`，confirmed 时含原 task。
- `applyOriginalSendReconciliation({taskId,runId?})` 只在实际原 read child 的 Policy allow + confirmed + exact args/Message-ID/key 回执通过后，写原私密 observation Evidence；未取消且 waiting_reconciliation 的原执行沿 `reconcileToolExecution(...,{deferTaskCompletion:true})` 确认，保留 workflow 后续收口。取消/终态仅留核实证据，任务与执行不重开。没有 Sent 匹配保持 unknown，不推断未发送。

原 child 双向关系、输入/descriptor、配置代次与擦除状态在审批后执行与核实前再次校验。身份/邮箱参数只留本机，返回类别不签发出机权限。没有新增 wire Schema/迁移；Main 需接上述 preflight 和 task reconcile 调用，本提交不改 Main。

prepare 只受理并返回 pending，不等待用户卡或 IMAP。原按钮再次核实调用 read；confirmed 才 apply，pending/unknown 继续保留原任务。无新轮询循环、隐式刷新或派发。核实单次 SMTP 不是整图完成；后续原 graph continuation 仍按现有恢复路径收口。

仅新增一个关键用例：真实 Runtime/SQLite/AuthorizationQuestions/Policy + QQ 类，云/回答/IMAP/SMTP 为明确 Fixture。取消造成原 send unknown 后，批准前 IMAP=0，批准后原 Sent 只读1次，SMTP总1次；重复prepare/read/apply不重发；原cancelRequested状态不改变，配置变化拒绝。Runtime build 与此用例通过；不重跑已过整图或全仓。未登录真实邮箱，无真实账号或云整图验收。
