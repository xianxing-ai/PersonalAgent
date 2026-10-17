# MCP — Competition read-only slice

## 2026-10-16 默认 fetch 的本机 HTTPS/TLS 验证

新增 `npm run test:mcp-tls-smoke`，见[复现说明](../../tests/manual/mcp/README.md)和[验收记录](../../docs/modules/MOD-06-TLS-20261016.md)。实际 HTTPS 合成服务配合进程专属测试 CA、原 SDK 默认 fetch、SQLite/Policy 验证 5/5：可信证书与单次审批成功；不受信 CA、主机名、目录摘要和重定向拒绝。重启不联网、不重放原结果。无系统信任库修改、证书验证关闭或 HTTPS→HTTP 映射。

服务/凭据/原生确认仍为合成，worker 的配置安全存储为显式 Fake；Evidence 保持 conditional。第三方服务身份、OAuth/令牌签发、真人确认与云端出口仍未验收。本增量只新增验证入口和测试夹具，不改变生产 Host/Runtime 或其 provisional 状态。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 `huawei_ict_agentarts` / PA-005 / MOD-06，`provisional`。复用官方 TypeScript SDK `1.31.0` 和官方 filesystem reference server `2026.8.31`，保留可信固定 stdio 服务；新增受信配置的远程 HTTPS Streamable HTTP 只读纵片，见下文。未实现任意 server 自动注册、动态 shell 或写工具。

## 公开入口

```ts
import {createReadonlyMcpHost} from '@personal-agent/mcp';
const mcp = createReadonlyMcpHost({nodeExecutable, rootPath, enabled: true});
// register(host) 或 RuntimeApplicationOptions.tools: [...mcp.tools]
await mcp.start({signal, deadline});
const ready = mcp.health().connected;
// 退出/停用前 await；dispose 同时释放 register(host) 的注册。
await mcp.setEnabled(false);
await mcp.dispose();
```

`nodeExecutable` 和已批准 `rootPath` 只能来自受信宿主。服务入口由已锁定 npm 包解析，argv 固定为入口和一个 root，`shell:false`；清空 SDK 默认继承的用户环境变量，保留 Windows `SYSTEMROOT`。未给 options 为 `unavailable`，配置默认停用，不回退 Fake。启动必须完成 SDK `initialize`/版本协商、身份与 capability 校验、真实 `tools/list` 后才显示 connected。`health()` 仅返回脱敏状态/错误码/协商版本/工具名，不返回 PID、路径或 stderr。

发现目录中的 annotations/描述/写工具不授权。唯一注册 `mcp.workspace.read_text@1.0.0`：`{path: string}` 为 root 内 `.md/.txt` 的相对路径，禁止额外字段、绝对路径、反斜杠、逃逸、符号链接、敏感名称，限 256 KiB。返回 `{path,text,contentDigest,source:'mcp',serverVersion:'2026.8.31'}`；源变化、私钥/非文本及服务错误拒绝。只读 scope `mcp:workspace:read` 来自现有 Policy；RegisteredTool 只允许 ToolGateway 调用，服务连接本身不签发授权。SDK 请求 ID 匹配、AbortSignal 和 deadline 贯穿调用；同 task/run 不允许替换参数，无确认结果不重发。Runtime 是跨重启幂等、审批和 Evidence 的事实来源；模块内缓存只补会话内绑定，`recoverySupport:false`。

stop/dispose 先撤销在途、移除连接，在 Windows 用已持有的参考服务 PID 回收其进程树后关闭 SDK；非 Windows 复用 SDK 的 EOF/TERM/KILL。固定官方服务不创建子 worker；不承诺任意第三方服务的 OS 沙箱。重新启用只改变 configured/disabled 状态，须再次显式 await start。

## 验证与来源

### 远程只读 Streamable HTTP（G10）

`createRemoteReadonlyMcpHost(options)` 是新增的受信宿主入口；现有 `createReadonlyMcpHost` 和 stdio 行为不变。配置包括 HTTPS `endpoint`、固定 `server:{name,version}`、一个 `tool:{remoteName,descriptor}`、可选 `enabled` 与受信 `fetch` 端口。descriptor 只接收 `name/version/inputSchema/outputSchema/requiredScopes`，host 固定 `sideEffect:'read'` 与 `recoverySupport:false`。输入/输出必须为 object schema；配置和工具声明均不签发权限。

