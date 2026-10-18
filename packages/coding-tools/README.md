# 编程工具：可信工作区能力（MOD-18）

F15 注册工具 `coding.repair.preview`（包括 Desktop 的 `workflow.host.f15_n04` 别名）只返回会话、预览确认及路径/前后 SHA/变更标记；完整预览正文保留在本地宿主，须在 ToolGateway 记录和原回执签名前完成投影。源码出机继续走原 `coding.repair.read` 的精确原生许可，不能以元数据许可替代。宿主本地 `preview()` 返回及实际补丁/CAS 校验保留。

2026-10-13：已更新 [真实补丁/固定命令与恢复验收](ACCEPTANCE-20261013.md)，修复旧 P6 runner 缺少生产恢复绑定的问题，并验证真实 marker 的派发前退出与写后清理失败恢复。当前合并规则以根 AGENTS/CONTRIBUTING 的一位非作者有效批准为准，覆盖下方历史双人门槛。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/coding-tools` 为 `huawei_ict_agentarts` Competition Profile 提供两个受限只读工具、一个须由可信宿主显式注册的固定命令工具，以及独立授权的补丁候选和原文件应用工具。它不接受自由 shell/argv，不自动把候选文件应用到原文件，不自动发布，也不提供 Artifact/Evidence 服务。

## 当前增量：独占句柄内应用文本补丁

`createWorkspacePatchApplyTool(options)` / `registerWorkspacePatchApply(host, options)`
显式提供 `workspace.apply_text_patch@1.0.0`。它复用现有只读 preview 的严格
相对路径、原 SHA-256、唯一精确编辑和有界 UTF-8 候选字节；额外要求
`workspace:apply`，不能把 stage 的 `workspace:write` 授权升级为源文件应用。
可信宿主提供工作区根、工作区外且已限权的恢复目录、受信 PowerShell 可执行文件；
helper 脚本和可执行文件也必须位于授权工作区外，模型和工具输入都不能改变
这些位置。当前仅支持 Windows，默认不注册到产品。

源码仓库本身作为 `rootPath` 时，默认包内 helper 位于可写工作区内，仍会安全拒绝。
受信宿主可预先在工作区与恢复目录之外的独立、已限权安装目录部署本版本
`scripts/locked-apply.ps1` 的字节一致副本，并显式提供绝对 `helperScriptPath`。
`createDevWorkflowsRuntime` 通过 `workspace.patch.helperScriptPath` 接入该配置；
公共 apply factory/register 也转交同一可选字段。未配置时保留既有默认路径与隔离要求，
不缩小全仓 root，也不移除 in-root 执行保护。

factory 核对外部脚本为单硬链接常规文件、canonical 路径不在 workspace/recovery 内，
并与包内已审查脚本的字节摘要一致；每次 apply 在预览前及启动 helper 前复核路径与摘要。
模型、补丁参数和 PR 内容不能选择该路径；本包不自动复制、安装或执行未知脚本。
该配置是兼容增加的进程内受信宿主选项，不改变工具输入/输出、scope、wire operation 或数据库。
宿主仍须核实安装目录/脚本的 Windows ACL；摘要预检并不消除可被其他进程并发修改目录的
TOCTOU 风险。新增外部路径与突变拒绝的 Windows 场景源码尚未运行，交 Potatos498 集中验证、
goo122 公开消费兼容评审。

固定的 `scripts/locked-apply.ps1` 不使用 `ExecutionPolicy Bypass`，通过 stdin
接收本次 preview 生成、SHA 绑定的候选字节，不信任可由其他进程修改的 stage
文件。它用 .NET `FileStream` 的 `FileShare.None` 在同一独占句柄内核对源 SHA、
最终路径和单硬链接身份；首写前在受信恢复目录排他创建备份并 `Flush(true)`、
读回备份，之后才原位写入、截断、`Flush(true)` 并在仍持锁时读回目标 SHA。
打开文件时已有其他句柄或原 SHA 不符时不写。成功结果只证明独占读回的那个
时刻，锁释放后的用户编辑仍可继续。写入开始后故障、超时或进程终止可能留下
部分文件与备份，必须以任务/运行标识查找备份并重新核对当前源文件及授权，
不自动重试或盲目回滚。恢复目录还按源文件保留 `.inflight` 标记及 helper 的进程身份（PID
和进程起始时间 token）：
候选字节发送前持久创建，只有进程 `close` 确认后才删除；2 秒停止等待超时
可以先向上层返回未知，但标记未消失前不得对账或再次 apply 同一源文件。
进程/宿主崩溃留下的标记只能由受信恢复流程确认同一进程身份已退出、核对备份和
当前源文件后处理。原位写入不是断电/崩溃时始终原子旧或新的替换。

此工具仍不构成任意路径的 OS 沙箱；Node 先拒绝链接、硬链接和越界路径，
helper 再对已打开句柄核对最终路径和链接数，无法证明时不写。恢复目录必须由
可信宿主预先创建并限制访问；本包不把备份当作 Artifact，也不允许其内容自动
送往云端。当前 factory 只确认恢复目录位于工作区外且存在，不能证明 Windows
ACL 已限权；正式组合在核验目录访问控制前不得注册 apply。合成临时目录测试
不构成该核验。现有 ToolGateway 对所有 `local_write` 异常保守映射
`RESULT_UNKNOWN`，包括可以证明首写前安全拒绝的冲突，需由公共 owner 后续
明确分阶段错误；本包不越界修改 Gateway。真实用户工作区验收须与命令工具
共用编程链的一次联合回执。

### 受信恢复对账

`reconcileWorkspacePatchApply(options)` 是宿主在 apply 返回未知或进程/宿主重启后使用的
显式对账入口。它只接受可信宿主提供的工作区根、工作区外恢复目录和原相对源路径；先读取
对应 `.inflight` 的严格记录（必须同时包含 PID 和进程起始时间 token），再由宿主注入的
`isProcessAlive(identity)` 确认同一 helper 身份的状态。检查器必须返回 `running`、`exited`
或 `unknown`；也可由可信宿主提供绝对 `powerShellPath`，让本包通过受信 PowerShell 查询
PID 的起始时间并与 marker 比对。未提供检查器或 PowerShell 路径、PID 已复用、起始时间不匹配、
查询不可用或结果不确定，都保留 marker 并返回 `RESULT_UNKNOWN`。helper 仍存活时返回
`in_progress`，不会删除标记、启动或终止进程。确认同一身份已退出后，它重新检查受保护源文件的真实身份并读回 SHA：当前值等于候选 SHA
返回 `outcome=applied`，等于原 SHA 返回 `not_applied`，其他值返回 `unknown`；三种结果都
不会伪装成成功。只有退出确认、源文件读回和 marker 身份均稳定后才删除标记，允许下一次
独立授权的 apply；进程身份未知、记录损坏、源路径变化或对账竞态会保留标记并返回
`RESULT_UNKNOWN`。该入口不会自动重试、回滚、删除备份或改变 ToolGateway 的错误映射。

首次等待前复制本次 options；等待时复用或修改调用对象不能改变原执行绑定、进程 checker 或 `retainMarker`。保留标记后仍须宿主持久化可信回执再显式清除，不增加自动恢复或重试许可。

## 既有增量：授权后的文本补丁候选文件

`createWorkspacePatchStageTool(options)` 提供显式注册的 `workspace.stage_text_patch@1.0.0`。可信宿主提供工作区根；现有 ToolGateway/Policy 按任务、工具、参数和 `workspace:read` + `workspace:write` 授权，本包不签发授权。输入沿用预览的规范路径、`expectedSha256` 和有界 `edits`。它拒绝链接、硬链接、目录逃逸、敏感文件和过期哈希，在可信根下排他创建 `.pa-stage-*.patch` 候选文件，读回摘要并复核原文件。返回的 `stagedPath` 是相对路径；原文件始终不打开写入、不重命名、不覆盖。`registerWorkspacePatchStage(host, options)` 沿用现有 ToolHost 生命周期，默认不在产品中注册。

候选文件创建属于 `local_write`，不支持自动幂等重试与恢复；失败时尝试删除本次候选，无法确认清理则报告 `RESULT_UNKNOWN`。候选文件不是已应用补丁或最终 Artifact。上述 apply 是独立的独占句柄原位应用路径，不把 stage 的哈希检查或 rename 冒充原子 CAS。

## 公开入口

- `createWorkspaceReadTool(options)`：创建 `RegisteredTool`；`options.rootPath` 必须由可信宿主注入，不能来自 AgentArts、模型输出或工具参数。
- `register(host, options)`：使用现有 `ToolHost.register()` 注册并返回 dispose，不创建第二套 registry。
- 工具 scope：`workspace:read`。授权仍由 Runtime/Policy/ToolGateway 签发、绑定和消费；本包不创建授权引用，也不扩大 scope。
- 输入：`{path, maxBytes?}`。`path` 只接受规范的相对子路径，`maxBytes` 只能收紧宿主上限。文件必须完整落在上限内；不截断、不提供无限输出。
- 输出：`{path, encoding:'utf-8', byteLength, content, sha256}`。`sha256` 是同一次读取的原始字节摘要，可作为该 `path` 后续 preview/apply 的 `expectedSha256`；不能让模型另行计算摘要或用一次新读取替换旧版本。只返回相对路径，不披露宿主工作区绝对路径。
- UTF-8 BOM 以正文首个 U+FEFF 保留，换行不归一化；摘要、`byteLength`、preview 重编码与 apply 原始字节校验一致。文件在读取后变化时，旧摘要必须触发冲突，不构成写入授权。
- `workspace.read_text@1.0.0` 的 provisional 输出 Schema 兼容增加可选 `sha256`：历史无摘要结果仍可校验，当前 provider 成功读取必带摘要。严格消费者需发现当前 descriptor，不能以缓存旧 Schema 校验新输出；缺摘要历史结果需显式重新读取后重新拟定补丁。
- 序列化边界：结果自身的 UTF-8 JSON 最多为 `MAX_SERIALIZED_WORKSPACE_READ_RESULT_BYTES`（当前为 960 KiB），为现有 `tool.invoke` / Response 包装预留 64 KiB；超限拒绝，不截断。

目录枚举使用独立入口与 scope：

- `createWorkspaceListTool(options)` 创建 `workspace.list_entries@1.0.0`；`registerWorkspaceList(host, options)` 注册并返回只释放该工具的 disposer。
- 工具 scope 为 `workspace:list`，不会把已有 `workspace:read` 授权扩大为枚举权限。
- 输入为 `{path, limit?}`；只有 `path:'.'` 表示受信根，其他路径必须是规范相对子目录。默认 limit 为 100；宿主 `maxEntries` 可降低请求上限，模块硬上限为 1000。
- 输出为 `{path, entries:[{name, kind:'file'|'directory'}], truncated}`。只返回直接子项名称与类别，不递归、不读取正文，也不返回绝对路径、权限、所有者、大小或时间；结果自身同样受 960 KiB 序列化门禁约束。

固定命令使用独立入口与 scope：

- `createWorkspaceCommandTool(options)` 创建 `workspace.run_allowed_command@1.0.0`；`registerWorkspaceCommand(host, options)` 显式注册并返回 disposer。`rootPath`、非空 `recipes` 及其中每个绝对可执行文件路径和完整 argv 均来自可信宿主；可执行文件不能位于可写工作区内。工具输入仅有 `{recipeId}`，严格枚举并拒绝额外字段。宿主配置在注册时复制，不受后续数组修改影响。
  执行开始时一次捕获宿主时钟，将任务 deadline 与最长执行时间合为本次期限；直接子进程结束、输出解码后再次检查取消与期限，延迟计时器不能使过期结果变为成功。时钟异常固定脱敏拒绝，取消保持优先；即使拒绝返回成功，命令也可能已产生副作用，仍不能自动重试。
- scope 为 `workspace:execute`，descriptor 是 `local_write`、不可幂等/不可自动恢复；已有 Policy/ToolGateway 必须对精确参数审批并消费授权。当前 `requiresPresence:false` 仅因 Runtime 未提供独立在场字段，绝不代替审批。
- 用 Node 内置 `spawn` 的 `shell:false`、固定 canonical 工作目录、默认空环境（或由受信宿主注入并经过模式/敏感词校验的受控 `env`）及隐藏窗口执行；不引入 execa 或另一套调度器。运行期限默认 30 秒、至多 120 秒；合并 stdout/stderr 原始字节预算默认 64 KiB、至多 256 KiB。超限、截止或取消会请求终止直接子进程；无法在 2 秒内确认退出时返回未知结果。输出必须完整有效 UTF-8，不截断成功结果。
- 注册时绑定 canonical 根目录及其设备/目录身份；每次启动前同步复核路径仍解析到该目录、目录身份未变化。根被换为链接、另一个普通目录、文件或已移除时，公开工具拒绝 `SCOPE_DENIED`，不启动命令，也不自动重绑新目录。正常修改工作区内容不会使授权根失效；注册时提供的链接只解析到当时的 canonical 目标。检查仍不能消除复核与 OS 启动之间的路径竞态，不构成 OS 沙箱。
- 输出 `{recipeId,exitCode,stdout,stderr}` 只证明该直接进程的退出码与收集到的文本；非零码是失败的验证命令，不代表产物已读回、Artifact 已保存或副作用可重试。`ToolGateway` 对 `local_write` 异常统一返回 `RESULT_UNKNOWN`，调用方必须对账。
- `rootPath` 只是 cwd，不是进程文件系统边界。固定可信命令仍以宿主 OS 账号权限访问文件。在 Windows 上，直接执行 Node/npm 并在超时/取消时调用 `child.kill('SIGKILL')` 仅能终止直接进程，npm 脚本派生的子进程树会成为孤儿进程；为此在 `packages/coding-tools/native/` 下提供了 `WindowsJobProcessHost` 原生助手（基于 .NET 8 与 Win32 Job Object）：
  - 通过 `CreateJobObjectW` 与 `SetInformationJobObject` 设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)`，严禁 breakaway；
  - 使用 `CreateProcessW` 配合 `CREATE_SUSPENDED` 创建挂起目标进程与标准管道重定向；
  - 严格保持在 `ResumeThread` 前通过 `AssignProcessToJobObject` 纳管进程（分配失败立即 TerminateProcess 挂起进程），决不允许未纳管的进程开始运行；
  - 在宿主进程被杀、超时、取消或句柄关闭时，由 Windows 内核原子终止整棵子进程树，防止后台孤儿编译/脚本进程残留；
  - 根命令正常退出后先关闭本次 Job，再等待 stdout/stderr 排空；继承输出句柄的遗留子进程会随 Job 结束，保留根命令的实际退出码和已收集输出，不能作为后台服务启动器。
  - 仅用于受信 Desktop 宿主构造的受控命令（如 npm-build / npm-test），严禁向模型暴露任意 shell/argv。
  - 受信宿主可在 recipe 或 options 中注入受控只读环境变量（key 必须满足正则、严禁包含 TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL/AUTH 等敏感词、value 限制长度且不含 NUL）；未指定时默认空环境，绝不继承外部 `process.env` 私人凭据。
  - 提供了专属开发构建脚本 `packages/coding-tools/native/build-helper.mjs`，调用者必须显式传入工作区外的目标目录（例如 app `userData/native-helper`）并通过 `dotnet publish` 输出二进制；脚本严禁将发布目标设在仓库或工作区内部，要求系统预装 .NET 8 SDK，不执行 `ExecutionPolicy Bypass`，不自动下载外部 SDK。

