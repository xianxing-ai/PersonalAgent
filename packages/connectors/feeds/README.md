# 订阅采集连接器（MOD-22）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 Potatos498（C）；评审者 `goo122` 或 `zemeng`。包版本 0.1.0-alpha.1。关联需求 [PA-015](../../../docs/PRD.md) 的**采集半边**；汇总、安静时段、暂停与频率设置归 MOD-23（`packages/notifications/`）。

对真实 RSS 2.0 / Atom 源做增量采集：条件请求 + 不透明游标实现增量，稳定的 `dedupeKey` 实现去重，所有派生字段标注来源而不伪造。manifest `verification` 取自 provider——`HttpFeedProvider` 为 `conditional`（结果依赖出站网络可达），`FakeFeedProvider` 为 `mock`。`register` 不默认任何 provider，也不默认任何订阅，装配方必须显式传入，缺失时抛 `INVALID_ARGUMENT`，避免静默构造会发出站请求的东西（DEVELOPMENT_PROTOCOL:173 `fake 明显标记，生产构建不得静默启用`）。

## 2026-09-30 云端业务增量（待本地统一验收）

FeedServiceOptions 和 register 新增 isPaused(subscriptionId) 与 trackRevisions：
暂停由可信宿主持久配置读取，抓取前/后发现暂停则 CANCELLED，调用方保留旧游标。
启用 trackRevisions:true 时 dedupeKey 追加条目投影版本哈希，externalId 仍是原 GUID/链接，
同 GUID 更新可作为新版本投递；默认关闭以保留既有消费者键语义。
P8 首版装配应显式启用；迁移旧游标会重投当前版本一次，宿主按来源对象与版本吸收。
ETag/304、分页水位和游标格式不变。本轮没有运行新增用例或公开源试调。
正式 collect 输出新增可选 sourceReceipt 与对应公开 types/校验函数；实际传输事实、配置绑定、版本/hash 与逐条 citation 见交接说明。
收据不授予 PUBLIC/跟踪权限，private 源保持 private；304 不刷新正文获取时间。
统一交接见 [业务接线说明](../mail/docs/cloud-business-handoff.md)。

## 导出入口

`@personal-agent/feeds`（ESM，类型声明在 `dist/index.d.ts`）：

- `register(host, options)`：向 ToolHost 注册 `feeds.collect` 与 `feeds.subscriptions` 两个工具（均 scope `feeds:read`、`sideEffect: 'read'`），返回 dispose。`options.provider` 与 `options.subscriptions` 必须显式提供；`now`、`defaultLimit`（默认 50，上限 200）可选。
- `HttpFeedProvider`：真实传输层。`options`：`fetchImpl`（注入以便离线测试）、`userAgent`、`maxBodyBytes`（默认 5,000,000）、`maxRedirects`（默认 3）、`source`、`verification`。
- `FeedService`：领域服务。`collect(query, signal?)` 返回 `{items, collection, nextCursor, hasMore, sourceReceipt?}`；`getItem(accountRef, externalId)`；`listSubscriptions()`；`providerVerification` 反映注入的 provider。
- `FeedsConnector`：ConnectorPort 适配（manifest `id: 'feeds'`、`accountTypes: []`、capabilities `['collect']`、`authentication: 'none'`、`syncStrategy: 'poll'`）。
- `parseFeedDocument` / `parseFeedDate` / `decodeXmlEntities` / `toPlainText`：解析与日期归一化，可独立使用。
- `encodeCursor` / `decodeCursor` / `appendSeen`：游标编解码。
- `makeContentRedactor` / `makeErrorRedactor` / `secretNeedles`：脱敏。
- `FakeFeedProvider` / `defaultFeedFixtures`：离线夹具，见下。

## 消费的公共版本

