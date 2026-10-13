# MOD-18-GEMINI-COMMAND-RECIPES：可信桌面命令工具配方构造与安全边界

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- **目标 Profile**：`huawei_ict_agentarts`（比赛主路径，Local 保留为可选 baseline）。
- **需求与任务**：MOD-18 / PA-017；负责人 `zemeng`（Gemini 3.8 Flash High 实现），非作者评审 `goo122`。
- **基线提交**：`d9ecf2623c2aeff9deeb46bdca17c6e340087ab2`。
- **本工作包分支**：`codex/gemini-workspace-command-recipes`（独占编辑授权文件，不破坏其他协作者工作树）。
- **本轮改动文件范围**：
  1. `apps/desktop/electron/workspace-command-recipes.js`
  2. `apps/desktop/test/workspace-command-recipes.test.mjs`
  3. `docs/modules/MOD-18-GEMINI-COMMAND-RECIPES.md`
  4. `packages/coding-tools/src/command.ts`
  5. `packages/coding-tools/README.md`
  6. `packages/coding-tools/test/workspace-command.test.mjs`
  7. `packages/coding-tools/native/`（`WindowsJobProcessHost.csproj`、`Program.cs`、`.gitignore`）
- **当前接口与能力状态**：内部组合辅助入口；产品端命令执行能力继续保持 `unavailable`。

---

## 1. 核心职责与安全模型

本模块为可信 Desktop Main 进程提供**受限工作区命令工具配方构造入口**（`buildWorkspaceCommandRecipes` 与 `createWorkspaceCommandRecipeTool`），基于 `@personal-agent/coding-tools` 公开的 `createWorkspaceCommandTool` 组装受限命令，严格遵循如下安全原则：

### 1.1 绝不新建进程执行器或第二套协议
- 严格消费 `@personal-agent/coding-tools` 的公开 `createWorkspaceCommandTool`，**绝不另写 `spawn`、`shell`、进程执行器、第二工具协议或 Runtime 执行循环**。
- 所有执行生命周期、超时期限（`deadline`）、取消信号（`context.signal`）、输出缓冲上限（`maxOutputBytes`）及 UTF-8 校验全部由底层公开命令工厂托管。
- `createWorkspaceCommandRecipeTool` 要求宿主**显式传入公开的 `createWorkspaceCommandTool` 工厂**；若未传入或非函数，立即 **Fail Closed**，绝不通过动态 import 掩盖破损依赖错误。

### 1.2 严格要求宿主显式注入 Node 与助手可执行文件（禁止 PATH 自动探测）
- `nodeExecutable` **必须由受信 Desktop Main 显式传入固定的绝对路径**；
- **禁止使用 `where.exe`、PATH 环境变量搜索或默认回退至 `process.execPath`**（PATH 可能由用户或工作区篡改，不能作为可信安装证明）；
- 必须校验：为规范绝对路径、为普通文件（非符号链接）、文件名必须为 `node.exe`（非 Windows 平台为 `node`），且**必须严格位于所授权的工作区外**。
- 同理，`jobHelperExecutable`（WindowsJobProcessHost.exe）与 `npmCliPath`（npm-cli.js）亦必须由受信宿主显式注入，并验证为工作区外、规范化普通文件。

### 1.3 严格固定 argv 与参数枚举
- 所有命令参数（`args`）由宿主在配置时预先构造并固化（如 `['--check', relPath]` 或 `['--cwd', root, '--exe', node, '--', npmCli, 'run', 'build']`）。
- **禁止模型提供可执行文件路径、任意脚本路径、或 shell 命令行字符串**。
- 模型在执行时仅提供 `{recipeId}`，枚举值严格收紧至当前批准的配方集合。

