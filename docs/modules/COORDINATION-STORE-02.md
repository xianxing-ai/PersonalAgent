# COORDINATION-STORE-02：原子显式图谱修复

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；MOD-27/28，PA-024/025。
- 负责人：zemeng；非作者评审者：goo122；状态：review。
- 2026-09-17 用户明确授权：缺失接口由当前开发者实现并提交评审，不等待原提供方先交付。
  本工作包据此包含必要 Runtime 存储适配，不改变其他模块的长期所有权。
- 基线 main `72cc76b`；分支 `codex/zemeng/atomic-graph-repair`；
  工作树 `.worktrees/zemeng-atomic-graph-repair`。

## 接口与兼容决定

单次 `append` 不能保证 Goal→Decision→Plan 完整修复原子性，逐条写入可能留下部分修复。
在已有 `@personal-agent/goals/store` 追加 `AtomicCoordinationStorePort extends CoordinationStorePort`：

```ts
appendBatch(expectedRevision: number, inputs: readonly NodeInput[]): GraphSnapshot;
```

旧端口 `read/append` 不变，已有提供者和消费者继续兼容；需要整批写入的消费者必须显式使用
Atomic 扩展，禁止在旧提供者上退回逐条 append。`appendVersions` 是同模块公开的纯预检函数，
沿用 `appendVersion` 的校验、复制与依赖版本语义，拒绝空批次。

一次 CAS 保护整批，按输入顺序分配逐节点版本与 graph revision。后面的节点可引用本批前面
刚产生的精确版本，不能引用未来节点。全部校验成功才替换存储快照；任何节点非法、图版本
冲突或提交失败均不允许暴露部分持久写入。返回隔离副本，不允许调用方原地修改存储。

Fake 在隔离副本完成预检后单次替换；SQLite 在一次 `BEGIN IMMEDIATE` 内读取、预检、
单次 UPDATE、COMMIT，失败 ROLLBACK。复用既有表与迁移，不创建第二套数据库或调度器。
保持模块错误脱敏，冲突不自动重试。端口仍为同步、小图接口，不能承诺异步取消或大图性能。

## MOD-28 消费者

`previewStoredRepair` 接受期望图版本及显式有序的节点修复请求，在隔离副本上给出前后影响分析，
不写入。只允许当前受影响的 active Goal/Decision/Plan；禁止修改 Fact、无关节点、来源、
敏感级别和有效期。每项显式声明精确旧版本、新摘要、原因与新依赖，不自动猜测重绑定关系。

`commitStoredRepair` 在提交前重新预检，然后只调用一次 `appendBatch`。图版本竞争返回最新
快照及分析，调用方须重新审阅，不盲目重试。预检和持久追加都不是语义正确、授权批准、
工具执行或 Runtime 任务完成的证据；KEEP 仍只是未检测到依赖/有效期问题。

## 验收与剩余边界

- Fake：整批成功、输入/输出隔离、非法中间节点零写入、旧版本冲突、旧 append 兼容。
- SQLite：事务回滚、命名空间隔离、完整批次重启读回。
- cognition：无写预检、完整显式修复、不相关节点不变、冲突刷新、不退回非原子写入。
- 实际验证：goals 原子测试 1/1、Runtime 批次测试 3/3 与既有存储测试 8/8、
  cognition 测试 18/18 通过；相关 TypeScript 构建通过。
- `node --test --test-isolation=none tests/integration/atomic-graph-repair.test.mjs` 1/1 通过，
  覆盖公开 cognition 消费者、SQLite 完整三节点提交与重启后的快照/历史读回。
- 根 `npm run check` 已执行：架构门禁、4 个契约夹具、生成类型检查通过；构建在未改动的
  mail workspace 因本机未安装锁定的 `imapflow`、`nodemailer` 及类型依赖停止。
  未删减检查或修改邮件模块；完整检查等待干净环境 CI，不能宣称本地全仓通过。
- 无新 wire operation、capability、依赖或数据库迁移；端口保持 provisional，评审/集成后
  才判断工作包完成。MemoryQueryPort、FactChangeFeed 与真实云修复不随本项提升状态。
- 可回滚代码提交；已写入的合法版本历史由旧 read/append 实现继续读取，回滚代码不会撤销历史
  或外部副作用。未引入真实私人数据。