`@personal-agent/contracts` 0.1.0-alpha.1（wire 1.0.0）；每条记录用 `validateContract('connectorItem')` 校验；工具输出 schema 以 `$ref` 引用协议 `$id` 下的 `ConnectorItem` 定义，不复制契约（照 MOD-25 的机制）。fake 联调用 `@personal-agent/testkit` 0.1.0-alpha.1（FakeClock / FakeToolHost）。哈希用 `node:crypto` 的 SHA-256，HTTP 用 Node 内置 `fetch`。

**新增外部依赖 `fast-xml-parser` 5.11.1**（MIT，registry.npmjs.org，带 integrity 锁入 `package-lock.json`；6 个传递依赖，全部 MIT）。这是本仓库首次为非契约包新增外部依赖，理由与核实结果：

- Node 无内置 XML 解析器。手写 RSS/Atom 解析器要正确处理 CDATA、命名空间前缀、属性形态、注释与 DOCTYPE 跳过，其正确性与安全风险都高于引入一个成熟解析器——本包的安全边界建立在「解析器不展开实体」之上，自己写反而更难保证。
- 选 5.11.1 而非计划阶段假设的 v4：**v4.5.7 有 GHSA-gh4j-gqv2-49f6**，v5 是当前维护线。
- `npm audit`：本包引入的依赖树**零告警**。仓库唯一的 1 项 moderate 是 `ajv` 的 GHSA-2g4f-4pwh-qvx6（`$data` 选项 ReDoS），属 `@personal-agent/contracts` 的既有依赖，**不是 MOD-22 引入**，且本仓库不使用 `$data`；修复需超出声明范围升级，归 `goo122`。
- CI（`.github/workflows/ci.yml`）不执行 `npm audit`，上述结果由本机 `npm audit` 取得。

## 行为规则

- **订阅是配置，不是工具入参**：`feeds.collect` 只接受已配置的 `subscriptionId`。模型可选的 URL 是 SSRF 入口；订阅 URL 还可能带 token，而 CONTRIBUTING:71 规定 `账号凭据不放进配置示例、前端状态、提示词、数据库明文字段或日志`。因此 **URL 不出现在记录、工具输出、错误信息与 `skipped[]` 中**，`feeds.subscriptions` 只返回 `id`、`title`、`sensitivity`。
- **脱敏分两档**：派生文本（`contentRef`、`externalId`、`title`、`summary`）用外科手术式的 `makeContentRedactor`，只移除配置 URL 本身、其查询串与长度 ≥8 的普通查询参数值，以及任意长度的用户名/密码/凭据参数；嵌入的 session/credential URL 整段脱敏——因为条目链接是合法的公开内容，摘要本来就要跟着它走。错误信息用 `makeErrorRedactor`，额外清扫任意绝对 URL、凭据形态的 `key=value`，以及**裸主机名**（Node 的 DNS 失败形如 `getaddrinfo ENOTFOUND host`，既不含 scheme 也不含完整 URL，而主机名仍是配置 URL 的片段）。裸主机名按边界匹配替换，避免损坏恰好包含该串的普通词。
- **`feeds.collect` 严格无状态**：游标从入参来、`nextCursor` 从出参走，包内不保存任何订阅级游标。宿主持久化批次后推进游标（DEVELOPMENT_PROTOCOL:139），若工具自己也推进，一次调用就会改动宿主轮询器依赖的状态，在接缝处造成漏投或重投。
- **失败时抛错，不返回原游标**：`ConnectorPort.fetchChanges` 要么返回 `{items, nextCursor, hasMore}` 要么抛（contracts `ports.ts:25`）。返回「空 items + 原 cursor」会让宿主分不清「304 无更新」和「源挂了」，属 PRD:101 禁止的静默伪造降级。抛错则宿主拿不到 `nextCursor`，游标自然停在原处，不跳不重。
- **不做 stale 回退**（与 weather 不同）：重发上一批有重复投递风险。
- **游标用有界 `seen`，不用 watermark**：`{v:1, etag?, lastModified?, seen[]}`，base64url 不透明串；`seen` 是已投递 `dedupeKey` 的有界 FIFO（上限 200）。watermark 被推翻的原因：回填日期的条目（发布时刻早于水位线、但更晚才出现在 feed 里——少数派改 `pubDate` 重发是现实场景）会低于水位线，一旦被 FIFO 淘汰就**永久漏掉**。去掉水位线后每次成功抓取投递所有不在 `seen` 里的条目，重复交给宿主按 `dedupeKey` 吸收，feed 重排因此不影响正确性。
- **`limit` / `hasMore` 与验证器推进互斥**：按时间新→旧取前 `limit` 条未 seen 的条目，`seen` 只追加本次真正投递的 key。**截断发生时 `nextCursor` 不推进验证器**——若推进，下一次轮询会拿到 304 并报 `unchanged`，超出 limit 的尾部条目将永远无人投递；不推进则强制全量重取，再由 `seen` 精确过滤出剩余部分。
- **两个来源标注，缺则跳过而不编造**（照 MOD-25 `publishedTimeKind` 的诚实模式）：
  - `dedupeKeyKind ∈ {item_guid, item_link, content_hash}`：RSS `<guid>` / Atom `<id>` 优先，其次 `<link>`，再次对归一化 title+date+content 取 SHA-256。title 与正文**都为空**时返回 `null` 并跳过该条——对全空元组取哈希会让所有这类条目拿到同一个 key，把不同条目静默合并成一条。
  - `occurredAtKind ∈ {item_published, item_updated, feed_build}`：RSS `pubDate`/`dc:date` 或 Atom `published` → Atom `updated` → feed 级 `lastBuildDate`/`pubDate`/`updated`。取到 feed 级时间时用 `feed_build` **标注后投递**，不跳过；只有连时间带标识都无从取得时才跳过。`fetchedAt` 永不冒充 `occurredAt`（DEVELOPMENT_PROTOCOL:143）。
  - `validFor` **刻意不输出**：feed 条目不声明有效期，编一个就是对来源的无据断言。
