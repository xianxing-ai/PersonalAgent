# MOD-09B：MemoryQueryPort 与离线 Fake 首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- Profile：`huawei_ict_agentarts`。
- 基线：`main@d78613a226b5d490f8f2dd47f3e5c8236a3d7ec2`。
- 分支：`codex/mod-09b-memory-ports-rebuild`；负责人：`goo122`；状态：`review`。
- 非作者评审者：`zemeng` 或其他已登记协作者；集成追加根构建、lock workspace 登记与接口目录，无外部依赖。
- 独占范围：`packages/memory/**`、相关 ADR/模块记录、接口目录与根 workspace 登记。
- 公共入口：`@personal-agent/memory`、`@personal-agent/memory/testing`。

## 交付范围

本片提供 provisional、进程内的 `MemoryQueryPort`，包含：

- `listCurrent`：在固定水位按显式 UTC 时刻查询最新、active 且位于半开有效期内的事实；
- `listHistory`：按稳定 fact ID 有界回放固定水位内的版本历史；
- `getVersion`：读取精确 `FactRef`；
- `FakeMemoryHost`：可信 host 显式 provision/append/bind，并在 bind 时固定 namespace 与
  `allowedSensitivities` 枚举集合；
- `readFactForImpact`：仅经公开端口读取一个精确事实版本的纯消费者入口。

消费者不能选择 namespace、改变 scope、写事实、访问 host、创建任务或调度工作。
`allowedSensitivities` 是显式集合，不推断 public/private/restricted 的等级关系。
精确版本不存在或超出 scope 时统一返回固定 `SCOPE_DENIED`，避免错误正文泄露事实身份。
未 provision 的 namespace 只在可信 host 的 bind/append 表面返回 `NOT_FOUND`。

事实字段固定为稳定 ref、bounded summary、sourceRef、observedAt、validFrom/validUntil、
sensitivity、active/withdrawn、confirmation 和可选 corrects。时间必须为带毫秒的 canonical
UTC，版本按 fact ID 单调递增；revision 2 以后必须精确修正前一版本。withdrawn 最新版本
不会让旧 active 版本重新成为 current；最新版本不可见时也不会回退暴露旧版本。

## 水位、分页与生命周期

Fake 为首次列表查询生成随机 opaque snapshot token；分页 cursor 绑定该 snapshot、查询
种类、完整过滤条件、namespace 和精确 scope 集合。并发追加的新版本只出现在新 snapshot。
跨查询种类、过滤条件、namespace 或 scope 复用 token，以及未知 token，均返回相同的
`INVALID_ARGUMENT`。返回数据为隔离副本。

Fake 对畸形输入及抛错 getter/proxy 统一收敛为固定校验错误；这只是测试 host 边界的防御，
不是宿主进程安全沙箱。`readFactForImpact` 假定注入的是类型合规端口，只核对返回的精确
`FactRef`，不宣称完整校验任意恶意端口的全部事实字段。

token 只保存在 Fake host 内存，没有默认保留期或清理策略；进程重启后不恢复。本片不以
此冒充持久 cursor。所有查询要求调用者提供未来 canonical UTC deadline 与 AbortSignal，
取消或到期不返回部分页面。

## 排除项与后续约束

- 本重建同时带回 provisional `FactChangeFeedPort` 与 Fake 确认语义，详见
  [MOD-28-FACT-CHANGE-FEED-01](./MOD-28-FACT-CHANGE-FEED-01.md)；生产提供者、持久
  checkpoint、投影原子事务和重启续读仍排除在本片之外。
- 不实现生产 Memory 主库、Runtime 注入、SQLite 迁移或 wire capability。
- 不决定 Memory 主库与 Goal 图投影关系、正文/contentRef、物理删除、WAL/备份清理、
  token 保留期或真实 ingest 写入口。这些决定完成前不导入真实私人数据。
- 不修改 Goal、Decision、Plan、TaskRuntime 或任务终态，不扩展 Local Profile，也不调用
  AgentArts、模型、工具或云端服务。
- Fake 和纯消费者测试只证明接口语义，MemoryQueryPort 的生产能力继续为
  `unavailable`，不得静默回退 Fake。

## 最小验收

包内测试使用固定合成事实，覆盖：namespace 与显式 scope 隔离；当前有效事实；精确版本
读取及隐藏/不存在同一拒绝；隔离副本；withdrawn/隐藏最新版本不复活旧值；历史和当前
分页固定水位；追加新版本不混入旧 snapshot；token 对过滤条件、namespace、scope、查询
种类的绑定；exact fields、bounded summary、canonical UTC、revision/corrects；无效 limit、
deadline 和取消；以及纯消费者按精确 FactRef 读取且不导入任何实现。

本工作包不运行真实数据、云端、GUI 或生产迁移。

实际执行（2026-09-22）：Node 24.15.0 下包构建通过，查询、feed 边界与 Fake 状态机
定向测试 16/16 通过，`npm run check:architecture` 与全仓 `npm run check` 通过。
这些离线结果不替代非作者评审、生产持久化或真实数据验收。
