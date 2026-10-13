# 待办、提醒与桌面通知接线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。zemeng 负责 Desktop / Runtime 必要组合；不改 Potatos498 的 productivity / notifications 实现。

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
