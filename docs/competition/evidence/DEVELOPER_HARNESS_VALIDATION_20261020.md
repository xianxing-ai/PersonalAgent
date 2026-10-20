# Developer Harness 统一验证记录（2026-10-20）

状态：`in_progress`。2026-10-20 15:34 UTC 按用户关机前立即移交的要求，已用 Ctrl-C 停止本轮隔离测试进程；不再启动测试、探针或构建。完整工程检查尚未完成，没有单次根 `npm run check` exit 0。

## 范围与环境

- 目标 profile：`huawei_ict_agentarts`；本轮为本地工程检查及显式 Fake/隔离夹具验证，不构成真实 AgentArts、模型、工具、设备或发布验收。
- 整合 PR：[#451](https://github.com/zemeng5208/PersonalAgent/pull/451)，分支 `codex/developer-harness`。
- 工作树：`D:\worktree\24cd\PersonalAgent\.worktrees\developer-harness`。
- PowerShell：`C:\Program Files\PowerShell\7\pwsh.exe`，执行工具使用 `login:false`。
- Node：`D:\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64\node.exe`，实际版本 `v24.15.0`。
- npm CLI：`D:\PersonalAgent\.cache\toolchains\npm-11.12.0\node_modules\npm\bin\npm-cli.js`，实际版本 `11.12.0`。
- 验证进程串行使用唯一重型槽；未改产品代码、测试断言、锁文件或全局环境。

根检查使用现有 `npm run check`：架构门禁 → 契约夹具 → 生成类型一致性 → `typecheck`（包含完整 build）→ workspace tests → 根 integration tests。

最终固定验证源码为 `5542972e47babab66601d8ea56477a66b71c00bf`，tree 为 `980cd802e906bd82779785984ac413a80c724c57`。本轮开始及停止读回均一致；测试期间未合并、修改产品或改变索引。下述结果只绑定此源码，后续修复需要重新记录提交及相应验证。

## 执行记录

| 轮次 | 源码 SHA | UTC 起止 | 结果与首个失败 |
| --- | --- | --- | --- |
| 1 | `af4a7b5d72ec1932d505c89882ab1b6fbcf47f62` | 14:01:55–14:03:03 | exit 1；build 到 `@personal-agent/agentarts` 的嵌套 `build:observability` 时，cmd 无法查找 `node`。为执行环境失败，完整检查未通过。 |
| 2 | `af4a7b5d72ec1932d505c89882ab1b6fbcf47f62` | 14:06:13–14:07:32 | exit 1；已通过上述环境故障点；`apps/runtime/src/application/runtime-application.ts:767:45` 报 TS2345：`AgentToolInvocation.arguments: unknown` 不满足调用方要求的 `Record<string, unknown>`。交 Runtime 原负责人修复。 |
| 3 | `5542972e47babab66601d8ea56477a66b71c00bf` | 以 `check-5542972e-03.json` 为准 | 架构 3/3、契约夹具 4/4、生成类型一致性、完整 build 和 workspace typecheck 均通过；测试在沙箱临时目录发生 `realpathSync.native` EPERM，并停在 knowledge TLS 组，获协调者授权 Ctrl-C 中止；integration 未运行。 |
| 3 的测试阶段续跑 | 同上，源码/tree 未变 | 15:24:16–15:34:08 | 最小权限升级后执行 `npm run test --workspaces`；最后运行到 Runtime workspace，尚无 workspace aggregate 退出码时，按用户关机移交要求 Ctrl-C 停止（session exit 1）；integration 未运行。已知 6 个 distinct 失败，见下表。 |

两轮开始与结束 SHA 一致。两轮均已通过架构 3/3、契约夹具 4/4 与生成类型一致性检查；第 2 轮在 Runtime build 处停止，尚未进入完整 workspace typecheck、workspace tests 与 integration tests。

第 3 轮已验证原 Runtime 类型失败被修复。完整 build/typecheck 无须仅因测试环境调整重复执行；最终 Runtime 测试与 integration 仍须完成，不能将部分测试通过视为整链通过。

### 第 1 轮环境原因与最小探针

继承 PATH 为 6118 字符。只追加正确 Node/npm 目录仍不能防止 npm 多层调用不断增加祖先 `.bin` 目录。隔离的 5 层 npm 探针在第 3 层记录 PATH 为 8310 字符，此时 cmd 的 `node --version` 返回 `not recognized`，下一层 npm 亦无法查找；这与第 1 轮错误一致。

后续仅规范化验证子进程的 PATH：将 Node 24/npm 11.12 置顶，保留每个实际存在的继承目录，移除重复与不存在的目录。初始 PATH 降为 2127 字符；相同 5 层探针均解析为 `v24.15.0`，最深 PATH 为 5577 字符，exit 0。没有修改系统/用户 PATH、仓库 npm 脚本或锁文件。第 2 轮采用此环境。

### 第 3 轮沙箱与 TEMP 定位

原沙箱的 `C:\Users\24035\AppData\Local\Packages\sandbox.*\AC\Temp` 夹具在 `fs.realpathSync.native` 处报 EPERM。将本测试进程的 TEMP/TMP 指向本树被忽略的 `.cache/harness-validation/tmp-5542972e` 后，同一最小探针的 Git init/HEAD 写读、loopback bind/close 均通过，但 native realpath 仍 EPERM。通过平台 exact 最小权限升级重跑，四项均通过；这是沙箱差异，未修改产品边界。

同一升级环境下，原 `packages/coding-tools/test/git-tools.test.mjs` 全文件 30/30 通过；knowledge 原失败 TLS 两单例 2/2 通过。随后续跑 workspace tests。

本树内 TEMP 又与“helper/recovery 必须在 repositoryRoot 外”的真实保护发生冲突，已确定影响下表三个例。没有为此放宽生产保护。计划中的 repositoryRoot 外唯一任务 TEMP 复验尚未执行，因用户要求立即保存并关机移交而停止。

## 停止时的测试与失败快照

Desktop workspace 实际汇总为 1496 tests、1485 pass、4 fail、7 配置 skip；skip 不计通过。其余已完成 workspace 的输出保留在日志，当前不能声明所有 workspace 完成。停止时最后 workspace 是 `@personal-agent/runtime`，最近通过原测试 `confirmed original tool results survive restart and continue without another invocation or grant`（120110.655ms），随后 `unknown original execution refuses both Runtime gate and Application restart; no tool or task is retried` 通过；Runtime 最终汇总尚未输出。

| 原测试位置 | distinct 失败 | 已确认事实及恢复边界 |
| --- | --- | --- |
| `packages/coding-tools/test/workspace-patch-apply.test.mjs:54` | repository-root workspace keeps default helper isolation and accepts explicit external bundled helper | 59 行抛 `Patch apply host paths must be distinct trusted locations`；测试把 helper/recovery 放在当前 repo 内 TEMP，生产拒绝正确。先用 repo 外 TEMP 复验。 |
| `packages/knowledge/test/write.test.mjs:174` | a user edit between reconciliation reads returns unknown and retains both durable markers | 186 行抛 `RESULT_UNKNOWN: Workspace patch helper identity checker is unavailable`；调用 `coding-tools/dist/patch-reconcile.js:314` → `knowledge/dist/write.js:283`。须在 repo 外 TEMP exact 复验后交原调用方 owner，不能填 noop checker。 |
| `apps/desktop/test/coding-tool-host.test.mjs:45` | repository-root Desktop host accepts only an external byte-identical bundled helper | 因 repo 内 TEMP 先触发 `Coding host paths must be separate from the workspace and recovery root`，与期望下游错误不同。先用 repo 外 TEMP 复验。 |
| `apps/desktop/test/panel-task-progress.test.mjs:82` | a failed progress get preserves same-batch terminal events and cancellation approval cleanup | 106 行 expected `cancelled`，actual `waiting_approval`；无权限错误，尚未 exact 复验，由 Desktop owner 继续定位。 |
| `apps/desktop/test/panel-task-refresh-order.test.mjs:49` | a delayed public task.get cannot revive a task cancelled through the actual panel route | 76 行 VM 抽取的 `applyEvent` 抛 `ReferenceError: harnessEventsHost is not defined`（evalmachine:19）。须补完整原调用方/夹具接线，不删除生产 H6 hook。 |
| `apps/desktop/test/workspace-command-recipes.test.mjs:604` | buildNativeHelper compiles WindowsJobProcessHost to external directory and rejects repo-internal targets | 617 行因目标目录在 repositoryRoot 内被正确拒绝；先用 repo 外 TEMP 复验。 |

协调者转交的固定 `5542972e` 只读复核意见确认：受控依赖准备和已 published 原缓存路径、active 经验完成汇报双重门禁的两处既有 P1 源码条件已补齐；该意见有其限定范围，不计为本人的测试通过、正式非作者 Approve 或真实云/设备验收。

## 本地日志

完整 stdout/stderr 与时间、SHA、工具链、退出码 JSON 保存在工作树被忽略的 `.cache/harness-validation/`，不提交缓存或环境文件。

| 文件 | SHA-256 |
| --- | --- |
| `check-af4a7b5d-01.log` | `96584231d4ad0606bc5c50cd80c4f2998e5b0effde1693a38ddf408d8079c7cd` |
| `check-af4a7b5d-02.log` | `a3113894989d3878f172b4aec454a1271de1281988c87013bcfe458eb0146404` |
| `path-probe-inherited.log` | `8bcdb95e68f689dd842913fb00af6834af5bbf673cbbca7fb682b3009cc88496` |
| `path-probe-normalized.log` | `609b29dc9c178c8cbc53cee537001c98b6d744d154db2bf01c3308a1ed654ba5` |
| `check-5542972e-03.log` | `431dc05991ff4b4f31cbd08ba098a586d6a251397037d0b08958fe5972077cf7` |
| `workspaces-5542972e-resumed.log` | `ef39c44b9d037eabad87827047f175393d6c23479cc624bc0b052615737aff52` |
| `environment-probe-5542972e.log` | `7bd730b3c3af60503fdbe4ff11c52c496fe5038b7fddaac4a07093b6baacd20c` |
| `environment-probe-5542972e-elevated.log` | `95e6672be0214df1b3ef728b722f917954bb9f8625730725a2e3717bcb845962` |
| `git-tools-5542972e-elevated.log` | `2815e0d22b0cadf5cace4a0e0d5036dcde60d4a6a2f961fd67ba8eac16452d83` |
| `knowledge-bridge-targeted-5542972e-elevated.log` | `5469c6c00ab760b062b9d55a2e6852d3523e55535b4433dfc4361150f771f308` |

## 尚待执行与证据边界

- 在 repositoryRoot 外的系统临时目录中新建唯一 `pa-harness-5542972e-*` 本任务目录，只给验证子进程设置 TEMP/TMP，回读确认不在本测试 repositoryRoot 内；不要删除他人临时目录或用户文件。
- 保留上述 PATH 规范化、Node/npm 版本与平台 exact 最小权限机制。先 exact 复验六个失败，再按原 owner 定位真实缺陷；不能改断言、跳过或增加 noop 授权以造绿。
- 最小恢复入口（此处仅记录，关机移交时未执行）：`node npm-cli.js run test --workspace=@personal-agent/coding-tools`；knowledge 的失败例用原 `--import ./test/bridge-process-diagnostics.mjs --test --test-concurrency=1 --test-name-pattern 'a user edit between reconciliation reads' test/write.test.mjs`；Desktop 按表内原文件/name exact 复验。已通过部分无需无理由重复。
- Runtime workspace 尚未完整结束，恢复命令为 `node npm-cli.js run test --workspace=@personal-agent/runtime`。所有失败及未完成部分覆盖通过后，再运行 `node npm-cli.js run test:integration`；原 aggregate 失败/中断记录继续保留。若源码发生变化，重新冻结并选择受影响的必要检查。
- Desktop 实际渲染与必要窗口/桥接/Runtime 组合冒烟由 Desktop 负责人在根检查重型槽释放后执行；当前未执行。
- 当前工作树的 Electron `dist/electron.exe` 尚未提供；后续是否需要补齐由实际 UI 验证决定。
- 未操作真实账号、麦克风、系统登录项、用户数据库、付费模型、AgentArts 部署/API、实体设备或安装/打包流程。
- 本记录不证明 PR 已获独立批准、技术 CI 通过、已合并或已发布。
