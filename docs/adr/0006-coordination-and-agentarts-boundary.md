# ADR-0006：核心认知依赖倒置与 AgentArts 本地信任边界

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：通用 Local Profile 与华为 ICT AgentArts Competition Profile。Competition Profile 的优先级和 AgentArts 主编排职责由 [ADR-0007](0007-huawei-ict-agentarts-competition-profile.md)补充，本 ADR 的本地信任边界继续有效。

- 状态：accepted（架构边界）；实现状态：unavailable
- 日期：2026-09-09
- 负责人：`zemeng`（核心认知与 AgentArts）；`goo122`（Runtime、模型、记忆、工具公共端口）

## 背景

新分工将 ModelGateway/Provider 保留给 `goo122`，把主 Agent、目标/决策图谱、持续认知和 AgentArts 交给 `zemeng`。当前 Runtime Application 直接导入 Agent 与具体模型装配，Agent 又以具体 `ModelGateway` 作为参数，双方仍会因实现细节共同改文件。

AgentArts 位于云端，不能直接继承本地授权、访问私人数据库或决定本地任务终态。云工作流返回成功也不等于电脑操作已经执行并验证。

## 决定

采用依赖倒置的组合边界：

```text
Runtime Application
  -> CoordinationPort（zemeng 实现）
       -> ModelPort / MemoryQueryPort / FactChangeFeed / ToolExecutionPort
          （goo122 实现并由 Host 注入）

AgentArts -> CloudAgentPort -> 动作提案
                              -> 本地 Policy/ToolGateway -> 执行 -> 读回 -> Evidence
```

- Runtime 仍是任务状态、取消、检查点和终态的唯一事实来源。
- Memory 只提供查询与事实变化，不直接修改 Goal、Plan 或 Task。
- Coordination 只能通过公共端口读取记忆、请求模型和提出工具调用，不访问私有数据库。
- AgentArts 适配器隐藏云供应商 DTO；云端只返回文本、计划或动作提案，不携带本地 authorizationRef。
- 所有本地副作用继续经过 Policy 与 ToolGateway；读回验证后才能更新 Evidence 和任务状态。
- 根装配是唯一同时引用双方实现的组合位置；模块包之间只依赖冻结公开端口。

## 独立开发要求

`goo122` 使用 `FakeCoordinationPort` 开发 Runtime、记忆和工具；`zemeng` 使用 Fake CloudAgent/Memory/Tool/Runtime 开发 Competition Coordination 与 MOD-27～32。可选 Local Model/Agent 不阻塞当前比赛工作；任一方都不需要另一方的私人环境、真实账号、云资源或未合并分支。

## 影响

- 需要新增并冻结 Coordination、Memory、FactChange、版本化存储、ToolExecution、Evidence/Artifact 等端口。
- 在这些端口实际交付前，对应能力登记为 `unavailable`，本 ADR 不构成实现证据。
- 现有进程内 Runtime 形态可以保留；依赖倒置不要求提前拆守护进程。
