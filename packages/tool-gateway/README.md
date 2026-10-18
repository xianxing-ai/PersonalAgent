# 工具网关（MOD-05）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-05（goo122）。产品流程：F02、F14、F15、F21、F24、F25；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

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
