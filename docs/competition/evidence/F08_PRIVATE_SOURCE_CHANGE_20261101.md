# F08 原邮箱变化与私密 Fact 来源增量

Competition Profile，接口 provisional。此包复用原 Runtime/SQLite、Memory/feed/FactProjection、原 F08 child Policy；不新增任务库、调度器、模型入口或授权系统，无数据库/Core wire 迁移。后续 Competition GoalReview/F03 原 image 适配继续单独实现；本包不宣称 N13/F03 或真实邮箱/云整图完成。

`readOriginalF08MailSource` 从原 configured binding 的已确认 N01、精确 inbox 参数和业务配置代次读取完整私密快照。`recordOriginalF08MailChange` 只消费 N10/N07/N13 固定动作的真实 business child 读回，核对 graph/session/host/tool/args/Policy/结果和已确认 archive/send effects。去掉 fetchedAt 后比较；原已确认归档的 UID 消失被扣除，不误当外部变化。不同账号/文件夹或截断读回拒绝。原变化、原回执及 effects 在 Runtime create-once checkpoint 保留；重复验证不追加、未知写不重放。

`createCompetitionMailSourceChanges` 在固定 private feed/query 上组合既有 Memory 投影。`rememberSource` 需要独立原明确确认，精确 source、summary、期限与 operationId 绑定，调用原 `createUserFact`；Runtime 只存确认摘要，不复制新增私人事实正文。`recordChange` 仅匹配原用户已选 Plan 的传递 Fact/投影版本与精确 mail sourceRef。无原 Plan/映射则 requires_review，不挑计划、不改任意事实；匹配后沿 `invalidateUserFactSource` CAS 撤销失效来源，保留原 user_confirmed 文本/历史，原 feed 投影与 impact 读回才可供下一段审查。已写入但回调未知时核对原修订内容，不能重新生成事件或改写摘要。批次未覆盖目标 Fact 时明确 projection_pending。

Main 入口为 `createF08SourceChangeHost({getApplication,memoryPath:dataPaths.privateMemory,graphNamespace,assertCurrent,confirmSource,confirmWithdraw,confirmErase})`，可在 Runtime 初始化前创建，执行时才取实际 Application。使用同一既有 Memory SQLite 文件中的固定 `${graphNamespace}:competition-mail-private`，不绑定原 `desktop-private`（原 Vault 未绑定擦除契约保留）、不借 publicMemory。将对象注入 `createBusinessWorkflowWorkerPorts({f08SourceChanges})`。`readSource/rememberSource/recordChange` 的 scope 为 `{parentTaskId,sessionId,deadline,signal}`；独立撤销/删除为 `{factId,expectedRevision,operationId,deadline,signal}`。确认回调必须接原真实意图/审批卡，不能恒 true。

私密源提供 `listSources/withdrawSource/eraseSource`，删除复用原 Memory erasure intent、Runtime projection preflight/CAS、WAL 和 history 读回，覆盖原事实及绑定图。原独立邮箱工具历史不是由此 Fact 新建的副本，不能声称一并删除邮件账号/历史。旧 Vault 全清除、备份或恢复入口必须调用 `assertLegacyPrivacyCoverage`：此 namespace 有事实或删除标记时明确拒绝旧覆盖声明，避免遗漏邮件源或从未过滤备份复活。Main 原用户来源管理/备份边界须实际消费该门禁；此增量未编辑 Main/UI。

最小检查：Runtime build；只新增一项实际 Engine/Runtime/Policy/Memory/SQLite 用例。原 UID 世代真实格式变化→重复检查读同一 checkpoint→归档一次、SMTP 零次→未选 Plan 保持 requires_review、原 private Fact 不变；public feed 为空且私密事实正文未进入云 fixture；精确原 Fact 删除后 Memory 历史与绑定 Runtime 图均无原正文，旧备份覆盖声明继续拒绝。邮箱传输、云、selector 和确认响应为明确 Fixture。未运行真实邮箱/AgentArts、未重跑旧矩阵；匹配 Plan 的正向失效到 Competition review/CAS 路径随下一增量验证。