- **`skipped[]` 带位置不带内容**：每条 `{index, reason}`，`reason ∈ {no_identifier, no_occurred_at, no_identifier_and_no_occurred_at}`。用文档位置而非条目内容做提示，避免把源内容写进日志（DEVELOPMENT_PROTOCOL:167）。
- **排序稳定**：新→旧，同一时刻按文档位置。源在两次轮询之间重排时，同一批条目仍产生同一序列。
- **日期解析自己写**：`new Date(string)` 对 RFC 822 的处理是实现定义的（ECMA-262 只规定 ISO 8601 子集），不同引擎对 `GMT`/`EST`/`EDT`、两位数年份、多余空白结果不一致。`parseFeedDate` 显式处理 `+0800`、`-0500`、`+08:00`、`GMT`/`UTC`/`EST`/`EDT`/`CST`/`PST` 等真实写法并归一化到 UTC，输出必符合契约 pattern `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$`。**解析不出返回 `null`，不猜**：无偏移的 RFC 3339、未定义或军用时区缩写、两位数年份（世纪是猜测）、越界字段、闰秒（`:60` 在 JS `Date` 中无表示，任何换算都是猜测）一律拒绝。
- **链接与 id 要解实体**：`<link>` 与 `<guid>` 是 URL 而非散文，合规 XML 必须把查询分隔符写成 `&amp;`。不解码会让 `contentRef` 带上字面 `&amp;`，宿主给出的链接不可解析。正文与标题走 `toPlainText`：**先解实体再去标签**——少数派真实发布 `&lt;a href=&#34;…&#34;&gt;查看全文&lt;/a&gt;`，先去标签会把字面 `<a href="…">` 留在摘要里。
- **条件请求按源能力退化**：有验证器就带 `If-None-Match` / `If-Modified-Since`，304 → `items: []`、`state: 'unchanged'`；无验证器 → 全量抓取、`state: 'fetched'`，靠 `seen` 过滤。`collection.conditional` 报告本次是否真的发了条件头；`collection.validators` 报告**本次响应**给了什么——全量抓取时缺哪个就报 `null`，回显上一次的值等于声称一个已不存在的条件请求能力。
- **分页进度与去重窗口分离（2026-09-07 修复）**：游标携带两个独立结构——`seen`（200 键 FIFO，跨轮去重与回填保护，语义不变）与 `pass`（当前分页趟的水位线，排序键＝`occurredAt` 降序＋`externalId` 升序的稳定组合）。趟开放期间，水位线之上的条目视为本趟已交付，不受 `seen` 窗口淘汰影响——修复前超过 200 条的 feed 会在翻页中途把已交付头部淘汰出 `seen` 而重新进入分页，死循环且重复投递。趟取尽即清除水位线；中途 304 原样保留趟状态。游标大小上限（64k 字符）与 `SEEN_LIMIT` 不变；超过 `seen` 窗口的轮间重复投递仍由宿主按 `dedupeKey` 吸收（原设计不变）。

