# Windows Host: 记事本受限文本操作核心

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-16（zemeng5208）。产品流程：F14、F25；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

2026-10-13：[当前就绪与现场条件](ACCEPTANCE-20261013.md) 记录新的 HostFixture/Bridge 构建、真实 hello 握手和正式 F9 入口；完整 UIA 仍待用户现场验收。当前合并规则以根 AGENTS/CONTRIBUTING 的一位非作者有效批准为准，覆盖下方历史双人门槛。



此目录包含受限 Windows 类库和 `host/` 中的独立进程入口。Host 消费 [#168](https://github.com/zemeng5208/PersonalAgent/pull/168) 的 provisional `0.1.0` 内部 Schema。当前 main 已有公开 Runtime adapter、持久 attempt store 和 Desktop 的新记事本/F9 确认入口；Desktop 仅在 Windows 且固定 Host/Bridge Release 产物存在时注册本机工具，真实握手与 UIA 仍须另行验收。目标 Profile 为 `huawei_ict_agentarts`；本地执行不能由 AgentArts 的成功响应、Renderer 文本或单独的 `authorizationRef` 触发。正式入口与证据缺项见 [Desktop 记事本操作](../desktop/docs/notepad-operation.md)。

`NotepadAction.ReplaceTextAsync` 的目标仅为前台、非提权、System32 经典记事本或包身份精确为 `Microsoft.WindowsNotepad_8wekyb3d8bbwe` 的 MSIX 记事本中**唯一可见、启用、可写且支持 UI Automation `ValuePattern`** 的可编辑控件（过滤规则可在唯一可见、启用、可写且支持 ValuePattern 的 Edit 控件存在时支持；候选遍历中遇元数据查询异常立即 fail closed，多有效候选、异常或无有效候选均明确拒绝。本机未实际观察现代 Notepad 的 UIA 树，不可声称常见控件形态、已验证现实兼容或完整结构过滤）。MSIX 还须恰好一个可识别且选中的 UIA 标签；无法识别即拒绝。可信调用方须在用户确认后传入窗口句柄、PID、进程启动时间和精确预期文本；最多替换 4096 个 UTF-16 code unit，且必须完全匹配当前文本。静态信号量串行化本进程所有输入；执行前核对窗口身份、前台和上次输入 tick，变更后再次读回目标控件。取消、窗口切换或用户输入导致让出控制；变更开始后的任何失败返回 `ResultUnknown`，不可盲目重试。返回内容不包含窗口标题、路径或文本。

传入 `ConfirmedNotepadTarget` **不代表**授权证据。Host 已加入单进程互斥、持久 runId 记录及重启状态查询。正式调用方复用 `prepareHostToolTask → observe → finalizeHostToolTask → authorization.respond → Policy/ToolGateway`；F9 只确认当前明确文本和新独立空白窗口，不能形成持续授权。窗口基线不完整时 Host 拒绝该会话观察，不会在查询恢复后选择此前遗漏的旧窗口。上述生产接线已存在，正式 Desktop/原生目标/Evidence 的实机验收仍未完成。UIA `ValuePattern` 和标签结构并不适用于所有版本记事本；多控件、元数据查询异常或不可访问控件均拒绝。离线 .NET 编译和死句柄 fixture 仅验证代码结构与失效拦截逻辑，不能证明真实现代记事本真实可写。读回只证明当前控件文本等于新值，不证明文件保存、模型提案或完整任务完成。`GetLastInputInfo` 与前台窗口检查不能捕获所有并发接管，实机仍需有意插入输入/窗口切换验证。

构建要求 Windows 及 .NET 8 Windows Desktop SDK：`dotnet build apps/windows-host/WindowsHost.csproj`。Linux 环境没有 .NET SDK，不能执行或声称构建与 UIA 实测。详情及手工验收见 [模块记录](../../docs/modules/MOD-16-WINDOWS-EXECUTION-01.md)。

普通用户可从仓库根目录执行 `dotnet run --project apps/windows-host/manual/ManualNotepadProbe.csproj` 进行一次手工探测。程序创建随机合成临时文本文件，启动 System32 `notepad.exe`，启动前快照已有 Notepad 顶层 HWND/PID/启动时间；之后只接受全局唯一、身份可信且新增的可见顶层 HWND（可属于既有 PID），从不选择旧 HWND 的新标签。不读取既有私人标签、窗口标题或文本。零新增窗口、身份不可核及多个新增窗口分别拒绝。显示随机文本和 `CONFIRM` 提示前复用核心的 UIA 单标签检查，目标含多个标签或结构无法判清即拒绝。唯一新窗口仍须亲眼确认完整随机合成文本，输入 `CONFIRM` 后在五秒内手动切回。结果为 `Verified` 时还须目视确认，再关闭记事本且不保存。若新标签页落入旧 HWND、MSIX 未暴露唯一标签或不提供单一 ValuePattern，本探测拒绝，不能切到私人窗口重试。此程序不经过产品授权链，仅供测试，不能作为生产入口；探测并非 PA-016 的端到端验收。

定向时序回归：Windows 上运行 `dotnet run --project apps/windows-host/test/WindowsHost.Timing.csproj`，受控交错在预期文本读取后改变输入 tick，以及不改变 tick 的程序改值，两者均必须在写前拒绝。写入前还会重新查找已确认窗口中唯一选中的标签及同一编辑控件，再检查精确文本、输入 tick 和前台身份。UIA 读取和 `SetValue` 之间没有原子 compare-and-swap；这些复核仍不能捕获所有接管，不能用此回归代替真实交互验收。

执行核心的目标身份检查在同一 Process handle 的映像、包身份、启动时间及存活核验后，再次检查前台 HWND 和窗口 owner。
窗口可能在慢进程查询期间关闭而进程仍存活；这时写前拒绝，写后保持 `ResultUnknown`，不返回过时的 `Verified`。
上述 Timing fixture 还通过生产共用 guard 覆盖查询期间窗口关闭、前台/owner 改变、稳定身份与入口已失效。
这些是受控交错回归，不是物理 PID/HWND 复用或真实 UIA 设备验收；最终检查后仍存在 Windows API 无法消除的短竞态。

Host 和 Pipe Bridge 的受信启动、双向对端检查、目标观察、run 日志和恢复边界见 [host/README.md](host/README.md)。仅构建或运行它们不发布 `computer.notepad.replace_text`；产品侧必须先让 Runtime/Policy/ToolGateway 消费授权，再由可信主进程启动并绑定 Host。Windows 打包安装不属于此工作包。
