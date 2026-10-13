# MOD-09D：Memory 到 Goal/Cognition 的持久投影

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-024、PA-025
- 目标 Profile：`huawei_ict_agentarts`
- GitHub 负责人：`goo122`
- 消费语义评审者：`zemeng`
- 基线：`main@f56059a`（PR #90）
- 分支：`codex/mod-09d-memory-goal-projection`
- 当前状态：`done`（仅本片离线验收）；PR #91 修复评审阻断后获 `zemeng` 非作者批准，Foundation CI 通过并合并到 `main`
- 文档范围：ADR-0008、本工作包、接口目录和路线图

## 职责

本工作包定义并实现 Memory 事实变化到 Goal 图事实节点的可恢复消费：

1. 读取一个 host-bound `FactChangeBatch` 和其中的精确事实版本。
2. 将每个精确 `FactRef` 持久映射到精确 `NodeRef`。
3. 在 Goal/Coordination 数据库先暂存未生效批次；Memory 确认成功后，才在一个事务中
   激活图投影、去重、待重检记录和本地回执。
4. 确认前与确认后、激活前崩溃都从暂存恢复；重放不得重复产生图版本。
5. 通过持久待重检记录触发 Cognition 影响分析，首片只产生 `KEEP` 或 `RECHECK`。

## 非职责

- 不把 Memory、Goal 和 Runtime 数据库合并成一个通用数据库。
- 不使用 SQLite 跨文件事务或新建分布式事务框架。
- 不自动提交计划修订，不执行工具，不改变 Runtime 任务终态。
- 不注册 Desktop/wire capability，不接 AgentArts，不处理真实私人数据。
- 不在本片决定物理删除、保留时长、备份清理或数据出机策略。

## 精确映射

同一 memory namespace/fact ID 使用稳定的 Goal fact node ID；每次事实修订产生新的 Goal
node revision。两侧 revision 独立，必须通过持久映射解析，不能用数值相等推断。

持久映射至少包含：

| Memory 身份 | Goal 身份 | 完整性用途 |
| --- | --- | --- |
| namespace、fact ID、fact revision | graph namespace、node ID、node revision、graph revision | 精确依赖与历史追溯 |
| event ID | 对应投影回执 | 防止同一事件重复写入 |
| consumer key、batch token、base checkpoint | 本地提交位置、handled key | 崩溃重放与内容绑定 |

相同 FactRef、event 或 batch 绑定不同内容必须返回完整性冲突。`withdrawn` 事实追加失效版本，
不删除旧图历史。scope 失效或不可见事实不进入投影，旧绑定按 feed 契约要求重建。

## 事务 Inbox

本地投影事务位于 Goal/Coordination 数据库，至少原子提交：

- Fact 节点版本；
- FactRef → NodeRef 映射；
- event/batch 去重记录；
- 待执行的 impact/recheck 记录；
- 本地 consumer checkpoint；
- 幂等投影回执。

暂存事务提交后调用 Memory `confirmFeedBatch()`，确认成功后才激活。故障恢复规则如下：

| 故障点 | 恢复结果 |
| --- | --- |
| 暂存前失败 | 不推进本地状态，原批次可重读 |
| 暂存后、Memory 确认前崩溃 | 从未生效暂存重试确认；图和 pending 仍不可见 |
| Memory 明确拒绝确认 | 丢弃旧暂存；`REBUILD_REQUIRED` 不激活旧 scope 事实 |
| Memory 确认后、激活前崩溃 | 先恢复暂存并幂等重试确认，再激活；不读下一批 |
| 激活事务中失败 | 图、映射、回执和 pending 整体回滚，暂存留待重试 |
| 激活后重试 | 图版本不重复；本地回执保持同一 handled key |

provider checkpoint 与本地 Goal 数据库不宣称跨库原子。事务 Inbox 提供本地 exactly-once
效果；Memory delivery 使用至少一次投递和幂等确认。

## 输入、输出与公共入口

