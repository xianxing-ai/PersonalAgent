# P8 本地 Goal 常规授权消费修复

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。共享集成树 `mvp-assembly`，整体 MVP 未完成验收。

2026-09-30 实际验收目录 `.cache/p5-real-reviewed-goal/261508ba-a92c-415d-be40-7cd6b534d710`：Laya ready true，随后原任务 `dfe3b24e-deb1-4e3e-91de-f9cbba8e146b` 的 `goals.revise` 进入 waiting_reconciliation，cloudCalls=0，Laya stopped。只读 SQLite 确认图仍 revision 3、Goal revision 1；原 Policy 常规策略检查点及已消费授权存在，交互审批表为空。

根因是 Desktop Goal 云适配器的本地 HostTool 分支要求交互审批 allowed，未接受 Runtime 常规策略的原授权。修复保留原 task/run、command、namespace、完整输入一致性检查；常规路径还要求原策略检查点、同一参数 digest、同一任务/工具、精确 goals:write、相同未过期 deadline、消费次数归零。交互审批路径保持已有行为。云会话及云出口检查未放宽。

针对新增路径的实际 SQLite/Runtime 检查通过 1/1：本地 create/revise 无云许可仍取得原 confirmed Policy 记录；参数替换和授权撤销均拒绝，图不再改变。命令：`node --test --test-name-pattern='routine local Goal writes' apps/desktop/test/goal-cloud-host.test.mjs`，Node 26.3.0；不是目标 CI Node 24.15.0，也不证明真实云端调用通过。旧未知任务及原 Evidence 保留，不重发原写入；后续真实验收使用新隔离夹具，并遵守云端发布冻结窗口。
