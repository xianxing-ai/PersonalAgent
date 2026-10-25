# 待办、提醒与桌面通知接线

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。zemeng 负责 Desktop / Runtime 必要组合；不改 Potatos498 的 productivity / notifications 实现。

## 2026-10-25 多轮取消提醒修缮

本工作包由 Codex 在 `codex/fix-reminder-conversation-continuity` 完成 Desktop 调用方接线、工程检查和证据记录；模块业务实现保持原入口。状态 `review`，提交、PR 和集成状态以对应 Git / PR 记录为准。

每次 Competition 交换的既有 `readRequestContext` 携带对象承接规则：从当前会话可读原文延续唯一编号及原动作，用户更正覆盖被更正的部分；缺项或多个合理候选才澄清。被省略的助手原文沿原 `conversation.read_history` 取回。文字“确认”不是授权回执，原任务仍等待审批时使用原卡，不新建重复删除；已完成、取消或 unknown 的操作不盲重放。

提醒动作的语义通过原宿主环境引导发送。目录的 `safeSchema` 会删除说明文字，因此不依赖修改 Schema 描述，也不放宽该裁剪。整个待办取消使用真实条目 `id` 与 `status=cancelled`；只取消提醒使用 `clearReminder=true` 并保留待办。列表序号、标题和 `scheduleId` 不能代替条目 ID。取消保留历史记录，不宣称已经永久删除。

授权卡显示本次条目编号及具体动作，区分取消待办、清除提醒和完成待办。复用原 TaskRuntime / Policy / ToolGateway / 提醒调度及出机许可；无新 wire、Schema、数据库迁移、依赖或独立会话状态库。引导只包含静态规则，不枚举私人待办，也不继承旧任务授权。

`test/reminder-conversation-continuity.test.mjs` 使用显式 Fake 模型端口和真实本机 Runtime / Policy / ToolGateway / SQLite / 待办与调度实现，覆盖同名两个提醒、原编号跨轮确认、更正编号、仅清除提醒、审批前零执行和非目标提醒保留。它证明上下文与动作数据经过真实消费路径，**不证明真实模型已经正确理解这些指代**。工程检查日志位于 `.cache/reminder-check/`；当前运行桌面未重启，AgentArts 模型效果和真实用户对话仍为 `not_run`，需在加载本分支的桌面上复测。本次不涉及镜像或工作流变更，不发起云部署或付费模型调用。

本次工程结果（Node 24.15.0 / npm 11.12.0）：根 `npm run build`、Desktop `typecheck`、29 项上下文/待办/调度定向测试、17 项原授权宿主/卡片测试、3 项架构门禁及 `git diff --check` 全部通过。对应日志为 `build.log`、`desktop-typecheck.log`、`focused-tests.log`、`authorization-tests.log`、`architecture.log`。未跑全仓 `npm run check`；本次生产改动限 Desktop 的静态每轮引导和授权摘要，按受影响路径验证，未改 Runtime、业务模块、桥接或窗口实现。

## 产品入口

设置 → 连接 → 待办与提醒，明确允许本次会话的待办云端管理后，正式目录公布 `todo.list/create/update` 与 `notifications.status`。主对话的每次工具调用仍经过 Runtime / Policy / ToolGateway；云端结果在发送前检查任务绑定与撤销。云许可关闭不删除用户此前建立的本机提醒。

待办、通知策略、提醒投递回执使用 Electron safeStorage 加密和原子写入。调度沿用 Runtime SQLite：先从已落盘业务状态同步完整提醒集合，再处理本来源到期项。改期取消旧 schedule；完成、取消或清除提醒后不再投递 pending 项。已 fired 的提醒是既有任务，不伪装为可撤回的写操作。重启按 `run_once/skip` 恢复，不触发其他提供者的 schedule。

新增受信 `createReminderDeliveryHost` 只把本机提醒任务送入幂等通知队列，由 Runtime 管理任务终态；不调用模型，也不执行外部工具。成功表示通知已持久入队，不表示用户已读。进程中断后仅在存在持久回执时确认未知任务；没有回执保留待核实，不盲重放。Renderer 不运行执行循环。

NotificationService 的暂停、安静期和聚合规则保持原实现；当前设置页提供暂停时间，待办列表、通知及已读操作。提醒在设置页和工作区通知栏持久显示，同时尝试原生系统提示；系统可能屏蔽提示，不将 `show()` 当作显示成功。提示尝试先落盘以避免重启重复弹出；失败仍保留应用内通知。应用未运行时不唤醒进程；下次启动按原提醒策略恢复。

## 接口与检查

- `dispatchDueSchedules/recoverMissedSchedules` 增加可选 conversationId，兼容原无参数调用；避免一个宿主消费其他来源的提醒。
- 复用现有 workspace 依赖 productivity、notifications；锁文件仅登记这两个 Desktop 依赖。不增加外部库或迁移（依赖提醒协调 migration 8 / #197）。
- Runtime / productivity / notifications 构建通过；Desktop 核心 3 项和 Runtime 原协调 3 项通过，覆盖真实 SQLite / Policy / ToolGateway 下创建改期、取消、重启、skip、暂停与来源隔离。加密使用测试适配器，云端未调用。
- 架构门禁 3/3，JavaScript 语法、差异检查通过。当前命令环境 Node 26.3.0，仓库指定 Node 24.15.x，仍需 CI 标准版本核验。
- 新设置组件已在内置浏览器实际渲染检查。尚未重载正在使用的 Electron、操作真实 AgentArts 或验证系统 toast 显示，不据此标记产品链路完成。

邮件分类原有安全存储改为消费共用原子 StoragePort，保留 `mail-classification.json` 文件名和 version 1 格式，原记录无需迁移。