## 安全边界

工具拒绝绝对路径、`..`、Windows 盘符与 drive-relative 路径、UNC/设备路径、ADS、保留设备名和含尾随点/空格的歧义段。可信根使用 OS-native 同步 realpath，候选文件使用异步 realpath，避免 Windows CI 临时目录的 legacy/native 别名差异造成错误拒绝；随后通过 `path.relative` 的目录边界判断，不会用字符串前缀判断 containment。打开文件前后会再次核对 realpath 和文件标识，读取期间按块检查取消与 deadline，并在文件元数据变化时拒绝返回。

默认敏感文件策略同时检查请求路径与 realpath 目标，拒绝常见 `.env*`、凭据文件、私钥扩展、`.git`/`.ssh`/`.aws`/`.azure`/`.kube`/`.gnupg`/`.codex` 目录，并对文本内容中的私钥头再做一次拒绝。只接受完整、有效 UTF-8 且不含二进制控制字符的常规文件；默认原始文件上限为 256 KiB，宿主可调整，最高不能超过协议 1 MiB 边界。

原始字节数不等于 JSON 帧大小：Tab、换行、回车、引号和反斜杠会在 JSON 中转义。默认 256 KiB 即使全部由当前允许的最坏单字节转义字符组成，结果自身仍落在 960 KiB 预算内；NUL 等会产生更大 `\u00xx` 膨胀的控制字符会先被二进制策略拒绝。宿主提高原始文件上限时，工具会按实际序列化大小再次 fail-closed。该预算只约束 `WorkspaceReadResult`，不是对任意未来包装的保证：公共 Schema 没有限制所有 ID 与 `evidenceRefs` 的总长度，上层仍必须调用 `encodeFrame` 执行最终 1 MiB 帧校验。

