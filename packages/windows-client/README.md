# Windows Client：只读系统观测首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/windows-client` 当前只提供 `createSystemObservationTool()`：一个通过现有
`RegisteredTool` / ToolGateway 边界调用的只读聚合观测工具。

它用两次 `node:os` CPU tick 采样计算系统整体利用率，同时返回逻辑处理器数量、内存总量/
空闲量、系统 uptime 和采集时间。`sampledFrom` / `sampledUntil` 为两次读取的墙钟边界，
`actualSampleWindowMs` 为单调时钟测得的读取区间（含 probe 开销）；
`requestedSampleWindowMs` 仅是请求的等待间隔。时钟被注入时这些字段只属于合成证据。
它不会读取或返回 hostname、用户名、进程、命令行、路径、
文件、网络地址或凭据，也不会提权、启动 PowerShell、接入或发布 TraceGuard。

`describeSystemObservationCapabilities()` 公开提供者支持的 CPU、内存和 uptime 字段，及未实现的
进程归因、磁盘 I/O、温度和网络活动；它不是生产握手或本次读取成功的保证。实际调用成功后，
这些未实现字段仍在结果中标记为 `unavailable`。采样失败返回脱敏 `EXTERNAL_FAILURE`，
取消返回 `CANCELLED`，deadline 过期返回 `TIMEOUT`；不会把缺失/失败值伪装成零。
这些聚合值只说明
观测到的资源压力，不能证明电脑变慢的原因。

工具需要最小 scope `computer:system:read`，输入必须是空对象；deadline 或取消会中止采样并
清理计时器，不自动重试。默认 probe 使用 `node:os`，测试通过注入的合成 probe 验证，不读取
开发机数据。使用注入 probe 时结果固定标记 `source=injected`，不构成真实本机观测证据；仅默认
适配器标记 `source=node:os`。

`register(host)` 将工具交给现有 `ToolHost` 并返回注销函数；可信宿主也可通过 Runtime 的工具数组显式装配。
当前 main 的 Runtime/Application 已重新导出 `createSystemObservationTool`，Desktop 的
`createPublicConnectorHost` / `createProductToolsComposition` 使用该工厂注册本工具，再向 Runtime 注入 tools。
只有实际注册后才能在能力发现中公布，缺工厂时保持不可用；此接线不等于实际采样、授权或云端消费成功。
提供者结果是本地输出；没有为其配置 Competition 结果出口时，不自动将系统指标发送到 AgentArts。
本包不代表 Desktop、AgentArts、MOD-16 或 PA-011 已完整验收。

验证：

```sh
npm run typecheck --workspace=@personal-agent/windows-client
npm run build --workspace=@personal-agent/windows-client
npm run test --workspace=@personal-agent/windows-client
```

Windows 普通用户实机读回：先在仓库根执行 `npm ci`、构建 contracts 与本包，然后在非管理员
PowerShell 用独立新文件执行：

```powershell
$evidence = Join-Path $env:LOCALAPPDATA ("mod17-provider-" + [guid]::NewGuid().ToString("N") + ".json")
node packages/windows-client/scripts/capture-windows-evidence.mjs $evidence
```

输出文件必须不存在，脚本不会覆盖；Windows 文件访问权限继承用户的 LocalAppData 目录，
仅在本机保存并分享经审核的脱敏内容。脚本只保存来源、采样时间、
Schema 校验与不可用项等脱敏元数据，不保存 CPU/内存数值、用户名或设备标识。
这次调用直达 provider，**不验证**终端是否已提权、生产授权、capability 握手、AgentArts 或 Desktop。