### 1.4 路径合法性、符号链接与跨界逃逸防御
- **工作区边界**：`workspaceRoot` 必须为本机绝对目录，禁止驱动器根目录（如 `C:\`），禁止 UNC 网络路径，禁止符号链接。若指定 `authorizedWorkspaceRoot`，必须严格与已授权目录身份一致。
- **待检查源文件**：`checkFiles` 必须是工作区内的规范相对路径。严格拒绝绝对路径、驱动器盘符、UNC 路径、`..` 目录逃逸、符号链接（`isSymbolicLink()`）以及指向工作区外的目标。
- **package.json 与 node_modules 防逃逸**：
  - `inspectPackageJson` 先通过 `lstatSync` 校验 `package.json` **非符号链接**，再通过 `realpathSync.native` 验证其真实存储位置严格在工作区内部；严禁跟随符号链接读取工作区外部的私人/未授权文件；
  - `checkNodeModules` 同样通过 `lstatSync` 拒绝符号链接，并验证 `realpathSync.native` 边界，严防把工作区外部的 junction / symlink 目录误算为已安装依赖。

---

## 2. Windows 孤儿进程树治理：WindowsJobProcessHost 原生内核隔离

在 Windows 操作系统中，若直接通过 Node 内置 `spawn` 派生 `npm run build` 或 `npm test`，并在超时/取消时调用 `child.kill('SIGKILL')`，仅能杀死直接的父进程，而 npm 或 node 衍生出的底层编译工具（如 tsc、vite、webpack、jest 等）会成为不受控的**孤儿后台进程**，持续霸占系统资源。

为此，我们在 `packages/coding-tools/native/` 下实现了极简专用的原生宿主助手：`WindowsJobProcessHost`（基于 .NET 8 与 Win32 API）：

### 2.1 严格的 Win32 Job Object 不变量与错误处理
1. **Kill On Job Close 保证**：使用 `CreateJobObjectW` 创建 Win32 作业对象，并配置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)`，同时坚决禁止 breakaway（严防进程从 Job Object 逃逸）。
2. **挂起创建与纳管前序**：使用 `CreateProcessW` 配合 `CREATE_SUSPENDED (0x4)` 与 `CREATE_NO_WINDOW (0x08000000)` 创建目标 Node/npm 进程。
3. **关键安全不变量（Assign Before Resume）**：
   - 在挂起进程的主线程被唤醒前，必须先调用 `AssignProcessToJobObject` 将其加入作业对象；
   - **若加入作业对象失败，立即调用 `TerminateProcess` 强制销毁该挂起进程**，决不放任任何未纳管的进程开始运行；
   - 只有在成功加入作业对象后，才调用 `ResumeThread` 恢复进程执行；若 `ResumeThread` 失败（返回 `0xFFFFFFFF`），同样立即 `TerminateProcess` 并关闭句柄 Fail Closed。
4. **管道与句柄严密管理**：
   - 检查 `CreatePipe` 与 `SetHandleInformation` 返回值；任一管道创建失败立即关闭已分配句柄并退出；
   - 进程创建成功后立即在 helper 中关闭 stdout/stderr 的写端句柄，使管道读流能正常捕获 EOF。
5. **内核级原子灭活**：当父进程（Node 工具）发送 SIGKILL、被任务系统终止、或者 helper 进程由于任何原因退出时，操作系统内核自动关闭 Job Object 句柄，从而瞬间、原子地强制终止整棵子进程树中的所有子进程、孙进程。
6. **注意：非 OS 沙箱声明与证据边界**：
   - **这不是 OS 权限沙箱**：执行进程仍以当前 Windows 用户凭据运行；
   - **不能把 helper 退出直接等同于孙进程停止**：helper 自身的退出并不构成孙进程灭活的证据；测试中必须通过 Windows 操作系统内核的 Job Object 机制并在销毁后轮询真实孙进程 PID（确认返回 `ESRCH`）作为独立验证依据。

---

## 3. 受信环境变量注入与敏感词防御

在 `packages/coding-tools/src/command.ts` 中增强了环境变量配置与严格防御：
1. **向后兼容**：若未传入 `env`，保持现状使用默认 `{}`（不继承当前进程的 `process.env`，绝不泄漏外部私人凭据）。
2. **严格的键值模式门禁**：
   - 环境变量键必须匹配 `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u`，不能包含 `=` 或 `\0`；
   - 阻断含有敏感词的键：`/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i` 立即抛出 `INVALID_ARGUMENT`；
   - 环境变量值必须为 string，字符长度限制 <= 4096，且不含 `\0`；
   - 总条目数受限（<= 64 条）。
3. **白名单操作系统变量**：
   Desktop helper 在组装 npm 项目脚本配方时，仅从系统环境中提取最小化的安全操作系统变量（如 `APPDATA`, `LOCALAPPDATA`, `ComSpec`, `PATH`, `SystemRoot`, `TEMP`, `TMP`, `WINDIR` 等），保证 Node 和 npm 可以在受限隔离环境下正确定位 Windows 系统组件，同时杜绝任何用户私有 Token、API Key 的传入。

---

