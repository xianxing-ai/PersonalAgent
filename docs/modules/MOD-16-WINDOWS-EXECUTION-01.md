# MOD-16-WINDOWS-EXECUTION-01：受限记事本操作核心

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-16、PA-016；负责人 zemeng；非作者评审 goo122。
- 原核心基线：`main@4efa7f60feaaa007d73c80e7d90091e0caab3bc7`；本次诊断分支 `codex/zemeng/mod16-windows-manual-probe`（`#120`，起点 `f962e4d`，已含 `#117` 的写前时序修复）。
- 文件边界：`apps/windows-host/**` 与本文；MOD-17 的 `packages/windows-client/**` 和历史 `MOD-16-SYSTEM-OBSERVATION-01.md` 均不改。
- 当前状态：受限核心的合成探针仍未取得正向实机读回；Host/Bridge 已完成定向 Windows 构建与仅 `hello_ack` 的 OS Pipe 身份短链，授权链、UIA 和后置读回尚未验收。生产能力 `unavailable`。共享接口及 Desktop 接线见 [#114](https://github.com/zemeng5208/PersonalAgent/issues/114)，provisional Host 帧 Schema 见 [#168](https://github.com/zemeng5208/PersonalAgent/pull/168)。

## 设计与边界

只对用户先行确认的前台记事本窗口做一次精确文本替换。普通用户权限；PID、进程启动时间、HWND 与 System32 可执行路径或精确 MSIX 包家族名共同绑定目标，预期文本不一致则拒绝。MSIX 还须 UIA 中恰好一个可识别且选中的标签；只接受单一 UIA ValuePattern 可编辑控件，并在替换后从当前目标控件重新读取。静态锁串行当前 Host 进程的输入。取消或用户改变前台/输入时让出控制；调用 `SetValue` 开始后任何异常或不符均为结果不确定，由受信路径再次读回，不能自动重试。结果不回显任何文本/路径/窗口名。

输入 tick 基线在 UIA 查找及首次读取预期文本前建立；执行前再次核对同一 tick、目标身份与当前预期文本。紧贴 `SetValue` 前重新发现已确认窗口的唯一选中标签与同一编辑控件，并复核文本、输入 tick 和前台；标签或控件已换则写前拒绝，不读取其他标签的文本。定向回归注入“首次读取后用户输入”及“不改变 tick 的程序改值”，两者均须在写前拒绝。UIA 读值与 `SetValue` 并非原子 CAS，用户输入 tick 也不是完整接管事件流；剩余窗口须在 Windows 实机验收并交 Runtime 的受信协调和恢复处理。

本增量在 `apps/windows-host/host/` 增加独立 Host 进程：读取 #168 的同源 Schema、当前用户 Pipe/对端身份和 nonce 会话绑定、短期 opaque 目标、写前持久 run 记录、断连取消及跨会话只读状态核实。另有受信 Pipe Bridge 进程持有真正的 Windows Pipe client handle，以 Win32 API 核对服务端 PID 后才对 Node 透传原协议帧；Host 反向核对 Bridge PID、进程起始时间、session 与用户 SID。Bridge 启动及退出会改变进程生命周期，但不构成授权。Host 仅是执行端；`ConfirmedNotepadTarget` 仍可构造，Pipe 帧里的 `authorizationRef` 也不是授权凭证。Runtime/Policy/ToolGateway 的授权消费、跨进程调用仲裁、Desktop 受信确认与产品 Evidence 仍按 #114 由原负责人正式组合。未完成这些接线和真实验收时不能注册 capability。此包不改公共 Schema、Runtime/Policy/ToolGateway、Desktop 或根配置/锁文件。没有凭据适配；MOD-05 的 SecretStore 与 Windows 安全存储另需边界契约，不能把机器本地凭据当作授权。

## 当前源码装配核对（2026-10-07）

在当前 `main@4b5ec61` 核对，Runtime 已公开受限记事本宿主入口，Desktop 已消费固定 Host/Bridge 路径，并在 Windows 且两个可执行文件存在时创建宿主。管理控件提供绑定、启动、取消和核实入口；F9 受信本地确认与 Policy/ToolGateway 授权消费已有源码接线。未配置或平台不满足时能力仍不可用。上述历史切片中“待 #114 接线”的说明记录当时交付范围，不再表示这些源码入口尚未实现。

此能力仅面向新建独立、单标签记事本目标的受限文本替换，不提供通用鼠标键盘、截图、安装或保存能力，也不因模型提案自动获得前台操作授权。源码和合成消费测试不能代替完整 Windows 普通用户会话验收；以下历史回执仅证明其实际执行的步骤，完整 F9 确认、授权消费、UIA 操作、取消/接管、独立读回及重启恢复仍由 Windows 现场协作者取证。当前 Linux 执行环境没有这些实机条件，不将其记为通过。

## 2026-10-07 原记事本恢复控件补证

固定核心 `b3ffdaa894aefaeef5b498afb3eeb6a8dc1073af` 的原 admin/Notepad 控件、
actual main 路由与公开 DesktopNotepadHost/RuntimeApplication/Client/Policy/ToolGateway、
Windows adapter/attemptstore 使用新私有 SQLite 夹具完成一项独立消费，实际 exit0、console0。
显式 Fake F9 前没有 observe/execute 或授权；之后仅一次 allow_once 消费、execute 和 spawn。
Fake unknown 回执使原任务与 UI 待核实并禁止新写入；一次 adapter 自动 status 加两次原
核实按钮分别读回 in_progress/in_progress/匹配的 Fake verified。实际 Runtime 最后保存
execution 与独立 readback 引用并 succeeded，原任务不重放，不追加授权，UI 提示文件未保存。
证据 `notepad-runtime-recovery-consumer-validation.md` 及脚本、JSON、日志/截图在
`.worktrees/mod15-host-20261007/.cache/review-evidence/20261007/`；两个早期 helper 误计
自动 status 导致的 wait timeout 日志保留，不计通过，没有为本场景修改生产源。
F9/窗口/Pipe/前台目标/原生 status 与读回/IPC 均明确 Fake；这些 Evidence 是该协议夹具
的持久化消费，不是实际 Windows 写入或物理读回。下列实机验收仍未通过。

## Windows 实机验收步骤与证据

在普通用户 Windows 会话中，从仓库根目录运行 `dotnet build apps/windows-host/manual/ManualNotepadProbe.csproj`，再运行 `dotnet run --no-build --project apps/windows-host/manual/ManualNotepadProbe.csproj` **一次**。探针创建随机合成文件并启动 System32 入口；启动前只快照已有 Notepad 的顶层 HWND/PID/启动时间，不读取标题或标签。随后寻找全局唯一且新增的可见顶层 HWND，可属于既有可信进程或新进程；旧 HWND 即使新增标签也始终排除。零新增窗口、身份不可核及多个新增窗口分别拒绝；不读取既有私人标签、窗口标题和内容，不切换标签。显示随机文本和 `CONFIRM` 提示前先复用核心的 `TryGetOnlyTab` 检查同一 HWND 的目标身份与唯一选中标签，多标签或结构不明直接拒绝。通过该检查后，操作者仍须目视核对完整随机文本，输入 `CONFIRM`，五秒内手动激活原窗口。核心仅读取该已确认前台 HWND 的单个编辑控件，精确核对随机全文后才可能写入；标记不符、多标签或无法识别单标签均写前拒绝。同时出现其他新窗口时不能把它当合成目标。探针不代表产品授权链。记录一次结果、退出码、脱敏目标身份与是否目视确认；不要记录私人内容或合成全文。随后按下列步骤补足负向和集成验收：

1. 记录 Windows/.NET/记事本版本、实际启动入口路径、完整 `dotnet build` 退出码；若 MSIX 身份、UIA 单标签或 ValuePattern 无法识别，记录拒绝并重新评审，不能将拒绝当成功。
2. 人工确认 HWND、PID、进程启动时间、预期文本和替换文本；测试缺确认、另一 PID、重启后的同 PID、背景窗口、第二编辑控件、只读控件、超过长度及预期文本变化均不发生替换。
3. 测量两次并发请求不会交错；在等待锁与操作前取消，确认未变更；在操作期间键盘输入/切换前台触发接管，确认停止并读回实际文本。UIA 调用中取消不能保证抢占执行，应记录 `ResultUnknown`，关闭自动重试。
4. 成功操作后独立从记事本 UIA 控件读回精确文本；失败、目标退出和取消后另行读回实际内容，明确 verified/unknown，而非仅看 `SetValue` 返回。关闭并重启应用后只应通过可信恢复流程核实，不重做不确定的写入。
5. 待 #114 的真实接口到位，走 AgentArts 提案→受信目标确认→Runtime/Policy/ToolGateway 一次性授权→Host→目标读回→任务持久化/重启恢复，另测撤销、过期、参数置换、无 capability、防 Local 静默回退。保存脱敏任务 ID、目标身份摘要、授权消费记录、读回结果、失败分支和重启状态；不保存实际文本、私人窗口名或凭据。

Windows 回执：旧探针的 System32 启动 PID 未暴露窗口，退出码 2，MSIX Notepad 11.2607.14.0 显示合成文件，未确认或写入。后续 `#120@e74d3efd` 使用 SDK 8.0.424 构建 exit 0、零警告零错误；一次探针发现 PID 41348 的合成随机全文，但同一窗口同时有多个既有私人标签，程序仍显示 `CONFIRM`，操作者输入 `NO` 后输出 `REFUSED: no manual confirmation`，shell exit 1。**该拒绝由操作者触发，旧代码并未在提示前自动拒绝多标签**；未执行 `SetValue` 或读回，未触碰旧标签。`#120@4dfae124` build exit 0、零警告零错误，但一次探针仅输出 `REFUSED: no unique new Notepad window; existing windows and tabs were not inspected`，shell exit 1；没有到达提示前单标签检查、人工确认、写入或读回。新增 HWND 快照修复尚未 Windows 编译或 UIA 实测，不能据旧回执断言目标确实创建了新窗口。若仅复用旧 HWND 的新标签，或 UIA 不暴露可信单标签与单个 ValuePattern，本轮只能验收拒绝；不能用合成结果宣称 PA-016 或整个 MVP 完成。历史 `MOD-16-SYSTEM-OBSERVATION-01` 是只读系统观测，不是本操作证据。

Bridge 回执（2026-09-27，`#179@c7af939`）：固定 #168 `a440215` 的 Schema blob hash 双方同为 `2a6c444`；Host 与 Bridge 各自 `dotnet build` 均 exit 0、零警告零错误。首轮 PowerShell `WriteLine` 发 CRLF，Host 按 JSONL 规则拒绝；修正脚本为严格 LF 后只运行一次 `HandshakeProbe.ps1`，exit 0，输出 `bridge_readiness=VERIFIED`、`host_reply=hello_ack request_match=true nonce_match=true version_match=true`、`bridge_exit=0`；结束后两个进程无残留。该回执证明真实连接句柄上的 Win32 服务端 PID 核对及 Host 反向身份核对通过 `hello`，没有 `bind`、目标观察、Notepad 写入、Policy 消费或产品 Evidence 投影，不能提升 capability。
