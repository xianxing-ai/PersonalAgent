# MOD-23：通知汇总策略

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-015（P1 统一通知与订阅——安静时段、暂停和频率设置）
- 当前 GitHub 负责人：`Potatos498`（2026-10-07 三人独立交付重置）
- 自审：模块负责人；可选同行评审：`goo122`，不作为交付前置
- 独占目录：`packages/notifications/`
- 历史工作包状态（原记录，不作为新 PR 审批门槛）：review（源码完成，待非作者评审；分支 `feat/mod-23-notifications`）

## 职责

对 `ConnectorItem` 标准事件流按用户规则裁定立即交付/安静持有/暂停持有/聚合摘要；安静时段 DST 安全并支持跨午夜窗口；按 dedupeKey 去重防重复通知。

## 非职责

调度执行（MOD-03）、通知展示（`zemeng`）、策略运行期编辑（桌面端设置）、事件采集（各连接器）。

## 输入、输出与公共入口

- 入口：`NotificationService.ingest/drain/status/planSchedules`；工具 `notifications.status`（只读）。
- 输入：`ConnectorItem[]`＋装配期 `NotificationPolicy`（quietHours/pauseUntilUtc/digest）。
- 输出：`NotificationBatch`（immediate/digest，引用 dedupeKey 不复制内容，附裁定理由）；调度建议为结构兼容 Runtime `ScheduleInput` 的自有类型。

## 依赖

- 前置模块：MOD-02（contracts）、MOD-03（Runtime 调度，经建议接入）。
- 允许依赖：`@personal-agent/contracts`；测试 `@personal-agent/testkit`。
- 禁止依赖：`apps/*`（ADR-0002）、自有调度器、自有持久任务库。

## 权限与数据

- Scope：`notifications:read`（唯一工具只读）。
- 副作用：本地写仅限 StoragePort 的待裁队列与已交付标记。
- 敏感数据：无凭据；事件内容仅暂存待裁，裁定后仅保留 dedupeKey 引用。

## 验收

- Fake/离线测试：12 项（安静窗口判定与 DST、暂停恢复、聚合窗口/上限/来源、去重、调度建议结构兼容与确定性、工具 schema/scope）。
- 跨模块集成：与 feeds（PR #8）/calendar（PR #22）事件流的接线归 `goo122` 装配；摘要展示归桌面端。
- 真实条件验收：本包为纯本地决策层，无外部端点；「真实」验收即宿主在真实调度点驱动 drain 的端到端行为，归装配工作包。

## 排除项与已知限制

聚合窗口相位由首事件到达时刻决定；安静结束建议按分钟粒度；暂停恢复被动察觉；已交付标记无 TTL（宿主清理）。详见包 README。
