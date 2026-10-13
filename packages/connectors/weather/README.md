# 天气连接器（MOD-25）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 Potatos498（C）；评审者 `goo122` 或 `zemeng`。包版本 0.1.0-alpha.1。关联需求 [PA-010](../../../docs/PRD.md)。

本包是当前 [Huawei ICT AgentArts Competition Profile](../../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) Golden Path 的候选只读工具：只有完成 AgentArts 提案、本地 Policy/ToolGateway 调用、目标数据读回和 trace/Evidence 关联后，才算比赛链路证据。现有 Local/Fake 调用继续用于基线测试，但不计入比赛完成度，也不产生新的 Local 实施工作。

接 **Open-Meteo** 真实提供商（免密钥、无账号），manifest `verification` 为 `conditional`——结果依赖出站网络可达。`register` 不默认任何提供商，装配方必须显式传入（通常为 `new OpenMeteoProvider()`），缺失时抛 `INVALID_ARGUMENT`，避免静默启用测试用 Fake。`FakeWeatherProvider` 夹具仅用于离线测试，`verification` 为 `mock`。

## 导出入口

`@personal-agent/weather`（ESM，类型声明在 `dist/index.d.ts`）：

- `register(host, options)`：向 ToolHost 注册 `weather.forecast` 工具（scope `weather:read`），返回 dispose。`options.provider` 必须显式提供；`now`、`defaultLocation`、`cacheTtlMs`（默认 10 分钟）可选。
- `OpenMeteoProvider`：真实提供商。`options`：`fetchImpl`（注入以便离线测试）、`language`（默认 `zh`）、`locationResolution`（默认 `ranked`）、`minCorroboratedPopulation`（默认 500000，见「匹配置信度」）、`forecastBaseUrl`、`geocodingBaseUrl`、`geocodeCacheLimit`（默认 500）。`resolvePlace(location, locationQuery, signal)` 单独暴露地点解析，供调用方在不知道日期时先取得时区。
- `WeatherProvider`：提供商契约。**`resolvePlace` 是必需成员**——`fetchForecast` 内部同样会解析地点，两条路径必须返回同一地点，否则日期取 A 地时区而坐标取 B 地。
- `WeatherService`：领域服务。`getForecast(query, signal?)` 返回 `{record, forecast, cache}`；`providerVerification` 反映注入的提供商。
- `WeatherConnector`：ConnectorPort 适配（manifest `id: 'weather'`，capabilities `['forecast']`，`verification` 取自 service）。
- `FakeWeatherProvider` / `defaultWeatherFixtures`：离线夹具，见下。

## 消费的公共版本

`@personal-agent/contracts` 0.1.0-alpha.1（wire 1.0.0）；记录用 `validateContract('connectorItem')` 校验；工具输出 schema 以 `$ref` 引用协议 `$id` 下的 `ConnectorItem` 定义，不复制契约。fake 联调用 `@personal-agent/testkit` 0.1.0-alpha.1（FakeClock / FakeToolHost）。无新增外部依赖：HTTP 用 Node 内置 `fetch`，时区换算用内置 `Intl`。

