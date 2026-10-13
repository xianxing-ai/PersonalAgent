# MOD-17-COMPUTER-STATUS-01：电脑状态只读提供者

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人 `zemeng`；本地主控审查与 GitHub 非作者评审分别记录；需求 PA-011。
- 基线：`4efa7f60feaaa007d73c80e7d90091e0caab3bc7`；状态：review 前的实现切片。
- 复用已合并 PR #59 的 `computer.system.observe@1.0.0` 与 `computer:system:read`。旧 `MOD-16-SYSTEM-OBSERVATION-01` 记录保留为历史；当前 MOD-16 的 Windows 执行另行开发。

## 可观测边界

默认 `node:os` 实际读取两次 CPU tick、逻辑核数、内存总量与空闲量、uptime。输出保留 `source=node:os`，并增加两次 CPU 读取的 UTC 墙钟边界与单调时钟测得的实际采样窗口；请求的等待间隔独立报告。注入 probe 仅标记 `source=injected`，属于合成测试。

提供者能力描述列明支持 CPU、内存和 uptime；不宣称每次探测都能成功。单次读取失败完整拒绝且仅返回脱敏 `EXTERNAL_FAILURE`；取消、超时分别为 `CANCELLED`、`TIMEOUT`，不使用虚构零值。进程归因、磁盘 I/O、温度、网络活动明确不可用。不读取用户名、主机名、进程、文件、网络地址或凭据；不得凭资源压力推断故障原因、温度或优化效果。

## 装配交接

本包的描述函数仅是提供者元信息；`register(host)` 复用现有 `ToolHost` 契约并返回注销函数。生产工具发现须由可信 Runtime/ToolGateway 在实际注册时公布，未经注册仍应返回 `UNSUPPORTED_CAPABILITY`。需要 goo122 确认 Competition Profile 真实工具装配，可信宿主可采用现有公开入口，不规定使用 `register(host)` 或 `RuntimeApplicationOptions.tools` 数组；须保留 Policy/ToolGateway 对 `computer:system:read` 的检查、取消和 deadline。不改变公共 wire Schema、根装配、锁文件或接口目录。Desktop 负责人须在现有安全 Client/Preload/IPC 路径消费 Runtime 的结果，显示来源、时间、不支持项和失败，不由 Renderer 直读 `node:os`。AgentArts 真实工具提案与回传证据另行验收。

## 当前源码装配核对（2026-10-07）

在当前 `main@4b5ec61` 核对，公开系统观测工具工厂已由 Runtime 导出，Desktop 的公开连接器宿主和产品组合已有工具注册及 Runtime 消费入口。显式开启的主动认知宿主可消费只读观测与既有 P5 事件链；Renderer 不直接读取 `node:os`。上面的“装配交接”记录原始切片边界，不再表示实际工具注册和这些消费入口尚未实现。

支持范围仍为 CPU、内存和 uptime 汇总；其他指标明确不可用。这条只读链不会自动把原始系统观测导出到 AgentArts，显式云分析须走既有独立许可。下面的 Windows provider 直读历史证据保留原 head 和证据等级；完整 Policy/ToolGateway 授权、真实 AgentArts 提案与回传、Desktop 展示的实机关联读回仍待对应云资源及 Windows 现场协作者完成，不能据源码装配将 MOD-17 或整个 MVP 标记完成。

## 实机验收（Windows 普通用户权限）

1. 在 Node 24、Windows 普通用户会话，授权 `computer:system:read` 后通过受信 ToolHost 调用一次，记录脱敏的 `source`、UTC 时间区间、实际/请求采样窗口及输出 Schema 校验结果；敏感原始观测值不进入 PR。
2. 交叉核对 OS CPU tick、内存和 uptime 的读取路径，另在受限机器上演练 probe 失败，证明返回脱敏 `EXTERNAL_FAILURE`，无零值替代；取消/过期均不能继续第二次读取。
3. 复核未注册与未授权时无 probe 读取，分别记录 `UNSUPPORTED_CAPABILITY` 与策略拒绝。检查 UI 明示不支持的指标和来源，不凭 CPU/内存作因果诊断。
4. 如需宣称 Competition 端到端可用，另记录真实 AgentArts deployment/API/trace、工具提案、Runtime 授权/执行及 Desktop 展示的一次关联读回。离线 Fake 与 Linux 运行结果不能替代该证据。