```ts
import {createRemoteReadonlyMcpHost} from '@personal-agent/mcp';
const mcp = createRemoteReadonlyMcpHost(trustedConfiguration); // 默认停用
mcp.register(existingToolGateway); // 或 RuntimeApplicationOptions.tools
await mcp.setEnabled(true);
await mcp.start({signal, deadline});
// Runtime 经现有 Policy/ToolGateway 调用唯一宿主绑定的工具。
await mcp.dispose();
```

初始化必须协商 `2025-11-25` 并匹配服务器 name/version、tools capability 和精确输入/输出 schema；拒绝分页目录。只暴露宿主固定工具名，忽略远端 annotations 的授权含义。工具通过现有 `RegisteredTool` 注册，未给 Policy grant 不会发起 `tools/call`。远端返回必须具有 `structuredContent` 并匹配宿主 schema，不导出任意 text/image/resource blocks。

首包只支持无认证公开服务：URL 禁止用户名/密码、query、fragment；禁重定向、cookies、OAuth 自动发现和自动重试/重连。无配置为 unavailable，默认 disabled；401/403 明确拒绝，不使用环境中的凭据。请求和单条 HTTP 响应流各限 1 MiB，操作最长 30 秒且不超过调用 deadline；同连接串行执行，GET 通知流随 stop/dispose 关闭。目录变化通知立即撤销连接，重新连接需显式 start。

同 task/run 绑定输入，只重放当前会话已确认的结果；失败、取消、断连或换连接后的旧 run 均不自动调用，须由 Runtime 核实或按新 run 提交新任务。会话 map 不替代 Runtime 的持久授权/执行记录。`health()` 仅返回状态、固定工具名、计数、协商版本和脱敏错误码，不暴露 endpoint、session ID 或远端诊断。

单个 host 生命周期最多保留 64 个 run 身份（包含失败/未知结果），每条结果仍受 1 MiB 限制；达到上限时新 run 在网络请求前以 `EXTERNAL_FAILURE` 拒绝，表示本地容量不足，不产生假的未知执行。stop/断线后重连不重置身份配额，stop 释放结果内容并保留输入绑定，旧 run 不重发。恢复服务需受信宿主重新创建 host，并依赖原 Runtime 持久记录防止跨实例重放；普通重连不能绕过上限。

受信 Runtime 消费者可注入同步 `readRunReceipt({taskId,runId,argumentsDigest})`，返回精确原输入摘要及 confirmed/result、failed 或 unknown；查询异常必须拒绝，不能用“查不到”伪造新尝试。新调用仍只能由原 Policy/ToolGateway 的首次执行入口发起。满缓存仅移除已从原 Runtime 读回 confirmed/failed 的本地条目，unknown 不回收；旧 run 每次先读持久回执，故本地条目移除、断连或替换 host 都不会重发。`remoteMcpArgumentsDigest` 仅用于精确输入绑定，不是授权。Desktop 已消费原 Runtime 的回执与当前执行标记，见 [容量修复记录](../../docs/modules/MOD-06-CAPACITY-RECEIPTS-20261016.md)。无读回端口仍保留上述 64 身份限制；64 个未核实 run 全部占满时仍拒绝新调用，需原 Runtime 对账，不自动清理未知记录。

`node --test packages/mcp/test/remote-http.test.mjs` 使用真实本机 HTTP 监听与显式 synthetic MCP fixture，经受信 fetch 端口将固定测试 HTTPS 地址映射到 loopback。覆盖 JSON 与 Streamable HTTP 的 SSE 响应、Policy 一次性授权、身份/schema/目录漂移、认证失败、重定向、大小限制、取消/超时、断连、重连与释放。它不是第三方服务、远程 TLS、OAuth 或真实 Competition/AgentArts 验收。生产 Desktop/Competition composition 尚未注入此 host；持久配置、鉴权引用、写工具及未知写入恢复属 G11/G14。

SDK `1.31.0` 的 StreamableHTTP class declaration 与项目 exact optional 检查冲突，采用其公开 runtime export 的窄传输端口，不修改 node_modules、不放宽编译选项。方案与兼容边界见 [ADR-0029](../../docs/adr/0029-remote-mcp-readonly-transport.md) 和[本包记录](../../docs/modules/MOD-06-REMOTE-READONLY-20261015.md)。

### 配置/目录绑定与凭据引用（G11 / G14 子集）

目录预检成功后、`tools/call` 前才保留 run 身份。预检失败时没有发出工具调用，受信调用方可再次提交同一身份；原串行锁仍拒绝预检期间的并发调用。工具调用一旦可能发出，未知结果仍不得重发。这不恢复已消费的 Policy 授权，也不重开 Runtime 的失败终态或引入自动重试。

