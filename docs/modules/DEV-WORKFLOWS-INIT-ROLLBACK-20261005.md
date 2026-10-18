# DEV-WORKFLOWS 初始化回滚

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

zemeng 在 #277 Windows CI 等待期间复现：`issueTriage.minConfidence=2` 被工作流工厂拒绝，但此前已注册的 GitHub 提供者没有 dispose，Runtime SQLite 仍保持连接。该路径属于 Local 宿主配置失败，不是任务执行失败，不改变审批/恢复或 Competition 默认组合。

独立增量基于 #277 `d5722245f8bc7a28c9f3f8bbeabeaf6256c534e4` 的同一代码树，工作树复用 `.worktrees/review-277`，分支 `codex/dev-workflows-init-cleanup`。注册阶段和 Review/Issue 工厂共用初始化回滚：逆序释放每个已取得注册，尝试关闭 Runtime，保留原始构造错误；单个提供者 dispose 抛错也继续释放。

回归验证拒绝配置时提供者释放一次、原数据库可删除并重新初始化，释放异常不掩盖原错误。Windows 对 SQLite 连接句柄的约束以新 head CI 为准；Linux 通过不证明该平台行为。没有新接口、迁移、依赖或锁变更。请求 Potatos498 / goo122 非作者审核，沿 #277 堆叠交付，不自动合并。
