# MOD-16-GEMINI-MVP-WINDOWS-EXECUTION：Windows Host 执行生产缺口补齐与目标状态读回

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 目标 Profile：`huawei_ict_agentarts`（比赛主路径，Local 保留为可选 baseline）。
- 需求与任务：MOD-16 / PA-016；负责人 `zemeng`，非作者评审 `goo122`。
- 本工作包分支：`codex/gemini-windows-execution`（基于 PR #179 head `108d9136343eecdcc6e10bc65333e26b56f6514b`，向 `codex/zemeng/mod16-pipe-bridge` 发起草稿 PR）。
- 变更范围：独占 `apps/windows-host/**` 及本文档；不修改 Desktop、Runtime、Policy、公共 Schema、根配置/锁文件、`packages/windows-client` 或其他工作树。
- 当前接口与能力状态：内部 Pipe 协议为 `0.1.0` provisional；运行时执行能力保持 `unavailable`。

---

## 1. 核心改进与生产缺口补齐

本工作包基于 #117、#120、#172、#179 原生 Pipe Bridge 与 Host 基础，对照 #168 契约及 #178 / #182 Runtime 适配需求，补齐以下生产缺口：

### 1.1 真实会话、进程与 HWND / 文档归属绑定及标签页隔离
- **会话隔离**：`NotepadTargets` 构造与 `Observe` 均检查 `process.SessionId == Process.GetCurrentProcess().SessionId`，防止 Windows 多登录会话（或 Fast User Switching / Session 0）下的记事本进程相互干扰。
- **观察前既有窗口与标签页隔离**：初始化时完整快照当前会话中既有记事本顶层 HWND（包括隐藏与被拥有窗口）；若 Windows 11 记事本将新文档以新标签页（Tab）形式合并入既有 HWND，该既有 HWND 始终在快照中被排查排除，明确返回 `NOT_FOUND`，杜绝触碰用户既有私人标签或旧窗口。
- **新建归属与进程信任核查**：在 `Observe` 枚举候选窗口时，逐一校验 `NotepadAction.IsTrustedNotepadProcess(process)`。凡提权（Administrator）、非 System32 经典记事本且包名非 `Microsoft.WindowsNotepad_8wekyb3d8bbwe`、或无法读取进程信息者，标记为不可核验并明确拒绝（返回 `UNAUTHORIZED`）。
- **目标唯一性与结构判定**：
  - 零新增窗口：返回 `NOT_FOUND`。
  - 多个新增窗口：返回 `TARGET_AMBIGUOUS`。
  - 新增窗口非前台：返回 `TARGET_STALE`。
  - 新增窗口通过新增的 `CheckSingleTabTarget` 检查单标签和可编辑文本控件；若存在多个标签或无法判断单一选中标签，精确返回 `TARGET_AMBIGUOUS`；若目标失效返回 `TARGET_STALE`；若进程不可信返回 `UNAUTHORIZED`。

### 1.2 只读目标就绪复核（`target_ready` / `target_ready_result`）
- 为支持 #178 / #182 Runtime 适配器在审批前（`allow_once` 提交前）进行只读就绪复核，Host 新增 `target_ready` 帧分派处理与 `TargetReadyAsync` 实现。
- `HostWire` 增强 JSON 校验器以支持布尔字段类型约束（`ready: boolean`），并对 `target_ready_result` 的 `oneOf` 约束（`ready=true` 时必带 `expiresAt` 且禁带 `errorCode`；`ready=false` 时必带 `errorCode` 且禁带 `expiresAt`）进行严格校验。
- `TargetReadyAsync` 纯只读复用当前会话目标的 HWND/PID/StartUtc/前台与单标签核验：
  - 调用超时返回 `ready=false, errorCode="TIMEOUT"`。
  - 目标失效/切出前台/已过期返回 `ready=false, errorCode="TARGET_STALE"`。
  - 有效返回 `ready=true, expiresAt`（保持原过期时间，不自动续期）。
  - 不读取正文、不新建目标、不激活窗口、不消费授权。

