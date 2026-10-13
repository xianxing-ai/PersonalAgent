# 连接器宿主（MOD-05）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/connector-host` 提供连接器注册、能力发现、健康状态和连接生命周期。连接器工厂只能读取注册时声明的凭据引用；列表和健康结果不返回凭据。具体凭据由注入的 `SecretStorePort` 提供，Windows Credential Manager / DPAPI 实现仍归 MOD-16。

本包为当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 提供共享业务能力目录，但 AgentArts 不直接获得账号、凭据或连接器对象；只能消费经本地 Runtime/ToolGateway 暴露的受限工具。可选 Local Profile 不建立并行连接器宿主。

ConnectorPort、ConnectorHost 和 `SecretStorePort.read` 当前为 `provisional`。生产 Runtime 尚未公布 `connector.connect` / `connector.disconnect`，账号会话也未持久化；未公布 operation 必须按 `unavailable` 处理。见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

业务查询和写动作不从宿主直接暴露，必须注册为工具并经过 `@personal-agent/tool-gateway`，避免绕过授权策略。当前切片尚未持久化账号会话，也未接真实连接器。

验证：

```sh
npm run build --workspace=@personal-agent/connector-host
npm run test --workspace=@personal-agent/connector-host
```
