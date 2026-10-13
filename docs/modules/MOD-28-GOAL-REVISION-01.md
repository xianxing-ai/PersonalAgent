# MOD-28-GOAL-REVISION-01：Goal 修订的局部影响与显式预览

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-28 / PA-025；负责人 zemeng。
- 文件锁：`packages/cognition/**` 与本文。依赖 MOD-27 公开版本图及 provisional 存储端口。
- 状态：实现中；非作者评审、PR/CI 与生产接线以实际读回为准。

## 行为

可信宿主传入已提交的同一图谱快照、显式 UTC 时间、当前 graph revision 与连续的旧/新 Goal `NodeRef`。`selectGoalRevisionImpact` 先完整重放图谱，再只保留因旧 Goal 被新版本取代而 RECHECK 的当前节点。它不把同一快照里无关事实变化的 RECHECK 归到本次 Goal 修订，也不把历史节点作为当前修复目标。

`previewGoalRevisionRepair` 从绑定存储读一次快照，只允许显式候选修改上述子集中的节点，借现有修复预检生成 before/after 差异。它不能自动判断新摘要、依赖或计划的语义正确性；部分预览可能仍有 RECHECK。没有写入、审批、授权、TaskRuntime 状态变化、云调用或工具执行。宿主若接受候选，仍须经既有评审和原子 CAS 提交路径。

该入口是本地域 API，不创建公共 wire DTO。跨模块生产消费、真实事实来源及 AgentArts 驱动修复依赖相应负责人的接线和真实 Evidence。本包的合成验证只证明确定性筛选、隔离预览及失败路径。
