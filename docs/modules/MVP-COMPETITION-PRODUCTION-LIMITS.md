# Competition 工具链移除演示限制

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；负责人：zemeng；公共 Runtime 接线评审：goo122。
- 状态：review，真实 AgentArts 多工具链未验收。

早期工具环固定四轮，其中一轮必须用于最终答复，无法完成读取、预览、应用、验证四步操作。本次增加可信组合参数 `competitionMaxSteps`，默认仍四轮，必须为正整数；新任务创建时持久保存，审批恢复继续使用已保存的预算，旧任务保持原预算。模型、Renderer 与 wire 请求均不能修改该参数。Desktop 可沿用现有文字工具流程的八轮配置。

续答移除 Runtime 与 AgentArts adapter 重复的 8 KiB 演示限制，复用既有 `parseCoordinationContinuation` 的 1 MiB UTF-8 JSON 限额与严格字段校验。取消、deadline、最后一轮禁止新工具副作用、结果投影授权和 Policy 保持有效。无需数据迁移；外部模型上下文容量仍由实际 Provider 限制，1 MiB 不代表平台必然接受。

必要检查：coordination 与 Runtime TypeScript 构建通过；定向测试验证四次工具执行后能够最终答复、审批恢复不重置预算、默认四轮仍拒绝无后续答复预算的新执行；adapter 测试验证超过旧 8 KiB 的结果可通过、1 MiB 边界与多字节超限在 I/O 前被拒绝。使用合成工具与 Fake 云传输，不是实际云服务吞吐或生产模型效果证据。

未改变公共 wire Schema，不新增模型或执行循环。回退后新任务恢复旧默认；已持久预算仍需由兼容版本解释，不通过删除任务库回退。