## 4. npm-build 与 npm-test 的严格门禁与运行时不可变性 Pinning

### 4.1 五项严格安全门禁
在 `apps/desktop/electron/workspace-command-recipes.js` 中，只有当**下列 5 项安全门禁全部满足**时，才会生成并暴露 `npm-build` 与 `npm-test` 配方：
1. `allowProjectScripts === true`：宿主显式选择开启；
2. **受信 Job Helper 注入**：宿主显式提供 `jobHelperExecutable`（通过 `resolveJobHelperExecutable` 校验为工作区外、规范化普通文件、非 symlink，Windows 下为 `.exe`）；
3. **受信 npm-cli 路径注入或确定性推导**：宿主显式提供 `npmCliPath`（校验为工作区外、规范化普通文件、非 symlink），或在宿主未提供时通过 `inferNpmCliFromNodeExecutable` 从受信 `nodeExecutable` 目录结构确定性推导（`<nodeDir>/node_modules/npm/bin/npm-cli.js`），并严格核实推导文件位于工作区外、为非符号链接实体文件；
4. **package.json 声明脚本**：工作区根目录存在非符号链接的 `package.json`，且声明了 `build` 或 `test` 脚本（只核验脚本名称存在，绝不读取、存储或泄露脚本正文）；
5. **本地依赖存在性门禁**：工作区根目录必须已经存在合法的实体 `node_modules/` 目录（非指向外部的 symlink/junction）；若不存在，诊断记录 `dependencies_missing`，**坚决不自动执行 `npm install` 或联网下载包**。

若上述任一条件不满足，诊断信息记录明确原因，配方中仅包含合规的 `node --check`，绝不暴露未准备好的 npm 配方。

### 4.2 运行时不可变性 Pinning（防替换与防篡改）
为防止工具在构造后其底层可执行文件、配置文件或工作区被动态替换或篡改，`createWorkspaceCommandRecipeTool` 实现了严格的运行时动态 Pinning：
1. **快照 Pin 捕获**：在工厂构造时，捕获 `workspaceRoot` 目录身份、`nodeExecutable`（规范路径/文件大小/mtime/inode）、`jobHelperExecutable`（规范路径/大小/SHA-256 哈希）、`npmCliPath`（规范路径/大小/SHA-256 哈希）以及 `package.json`（规范路径/SHA-256 哈希/mtime）；
2. **动态复核与 Fail Closed**：
   - 在每次 `available()` 被调用时，动态复核所有 Pin 项及 `node_modules` 存在性；任一要素被修改、被替换为符号链接或删除时，立即返回 `false`；
   - 在每次 `execute()` 被调用前，严格断言 Pin 状态；若检测到任何篡改或替换，立即拒绝执行并抛出明确错误（`Workspace command executable or configuration was mutated after registration; reassembly required`），强制要求宿主重新装配，绝不盲目放行。

### 4.3 专属开发构建脚本（build-helper.mjs）
在 `packages/coding-tools/native/` 下提供了原生助手的构建与发布脚本：
- **外部目标目录强制要求**：调用方必须显式传入 `--target-dir`（例如 Desktop 宿主 app `userData/native-helper` 目录），脚本严密拒绝仓库或工作区内部目录作为输出目标；
- **系统环境与无旁路**：依赖系统预装的 .NET 8 SDK（`dotnet --version` 核验），不下载外部未知二进制，不使用 PowerShell `ExecutionPolicy Bypass`；
- **轻量编译与验证**：调用 `dotnet publish` 输出紧凑发布版 `WindowsJobProcessHost.exe` 并返回 canonical path，并在测试中通过 probe 验证其原生可执行有效性。

---

## 5. 验证证据与测试记录

### 5.1 coding-tools 单元测试与 Job Object 3 条完整执行路径验证
在 `packages/coding-tools/test/workspace-command.test.mjs` 中执行，验证了合成环境下的完整三态回执：
1. **成功执行路径（Success Path）**：
   - 验证固定命令在 `WindowsJobProcessHost` 下正常运行、返回 `exitCode: 0`、完整输出 `JOB_SUCCESS_MARKER\n`、子进程正常退出且无任何残留进程；
2. **取消中断路径（Abort Path）**：
   - 验证 Node 派生孙进程进入长期循环并记录 PID，随后通过 `AbortController` 取消执行，工具返回 `CANCELLED`，并通过轮询 `process.kill(grandchildPid, 0)` 确认 Windows 内核 Job Object 已将孙进程彻底杀灭（返回 `ESRCH`）；
