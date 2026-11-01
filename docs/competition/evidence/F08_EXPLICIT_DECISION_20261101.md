# F08 完整原草稿的明确决定接线方案

只接完整原 send / knowledgeSources 草稿缺 adopt/decline 决定的分支，不猜收件人或正文。N10 从原 N05 候选读回 requiresDecision，N06 在原任务等同会话显式回答；accept 只令 N07 进入独立原 mail.send Policy，decline 跳过发送及其读回，保留原已确认归档。既有节点数量不变，原 N11/N12 由原引擎跳过未选择的发送分支。结果明确 sendConfirmed=false / decision=declined，不伪称发送或撤销归档。

共享 helper 只收敛原 TaskRuntime 绑定、deadline、单次回答和 revision 检查；F11 地点/方案、F08 草稿三种字段固定，不能注入任意图/节点/参数。F11 旧文件导出兼容，公开 F08 createF08DecisionQuestionHost / f08DecisionQuestion，view 字段 mail.decision、完整 draft 和 references；答复仍为固定 accept/decline。F02 的 approval 语义不变，真实语音仍独立缺项。

新配置摘要拒绝旧图复用；原完整显式输入兼容。无新授权、调度、任务库或数据库迁移。测试只使用明确邮箱/资料/云/文字事件 Fixture，不访问真实邮箱，不以文字接线完成语音或真实整图验收。

## Main 与公开兼容接口

- 从 `apps/desktop/electron/business-workflow-question-host.js` 导入 `createF08DecisionQuestionHost({getApplication,onUpdate,now})`，注入 `createBusinessWorkflowWorkerPorts({f08DecisionQuestion})`。
- `readQuestion({taskId,conversationId})` 沿原 root/graph/N06 关系发现。view 含原 `taskId,graphTaskId,sourceTaskId,questionId,revision,state,conversationId,deadline`，固定 `field:'mail.decision'`、完整原 `draft`（send 对象）、`references`（knowledgeSources），以及 `choices` 的 `accept/decline`。原归档仍单独按真实 child 结果核实；不能把展示草稿称为邮箱草稿写入。
- Main 受信原对话事件调用 `submitReply({taskId,questionId,expectedRevision,sourceTaskId,commandId,decision},{conversationId})`。消息身份来自真实 UI 事件，字段 `decision` 只有 `accept/decline`；`allow_once` 无效。sourceTaskId 仅是绑定的原用户任务，不声称原任务内容已含新答复。问题 pending revision=1，原子单次答复后 view revision=2，精确重试只读。
- 新公开 Runtime `createRuntimeF08DecisionQuestionHost` 只输出 `{decision}`，本地 proof 不进图。`createRuntimeF08PreparedPlanHosts.verifyPreparedPlan` 兼容旧 boolean；新增 `{requiresDecision:boolean}` 明确 N10 实际分支，旧 `true` 等价无缺决定。错误结构和 false 拒绝。
- F08 配置 `business-20261101-f08-v3`。旧成功 completion `{archiveConfirmed:true,sendConfirmed:true,messageId}` 保留；新增拒绝分支 `{archiveConfirmed:true,sendConfirmed:false,decision:'declined'}`，没有发送 messageId。N07 原 guard skipped 后，N11/N12 由原引擎依赖跳过；宿主完成检查还核对原拒绝回执、原归档、无发送/发送读回、原 N13 未发现变更。

## 验收边界

真实 OwnedWorkflowEngine、Runtime、SQLite、原业务 child bridge、原 connector/knowledge export policy、AuthorizationQuestions/Policy 参与；邮箱 provider、知识源、候选/云、审批响应与文字事件均为显式 Fixture。最后执行前门通过原 bridge.assertCurrent 重读原问题/答复/方案及原业务配置，撤销、擦除、替换或配置变化禁止 SMTP；答复后来源读取发现 inbox/知识 revision 变化也拒绝发送。这里不声称 SMTP 与外部 IMAP/知识服务存在跨服务原子事务。

unknown 后 SQLite reopen 仅证明原答复和结果身份持久化且不再次发送，不证明任意中断点自动续跑。待 F02 真实语音来源与声学证据、任意缺收件人/正文等字段、真实邮箱/AgentArts 整图、N13 实际 F03 变更来源仍分别保留，不由本次文字路径代替。

## 本地验证

- AgentArts 与 Runtime workspace build、`npm run check:workflows --workspace=@personal-agent/agentarts` 通过，架构 3/3，diff whitespace 检查通过。
- `node --test --test-concurrency=1 apps/desktop/test/business-workflow-f08-runtime.test.mjs apps/desktop/test/f08-mail-workflow-ports.test.mjs apps/desktop/test/business-workflow-worker-ports.test.mjs apps/runtime/test/workflow-f08-mail-business.test.mjs packages/agentarts/test/owned-workflow.test.mjs`：61/61 通过。
- 其中新增 12 项实际图场景覆盖采用/拒绝、独立发送卡拒绝、等答复取消/撤销、等发送卡撤销/来源擦除/配置变化/替换答案、答复后邮件或知识版本变化、unknown 后 SQLite 只读恢复。SMTP 计数在拒绝/变化场景为 0，unknown 场景始终为 1，原归档为 1。
- `node --test --test-name-pattern='original plan|location' apps/desktop/test/business-workflow-f11-runtime.test.mjs`：共用检查的地点与日历决定 17/17 通过。全仓检查留主集成统一执行。