## 不可信内容

`<description>` / `<content>` **永不按 HTML 解释**。输出只有 `contentRef`（条目链接）与去标签、解实体、限长 280 字符的纯文本 `summary`。ARCHITECTURE:121 `外部消息、网页、笔记、工具结果均不可信，不能覆盖用户指令或扩展授权`。

实体处理是本包的安全边界，机制分三层，均已由测试固定：

1. 解析器选项 `processEntities: false`——库不做任何实体解码。
2. 自己实现的 `decodeXmlEntities` **只认 5 个预定义 XML 实体与数字字符引用**，没有 DOCTYPE 表、没有自定义实体表、没有外部实体取数能力，因此未定义引用如 `&lol4;` 原样保留，实体膨胀（billion laughs）在这条路径上无从展开。
3. 解析前先查根元素，再交 `XMLValidator.validate`；外部实体声明由 validator 拒绝。

`fast-xml-parser` **自身带有 `DocTypeReader`**，所以「该库无 DTD 能力」不成立；成立的是上面这条：**本包的配置关掉了库的实体处理，代之以一个没有实体表的解码器**。畸形 XML 只报错误码与行列号，**从不引用源内容**，避免把不可信文本带进日志。响应体上限 5 MB（按块累计，不信 `Content-Length`：分块编码不给该头，gzip 给的是压缩后大小）。

## 错误映射

| 情况 | 协议错误码 | 可重试 |
| --- | --- | --- |
| 订阅 id 未配置 | `NOT_FOUND` | 否 |
| URL 不可解析 / scheme 非 http(s) / 订阅配置无效 / `limit` 越界 | `INVALID_ARGUMENT` | 否 |
| 404、410 | `NOT_FOUND` | 否 |
| 429 | `RATE_LIMITED`（`retryAfterMs` 取 `Retry-After`，delta-seconds 与 HTTP-date 两种写法都支持，缺省 60s，上限 24h） | 是 |
| 5xx、网络失败 | `EXTERNAL_FAILURE` | 是 |
| 超时类错误码（`UND_ERR_*_TIMEOUT`、`ETIMEDOUT`、`ECONNABORTED`） | `TIMEOUT` | 是 |
| 证书类错误码（`UNABLE_TO_VERIFY_LEAF_SIGNATURE` 等） | `EXTERNAL_FAILURE` | 否（重试不会让证书变可信） |
| **401、403** | `EXTERNAL_FAILURE` + 脱敏原因 | 否 |
| **200 但 body 不是 rss/feed** | `EXTERNAL_FAILURE` | 否 |
| XML 畸形 / 外部实体 / 超出大小上限 | `EXTERNAL_FAILURE` | 否 |
| 游标畸形、版本不符、含 CRLF 的验证器、超长 | `CURSOR_EXPIRED` | 否 |
| 信号已取消（抓取前、抓取后、读 body 中各检查一次） | `CANCELLED` | 否 |

