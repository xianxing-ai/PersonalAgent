# MOD-09F：公开演示来源的可重试事实导入

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 PA-024、PA-025
- 负责人：`goo122`；Memory → Goal 消费语义由 `zemeng` 非作者评审
- 状态：`done`（仅本片公开来源离线验收；PR #126 已获批准并于 2026-09-25 合并）
- 基线：`main@902e110`；分支：`codex/mod09f-source-ingest`
- 文件所有权：`packages/memory/**`、`apps/runtime/src/application/`、Runtime 的
  workspace 依赖、根锁文件、本工作包和定向测试

## 目标与边界

把 MOD-09E 测试宿主的手工 `append` 前移为**显式触发**的可信宿主操作：
同一公开来源修订在重试、重启和并发调用下只产生一个 FactVersion 与一个 feed 事件；
修订变化形成精确 `corrects`，之后仍由现有 `FactChangeFeedPort` 和 Runtime 投影消费。
首片只处理仓库自编演示资料的临时副本，不默认扫描目录，不注册 Runtime capability，
不处理私人 Vault、模型、AgentArts 或真实账号。

## 来源身份与事实映射

- 调用者显式指定 memory namespace、稳定 fact ID、Vault ID、相对文档路径和固定检索短语。
  `(namespace, vaultId, path, factId)` 是导入身份；行号仅作证据位置，不能作稳定 ID。
- 每次从 `@personal-agent/knowledge/filesystem` 的 `ReadOnlyVaultPort` 取得唯一命中，
  再按其 `revision` 调用 `readCitation`（基础 `KnowledgePort` 仅有 `search`）；
  无命中、多命中、路径不符或 `SOURCE_CHANGED` 均停止且不写入。文档哈希是**文件修订**，
  不是事实内容哈希；只有命中并精确读回后才能生成事实摘要和来源引用。
- 观察时间由可信宿主给定，不能从 Markdown 猜测。有效期、`public` scope 与
  `external_observation` 确认类型显式固定；来源引用不含本机绝对路径。
- 相同导入身份、与**当前映射**相同的文件修订及相同派生内容返回已提交的精确 FactRef，
  不更新首次观察时间、不追加 feed；同一修订却对应不同摘要、证据行、有效期或
  其他语义字段时拒绝完整性冲突，不静默覆盖。
- 新文件修订在同一稳定 fact ID 下生成下一版本，`corrects` 指向上一精确 FactRef。
  同一 namespace 的 fact ID 若已由其他来源占用则拒绝，不能接管既有事实历史。
  哈希不提供时间顺序；资料经历 A→B→A 时，第二个 A 是新修订而非历史 A 的幂等重放。
  来源消失或检索不到**不等于**事实撤回；撤回须有独立授权与证据，不在本片自动执行。

## 原子性与恢复

原 `SqliteMemoryHost.append()` 在一个 Memory SQLite 事务内写事实、事件与 namespace
序号，但不保存来源映射；直接在外层先查再 `append()` 会在崩溃或并发时失去幂等语义。
本片在同一 Memory 专用数据库增加有序迁移 2 和唯一来源映射，并提供窄的可信宿主导入
方法。仅保留一条当前映射，保存上述导入身份、当前文件修订、派生内容指纹和精确
FactRef；旧版本由现有 `memory_facts` 保留，不以文件哈希全局去重。该方法在**同一个
写事务**内校验映射、分配下一 revision、写 FactVersion、feed 事件、更新映射和序号；
复用现有事实校验与写入逻辑，不创建第二套事实库或调度器。

读取来源前先记录当前映射的 FactRef（或不存在）；精确读取完成后，写事务再次比较
该预期水位。若期间另一导入已提交**不同**文件修订，拒绝本次过时读取并从来源重新
开始，不把旧哈希追加到新版本之后；若另一导入提交了同一修订及内容，则直接返回已
提交的 FactRef。不能只在进程内加锁，因为另一进程同样可写这份 SQLite 数据库。

事务提交前失败则所有写入回滚；提交后但返回前中断，下一次读取映射并返回原 FactRef。
同一来源的并发提交由 SQLite 写事务串行化，并由上述水位校验阻止读阶段的陈旧提案；
不能只在进程内检查再写库。已提交版本不可改写。来源在精确读回之后再次变化，只能
由下次显式导入产生修订；不宣称跨文件和数据库的原子快照。若迁移或事务设计无法
保持上述性质，应停止实现并复审方案。

## 接口与兼容

- `KnowledgePort`、`MemoryQueryPort`、`FactChangeFeedPort` 与 Runtime 投影仍为
  provisional；仅为可信 Memory 宿主增加 `readPublicSourceHead`、`appendPublicSource`
  和 `REVISION_CONFLICT`，不改公共 wire Schema，不提升接口目录的冻结或生产可用状态。
- 新导入方法仅由可信宿主调用，不暴露给 Agent/Renderer/连接器，也不把本地读取
  解释成云端发送许可。Memory 数据库沿用独立文件和既有迁移序列；已发布迁移不重写。
- `apps/runtime/src/application/public-source.ts` 仅提供显式调用的来源读取与写入组合，
  不注册 capability。Runtime 新增对现有 Knowledge workspace 的依赖，无新外部包。
- MOD-09E PR #118 的离线精确引用与投影测试可作消费证据，但不能代替本片的
  幂等导入和故障测试；本片合并前须核对其非作者评审结论。

## 实施与验收

1. 在 Memory 包增加同库来源映射迁移和可信宿主原子导入；先写重复/修订测试，
   再复用 `append` 的内部校验与事务逻辑实现。核对旧数据库升级保留已有事实。
2. 用仓库公开 fixture 的临时副本做显式读取：首次产生 revision 1；同版本重试、
   跨重启重试及并发重试都返回相同 FactRef，feed 仅一条；交错的不同修订不能倒序
   追加，A→B→A 要形成三个版本。
3. 修改临时副本，验证旧 citation 被拒、新 revision 产生修正版本和第二条 feed；
   来源缺失、多命中、路径错配和同修订不同内容均不改变数据库。
4. 注入事务提交前失败与提交后响应丢失，核对事实、映射、序号和 feed 的原子性；
   旧数据库迁移后数据可读、重启后映射仍在。
5. 构建并测试受影响 workspace，执行架构门禁、根 `npm run check` 和 `git diff --check`；
   明确记录 Fake/公开资料与真实私人来源验收的区别，交由 `zemeng` 非作者评审。

真实私人来源、用户更正/撤回、物理删除、WAL/备份保留、生产 capability 和云端出机
授权均不在本片；这些是后续独立工作包的进入条件，不由离线测试推定完成。

## 本地已执行

- Memory 构建及模块测试：26/26 通过，含重复/修订/回退、过时水位和映射写入失败回滚。
- 公开 Vault 临时副本的显式导入定向集成：1/1 通过，含无命中、多命中、
  来源变更、修正与重启幂等。
- 使用 MOD-09E 工作树的 v1 Memory 宿主生成既有数据，再由本分支 v2 宿主打开：
  迁移成功，原 FactVersion 保留；此项为本机跨版本手动验收，尚非 CI 夹具。
- `npm run check`：架构门禁、契约夹具、生成类型、全部 workspace 构建/类型/测试
  与根集成 15/15 通过；`git diff --check` 通过。
- 以上全是公开/合成离线验证；#118 和 #126 均已获批准并合并，
  不构成真实私人来源或整个 MOD-09 完成。
