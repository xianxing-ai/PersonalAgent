# ADR-0032：远程只读 MCP 的授权绑定与凭据引用

- 状态：proposed；日期：2026-10-15。
- Profile：`huawei_ict_agentarts`；MOD-06 / G11、G14 最小子集；负责人 goo122。
- 基线：[ADR-0029](0029-remote-mcp-readonly-transport.md) / PR #369。

## 背景与决定

G10 的匿名固定 host 已验证连接与只读调用，但同名工具的旧许可不应在配置、目录或凭据轮换后继续有效。新增 `createBoundRemoteReadonlyMcpHost`，复用 G10 传输及现有 ToolGateway/Policy，不引入另一套 Runtime、授权库、令牌存储或 OAuth 客户端。

受信宿主提供固定配置快照、同步当前快照读取、撤销 signal 和既有 `SecretStorePort`。快照含配置引用/revision、目录摘要及可选凭据引用/revision/resource/expiry，不含令牌。凭据仅限该 endpoint 的预先取得 Bearer access token；不读取环境、不刷新、不自动发现授权服务器，401/403 拒绝且不重试。

绑定 host 的工具参数为版本化 envelope `{bindingRef,arguments}`；bindingRef 是 endpoint、服务器/工具 schema、配置/目录与凭据元数据的摘要。原 Policy 的参数摘要包含 envelope，因此变更配置的旧 grant 在参数校验/Policy 前被拒绝。调用远端时仅发送内层 arguments，不把引用、revision 或 bindingRef 发给服务。

G10 host 增加可选目录 pin，握手和每次调用前重新 list/核验目录。目录变更、当前快照变化和撤销使 bound host 永久失效，须重新组装；同 task/run 参数绑定和未知结果不重发继续归原 host/Runtime 负责。

每次 HTTP 请求在取凭据前、取回后以及发网前重验快照、resource、expiry、取消与 deadline；异步 secret read 可被取消，不缓存令牌，禁 token query/cookie/重定向。令牌仅作为发向固定 endpoint 的 Authorization header。宿主必须保证凭据引用只指向该资源的 token，轮换时递增凭据 revision；服务端仍须验证 token audience。

## 兼容与影响

原匿名 G10 API/参数保持兼容。bound host 是显式新入口，调用者必须使用新工具版本及 envelope，不能给原 plain-arguments 工具静默升级；工具版本由受信装配提供。本包不注入 Desktop/Competition 生产装配，不改变 wire Schema、数据库或公共授权算法。MCP 增加已有 connector-host 的内部类型依赖，复用其 SecretStorePort，无第三方依赖升级。

## 验证与替代方案

本机 HTTP fixture + 合成 SecretStore 验证原 Policy 一次性授权、旧许可、目录静默变化、撤销、异步取凭据期间配置变化/到期/取消、凭据缺失/非法、401/403 及脱敏；原 G10/stdio 回归。完整 check 后记录实际结果。无真实账号、密钥、Vault 或云调用。

不在 MCP 中实现通用账户管理/OAuth，避免重复已有安全存储。完整登录/刷新、持久配置管理、跨重启 Runtime Evidence 与未知写入恢复在后续工作包实现；真实平台验收前保持 provisional。接入真实配置管理时复审同步快照/revocation 与凭据 revision 的原子更新约定。

依据：[MCP 2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。预先签发 token 的受信适配不等于完整 OAuth 标准流程已实现。
