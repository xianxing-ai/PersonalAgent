# 连接器宿主（MOD-05）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-05（goo122）。产品流程：F02、F14、F15、F21、F24、F25；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

统一语义裁决由自有ARM64镜像内Laya承担；国内MaaS为执行模型，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。独立节点按真实依赖并行，影子/历史评估默认后台。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

`@personal-agent/connector-host` 提供连接器注册、能力发现、健康状态和连接生命周期。连接器工厂只能读取注册时声明的凭据引用；列表和健康结果不返回凭据。具体凭据由注入的 `SecretStorePort` 提供，Windows Credential Manager / DPAPI 实现仍归 MOD-16。

本包为当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 提供共享业务能力目录，但 AgentArts 不直接获得账号、凭据或连接器对象；只能消费经本地 Runtime/ToolGateway 暴露的受限工具。可选 Local Profile 不建立并行连接器宿主。

ConnectorPort、ConnectorHost 和 `SecretStorePort.read` 当前为 `provisional`。生产 Runtime 尚未公布 `connector.connect` / `connector.disconnect`，账号会话也未持久化；未公布 operation 必须按 `unavailable` 处理。见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

业务查询和写动作不从宿主直接暴露，必须注册为工具并经过 `@personal-agent/tool-gateway`，避免绕过授权策略。当前切片尚未持久化账号会话，也未接真实连接器。

验证：

```sh
npm run build --workspace=@personal-agent/connector-host
npm run test --workspace=@personal-agent/connector-host
```
