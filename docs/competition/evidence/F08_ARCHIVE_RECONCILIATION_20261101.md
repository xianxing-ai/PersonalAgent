# F08 原归档身份与 UIDPLUS 只读核实

目标为 Competition Profile。复用原 MailProvider、Connector Host、Runtime checkpoint/Host task、Policy 与 F08 configured worker，不新增队列、任务库或授权器。MailOperationContext 增加可选 `beforeArchive`、`archiveMoved` 钩子，MailProvider 增加可选 `reconcileArchive`；旧实现保持兼容，但没有原持久身份/UIDPLUS 映射就没有恢复能力。新增 `mail.reconcile_archive` 为只读工具；无 Core wire/数据库迁移，不提高 provisional/conditional 等级。

首次 MOVE 前保存原 task/run、精确参数 digest、账号配置代次、folder/UID/UIDVALIDITY/Message-ID、实际 Archive 目标及期限。异步钩子后再次核对取消、期限与原许可。已有 intent 只返回 unknown，不能再次 MOVE。实际 UIDPLUS 响应同步写入原 checkpoint；响应与取消竞争时仍保留该私密事实，不签发新许可。

只读核实仅接受宿主从原任务关系读出的持久映射，原子任务独立请求 `mail:read` 审批；核对原 source UID 世代与 UID 缺失，以及目标 UID 世代、映射 UID 和 Message-ID 全部一致。源 UID 消失本身不证明归档完成。无 UIDPLUS 响应、账号代次变化、原来源擦除或不同映射不能补造证明。没有再 MOVE/COPY/EXPUNGE；原取消/终态不重开。

Main 使用 `connector.readOriginalArchiveRecoveryAvailable(taskId)` 和 `prepare/read/applyOriginalArchiveReconciliation({taskId}, scope?)`，参数形状与原 SMTP 方法一致，UI 的 root/graph taskId 通过原双向 Host/子任务关系定位唯一原写身份。`prepare` 受理后返回原只读 Host 状态，不等待审批；下一次原核实按钮只读/apply 同一 child，不新建轮询或重复派发。`prepareOriginalSendReconciliationAuthorization(scope)` 兼容处理两类原核实，匹配返回 true、无关返回 false。Main 工具名单须保留 `mail.reconcile_archive`，该工具不作为普通云候选公开。

当 apply 返回 confirmed，且原写未取消、仍属 F08 business source 时，沿既有 `composition.reconcileOriginalMailWorkflow({taskId: applied.task.taskId,deadline,signal})` 完成原已核实单 Host，重新经过原业务结果 prepare/project/final accepts，恢复原 N03 receipt，调用原 `resumeTask` 续行 configured worker。不会直接将 root 标成功；后续发送仍有独立决定与 Policy。

最小检查：Mail、Runtime 构建通过；只运行 `interrupted UIDPLUS archive` 一项，实际 QQ 协议实现、Runtime/SQLite/Policy、业务出口与 Engine，模拟 UIDPLUS 后传输中断，通过新 provider 实例读取持久原映射，原 N03/图最终 succeeded，MOVE=1、SMTP=1，出现独立 `mail.reconcile_archive` 审批。IMAP 传输、SMTP、云、selector 和审批响应为明确 Fixture；未读取真实凭据或发送邮件，未宣称真实邮箱/AgentArts 整图验收。缺少服务端 UIDPLUS 映射的崩溃继续 unknown。

Desktop 已将归档与发送接到同一原任务核实按钮；原 `mail.reconcile_archive` 必须展示独立邮箱读取问题卡，确认后沿上述原 N03 恢复入口继续。Main 语法检查与新增归档按钮检查 1/1 通过；只读子任务仅创建一次，pending 不继续、confirmed 才应用原结果，不新增邮件写入。
