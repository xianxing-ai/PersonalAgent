# MOD-16-GEMINI-NOTEPAD-UIA-READINESS：现代记事本 UIA 结构就绪复核与唯一可编辑候选定位

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 目标 Profile：`huawei_ict_agentarts`（比赛主路径，Local 保留为可选 baseline）。
- 需求与任务：MOD-16 / PA-016；负责人 `zemeng`，非作者评审 `goo122`。
- 本工作包分支：`codex/gemini-notepad-uia-readiness`（基于 PR #188 head `888f8bc`，向 `codex/gemini-windows-execution` 发起堆叠 Draft PR）。
- 依赖基础：前序 PR #188（目标就绪帧、用户接管检测与活跃重复请求收敛）。
- 变更范围：独占 `apps/windows-host/**` 及本文档；不修改 Desktop、Runtime、Policy、公共 Schema、根配置/锁文件、`packages/windows-client` 或其他工作树。
- 当前接口与能力状态：内部 Pipe 协议保持 `0.1.0` provisional；运行时执行能力保持 `unavailable`。

---

## 1. 核心改进与语义修正

### 1.1 修复 `target_ready` 假就绪（False Readiness）语义缺陷
- **问题分析**：原实现中，`HostService` 收到 `target_ready` 请求后调用 `NotepadTargets.Resolve` -> `NotepadAction.CheckSingleTabTarget`，该检查只核验了进程启动时间、PID、可信进程与单标签（Tab）结构；但随后的写操作 `NotepadAction.ReplaceTextAsync` 严格要求存在唯一的 UIA `ControlType.Edit` 并支持 `ValuePattern`。在缺失可写文本控件或存在多个控件结构时，`target_ready` 仍会回传 `ready=true`，导致在执行端必然被拒绝。
- **就绪语义对齐**：
  - 在 `NotepadAction.CheckSingleTabTarget` 中同步引入唯一可写编辑控件结构检查 `TryGetOnlyEditableTextControl`。
  - `NotepadTargets.Observe` 与 `NotepadTargets.Resolve` 均由此获得统一的控件结构就绪判定：
    - 缺少有效编辑控件或存在多个有效编辑候选：`CheckSingleTabTarget` 明确返回失败（`TARGET_AMBIGUOUS` 或 `TARGET_STALE`）。
    - 针对 `target_ready`，若 `Resolve` 无法确认唯一控件结构，返回 `null`，服务端回传 `ready=false, errorCode="TARGET_STALE"`。
  - **审批前零内容泄露与隐私安全**：在 `target_ready` 与 `Observe` 阶段，结构核验只读取控件元数据属性（可见性、启用状态、可写性、模式支持），**绝不读取编辑正文（`value.Current.Value`）、窗口标题、文件路径或私人标签文本**；`ready=true` 仅代表当前既有受支持的受控结构可用，执行前仍必须经历完整的审批授权消费、重绑定、键鼠接管检测与文本匹配复核。

### 1.2 现代 Notepad UIA 候选定位规则统一与条件性支持
- **原规则局限**：原代码在 `ReplaceTextAsync`、预写重绑定（Prewrite Rebind）与后置读回（Post-write Readback）三处均直接使用 `root.FindAll(ControlType.Edit)` 并断言 `Count == 1`。若控件树中同时存在其他 Edit 元素（如不可见或只读的附属 Edit），原规则会因 `Count > 1` 判定为 `TARGET_AMBIGUOUS`。
- **事实与证据边界校准**：
  - **本机未实际观察现代 Notepad 的 UIA 树，不可声称已知常见控件形态、已验证现实兼容或完整结构过滤**。
  - 仅提炼出最小一致的条件支持规则：当且仅当 UIA 能够确定**唯一可见、启用、可写且提供 `ValuePattern`** 的编辑候选时予以支持；若多候选、无有效候选或无法确认归属则必须明确拒绝。
