# F08 SMTP 发送前原身份：兼容方案与证据

Competition profile，独立业务工作树。本增量只交付原身份持久化与只读入口。

## 行为与兼容

`MailOperationContext` 增加可选受信 `beforeSend({idempotencyKey,messageId})` 与同步 `assertCurrent()`。QQ provider 复制输入，以原算法生成 Message-ID；先等待宿主持久化，再同步检查原来源、参数许可、deadline、cancel，最后才能调用 SMTP。原 intent 已存在，即使上次可能尚未进入 SMTP，也只返回 unknown，不猜测或重发。钩子失败不调用 SMTP；钩子之后失效但已落盘的 intent 仍保留，不能以失败抹除未知效果。

Desktop 原连接器执行 scope 将 task/run、原参数摘要、descriptor、账号引用、配置代次摘要与稳定 Message-ID 原子写入原 TaskRuntime checkpoint。新 Runtime 公共 `prepareOriginalMailSendIdentity` 只接受原 running / started / Policy allow 的精确输入与 scope；`readOriginalMailSendIdentity` 只读原记录，允许取消后的审计读取，但拒绝来源擦除/替换/配置变化。无新表、调度、任务或授权。该 checkpoint 为本机私密恢复资料，不进入 graph/model/UI 或公开 Evidence。

这是可选上下文扩展，不改现有 wire Schema、旧无钩子调用或 descriptor 的 `recoverySupport:false`。QQ 明示 `sendIdentitySupport:'before-send-v1'`，Desktop 对声明后未调用钩子的实现拒绝成功；旧 provider 未调用钩子没有身份记录，读回为 unavailable，不能标成已具备恢复能力。读取原身份不签发 IMAP 权限，也不修改任务终态。正式 `mail.reconcile_send` + 原 Runtime 核实入口留下一独立增量；原用户取消不重开。归档跨重启另包。

## 验证边界

本包只用公开合成地址、实际 QQ 类与 Fake SMTP transport、真实 Runtime/SQLite/Policy。没有真实凭据、网络连接、SMTP 收件人或真实账号验收；Fixture 不代替 AgentArts 整图。子进程退出证据只记录合成身份，生产 Message-ID 不出机。

Mail、Runtime 构建通过。首次定向检查 18 项通过，2 项为测试清理早于 worker/SQLite 关闭及错误假定重启自动将 started 改为 unknown；修正夹具后只重跑这两项，2/2 通过。真实子进程在第一次 `sendMail` 中 `process.exit(77)`，重开 SQLite 后原 started 执行和已提交 Message-ID 仍可读，SMTP/云调用均 0；不会把 started 自报成已核实。取消路径原 execution=unknown、cancelRequested=true，重开后状态保持不变。provider 钩子抛错、取消、过期、来源变化、既有 intent 均 SMTP=0；参数跨 await 不被替换。声明支持却跳过钩子的 provider 被拒绝，旧 provider 无 identity。

Main 无新增必接项：现有 `createConnectorConversationTools` 内部完成发送前写入；新增 Main-only `readOriginalSendIdentity({taskId,runId,toolVersion,arguments,scopeRef})` 只用于后续原核实，不传给 Renderer/模型。正式核实尚未接入，本包没有扩大恢复或任务状态语义。按用户最新最小测试要求不重跑整仓/整图。
