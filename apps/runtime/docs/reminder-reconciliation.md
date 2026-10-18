# 受信提醒来源与 Runtime 调度同步

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧审批人数与本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：huawei_ict_agentarts。此公共依赖为 MOD-20 / Desktop 的待办改期、完成和取消接线服务；业务待办仍由 Potatos498 的 productivity 实现。属于用户已授权的必要公共接口补齐，评审及集成由 goo122 协调。

## API 与调用顺序

`TaskRuntime.reconcileSchedules(conversationId, desired)` 接收**单一受信提供者独占的提醒 conversation** 的完整期望集合；不能传普通聊天 conversation 或多个生产者共享的集合。它在同一 SQLite 事务里：

- 创建不存在的提醒。
- 更新尚未触发提醒的标题、时间、时区与恢复策略；同一 scheduleId 的 conversation 和 taskIdempotencyKey 不可替换。
- 将不再需要的 pending 提醒标记 cancelled，保留历史身份。
- 允许受信来源明确重新加入从未触发过的 cancelled 提醒。
- 保持 fired / skipped 的内容与 taskId 不变，永不重新触发；取消提醒不撤销已创建的任务或已送达的通知。

`listSchedules(conversationId)` 用于来源读回与恢复，不公布新的 Client wire capability。原有 create/get/dispatch/recover 保留；createSchedule 仍不允许用相同 ID 改参数。Scope 与审批仍由调用方的原有工具授权路径负责，本 API 本身不授予权限。

宿主应使用现有 productivity reminderTriggers 生成集合，先完成经过 Policy 的业务变更，随后同步调度集合，再调用 dispatch/recover。重启必须先从持久业务状态重建并同步集合，再补跑；若存储或同步失败，暂停该宿主的提醒调度，不能继续投递过时集合。若业务落盘后进程中断，此顺序能在重启时取消过时提醒。不要另写计时器、任务库或触发规则解析器。

调度到期扫描会在写事务内再次检查 pending，避免其他数据库连接在扫描后撤销或触发时重复投递。通知成功仍需由通知提供者另行确认；`fired` 只表示 Runtime 已创建任务。

## 迁移与回退

新增 migration 8，扩展 task_schedules 的状态约束；在迁移事务中复制全部旧行、保留 task 外键并重建索引。migration 1～7 的 SQL/checksum 不变。部署前按现有数据库备份流程保留旧文件；旧版本不能打开 migration 8 数据库，回退需恢复部署前备份，不能直接删迁移记录或清库。

## 验证边界

定向检查覆盖改标题、改期、取消、重新加入未触发条目、重启后的不重复投递、跨来源冲突的事务回滚，以及 migration 7 → 8 的历史数据和外键保留。只验证本机 SQLite 调度语义，不等于 Desktop 提醒、OS 通知或 AgentArts 工具链已验收。Desktop 完整消费与真实通知属于后续接线工作。
