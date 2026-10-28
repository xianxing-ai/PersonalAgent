# Native desktop provider

`WindowsHost.Desktop.exe` 是普通用户权限的 .NET 8 / WPF / Win32 / UI Automation stdio provider。它是已有 Runtime → Policy → ToolGateway → Windows client 的设备适配器，不签发授权、不调用模型、不保存任务，也不自行重试写入。

## Build and bounded real-device acceptance

在仓库根目录执行：

```powershell
dotnet build apps/windows-host/desktop/WindowsHost.Desktop.csproj -c Release --nologo -m:1
dotnet build apps/windows-host/desktop/fixture/WindowsHost.DesktopFixture.csproj -c Release --nologo -m:1
node apps/windows-host/desktop/test/acceptance.mjs
```

生产文件位于 `apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe`。Desktop 的 `scripts/build-windows-host.mjs` 同时构建此项目；fixture 不进入生产构建。未新增 NuGet 或 npm 依赖，需要 Windows Desktop .NET 8 runtime。

验收只启动本目录自有合成 WPF 窗口与 broker；不打开用户应用、真实账号或模型。输出保存于 `.cache/desktop-native/<uuid>/receipt.json` 和 `synthetic-window.png`。13 项覆盖 list/activate/observe、UIA exact value readback、一次性目标、带标记鼠标与键盘、selection/focus/invoke/key chords、scroll/move、目标窗口图像、遮挡拒绝、外部无标记事件 generation、resize stale、password、stop 失效、3 秒 drag 中途停止。外部事件由独立 fixture 注入，用于验证接管检测路径；不宣称已执行真人手动接管或任意应用兼容验收。

最近一次真实合成验收的可公开摘要位于 `test/last-real-device-receipt.json`，仅包含合成数据哈希、命令、检查项和范围限制；原图与本机详细回执保留在忽略的 `.cache`，不需要提交它们。

### Runtime / Policy / Gateway integrated device acceptance

`test/runtime-acceptance.mjs` 是独立的真实设备集成验收入口，不会被普通 `node --test` 自动运行。先完成仓库包构建和上述两个原生项目构建，取得独占设备输入时段后执行：

```powershell
node apps/windows-host/desktop/test/runtime-acceptance.mjs
```

脚本使用生产 `createRuntimeApplication` 装配的真实 `TaskRuntime`、SQLite `AuthorizationPolicy` 与 `ToolGateway`，绑定 `createDesktopWindowsControlHost` 和真实 `createWindowsNativeDesktopControlHost`；没有 Gateway/Policy/transport/attempts 替身。确定性的本机验收 worker 通过原 Runtime approval → `authorization.respond` → `tool.invoke` 执行 request_access、list、activate、observe、set_value、UIA + fixture 独立读回、截图和 stop，核对原 run、参数摘要、一次性 grant 消费、真实 Desktop attempt checkpoint、原始 conditional Evidence，并关闭后重新打开 SQLite 核对持久记录。它还验证未授权 presence、参数替换、缓存原 run 重放及 stop 后拒绝。

为防止 Runtime 将用户其它窗口标题写进测试 SQLite，脚本只在测试专用 provider decorator 的 `list_windows` **输出**中保留精确匹配的合成 fixture 窗口；不伪造或改写 windowRef / OS facts，不替换后续原生动作。该隐私过滤在每次 receipt 明确记录，不能用于替代前一节未修改协议的独立原生设备验收。所有实际操作与图像均针对自有 fixture，不调用模型、云端或真实账号；stop 是宿主生命周期操作，不捏造一条 stop 工具执行记录。

集成回执与本地 SQLite / PNG 位于 `.cache/desktop-native-runtime/<uuid>/`。新增脚本的源码/语法检查不表示此设备链已运行；只能依据对应运行生成的 `receipt.json` 的 status/checks/taskState 判断实际结果。此入口也不证明 Electron Renderer、模型工具闭环或 Competition 云端验收。

