# @personal-agent/research

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-24（Potatos498）。产品流程：F10；逐节点流程见[WORKFLOWS](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

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
