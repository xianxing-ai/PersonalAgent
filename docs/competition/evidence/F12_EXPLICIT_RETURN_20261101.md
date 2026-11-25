# F12 原按钮归来来源与摘要

目标 profile：`huawei_ict_agentarts`。PRD 第 12–15 行与当前设计第 3–4 节要求归来只汇总仍有效变化，不补弹旧通知、不把已读或投递混为归来。现有 Renderer 归来按钮调用受信 panel/admin 的 `proactive.workflow.control`，原 Desktop/Runtime 维护 command、sourceTask、会话、control revision 与签名 advance。窗口 focus、设备 resume、模型提出 return 和裸 `returnDigest()` 均不是本增量的 UI 来源。

新增 `createF12ExplicitReturnSource({getApplication,readPersistedWorkflow})`，其中 reader 为公开 `runtimeModule.readPersistedRuntimeProactiveWorkflow`。它只使用原 Runtime checkpoint 和原已持久状态，不建立调度、任务库或授权层。

- Main 成功完成并校验原按钮 `control` 后，调用 `acceptExplicitReturn({taskId,sessionId,sourceTaskId,commandId,controlRevision})`。方法重新核对原 `return` 命令、已 acknowledged 请求、当前 application/session revision、attended 状态、会话和期限，再用 `saveCheckpointOnce` 在原持续任务写入该 command 的 UI 来源标记。`return` 结果本身没有 `controlRevision` 字段，需读取原 host binding，不能猜测结果结构。
- 返回 `{source,conversationId,taskDeadline,idempotencyKey}`，Main 沿原 `task.submit` 受理 F12 来源，期限不能超过 `taskDeadline`，复用 command 派生的幂等键；unknown 不换键重新提交。标记不代表图或 N05 已获批准。
- 将同一个 source provider 作为 `explicitReturnSource` 注入业务工厂。未注入仍仅公布 event/on_demand 并明确 unavailable；注入才公布 `trigger:'on_return'`，且必须携带精确 `returnSource`，其他 trigger 禁止附带它。配置版本改为 `business-20261101-f12-v3`，旧摘要不复用，无 wire、迁移或新图节点。

F12 在原输入、初始出口许可后、frontier/子宿主/回执和完成出口期间反复只读核验原标记与原 control。原会话不符、任务取消、来源擦除、后续 control 修订或未 acknowledged 的结果均拒绝。原 N05 经独立 Policy 读取 `getDigest({trigger:'on_return'})`，仅选择用户配置 digestMode 匹配、仍有效且未读的原 feed；不 drain、reserve、deliver、ack 或补发通知。模型控制即使已在原 Runtime 确认，没有 Main 显式按钮标记仍不能冒充该来源。

测试使用实际 ProactiveWorkflowEngine、Runtime/SQLite/CAS 产生命令及原已确认状态，再经实际 F12 Engine、AuthorizationQuestions/Policy 消费；图 image 权威、候选内容/选择、云 transport、按钮动作及卡响应仍是 Fixture。首轮 Fixture 只给一个候选被原契约正确拒绝，随后补足原有候选要求；未开启 proactiveWorkflows 的 Fixture 正确 unavailable；初始实现误读结果中的 controlRevision，实际读回显示该字段仅在原 application/session binding，现按真实公开 reader 核对，未放宽 revision 门禁。

已覆盖原显式归来多项摘要及重复只读、缺标记、异会话、取消、擦除、初始/完成出口期间后续 pause、原 N05 子卡拒绝、未知控制结果、resume/enter_unattended 不冒充 return、期限/参数替换及 SQLite 重启读回。F12/业务工厂/专用来源/通知端口回归 50/50，补充 request Schema、期限与重启的定向测试 14/14，原 Proactive Application/Session 与 NotificationApplicationHost 43/43，架构门禁 3/3 通过；日志在 `.cache/pr531-business/f12-return-{final,boundaries,dependencies,architecture}.log`。仅 JS 消费和文档变化，无生成文件；最终全仓 check 由根集成负责。

归来链不发送设备通知，原 feed 保持未读，未预占轮次。根已补原 Main 按钮→Runtime 精确 F12 准入，并通过实际组件及原 Main 回调验证，详见 [可信归来入口](F12_NATIVE_RETURN_ADMISSION_20261101.md)；自然语言 `task.submit` 不能替代精确准入。本机 Fixture 不代表真人操作或 OS presence。百炼 speakText 的 accepted 和通用 Renderer drained 不能充当通知轮次的真实播放完成回执。
