# @personal-agent/research

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

MOD-24 · 搜索与资料获取（PA-010，P0；OpenAlex 学术源 + Fake）。负责人 `Potatos498`，评审者 `goo122`。

## 职责

- 检索学术/公开资料并规范化为 `ConnectorItem` 材料：**来源**（venue/DOI/作者进 contentRef）、**发布时间**（`occurredAt`＝发布时刻，仅日期精度归一为当日 UTC 零点）、**获取时间**（`fetchedAt`）三者分开披露（PA-010 逐字对应）。
- **失败/过期区分**（验收核心）：
  - 检索失败 → 照实抛错（不可重试）或可重试；可重试失败且有未过期语义下的缓存时回退 **stale** 并附 `cache.lastError`——旧结果随披露返回，不冒充新结果；
  - 缓存三态 `fresh`/`fetched`/`stale`（weather 同款）；
  - **材料过旧**（发布时间早于 `now - maxAgeMs`，默认 365 天）→ 仍返回但标 `freshness: 'stale'`，由 MOD-04/用户取舍；`validFor` 承载 `[发布时刻, 发布+maxAgeMs]` 时效窗口。
- 无发布时间的材料：`occurredAt` 回退抓取时刻，`publishedTimeKind: 'fetched_fallback'` 显式标注，不给时效窗口、不判过期。

## 非职责

- 研究规划与汇总：MOD-04（本包只供 `research.search` 工具）。
- 通用 web 搜索：本机实测 Wikipedia/DuckDuckGo/Brave/searx 连接层不通、Mojeek 403（2026-09-08 侦察记录在 ROADMAP）；Bing 端点可达但需 Azure key——作为后续提供商工作包。
- 网页正文抓取（r.jina.ai 不可达已排除）。

## 公共入口

`src/index.ts` 导出 `register`、`ResearchConnector`、`ResearchService`、`FakeResearchProvider`、`OpenAlexProvider` 与全部类型。

### 工具

| 工具 | 版本 | Scope | 副作用 | 幂等 | 恢复 |
| --- | --- | --- | --- | --- | --- |
| `research.search` | 0.1.0-alpha.1 | `research:read` | read | ✓ | ✓ |

`register(host, {provider, accountRef?, now?, maxAgeMs?, cacheTtlMs?})`：`provider` 必填（缺失抛 `INVALID_ARGUMENT`，Fake 仅测试用）。入参 `query`（必填）、`limit` 1..20（默认 10）。

### 连接器（ConnectorPort）

manifest：`id=research`、`accountTypes=['openalex']`、`capabilities=['search']`、`authentication='none'`、`syncStrategy='on-demand'`、`verification`＝Fake `mock` / OpenAlex `conditional`。`fetchChanges`/`getItem`/`performAction` 返回 `UNSUPPORTED_CAPABILITY`（按需检索连接器，非增量同步）。

## OpenAlex 真实提供商（免 key）

- 端点 `https://api.openalex.org/works?search=<q>&per-page=<n>`，2026-09-08 实测 HTTP 200；
- 可选 `mailto` 进 polite pool（限速更稳），由装配层注入；
- 响应映射：`id`→externalId（剥域名前缀）、`display_name`→标题、`publication_date`（YYYY-MM-DD）→当日 UTC 零点、`authorships[].author.display_name`、`primary_location.source.display_name`→venue、`doi`→url、`cited_by_count`；无标题条目跳过；
- 错误映射：429→`RATE_LIMITED`（附 60s retryAfter）；网络→`EXTERNAL_FAILURE`（可重试）；取消不被吞。

## 取消、超时与重试

- 取消：工具入参透传 `ToolContext.signal`，请求中途取消抛 `CANCELLED`；
- 超时：宿主 deadline 门禁；
- 重试：检索幂等可重试；结果缓存（默认 TTL 10 分钟、上限 100 键）按查询词小写归一。

## 测试

`node --test test/*.test.mjs`（9 项：8 离线 + 1 门控 live）：材料契约校验、失败/过期区分（1999 材料标 stale 仍返回）、无发布时间回退与标注、缓存三态（fresh/stale+lastError/不可重试照实抛）、无缓存失败照实抛、OpenAlex 规范化（日期归一/作者/venue/坏条目跳过）、连接器能力边界、工具 schema/scope。

真实读回（免 key）：

```sh
PA_RESEARCH_LIVE=1 node --test packages/connectors/research/test/
```

## 已知限制

- `verification: 'conditional'`：真实读回依赖出站网络，实测样本为一次查询的 5 条结果；
- 缓存为实例内存级（同 weather），跨进程不共享；TTL 内不感知源数据更新；
- 材料不含正文摘要（OpenAlex 有 abstract_inverted_index，反排还原属后续增强）；
- 仅学术源；通用 web 搜索待 Bing（需 key）或网络环境变化后的其他提供商。