这是一层应用内约束，不是 OS 沙箱。跨平台 Node API 没有提供对整条路径逐目录、不可替换的句柄遍历；实现用 canonical path、打开句柄身份和读取后元数据复核缩小符号链接/junction 与 TOCTOU 风险，但不能在攻击者可并发改写目录项的工作区内宣称消除了所有竞态。只读检查与候选创建不能当作原文件写入沙箱；固定命令 provider 也不提升为任意代码隔离能力。

返回的源码只交给已经通过本地授权的调用路径。本包不会上传 AgentArts、写日志或持久化内容；调用方若要把内容发往云端，仍须单独执行最小化、脱敏和出机授权。

目录枚举在打开前确认请求目录位于 canonical root 内，拒绝把 symlink/junction 当作目标；遍历结束后再次核对路径和目录身份。枚举项只接受 `Dirent` 直接报告的普通文件/目录，symlink、junction、其他特殊项、不可由本包规范寻址的名称和默认敏感路径都会被省略，不跟随目标。敏感项不计入 `truncated`。

`workspace.list_entries` 使用 `opendir` 迭代，不先把整个目录读入数组；扫描期间仅保留至多 `limit` 个按 JavaScript 字符串码元升序排列的候选，因此输出与内存有界。为了得到全局稳定的前 N 项，仍会扫描到目录末尾，扫描过程逐项检查 deadline/cancel。真实文件系统枚举不是事务快照：读后 lstat/realpath/身份复核能拒绝可检测的目录路径替换，但 Node `fs.Dir` 没有公开可供本实现 fstat 的目录句柄，不能消除恶意并发替换竞态，也不能阻止扫描期间普通子项增删或改名；结果只能表示本次受限观察，不能当作完美快照。

