# P1 日历 → P5 认知 投影消费契约（provisional）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 登记号：MOD-20B-CALENDAR-P5-PROJECTION-01；登记日：2026-09-30。
- 负责人：P1 原语 `Potatos498`（`@personal-agent/calendar`）；投影消费 `zemeng`（P5 `packages/cognition`）。
- 状态：`provisional`——本文件固定双方当前消费的名称与语义；升格 `frozen` 需两侧非作者评审。
- 背景：Issue #212 中 P5 请求 P1 日历消费入口（2026-09-30 02:35），本文是那次答复的正式化与**一处更正**（见「时区」）。

## 1. 职责边界

**P1 连接器只提供版本化条目与单条读回；`MeetingRescheduleEvent` 的生成是 P5 的投影职责。**
P1 不发射事件、不做前后版本 diff、不判断「改期」语义，也没有写路径（只读首片）。

## 2. P1 原语（消费入口，固定名）

`packages/connectors/calendar`（`@personal-agent/calendar` 公开 exports；包间依赖合规，禁止深层导入）：

| 原语 | 签名要点 | 用途 |
| --- | --- | --- |
| `CalendarService.listEvents` | `(accountRef, {fromUtc, toUtc}, {cursor?, limit?})` → `{items, nextCursor, hasMore, window}` | 窗口拉取版本化条目 |
| `CalendarService.getEventItem` | `(accountRef, externalId)` → `ConnectorItem`；未命中抛 `NOT_FOUND` | **单条读回（含取消）** |
| `CalendarService.searchEvents` | `(accountRef, query)` → `ConnectorItem[]` | 标题过滤检索 |
| `CalDavProvider.pollChanges` | `()` → `{ctag, etags: Record<href, etag>}` | 廉价变更轮询（ctag 或 etag 变化后再查询） |
| `ICalSubscriptionProvider.fetchFeed` | `(signal?)` → 原文 | 订阅源原文级读回 |

## 3. 版本化条目语义（`ConnectorItem`，规范化层）

| 字段 | 语义 |
| --- | --- |
| `source` | `'calendar'` |
| `externalId` | 提供商稳定主键（CalDAV = iCal UID；订阅源 = UID） |
| `occurredAt` | **= 事件开始时刻（UTC 瞬间）** |
| `dedupeKey` | `calendar:<calendarId>:<externalId>:<sequence>`——**变更检测靠它** |
| `contentRef` | `[status] title｜startLocal（timeZone）→ endLocal｜组织者…`（人类可读，新旧时间可直接对比） |
| `validFor` | `startUtc/endUtc`（[start, end) UTC 区间） |
| `fetchedAt` / `sensitivity` | 获取时刻 / `'normal'` |

**修订语义**：提供商层 `CalendarEventRecord.sequence`（iCal SEQUENCE）即 sourceRevision；同一
`externalId` 出现新 `sequence`/`dedupeKey` 的条目即一次修订；旧条目保留旧 `startUtc`/`contentRef`。
**旧新开始时间没有内建 diff**——前后比对由 P5 做（保留旧条目或由 P5 自存上次观察值）。

## 4. 时区（含对 #212 答复的更正）

每条 `CalendarEventRecord`：`startUtc`/`endUtc` 是 UTC 瞬间（排序、窗口过滤、`validFor` 用）；
`timeZone` 是**事件原始 IANA TZID**，`startLocal`/`endLocal` 是该时区下的墙上时间。
**更正**：#212 答复曾写「timeZone 恒 UTC」——那是 iCal 订阅源（源全 UTC）的行为；CalDAV 提供商
（PR #226 经 goo122 修正后）保留 `DTSTART;TZID=` 的原始时区。消费侧不得假设单一时区。

## 5. 取消/撤回（易错点）

- `STATUS:CANCELLED` → `record.status = 'cancelled'`，但 **`fetchWindow`/`listEvents` 会过滤掉
  cancelled——取消不能靠列表轮询发现**。
- **取消读回必须对已知 UID 走单条 `getEventItem`/`getEvent`**（单条路径不过滤 status）。
- 两类真实提供商均只读：`respond()` 显式抛 `UNSUPPORTED_CAPABILITY`，不假成功。

## 6. 错误码（P5 消费侧处置）

| 码 | 语义 | 重试 |
| --- | --- | --- |
| `NOT_FOUND` | 单条读回未命中；不能单独证明日历取消或删除 | 否（转为人工复核，不自动撤回 Fact） |
| `UNAUTHORIZED` | 认证被拒绝（401/403） | 否（凭据问题） |
| `RATE_LIMITED` | 限流 | 是，`retryAfterMs`（默认 60s） |
| `EXTERNAL_FAILURE` | 网络/服务器失败/畸形响应 | 按 `retryable` 标志（5xx/网络/超时可重试；4xx 与非 multistatus 否） |
| `UNSUPPORTED_CAPABILITY` | 写路径（respond 等） | 否 |
| `INVALID_ARGUMENT` | 入参非法 | 否 |

## 7. P5 投影职责与推荐算法

1. `listEvents` 拉窗口 → 按 `externalId` 分组 → `sequence`/`updatedUtc` 变化即一次修订 →
   比对前后 `startUtc` 生成改期（旧值取自 P5 侧上次观察或旧条目）。
2. 对已知 UID 定期 `getEventItem` 读 `status === 'cancelled'` 识别取消（不要用列表）。
3. 变更轮询建议先 `pollChanges`（廉价），ctag/etag 有变化再 `listEvents`/`getEventItem`。

## 8. 非目标

P1 不提供：事件发射、diff、写路径（CalDAV 写侧/If-Match 更新、日历集发现是后续独立工作包）、
Runtime/ConnectorHost 装配（归共享集成槽）。`verification` 维持 `conditional` 直至真实服务器读回验收。
