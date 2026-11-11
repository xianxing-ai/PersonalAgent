# F08 显式邮件方案与原操作读回接线

目标 profile：`huawei_ict_agentarts`；工作树 `.worktrees/pr531-business`。新增 `workflow.business.f08`，配置 `business-20261031-v1`，复用原 configured worker、真实 mail.archive/mail.send/mail.reconcile_send/knowledge.search 工具、原 child bridge、AuthorizationQuestions/Policy 和各业务结果出口。没有第二执行器、授权层、邮箱缓存或调度器。

## 公共行为与兼容

请求绑定同一显式邮箱的完整 inbox 窗口（100 条上限，hasMore 必须 false）、原 UID/UIDVALIDITY/Message-ID 归档身份、显式收件人/主题/正文、原知识查询及 source/revision 列表。N02 的归档选择、N04 的执行模型候选、N05 的回复审查必须等于原方案。N09 使用实际公开知识工具；候选内容只提供数据，不是写入授权。

N10 现在证明 `planReady:true,requiresDecision:false`，含义是来源和完整显式参数已准备好进入原 Policy。它不声称未来 SMTP 已批准。新增 provisional `createRuntimeF08PreparedPlanHosts`，对应 N10 `mail.prepared_plan_check` 与 N06/N07/N12/N13 本机 guards；N06/N07 条件文字同步澄清，保留缺决定时的 F02 补问需求。旧 OperationScope factory 保留兼容，生产 worker 只使用新绑定工厂。模板源经原 generator 更新；模板/configuration digest 不兼容时拒绝旧图恢复。

N03 和 N07 各自创建原 archive/send child，分别经过真实工具审批与结果出口。SMTP/归档 domain actionId 必须绑定原 child.runId；发送 Message-ID、原 run/idempotencyKey 与回执持久绑定，不从模型自报生成。N11 读取同一发送；N12 接受新增的 `{messageId,idempotencyKey}` 原身份，旧 `{sendOperationId}` 输入兼容保留，不能混用。仍未知时明确 RESULT_UNKNOWN，不发送第二次。

N10、N07 写入调用前和 N07 原回执出口分别通过独立原工具读取 inbox / 知识 source revision；N13 同样由原受限 child 读取当前完整 inbox。归档已经确认的唯一原邮件可从后续窗口消失，其余原来源或 epoch 变化拒绝成功出口，保留已经发生的效果。缺决定时拒绝发送，检测到版本变化时保留原效果并等待真正 F03 接线；不会凭云端“没有变化”跳过本机 guard。

这些是有实际执行时刻的读回，不是跨 IMAP、SMTP、知识源和审批等待的分布式事务锁。SMTP 始终按用户原工具卡批准的精确显式参数执行；后验来源变化不回滚已发邮件，也不伪报成功。无 Core wire、数据库迁移或依赖变更。

## 集成与证据边界

Main 需向 businessTools 和 competitionToolExports 注入已注册 knowledge.search 及其原出口，并将 mail、知识源与用户绑定纳入真实 availability。所有 mailbox 凭据仍由原受信 connector 注入。没有账号、知识源或对应出口时保持 unavailable。根提交 `f51ec465` 的 MAIL_TOOLS 白名单一行及原工具列表断言在此树原样复用；根 `01ad0980` 的 waiting_approval preflight 与 confirmed 结果出口本树已有。Main 需优先本工厂 N10，避免旧孤立 N10 同名工具覆盖实际绑定工厂。

实际 Engine、Runtime、SQLite、原 connector、公开业务工具、原问题卡、Policy、HostBridge 和业务结果出口已进行本地组合验证。邮件 Provider（含 SMTP/归档/发件读回）、知识 Provider 与知识内容出口、候选/selector、云传输及外层出机许可是显式 Fixture；未访问任何真实邮箱或真实收件人，不将此称为真实 SMTP/IMAP/华为 AgentArts 验收。

未完成或未验：缺决定时的真实 F02 来源、实际 F03 版本修订接收方、跨未来核实的真实后台读回恢复、真实账号 MOVE/SMTP/发件箱、真实知识源与云出机组合、真实模型/云整图及评测。附件发送不在当前公开 mail.send Schema 中，不伪造附件能力；超过完整单窗口的邮箱保留 unavailable。此增量不表示 F08 全完成或 #531 可合并。

最终受影响验证：F08 实际图 **12/12**，连同 F06/F07/F11/F12 与工厂回归 **52/52**；AgentArts **242/242**；AgentArts/Runtime 构建、原模板生成检查、架构门禁 **3/3** 和 diff 检查通过。原邮件端口、真实 Gateway 业务测试、optional hosts 与 connector 组合 **86/87** 在普通沙箱通过，唯一 CalDAV 本机 HTTP 夹具被环境阻止；独立最小 fetch 复现 `connect EACCES 127.0.0.1`，授权环境中同一夹具 **1/1** 通过，没有修改断言或产品代码来消除该环境失败。

日志保留在 `.cache/pr531-business/f08-final-business.log`、`f08-ports-regression.log`、`f08-caldav-authorized.log`、`f08-agentarts.log`、`f08-architecture.log`。根集成分支承担最终全仓 check。

## Main 集成（2026-11-01）

在 `bb767770` 接回原 Main，业务工厂现在同时消费原 connector/mail 工具和
`knowledgeTools.tools/competitionToolExports`，所有具体工具仍走原绑定和内容出机卡。
availability 读取原 `mailConfig.reviewConfigurationRef` 和知识源 snapshot，要求原已装配邮箱
及明确允许 PUBLIC 出机的当前知识源，绑定用户 namespace、sourceId、configRevision 与原公开查询集；
只保存摘要，不向 Renderer 或模型暴露路径/凭据。缺配置、私有来源、取消与版本变化保持不可用。
原工厂工具名优先过滤旧通用 host，因此 N10/guards 不会被同名孤立工厂覆盖。

根 build 通过；F08 实际图、availability、业务工厂、connector conversation 和工作流目录
定向 **89/89**，日志 `.cache/integration-f08-build.log`、`.cache/integration-f08-main-tests.log`。
该组合仍使用上述明确 Fixture，不提升真实邮箱或云整图验收等级。

2026-11-01 续增量以 [原知识投影接线](F08_KNOWLEDGE_PROJECTION_20261101.md) 替换此首批测试的知识出口 Fixture：现消费实际 `createTrustedKnowledgeTools` 公开/私有与裁剪契约，原 N09 对图只返回允许投影；知识内容和邮箱 Provider 仍为明确 Fixture，真实服务剩余验收边界未因此取消。
