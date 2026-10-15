# MOD-06 / G10：远程只读 MCP 传输

- Profile：`huawei_ict_agentarts`；负责人 goo122。
- 状态：`in_progress`；接口 `provisional`。
- 基线：main `8c395f5fdbc0ea77790174fce657853a357e57fa`。
- 工作树：`.worktrees/goo122-remote-mcp-20261015`。
- 分支：`codex/goo122-remote-mcp-20261015`。
- 依据：PA-005、[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)、[ADR-0029](../adr/0029-remote-mcp-readonly-transport.md)。

## 边界与实现

复用锁定 SDK 1.31.0，在现有 MCP package export 中增加 `createRemoteReadonlyMcpHost`。默认停用；受信配置固定 HTTPS 地址、服务器 name/version 和单个远端工具名称及 schema。完成 initialize、协议协商、tools/list、JSON/SSE tools/call、取消/期限、stop、重新连接与 dispose。现有 stdio host 保留。

唯一绑定通过原 `RegisteredTool/ToolHost` 进入 Runtime/ToolGateway/Policy，不建第二套授权/工具注册系统。服务器目录不是许可来源，写工具即使声明 readOnlyHint 也不注册；只读副作用由宿主配置负责。未知结果不重发，task/run 不能换参。目录变化使连接失效；会话缓存不是跨重启执行记录。返回仅允许经过 schema 校验的 structuredContent。

禁止 URL 中的凭据/query/fragment、重定向、cookies、自动认证发现、重试和静默 fallback；无环境凭据读取。请求及单响应流限 1 MiB；操作最长 30 秒且受调用 deadline 约束。所有对外错误脱敏，首个故障原因不会被随后的取消覆盖。SDK 声明冲突使用公开 runtime export 窄端口适配，未修改依赖或全局类型检查设置。

## 验证

- 独立工作树按原 lock `npm ci --ignore-scripts`，无新增/升级依赖。
- `npm run build --workspace=@personal-agent/mcp`：通过。
- `node --test packages/mcp/test/remote-http.test.mjs`：7/7 通过。
- 本机真实 HTTP listener + 显式 synthetic MCP fixture，使用受信 fetch 映射固定 HTTPS 测试地址；验证真实 SDK JSON-RPC/会话 header 和 JSON/SSE 解码，不冒充远程 TLS/第三方服务。
- 覆盖未授权 0 次调用、一次性 grant、忽略目录写工具、401/403、重定向、身份/schema/分页漂移、结果大小、取消/超时/断连、未知 run 不重放、改参拒绝、目录变化、重新连接与释放。
- 完整 `npm run check`：退出 0；37 个汇总块共 3183 项，3147 通过、36 跳过、0 失败、0 取消；包含架构/生成类型/类型检查及根集成测试。旧官方 filesystem stdio 握手/真实读取回归通过。
- 36 个跳过项包括 5 个未编译的 WindowsJobProcessHost 测试，其余为 PowerShell helper/符号链接权限、平台限制、真实服务显式 opt-in 或既有跳过项；未用真实账号补测，也未移除或放宽断言。
- 测试等待增加有限上限后，远程定向最终复核仍为 7/7；该测试层调整后未重复全仓检查，无生产代码追加变化。`git diff --check`、新增文本检查及文档链接检查通过。
- 模型与 AgentArts 调用 0；无 Vault/用户记忆访问，无真实账号、凭据或外部数据发送。

## 未完成与交付

无 wire/公共 Schema、数据库迁移、Node 依赖或其他模块 API 变更；新增 MCP package 本地导出仍为 provisional。未注入真实 Desktop/Competition composition；OAuth/鉴权引用、平台实际 endpoint、旧独立 SSE transport、动态任意工具、写工具、持久目录/配置版本与未知写入恢复未完成。生产启用必须后续工作包核实相应授权、凭据生命周期和 Runtime Evidence；本包不完成整个 MOD-06。

用户已授权本工作包提交、普通推送并创建基于 main 的独立 PR；本记录在交付前更新，实际提交、PR 与 CI 状态以 Git/GitHub 为准。未获合并授权，非作者评审和集成待真实完成，完整 MOD 保持 in_progress。