2026-10-24 本机实际执行结果：使用指定 Node `D:/PersonalAgent/.cache/toolchains/node-v24.15.0-win-x64/node.exe` 运行此入口，一次通过 **11 checks**；原任务 `2dcf03db-9810-49c4-a8c7-bdeb27d01ad0` 为 `succeeded`。原 Runtime 中保留 6 条 confirmed/allow 执行和 3 条 failed/deny/未派发执行、2 条真实 Desktop attempt（activate/set_value）、9 条 conditional execution Evidence，SQLite 关闭后重开核对一致。原生 stop 已确认 `stopped`，fixture 自然关闭且没有强制清理；只读进程检查确认自有 fixture/broker 均退出。本次 model/cloud/account 调用均为 0。详细回执：`.cache/desktop-native-runtime/316409e0-b11c-4ac2-8906-efaafe7b97bf/receipt.json`。该结果保留上述仅过滤合成目录输出的测试边界。

## Wire protocol

标准输入为 UTF-8，每行一个 JSON object；标准输出只返回 JSON 行，无 banner、调试文本、OS 原始异常或文件路径。单行最多 1 MiB 字符、嵌套最多 16 层，待执行请求最多 64；参数拒绝未知字段与重复属性。

```json
{"id":"request-1","method":"initialize","params":{},"deadline":"2026-10-24T12:00:00.000Z"}
{"id":"request-1","ok":true,"result":{"protocol":"personal-agent-desktop/1","version":"1.0.0","capabilities":["list_windows","activate","observe","screenshot","click","type","scroll","move","shortcut","drag","press","invoke","set_value","select","focus","stop"]}}
```

`id` 是 1–128 字符字符串，禁止控制字符；在执行中的重复 id 被拒绝。`deadline` 必须尚未到期且距当前不超过 30 分钟；调用方通常应设置短 deadline。已完成 id 的持久幂等、原 task/attempt/run 绑定及重放由原 Node/Runtime 宿主负责，此进程不会用新 id 重做未知写入。

错误格式：

```json
{"id":"request-2","ok":false,"error":{"code":"TARGET_STALE","message":"Observe the original target again.","dispatched":false}}
```

`dispatched:false` 表示该请求尚未进入 UI mutation / SendInput。`dispatched:true` 表示已经进入可能有副作用的调用，**不证明成功**；action 在该点之后失败统一返回 `RESULT_UNKNOWN`，调用方必须封闭原 run，禁止自动重试。`activate` 同样可能 dispatched，不能依据其错误重新盲目聚焦。不可解析且无法取得 id 的帧返回 `id:null`。

主要错误码：`INVALID_ARGUMENT`、`TIMEOUT`、`CANCELLED`、`TARGET_STALE`、`USER_TAKEOVER`、`UNAUTHORIZED`、`RESULT_UNKNOWN`、`RESOURCE_BUSY`、`REVISION_CONFLICT`、`UNSUPPORTED_CAPABILITY`、`EXTERNAL_FAILURE`。

### Windows and observations

| method | params | result |
| --- | --- | --- |
| `initialize` | `{}` | protocol/version/capabilities，编译支持声明，不是目标应用就绪证明 |
| `list_windows` | `{}` | `{windows:[{windowRef,title,processName,bounds:{x,y,width,height}}]}`；最多 128 个可访问普通窗口，不返回 PID、HWND、路径 |
| `activate` | `{windowRef}` | `{snapshot,verification:{state:"verified",kind:"foreground"}}`；仅聚焦该枚举身份并确认真实前台，不启动程序、不自动选择别的窗口 |
| `observe` | `{}` 或 `{windowRef}` | snapshot 本体；默认当前前台，指定 windowRef 也必须已经是前台，不静默切换 |
| `screenshot` | `{targetRef}` | `{mimeType:"image/png",data:"<base64>",width,height,targetRef}` |
| `stop` | `{}` | `{stopped:true}`，在 stdin reader 立即处理；全进程待执行请求取消、令牌失效、已按下输入释放，进程仍允许新 observe |

snapshot：