## 当前状态与接线限制

本包消费 `@personal-agent/contracts@0.1.0-alpha.1` 的 provisional `RegisteredTool`、`ToolContext` 与 `ToolHost`，并按现有 Gateway/Policy scope 机制工作。它没有私设仍为 unavailable 的 `ToolExecutionPort`、ArtifactPort 或 EvidencePort。

已合并的只读工具验收不证明候选或 apply 工具已进入 Runtime 或真实 AgentArts。`workspace.list_entries`、固定命令、候选文件和 apply 工具均不会自动进入生产 composition。根 `package.json` build 编排与 `package-lock.json` workspace 记录随 PR #83 从 `main@1e3b56b6` 重建；旧 Draft #63 已关闭。

真实目标系统读回、Evidence 与最终回答仍须在 Runtime/Desktop 联合链路验收；本地工具测试不构成 Competition Golden Path 的完成证据。

已授权的 Local Profile 开发自动化另提供 `runCiFix` / `createCiFixWorkflow`，详见
[MOD-34](../../docs/modules/MOD-34-CI-FIX-01.md)。每次调用在首个异步派发前捕获执行配置，
复制源路径数组及 Issue、Git 工具名、源运行关联的子对象；调用方随后更新复用配置不会
改变本次仓库、分支、验证 recipe 或预算。新任务可使用新配置，旧 checkpoint 仍按原
identity 拒绝输入变更。factory 在创建时固定模型和工具对象，旧任务的 pending/unknown
恢复仍经原端口消费原 run；新 factory 可使用新端口，直接 `runCiFix` 则每次调用选取
端口。原对象的方法和注册能力，以及 Runtime 授权、确认回执就绪与时钟钩子保持实时；
配置快照不签发权限、不重试未知写入，也不证明真实修复闭环已验收。

