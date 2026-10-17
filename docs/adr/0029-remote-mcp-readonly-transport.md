# ADR-0029：远程 MCP 的首个只读传输纵片

- 状态：proposed
- 日期：2026-10-15
- Profile：`huawei_ict_agentarts`
- 负责人：goo122；MOD-06 / G10

## 背景与理由

现有 MCP 仅固定 stdio filesystem 服务；G10 需要先验证远程发现、只读调用和连接生命周期。固定一个公开工具可沿用现有 Policy/ToolGateway 验证权限边界，避免在缺少鉴权与持久配置时暴露任意服务目录。

## 决策

在现有 `packages/mcp` 复用已锁定 SDK 1.31.0，增加受信宿主配置的 HTTPS Streamable HTTP host。沿用 SDK 支持的 `2025-11-25` 协商，不采用尚未接入的 draft 协议。服务地址必须为无用户信息、query、fragment 的 HTTPS endpoint。固定服务器 name/version 和一个只读工具的名称、输入/输出 schema 均由受信宿主配置；远端 annotations 不决定权限。

host 只通过现有 `RegisteredTool` / `ToolHost` 接线，由 Runtime/ToolGateway/Policy 决定执行许可。新入口默认停用，不接 Renderer 设置或真实 Competition composition；不注册任意发现的工具。返回值限有界 `structuredContent` 并按宿主 schema 校验。连接、发现、调用均支持取消及 deadline；禁重定向、环境凭据、OAuth 自动发现和自动重连/重试。目录变更通知使当前连接失效。未知调用结果不得自动重发，同 task/run 改参拒绝。

首包仅处理无认证公开 endpoint；401/403 明确失败，鉴权引用/安全存储、任意写工具、持久恢复、旧 HTTP+SSE 兼容及实际平台 endpoint 留待独立工作包。`fetch` 是受信宿主注入的传输端口，测试用它把固定 HTTPS 地址转到显式本机 HTTP fixture；这不构成真实远程 TLS 或平台验收。

## 兼容与验证

新增 package export，不更改 wire、公共 Schema、数据库或依赖；保留固定 stdio host。会话内 run 记录仅补充 Runtime 事实来源，`recoverySupport:false`，不承诺跨重启去重。stop/dispose 关闭本机传输并撤销在途请求，不要求远端删除会话成功。无模型、AgentArts 或私人数据 I/O。

验证包括本机 HTTP fixture 的协议握手、JSON/SSE 响应、Policy 拒绝、工具/schema/身份漂移、重定向、401、未知结果、取消/超时、重新连接和释放；完整 check 与现有 stdio 回归。该证据不得提升为 frozen 或真实云工具可用。

依据：[官方 2025-11-25 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。Streamable HTTP 响应中的 SSE 与旧版独立 SSE transport 分别处理。

## 替代方案与复审

不另写 JSON-RPC/流解析器，也不为 SDK 单个声明问题升级依赖或放宽全仓编译检查。旧 SSE transport 在出现对应实际服务需求时再评估。G11/G14 接入鉴权引用、目录/配置持久版本和真实 Runtime 恢复时复审本方案；真实 endpoint 与非作者评审完成前保持 provisional。
