# MCP — Competition read-only slice

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 `huawei_ict_agentarts` / PA-005 / MOD-06，`provisional`。复用官方 TypeScript SDK `1.31.0` 和官方 filesystem reference server `2026.8.31`，只支持可信固定 stdio 服务。未实现任意 server、远程 MCP、动态 shell 或写工具。

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
