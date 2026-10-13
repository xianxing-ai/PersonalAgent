# MOD-20：待办与日历

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-009（P0 本地待办和定时提醒）、PA-013（P1 日历同步）
- 当前 GitHub 负责人：`Potatos498`（2026-10-07 三人独立交付重置）
- 自审：模块负责人；可选同行评审：`goo122`，不作为交付前置
- 独占目录：`packages/productivity/`、`packages/connectors/calendar/`
- 历史工作包状态（原记录，不作为新 PR 审批门槛）：review（源码完成，待非作者评审；分支 `feat/mod-20-productivity`）

## 职责

待办条目的 CRUD 与读回；时区正确的时间表达（UTC 瞬间 ↔ 本地墙上时间，DST 边界有明确策略）；从条目生成提醒触发定义（结构兼容 Runtime `ScheduleInput`）；日历事件的窗口增量同步、去重、时区正确规范化与 `respond` 动作。

## 非职责

调度执行与补跑/错过判定（MOD-03）；通知展示（MOD-23 / 桌面端）；Runtime 根装配（`goo122`）；真实日历账号授权（独立后续工作包）。

## 输入、输出与公共入口

- `@personal-agent/productivity`：`TodoService`、`register`（工具 `todo.list` / `todo.create` / `todo.update`）、`ReminderTrigger` 及触发构造/回执映射函数。
- `@personal-agent/calendar`：`register`（工具 `calendar.events`）、`CalendarConnector`（ConnectorPort）、`CalendarProvider` 端口与 Fake 实现。
- 记录形态：日历事件 → `ConnectorItem`（`validFor` 承载起止区间）；待办条目 → 模块自有 JSON（含 revision 状态机）。

## 依赖

- 前置模块：MOD-02（contracts）、MOD-03（Runtime 调度，经结构兼容触发定义）、MOD-05（权限宿主，接线归 goo122）。
- 允许依赖：`@personal-agent/contracts`；测试 `@personal-agent/testkit`。
- 禁止依赖：`apps/*`（ADR-0002）、任何内部 workspace 的私有深层导出、私有持久任务库。

## 权限与数据

- Scope：`todo:read` / `todo:write` / `calendar:read`；`respond` 为外部写，只经 ConnectorPort 由宿主授权链执行（ADR-0003）。
- 副作用：待办写为 local_write（StoragePort 注入）；日历读为 read；`respond` 幂等键防重复。
- 敏感数据：无凭据（Fake 提供商 `authentication: 'none'`）；真实提供商凭据边界待后续工作包定义。

## 验收

- Fake/离线测试：productivity 16 项 + calendar 10 项（DST 回拨取较早含柏林、改期重验、日历搜索跨页）（DST 四边界、CRUD 读回、触发确定性、分页去重、respond 幂等、契约校验），全仓 `npm run check` 退出码 0（含架构门禁）。
- 跨模块集成：待办→Runtime 调度→桌面通知链路未接线（归 goo122 装配工作包）。
- 真实条件验收：PA-013 真实日历连接器授权+读回待独立工作包；manifest 保持 `mock`。

## 排除项与已知限制

`todo.create` 无幂等键通道；存储并发仲裁仅靠 revision 前置校验；Fake `search` 为客户端过滤；`respond` 在真实提供商上的 `pending/unknown` 语义未覆盖。详见两包 README 的「已知限制」。