本执行代理环境没有 Windows 设备；本地主控的 Windows provider 直读证据见文末。
完整的生产工具/AgentArts 实机步骤未执行。此切片不宣称 MOD-17、PA-011 或整体 MVP 完成。

### 先行的 provider 实机取证

在普通用户、非管理员 PowerShell 中，从仓库根执行（输出文件在用户的 LocalAppData 下，
每次使用新 GUID 文件名）：

```powershell
npm ci
npm run build --workspace=@personal-agent/contracts
npm run build --workspace=@personal-agent/windows-client
$evidence = Join-Path $env:LOCALAPPDATA ("mod17-provider-" + [guid]::NewGuid().ToString("N") + ".json")
node packages/windows-client/scripts/capture-windows-evidence.mjs $evidence
if ($LASTEXITCODE -ne 0) { throw "provider evidence capture failed" }
Get-Content $evidence
```

脚本仅允许 Windows、只创建新文件，成功终端输出 `PASS`，失败仅输出脱敏错误码且退出非零。
Windows 文件 ACL 继承该用户目录；只在本地保留，分享前再次检查脱敏字段。
证据 JSON 不含原始 CPU/内存值、主机名、用户名、文件路径、网络信息或凭据。
检查 `source=node:os`、`schemaValid=true`、`aggregateValuesPresent=true`、采样时间与不可用项；
`productionAuthorizationVerified=false` 和 `agentArtsVerified=false` 是刻意保留的边界。
这一步直调 provider，不能自动证明 PowerShell 未提权，也不能替代上面的 ToolHost 权限拒绝、
能力握手或 AgentArts 真实闭环验收。记录操作人对普通用户会话的确认即可，不在证据 JSON 中
伪造“已验证普通权限”。

### 本地主控回传的 Windows 直读证据（2026-09-24）

本地主控报告在干净独立工作树、固定 PR #119 远端 head
`69654b185c97215e54dca705087fb907562aff16` 上执行，普通用户会话确认
`ADMIN_TOKEN=false`。环境为 Windows NT 10.0.26200.0、Node 24.19.0、npm 11.16.0、
SDK 8.0.424。Node/npm 与仓库建议的 24.15.x / 11.12.x 不一致，出现版本警告。
此前 `npm_config_offline=true` 使依赖获取失败（`ENOTCACHED`）；平台批准后改为
`offline=false`，从锁文件执行 `npm ci --ignore-scripts`，安装 96 packages、退出码 0，
未改全局配置或 registry。仅构建 contracts 与 windows-client，均退出码 0；
一次 provider 取证脚本退出码 0，并输出 `PASS`。本次不是完整根检查。

脱敏 JSON 的 SHA-256：
`A93BBBC2CEBEFCC1BBB838CE62B8F17FBA3B70CA9C66434454ED2D77851455CA`。
核对的字段如下；本记录不包含本机证据路径、CPU/内存原始数值或设备身份。

| 字段 | 回传值 |
| --- | --- |
| `source` | `node:os` |
| `sampledFrom` | `2026-09-24T13:33:52.192Z` |
| `sampledUntil` / `capturedAt` | `2026-09-24T13:33:52.447Z` |
| `requestedSampleWindowMs` / `actualSampleWindowMs` | `250` / `254.93` |
| `schemaValid` / `aggregateValuesPresent` | `true` / `true` |
| `unavailable` | `process_breakdown`, `disk_io`, `thermal`, `network_activity` |
| `productionAuthorizationVerified` / `agentArtsVerified` | `false` / `false` |

证据等级仅为上述固定 head 的真实 Windows provider 直接读取。后续文档提交未经
Windows 重跑；普通用户状态是本地主控确认，脚本未自动验证令牌。生产 Policy/ToolHost、
capability 握手、AgentArts 工具提案及 Desktop 展示仍未验证。

状态分别记录：代码切片已实现并获此 provider 实机读回；PR #115 已合并，#119 仍需按当前合并差异评审；MOD-17/PA-011 未完成；整体 MVP 未完成。