```json
{
  "targetRef":"<opaque UUID>",
  "windowRef":"<opaque UUID>",
  "observedAt":"<UTC ISO date>",
  "expiresAt":"<UTC ISO date>",
  "window":{"title":"Synthetic window","processName":"Example","bounds":{"x":100,"y":100,"width":660,"height":560},"dpi":96},
  "controls":[{"ref":"<opaque UUID>","role":"Edit","name":"Editor","rect":{"x":120,"y":160,"width":200,"height":36},"enabled":true,"value":"sample","patterns":["value","focus"]}],
  "truncated":false
}
```

`value` 为 string 或 null；pattern 名称为 `value` / `invoke` / `select` / `focus`。snapshot 不携带图像。所有坐标均为物理屏幕像素，包括多显示器负坐标。windowRef/targetRef 仅在此进程此 epoch 有效，最长 30 秒且不长于创建请求 deadline；重启、stop、过期不可恢复。重新观察同一 HWND 会废弃旧 targetRef。一次 action 在任何可能写入之前消费 targetRef；无副作用参数拒绝通常不消费，但调用方不应依赖这一实现细节。

UIA 遍历最多 1024 节点、256 输出控件、每名称 256 字符、每值 4096 字符、名称和值总计约 48 Ki 字符，并将 escaped UTF-8 snapshot 限制在 192 KiB 内；树截断时 `truncated:true` 且不允许该目标的 action/screenshot。Password 与 secret-like 名称控件被省略，含这些控件的窗口不能 action/screenshot。普通文本仍可能含私人信息，观察结果的本地/出机授权由已有 Policy 决定，不能把 provider 的结构过滤当成全面脱敏。

### Actions

共同 params 为 `{targetRef,action,...args}`，返回 `{snapshot,verification}`。`controlRef` 来自本 snapshot，`loc:[x,y]` 为物理屏幕坐标；两者存在时控制引用用于 UIA，loc 用于明确的鼠标位置。调用方应只传一个目标方式。控件须仍属于原顶级窗口和进程、可用、可见、非 password。

| action | args | verification |
| --- | --- | --- |
| `set_value` | `controlRef` 或 `loc`、`text` | ValuePattern 可写且 exact readback 一致：`{state:"verified",kind:"value",actual:"..."}` |
| `type` | `controlRef` 或 `loc`、`text`、可选 `clear:boolean` / `caret_position:"start"\|"end"\|"idle"` / `press_enter:boolean` | `clear:true` 且不 press_enter 且有可写 ValuePattern 时 exact readback；其余真实 Unicode 输入返回 observed |
| `click` | `controlRef` 或 `loc`，可选 `button:"left"\|"right"\|"middle"`、`clicks:1\|2` | observed，不宣称点击完成了业务目标 |
| `scroll` | `controlRef` 或 `loc`、`direction:"up"\|"down"\|"left"\|"right"`、`wheel_times:1..20` | observed；每次 wheel_times 对应 120 delta |
| `move` | `loc`，可选 `to_loc`、`duration:0..3` | observed；loc 是起点，缺少 to_loc 时在该点移动 |
| `drag` | `from_loc:[x,y]`、`to_loc:[x,y]`，可选 `duration:0..3` | observed；左键，最多 24 插值段 |
| `move` + `drag:true` | `from_loc` / `to_loc`、可选 `loc` / `duration` | 兼容 drag，observed |
| `shortcut` | `shortcut:"CTRL+END"` | observed |
| `press` | `key:"ENTER"`，兼容 `shortcut` 字段 | observed |
| `invoke` | `controlRef` 或 `loc` | 仅 InvokePattern，observed |
| `select` | `controlRef` 或 `loc` | SelectionItemPattern 的 IsSelected 读回：verified/selection |
| `focus` | `controlRef` 或 `loc` | HasKeyboardFocus 读回：verified/focus |

