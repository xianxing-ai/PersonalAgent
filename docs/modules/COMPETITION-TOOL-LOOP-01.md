# COMPETITION-TOOL-LOOP-01：本地可信工具闭环首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 MOD-04B/05/29/30/32。
- 负责人：`goo122`；非作者评审：`zemeng`。
- 分支：`codex/competition-tool-loop`；基线：`main@cdb69a2`。
- 状态：review；离线实现与全仓门禁已通过，待非作者评审；未调用真实 AgentArts、模型或账号。

## 目标

在不让云端持有授权、直接执行工具或设置任务终态的前提下，打通最小离线链路：

```text
Coordination tool proposal
→ Runtime schema/tool validation
→ waiting_approval
→ public approval query and allow_once
→ Policy / ToolGateway
→ trusted execution Evidence
→ confirmed JSON continuation
→ final coordination text
```

## 公共语义

`CoordinationResult` 是严格联合类型：

- `text`：只包含正文和 `mock | unverified`；
- `tool_proposal`：只包含 proposalId、工具名/版本、JSON 参数和 verification；
- 提案不得携带 authorizationRef、Evidence、任务状态或 verified 声明。

离线续跑请求只增加 proposalId、`confirmed` 状态和受信工具结果。Runtime 不向协调端发送授权引用或 Evidence 内容。
当前只有显式 `mock` 提案可执行；`unverified` 提案在增加独立出机授权前返回不支持。
所有对象按精确字段、有限标识符、有限深度/大小和纯 JSON 值校验。

## Runtime 行为

- Competition profile 可由可信组合入口注入 `RegisteredTool`，仍禁止 Local text/model 配置。
- Runtime 以固定 run ID 保存提案 checkpoint；未授权时创建脱敏审批并进入 `waiting_approval`。
- `allow_once` 绑定任务、工具、scope、参数摘要和期限；恢复时不进入 Local Agent。
- 已确认执行通过同一 run ID 幂等读回，Evidence 引用累计到任务。
- `unknown` 保持 `waiting_reconciliation`；未注册工具明确返回 `UNSUPPORTED_CAPABILITY`。
- 循环最多四步，不自动重试云调用或外部写入。

## 当前验证

- 新增 Coordination 契约测试：合法提案可克隆返回；伪造授权/Evidence/终态、verified、空 ID 和非 JSON 参数均拒绝。
- 新增 Runtime 纵向测试：提案→审批查询→allow_once→单次工具执行→结果续跑→最终回答/Evidence。
- 新增无工具与 unverified 提案失败测试，以及 Runtime 重启后的审批恢复测试。
- 定向测试 6/6 通过；Coordination workspace 与 Runtime workspace 回归分别通过。
- `npm run check` 通过：架构、契约夹具、生成类型、全 workspace 类型检查和测试均无失败。
- 验证环境：Node 24.15.0、npm 11.12.1；真实服务测试未运行。

## 未交付

- AgentArts HTTP Adapter 仍只接受文字响应，不猜测真实平台工具事件或续跑协议。
- 未验证真实项目、身份、Agent/Workflow、deployment、API、trace、usage 或出机数据范围。
- 未新增 wire operation、数据库迁移、公开 Evidence 内容 API、持续授权或真实外部写入恢复。
- 本工作包通过不能把 Competition 端口冻结，也不能把 MOD-04B/05/29/30/32 标记 done。
