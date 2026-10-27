# Windows Client：系统观测、原生电脑控制与 Windows-MCP 兼容适配

## 2026-10-25 兼容适配的观察有效期回归（Local/Synthetic）

保留主线修复：Windows-MCP 兼容入口在异步校验或 attempt 持久化后重验原 targetRef 有效期，
持久 attempt 仍保留且不重放。先红后绿、原检查与独立复核见[验收证据](ACCEPTANCE-20261025.md)。
这项修复未替换下述默认原生执行器，也不表示真实 Windows 或 PA-016 整体验收。

## 2026-10-24 默认原生电脑控制（in_progress）

当前 Competition 实施工作树默认接入 `createWindowsNativeDesktopControlHost()`，通过固定
`personal-agent-desktop/1` stdio 协议调用应用自有 .NET 8 UIA／Win32 组件。普通用户无需配置
Python 路径；源码 checkout 的组件准备需要 .NET 8 SDK，安装形态只使用应用随包提供的组件。
自包含 bundle 已有独立运行时 initialize 回执，但安装器、签名和干净 OS 验收仍 `not_run`。
Windows-MCP 保留为显式 `PA_WINDOWS_CONTROL_PYTHON` 开发兼容入口，下方 2026-10-18 记录按其
原范围保留，不再代表默认执行器。

原生目录提供 16 个 `computer.desktop.*` 工具：`list_windows`、`observe`、`activate`、
`screenshot`、`click`、`type`、`set_value`、`invoke`、`select`、`focus`、`scroll`、`move`、
`drag`、`shortcut`、`press`、`wait`；Desktop 另接 `computer.request_access`。目录存在不等于
组件、目标或权限已可用；每次调用仍经原 Runtime／Policy／ToolGateway，共享输入 lease，
保留 task/run、参数 digest、原 attempt、期限和取消。普通权限、前台、HWND／PID／启动身份、
输入 generation 与一次性 targetRef 保护原目标；UIA／Win32 仍不是原子事务或内核输入沙箱。

仅受信 `ToolNotStartedError` 身份可证明零分派。内部接管／目标变化映射到公共
`REVISION_CONFLICT`；分派后结果未知仍为 `RESULT_UNKNOWN`，禁止重做或换引擎试写。
动作观察不等于业务完成；`set_value` 等明确读回只验证对应控件后置条件。

电脑设置已接启用、观察出口、准备／重试、停止和原会话入口，错误保留 code／stage／安全详情。
截图只返回本地 artifact 元数据。可选 `computer.vision.inspect` 由 Desktop 单独装配，默认
关闭，来源默认 AgentArts 并保留自定义模型；只消费原任务 confirmed 截图，经精确图像出机
授权后调用显式视觉模型，不给普通文字 planner 原图，不把视觉描述称为独立目标验证。

当前证据分别为：真实合成 WPF 设备 13 项、真实 Runtime 原生链 11 项、实际 Electron 产品
17 项、直连 AgentArts 模型的本地新镜像浏览器链通过；真实视觉联合链也已通过随机 Canvas
标记识别与云端续答，原图 17,880 bytes、编码 body 24,454 bytes，原 Evidence 仍 conditional。
原生云端严格六工具重验已通过，含独立 UIA／fixture 读回、PNG、原 SQLite 和资源释放；
这些证据不是新镜像正式平台部署或全产品验收。当前检查的
6 项测试环境失败修后 33 项定向及 57 项根集成通过，原失败日志保留；访问成功语义已补入
Desktop 使用的 Runtime 固定能力上下文并 7/7 定向通过。全目录 65 项及最终集成交主工作包。
具体工具实际调用、回执路径、迁移、运行入口和未验矩阵见
[电脑操控交付记录](../../docs/COMPUTER_CONTROL_COMPLETION_20261024.md)与
[ADR-0039](../../docs/adr/0039-native-desktop-control.md)。

2026-10-25 系统观测完成时间修复及 Linux/Fake 分账验证见
[MOD-17 验收记录](STATUS-ACCEPTANCE-20261025.md)。

## 2026-10-25 观察有效期回归（Local/Synthetic）

修复异步校验或 attempt 持久化期间原 targetRef 过期仍派发输入的问题；持久 attempt 保留且不重放。
先红后绿、当前检查与独立复核见 [验收证据](ACCEPTANCE-20261025.md)。本次不表示真实 Windows 或 PA-016 整体验收。

## 2026-10-18 Windows-MCP 接入（conditional）