401/403 **不映射 `UNAUTHORIZED`**：manifest 是 `authentication: 'none'`，公开源没有可修复的「授权状态」，公开 feed 上的 403 实际多是反爬过滤，重试无用；`UNAUTHORIZED` 留给将来真正带凭据的订阅。

## 最小夹具

`FakeFeedProvider`（`source: 'fixture-feeds'`、`verification: 'mock'`）内置 1 条 2 项的合成 RSS 夹具，`setFixtures(list)` 可换、`setFailure(error)` 可模拟提供商失败、`fetchCalls` 记录调用。它遵守条件请求语义（带匹配的 `etag`/`lastModified` 时返回 `unchanged`），因此 304 路径在离线测试里也能被真实走到，而不是被 mock 掉。

`test/fixtures/` 共 11 个文件。**3 个取自真实生产端点**（截断保存，每个文件的注释里记录了来源与每一处偏离）：`ruanyifeng-atom.xml`（阮一峰的网络日志，真 Atom，`tag:` 形式 id，`published` 与 `updated` 不同）、`sspai-rss.xml`（少数派，RSS 2.0，**10 条 item 零个 `<guid>`**，`+0800` 偏移，`description` 内含 HTML 转义标记，**无 ETag / Last-Modified**）、`html-body-not-a-feed.html`（36kr 的 `/feed` 返回 200 但 body 是 `<!DOCTYPE html>`，即真实的「200 但不是订阅源」案例）。**8 个合成夹具**，每个固定一条规则：`date-formats.xml`（11 种真实日期写法，期望 UTC 结果写在 title 里）、`rss-guid-variants.xml`、`atom-fallbacks.xml`、`dc-namespace-rss.xml`（`dc:date` 与回填条目）、`no-key-no-date.xml`、`malformed.xml`、`entity-expansion.xml`、`external-entity.xml`。

## 验证方法

仓库根目录执行：

```sh
npm ci
npm run check            # check:generated + build + typecheck --workspaces + test --workspaces
npm run typecheck --workspaces
npm run test --workspaces
```

真实读回需显式开启，与模拟测试分开：

```sh
PA_FEEDS_LIVE=1 node --test packages/connectors/feeds/test/live-feeds.test.mjs
```

本轮结果（2026-09-06，Windows 本机，node v24.18.0 / npm 11.16.0，**已合并 main `fae0706` 之后的树上**）：`npm ci` 成功；根 `npm run check` **退出码 0**；10 个工作区类型检查全部通过。全仓 **156 项测试，154 通过、2 跳过**（feeds 74：73 通过 + 1 项真实读回默认跳过；weather 34：33 + 1 跳过；testkit 13、runtime 8、tool-gateway 7、client 5、connector-host 4、contracts 4、storage 4、policy 3）。

**注意**：本机 node/npm 版本高于 `engines` 声明的 `24.15.x` / `11.12.x`，`npm ci` 报 `EBADENGINE` 警告但不失败。**声明版本由 CI 覆盖**：PR #8 在 head `f4bf05c` 上的两次 `Foundation` 工作流运行均在 `windows-latest` / node **v24.15.0**（取自 `.node-version`）下通过，5 个命令步骤——`npm ci`、`npm run check`、`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime`——全部 success（run `34023109254` 用时 4m7s、`34023106553` 用时 4m12s）。

本包 74 项按文件分布：

