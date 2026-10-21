# @personal-agent/research

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。
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
| `research.search` | 0.1.0-alpha.2 | `research:read` | read | ✓ | ✓ |

`register(host, {provider, accountRef?, now?, maxAgeMs?, cacheTtlMs?})`：`provider` 必填（缺失抛 `INVALID_ARGUMENT`，Fake 仅测试用）。入参 `query`（必填）、`limit` 1..20（默认 10）。

### 连接器（ConnectorPort）

manifest：`id=research`、`accountTypes=['openalex']`、`capabilities=['search']`、`authentication='none'`、`syncStrategy='on-demand'`、`verification`＝Fake `mock` / OpenAlex `conditional`。`fetchChanges`/`getItem`/`performAction` 返回 `UNSUPPORTED_CAPABILITY`（按需检索连接器，非增量同步）。

## OpenAlex 真实提供商（免 key）

- 端点 `https://api.openalex.org/works?search=<q>&per-page=<n>`，2026-09-08 实测 HTTP 200；
- 可选 `mailto` 进 polite pool（限速更稳），由装配层注入；
- 响应映射：`id`→externalId（剥域名前缀）、`display_name`→标题、`publication_date`（YYYY-MM-DD）→当日 UTC 零点、`authorships[].author.display_name`、`primary_location.source.display_name`→venue、`doi`→url、`cited_by_count`；无标题条目跳过；
- 错误映射：429→`RATE_LIMITED`（附 60s retryAfter）；网络→`EXTERNAL_FAILURE`（可重试）；取消不被吞。
- 中文查询相关度桥接（#445/#447/#473）：保留 C++/C#/版本号词边界，过滤前移除“论文/研究/方法/优化”等通用指令词，避免泛词误留。中文具体主题可经有限、可审计的双语短语映射命中题名或有界 OpenAlex 摘要，如内存分配→memory allocation、内存池→memory pool、知识图谱→knowledge graph；没有把 C++ 语言名推成分配器主题，也不以引用数/venue 放行。已识别主题须有主题依据，不能只靠 C++ 或重叠的“分配器”后缀放行。未覆盖主题继续使用题名 Latin/连续汉字桥；无桥仍过滤。纯拉丁查询保留提供商原序，`provider_rank` 不代表本机已验证语义相关性。
- 完整覆盖的中文主题/指令词会用同一词表转换为明确英文主题（例如 `C++ 内存池 优化 论文`→`C++ memory pool optimization`），只发一个真实源请求，`queryRewrite` 明示原文、实际检索词和每项映射。未知中文主题、否定、日期/条件不被静默删掉，保持原查询。即使改写，仍须经过原中文主题相关度桥，不以英文请求本身放行。
- `OpenAlexProvider.searchWithReceipt()` 在保留旧 `search(): ResearchMaterial[]` 的同时返回 `{materials, retrieval}`。`ResearchProvider` 的该方法可选；旧自定义/Fake 提供商无需改动，不伪造其原始命中数。`ResearchService` 与新注册 `research.search@0.1.0-alpha.2` 增加可选 `retrieval`，缓存 fresh/stale 保留原抓取回执，失败刷新不改写旧计数。旧 `alpha.1` 严格描述器会拒绝新字段，必须重新准备新版目录；不静默升级旧任务版本。npm 包、Connector manifest、Core wire、数据库和依赖不变，接口仍 provisional。
- `retrieval` 披露本次页面的 `rawCount / invalidCount / filteredCount / returnedCount`（四者满足 raw=invalid+filtered+returned，非全库总数）、`policy`、`outcome`、中文 `message` 与保留材料逐条 `matches`（externalId、匹配字段/策略、词面依据）。`source_empty` 仅指本次源页面空；`filtered_empty` 指原始非空但本机筛空；`invalid_results` 指条目缺必要标识/题名。坏 envelope 报 `EXTERNAL_FAILURE`，不伪装源空。回答必须保留这个区别；筛空可以建议明确英文主题短语重查，不能说“没有这类文献”。匹配不是已读全文或语义结论。

## 取消、超时与重试

- 取消：工具入参透传 `ToolContext.signal`，请求中途取消抛 `CANCELLED`；
- 超时：宿主 deadline 门禁；
- 重试：检索幂等可重试；结果缓存（默认 TTL 10 分钟、上限 100 键）按查询词小写归一。

## 测试

`node --test test/*.test.mjs`：材料契约、失败/过期、取消与缓存、工具 schema/scope、#445 原跑题过滤、#447 C++/C#/版本词元及连续汉字分隔边界。#473 另覆盖跨语言具体主题、泛词/引用数/venue 负例、语言名不冒充主题、摘要缺口/冲突/尺寸边界、源空/筛空/坏条目/坏 envelope、已注册工具的披露及缓存深拷贝/stale 证据保留。默认离线 Fake 响应不证明真实连接；结果及明确公开 GET 样本见 [#473 记录](../../../docs/competition/evidence/RESEARCH_MIXED_QUERY_473_20261021.md)。

真实读回（免 key）：

```sh
PA_RESEARCH_LIVE=1 node --test packages/connectors/research/test/
```

#473 的 7 个固定公开查询小矩阵（每题一个真实 GET、per-page=5，原 JSON 仅留 ignored cache，不使用账号/模型/桌面活库）：

```sh
node packages/connectors/research/test/live-mixed-query.mjs
```

输出 `.cache/issue473/live-receipt.json` 和各请求原始 JSON；HTTP/超时/解析失败独立记录，不算 raw0。源结果会变化，历史计数不能当作新查询的结果。

## 已知限制

- `verification: 'conditional'`：真实读回依赖出站网络，实测样本为一次查询的 5 条结果；
- 缓存为实例内存级（同 weather），跨进程不共享；TTL 内不感知源数据更新；
- 摘要仅为本机有界主题比对输入，不作为全文材料导出；缺失/坏形状/超过 4096 位置或 32768 字符时不能成摘要桥。双语映射覆盖有限主题，不是翻译器或语义 reranker；存在词面误保留/误过滤的残余风险，回执显式披露，不能由 citedBy、venue 或 provider_rank 提升真实性/相关性结论。日语假名/韩文不在桥接覆盖内；
- 仅学术源；通用 web 搜索待 Bing（需 key）或网络环境变化后的其他提供商。