本地忙碌或 run 输入冲突只拒绝当前调用，不撤销配置或取消另一项执行；只有原宿主核实的目录失效、当前配置变化及显式撤销使绑定永久失效。

新增 `createBoundRemoteReadonlyMcpHost` 包装原 G10 host，复用原传输、RegisteredTool、Policy 和 ToolGateway。`binding` 为受信配置快照 `{configurationRef,revision,directoryDigest,credential?}`；可选 credential 仅含 `{secretRef,revision,resource,expiresAt}`，没有令牌。`readCurrentBinding()` 必须同步返回当前受信快照或 undefined，`revocationSignal` 负责即时撤销；轮换凭据/配置时必须原子更新相应 revision 和快照，并撤销旧配置。目录摘要可对原 SDK 验证的有序 tools/list 数组调用 `remoteMcpDirectoryDigest(tools)` 得到；目录顺序或内容变化都会拒绝。

凭据读取复用 `@personal-agent/connector-host` 的 `SecretStorePort` 类型（已有内部包，无新增第三方依赖）。只支持已签发给确切 endpoint/resource 的 Bearer access token；宿主负责可信 resource/expiry 元数据与版本，服务端仍须验证 audience。每次 HTTP 请求在异步读取前后重验当前快照、expiry、取消和撤销；不缓存、不记录令牌。POST 受原操作 deadline 约束，额外凭据读取上限 30 秒；原 GET 流随 host stop/dispose 关闭。401/403、缺凭据、非法 token 和 resource 不匹配都拒绝，不使用环境凭据或跟随认证发现。无 OAuth 登录/刷新实现，不声称完整 MCP OAuth 已验收。

绑定入口的工具参数为 **`{bindingRef,arguments}`**；`bindingRef` 绑定 endpoint、服务身份、工具/schema、配置/目录和凭据元数据。宿主应为新 envelope 使用新的工具版本；旧 G10 plain-arguments API 保持原样。只有业务 `arguments` 进入远端 tools/call。Policy 参数摘要覆盖整个 envelope，旧配置 grant 不能覆盖新配置；不改公共授权算法或 wire Schema。

```ts
import {createBoundRemoteReadonlyMcpHost} from '@personal-agent/mcp';
const mcp = createBoundRemoteReadonlyMcpHost(trustedBoundConfiguration);
mcp.register(existingToolGateway);
await mcp.setEnabled(true);
await mcp.start({signal, deadline});
const bindingRef = mcp.currentConfigurationRef(); // 仅 connected 且当前配置有效时返回
// Runtime 提交 {bindingRef, arguments: approvedBusinessArguments}，沿原 Policy 审批。
await mcp.dispose();
```

原 host 的 `expectedDirectoryDigest` 是可选增量：初始化及每次新调用前重读 tools/list，发现静默变化时在 tools/call 前拒绝。绑定 host 将目录变化、当前配置变化或撤销视为永久失效，须以新受信快照重新组装，不能重新 start 恢复旧许可。普通 stop/setEnabled 仍是连接管理，不替代 Policy 撤销；配置管理方必须更新 revision/撤销 signal。会话缓存和 `recoverySupport:false` 不变，不承诺跨重启未知结果恢复。

验证使用本机 HTTP fixture、合成 Bearer token 和合成 SecretStore：授权参数绑定、同名工具旧 grant、目录静默漂移、取凭据期间配置变化/过期/取消/超时/撤销、401/403/重定向、凭据拒绝和脱敏。未接真实安全存储/配置管理、原生设置、Production Competition、OAuth 或实际平台 endpoint。方案见 [ADR-0032](../../docs/adr/0032-remote-mcp-bound-credentials.md)，实际结果见[本包记录](../../docs/modules/MOD-06-BOUND-CREDENTIALS-20261015.md)。

G14 的 [Desktop 增量](../../apps/desktop/README.md) 已提供 safeStorage、会话 nonce、独立管理窗口与 Competition 生产 Runtime 装配；两次实际 Electron 重启、原 Runtime 单次审批/结果读回/旧许可拒绝/撤销通过。对话框响应显式合成、远端为 loopback HTTP fixture，不改变真实平台/OAuth 未验收边界；详见[管理记录](../../docs/modules/MOD-06-MANAGEMENT-20261016.md)及[宿主首片](../../docs/modules/MOD-06-HOST-CONFIG-20261016.md)。

### 公开参考结果出机