- `test/parser.test.mjs` **19 项**：12 种真实日期写法的归一化、14 种必须拒绝的写法（各带拒绝理由）、`date-formats.xml` 全部 11 条期望（含两条必须退化为 `feed_build` 的）、两个真实源的结构、HTML body 拒绝、畸形 XML 只报位置不引用源、实体不展开（含 <500ms 时间闸）、外部实体拒绝、`__proto__` 拒绝且不泄漏解析器内部路径、体积上限、缺 channel 与空 channel 之别、**CRLF/孤立 CR 与 LF 解析结果等价**（仓库无 `.gitattributes` 且 `core.autocrlf=true`，CI 检出为 CRLF）、实体解码范围、先解码再去标签、Atom `rel` 选择（enclosure 不算条目页）、`dc:date` 与回填与同刻稳定排序、空 item 仍按位置计入、链接与 id 的实体解码。
- `test/feeds.test.mjs` **28 项**：`register` 缺 provider / 空订阅 / 重复 id / 非法 URL / 非 http(s) / `defaultLimit` 越界 → `INVALID_ARGUMENT`；未知订阅 → `NOT_FOUND`；`limit` 范围；`dedupeKeyKind` 三级链；`occurredAtKind` 链与 `fetchedAt` 不冒充；`validFor` 缺席；稳定排序；**同一批投递两次按 `dedupeKey` 不重复**；工具无状态；分页与**回填条目仍被投递**；**`hasMore` 时验证器不推进**（4 次轮询序列，末尾真实走到 304）；验证器中途消失的退化；`seen` 有界；游标篡改 8 例 → `CURSOR_EXPIRED`；HTML body 失败；provider 失败传播；取消；**token 脱敏覆盖每一个输出面**；`feeds.subscriptions` 从不返回 URL；经 `FakeToolHost` 的 scope 拒绝、ajv 实际校验输出、dispose；manifest / health / 生命周期；`fetchChanges` 只返回裸记录（断言恰好 8 个键）；`getItem` 按 `externalId` 定位。
- `test/http-feed.test.mjs` **26 项**：自报 UA 与 Accept、`redirect: 'manual'`；条件头发送与验证器回报；304 沿用发出的验证器 / 采用响应刷新的验证器；无验证器时不出现相关键；7 种状态码映射；429 的 `Retry-After` 五种情形（delta-seconds、缺省、IMF-fixdate、不可解析、超范围需封顶）；相对重定向保留条件头；**每一跳都复验 scheme**（`file:` 跳永不被请求）；重定向跳数上限；空白 `Location` 不被跟随；按声明长度与按块两种体积上限；流在成功与失败后都被 cancel，且 cancel 自身抛错不覆盖真实错误；`text()` 回退与其上限；6 种传输错误码分类；取消在抓取前不发网络请求、读 body 中被取消不误报为外部失败；不可解析与不可 fetch 的 URL；**传输失败不携带 URL、token、主机名或路径，但保留可行动的错误码**；裸主机名按边界脱敏且不损坏包含该串的普通词；未配置主机的凭据形态查询对被中和；状态与重定向失败也不具名 URL；超大 body 只报上限不报内容。
- `test/live-feeds.test.mjs` **1 项**（默认跳过）。

## 真实读回证据

2026-09-06 于 Windows 本机对两个生产端点实际执行（`PA_FEEDS_LIVE=1`），每个源各两轮，UA 为自报的 `personal-agent-feeds/0.1.0-alpha.1`。实测 HTTP 状态序列，即证据本身：

```json
[
  {"url":"www.ruanyifeng.com","status":200,"conditional":false},
  {"url":"www.ruanyifeng.com","status":304,"conditional":true},
  {"url":"sspai.com","status":200,"conditional":false},
  {"url":"sspai.com","status":200,"conditional":false}
]
```

恰好 4 次请求：无重定向、无重试。**第二轮对阮一峰真实观察到 304**；少数派两轮都是 200，因为它根本不发验证器，第二轮是全量重取后由 `seen` 过滤到零。下文引用的完整输出取自 `2026-09-06T08:26:39Z` 那次运行；`08:34:25Z` 的第二次完整运行给出**相同的状态序列与相同的验证器取值**；合并 main `fae0706` 之后于 `08:45:03Z` 又完整重跑一次，状态序列与验证器取值仍**完全一致**，即合并后的树依然能真实连通两个生产源。

