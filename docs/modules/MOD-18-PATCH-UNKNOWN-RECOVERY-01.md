# MOD-18：未知补丁结果的持续核实

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