| 接口 | 提供方 | 状态 | 兼容或迁移要求 |
| --- | --- | --- | --- |
| `MemoryQueryPort` | `@personal-agent/memory` | provisional | 仅按 host-bound scope 读取精确版本 |
| `FactChangeFeedPort` | `@personal-agent/memory` | provisional | consumer 无确认权限 |
| SQLite Memory host confirm | `@personal-agent/memory/sqlite` | provisional | 仅可信宿主在持久暂存后、激活前调用 |
| `AtomicCoordinationStorePort` | `@personal-agent/goals` | provisional | 现有 `appendBatch` 不单独充当消费事务 |
| 持久投影宿主操作 | `@personal-agent/runtime` | provisional | 分支已有窄入口，不暴露 SQL 或通用事务回调；未注册 capability |

## 依赖与所有权

- `goo122` 负责 Memory、存储事务适配、Runtime Application 组合和根集成。
- `zemeng` 评审 FactRef → NodeRef 语义、Goal 节点版本及 Cognition `KEEP/RECHECK` 消费。
- 修改 `packages/goals` 或 `packages/cognition` 前必须保留现有公共行为，并由对应负责人评审。
- `packages` 不依赖 `apps`；Runtime 只通过公开 exports 组合具体宿主。

## 权限与数据

- feed binding 固定 namespace、consumer 和允许的 sensitivity。
- 暂存前校验精确 FactRef、deadline 与取消信号；provider 确认再次校验 binding/scope。
- 本地读取许可不包含出机、模型提示或 AgentArts 上传许可。
- Evidence 只记录可信本地回执和 Ref，不记录秘密或私人正文。

## 实现顺序

1. 非作者评审本 ADR 与工作包，冻结映射和故障恢复语义。
2. 在 Goal/Coordination SQLite 事务域实现映射、Inbox、pending impact 与回执。
3. 增加 Runtime Application 消费器：read → exact query → stage → provider confirm → activate。
4. 增加 pending impact 恢复执行，只调用影响分析，不自动提交计划修订。
5. 通过定向测试、架构门禁和根 `npm run check` 后，再评估 Runtime capability。

## 已实现增量

- Runtime migration 6 增加 FactRef 映射、投影回执和 pending impact 表；migration 7
  增加未生效批次暂存表，保留前一迁移的校验语义。
- `FactProjectionStore.project()` 在一个 Runtime SQLite 事务中提交图版本、精确映射、
  去重回执和 pending impact；同一批次重放返回原回执。
- `createMemoryProjectionApplication()` 执行一次
  feed read → exact fact query → durable stage → provider confirm → atomic activation；
  重启优先恢复暂存，确认被拒绝时不暴露图或 pending。
- `createPendingImpactApplication()` 按持久 graph revision 运行现有 Cognition 影响分析，
  持久标记报告，只输出 `KEEP/RECHECK`，不提交 Plan 修订。
- 确认前中断、确认后激活前中断的跨重启测试，以及 scope 失效确认拒绝测试，
  证明暂存不参与认知分析，恢复不重复追加图版本。

## 验收

- 正常投影后 FactRef 可追溯到精确 NodeRef。
- 重复 event/batch、提交后崩溃和进程重启不会增加第二个图版本。
- revision/checkpoint 冲突、回执写入失败和 pending 写入失败全部回滚。
- deadline 到期或提交前取消不留下部分写入；提交后以持久回执为准。
- `withdrawn` 形成失效版本；无权限事实不被投影。
- 受影响计划只进入持久 `RECHECK`；无关计划保持 `KEEP`。
- 不自动修改计划、不执行工具、不改变任务终态。
- 受影响 workspace 测试、`npm run check:architecture` 和 `npm run check` 通过。
- 非作者评审与合并已完成；MOD-09 整体的生产接线和真实来源仍未完成。

## 已执行验证

- `npm run build --workspace=@personal-agent/runtime`
- `npm run test --workspace=@personal-agent/runtime`：68/68 通过（根检查内执行）
- `npm run check:architecture`：3/3 通过
- 修复后 `npm run check`：通过全部 workspace 构建、类型、单测及根集成测试；根集成 7/7 通过
- 评审修复定向测试：11/11 通过，含 scope 失效及两个崩溃窗口
- `git diff --check`：通过

## 排除项与已知限制

本工作包不证明真实事实来源、真实私人数据、AgentArts、外部副作用或删除/保留策略可用。
持久投影宿主操作仍为 provisional；生产 composition、自动调度和 Runtime capability
保持 `unavailable`。本片使用合成事实，不构成真实私人数据、外部来源或 AgentArts 验收。