### 1.3 输入串行、真实用户接管检测与副作用安全
- **输入串行**：进程级 `Local\PersonalAgent.WindowsHost.SingleUserInput` 命名互斥锁、类库级 `SemaphoreSlim InputLock` 以及连接写锁 `_writeLock` 三层保证输入严格串行。
- **用户接管检测（`USER_TAKEOVER`）**：
  - 在执行开始前读取 `LastInputTick()`，在关键执行点及 `SetValue` 紧前重新检查 `LastInputTick() != inputTick`。
  - 一旦检测到物理键鼠输入介入，立即放弃后续所有自动输入，`NotepadAction` 返回 `ActionState.Rejected` 且带错误码 `"USER_TAKEOVER"`。
  - `HostService` 将其映射并持久化记录为 `refused`，错误码直接回传 `"USER_TAKEOVER"`，向 Runtime 与桌面提供明确的接管信号。
- **已发生副作用的安全兜底（`ResultUnknown`）**：
  - 一旦 `value.SetValue` 开始调用（`mutationStarted = true`），任何取消信号、用户按键、切出前台、UIA 异常或后置读回文本不符，严格返回 `ActionState.ResultUnknown` / `"RESULT_UNKNOWN"`。
  - 写入前 `RunJournal.Start` 已持久化落盘 `result_unknown` 记录；若进程崩溃或断电，重启后查询依然保持 `result_unknown`，绝不盲目重试或谎报成功。

### 1.4 原生资源生命周期与防孤儿释放
- `HostLaunchBinding.MonitorClientExitAsync` 保持句柄级监控 Bridge 进程退出，客户端退出时联动 Host 退出。
- 命名管道连接断开时，`HostService` 清空当前会话的 `NotepadTargets`（旧 `targetRef` 立即失效，不可跨会话重用）。
- 严格释放所有 `Process`、`SafePipeHandle`、`CancellationTokenSource` 及 Win32 进程句柄。

### 1.5 活跃重复执行（Duplicate Execute）收敛与最终 Durable Receipt 关联
- **缺陷返修背景**：原实现中，当针对同一 `identity` 的重复 `execute` 请求在原任务后台执行中到达时，`journal.Start` 返回非终态记录（`previous.Terminal == false`），`HostService` 立即通过 `SendRecordAsync` 将其过早映射为 `result_unknown` 返回给重复请求方，即使后台 `_active` 任务仍在正常执行，导致重复请求过早报错。
- **活跃执行跟踪（`ActiveExecution`）**：
  - 将 `_active` 的值类型由纯 `CancellationTokenSource` 扩展为 `ActiveExecution`，跟踪运行生命周期及所有等待该终态结果的请求者 `ExecutionRequester(Pipe, RequestId, SessionId, Connected)`。
  - 当重复 `execute` 到达且 `identity.RunId` 处于 `_active` 时，调用 `active.TryAttach` 将其登记为等待者（并按 `(RequestId, SessionId)` 去重），方法立即返回，**完全不阻塞 `ServeConnectionAsync` 循环**，保障随后的 `cancel`、`status` 等帧仍能被及时读取与处理。
  - 当后台 UIA 替换完成并产生落盘终态收据（`verified`、`refused`、`cancelled` 或写后异常 `result_unknown`）后，`MarkCompleted` 将同一真实 durable receipt 分别以各自对应的 `requestId` 响应所有关联请求者，杜绝重放写入的同时杜绝假冒完成与过早报错。
  - **重启遗留未知与已终态运行保持原语义**：
    - 若 `journal.Start` 返回 `Terminal == false` 但 `_active` 中无此任务，说明属于宿主进程崩溃/重启后的遗留日志，按预期安全返回 `result_unknown`。
    - 若 `previous.Terminal == true`，直接返回已持久化的终态结果。
    - 若相同 `runId` 传入不同参数，`RunJournal.Start` 抛出 `InvalidDataException` 拒绝。
  - **取消与断连边界**：写前取消/超时产生 `cancelled` / `refused`，写后异常/中断产生不可逆的 `result_unknown`。

---

## 2. 验证证据与测试记录

### 2.1 定向 .NET 8 编译验证
在 Windows 环境执行下列定向构建，全部通过，**0 警告、0 错误**：
- `dotnet build apps/windows-host/WindowsHost.csproj` -> Exit 0
- `dotnet build apps/windows-host/host/WindowsHost.Host.csproj` -> Exit 0
- `dotnet build apps/windows-host/host/bridge/WindowsHost.PipeBridge.csproj` -> Exit 0
- `dotnet build apps/windows-host/host/test/WindowsHost.HostFixture.csproj` -> Exit 0
- `dotnet build apps/windows-host/test/WindowsHost.Timing.csproj` -> Exit 0