`createWindowsDesktopControlHost()` 复用开源 [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)
`v0.8.8`（commit `b74c507d9e709223a0904cf08019edf55f2a75bb`），不实现鼠标、键盘或 UIA 操作引擎，
不运行上游 Agent 循环。上游主项目是 MIT；其依赖包含 GPL 的 fuzzywuzzy / Levenshtein，
本仓库不捆绑或分发上游 wheel 与这些依赖。运行环境须由用户独立安装 Python **3.14+** 和
`windows-mcp==0.8.8`；固定顶层包版本并不锁定其传递依赖。参考 wheel SHA-256：
`597ef720e1902ba76510a4d2b946949f8a48f281dd210c183de5ded60ea3b873`。

Desktop 实际配置入口是 `PA_WINDOWS_CONTROL_PYTHON`（上述 venv 的绝对 Python 路径，仅 Windows
且显式配置时启动）和 `PA_WINDOWS_CONTROL_EXPORT=1`（明确允许当前对话模型接收完整界面文字）。
只配置 Python 不会开启界面结果出口；快照返回 `observationExportAllowed=false` 与明确不可用原因。
开启出口仍不代替同原任务真实 F9 和逐次写入授权，也不保证真实 Windows 动作已验收。

可信配置只传该独立 venv 的 `python.exe` 绝对路径。适配器先以同一 Python 的
`importlib.metadata` 核验包版本，再以 `-I -m windows_mcp serve` 启动固定 stdio 服务。
FastMCP 的 `serverInfo.version` 是框架版本，不能代替 `windows-mcp` 包版本检查。
适配器使用宿主创建的空配置，显式 `--transport stdio --tools Snapshot,Click,Type,Scroll,Move,Shortcut`，
并设置 `ANONYMIZED_TELEMETRY=false`、空 `POSTHOG_API_KEY`；不继承用户的 Windows-MCP 配置。
服务按上游约定仍可列出 `ControlStatus`，它不成为模型工具，也不证明授权或原任务结果。
不执行安装、HTTP 监听或后台计划任务；工具不公开 Shell、PowerShell、Registry、FileSystem、App 启动、
Clipboard、Scrape 或任意 MCP 调用。进程退出仅使用固定系统 `taskkill /PID <自有PID> /T /F` 清理自有进程树。

公开工厂接受：

```js
const provider = createWindowsDesktopControlHost({
  pythonExecutable, // 可信绝对路径；未配置或非 Windows 均 unavailable
  attempts: {record: async (identity, execution) => trustedRuntimeAttemptStore.record(identity, execution)},
  authorizePresence: async ({taskId, signal, deadline}) => trustedLocalPresence(taskId, signal, deadline),
  // 可选受信 OS 身份/坐标校验，不能由模型提供：
  verifyTarget: async ({taskId, targetRef, focusedWindowHandle, toolName, arguments: args}) => verifyOriginalTarget(args),
});
await provider.start({signal, deadline});
// 只有成功连接后 .tools 才公布 RegisteredTool；也可 provider.register(toolHost)。
// health()/dispose() 保留完整释放生命周期。
```

`attempts.record` 必须原子创建并在重复 task/run 时拒绝，不能只返回 `false`；下面的生产 Desktop
宿主已用原 `TaskRuntime.saveCheckpointOnce()` 实现它，没有第二任务库。写入前还核对原任务 running/
未取消、原 deadline、实际 Policy allow/started 执行记录和 exact arguments/scopeRef；参数正文只用于
本地核对，不写入新 attempt checkpoint 或模型回显。
模型工具为 `computer.desktop.observe/click/type/scroll/move/shortcut@1.0.0`，统一 scope
`computer:desktop:control`、`requiresPresence=true`。动作使用明确的有界 `loc:[x,y]`；
不公开无法从上游 Snapshot 对应的旧 label。所有动作保留原 targetRef、原参数 digest、task/run、
授权引用与观察摘要。调用必须继续经原 Runtime/Policy/ToolGateway，工厂不能签发授权。

新增 [Desktop 可信宿主](../../apps/desktop/electron/windows-control-host.js) 接受
`{createControlHost, pythonExecutable, presenceHost, allowObservationExport, onUpdate}`；
`presenceHost` 是主进程共享 F9 broker，包含 `requestPresence(context)` 和 `isUserPresent(taskId)`。
兼容宿主可注入 `registerConfirmation(callback) => unregister`，生产推荐共享 broker。
`await host.start({signal,deadline})` 后将 `.tools`、`.competitionToolAvailability`、`.competitionToolExports`
一起注入原 Runtime，并 `host.bind(application)`。`host.hasPresence(taskId)` 只承认同任务真实 F9
且不超过 30 秒的确认，还要求共享 broker 的原任务绑定仍有效。
`computer.request_access` 仅等待本机 F9，不读取桌面、不调用 MCP 工具、不批准写入；模型先调用它，
目录可以公布需要 presence 的工具 Schema；目录可见不等于已经在场，实际执行和结果出口仍须实时核验。
每次写入仍走原任务审批，不能放入自动写白名单。
模型说“用户已允许”不能创建 presence。