MOD-25 的天气 Provider/Connector 工作包已完成，但通用 ConnectorPort/ConnectorHost 仍为 `provisional`，生产 wire 的 `connector.connect` / `connector.disconnect` 为 `unavailable`。当前生产入口通过 Runtime 显式注册 `weather.forecast` 工具；这不冻结所有连接器账号与生命周期接口。见[当前接口目录](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 行为规则

- **地点不静默猜测**：地点只能来自本次请求或已配置的 `defaultLocation`（用户设置），两者都缺时返回 `INVALID_ARGUMENT`。
- **检索轮由输入文字决定，展示名由配置语言决定**：Open-Meteo 的地理编码按语言分别建索引，且 `language` 同时决定「搜哪套名字」与「显示名」。2026-09-06 对生产端点实测：**任何中文串在 `language=en` 下返回 0 条**，`zh-TW` / `zh-Hant` 同样 0 条；`zh` 索引的简繁覆盖逐条不可预测（`东京` 只命中江苏同名地点，要繁体 `東京` 才命中东京都）。因此轮集合 = { 配置语言, `en` } ∪ { 输入含汉字时的 `zh` }，去重后并行；**不再因为配置语言以 `en` 开头就砍掉轮次**——此前 `language:'en'` 下所有中文输入一律 `NOT_FOUND`。合并顺序即展示名优先序：**GeoNames 精确名层（配置了 `geonamesUsername` 时）** → 配置语言 → `zh`（汉字输入时）→ `en`。同一地点按 GeoNames `id`（无 `id` 时退化为两位小数坐标）合并。这**没有**让解析与文字无关，`zh` 索引在两个方向上都不完整，缺口由 GeoNames 层与下面的提示串兜。
- **GeoNames 精确名层（可选，装配层配置 `geonamesUsername` 后启用）**：2026-09-07 实测，未配置账号时简体中文查外国大城市 26 个中 7 个 `NOT_FOUND`（纽约/首尔/温哥华/利马/内罗毕/伊斯坦布尔/胡志明市）、3 个低置信误解析、1 个高置信静默错误（`开罗`→美国伊利诺伊州 Cairo，人口 1733 的 PPLA2；埃及开罗不在 `zh` 索引返回里）。配置后对汉字输入增加一层 GeoNames 官方 API（`secure.geonames.org/searchJSON?name_equals=`，免费账号日 3 万次额度）——`name_equals` 精确匹配任一语言的已知名（含简体别名），返回的 geonameId 再经 Open-Meteo `/v1/get?id=` 取规范记录（时区/人口/feature_code 与搜索结果同字段、同 id 体系）。**`name_equals` 命中即证明「输入串是该地点的已知名」**，因此该层候选直接参与 exact-match 排序，显示名不同（`伦敦` vs `倫敦`）不影响；排序按人口，`开罗` 由 PPLC 960 万压过 PPLA2 小镇。该层**尽力而为**：账号缺失、网络失败、401、额度超限、`/v1/get` 404 都只跳过本层或丢弃对应候选，回退到仅 Open-Meteo 的既有行为，不让查询整体失败（取消除外）。配置后 26 城简体查询 **26/26 高置信命中**（含纽约→America/New_York、开罗→Africa/Cairo、东京→Asia/Tokyo）。账号由装配层从环境变量注入（如 `PA_GEONAMES_USERNAME`），不进仓库、不进前端快照；真实端到端验证命令：`PA_WEATHER_LIVE=1 PA_GEONAMES_USERNAME=<账号> node --test`。
- **拉丁名提示是兜底轮，不是平权轮**：`weather.forecast` 入参可选 `locationQuery`，即用于检索的英文／当地文字书写形式；`location` 仍是用户原始表述。**仅当原始输入零候选或被判低置信度时**才检索提示串，且只有提示串自身判为高置信度才采用。实测理由：`婺源` 用中文正确，而其拉丁写法 `Wuyuan` 把浙江另一个县排在前面（两者都是 `PPLA3` 行政中心，`feature_code` 与人口都分不开），平权合并会让错误提示压过正确输入。提示串并入记录身份（见「默认日期」），因为同一 `location` 带不同提示可能解析到不同地点。提示串 trim 后为空视为未提供，不发空检索。
- **排序不依赖提供商顺序**：提供商的相关性排序跨语言不可靠（`New York` 的 `zh` 轮把内布拉斯加州 York 排第一，人口 7864，而纽约市人口 8,804,190 只在 `en` 轮出现）。改为先筛名称与查询完全相等的条目，再按人口降序，人口相同时按首次出现顺序。**`admin1` / `country` 不再算作「名称完全相等」**——那会让 `Texas`、`France`、`England` 这类区域名伪装成精确地名匹配；它们现在由置信度规则暴露为低置信度，而不是在这里被悄悄提升。
- **匹配置信度必须披露**：`forecast.resolved.confidence` 取 `high` / `low`，只看排序首位：`feature_code` 不属于有人居住地点家族（`PPL*`）→ `low`（国家、行政区、岛屿、山体记录都不能回答天气）；是**首级行政中心**（`PPLC` 首都 / `PPLA` 一级行政区驻地）→ `high`；是**次级行政中心**（`PPLA2`–`PPLA5`）→ 人口 ≥ `minMinorSeatPopulation`（默认 **100000**）才 `high`，否则 `low`；其余 `PPL` 人口 ≥ `minCorroboratedPopulation`（默认 **500000**）才 `high`；GeoNames 精确名层命中的「已证名」在任何人口档位都可佐证为 `high`。`feature_code` 缺失按无分类保守处理。同时披露 `featureCode` 本身，使判定可复核。两个阈值均取自实测空档而非整数偏好（次级席位：错误小席位 ≤14574 ↔ 正确最小席位 211151；非席位：422324 ↔ 8804190）。**这是对匹配的判定，不是对天气数据的判定，且刻意不当场纠正**（见已知限制）。
- **地点解析必须披露**：真实地理编码天然有同名歧义（"北京" 返回北京市／重庆市／四川三个同名地点）。`ranked`（默认）取排序首位，但在 `forecast.resolved` 中披露解析到的具体地点（名称、行政区、国家、经纬度、时区、`confidence`、`featureCode`）、`ambiguous` 标记与最多 4 条 `alternatives`；标签在截断到 4 条前先去重，因为同一行政区下的不同坐标常产生完全相同的标签，重复披露等于没有披露。`strict` 拒绝**低置信度**匹配并列出候选与可操作的下一步，而不是拒绝任何存在同名的查询——语义变更见已知限制。
- **默认日期是目标地的今天**：未传 `date` 时先解析地点，用其 IANA 时区经 `Intl.DateTimeFormat.formatToParts` 组装当地日历日；**不再取 UTC 日历日**（UTC 16:00 之后北京已是次日，UTC 05:00 之前纽约仍是前一日，此前两种情况都会静默返回错一天的预报）。不用 `en-CA` 这类格式简写，其字段顺序是实现定义的。平台无法解析该时区时返回 `EXTERNAL_FAILURE`（不可重试），不静默退回 UTC。由此 `record.externalId` / `dedupeKey` / `contentRef`，以及提供商未给覆盖区间时的 `validFor`，都携带目标地当地日，宿主侧去重会看到与此前不同的取值。
- **三个时间分开**：`record.occurredAt` 是来源时间，`record.fetchedAt` 是获取时间，`record.validFor` 是预报覆盖区间（ISO 8601 UTC 区间）。
- **时间来源必须标注**：Open-Meteo **不返回预报发布时间**（只有 `generationtime_ms`，那是响应生成耗时）。因此 `forecast.publishedTimeKind` 显式区分 `provider_published`（提供商给出真实发布时刻，如夹具）与 `coverage_start`（Open-Meteo：取覆盖日本地零点的 UTC 时刻）。不用抓取时间冒充发布时间。
- **覆盖区间按地点时区**：真实提供商给出时区时，`validFor` 是该地本地日对应的真实 UTC 区间（北京 2026-09-06 → `2026-09-05T16:00:00.000Z/2026-09-06T16:00:00.000Z`）。按 UTC 日界推算会偏 8 小时。日界用 `Intl` 计算，跨夏令时正确（纽约 7 月 → `T04:00Z`，1 月 → `T05:00Z`）。
- **缓存状态可见**：每次结果带 `cache.state`——`fresh`（TTL 内命中，未调用提供商取数）、`fetched`（本次实际调用提供商）、`stale`（提供商失败且返回已过期缓存，`cache.lastError` 附错误码、信息与可选 `retryAfterMs`）。仅 `RATE_LIMITED` / `TIMEOUT` / `EXTERNAL_FAILURE` 这三类可重试的外部失败才回退到 stale；`NOT_FOUND`、`INVALID_ARGUMENT` 等确定性错误照常向上抛出，不用旧数据掩盖。提供商失败且无缓存时错误同样传播；仅 `ProtocolError` 触发 stale 回退，程序性异常照常抛出。
- **缺省日期让缓存命中也要先解析地点**：缓存键含日期，而日期现在来自解析结果，所以未传 `date` 时命中缓存仍会调一次 `resolvePlace`（真实提供商有自己的地理编码缓存，这一步不产生网络请求），但不会再取预报。**代价**：未传 `date` 且解析本身失败时无法回退到 stale——此时还没有键可以查。传显式 `date` 保留该回退路径。两种行为都由测试固定，不留隐含。
- **取消不是失败**：信号已取消时返回 `CANCELLED`，既不回退到 stale 缓存，也不返回提供商在取消后才到达的结果——抓取前后各检查一次，避免把取消后的数据当成成功结果交出去。
- **不编造数据**：提供商未给降水概率时 `precipitationProbability` 为 `null`，不填 0；未知 WMO 天气代码返回 `未知天气代码 N`，不编造天气描述。
- 无账号连接器：`record.accountRef` 固定为 `weather`，manifest `accountTypes` 为空，`authentication` 为 `none`，不持有任何凭据。

## 真实提供商：Open-Meteo

调用两个免密钥端点：地理编码 `geocoding-api.open-meteo.com/v1/search`（按输入文字并行发 1–3 轮，`language` 取配置语言、汉字输入时的 `zh`、以及 `en`，去重后按 GeoNames `id` 合并；合并结果按 `配置语言|地点|提示串` 缓存，上限 500 条，超出淘汰最早项）与预报 `api.open-meteo.com/v1/forecast`（`daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code`，`timezone` 取解析地点的 IANA 时区）。代价：中文输入在 `language:'zh'` 配置下为两轮（`zh` + `en`），拉丁输入为一轮；提示串仅在原始输入零候选或低置信度时再产生一组轮次。命中缓存后为 0 次。缓存键含提示串，否则同一 `location` 带与不带提示会互相覆盖。

错误映射：

| 情况 | 协议错误码 | 可重试 |
| --- | --- | --- |
| 地名无匹配 | `NOT_FOUND` | 否 |
| `strict` 下首位匹配置信度为 `low` | `INVALID_ARGUMENT`，附判定依据（`feature_code` 与人口）、首选地点标签、候选清单与「改传 `locationQuery`」提示 | 否 |
| 解析出的时区平台无法换算成当地日 | `EXTERNAL_FAILURE` | 否 |
| 日期超出模式范围（400 且 reason 含 out of allowed range） | `NOT_FOUND`，附提供商给出的允许日期区间 | 否 |
| 其他 400 / 参数被拒 | `INVALID_ARGUMENT`，附 reason | 否 |
| 429 | `RATE_LIMITED` | 是（`retryAfterMs` 60s） |
| 5xx、网络失败、JSON 畸形 | `EXTERNAL_FAILURE` | 5xx 与网络问题为是 |
| 信号已取消 | `CANCELLED` | 否 |
| 该日无温度数据 / 响应缺 daily 块 | `NOT_FOUND` / `EXTERNAL_FAILURE` | 否 / 是 |

单位：`imperial` 走 `temperature_unit=fahrenheit`（由提供商换算），`metric` 走 `celsius`。天气摘要由 WMO `weather_code` 映射为中文或英文文本。

## 最小夹具

`FakeWeatherProvider` 内置 4 条固定夹具（Beijing ×2 日、Shanghai、Hangzhou，均 2026-09-05/06，时区 `Asia/Shanghai`），`setFailure(error)` 可模拟提供商取数失败。未知地点/日期返回 `NOT_FOUND`。imperial 单位由摄氏换算（°F，一位小数）。夹具带真实发布时刻，`publishedTimeKind` 为 `provider_published`。

夹具可选 `timezone`，用于派生缺省日期；未给时退回 `UTC`，即该夹具不主张任何当地日。`resolvePlace` 同样实现，并由 `resolveCalls` 单独计数（缓存命中仍会解析，见行为规则）。它**刻意不受 `setFailure` 影响**——夹具查表没有 I/O，而 `setFailure` 模拟的是取数失败；需要两者独立失败的用例请自备 stub。夹具的经纬度为 0，因为夹具集不含地理数据，且 `fetchForecast` 不回报 `resolved`，这两个值不会进入任何输出。

## 工具入参上的说明注解

`ToolDescriptor` 没有 `description` 字段且 `additionalProperties: false`（契约归 `goo122`，本包不改），但 `inputSchema` 本身允许附加属性。因此「外国城市请同时给出 `locationQuery`」「`resolved.confidence` 为 `low` 说明只找到小型同名地点或非城市记录，应改用英文／当地名重试」这两条约定，写在 input schema 根节点与 `location` / `locationQuery` 两个属性的 JSON Schema `description` 里——这是模型能读到该约定的唯一通道。

## 验证方法

仓库根目录执行：

```sh
npm ci
npm run check      # = check:generated + 全工作区 build / typecheck / test
```

分步等价写法是 `npm run build`、`npm run typecheck --workspaces`、`npm run test --workspaces`。

本包只有 `build` / `typecheck` / `test` 三个脚本，**没有 `check`**；且 `test` 不触发构建。改完源码要先 `npm run build --workspace=@personal-agent/weather` 再跑测试，否则跑的是旧 `dist/`，会出现与源码无关的失败。

本轮（2026-09-06）结果：根 `npm run check` **整体通过**（退出码 0）。全仓 11 个工作区共 119 项测试，116 通过、3 跳过——跳过项全部在本包，是真实读回（见下）。分布：weather 59、testkit 13、runtime 11、tool-gateway 7、client 5、models 5、agents 4、connector-host 4、contracts 4、storage 4、policy 3。

本包 69 项中 `test/weather.test.mjs` 21 项（全部通过，无网络）覆盖：地点拒绝猜测与默认地点；**缺省日期取目标地当地日**——北京 `Asia/Shanghai` 在 `2026-09-05T20:00Z` 取 `2026-09-06`、纽约 `America/New_York` 在 `2026-09-06T02:00Z` 仍取 `2026-09-05`、`Pacific/Kiritimati`（UTC+14）在 `2026-09-05T12:00Z` 最先跨日、夹具不主张当地日时退回 UTC 日、平台无法解析的时区判 `EXTERNAL_FAILURE` 而非 `INVALID_ARGUMENT`、显式传 `date` 时 `resolveCalls` 为 0；`locationQuery` 透传到 `resolvePlace` 与 `fetchForecast` 两次调用并并入记录身份；三个时间与单位；记录通过契约校验；缓存命中跳过取数但仍解析（`fetchCalls` 1 / `resolveCalls` 2）；缓存过期重取；仅取数失败时的 stale 回退（含 `retryAfterMs`）；**解析自身失败时无 stale 可回退**（限制见下）；取消不返回缓存或成功结果；拒绝静默启用 Fake；输入校验；工具 scope 与 dispose；manifest 与生命周期。

`test/open-meteo.test.mjs` 48 项覆盖真实提供商，其中 44 项为离线测试（默认运行，无网络），用注入的 `fetchImpl` 覆盖时间来源标注、夏令时日界、歧义披露、地理编码缓存、单位参数、降水缺失、未知天气代码、错误码映射、网络失败与取消、畸形响应、空地点拒绝、manifest `conditional`，以及经 `FakeToolHost` 的 ajv 实际校验工具**入参与出参** schema（含 `locationQuery`、`resolved.confidence` 与可空降水概率）；**次级席位收口 3 项**：`PPLA4` 人口 99999/100000 的下限边界与 `minMinorSeatPopulation` 可配置、`开罗`（伊利诺伊 PPLA2 1733）不再以 `high` 挡住提示串（`开罗+Cairo` 经提示串到 `Africa/Cairo`）、GeoNames 已证名对无人口 `PPL`（阳朔型）佐证为 `high`；**GeoNames 精确名层 6 项**：配置账号后简体 `伦敦` 经 `name_equals`+`/v1/get` 解析到 `Europe/London`（高置信、安大略仍披露为 alternatives）、`name_equals` 命中按「已知名」参与 exact-match 排序、未配置账号不发 GeoNames 请求行为不变、GeoNames 401/额度超限降级为仅 Open-Meteo、`/v1/get` 404 只丢该候选（`开罗` 由埃及 PPLC 存活）、层内取消不被吞掉。

其中地理编码部分用 **2026-09-06 从生产端点逐字抓取的响应**做夹具（`CAPTURES`，按 `name` 与 `language` 双键路由，不是手写），固定的行为包括：检索轮由输入文字决定而非由配置语言决定（汉字输入 + `language:'en'` 仍解析到北京，纯拉丁输入 + `language:'en'` 只发一轮）；`feature_code` 参与判定且**披露的就是判定所用的那个**（跨轮合并后取合并值，不取显示语言轮的候选）；置信度人口下限的边界（422324 判 `high` / 422325 判 `low`）；下限可经 `minCorroboratedPopulation` 配置；`feature_code` 缺失保守判 `low`；国家与行政区记录无论人口多高都判 `low`；提示串只在原始输入零候选或 `low` 时并入（`婺源` 收口后判 `low`，但 `Wuyuan` 首条同为无人口 `PPLA3` 无法佐证，结果仍是正确的江西且不被错误提示改写；`丽江` 判 `low` → 经 `Lijiang` 到云南——丽江市 `PPLA2` 211151 过次级席位下限）；提示串 trim 后为空视为未提供且不发请求；地理编码缓存把带提示与不带提示的查询分开存；两轮返回同一 `id` 时合并且显示名取配置语言的写法；完全相同的 `alternatives` 标签只披露一次；`strict` 接受 `high`、拒绝 `low` 且消息含候选与「改用英文名」提示、`low` 经提示串佐证后接受。

最后 4 项是真实读回，**与模拟测试分开**，需显式开启。其中 GeoNames 端到端一项还要一个免费 GeoNames 账号（[geonames.org](https://www.geonames.org) 注册并在账户页启用 Free Web Services）：

```sh
PA_WEATHER_LIVE=1 node --test packages/connectors/weather/test/open-meteo.test.mjs
PA_WEATHER_LIVE=1 PA_GEONAMES_USERNAME=<geonames 账号> node --test packages/connectors/weather/test/open-meteo.test.mjs
```

未设 `PA_WEATHER_LIVE=1` 时这 3 项跳过，保证 CI 与离线环境确定性。本轮实际执行结果：38 项全部通过（退出码 0），证据见下。

## 真实读回证据

2026-09-06 于 Windows 本机对生产端点实际执行（`PA_WEATHER_LIVE=1`，38 项全部通过，退出码 0）。查询「北京」当日：

```json
{
  "occurredAt": "2026-09-05T16:00:00.000Z",
  "fetchedAt": "2026-09-06T11:06:44.625Z",
  "validFor": "2026-09-05T16:00:00.000Z/2026-09-06T16:00:00.000Z",
  "summary": "阴",
  "min": 22.3,
  "max": 31.7,
  "precip": 0,
  "resolved": {
    "name": "北京", "admin1": "北京市", "country": "中国",
    "latitude": 39.9075, "longitude": 116.39723,
    "timezone": "Asia/Shanghai", "ambiguous": true,
    "alternatives": ["北京, 重庆市, 中国", "北京, 四川, 中国"],
    "confidence": "high", "featureCode": "PPLC"
  }
}
```

同日的独立 `curl` 核对（11:15:43Z，比上面晚 9 分钟，走 `timezone=Asia/Shanghai` + `start_date=2026-09-05&end_date=2026-09-06`）返回 `daily.time[1] = 2026-09-06`、`temperature_2m_min` 22.3、`temperature_2m_max` 31.7、`precipitation_probability_max` 0、`weather_code` 3 → 阴，与连接器输出逐字段一致。`record` 通过 `validateContract('connectorItem')`；`occurredAt` 等于 `validFor` 起点，跨度 86400000 ms（`Asia/Shanghai` 无夏令时）。

缺省日期的真实读回（同一轮，未传 `date`）：

```json
{"utcDay":"2026-09-06",
 "北京":{"localDay":"2026-09-06","forecastDate":"2026-09-06","differsFromUtcDay":false},
 "New York":{"localDay":"2026-09-06","forecastDate":"2026-09-06","differsFromUtcDay":false}}
```

`localDay` 由测试内用**另一条独立路径**算出（`zh-CN` locale + `format()`，而实现走 `en-US` + `formatToParts()`），所以断言不会与实现里的同一个 bug 一起错。**但要如实说明**：本轮执行时刻 11:06Z，北京 19:06、纽约 07:06 EDT，两地都还在 9 月 6 日，因此 `differsFromUtcDay` 为 `false`——这次真实读回证明的是「派生出的日期等于独立算出的当地日」，**没有**证明「当地日与 UTC 日会分叉」。分叉本身只由注入时钟的离线测试证明（`2026-09-05T20:00Z` → 北京 `2026-09-06`；`2026-09-06T02:00Z` → 纽约 `2026-09-05`；`2026-09-05T12:00Z` → `Pacific/Kiritimati` `2026-09-06`）。

同日对生产地理编码端点实测（默认 `language: 'zh'`）：

| 查询 | 提示串 | 解析到 | 时区 | `confidence` |
| --- | --- | --- | --- | --- |
| 北京 | — | 北京, 北京市, 中国 | `Asia/Shanghai` | `high`（`PPLC`） |
| 巴黎 | — | 巴黎, 法兰西岛, 法国 | `Europe/Paris` | `high` |
| 东京 | — | 东京, **江苏**, 中国 | `Asia/Shanghai` | **`low`** |
| 伦敦 | — | 伦敦, **安大略**, 加拿大 | `America/Toronto` | **`low`** |
| 罗马 | — | 罗马, **昆士兰**, 澳大利亚 | `Australia/Brisbane` | **`low`** |
| 丽江 | — | 丽江, **湖南**, 中国 | `Asia/Shanghai` | **`low`** |
| 广东 | — | 广东, **重庆市**, 中国 | `Asia/Shanghai` | **`low`** |
| 东京 | `Tokyo` | 東京, 东京都, 日本 | `Asia/Tokyo` | `high` |
| 伦敦 | `London` | 倫敦, 英格兰, 英国 | `Europe/London` | `high` |
| 罗马 | `Rome` | 罗马市, 拉齐奥, 意大利 | `Europe/Rome` | `high` |
| 丽江 | `Lijiang` | 丽江市, 云南, 中国 | `Asia/Shanghai` | `high` |
| 纽约 | `New York` | New York, New York, 美国 | `America/New_York` | `high` |
| 首尔 | `Seoul` | 首尔特别市, 首尔特别市, 韩国 | `Asia/Seoul` | `high` |
| 北京（`language: 'en'`） | — | 北京, 北京市, 中国 | `Asia/Shanghai` | `high` |
| England（`language: 'en'`） | — | 同名小镇，非英格兰 | — | **`low`** |
| Texas（`language: 'en'`） | — | 墨西哥伊达尔戈同名地 | — | **`low`** |
| France（`language: 'en'`） | — | 法国（国家记录 `PCLI`） | `Europe/Paris` | **`low`** |
| 北京（`strict`） | — | 北京, 北京市, 中国 | `Asia/Shanghai` | `high`，接受 |
| 巴黎（`strict`） | — | 巴黎, 法兰西岛, 法国 | `Europe/Paris` | `high`，接受 |
| 东京（`strict`） | — | — | — | **`INVALID_ARGUMENT`**，消息含候选与「改用英文名」提示 |

`纽约` 与 `首尔` 不带提示串时是**零候选**（`NOT_FOUND`），带提示串后正确；表中只列带提示串的一行。显示名的简繁混杂（`東京`/`倫敦` 繁体、`罗马市`/`首尔特别市` 简体、`New York` 未翻译）在同一次运行里同时出现，见已知限制。

**2026-09-30 置信度收口后复测**（次级席位下限 + 已证名佐证落地后，真实端点重跑 live）：48 项 47 过 0 失败 1 跳过（GeoNames 端到端项无账号自动跳过，其余 3 项 live 全过）。真实端点上的行为变化与预期一致——上一轮实测中判 `high` 的五个误解析（东京→江苏、伦敦→安大略、罗马→昆士兰、丽江→湖南、广东→重庆同名地）**现在全部判 `low`**；提示串救回路径全部正常（东京+Tokyo→`Asia/Tokyo`、伦敦+London→`Europe/London`、罗马+Rome、丽江+Lijiang、纽约+New York、首尔+Seoul）；北京当日预报取值与目标地时区日界读回正常（北京/纽约当日 `differsFromUtcDay` 均为 `false`，与执行时刻相符）。

## 已知限制

- **Open-Meteo 不提供预报发布时间**，`occurredAt` 是覆盖日起点而非真实发布时刻，已由 `publishedTimeKind: 'coverage_start'` 显式标注。需要真实发布时间的提供商（如和风天气返回 `forecastStartTime`）可作为第二个 `WeatherProvider` 实现接入，届时标注为 `provider_published`。
- `verification` 为 `conditional` 而非 `verified`：真实读回依赖出站网络可达。本轮实测样本为 20 行地名（含 5 个误解析、6 个提示串救回、3 个区域名、3 个 `strict`、1 个英文配置下的中文输入）与 1 次当日预报取值核对；未做长时段、多日重复采样或大范围地名覆盖。「模型会主动给出 `locationQuery`」这一条**未实测**，按 `docs/CONTRIBUTING.md:102` 标 `draft`。
- 预报范围受提供商模式限制（本轮实测允许区间约当日前 3 个月至后 15 天）；超出返回 `NOT_FOUND` 并附提供商给出的允许范围。历史气候查询不属本模块。
- 摘要文本仅提供中英两套；`language` 设为其他值时地名按该语言本地化，但摘要回退英文。
- **`locationResolution: 'strict'` 的语义在本轮被改变**：从「存在同名候选就拒绝」改为「`confidence` 为 `low` 才拒绝」。改前 `北京`、`巴黎`、`东京`、`伦敦`、`罗马` 在 `strict` 下全部抛 `INVALID_ARGUMENT`（实测），改后前两个可用、后三个被拒且消息给出候选与「改用英文名」提示。**`apps/runtime` 的 `createOpenMeteoRuntime` 正是用 `strict` 装配的**，所以这个改动会改变其生产行为（是修正方向：北京可用，伦敦不再静默返回安大略的天气），但属于对外可见的语义变更，已在 PR 里点名给 `goo122`。
- **简体书写的外国地名：未配置 GeoNames 账号时是「被检出并标注」，配置后可直接纠正**。未配置 `geonamesUsername` 时，默认的 `ranked` 模式仍会返回 伦敦/安大略、东京/江苏、罗马/昆士兰，只是带上 `confidence: 'low'`。根因是 Open-Meteo 的 `language` 参数同时决定「搜哪套名字」——任何中文串在 `language=en` 下恒返回 0 条（繁体 `東京`/`倫敦` 也一样，`zh-TW`/`zh-Hant` 同样为空），而 `zh` 名字集的简繁覆盖逐条不可预测，没有系统性改写规则；不靠调用方给 `locationQuery`（实测能救回大部分；`开罗+Cairo` 曾因小席位被无条件判 `high` 而把提示串层整个挡住，**次级席位人口下限落地后该用例已修复并有测试固定**）。第二地理编码源曾在本包早期实测中判为不可行（`nominatim.openstreetmap.org`、`api.bigdatacloud.net` 连接超时、`photon.komoot.io` 中文覆盖更差且 `lang=zh` 返回 400）；**2026-09-07 该结论被推翻**——`secure.geonames.org` 官方 API 实测可达，其 `name_equals` 参数精确匹配任一语言的已知名（含简体别名），已成为本包的可选精确名层（见行为规则）。简繁映射表方案仍未采用（长尾维护成本高、与数据源 id 不对齐）。
- **置信度误判的两个方向已在规则层收口**（原始实测 2026-09-06，收口 2026-09-30）：
  - *误报*（判 `low` 但其实对）：`阳朔`→广西 `PPL`、`同里`→江苏 `PPL`。GeoNames 这两条记录**没有 `population` 字段**，按 0 处理后落到人口下限之下。**现已由 GeoNames 精确名层佐证收口**：`name_equals` 命中即视为已证名，无人口也判 `high`（有测试固定）；未配置账号时维持 `low`。
  - *漏报*（判 `high` 但其实错）：`凤凰`→重庆市 `PPLA4` pop=14574（真身在湖南）、`Pingyao`→浙江 `PPLA4`（真身在山西）、`Wuyuan`→浙江 `PPLA3`（真身在江西）、`开罗`→伊利诺伊 `PPLA2` pop=1733（真身在埃及）。**现已由次级席位人口下限收口**：`PPLA2`–`PPLA5` 不再无条件判 `high`，需人口 ≥ `minMinorSeatPopulation`（默认 **100000**，取自实测空档：错误小席位 ≤14574 ↔ 正确的最小席位 丽江市 211151）或 GeoNames 已证名。
  - 原最差组合**零候选 + 提示串**（`平遥`+`Pingyao` 落到浙江并标 `high`）：浙江 `Pingyao` 是 `PPLA4` 无人口，收口后判 `low`，提示串不再给它可信标签（提示串采纳条件仍是「自身判 `high`」，下限调低时会重新放入，属配置责任）。
  - `凤凰` 的情况**不再挡住提示串**：原始输入判 `low` 后提示串 `Fenghuang` 会被检索；但其 zh 首条（湖南 `PPL` pop=370000）仍 < 500000 判 `low`，不会被采纳——结果保持「低置信的重庆凤凰」并如实披露，不升级也不静默换地点。
  - 人口下限 500000 取自实测空档（最差误解析 伦敦/安大略 422324 ↔ 正确的非行政中心大城市 纽约 8804190），次级席位下限 100000 同法（14574 ↔ 211151）；均为启发式而非定理，分别经 `minCorroboratedPopulation` / `minMinorSeatPopulation` 调整。
- **`resolved.name` 的简繁混杂不可在本包修**：同一次真实运行里 `東京`/`倫敦` 是繁体、`罗马市`/`首尔特别市` 是简体、`New York` 未翻译。根因是 GeoNames 的 `zh` 备用名本身简繁混合。`/v1/get?id=&language=` 实测 200 可用但**未确认有官方文档**，且它也不统一简繁（id 5128581→`紐約市` 繁体、id 1835848→`首尔特别市` 简体），故不采用。本包只保证显示名确定性地取「配置语言轮优先」，如实反映数据源的写法，不声称统一。
- 每个未命中缓存的地名产生 1–3 次 Open-Meteo 地理编码请求：配置语言以 `en` 开头且输入无汉字时 1 次；否则「配置语言 + `en`」2 次；输入含汉字且配置语言不是 `zh` 时 3 次。带 `locationQuery` 时提示串按同样的规则再跑一轮集合，但**只在原始输入零候选或判 `low` 时才发**。**配置了 `geonamesUsername` 时，汉字输入另加 1 次 GeoNames 搜索 + 每个命中 id 1 次 `/v1/get`（并行、上限 5）**；GeoNames 免费账号日额度 3 万次，搜索与 `/v1/get` 各计 1 次。命中缓存后为 0 次，预报请求次数不变。
- **缺省日期让解析自身失败时无法回退到 stale 缓存**：缓存键含日期，而日期来自解析出的地点，所以解析失败时没有键可查。传显式 `date` 可保留 stale 回退（有测试固定这两种行为）。同理，缓存命中路径也会先解析一次地点——真实提供商由自身的地理编码缓存应答，不产生网络请求。
- 日期按目标地时区解释，但请求中的 `date` 仍是无时区的日历日字符串；「用户本地时区的今天」这一语义待 MOD-13/MOD-20 时区配置确定后接入。
- **`record.externalId` / `dedupeKey` / `contentRef` 的取值语义在本轮变了**：并入了 `locationQuery`（同一 `location` 带不同提示可能解析到不同地点），且缺省 `date` 时其中的日期变成目标地当地日而非 UTC 日。宿主侧若已按旧值持久化过去重记录，需知悉这不是同一套键。
- 缓存为实例内存级，无持久化与跨进程共享；TTL 到期前不感知真实数据更新。地理编码缓存无 TTL，地名变更不会自动刷新。
- 无凭据、无密钥，因此不涉及凭据存储；但真实调用会产生出站请求，Open-Meteo 免费额度（约 600 次/分、10000 次/日）耗尽时返回 `RATE_LIMITED`。
- ConnectorPort 的 `fetchChanges` / `search` / `getItem` / `performAction` 均返回 `UNSUPPORTED_CAPABILITY`：天气为按需查询连接器，非增量同步连接器。
- 本包内部不实现 MOD-05 权限隔离；单包测试的 scope 校验由 testkit `FakeToolHost` 承担。生产组合入口已由 Runtime 装配持久 Policy/ToolGateway，并显式传入严格模式 Open-Meteo Provider；真实模型发起工具调用仍未验收。`WeatherProvider.resolvePlace` 是消费方可见的必需方法，任何自实现 Provider 的下游都必须提供。
