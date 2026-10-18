# Windows Host 内部进程（provisional）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## P6 当前消费入口（Competition Profile）

#114 所需的受限 Notepad 契约现由 `@personal-agent/contracts/windows-host` 提供内部 Pipe 帧
`0.1.0`，不是通用 `DesktopActionPort` 或公共 wire 1.0.0 的新 operation。Runtime/Application
公开工厂 `createWindowsHostBridgeTransport({hostPath, bridgePath, timeoutMs?})` 与
`createWindowsHostNotepadAdapter({transport, attempts, authorizePresence, prepareObservation?, now?})`
已在当前 Desktop 装配；本包不重复实现 Runtime 的授权、任务循环或装配。

| 端口 | 参数与读回 | 调用方责任 |
| --- | --- | --- |
| `observe` | `(taskId, deadline, signal)` → `{targetRef, expiresAt}` | 先 hello/bind 建基线，再打开独立空白单标签窗口并由用户确认；不读取标题或私人正文 |
| `checkObservationReady` | 同参数 → `{taskId, targetRef, expiresAt}` | 审批前再次检查，结果不授予授权、不续期 |
| `adapter.tool` | `computer.notepad.replace_text@1.0.0`，scope `computer:notepad:write`，输入 `{targetRef, expectedText, replacementText}`；成功输出 `{state:'verified', hostEvidenceRef}` | 已注册工具经 Runtime/Policy/ToolGateway；文本最多 4096 UTF-16 code unit，不能由模型提供 presence 或伪造 targetRef |
| `recover` | `(taskId, runId)`，从 durable attempts 查询原始身份；不确定结果包含 `in_progress` / `not_found` / `host_result` 原因 | 仅状态读回，不重新 execute；not_found 不证明无副作用 |
| `releaseObservation` / `close` | `(taskId)` / 无参数，均为 Promise | 终态或准备取消后释放目标；关闭 adapter/transport 并确认子进程退出，关闭失败不可当作已释放 |

`attempts` 复用 `createRuntimeWindowsHostAttemptStore`，原始任务、run、工具版本、参数摘要与
目标引用必须持久绑定；无需第二套身份或授权库。Renderer 只显示安全状态/Runtime Evidence，
不接收原始 targetRef、HWND/PID、路径、标题或正文读回。设备错误、接管或断连不能静默换目标。
UIA 仅支持既有受限 Notepad 操作；屏幕截图、通用键鼠、文件保存和其他应用仍未提供。

本轮 Host 收紧执行期限到短期目标失效时间，并通过同一 `Process.SafeHandle` 读取实际映像与包身份；
StartTime、窗口 owner 与前台仍逐次复核，进程退出或身份不可读即拒绝。PID 复用场景没有实机重现。
仅在真实设备验收后才能声称现代 Notepad 的目标捕获/就绪、接管、取消与恢复全部可用。

## 内部协议与进程生命周期

本轮定向验证（2026-09-30，基线 `main@58d6752`）：
`dotnet build apps/windows-host/host/test/WindowsHost.HostFixture.csproj -c Release --no-restore`
通过，零警告/错误；运行对应 Release fixture 一次，使用当前 contracts Schema/fixture，通过。
新增检查实际等待目标和任务计时器的取消信号、断连取消及已过期目标无执行 lifetime，
同时核对当前测试进程的同句柄真实 image path 与 `Environment.ProcessPath` 一致、缺失身份拒绝。
其余既有契约/持久 run 检查随该 fixture 执行。没有重建 Bridge/Job/Runtime、打开窗口、
代按 F9 或重跑编码验收；没有实测 UIA 写入、物理 PID 复用或整体设备恢复。

此进程只消费 `packages/contracts/schema/windows-host.json` 的 `0.1.0` 帧。构建时从
公共 contracts 拷贝该 Schema 到 Host 输出目录；缺失或版本不符时启动前拒绝。
当前实现复用 #168 合并后的同源 Schema，不复制另一份 DTO。

