# WindowsJobProcessHost：Windows 进程树作业对象宿主（MOD-18）

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。
<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本项目为 `@personal-agent/coding-tools` 提供 Windows 平台下的进程树销毁保证，用于受控执行 npm 构建与测试脚本（`npm-build` / `npm-test`）。

## 背景与设计目标

在 Windows 上，Node.js 原生 `child.kill('SIGKILL')` 仅能杀死直接子进程；npm run 派生的子进程树（如编译器、开发服务器、测试进程）会变成不受控的孤儿进程残留于后台。

`WindowsJobProcessHost` 基于 .NET 8 与 Win32 API 实现了内核级进程树生命周期管控：
1. **作业对象限制**：`CreateJobObjectW` 设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)`，禁止 breakaway；
2. **挂起创建与纳管**：`CreateProcessW` 配合 `CREATE_SUSPENDED`；
3. **分配前序不变量（Assign Before Resume）**：在唤醒主线程前必须先通过 `AssignProcessToJobObject` 纳管，失败立即 `TerminateProcess` 挂起进程并报错，绝不放任未纳管进程开始运行；
4. **内核级原子灭活**：当父进程（Node 工具）发送 SIGKILL、被任务系统终止、或者 helper 进程由于任何原因退出时，操作系统内核自动关闭 Job Object 句柄，瞬间原子杀死整棵子进程树的所有孙进程；
5. **管道与退出码安全转发**：异步双向泵送 stdout/stderr 管道流，退出时如实返回子进程退出码。

## 开发构建脚本（build-helper.mjs）

为方便 Desktop 开发环境获取工作区外的受信任 helper 可执行文件，提供 `build-helper.mjs`：

```powershell
node packages/coding-tools/native/build-helper.mjs --target-dir <trusted-external-dir>
```

### 约束与不变量：
1. **显式外部目标目录**：`--target-dir` 必须由调用者显式传入绝对路径（如 Desktop 主进程的 app `userData/native-helper`），严禁默认为仓库或当前选定工作区；
2. **需要系统预装 .NET 8 SDK**：绝不自动下载或安装外部 SDK，缺失 SDK 明确提示错误；
3. **无执行策略旁路**：纯 Node.js 实现，不使用 PowerShell `ExecutionPolicy Bypass`；
4. **输出确认**：成功发布并输出规范化可执行文件路径（`WindowsJobProcessHost.exe`）。

## 生产与运行说明

1. **非 OS 权限沙箱**：执行进程仍以当前 Windows 用户凭据运行；
2. **不能把 helper exit 直接当成孙进程停止证据**：helper 自身的退出并不构成孙进程灭活的充分证据，必须由 Windows 内核 Job Object 机制保证；
3. **真实 npm 项目未验**：本机制在合成子进程树测试中已完成内核验证，但尚未在真实复杂 npm 项目中进行全链路验证；产品接口目录中命令能力继续维持 `unavailable`。

## 进程身份查询

同一个受信可执行文件还提供只读的
`WindowsJobProcessHost.exe --query-process-start-time <pid>` 入口。它用
`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` 与 `GetProcessTimes` 读取目标进程的
创建时间，并输出与 PowerShell `DateTime.Ticks` 相同的十进制起始时间 token；PID 不存在时
返回专用的 not-found 退出码，权限不足、竞态或查询失败返回其他失败码。该入口不创建
Job Object、不启动目标进程、不缓存 PID，也不改变现有进程树宿主行为。

## Process identity query budgets

The PowerShell identity-query fallback retains a fixed 2,000 ms budget. The trusted native WindowsJobProcessHost.exe query has a bounded startup budget of up to 10,000 ms to cover cold native startup, while the caller's remaining ToolContext deadline and AbortSignal always cap it earlier. Cancellation, deadline expiry, query failure, output-limit failure, or an identity mismatch remains unconfirmed (unknown); no patch bytes may be sent or an in-flight marker cleared from those results.
