# F08 已核实 SMTP 的原宿主与工作流续行

`createBusinessWorkflowWorkerPorts` 新返回 `reconcileOriginalMailWorkflow({taskId,deadline,signal})`，taskId 是 `connector.applyOriginalSendReconciliation` 返回的原发送 task，不来自 UI 自填。Main 仅在 SMTP readback confirmed、原任务未取消且属于 F08 business source 时调用。

沿现有 Runtime `reconcileTask` 完成已经核实的单工具 Host；使用公开 `readWorkflowBusinessToolSource` 复核原 graph→N07 host→mail.send 双向身份、descriptor、参数、Policy 和回执；经过现有业务结果 prepare/project/final-accepts 出口，恢复原 F08 私密 receipt checkpoint，再以原 observation Evidence 调用 `reconcileToolExecution` 确认原 N07。最后 `application.resumeTask` 回到既有 configured worker 的 `resumeOwnedWorkflowTask`，仍检查原期限、配置、来源、graph 出口和后续 completion。没有重新调用发送工具、没有直接标 root 成功。取消、来源变化、期限失效拒绝续行。

实际恢复用例还发现 MailService 在核实前重 await 原 rejected send Promise，导致永远无法进入 Sent 查询；修复为保留原稳定 provider identity 核验，原 Promise 拒绝不阻断独立只读核实，缺 provider identity 仍拒绝。

Mail 构建通过；只运行新增 `interrupted SMTP resumes` 一项：实际 Engine/Runtime/SQLite/原 Policy/出口消费，SMTP 抛错后原 readback 另批，原 N07 和 configured graph 最终 succeeded，SMTP=1、archive=1，原 cloud continuation 收到 sendConfirmed。云、邮箱、selector、审批回应仍为明确 Fixture，非真实账号/AgentArts 整图验收。不重复整组测试。

Main 已接原任务核实按钮、原 mailbox 读取授权和 `reconcileOriginalMailWorkflow`；首次只创建一条核实子任务，后续点击读取同一结果，确认后继续原 F08。新增按钮续行定向检查 1/1；没有发送重试循环。