- **一致的安全候选定位规则（`TryGetOnlyEditableTextControl`）**：
  在不放宽隔离的前提下，统一提炼出全链路复用的最小过滤判定：
  1. `!edit.Current.IsOffscreen`：控件必须可见，排除不可见元素；
  2. `edit.Current.IsEnabled`：控件必须处于启用状态；
  3. `edit.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)`：必须支持 UIA `ValuePattern`；
  4. `!((ValuePattern)pattern).Current.IsReadOnly`：必须可写，排除只读元素。
  - **候选遍历异常 Fail Closed（关键安全缺口返修）**：
    遍历 Edit 候选集合时，若对任一候选查询元数据（如 `IsOffscreen`、`IsEnabled`、`IsReadOnly`）抛出 `ElementNotAvailableException` 或 `InvalidOperationException`，**绝不捕获跳过**；候选集合不完整时立即 fail closed，由外层捕获返回 `TARGET_STALE`，杜绝因部分控件失效而将剩余附属输入框误认为唯一候选的风险。
  - **严格歧义拒绝**：
    - 过滤后候选数 `Count == 1`：判定为唯一目标编辑控件。
    - 过滤后候选数 `Count == 0` 或 `Count > 1`：严格拒绝（`TARGET_AMBIGUOUS` / `TARGET_STALE`），**绝不根据预期/当前正文猜测用户想写哪个控件，绝不进行盲键盘回退，绝不猜测特定 AutomationId**。
  - **全链路一致绑定**：
    - 初始定位：使用 `TryGetOnlyEditableTextControl` 获取唯一目标。
    - 预写重绑定：再次调用 `TryGetOnlyEditableTextControl` 并核验 `SameElement(edit, prewriteEdit)`，确保必须为同一 UIA 元素。
    - 后置读回：再次调用 `TryGetOnlyEditableTextControl`，核验 `SameElement(edit, readbackEdit)` 且读取新文本确认已生效。

---

## 2. 验证证据与测试记录

> **证据范围声明**：本机未实际观察现代 Notepad UIA 树；离线 .NET 8 编译、便携式契约夹具及死句柄/无效窗口 fixture 仅验证了代码逻辑、拦截与 fail-closed 分支，不能证明真实现代记事本真实可写。

### 2.1 定向 .NET 8 编译验证
在 Windows 环境执行定向构建，全部通过，**0 警告、0 错误**：
- `dotnet build apps/windows-host/WindowsHost.csproj` -> Exit 0
- `dotnet build apps/windows-host/host/WindowsHost.Host.csproj` -> Exit 0
- `dotnet build apps/windows-host/host/test/WindowsHost.HostFixture.csproj` -> Exit 0
- `dotnet build apps/windows-host/test/WindowsHost.Timing.csproj` -> Exit 0

### 2.2 契约与便携夹具回归（`WindowsHost.HostFixture`）
- 运行 `WindowsHost.HostFixture` 覆盖测试：
  - #168 全部 valid/invalid portable 帧解析。
  - `target_ready` 与 `target_ready_result` 字段及互斥约束。
  - `ActiveExecution` 状态机与收据全量分发。
  - 新增结构就绪核验测试：验证 `CheckSingleTabTarget` 与 `HasSingleTabForManualProbe` 在句柄失效或无效窗口时正确拒绝并返回 `TARGET_STALE`。
- 输出：`Windows Host portable contract and durable-run fixture passed`，Exit 0。

### 2.3 定向时序回归（`WindowsHost.Timing`）
- 运行 `WindowsHost.Timing` 模拟时序竞争：
  - 首次读取预期文本后注入用户按键 tick 变化 -> 写前拦截拒绝。
  - 模拟不改变 tick 的程序改值 -> 写前拦截拒绝。
- 输出：`PASS: prewrite user input and programmatic edit rejected`，Exit 0。

---

## 3. 架构边界、接口与不可用清单

1. **接口与 Schema 零变更**：
   - 内部 Pipe 协议维持 `0.1.0` provisional，无新字段、新帧类型或新 DTO。
   - 所有错误码维持已有 Schema 枚举范围（`TARGET_STALE` / `TARGET_AMBIGUOUS` / `TIMEOUT`）。
2. **未验证项及原因**：
   - 本机未实际观察现代 Notepad UIA 树；离线编译和死句柄/无效窗口夹具不能证明真实现代记事本真实可写。真实记事本 UIA 执行端到端按规范由主任务在单一设备槽进行。
   - 本地能力在产品侧保持 `unavailable`。

---

## 4. 交付与评审
- 基于 `888f8bc`（PR #188），作为独立堆叠小包提交至 `codex/gemini-notepad-uia-readiness`。
- 由 `goo122` 进行非作者评审；禁止自合并。
