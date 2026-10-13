# DEV-WORKFLOWS 初始化回滚

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

zemeng 在 #277 Windows CI 等待期间复现：`issueTriage.minConfidence=2` 被工作流工厂拒绝，但此前已注册的 GitHub 提供者没有 dispose，Runtime SQLite 仍保持连接。该路径属于 Local 宿主配置失败，不是任务执行失败，不改变审批/恢复或 Competition 默认组合。

独立增量基于 #277 `d5722245f8bc7a28c9f3f8bbeabeaf6256c534e4` 的同一代码树，工作树复用 `.worktrees/review-277`，分支 `codex/dev-workflows-init-cleanup`。注册阶段和 Review/Issue 工厂共用初始化回滚：逆序释放每个已取得注册，尝试关闭 Runtime，保留原始构造错误；单个提供者 dispose 抛错也继续释放。

回归验证拒绝配置时提供者释放一次、原数据库可删除并重新初始化，释放异常不掩盖原错误。Windows 对 SQLite 连接句柄的约束以新 head CI 为准；Linux 通过不证明该平台行为。没有新接口、迁移、依赖或锁变更。请求 Potatos498 / goo122 非作者审核，沿 #277 堆叠交付，不自动合并。
