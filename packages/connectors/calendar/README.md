# @personal-agent/calendar

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-20（Potatos498）。产品流程：F06、F07；逐节点流程见[WORKFLOWS](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

MOD-20 · 日历连接器（PA-013，P1；Fake 提供商先行）。负责人 `Potatos498`，评审者 `goo122`。

## 2026-09-30 云端业务增量（待本地统一验收）

CalDAV 的 time-range REPORT 只发现候选 UID；有候选时追加一次无窗口 REPORT，按精确 UID 确认当前最高 SEQUENCE、再以 LAST-MODIFIED 判定版本，最后过滤窗口与取消。
无窗口确认沿用单 UID 读回的集合查询与选版路径，同轮所有候选共用一次结果；新版移出窗口或取消不会让旧事件重新出现在列表。
确认缺失、修订倒退或同版本内容冲突抛 EXTERNAL_FAILURE，不返回旧快照，也不据此推断取消。没有候选时不做额外查询；两次 REPORT 不构成服务器事务快照。
含 RECURRENCE-ID 的实例当前明确 UNSUPPORTED_CAPABILITY，避免将重复实例当同 UID 的修订。

新增公开 CalendarService.refreshKnownItems(accountRef, previousConnectorItems)，返回现有 ConnectorItem[]：
包括显式取消、改时或内容变化，保存新基线后重复调用不再产出；未知 UID 抛 NOT_FOUND，不能推断撤回。
P5 仍负责语义事件与依赖图投影，本包不创建新公共事件 DTO。
返修夹具实际读取并应用 REPORT time-range 请求体，覆盖窗内旧 UID/新版同 UID 移窗外、确认缺失/倒退/冲突及取消/deadline。
本轮只做源码检查、JavaScript 语法与差异检查；未构建或运行新增用例，未调用真实 CalDAV。账号未配置时 unavailable，不使用 Fake 生产账号。
统一交接见 [业务接线说明](../mail/docs/cloud-business-handoff.md)。

## 职责

- 把日历事件规范化为公共 `ConnectorItem`：`occurredAt` = 事件开始（UTC 瞬间），`validFor` = `[start, end)` UTC 区间，`contentRef` 携带目标时区的本地墙上时间，`dedupeKey` = `calendar:<calendarId>:<externalId>:<sequence>`（提供商修订后换键）。
- 窗口增量同步（`fetchChanges`，游标 = base64url 编码的窗口+偏移）、搜索、单条读取。
- `respond` 动作（接受/拒绝/暂定邀请）：幂等键决定 `actionId`，重复调用同输入返回一致结果，键冲突换输入抛 `INVALID_ARGUMENT`；`pending/unknown` 不出现——Fake 提供商同步确认。

## 非职责

- 邀请/变更的**授权决定**：由 Runtime → Policy → ToolGateway 链路做出（ADR-0003）；本连接器只执行已授权动作并留证据。
- 提醒生成：`@personal-agent/productivity`。
- 真实日历账号（OAuth）的授权与读回：后续独立工作包（见 ROADMAP 真实验收条件）。

## 真实提供商

### iCal 订阅（`ICalSubscriptionProvider`，只读）

- HTTPS 订阅源（如 officeholidays），5 分钟原文缓存；`fetchFeed(signal)` 提供原文级读回。
- `STATUS:CANCELLED` 在 `fetchWindow` 被过滤；**取消读回走 `getEvent` 单条路径**（不过滤）。
- `respond` 显式 `UNSUPPORTED_CAPABILITY`（只读源无邀约语义）。
- 限制：DATE/DATE-TIME 均按 UTC 解析（DATE 视作 UTC 零点），不解析 `TZID` 参数；只适合全 UTC 的公共订阅源。

### CalDAV（`CalDavProvider`，只读首片，RFC 4791）

- 输入：日历集合完整 URL（HTTPS）＋宿主注入的 `authorization` 头值（本包不保存凭据本体）＋可注入 `CalDavFetchLike`（PROPFIND/REPORT，离线测试用）。`allowLoopbackHttp: true` 仅放行本机回环（localhost/127.0.0.1/[::1]）的明文 `http://`，供本地验收服务器（如 Radicale）使用；非回环明文一律拒绝。
- **变更轮询**：`pollChanges()` 一次 Depth:1 PROPFIND 同时取集合 `getctag` 与全部子资源 `getetag`（href→etag 表）。变更检测 = ctag 或 etag 变化，随后按需 `fetchWindow`/`getEvent`。P5 消费方式见 Issue #212 的 P1 形状确认。
- **时间窗查询**：`fetchWindow` 走 `calendar-query` REPORT（time-range）发现候选，再用一次无窗口 REPORT 确认每个候选的精确 UID 当前版本，之后客户端二次过滤；cancelled 剔除与 iCal 一致。有候选时每次 provider 分页调用最多两次 REPORT；MVP 复用集合读回，尚无 sync-token 增量或事务一致快照。
- **时区**：`DTSTART;TZID=<IANA>` 经 Intl 定点迭代换算为 UTC（秋季回拨歧义取较早、春季空洞收敛到切换后偏移，均有测试）；非法 TZID 的事件整条剔除。每条事件保留 `DTSTART` 的 IANA 时区与起止本地墙上时间；UTC 瞬间单独用于排序与窗口过滤。
- **错误映射**：207 Multi-Status 显式按成功处理；429→`RATE_LIMITED`（60s）；401/403→`UNAUTHORIZED`；5xx/网络失败→`EXTERNAL_FAILURE` 可重试；4xx/响应非 multistatus→不可重试。
- **限制**：`respond` 显式 `UNSUPPORTED_CAPABILITY`（CalDAV 写侧/If-Match 更新留待独立工作包）；单条 `getEvent` 为全量拉取后按 UID 过滤（MVP 规模可接受）；`DURATION`（无 `DTEND`）事件不支持；未做日历集发现（`/.well-known/caldav`、`calendar-home-set`）——需直接给集合 URL；multistatus 用宽容正则解析（本地名匹配任意前缀），异常服务器形态宁可 fail-fast。
- `verification: 'conditional'`——离线夹具测试全绿，真实 CalDAV 服务器（Nextcloud/Radicale 等）读回验收待真实账号（见下方真实验收边界）。

### 真实读回（门控，需真实服务器）

```sh
PA_CALDAV_LIVE=1 PA_CALDAV_URL=<日历集合 URL> \
PA_CALDAV_USER=<用户名> PA_CALDAV_PASSWORD=<应用密码> \
node --test test/caldav.test.mjs
```

覆盖：`pollChanges` 读回非空 ctag 与 etag 表；宽窗 `fetchWindow` 事件解析＋**记录时区合法性与墙上时间↔UTC 瞬间换算一致性**（DST 歧义允许 1 小时差）；`getEvent` 单条读回与窗口结果逐字段一致；错误凭据得到 `UNAUTHORIZED` 且不可重试（仅在配置了 `PA_CALDAV_USER` 的受认证服务器上运行）。凭据只经环境变量注入，不进仓库、不进日志。


## 公共入口

`src/index.ts` 导出 `register`、`CalendarConnector`、`CalendarService`、`FakeCalendarProvider`、`defaultCalendarFixtures`、`eventToItem`、`ICalSubscriptionProvider`、`CalDavProvider`、`parseCalDavEvents`、`zonedWallToUtc` 与全部类型。

### 工具

| 工具 | 版本 | Scope | 副作用 | 幂等 | 恢复 |
| --- | --- | --- | --- | --- | --- |
| `calendar.events` | 0.1.0-alpha.1 | `calendar:read` | read | ✓ | ✓ |

`register(host, options)`：`options.provider` 必填（缺失抛 `INVALID_ARGUMENT`，Fake 仅测试用）。入参 `fromUtc/toUtc` 缺省为当前时刻起 `defaultWindowDays`（默认 7）天；`limit` 1..100（默认 20）；`cursor` 透传上一页 `nextCursor`（空串表示取尽）。

### 连接器（ConnectorPort）

manifest 随**实际 Provider** 声明（不保留把真实提供者标为 fixture 的过时示例）：`accountTypes=[providerKind]`（Fake=`fixture`、订阅源=`ical-subscription`、CalDAV=`caldav`）、`authentication`（Fake/iCal 订阅=`none`，CalDAV=`basic`）、`capabilities`（Fake 含 `performAction`；只读真实源只有 `fetchChanges/search/getItem`）、`verification` 透传 Provider 声明（Fake=`mock`、网络型真实源=`conditional`）、`syncStrategy='windowed'`。未 `connect()` 前调用数据方法抛 `UNAUTHORIZED`；游标损坏抛 `CURSOR_EXPIRED`；不支持的动作抛 `UNSUPPORTED_CAPABILITY`。

## 取消、超时与重试

- 取消/超时：CalendarService 的只读方法接受可选 `CalendarReadContext {signal?, deadline?}`；`listEvents` 在已有分页 options 中接收。`calendar.events` 透传 ToolContext。CalDAV 的窗口、无窗口确认、单 UID 读回及 `pollChanges(context?)` 贯穿同一个绝对 deadline 和取消信号，fetch/响应体均受限，取消返回 CANCELLED、宿主 deadline 返回 TIMEOUT；原有单请求 timeout 保留。ConnectorPort 的公共签名与公共条目 Schema 未变。
- 其他 Provider 仍维持已有传输行为；service 在读前、分页之间和读后检查 lifetime，不把返回时已取消或超时的结果当成功。
- 重试：`fetchChanges`/`search`/`getItem` 只读可重试；`performAction` 重试必须携带**同一幂等键**，重复响应由幂等表去重。

## 证据

- `respond` 返回 `evidenceRefs: ['calendar:<externalId>#<response>']`。
- Fake 夹具含跨 DST 事件（纽约 2026-11-01 回拨夜：01:30 EDT = 05:30Z 起，03:00 EST = 08:00Z 止）用于验证时区正确性。

## 依赖

- 生产：`@personal-agent/contracts`（ConnectorPort、ConnectorItem、ProtocolError）。
- 测试：`@personal-agent/testkit`。

## 测试

`node --test test/*.test.mjs`（37 项；35 项离线用例，2 项真实读回门控默认跳过）：DST 事件字段、connectorItem 契约校验、dedupeKey 稳定性与变更换键、分页聚合与排序、搜索/单条、respond 幂等与键冲突、连接器健康状态与游标、工具 schema/scope、缺 provider 拒绝、窗口校验；iCal 订阅与 CalDAV——ctag/etag 轮询、REPORT 时间窗与客户端二次过滤、TZID/DST 换算、单条取消读回、分页、错误映射（429/401/5xx/网络/畸形响应）、构造校验、服务层规范化。夹具用例无需联网；真实 HTTP 读回默认跳过，仅在显式设置 `PA_CALDAV_LIVE=1` 时运行。

## 已知限制与 Fake/真实验收边界

- manifest `verification: 'mock'`——**没有真实日历账号的授权与读回**。PA-013 的真实验收（至少一个真实连接器授权+读回、时区正确、邀请/变更按动作授权）待独立工作包完成后翻转。
- Fake `search` 为客户端标题过滤；真实提供商应实现服务端搜索。
- `respond` 在 Fake 上同步 `confirmed`；真实提供商可能返回 `pending/unknown`，届时不得当作已完成（ADR-0003）。
## 2026-10-12 Foundation 时间边界修复

CalDAV 请求计时器触发时复查实际截止时间，提前触发则等待剩余时间；请求上限与宿主
deadline 仍取较小值。真实到期保留原 TIMEOUT/EXTERNAL_FAILURE 分类，取消和无旧数据
返回语义不变，无接口、依赖或迁移变化。先用明确的合成时钟/计时器复现提前 1 ms
终止许可，再回归宿主/提供商两种到期；不调用真实 CalDAV。
本修复由 goo122 为根 Foundation 集成处理，MOD-20 的业务分工仍属 Potatos498，
交付后需要当前提交非作者评审及集成，不据此升级真实连接验收等级。
提前计时器和持久子任务专项 25/25、0 skip；日程单包 49 项、46 pass、3 skip、0 fail。
日志 `.cache/caldav-early-timer-repro.log`、`.cache/ci-time-boundary-focused.log` 与
`.cache/caldav-time-boundary-module.log` 保留；根完整门禁已通过，详细计数见执行记录。
