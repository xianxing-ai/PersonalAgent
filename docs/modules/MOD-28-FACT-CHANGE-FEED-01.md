# MOD-28-FACT-CHANGE-FEED-01：事实变化消费首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；本次重建负责人 `goo122`；非作者评审者为 `zemeng` 或其他已登记协作者。
- 分支 `codex/mod-09b-memory-ports-rebuild`，基于 `main@d78613a226b5d490f8f2dd47f3e5c8236a3d7ec2`；状态 `review`。
- 本工作包拥有公开 feed 契约、输入验证器、同一 `FakeMemoryHost` 的消费状态机与本文。

## 解决的问题

已有 MemoryQueryPort 只支持查询，不代表事实变化已被消费。这个工作包补充有界批次、
宿主绑定、bootstrap、重读及确认语义，作为 MOD-27/28 事实投影的前置，不重做查询层。
批次只携带随机 eventId 和精确 FactRef；不公开内部 sequence、隐藏条数或正文。

读者只获得 `FactChangeFeedPort.read`。确认在可信 Fake 宿主侧进行，要求完整已交付批次、
checkpoint CAS 与精确引用匹配；同输入重试返回相同回执。Fake 确认不构成持久投影完成
证明；生产实现必须把投影、去重/影响登记与 checkpoint 放在同一可信本地事务中。

bootstrap 按固定水位选取每个事实最新头版本，再做 scope 过滤，保留可见的未来生效、
过期和 withdrawn 版本；不能用 listCurrent(at) 代替完整基线。旧图依赖不能自动重绑定。
可见性收缩使旧视图失效并要求重建，不复活旧头。查询 snapshot、feed watermark、消费
checkpoint 和 graphRevision 各有用途，不能互换或用于任意跳过未处理事件。

## 当前边界

所有新增接口为 provisional、进程内 TS；没有 wire operation、生产数据库、删除策略、
云端出机、真实私人事实或自动任务提交。无外部 exactly-once 承诺。
保留与删除、历史权限及真实事实出机政策尚需产品确认，但不阻碍合成数据契约首片。
本片不宣称整个 MOD-28 完成。

## 验证

公开批次解析验证器覆盖精确结构、上限、重复身份、输入副本隔离、getter/proxy 错误脱敏。
Node 24.15.0 下 memory 构建通过，解析器目标测试 4/4 通过；其中覆盖数组 Proxy
伪造 length 不能跳过条目验证，以及额外数组属性拒绝。
Fake 状态机目标测试 6/6 通过，覆盖固定 bootstrap 水位、后续 changes、精确重读、空页、
scope/consumer 隔离、可见性收缩重建、确认 CAS/幂等/完整性与取消超时。实际批次同时经过
公开解析器验证。由于 append 在原事实记录增加 eventId，补跑原查询回归 6/6 通过。
查询、解析器与 Fake 状态机合计 16/16 通过，`npm run check:architecture` 与全仓
`npm run check` 通过。未运行生产数据库、真实私人数据或云端验收；这些结果不代表持久
投影、自动认知触发或 MOD-28 全部完成。
