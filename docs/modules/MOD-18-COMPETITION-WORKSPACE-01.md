# MOD-18-COMPETITION-WORKSPACE-01：Competition 工作区只读纵向接线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- Profile：`huawei_ict_agentarts`。
- 原实现负责人：`zemeng`；本次主分支重建：`goo122`；状态：`review`
  （定向测试与全仓检查已通过，尚未完成非作者评审或合并）。
- 分支：`codex/competition-workspace-approval-rebuild`。
- 基线：`main@086b9674`，已包含 PR #49 的 Competition 离线审批工具循环和
  PR #83 的受限 `workspace.list` / `workspace.read_text` provider。
- 本片新增范围：`tests/integration/workspace-read-competition.test.mjs` 与本文档；
  不复制 coding-tools 或 Runtime 实现。

## 目标与边界

本片使用公开 `@personal-agent/coding-tools`、`@personal-agent/coordination/testing` 和
`@personal-agent/runtime/application` API，把真实 `workspace.read_text@1.0.0` provider
装入现有 Competition Fake 工具环。它验证的是本地可信组合、Policy/Approval、
ToolGateway、执行记录和 confirmed continuation，不新增第二套端口、registry、wire
operation、生产迁移或授权方式。

测试只在系统临时目录创建合成 UTF-8 源码；不读取真实用户工作区、凭据或私人数据，
不连接 AgentArts、模型、桌面或其他云服务。`rootPath` 由测试宿主直接绑定，绝不来自
proposal。测试结束删除临时目录。

## 纵向行为

主路径固定为：

1. Competition Runtime 的 `capability.list` 精确公布一个 `workspace.read_text` descriptor；
2. `FakeCoordinationPort` 提出只含相对路径和更小字节上限的 `mock` proposal；
3. Runtime 校验后进入 `waiting_approval`，公开审批查询不回显工具参数；
4. `allow_once` 绑定 task、tool、scope、参数摘要和期限；
5. 现有 RuntimeToolInvoker → ToolGateway → `createWorkspaceReadTool` 只执行一次；
6. 读取结果以 confirmed continuation 返回 Fake coordination，最终文本由 Runtime 提交；
7. task、tool execution record 和 conditional Evidence metadata 使用同一 run/evidence ID；
8. 同一个审批响应的幂等重放不触发第二次读取或第二条执行记录。

失败路径只覆盖跨层接线所需的两个增量，不重复 coding-tools 的九项 provider 单测：

- `../outside.txt` 在 provider 的同步路径规范化阶段被拒绝，不产生工具结果 checkpoint，
  不进入 continuation；执行记录为 `failed/INVALID_ARGUMENT`；
- 未注入工具时不公布 `capability.list`，proposal 以 `UNSUPPORTED_CAPABILITY` 失败，
  不产生 Evidence。

## 证据状态与剩余边界

本片通过后，只能证明 actual MOD-18 provider 的离线 Competition 纵向接线为
`provisional/mock`：

- PR #49 已提供 proposal、审批恢复、Policy/ToolGateway、Evidence 引用和 continuation；
- PR #83 已提供受限工作区 provider，包括原生 realpath 规范化、路径 containment、
  敏感文件、UTF-8、大小、deadline、cancellation 与固定序列化输出上限；
- 上层 wire 编码仍执行最终帧大小检查；本片只验证跨层组合，不重复 provider 单测。

真实 `AgentArtsCloudAgentPort` 仍只发送 query、接收文本；没有真实 tool proposal、
continuation、deployment/version/trace/usage 或数据出机读回。本片不把 Fake proposal
当作真实 AgentArts 能力，也不把 generic `verification: conditional` Evidence metadata
当作云端最终回答已核实。

Desktop 尚未提供用户显式选择、展示和撤销可信 workspace root 的生产组合，也未注册
`@personal-agent/coding-tools`。环境变量或本机已有路径不自动构成读取或出机授权；
Desktop 接线应在独立工作包中完成，未配置时继续不注册、不公布。

## 最少验证

在 Node `v24.15.0` / npm `11.12.1` 下运行：

```powershell
node --test --test-isolation=none tests/integration/workspace-read-competition.test.mjs
npm run check
git diff --check
```

当前重建分支的 Competition 定向测试 3/3 通过，`npm run check` 与差异空白检查
均通过。该结果不复用旧堆叠分支证据，也不代表真实 AgentArts、真实用户工作区或
Desktop 组合已经验收。
