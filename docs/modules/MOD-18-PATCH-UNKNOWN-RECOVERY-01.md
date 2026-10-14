# MOD-18：未知补丁结果的持续核实

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

日期：2026-10-05。负责人：zemeng；状态：review。目标 Profile：`huawei_ict_agentarts`，同一适配器的 Local 消费保持兼容。

## 问题与范围

评审 PR #278/#280 时发现：Runtime 将 unknown 轮询作为不持久化的观察，但适配器仍调用 acknowledge，实际宿主因此删除原补丁标记。原任务仍 waiting_reconciliation，后续或重启核实只返回 clear，无法确认后来 applied/not_applied。

本修复基于 #280 的精确头 `7f3e0afeec6bfa48b43e421b81db0ba8fde20434`，保留 #278 原作者提交及 #280 的全部集成修复。unknown 直接返回，原标记保留；只在确定结果已持久读回后清标记。原 task/run、授权和工具调用次数不变，无新 Schema、迁移、依赖或外部副作用。

## 验证

- 原代码上的新回归失败于 unknown 后标记被删除。
- 新回归覆盖重复 unknown、无持久确定结果、SQLite 重启、后来 applied、原工具仅执行一次及确认后的缓存重放。
- Node 24.15.0/npm 11.12.1，workspace 构建通过；Runtime 补丁恢复、主动认知、AgentArts application 三套定向测试 40/40。
- #280 受影响 Desktop/P5/feeds/私人消费/待办八套测试 47/47，包含通知暂停后队列保留和恢复、原 Runtime 来源证据、缺已提交 Fact 评审端口时零图谱写入。
- 上述使用真实 SQLite 和显式 Fake 外部端口；不是 Windows 原生 helper 或真实 AgentArts 验收。接口状态不提升。

## 交付与恢复

独立评审修复供 goo122/Potatos498 复核和原 PR 消费，不覆盖协作者分支。无数据库变更；保留现有未知任务及标记，禁止为了回滚清除标记或重新执行未知写入。
