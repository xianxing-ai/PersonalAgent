# Windows Host: 记事本受限文本操作核心

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

此目录包含受限 Windows 类库和 `host/` 中的独立进程入口。Host 消费 [#168](https://github.com/zemeng5208/PersonalAgent/pull/168) 的 provisional `0.1.0` 内部 Schema。当前 main 已有公开 Runtime adapter、持久 attempt store 和 Desktop 的新记事本/F9 确认入口；Desktop 仅在 Windows 且固定 Host/Bridge Release 产物存在时注册本机工具，真实握手与 UIA 仍须另行验收。目标 Profile 为 `huawei_ict_agentarts`；本地执行不能由 AgentArts 的成功响应、Renderer 文本或单独的 `authorizationRef` 触发。正式入口与证据缺项见 [Desktop 记事本操作](../desktop/docs/notepad-operation.md)。

`NotepadAction.ReplaceTextAsync` 的目标仅为前台、非提权、System32 经典记事本或包身份精确为 `Microsoft.WindowsNotepad_8wekyb3d8bbwe` 的 MSIX 记事本中**唯一可见、启用、可写且支持 UI Automation `ValuePattern`** 的可编辑控件（过滤规则可在唯一可见、启用、可写且支持 ValuePattern 的 Edit 控件存在时支持；候选遍历中遇元数据查询异常立即 fail closed，多有效候选、异常或无有效候选均明确拒绝。本机未实际观察现代 Notepad 的 UIA 树，不可声称常见控件形态、已验证现实兼容或完整结构过滤）。MSIX 还须恰好一个可识别且选中的 UIA 标签；无法识别即拒绝。可信调用方须在用户确认后传入窗口句柄、PID、进程启动时间和精确预期文本；最多替换 4096 个 UTF-16 code unit，且必须完全匹配当前文本。静态信号量串行化本进程所有输入；执行前核对窗口身份、前台和上次输入 tick，变更后再次读回目标控件。取消、窗口切换或用户输入导致让出控制；变更开始后的任何失败返回 `ResultUnknown`，不可盲目重试。返回内容不包含窗口标题、路径或文本。

传入 `ConfirmedNotepadTarget` **不代表**授权证据。Host 已加入单进程互斥、持久 runId 记录及重启状态查询。正式调用方复用 `prepareHostToolTask → observe → finalizeHostToolTask → authorization.respond → Policy/ToolGateway`；F9 只确认当前明确文本和新独立空白窗口，不能形成持续授权。窗口基线不完整时 Host 拒绝该会话观察，不会在查询恢复后选择此前遗漏的旧窗口。上述生产接线已存在，正式 Desktop/原生目标/Evidence 的实机验收仍未完成。UIA `ValuePattern` 和标签结构并不适用于所有版本记事本；多控件、元数据查询异常或不可访问控件均拒绝。离线 .NET 编译和死句柄 fixture 仅验证代码结构与失效拦截逻辑，不能证明真实现代记事本真实可写。读回只证明当前控件文本等于新值，不证明文件保存、模型提案或完整任务完成。`GetLastInputInfo` 与前台窗口检查不能捕获所有并发接管，实机仍需有意插入输入/窗口切换验证。

构建要求 Windows 及 .NET 8 Windows Desktop SDK：`dotnet build apps/windows-host/WindowsHost.csproj`。Linux 环境没有 .NET SDK，不能执行或声称构建与 UIA 实测。详情及手工验收见 [模块记录](../../docs/modules/MOD-16-WINDOWS-EXECUTION-01.md)。

普通用户可从仓库根目录执行 `dotnet run --project apps/windows-host/manual/ManualNotepadProbe.csproj` 进行一次手工探测。程序创建随机合成临时文本文件，启动 System32 `notepad.exe`，启动前快照已有 Notepad 顶层 HWND/PID/启动时间；之后只接受全局唯一、身份可信且新增的可见顶层 HWND（可属于既有 PID），从不选择旧 HWND 的新标签。不读取既有私人标签、窗口标题或文本。零新增窗口、身份不可核及多个新增窗口分别拒绝。显示随机文本和 `CONFIRM` 提示前复用核心的 UIA 单标签检查，目标含多个标签或结构无法判清即拒绝。唯一新窗口仍须亲眼确认完整随机合成文本，输入 `CONFIRM` 后在五秒内手动切回。结果为 `Verified` 时还须目视确认，再关闭记事本且不保存。若新标签页落入旧 HWND、MSIX 未暴露唯一标签或不提供单一 ValuePattern，本探测拒绝，不能切到私人窗口重试。此程序不经过产品授权链，仅供测试，不能作为生产入口；探测并非 PA-016 的端到端验收。

定向时序回归：Windows 上运行 `dotnet run --project apps/windows-host/test/WindowsHost.Timing.csproj`，受控交错在预期文本读取后改变输入 tick，以及不改变 tick 的程序改值，两者均必须在写前拒绝。写入前还会重新查找已确认窗口中唯一选中的标签及同一编辑控件，再检查精确文本、输入 tick 和前台身份。UIA 读取和 `SetValue` 之间没有原子 compare-and-swap；这些复核仍不能捕获所有接管，不能用此回归代替真实交互验收。

Host 和 Pipe Bridge 的受信启动、双向对端检查、目标观察、run 日志和恢复边界见 [host/README.md](host/README.md)。仅构建或运行它们不发布 `computer.notepad.replace_text`；产品侧必须先让 Runtime/Policy/ToolGateway 消费授权，再由可信主进程启动并绑定 Host。Windows 打包安装不属于此工作包。