```json
{
  "ruanyifeng": {
    "validators": {"etag": "\"11425-65abd7a6ed870-gzip\"", "lastModified": "Sat, 05 Sep 2026 14:48:29 GMT"},
    "feedKind": "atom", "feedTitle": "阮一峰的网络日志",
    "parsed": 3, "delivered": 3, "fetchedAt": "2026-09-06T08:26:39.909Z",
    "secondState": "unchanged",
    "sample": {
      "externalId": "tag:www.ruanyifeng.com,2026:/blog//1.2555",
      "dedupeKey": "http-feeds:ruanyifeng:item_guid:tag:www.ruanyifeng.com,2026:/blog//1.2555",
      "dedupeKeyKind": "item_guid",
      "occurredAt": "2026-09-03T23:59:05.000Z",
      "occurredAtKind": "item_published",
      "contentRef": "http://www.ruanyifeng.com/blog/2026/09/weekly-issue-411.html",
      "title": "科技爱好者周刊（第 411 期）：OpenClaw 2.0 是一个缩影"
    }
  },
  "sspai": {
    "validators": {"etag": null, "lastModified": null},
    "feedKind": "rss", "feedTitle": "少数派",
    "parsed": 10, "delivered": 10, "fetchedAt": "2026-09-06T08:26:40.372Z",
    "secondState": "fetched", "secondAlreadySeen": 10,
    "sample": {
      "externalId": "https://sspai.com/post/114076",
      "dedupeKey": "http-feeds:sspai:item_link:https://sspai.com/post/114076",
      "dedupeKeyKind": "item_link",
      "occurredAt": "2026-09-06T07:00:00.000Z",
      "occurredAtKind": "item_published",
      "contentRef": "https://sspai.com/post/114076",
      "summary": "对于使用AppleWatch游泳的人来说，记录一次游泳并不困难。在手表上打开体能训练App，选择开始游泳，结束后就能在Apple健身中看到完整的游泳表现，包括时"
    }
  }
}
```

证据要点：阮一峰的 `tag:` 形式 id 走 `item_guid`；少数派**零个 `<guid>`**，全部 10 条走 `item_link`，`externalId` 就是文章 URL；两个源都是 `item_published`，即条目自带发布时间，没有退化到 `feed_build`；`summary` 是纯文本且已截断，源里的 HTML 转义标记被正确解码后剥离；每条记录通过 `validateContract('connectorItem')`；序列化后的完整输出不含任一订阅 URL。

`contentRef` 保留源自己写的 scheme——阮一峰的 `<link>` 是 `http://` 而非 `https://`，本包不改写来源数据。

计划阶段选定 GitHub Atom（`github.com/*/{releases,commits}.atom`）作为真实源之一，但**本机取不到**：Node fetch 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，curl 报 `CRYPT_E_NO_REVOCATION_CHECK`；`v2ex.com/index.xml` 连接超时。故改用阮一峰的 Atom 源（同为中文源，且支持条件请求，能真实演示 304 增量路径，GitHub 反而演示不了）。两个真实源刚好覆盖「有验证器」与「无验证器」两条路径。证书类错误码的非可重试分类即由这次真实失败固定。

## 给 MOD-23 的边界

**走 `ConnectorPort.fetchChanges` 的消费者只拿得到干净的 `ConnectorItem`**——没有 `summary`、没有 `title`、没有 `dedupeKeyKind` / `occurredAtKind` 来源标注。原因是 `ConnectorItem` 为 `additionalProperties: false` 且契约归 `goo122`，本包不能改；额外字段按 MOD-25 的机制放在**工具输出信封**里。

所以：**MOD-23 若要正文或标题，用 `contentRef`（条目链接）自取；纯文本 `summary` 与来源标注只在 `feeds.collect` 工具通道可用。** 这不是缺陷而是边界，但 MOD-23 的汇总设计必须知道它。