3. **超时截止路径（Timeout Path）**：
   - 验证当工具到达 `deadline` 时触发超时机制，工具返回 `TIMEOUT`（或保守 `RESULT_UNKNOWN`），随后通过轮询确认孙进程已被内核 Job Object 灭活（返回 `ESRCH`）；
4. **环境变量与凭据隔离**：
   - 验证环境变量格式校验、敏感词（`GITHUB_TOKEN`, `API_KEY`, `USER_AUTH_DATA` 等）拦截；
   - 验证环境变量合并与外部进程私有变量防泄漏隔离。

运行结果：
```powershell
node --test packages/coding-tools/test/workspace-command.test.mjs
# 7 tests, 7 pass, 0 fail (耗时 ~1.3s).
```

### 5.2 Desktop 配方工具与门禁测试
在 `apps/desktop/test/workspace-command-recipes.test.mjs` 中执行：
- 验证缺省关闭（`allowProjectScripts: false`）时不暴露 npm 配方；
- 验证缺 helper、缺 npmCli、缺 package.json、缺 node_modules 各自的 Fail Closed 诊断记录；
- 验证 `inferNpmCliFromNodeExecutable` 在未显式传 npmCliPath 时自动安全推导；
- 验证 5 项条件全部满足时，正确生成并暴露 `npm-build` 与 `npm-test` 配方；
- 验证生成配方的参数结构（`--cwd`, `--exe`, `--`, `npm-cli.js`, `run`, `build`）；
- 验证安全环境变量白名单过滤与敏感 token 阻断；
- 验证 helper 与 npmCli 位于工作区内时的逃逸拦截报错；
- **防符号链接逃逸验证**：
  - 验证 `package.json` 为指向外部文件的符号链接时，严密拦截并不予读取（`package_json_invalid: package.json must not be a symbolic link`）；
  - 验证 `node_modules` 为指向外部目录的符号链接/junction 时，拒绝算作有效依赖（`dependencies_missing`）；
- **动态 Pinning 篡改拦截验证**：
  - 验证修改 `package.json` 内容后，`available()` 立即返回 `false`，`execute()` 拒绝并报错；内容恢复后状态复原；
  - 验证修改 `jobHelperExecutable` 内容后，`available()` 立即返回 `false`，`execute()` 拒绝并报错；内容恢复后状态复原；
  - 验证删除 `node_modules` 后，`available()` 立即返回 `false`，`execute()` 拒绝并报错；
- **Native Helper 构建脚本验证**：
  - 验证 `buildNativeHelper` 拒绝仓库内部目标目录；
  - 验证编译至外部临时目录成功，产物存在且可通过参数探测正常执行。

运行结果：
```powershell
node --test apps/desktop/test/workspace-command-recipes.test.mjs
# 8 tests, 8 pass, 0 fail (耗时 ~1.6s).
```

### 5.3 语法与类型校验
```powershell
node --check apps/desktop/electron/workspace-command-recipes.js
node --check apps/desktop/test/workspace-command-recipes.test.mjs
node --check packages/coding-tools/native/build-helper.mjs
npm run build --workspace=@personal-agent/coding-tools
npm run typecheck --workspace=@personal-agent/coding-tools
git diff --check
```
全部通过，无报错，无空格违规。

---

## 6. 架构边界、真实限制与后续接线说明

1. **组合与接线边界**：
   本包仅交付 Desktop Main 侧的纯逻辑与构造 helper，**不自动在 UI 勾选、不直接修改 `main.js` 或 `workspace-config-host.js`**。
   Root 可在后续集成工作包中将 UI 复选框、Runtime 审批流及 Policy 授权消费与之安全串联。
2. **零凭据与零外部上传**：
   本 helper 不生成、不存储、不外发任何凭据；执行结果严格保留在本地，不自动上传云端。
3. **真实限制（必须明确区分）**：
   - **合成证明 vs 真实 npm 未验**：当前的进程树杀灭和成功回执是在受控的合成脚本（Node 衍生孙进程）下验证的内核级 Job Object 行为；**尚未在真实的大型复杂 npm 项目（含原生 C++ 扩展、嵌套打包工具等）中进行端到端全链路真实执行验证**；
   - **产品能力状态**：在产品端和公开接口目录中，命令执行能力严格维持 `unavailable`。