`allowObservationExport` 默认为 `false`。只有可信宿主明确开启并收到同一原任务的本机 F9 后，
结果出口才向当前对话模型提供窗口/UI 文字；跨任务、取消、期限或 broker 绑定失效都拒绝出口。
不默认发送截图，也不自动发送到其他模型或云服务。

观察生成 task-bound、30 秒内有效的 targetRef；动作前再次读取 Snapshot，比对原 focused HWND、
窗口摘要与 UI Tree hash。上游没有 PID/进程启动身份和可靠的窗口坐标原点，
**这个观察约束不是 OS 强身份认证或窗口输入沙箱**：坐标可能落到其他窗口，焦点和界面仍有竞争窗口。
只有额外受信 `verifyTarget` 能补相应校验；它不能冒充已经完成的实机验收。
已知 UAC/登录/凭据/安全/终端等标题、UI Tree 中的 `[password]` 元数据和系统启动快捷键被保守拒绝；
标题检查不是完整系统保护边界。
既有原生 Notepad/F9 工具保留其独立、更严格的目标契约；调用方须用共享仲裁避免两种引擎同时输入。

上游动作回执不等于写后验证。适配器丢弃可能回显输入正文的动作文本，再从同一 focused HWND 读回
Snapshot，结果只标 `state=action_observed, goalVerified=false`，不能据此宣布任务目标已完成。
Snapshot 的普通文本错误（包括 JSON string-array 内的 `Error capturing…`）均 fail closed。
分派后取消、断线、超时或读回失败返回 `RESULT_UNKNOWN`，立即封闭该 provider、清空目标并禁止新 run/目标；
`start()` 也不能清除封闭状态。Desktop 重启绑定时发现原 Runtime 的待核实电脑操作，同样封闭新 provider。
上游没有持久 run 查询 API，故 `recoverySupport=false`；`ControlStatus` 不能用作核实。
原任务核实和进程释放确认前不重放写入，不从新的观察推断旧写入未发生。

定向本地验证：

```sh
npm run build --workspace=@personal-agent/contracts
npm run build --workspace=@personal-agent/windows-client
npm run typecheck --workspace=@personal-agent/windows-client
node --test packages/windows-client/test/desktop-control.test.mjs apps/desktop/test/windows-control-host.test.mjs
```

本次环境为 Linux：只运行 Local/Synthetic 合同与边界测试，没有启动上游 Python 包，没有真实 Windows
桌面动作、麦克风、Live 或模型端到端验收，没有 AgentArts/Laya/云调用。真实 Windows、跨引擎仲裁、
截图坐标/DPI、系统保护、输入接管、文字/Live 工具闭环和强目标身份均仍需独立证据；接口不扩大冻结范围。

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-16（zemeng5208）、MOD-17（zemeng5208）。产品流程：F14、F25、F13；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

2026-10-13：已补 [生产 Runtime/Policy 与持久读回验收](ACCEPTANCE-20261013.md)，包含一次真实采样、拒绝/取消与 Runtime 重开后旧许可失效。尚未验证本次 AgentArts/正式 Desktop 联合链路。当前合并规则以根 AGENTS/CONTRIBUTING 的一位非作者有效批准为准，覆盖下方历史双人门槛。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。


原有 `createSystemObservationTool()` 是一个通过现有
`RegisteredTool` / ToolGateway 边界调用的只读聚合观测工具。

它用两次 `node:os` CPU tick 采样计算系统整体利用率，同时返回逻辑处理器数量、内存总量/
空闲量、系统 uptime 和采集时间。`sampledFrom` / `sampledUntil` 为两次读取的墙钟边界，
`actualSampleWindowMs` 为单调时钟测得的读取区间（含 probe 开销）；
`requestedSampleWindowMs` 仅是请求的等待间隔。时钟被注入时这些字段只属于合成证据。
`capturedAt` 在 CPU、uptime 与内存读取全部完成后生成；CPU 的采样结束边界仍由
`sampledUntil` 单独表示，不能将它当作后续内存读取的完成时间。
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