轮询调度不在本包内：MOD-22 不建常驻调度器，轮询由宿主 / MOD-03 驱动（ARCHITECTURE:91 `本地首版优先支持可行的轮询，不假设存在公共回调地址`）。游标与批次的持久化归宿主。

## 已知限制

- **`health()` 只能返回 `{state}`**（`ready` / `degraded` / `unavailable` / `disconnected`）。DEVELOPMENT_PROTOCOL:141 要求 health 附「最后成功时间和脱敏原因」，但 contracts `ports.ts:29` 的返回类型只有 `state`，加字段要改契约（归 `goo122`）。按 MOD-25 的做法只返回 state，缺口在此登记。此外 `state` 只反映连接生命周期，**不反映上一次采集是否成功**——包内无状态，没有「上次」可记。
- **未实现重定向目标的私网/链路本地地址过滤**。订阅 URL 是运维配置而非模型输入，本模块强制的边界是**每一跳复验 scheme**（`http:`/`https:`）加跳数上限；再往下需要 DNS 解析结果比对，且会打断合法的自托管 feed，本机也无法验证，故本轮不做，在此登记而不假装已防。
- **`seen` 上限 200**：一个源单次投递超过 200 条新条目、且宿主连续 200 次轮询都不消费完，才可能淘汰尚未投递的 key。按 `limit` 上限 200 与 `hasMore` 不推进验证器的设计，正常翻页不会触及。
- **回填窗口受 `seen` 上界限制**：去掉 watermark 解决了「回填条目被水位线永久挡住」，但一个早于 200 条之前、且从未被投递过的条目仍可能因 FIFO 淘汰而被重复投递。重复由宿主按 `dedupeKey` 吸收，方向是「可能重投」而非「可能漏投」。
- 只支持 **RSS 2.0 与 Atom**。JSON Feed、RSS 1.0/RDF、Webhook、带凭据的私有订阅、正文全文抓取均不在本工作包。
- `dc:date` 等命名空间扩展按 local name 回退读取，但只覆盖日期；其他命名空间扩展（`media:`、`content:` 之外的）不解析。
- `summary` 限长 280 字符、`title` 限长 200 字符，超出以 `…` 结尾；这是纯文本摘要而非全文。
- 摘要与标题的实体解码**只覆盖 5 个预定义 XML 实体与数字字符引用**，HTML 命名实体（如 `&nbsp;`、`&mdash;`）原样保留。这是刻意的：支持 HTML 实体表等于引入一张可被源影响的映射表。
- **少数派的 channel 级 `<pubDate>` 存在**（计划阶段记录为「无 `lastBuildDate`」，不完整）：因此该源一条没有自身日期的 item 会带 `occurredAtKind: 'feed_build'` 投递，而不是被跳过。
- **scope 校验未经真实网关验证**：MOD-05 已交付 `packages/policy`、`tool-gateway`、`connector-host`（main `f69a745`，台账状态 `review`），其 `ToolGateway` 实现的是 `@personal-agent/contracts` 里同一个 `ToolHost` 接口，`register(host, options)` 结构上可直接接入。但本包测试只用 testkit 的 `FakeToolHost` 验 `feeds:read`，从未跑过真实网关与策略端口，因此不能声称权限隔离已通过。本包也尚未接入 `apps/runtime`（MOD-03）的根装配，装配时需显式传入 `new HttpFeedProvider()` 与订阅列表（归 `goo122`）。
- `verification` 为 `conditional` 而非 `verified`：真实读回依赖出站网络可达，本轮只覆盖 2 个源、各 2 轮、约 19 分钟内的三次完整运行（`08:26:39Z`、`08:34:25Z`、合并 main 后 `08:45:03Z`）；未做长时段、多源、跨小时的重复采样，也未验证源在真实更新时间点上的增量投递（那需要等待源发布新条目）。
- 真实调用会产生出站请求。源返回 429 时映射为 `RATE_LIMITED` 并带 `retryAfterMs`，但**本包不做请求节流与调度**，频率控制归 MOD-23 与宿主。
