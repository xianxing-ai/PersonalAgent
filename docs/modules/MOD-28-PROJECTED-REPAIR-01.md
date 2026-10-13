# MOD-28-PROJECTED-REPAIR-01：已确认事实投影的局部修复预览

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-28 / PA-025；负责人 zemeng。
- 文件锁：`packages/cognition/**` 与本文；基于 MOD-28-GOAL-REVISION-01 的只读快照预览入口。
- 输入：可信宿主绑定的 MOD-27 图谱快照、现有 Runtime `FactProjectionReceipt` 的结构及显式时间。

`selectProjectedRepairScope` 复用 `analyzeImpact`，要求投影的 graph revision 与可信图谱相同，校验关联节点确实是已记录的 Fact，然后仅选择这批投影导致 RECHECK 的当前 Goal/Decision/Plan。无关节点仍保留在完整影响报告中，不进入本次候选范围。

`previewProjectedRepair` 从绑定存储读取一次快照，复用现有显式修复预检，只允许修改这个受影响子集。候选正文及依赖由调用方提供，部分修复后的 RECHECK 会继续保留。该入口不订阅或确认事实变化流，不调用 AgentArts/Laya，不批准、写入、调度或改变任务终态；宿主仍负责真实来源、权限、原子提交及 Evidence。真实 Runtime 装配属于其文件负责人，本包只提供可调用的本地域消费者。

验证使用合成投影收据和 Fake 图谱；不能据此将生产能力标记 frozen 或宣称真实 AgentArts 修复完成。

## 已处理批次的认知侧交接

`decideDurableFactProjection` 接收已持久投影的回执，通过可信 Runtime 宿主按同一 `batchToken` 读回已处理影响报告。它从绑定图谱重算报告，检查 graph revision 与报告一致，再沿用局部 RECHECK 范围和有界 Laya 建议入口。其返回值只有局部范围与建议；显式修复候选仍走 `previewProjectedRepair`，不能自动提交或执行。

目前测试只覆盖合成公共 Fact 更正、批次不匹配、伪造报告、积压批次重算和建议期间图谱变化。DEP02 #162 已在 `readCompletedImpact(batchToken)` 提供固定消费方作用域的持久完成回执；生产组合、真实来源撤回证明和一次联合验收不在本工作包内。单纯搜索不到来源不能触发撤回。

`decideDurableFactProjection` 直接调用上述固定作用域的持久读回；未处理批次不给建议，其他消费方批次保留宿主 `NOT_FOUND`。积压批次先按原图谱 revision 校验持久报告，再用调用方显式 `at` 重算当前图谱的局部 RECHECK；若关联 Fact 已被后续版本取代则不给旧版本建议，建议期间图谱再变化则拒绝返回。DEP02 的 `listImpactReceipts({afterGraphRevision,limit})` 现在可从现有持久记录按固定作用域列出待处理和已完成批次。生产组合须先恢复这些批次，再推进 feed 和现有 task checkpoint；本包不另建状态库或事实流。

`previewDurableFactRepair` 让同一已完成批次的显式候选在当前图谱上复用 `previewProjectedRepair`：无关图谱前进允许预览，原 Fact 被替代、目标版本变化或候选改换原依赖身份则拒绝。它不接受模型自报的完成状态，不确认 feed、不执行 Laya、不提交图谱；真正写入继续由本地修复任务校验同源 Evidence、Policy、审批和当前 CAS。合成测试不等于正式来源、云候选及设备联合验收。
