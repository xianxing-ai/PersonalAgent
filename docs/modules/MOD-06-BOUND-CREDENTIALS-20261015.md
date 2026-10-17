# MOD-06：配置/目录绑定与凭据引用

- Profile：`huawei_ict_agentarts`；goo122；PA-005；G11/G14 的最小只读子集。
- 状态：`in_progress`，接口 `provisional`；不完成整个 MOD-06 或完整 G11/G14。
- 基线：PR #369 `c39b7342d4211f72a55d2cf0aceea9216aeeb5bb`。
- 工作树：`.worktrees/goo122-mcp-binding-20261015`；分支 `codex/goo122-mcp-binding-20261015`。
- 方案：[ADR-0032](../adr/0032-remote-mcp-bound-credentials.md)；[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 实现

新增 bound host，复用原 G10 transport 与 RegisteredTool/Policy/ToolGateway。受信快照固定配置引用/revision、目录摘要以及可选凭据引用/revision/resource/expiry。同步当前快照读取和撤销 signal 由受信宿主提供；不在 MCP 复制配置库、账户或令牌存储。内部类型依赖复用已存在 connector-host 的 SecretStorePort，根 lock 仅增加这一内部依赖项，无第三方升级。

工具参数采用显式新 envelope `{bindingRef,arguments}`，由宿主配置新工具版本。摘要绑定 endpoint、服务身份、工具/schema、配置/目录及凭据元数据；旧 grant 的参数摘要不能覆盖新 envelope。只将内层参数发给远端，凭据及配置元数据不进入远端 JSON、Renderer、健康状态或错误。匿名 G10 API 保持兼容。

目录 pin 在握手及每次新调用前重新核验，拒绝未发通知的静默漂移。配置/目录变化和撤销使 bound host 永久失效，需重新装配。普通 stop/setEnabled 仅管理连接，受信配置管理者负责 revision 与 Policy 撤销；当前会话 run 绑定/未知结果不重发及 recoverySupport:false 保留。

凭据仅为已签发到确切资源的 Bearer token，按每次请求从 SecretStore 读取；校验 resource/expiry、格式与长度，不缓存、不刷新、不发现 OAuth、不读环境。读取前后及发网前重验配置/撤销/取消；取消或超时可结束等待非协作的 secret provider，其迟到结果不能发网。服务端仍须校验 audience，客户端不把宿主元数据冒充 JWT 验签。

## 验证记录

- 原锁安装成功；MCP workspace build 通过。
- `node --test packages/mcp/test/bound-remote.test.mjs packages/mcp/test/remote-http.test.mjs`：15/15 通过。
- 8 项新 bound 测试覆盖真实 loopback HTTP + 显式 synthetic SecretStore/token，7 项原 G10 用例回归；复用 fixture，无真实远端 TLS 或安全存储验收。
- 原 Policy 对新参数与旧 grant 返回既有 `SCOPE_DENIED`，旧 envelope 在输入校验阶段拒绝；拒绝时不消费原 grant、不读凭据、不发 HTTP。
- 覆盖每个 HTTP 请求的固定 Bearer header、业务参数隔离、旧配置许可、目录静默变化、撤销、缓存结果拒绝、异步凭据竞态、到期、取消、deadline、非法/缺失凭据、resource 错误、401/403/重定向及脱敏。
- 完整 `npm run check` 退出 0：37 个汇总块、3191 项，3155 通过、36 跳过、0 失败、0 取消；架构/生成类型/类型检查、工作区及根集成通过，原官方 filesystem stdio 真实握手/读取回归通过。
- 36 个跳过项包含 5 个本机未编译 WindowsJobProcessHost；其余涉及 PowerShell helper、符号链接权限、真实服务 opt-in、平台限制与既有显式跳过。未改断言或使用真实账号补测，详细汇总保留在原日志。
- 全仓检查期间补强同步配置读取返回后的撤销/取消重验与测试等待保护；随后 MCP 构建、15/15 定向再次通过，未重复全仓检查。`git diff --check`、新增文本与文档链接检查通过；lock 只有既有 connector-host 内部依赖一行变化。
- 模型/AgentArts 调用 0；无真实账号、密钥、Vault 或用户记忆访问。合成测试令牌仅在 fixture 中使用。

## 未完成与交付

无 wire/公共 Schema、数据库迁移或公共授权算法变化。真实 SecretStore/持久配置管理适配、原生设置、生产 Competition 注入、OAuth 登录/刷新、真实平台 endpoint 与跨重启执行 Evidence/未知写入恢复未交付。本次只读 host 验证不提升 frozen/真实云可用性。

用户已授权本工作包提交、普通推送并创建基于 #369 分支的独立 PR。本记录在交付前更新，实际提交、PR 与 CI 状态以 Git/GitHub 为准；未获合并授权，非作者评审和集成仍待真实完成，完整 MOD 保持 in_progress。