## 定向验证

测试只创建系统临时目录中的合成文件，不读取真实用户项目内容：

```powershell
npm.cmd run build --workspace=@personal-agent/contracts
npm.cmd run build --workspace=@personal-agent/coding-tools
npm.cmd run typecheck --workspace=@personal-agent/coding-tools
npm.cmd test --workspace=@personal-agent/coding-tools
node --test --test-isolation=none packages/coding-tools/test/workspace-read-wire-boundary.test.mjs
node --test --test-isolation=none packages/coding-tools/test/workspace-list.test.mjs
git diff --check
```

读取覆盖：允许的 UTF-8 文本；精确 Schema；绝对/父级/盘符/UNC/设备/ADS；兄弟前缀和 symlink/junction 逃逸；敏感文件；大文件与二进制；缺 scope；deadline/cancel；现有 Host 的 register/dispose；控制字符转义膨胀拒绝与正常 UTF-8 序列化边界。

枚举覆盖：根目录 `.`、稳定排序、limit/truncated、不递归、逃逸/敏感项/symlink-junction、独立 scope、扫描中 deadline、取消、严格 Schema、register/dispose。测试只使用系统临时目录中的合成文件；不读取真实用户工作区。
## 2026-10-12 Windows 取消测试就绪同步

取消进程树测试在孙进程 PID 已写出且确实存活后才发送取消。就绪等待与命令宿主
既有 30 秒租约一致，以实际 deadline 计时；不会改变生产命令期限、取消结果或退出断言。
回归额外模拟 11 秒启动延迟：旧 10 秒测试期限先触发 TIMEOUT，修复后仍须得到
CANCELLED，并确认孙进程退出。专项 `workspace-command.test.mjs` 24/24 通过、0 skip。
日志保留在修复工作树 `.cache/readiness-tests.log` 和 `.cache/readiness-old-lease-repro.log`。
此为 #321 Foundation 的本地修复证据，尚不等于新提交的远程 CI 已通过。
