# MOD-20A：CalDAV 只读提供商

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-013（P1 业务连接器，演示链会议变更触发缺口）。
- 当前负责人：`Potatos498`（2026-10-07 重置）；自行验证与交付，可选同行评审：`goo122`；基线：main@`9b13895`；状态：`in_progress`（真实验收未完成）。
- 登记见 ROADMAP 2026-09-30 条目；本文件为 §11 模块切片说明。

## 范围与验收

`CalDavProvider`（`packages/connectors/calendar/src/caldav.ts`）实现 RFC 4791 只读访问：

- `pollChanges()`：一次 Depth:1 PROPFIND 返回 `{ctag, etags}`（集合 ctag + 全部子资源 href→etag）。
  这是变更检测的廉价原语：ctag 或 etag 变化后再按需查询。
- `fetchWindow(accountRef, window, cursor)`：calendar-query REPORT（time-range）＋客户端二次过滤；
  cancelled 剔除；游标为整数偏移分页（页大小 100）。
- `getEvent(accountRef, externalId)`：单条读回（全量拉取后按 UID 过滤），**保留 cancelled**——
  取消不能靠列表轮询发现，必须走本路径（与 iCal 订阅源同一约定，见 Issue #212 的 P1 形状确认）。
- 时区：`DTSTART/DTEND;TZID=<IANA>` 墙上时间经 Intl 定点迭代换算 UTC 瞬间；秋季回拨歧义取较早
  （RFC 5545 建议）、春季空洞收敛到切换后偏移；非法 TZID 事件整条剔除。
- 凭据：构造时由受信宿主注入完整 `authorization` 头值；本包不保存、不记录凭据本体。
- 错误映射：207 显式按成功；429→`RATE_LIMITED`（60s）；401/403→`UNAUTHORIZED`；
  5xx/网络→`EXTERNAL_FAILURE` 可重试；4xx/非 multistatus→不可重试。

离线验收（注入 `CalDavFetchLike` 夹具）：20/20，覆盖上表全部行为与 DST 边界（纽约 2026-11-01 回拨、
2026-03-08 空洞）、服务层规范化（dedupeKey 携带 sequence）。

## 不在范围

- CalDAV 写侧：`respond` 显式抛 `UNSUPPORTED_CAPABILITY`；If-Match 事件更新、INVITE/REPLY
  留待独立工作包（需动作授权链，ADR-0003）。
- 日历集发现（`/.well-known/caldav`、principal、calendar-home-set）：首版要求直接给集合 URL。
- `DURATION`（无 `DTEND`）事件、VTIMEZONE 块解析（TZID 走 Intl，非 iCal 内嵌时区定义）。
- ConnectorHost/Runtime 装配：归共享集成槽（P8 唯一写入）。
- multistatus 用宽容正则解析（本地名匹配任意命名空间前缀）；不做完整 XML DOM。

## 真实验收（待真实账号，完成前 `verification` 维持 `conditional`）

1. 真实服务器（Nextcloud/Radicale/iCloud 等任一）：`pollChanges` 读回非空 ctag 与 etag 表；
   服务器侧修改一个事件后 ctag/etag 变化。
2. 含 TZID 的真实事件 `fetchWindow` 读回：startUtc/endUtc 与服务器展示的本地时间一致。
3. 取消一个事件后 `getEvent` 读回 `status: 'cancelled'`（而 `fetchWindow` 不再返回它）。
4. 授权失败路径：错误凭据得到 `UNAUTHORIZED`，不重试。
