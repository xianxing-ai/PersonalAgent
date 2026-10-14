# MOD-28-IMPACT-01：本地依赖影响与显式修订提案

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；MOD-28 / PA-025；负责人 zemeng。
- 指定非作者评审者：goo122；状态 review（待评审与集成）。
- 工作树 `.worktrees/zemeng-mod27-goal-graph`，分支 `codex/zemeng/mod27-goal-graph`。
- 基线 5944061；与 MOD-27-GRAPH-01 本地域核心作为同一图谱影响工作包评审，不复制或改动其他工作树。
- 所有权 `packages/cognition`；只消费 `packages/goals` 公开出口。
- 验收：合成会议事实修正/撤回/到期、精确版本传递、无关计划 KEEP、受影响计划 RECHECK、
  显式 summary 候选的最小 REVISE diff、陈旧版本/额外字段拒绝和确定性回放。

## 语义与边界

完整版本历史按追加顺序分析，不把更新后的同 ID 节点替换旧依赖路径。
即使 Goal 已重新绑定新事实，仍引用旧 Goal 的 Decision/Plan 继续重检。
“最小”在此指仅命中依赖子图，候选仅输出 summary 字段差异，不代表最优语义修复。
REVISE 只表示显式候选经过结构、目标和版本校验，不代表内容正确、被批准或执行。
当前不生成新计划，不自动重绑依赖，不改变任务终态；KEEP 也不代表执行成功。

输入是调用者提供的图谱和显式时间，不私设 MemoryQueryPort/FactChangeFeed/存储端口。
没有网络、云服务或真实账号操作。公共 Schema、根配置/锁、持久化和 Runtime 保持不变。
本地输出为 provisional；生产 wire 冻结及根装配需与 goo122 协调。

## 验证与继续入口

2026-09-09：根 `npm run check` 通过（架构门禁、生成类型、类型检查及全部工作区测试）；
cognition 9/9、goals 8/8 通过，天气模块 4 项可选真实测试跳过。差异检查通过。
首次沙箱测试启动遭遇 `spawn EPERM`，通过平台授权后运行上述 check 成功。
环境 Node 26.3.0 / npm 11.16.0，与项目要求的 24.15.x / 11.12.x 不同，目标版本待验。
根锁与根 package 未修改；新增 workspace 的锁登记和生产 build 次序仍需 goo122 集成。

后续本地回放增量（2026-09-09）：新增 `examples/meeting-replay.mjs` 与独立回归测试，
`npm test --workspace=@personal-agent/cognition` 10/10 通过；模块构建同时通过。
`npm run demo --workspace=@personal-agent/cognition` 提供可运行的 mock JSON 报告：
改期后 3 个节点 RECHECK，只重绑 Goal 后 2 个，显式完成依赖链重绑后 0 个。
旧候选拒绝、历史快照保留、无关计划逐字段不变和确定性回放均有断言。
本次未改生产实现或公共依赖，不重复全仓 check；新增示例仅操作合成内存图，
不代表自动语义修复、宿主审批、持久化或提醒已经执行。

整个 MOD-28 仍待真实记忆变化流、云端语义修复、持久化、
Runtime 审批和任务调度接线；本增量不将模块标记 done。

2026-09-10 最新接口核对及下一步见[集成交接](MOD-27-28-INTEGRATION-HANDOFF.md)。