`text` 最多 4096 UTF-16 字符，不含 NUL。快捷键支持 Ctrl/Control、Alt、Shift、ASCII 字母数字、F1–F24、Enter/Return、Tab、Escape/Esc、Backspace、Delete/Del、Space、Home/End、箭头、PageUp/PageDown，最多 5 个不同键；拒绝 Windows 键、Ctrl+Alt+Delete、Ctrl+Shift+Escape。当前没有任意 Shell、任意 launch、剪贴板、任意进程或文件 API。

`verification.state:"observed"` 仅表示输入发送后成功取得新观察；`verified` 仅用于 provider 实际读回的 value/selection/focus/foreground。所有 observed 结果仍需业务调用方核实其业务后置条件。

## Target and failure boundaries

- HWND、PID、进程启动时间、用户 SID、Windows session、Default input desktop、未提升 token / medium-or-lower integrity、原窗口 bounds/DPI、显示器布局、前台身份均在使用时重新核实。拒绝凭据/UAC/安全桌面、受保护进程名、终端/Shell/注册表/任务管理器，以及敏感登录标题。兼容范围是普通用户应用，不以 Notepad 特例放开这些守卫。
- 附属对话框是独立窗口身份，不能把原目标自动改绑到弹窗；应新 list → activate/observe，并经过原宿主对具体动作的授权。关闭/重建、PID/HWND 复用、移动、resize、DPI/显示器变化、前台改变都会拒绝旧目标。当前不自动把子控件的业务含义等同授权。
- 独立 low-level mouse/keyboard hook 跟踪外部 input generation。broker 的每个 SendInput 带进程随机 `dwExtraInfo` 标记；只忽略本进程标记，其他程序注入也触发接管。输入前和观察后检测 generation，真人接管将控制权交还。标记是本地事件分类机制，不是对同用户恶意代码的隔离边界。
- 鼠标定位、按钮、滚动、drag 各步检查 WindowFromPoint 属于原 HWND；键盘各步核实真实焦点属于原顶级窗口且非 password。所有按下键/按钮记录并在 finally、stop、EOF 释放。UIA/provider 检查不持有 input release lock，防止 stop 等待卡死的 UIA 查询。
- 截图要求整个窗口在可见虚拟屏幕内、没有更高 Z-order 窗口相交、没有敏感或截断 UIA 树。实际像素由 `PrintWindow(PW_RENDERFULLCONTENT)` 请求原 HWND 自身绘制，再裁至 DWM 可见 bounds，不从桌面 BitBlt 复制别的窗口。硬件渲染/受保护/不实现 PrintWindow 的应用可能返回空白或不可用，不能据此宣称通用截图兼容。最多 16M 像素与 6 MiB PNG（base64 最多 8 MiB）。
- UIA 与 PrintWindow 是第三方应用同步调用，STA worker 不能安全地强行中断已进入的 COM/Win32 调用。stdin reader 仍能接受 stop、取消后续输入并释放已按键；已经进入的 UIA mutation 可能在 stop 后完成，其结果保留 unknown。外层 transport 必须有独立 deadline/退出机制：超时或断线后终止该 broker、不重发原写入、让 Runtime 原 run 进入 reconciliation；新进程必须重新 observe。此 provider 不承诺能在同进程恢复永久卡死的 UIA provider。
- stdout 可能包含用户明确选择窗口的名称/值/图像；它不是公开日志或无授权上传通道。测试证据只含自有合成数据。provider 本身不提供 OS 文件/网络沙箱，也不能防住同用户进程绕过此可执行文件访问桌面；策略和授权仍由原可信宿主执行。

## Implementation map

- `Program.cs`：bounded stdio、reader 与 STA 执行分离、deadline/cancel、规范化响应。
- `DesktopSession.cs`：引用生命周期、UIA bounded snapshot、动作、读回、window-only screenshot。
- `Native.cs`：普通权限目标身份、SID/session/desktop/integrity、DWM/DPI/monitor/foreground/hit/occlusion。
- `InputController.cs`：独立 hook、带标记 SendInput、串行输入与 finally release。
- `fixture/`、`test/acceptance.mjs`：仅本目录自有应用的真实 Windows 设备链路，不代表 Competition/AgentArts/模型闭环验收。
