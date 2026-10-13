# MVP-TWIN-B-INTEREST-01：持续兴趣的合法选项

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-28；负责人 zemeng。
- 状态：`review`；依赖 #187 的 InterestPolicy 与 #190 的主动选择/AgentArts 交接方向。
- 所有权：`packages/cognition/**` 和本文件；根接线及连接器注册由主任务负责。

复用 `decideInterest` 判断哪些方案具备依据，再由 Laya 从多个合法方案中选择，
将选择和来源/版本依据交给 AgentArts 编排。该组件不创建订阅、任务库、计时器或爬虫，
不把模型选项或分数当作执行授权。

- 单次偶然问题只允许保留临时兴趣线索或暂缓，不产生长期跟踪选项。
- 只有充分上下文证据、已核验公开低风险来源和有效跟踪 scope 同时存在，才提供
  `track_public`，并绑定来源版本、scope 版本、精确证据和到期时间。
- 已撤销兴趣只提供停止或保持撤销；模型不能覆盖用户撤销，也不能生成重新开启事件。
- 来源不可用、证据衰减或 scope 不允许时，不把跟踪藏在其他选项的描述或参数中。
- 推理返回后复查当前时间与原始绑定；执行阶段仍须由可信宿主检查最新的撤销与来源状态。
  纯快照无法证明推理期间外部权限未变化。

输出保留 `calibrated: false` 及 `requiresHostRevalidation: true`。
本地证据内容不因此取得出云许可；AgentArts 只接收主宿主批准的最小投影。
低风险事项按已有授权自动推进，重大权限才通知用户，不要求每个兴趣判决人工点选。

公开入口为 `buildInterestOptions(input)` 与
`new LayaInterestDecisionService(chooser, now).choose(input, {deadline, signal})`。
调用方只在 `outcome === 'selected'` 且存在 `selected` 时交接所选方案；
`policy` 与 `options` 保留原判决记录，不能单独当作推理完成后的有效执行决定。
`receipt` 绑定来源、证据、scope、选项与有效期；宿主在派发时复核最新状态。

验证：cognition 构建与类型检查通过；定向测试 6/6 通过，覆盖单次问题、
持续兴趣、撤销、过期、非法枚举、伪造选项、异步输入变化与回执绑定。
模型推理使用显式 Fake，未运行真实 Laya 或真实 AgentArts。
本机 Node 26.3.0 / npm 11.16.0 与仓库期望的 24.15.x / 11.12.x 不同；未更改工具链。

没有 contracts、数据库迁移、新依赖或业务连接器变更。
主任务仍需接入兴趣证据来源、最新 scope 状态及 AgentArts 的最小出云交接。
真实订阅来源、次日知识更新和生产持久撤销链尚未验收；本包不改变接口冻结状态。

## 当前源码接线核对（2026-10-07）

来源基线为 `main@4b5ec61`。以上日期、工具链与测试数量保留各原工作包的历史结论；
其中“主任务仍需接入”按以下当前源码状态理解，不再作为另建消费者的待办。

[既有 Desktop knowledge-watch-host](../../apps/desktop/electron/knowledge-watch-host.js)
已消费 `buildInterestOptions`、`LayaInterestDecisionService` 和
`planKnowledgeReevaluation`。`consumeInterestTask` 从可信 reader 读取 Runtime
任务绑定的兴趣证据，保存原始 intake 身份与未知/完成回执，在判断及提交阶段复核原任务、
来源和跟踪许可；已完成回执复用当前 watch，不能重开已撤销兴趣。已有 due/source-change
路径复用 Runtime 调度和知识重评估，不需要新增任务库或另一宿主。

[Desktop main](../../apps/desktop/electron/main.js) 已装配该宿主的 Laya、
`readInterestSignal`、当前 tracking grant、原生 feed 工具及其持久执行证据 reader。
该 reader 检查公开无凭据传输证据、来源配置、原始读取回执和有效期，才生成兴趣输入；
消费者身份、内容哈希和成功检查时间来自这些原始绑定，不能由摘要或模型输出补造。
本地接线场景见
[兴趣任务检查](../../apps/desktop/test/knowledge-watch-interest-task.test.mjs)、
[due/撤销检查](../../apps/desktop/test/knowledge-watch-due.test.mjs) 和
[feed 消费检查](../../apps/desktop/test/knowledge-watch-formal-feeds.test.mjs)。

这是现有源码接线的校正，未在本次启动真实订阅、Laya、AgentArts 或桌面进程。
真实来源的次日更新、生产持久撤销和云端最终读回仍需现场验收；源码装配和本地场景
不能替代该验收，也不改变原接口冻结状态或将 MOD/MVP 标记 done。

## 选择收据的跨语言稳定摘要（2026-10-08 续接）

同一精确公开 evidence、scope、来源、时刻和模型选择，原 receipt 证据排序依赖
localeCompare，在 en-US/sv-SE 下生成不同 digest。只将原 fresh-copy 的四字段 ref
tuple 排序改为 code-unit 比较，保持原字符串、重复项数及全部 binding 字段；不改
policy/options/选择/freshness/deadline，不迁移旧 receipt，也不改知识 watch 或 Runtime。
当前 Desktop 存 modelReceiptId，没有以此 digest 去重，未证明重复 tracking 后果。

EXACT2 manifest SHA256 782dd30b501adc4b851854dc017ba0b39d50fa0f9cb9c15e3c40b5c733f68a54，
source7dac4ffb/testcee8a733，17 artifacts 与原 discovery 证据保留。Node24.15 portable
原正式42789/d42230 actual1；cognition build7653/bee61f、受影响两文件39483/c035fa
actual0、10/10。fresh 公开 service8a0371 actual0，同输入两 locale 的完整 result
与 digest 相同；精确 scope/source/evidence ref 改变仍产生不同 digest。旧 compiled
与原 source ESM emit 逐字相同，合法旧证据未改写。Chooser/infer 为显式 Fake，无
SQLite、真实来源、跟踪、云或外部写验收；前1f548检查不覆盖本增量，后续根检查另记。