可信 Desktop/Runtime 组合方启动 `WindowsHost.PipeBridge.exe --host <Host.exe绝对路径>`。
Bridge 生成随机 `pa_<32位小写十六进制>` Pipe 名，启动 Host 并传入
`--pipe <name> --client-pid <Bridge自身PID>`。Bridge 持有实际 Pipe client handle，
经 Win32 `GetNamedPipeServerProcessId` 核对它启动的 Host PID、进程起始时间与 session；
验证通过后只在标准错误流写一次 `VERIFIED`，失败写 `REFUSED` 并拒绝转发。
标准输入/输出原样透传 #168 JSONL，不引入第二套业务帧。Node 调用方必须等待
`VERIFIED` 后才发送 `hello`，不能将进程启动或随机 Pipe 名当成身份验证。
Bridge 退出时结束其 Host；Host 也监视绑定的 Bridge 进程，避免强制终止后留下
等待连接且占住互斥锁的孤儿进程。

Host 限当前用户 Pipe ACL，连接时核对对端 Bridge PID、进程启动时间与 Windows
session；收到并校验 `hello` 后、发送 `hello_ack` 前，以该已读取消息的身份核对
用户 SID，然后执行 `hello → hello_ack → bind` nonce 会话绑定。Pipe 名/启动参数本身不是授权；
同用户其他进程仍可直接调用 Windows UIA，所以 Host 不宣称 OS 沙箱。

`observe` 只接受本会话建立后新增、身份可信、当前前台、全局唯一且单标签的
Notepad 顶层窗口；跨会话进程、旧 HWND 中的新标签、多标签及无法核验来源的窗口均明确拒绝。
窗口基线在 `hello_ack` 前建立，可信 Desktop 可在握手完成后通过 Runtime adapter
的可选 `prepareObservation` 等待用户创建和确认新窗口，再发送 `observe`。
准备过程不授予执行权限；取消或期限到达会关闭本次连接，不消耗短期 targetRef 的有效期。
Host 只返回短期随机 `targetRef`，不返回或记录标题、正文、HWND/PID。
若既有进程/窗口基线查询不完整，整次会话明确拒绝 `UNAUTHORIZED`；不能跳过旧窗口后在查询恢复时把它视为新目标。可信调用方可结束这次准备并重新握手，不盲目重试写入。
无法观察时使用 Schema 中的 `observation_refused`（包含 `UNAUTHORIZED`、`TARGET_AMBIGUOUS`、
`TARGET_STALE`、`TIMEOUT`），不会用断连伪造拒绝。断连后目标引用立即失去执行效力。

审批前的只读 `target_ready` 帧复用目标的 HWND/PID、进程起始、窗口身份、唯一标签、
唯一可见启用可写 UIA 文本控件结构（候选异常即 fail closed）、前台与有效期检查。目标有效回 `target_ready_result(ready=true, expiresAt)`，目标失效或结构异常回
`ready=false, errorCode=TARGET_STALE`（包括目标引用失效），请求期限过期回 `ready=false, errorCode=TIMEOUT`。它不读取正文、
不新建或续期目标、不激活窗口，也不消费授权。

目标观察和解析在元数据/UIA 检查前后复核同一短期 lease；慢查询完成时已经过期的
观察返回 `TIMEOUT`，解析不再返回失效目标。观察的三十秒上限仍从本次观察开始计时，
不会因慢查询续期。`target_ready` 在目标解析之后再次核对请求 deadline 和原
`expiresAt`：请求过期优先回 `TIMEOUT`，目标过期回 `TARGET_STALE`；保持原 targetRef
及有效期，不授予权限或延长执行期限。

观察和解析还在同一次 UIA 元数据检查前后复核原前台 HWND、窗口所属 PID；每次绑定
`Process.SafeHandle` 后核对原启动时间、可信映像/包身份及进程存活，进程元数据查询后再核
前台与 HWND owner。慢查询期间切走前台或身份失效，不再返回成功的观察/就绪回执；
身份不可查询也拒绝。此检查不读取标题或正文，不激活窗口，也不更新目标有效期。
Win32 与 UIA 没有原子身份快照，最后复核之后仍有极短竞态；执行层仍须保留原写前
重绑定、前台和用户输入检查。本改动修复迟到回执，未证明发生过错误写入或实机复现。

