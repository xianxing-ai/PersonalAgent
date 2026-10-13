# MOD-09C：SQLite 记忆持久化首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 任务：`MOD-09C-MEMORY-SQLITE-01`
- Profile：`huawei_ict_agentarts`
- 基线：`main@b979eb5762af381bb2fddfbf85889978906706af`
- 分支：`codex/mod-09c-memory-sqlite-v2`
- 负责人：`goo122`
- 状态：`done`；PR #90 已由 `zemeng5208` 非作者批准并合并为 `f56059a`
- 非作者评审者：`zemeng` 或其他已登记协作者

## 目标

在不接入 Runtime、不导入真实私人数据的前提下，为 MOD-09B 的 provisional
`MemoryQueryPort` 与 `FactChangeFeedPort` 增加一个可重启验证的本地 SQLite 适配器。
本片验证持久事实版本、查询快照/游标、未确认批次重放、checkpoint CAS 和幂等回执。

## 交付范围

- `@personal-agent/memory/sqlite` 导出 `openSqliteMemoryHost(path)`。
- 使用 `@personal-agent/storage` 的有序迁移、WAL、`synchronous=FULL` 与迁移校验。
- 专用数据库保存 namespace、不可变事实版本、变化事件、查询水位、分页游标、
  feed binding、未确认批次和确认回执。
- 事实版本与变化事件在同一个 `BEGIN IMMEDIATE` 事务追加。
- 相同 consumer/scope 重启后续读；未确认批次精确重放；确认使用 checkpoint CAS，
  同一完整请求可幂等返回原回执。
- 最新可见事实改为不可见 sensitivity 时使旧 feed binding 失效并返回
  `REBUILD_REQUIRED`。

## 明确不做

- 不注册 Runtime capability，不修改 Desktop、AgentArts 或 Local Profile 装配。
- 不提供真实 ingest、账号数据、云端发送或自动认知触发。
- 不定义物理删除、保留期、备份清理或数据出机策略。
- 不把 SQLite checkpoint 称为投影原子完成：Goal/认知投影、精确 Ref 去重、
  持久影响记录与 feed 确认尚未共享同一宿主事务。`confirmFeedBatch` 只证明
  memory-owned delivery journal 的持久 CAS，不能作为 MOD-27/28 投影完成证据。
- 不冻结 provisional 端口；运行能力继续 `unavailable`，不得回退 Fake。

数据库路径必须指向 memory 专用文件；当前 `@personal-agent/storage` 使用单一
`schema_migrations` 表，不能与其他模块的独立迁移序列共用同一文件。

## 验收

- 重启后精确版本与 current/history 查询保持一致。
- 旧 snapshot/cursor 重启后继续固定在原水位，新追加事实不混入旧页。
- 未确认 bootstrap/change 批次重启后逐字段一致。
- 确认回执跨重启幂等；错误 checkpoint、缺项和 scope 失效不得前移位置。
- 模块构建、模块全测、架构门禁与根 `npm run check` 通过。
- 真实私人数据、Runtime 组合与跨模块投影验收单独记录，不计入本片。

## 已执行验证

- `npm run build --workspace=@personal-agent/memory`
- `npm run test --workspace=@personal-agent/memory`：23/23 通过，含 7 个 SQLite 持久化/恢复用例。
- `npm run check:architecture`：3/3 通过。
- `npm run check`：通过生成类型检查、全 workspace 构建/类型检查/测试及 7/7
  根集成测试；真实服务测试按显式 opt-in 保持跳过。

## 故障与并发验收增量

- PR #90 已由 `zemeng5208` 非作者批准，并于 2026-09-22 合并为 `f56059a`。
- 独立 Node 进程持有 SQLite 写锁，复现旧实现在等待期间过期后仍确认成功的问题；
  现在在取得写锁后、COMMIT 前检查 deadline/取消，失败回滚，不推进 checkpoint。
- 超时读取不会持久化过期的 pending batch；后续重读仍能取得新变化。
- 回执写入注入失败后，checkpoint、pending batch 与回执共同回滚；重新打开数据库后
  精确重放原批次，成功确认仍幂等。提交前取消同样不留下部分写入。
- SQLite 同步操作不保证即时抢占；已经 COMMIT 的确认以持久回执为准。
- 下一工作包 [MOD-09D](MOD-09D-MEMORY-GOAL-PROJECTION-01.md) 先冻结事实精确 Ref、
  图投影持久映射和事务 Inbox，再接认知消费；本片的 memory 专用库和 delivery journal
  不提供跨库原子投影证据。
