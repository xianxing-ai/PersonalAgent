# 开发对话共用正式 AgentArts 调用入口

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