`createPublicReferenceExport`（MCP，policy `3.0.0`）与 `createWorkspaceReferenceExport`（workspace，policy `workspace-reference-3.0.0`）复用现有 trusted `CompetitionToolExport.accepts/project`。无配置默认拒绝。保留原 MCP / `WorkspaceReadResult` schema，workspace 支持安全相对 `.js` 等路径和精确 `maxBytes` 参数，不冒 MCP。

- `currentConfigurationRef()`：当前会话/root/configGeneration 的不透明引用，撤销/断连为 undefined。
- `readPreflight(query)`：query 为 `{taskId,proposalId,path,configurationRef,arguments}`。只读原生 PUBLIC 来源/目的预许可和原任务读取资格，返回 `{authorizationId,expiresAt,sensitivity:'PUBLIC',purpose:'reference-summary'|'coding-reference',maxExportBytes}`；没有 digest、没有 receipt 也能完成首读检查。缺明确 PUBLIC/目的/上限拒绝，不能由 Renderer 字段、文件名、云或工作区读取许可代替。
- `readConfirmed({...query,contentDigest})`：只读原 Runtime 的 `{runId,result}`，adapter 必须验证 proposal→run、工具/版本、完整参数（含 maxBytes）/scope、Policy allow、confirmed execution、原结果 checkpoint 和同任务 Evidence，不执行/签权。
- `readAuthorization({...query,contentDigest,byteLength})`：确认原读取后，原生对确切内容的许可；返回相同 preflight scope/id/expiry 加 `contentDigest`。原 PUBLIC 预许可可依法具体化原 SHA；进一步 native 确认仍由 P8 承担，不能伪造或默认批准。

读前 `accepts({...input,phase:'preflight'})` 只查预许可。执行仍经过原 ToolGateway/Policy。`project` 核对原结果 path/字节/SHA/稳定 run、精确许可及当前 scope，导出 `{source,content,byteLength,contentDigest,truncated:false,readConfirmed:true}`。source 为 `approved-reference` 或 `approved-workspace-reference`；content 是明确批准、完整且有界的 PUBLIC 内容，超 native 上限拒绝，不截断、不猜长度。上限由原生许可给定且不超过原读取的 256 KiB。路径、许可身份、run 和 raw Evidence 不出机。

真正云 I/O、异步凭据读取后和恢复 continuation，必须 `accepts({...原proposal,phase:'final',projection:原Runtime保存的continuation.result,signal})`。即使新进程没有 session map，也要重新核原 confirmed 内容和精确原生许可，不能用默认 preflight 代替 final。拒绝/待确认时原 Runtime 保存 confirmed result/pending proposal，恢复只重投影、不重 execute、不重建任务；shared loop/终态归 Runtime。`dispose()` 永久拒绝。原生许可、持久任务和云调用由 P8/CloudRuntime 接线，无新数据库、授权机制或模型 loop。详细端口与统一验收入口见 [交接](../skills/CLOUD_HANDOFF.md)。本增量未 build/测试。

构建现有 contracts/policy/tool-gateway 依赖产物后 `npm run build --workspace=@personal-agent/mcp`；`npm run test:real --workspace=@personal-agent/mcp` 启动实际官方服务，只读取仓库忽略目录的公开合成资料并关闭子进程。真实握手/读取、内存 Policy、Runtime/SQLite/AgentArts/UI 的验收层级分别记录，见 [交接](../../docs/modules/MOD-06-07-MVP.md)。本模块不读取凭据/私有目录、不调用模型。

- [官方 MCP 生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)：初始化、版本协商、截止时间和 shutdown。
- [官方 filesystem 服务](https://github.com/modelcontextprotocol/servers/tree/a40bc270fb5ece62673f8a1196f57116d885c5eb/src/filesystem)：固定 npm 版本的 `gitHead`，依赖 SDK `^1.30.0`，当前选择 `1.31.0`。SDK engines `>=18`；项目目标仍 Node `24.15.x`。
- SDK tarball 自带 MIT LICENSE；filesystem tarball 的 `SEE LICENSE IN LICENSE` 指向 [该提交 LICENSE](https://github.com/modelcontextprotocol/servers/blob/a40bc270fb5ece62673f8a1196f57116d885c5eb/LICENSE)，包含 Apache-2.0/MIT 贡献迁移与文档 CC-BY-4.0。不复制服务源码，不将全部组件统称 MIT；发布归档需保留上游适用声明。

新增依赖只用于标准协议和固定服务，根唯一 lock/build 装配由 P8 串行消费。
