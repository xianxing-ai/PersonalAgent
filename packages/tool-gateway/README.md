# 工具网关（MOD-05）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/tool-gateway` 实现生产侧 `ToolHost` 注册和受控调用：

它是当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 唯一允许的本地工具执行入口：AgentArts 工具提案先由 Runtime/Policy 校验，再经本 Gateway 执行和读回。云端成功、Local/Fake 执行或绕过 Gateway 的调用都不能作为比赛工具闭环证据。

- 输入/输出按工具 JSON Schema 校验；
- scope 只从 `PolicyPort` 根据受信 `authorizationRef` 解析；
- 校验任务、工具版本、deadline、用户在场要求；
- 取消信号传给工具；
- 外部写入在执行开始后被取消或超时时返回 `RESULT_UNKNOWN`，不自动重试。

该实现已通过 Fake 工具和 Runtime 离线闭环，但接口仍为 `provisional`：真实盘古工具提案、真实工具读回核实及 Windows/MCP/Skill 等独立提供者尚未验收。见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

Runtime 只允许为 `running` 的持久任务调用工具，并为 confirmed/unknown 结果记录 `tool.completed` 事件。Runtime 负责持久授权、审批记录和 Evidence，网关在授权完成后通知可信宿主记录执行阶段。参数绑定授权会比对规范化参数摘要。读工具的普通异常统一脱敏，写工具无法确认结果时返回 `RESULT_UNKNOWN`；工具仍需自行实现可核实的恢复接口，网关不盲目重试。

验证：

```sh
npm run build --workspace=@personal-agent/tool-gateway
npm run test --workspace=@personal-agent/tool-gateway
```
