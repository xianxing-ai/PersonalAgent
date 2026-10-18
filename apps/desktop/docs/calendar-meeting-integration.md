# P8 日历旧条目与会议事实绑定

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。共享装配由 P8 负责；P1 连接器和 P5 投影源保持各自所有权。接口为 `provisional`，没有新增 wire operation、Schema 或迁移。

`calendar-meeting-host.js` 消费现有 Runtime HostTool 任务和 coordination graph。旧条目、配置绑定与 Evidence 引用保存在原 Runtime 数据库的 checkpoint，不新建日历基线或事实存储。

## 已实现

- `read({externalId})` 先 `prepareHostToolTask`，create-only 冻结配置身份与 UID，再 `finalizeHostToolTask` 进入原审批路径。保存配置本身不授予 `calendar:read`。
- `bindMeeting({taskId,meetingFactId})` 只接受该宿主创建的读取任务；要求 `succeeded`、`confirmed`、同配置与相同 UID 的公共 `ConnectorItem`。Renderer 不能提供旧条目、sourceRef、凭据或 Evidence。
- CalDAV 的固定 `calendarId=caldav`、sequence、UTC 区间、发生时间与获取时间均检查。旧会议必须 `[confirmed]`。
- Fact 必须已经存在、有效且为相同内容/来源/sourceRevision；绑定不创建或修改 Fact。来源标识为 `calendarMeetingSourceRef(accountRef,externalId)`，仅保存在可信本地路径。
- 绑定 checkpoint 为 create-only；恢复重新核对原确认回执、当前配置与 Fact revision。配置轮换、撤销、事实撤回或更新会拒绝旧绑定。
- `refreshMeeting({baselineTaskId,currentTaskId},refresh)` 串行提供同会议的两份独立已确认回执给 P5 `refreshCalendarMeeting`；`calendarReadPort` 不直接调用连接器或再读取网络。
- main 新日历 IPC 仅限正式 Competition admin 窗口；审批校验该任务的 approvalId/revision，取消只接受本宿主任务。撤销配置先取消在途任务并撤销原 runId 授权。

## 单条工具交付后挂载

构造 `createDesktopCalendarMeetingHost` 时，由可信 composition 注入公开 `RegisteredTool` 为 `readTool`，以及 `readArguments(configBinding,externalId)`。工具必须 `sideEffect=read`、`requiredScopes=['calendar:read']`、无需 presence；直接结果必须为公共 `ConnectorItem`。该回调是宿主内部适配，不是新公共 DTO。

1. factory 在执行时核对完整当前 binding，并经 `calendarConfig.readAuthorization(binding)` 取得凭据；不得从 Renderer 获取凭据或自动恢复旧授权。
2. 将 `host.tools` 注册到既有 Runtime Application；不放入 automaticTools 或云端结果出口。deadline/cancel 必须传入实际 fetch。
3. bindApplication 后将 `calendarReadPort` 注入 P5 已有 composition。IPC 的 refresh 消费 P5 的既有投影接口，不签发 CAS 授权。
4. 真正具备工具后才补用户读取/审批入口和运行验证。尚未交付的 Fact 初次投影与目标依赖绑定仍不可用，不能用生成 Fact ID 或直接 appendBatch 替代。

当前 main 已注入 Runtime 公开 `createCalendarEventReadTool`，注册 `calendar.read_event` 版本 `0.1.0-alpha.1`，scope `calendar:read`。参数仅 `configurationId`（当前加密配置身份 SHA256）与 `externalId`；结果为现有公共 `ConnectorItem`。Runtime 在 Policy 后使用 P1 的公开 CalDAV/CalendarService，逐次读取受信凭据，网络信号合并父取消/截止，读取前后复验配置。不会把该工具加入自动授权或云端结果出口。

配置页面现在提供单条 UID 读取、逐次审批、取消和本地结果展示。恢复仅选择同配置的现有任务；原审批已明确 allowed 时才通过现有 resumeHostToolTask 恢复，unknown 不重做。缺配置或未提供 factory 的独立消费者保持 unavailable。

Runtime 新增同版本 workspace 依赖 `@personal-agent/calendar`，没有外部依赖成本；lock 由 npm package-lock-only 离线生成，仅新增这一项。PATH 为 Node 26.3/npm 11.16，与仓库 24.15/11.12 不一致，未据此声称目标版本验证完成。

## 本轮验证

`node --test apps/desktop/test/calendar-meeting-host.test.mjs`：4 个显式 Fake 端口检查通过，覆盖无工具零任务、审批前冻结、未确认/异源拒绝、旧 Fact 必须匹配、create-only 恢复、配置轮换、未知执行、绑定双回执与事实撤回。无 graph 写入、网络、模型、桌面或迁移验证。

`node --check`：main 与新宿主通过；`git diff --check` 通过。没有运行全仓 check 或整体 Smoke。

Runtime 工厂定向检查 `apps/runtime/test/calendar-read.test.mjs`：4/4 通过，覆盖 cancelled 单条读回、异配置/预取消/过期零调用、撤销和晚结果隔离、凭据等待截止与 NOT_FOUND。首次 Runtime 编译因旧 agents dist 中的 authorizationRefFor 类型失败；重新构建当前 agents 后，Runtime 单包编译通过，没有修改生产接口来避开错误。

`apps/desktop/test/calendar-read-approval.test.mjs`：1/1 通过，使用真实 Runtime/SQLite/Policy/ToolGateway 与显式 Fake CalDAV fetch。审批前零请求，allow_once 后恰好一次请求，任务 succeeded，执行记录 confirmed，包含正确 runId 与 Policy 回执。架构依赖门禁通过。以上没有真实网络、账号或模型调用。

共享通知接线在停止遥测的首个 await 前调用 host.stop；恢复订阅前核实已有 terminal 通知回执并刷新反馈，unknown 不重发。真实账号、完整会议初始 Fact 投影/目标依赖、前端新读取控件渲染、真实系统通知及整体验收未完成。