2026-10-05 新增的 HostFixture 回归调用生产共用的 lease/readiness helper，用受控 UTC
时钟和合成元数据 predicate 覆盖查询中跨越请求/目标期限、等于期限、入口已过期零查询、
有效/无效/抛错目标及不续期。身份回归在元数据 predicate 中改变身份状态，验证前台、
HWND owner、进程启动/退出的合成失效、入口已失效零查询、前后各检查及查询后异常
拒绝，并验证身份查询自身跨期限时不再进入 UIA 或返回目标；它调用生产共用 guard，
不代表物理切换窗口或 PID/HWND 复用实机验收。
Desktop 的 `test/windows-host-fixture.test.mjs` 将该现有
C# fixture 接入原 Node test glob：Windows 必须找到稳定 .NET 8 SDK，以独立临时
`--artifacts-path` 构建所有项目引用，再发现真实 runtimeconfig 旁的 DLL 并运行，检查
原完成 marker；SDK 缺失、构建/fixture 错误、超时或缺 marker 均失败，不因环境缺项跳过。
临时 SDK 配置、CLI 目录和构建产物只属于该测试，结束后清理；不在源码目录生成 bin/obj。

当前 Linux 会话没有 .NET SDK，官方 SDK metadata 下载被 HTTP 403 拒绝，未编译或
运行 C# 回归；Node 包装测试在 Linux 明确按平台跳过，源码审查与 `git diff --check`
不代替编译。后续 Windows Foundation 的 Desktop 测试将实际构建/运行该受控 fixture，
结果须按对应提交的日志另行记录；不能预记成功，也不能代替真实 Pipe、UIA、用户接管
或设备验收。Windows owner 仍可单独运行原 HostFixture 完成定向验证。

`execute` 帧中的 `authorizationRef` 不构成授权；正式调用方必须先在 Runtime 的
Policy/ToolGateway 中完成任务、工具、参数摘要、目标与期限的授权消费。Host 只接受
已绑定的可信 Pipe 对端，把同一 `taskId/runId/toolName/toolVersion/authorizationRef/
argumentsDigest/targetRef` 和本地文本摘要记入用户范围的追加日志；日志无正文、路径、
窗口名或 HWND。首次 UIA 调用前持久记录已开始，重复 runId 只能查询已有结果，
不能重做写入。单进程互斥和原类库输入锁串行写入；写前检测到真实用户键鼠输入或前台切换时
立即停止后续自动输入并拒绝（返回 `USER_TAKEOVER` 或 `TARGET_STALE`）。Host 将核心 UIA 真实读回映射为
内部 `verified`；这一步已从真实 UIA 目标完成后置读回。该 `evidenceRef` 是 Host 回执
标识，**不是** Runtime 的公开 Evidence 或任务终态。正式消费方须校验认证会话中的
回执关联，并将 Host 的执行读回状态投影为 Runtime Evidence；无需再造第二套 UIA
读回器。`verified` 只证明当前控件文本匹配，不证明文件已保存。

取消只发取消信号，随后以 `status` 查询；Schema 未定义取消确认帧。连接断开时
取消未结束动作。Host 执行期限取任务 deadline、目标 `expiresAt` 和十分钟看门狗的最早值；
目标观察的短期确认不能延长到较长的任务期限。期限到达同样发取消信号，核心写前取消检查
停止后续 `SetValue`；已经开始变更或不能确认是否变更时仍为 `result_unknown`。
写入可能已开始、进程崩溃、日志只留开始记录或结果不能确认时
保持 `result_unknown`，不得盲目重试。新会话 `status` 使用原 run 的历史
`targetRef` 仅核对身份，不能拿它再次执行；`not_found` 同样不能证明没有写入。

没有正式桌面组合方、真实 Pipe/ACL/UIA/授权链与重启读回验收前，能力继续
`unavailable`。本目录不修改公共 Schema、Runtime、Policy、Desktop 或根 lock。

从仓库根目录分别构建 `dotnet build apps/windows-host/host/WindowsHost.Host.csproj` 和
`dotnet build apps/windows-host/host/bridge/WindowsHost.PipeBridge.csproj`。`--host` 指向
前者的绝对 `.exe` 路径，其同目录必须含 #168 Schema 拷贝的 `windows-host.json`。
在普通用户 Windows 会话已用固定 #168 Schema 执行受控 `hello` 短链：Bridge 的
OS 服务端 PID 核验返回 `VERIFIED`，Host 的反向 PID/SID 核验后回关联一致的
`hello_ack`，桥正常退出且两个进程无残留。此检查没有发送 `bind`、`observe` 或
`execute`；本机未实际观察现代 Notepad UIA 树，离线编译与死句柄测试不能证明真实现代记事本可写，不能代替授权、记事本 UIA 或设备完整验收。