### 2.2 契约与便携夹具回归（`WindowsHost.HostFixture`）
- 运行 `WindowsHost.HostFixture` 覆盖测试：
  - #168 全部 valid/invalid portable 帧解析。
  - 新增 `target_ready` 请求帧编码与解析。
  - 新增 `target_ready_result`（`ready=true` 带 `expiresAt`、`ready=false` 带 `errorCode`）合法帧。
  - 异常约束：`ready=true` 携带 `errorCode`、`ready=false` 携带 `expiresAt`、`ready` 传入非布尔值等非法帧，全部被严格拒绝（抛出 `InvalidDataException`）。
  - `RunJournal` 幂等开始、断线后 `result_unknown` 恢复、相同 `runId` 传不同输入拒绝。
  - 新增 `ActiveExecution` 状态机回归：验证进行中重复请求附着（`TryAttach`）、相同请求去重、执行完成全量分发（`MarkCompleted`）、完成之后附着立即返回终态收据。
- 输出：`Windows Host portable contract and durable-run fixture passed`，Exit 0。

### 2.3 定向时序回归（`WindowsHost.Timing`）
- 运行 `WindowsHost.Timing` 模拟时序竞争：
  - 首次读取预期文本后注入用户按键 tick 变化 -> 写前拦截拒绝。
  - 模拟不改变 tick 的程序改值 -> 写前拦截拒绝。
- 输出：`PASS: prewrite user input and programmatic edit rejected`，Exit 0。

### 2.4 原生 Pipe Bridge 握手探针（`HandshakeProbe.ps1`）
- 分别在 Windows PowerShell 5.1 与 PowerShell 7 (pwsh) 下执行严格 LF 握手探针一次：
  - Bridge OS 服务端 PID 核验输出：`bridge_readiness=VERIFIED`。
  - Host 反向身份核验并应答关联一致的握手回执：`host_reply=hello_ack request_match=true nonce_match=true version_match=true`。
  - 桥正常退出：`bridge_exit=0`，Exit 0。
  - 退出后检查 OS 进程：`@(Get-Process -Name "WindowsHost.Host","WindowsHost.PipeBridge").Count` 严格为 `0`，无进程残留。

---

## 3. 架构边界、接口与不可用清单

1. **公开调用与帧语义**：
   - Host 进程输入输出维持 #168 / #178 定义的纯 JSONL 严格 LF 帧。
   - 帧集合：`hello`, `hello_ack`, `bind`, `observe`, `observed`, `observation_refused`, `target_ready`, `target_ready_result`, `execute`, `cancel`, `status`, `status_reply`, `result`。
   - 所有时间戳采用严格 UTC 毫秒 ISO-8601（`yyyy-MM-dd'T'HH:mm:ss.fff'Z'`）。
2. **所需原生可执行文件与部署要求**：
   - `WindowsHost.PipeBridge.exe`：由 Desktop / Runtime Application 主进程通过绝对路径启动，持有真实客户端管道句柄并输出 `VERIFIED\n`。
   - `WindowsHost.Host.exe`：由 PipeBridge 启动，需同目录部署 `windows-host.json`（构建产物自动链接或由安装器放置）。
3. **未实现与不可用项**：
   - 真实记事本 UIA 写操作未在 CI / 离线代理中进行实测（按规定保留在唯一物理设备槽由主任务进行）。
   - Windows 凭据存储（SecretStore 适配器）需独立边界设计，当前不包含凭据写入。
   - 本地执行能力在产品层面继续保持 `unavailable`，不随本次代码合入而宣称可用。

---

## 4. 下一步与交接

1. **下一独立事项**：
   - 在主任务的单一设备槽上，配合真实已启动的记事本窗口，由 Desktop 通过 Runtime Application 发起一次受控的完整链路端到端验收（`prepareHostToolTask` -> `observe` -> `target_ready` -> `allow_once` -> `execute` -> UIA 读回 -> Evidence 记录）。
2. **唯一外部阻塞**：
   - 等待主任务完成唯一设备槽的真实前台窗口交互验收，以及 `goo122` 的非作者评审。
3. **需要主任务协助事项**：
   - 在根装配中将 `WindowsHost.PipeBridge.exe` 与 `WindowsHost.Host.exe` 的构建产物路径正确注入 Runtime Application 的 Windows adapter 配置项中。
