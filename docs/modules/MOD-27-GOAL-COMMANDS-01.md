# MOD-27-GOAL-COMMANDS-01：目标创建、修订和查询的宿主消费入口

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-27 / PA-024；负责人 `zemeng`。
- 所有权：`packages/goals/**` 与本文。Runtime、Desktop、公共协议和数据库适配保持原负责人所有。
- 基线：2026-09-25 `origin/main` 的 `ec43a55`；既有版本图、Fake/SQLite 原子 CAS 和事实投影均已合并，不重复实现。

## 增量语义

`@personal-agent/goals/commands` 在已由可信宿主绑定的 `CoordinationStorePort` 上提供
`createGoal`、`reviseGoal`、`getGoal` 和 `listGoals`。写入复用已有 `NodeInput`、版本历史与存储提交时
CAS，不添加 wire 操作、数据库、迁移或任务状态。Goal 命令需要明确的 `sourceRef`、原因、
有效期、敏感级别、依赖引用和预期图版本。修订另需当前 Goal 节点版本。完整替换输入使
来源或依赖变化显式可见；撤回追加版本，ID 不复用。查询返回当前各 Goal 的精确版本与
图版本，也可读取历史图版本；撤回记录仍可见。写入回执包含旧 Goal 精确引用（新建为
null）、新版本与提交后的 graph revision，供 MOD-28 在同一持久快照上分析影响；
它不是独立、可重放的事件流。`getGoal` 只向调用者返回目标节点，避免暴露无关图节点。
对 MOD-28 PR #135 的 provisional 选择入口，修订回执的 `graphRevision`、`previous`、
`goal.id/revision` 分别映射 `expectedGraphRevision`、`previousGoal`、`currentGoal`；
新建目标无旧版本，不触发该修订筛选。真正消费前仍须从绑定存储重读同一图版本。

通用图节点仍允许内部可信消费者按现有接口写入；此入口只为用户目标接线提供额外的
创建/修订语义和冲突检查。MOD-28 可继续从同一存储快照读取精确 Goal 版本和依赖，
目标修订不会自动改写 Decision/Plan 的旧引用。命令不能代替宿主的用户授权、来源
真实性校验、隐私删除和 Runtime 任务终态处理。

## 验收与接线

- goals 定向用例覆盖来源与版本读回、历史查询、旧图/旧 Goal 冲突、并发提交冲突、
  撤回后的查询和 ID 保留、非法输入零写入。
- 本工作树验证：使用已安装的 TypeScript 5.9.3 工具链和 `@types/node` 路径编译
  goals；`node --test packages/goals/test/*.test.mjs` 14/14 通过；
  `npm run check:architecture` 3/3 通过；`git diff --check` 通过。
  后续补单目标查询和精确变更回执后，仅重跑受影响的 commands 定向用例 5/5，
  TypeScript 编译通过；未重复其他已通过检查。
  当前工作树未安装 `node_modules`，因此没有运行 `npm ci` 或全仓 `check`。
- 宿主接线待整合者在 Runtime/Desktop 的既有安全路径完成：绑定当前用户的 store，
  由宿主产生/验证 `sourceRef` 并授权目标写入；UI 展示写后持久读回及冲突刷新。
- 真实验收待用户目标经过 UI/Runtime 写入后重启读回，并检验目标变化被 MOD-28
  消费。Fake/离线测试不构成这项真实验收。
- 本工作包需非作者评审后才能集成；不据此将 MOD-27 标记 `done`。
