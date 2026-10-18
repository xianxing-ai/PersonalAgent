# 授权策略（MOD-05）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-05（goo122）。产品流程：F02、F14、F15、F21、F24、F25；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

`@personal-agent/policy` 提供任务级授权策略。授权绑定 `authorizationRef`、任务、工具、scope、到期时间和可选使用次数、参数摘要；支持立即撤销。工具调用方不能把自报 scope 当作授权。

本包是当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的共享本地信任边界：AgentArts 只能提出动作，不能生成或消费本地授权。正式比赛链路必须经过本策略并保留决策证据；可选 Local Profile 不建立另一套授权体系。

当前策略实现及端口为 `provisional`：任务级持久授权和一次性事务消费已有离线证据，但跨任务持续授权、撤销管理面和真实模型/工具宿主消费尚未完成。冻结状态见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

`AuthorizationPolicy` 消费 `AuthorizationStore` 事务端口；Runtime 注入 SQLite 存储，一次性授权的检查和消费在同一事务内完成，重启不会重置次数。`InMemoryAuthorizationPolicy` 保留为隔离测试实现。授权当前仍绑定单个任务和工具，跨任务持续授权管理不是已完成能力。

验证：

```sh
npm run build --workspace=@personal-agent/policy
npm run test --workspace=@personal-agent/policy
```
