# MOD-27-GRAPH-01：本地版本化图谱领域核心

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 负责人：zemeng；profile：huawei_ict_agentarts；基线：5944061（PR #36）。
- 分支：`codex/zemeng/mod27-goal-graph`；工作树：`.worktrees/zemeng-mod27-goal-graph`。
- 状态：review；本地增量已实现并验证，待非作者评审与集成；提交/PR 状态以 Git 为准。
- 用户当前约束：云试用审批未通过，暂停云工作，先做本地模块。
- 所有权：`packages/goals` 属于 zemeng；公共 Schema、Runtime、Memory、存储适配及根配置/锁文件由 goo122 负责。

## 本次领域语义

Fact、Goal、Decision、Plan 均具有节点 revision、来源引用、有效期、敏感级别、
状态和变更原因。整个快照另有 graph revision。所有修改追加新版本，历史不原地改写。
依赖固定到同一命名空间快照中已经存在的精确版本，因此版本图无环。
节点 ID 不允许改变 kind；不能引用自身、缺失版本或同一依赖的重复 ID。

修改事实不会自动切换既有 Decision/Plan 的依据，也不把旧依据仍在有效期内
解释成它仍然最新；MOD-28 需要比较当前版本与固定引用，计算影响。
当前只保存来源引用，不验证来源真实性，也不读取 Memory 数据库。

撤回记录以新版本保存。`graphAt` 是历史查询，不能拿它覆盖当前持久状态。
需要恢复内容时，使用当前 graph revision 追加旧内容和新的恢复原因；外部副作用
不随历史查询或内容恢复而撤销。

## 接口与集成边界

- 纯函数 `appendVersion` 的 expectedRevision 只校验传入快照。两个调用者各持旧快照
  时仍可能独立生成相同新版本，必须由未来存储适配在提交时原子 compare-and-swap。
- 命名空间是数据标签，不是身份认证或授权；宿主负责命名空间隔离与敏感数据访问。
- 没有定义或冒充 CoordinationStorePort、MemoryQueryPort、FactChangeFeed。
- 没有第二套任务库、任务终态、调度器、云调用或工具执行。
- 新包无第三方和内部生产依赖；测试脚本自行构建，现有根 check 会发现并测试该包。
- 根锁文件登记、顶层 build 次序和生产消费由 goo122 后续集成；未修改共享文件。
- 首版采用完整历史校验和复制，适合小规模正确性验收；大规模索引/增量存储未优化。

## 验收与下一步

定向用例：四类节点依赖、事实修正、撤回、无关计划保持、冲突拒绝、非法引用、
JSON 往返、历史查询和内容恢复、损坏快照拒绝、有效期边界。均使用合成会议数据。
验证（2026-09-09）：`npm test --workspace=@personal-agent/goals` 8/8 通过；
根 `npm run check` 通过，包含架构门禁、生成类型检查、类型检查和工作区测试。
天气模块的 4 项可选真实测试跳过；本次没有调用云服务或真实账号。
环境为 Node 26.3.0 / npm 11.16.0，与项目要求的 Node 24.15.x / npm 11.12.x
不同，目标版本兼容性仍需集成环境确认。根配置和锁文件未修改。

下一步由 MOD-28 消费图谱实现受影响节点分析；生产持久化、Memory 变更流、
Runtime/界面接线和跨重启验收仍未交付。本增量不代表整个 MOD-27 完成。
