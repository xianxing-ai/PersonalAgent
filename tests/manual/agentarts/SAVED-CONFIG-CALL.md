# 开发对话共用正式 AgentArts 调用入口

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

当前 Windows 本机的开发对话使用同一个受信 Electron 配置宿主，不复制密钥到聊天、环境变量、请求文件或其他工作树。它读取现有 `.cache/sis-live-user-data` 配置；不修改配置、云端工作流、发布版本或本地数据库。

在已配置的正式工作树执行：

```powershell
node tests/manual/agentarts/support/run-saved-config-call.mjs --describe
```

这只读配置，`networkCalls: 0`。`configured` 不代表网关可连接。

实际调用必须提供一份明确的公开或合成请求 JSON，例如：

```powershell
$request = @{
  goal = '仅回复已连接，不调用任何工具。'
  deadline = [DateTime]::UtcNow.AddMinutes(3).ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  dataClass = 'synthetic'
  responseMode = 'text'
}
[IO.File]::WriteAllText((Join-Path $PWD '.cache/call-request.json'), ($request | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
node tests/manual/agentarts/support/run-saved-config-call.mjs .cache/call-request.json
```

`responseMode` 可为 `text` 或 `tool-proposal-json`。入口只调用既有 CloudAgentPort，不执行本地工具、授予审批或更改任务终态。正式工具执行继续通过 Desktop → Runtime → Policy/ToolGateway。不要向此开发入口提交私人笔记、邮箱、聊天历史或凭据。

多个开发对话共享项目内 `call.lock`，一次只发一个请求。正常完成后释放；异常中断保留锁和未知结果，先核实，不自动删除锁或重复发送。结构化回执保存在被忽略的 `.cache/agentarts-development/`，不记录 Authorization 或原始失败正文。

此入口依赖本机用户的 Windows 安全存储；其他机器或云端对话通过本机协调者提交公开请求，不能复制本机加密文件作为可用凭据。

2026-09-30 实际连接核对：已有配置可解密；原 API Key 摘要与控制台一致；原请求和控制台明确的 `endpoint=Latest` 均返回 HTTP 403。错误回执未取得结构化服务错误码。该入口已接通凭据读取，云端可用性仍未恢复，不能据此声明演示成功。
