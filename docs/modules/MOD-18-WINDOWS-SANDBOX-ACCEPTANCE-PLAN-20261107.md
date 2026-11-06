---
id: windows-sandbox-acceptance-plan
title: MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107：Windows 原生沙箱（windows-psec）真机验收离线规划与契约校验
status: unavailable
closedLoop: false
requiredEnvironments:
  - windows_real_machine
reason: 待真机验收
---

# MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107：Windows 原生沙箱（windows-psec）真机验收离线规划与契约校验

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`；MOD-18、PA-018；负责人 `zemeng`。
- 状态：`in_progress`（完成 Windows 原生沙箱 windows-psec 真机验收离线规划与证据校验纯函数 helper；真机辅助进程执行、AppContainer/JobObject 约束及网络拦截仍维持待验收，严禁假成功）。
- 代码边界：`packages/coding-tools/src/windows-sandbox-acceptance-plan.ts`，测试 `packages/coding-tools/test/windows-sandbox-acceptance-plan.test.mjs`，由 `packages/coding-tools/src/index.ts` 最小导出。
- 契约依据：`packages/coding-tools/src/native-sandbox.ts`、`packages/coding-tools/src/windows-native-sandbox.ts`、`packages/coding-tools/ACCEPTANCE-20261025.md`。#583 已有 ArtifactService 与 planWindowsRecoveryArtifact（本 PR 不修改 artifact-service，专注于沙箱真机验收规划门控）。

---

## 1. 交付目标与背景

MOD-18 负责受限编程工具与 Windows 原生沙箱执行（`windows-psec` 后端，对应 `workspace.run_allowed_command`）。其核心安全架构依赖六项关键门控：
1. **Helper 身份与完整性验签（`helper_attestation`）**：必须使用固定、不可篡改的 `WindowsJobProcessHost.exe` 辅助进程，及其配套依赖（`WindowsJobProcessHost.dll`、`WindowsJobProcessHost.deps.json`、`WindowsJobProcessHost.runtimeconfig.json`）的固定 SHA-256 签名，禁止任意外部或模型可写路径替换；
2. **PSEC AppContainer 边界约束（`psec_appcontainer_boundary`）**：非 full-access 模式下，必须以 Windows AppContainer 低特权隔离令牌启动目标进程，后端严格为 `windows-psec` 且 `enforced === true`；
3. **JobObject 容器与进程生命周期（`job_object_containment`）**：目标进程及其衍生子进程均被纳入受限 Windows JobObject 容器，超时、取消或协议违例时由 helper 受信全部终止（`stopped === true`）；
4. **文件系统只读/可写根与 Reparse 目录拦截（`filesystem_isolation`）**：严格隔离模型可读根与可写根，在创建前与启动前均对所有祖先目录核验非符号链接/Junction 重解析点，运行时符号链接逃逸严格拒绝；
5. **网络 Deny 策略门禁（`network_deny_guard`）**：默认受限模式强制 `network.mode === 'deny'`，AppContainer 内禁止建立任何本地与出站套接字网络连接；
6. **Policy 绑定与单次授权校验（`policy_binding`）**：通过 `assertCurrent` 动态核对租约与任务/runId/授权引用，一次性授权严格消费，绑定参数 SHA-256 摘要与截止时间，防范重放与参数篡改。

在离线 CI 或非 Windows（如 Linux/macOS）开发环境中，不能伪造实机执行证据或冒充真机闭环。为此，本工作包提供离线验收规划与真机证据校验纯函数 helper：
- 校验真机证据的严格数据结构（平台 win32、windows-psec 后端、enforced 约束、helper 身份 Pin、有效 outcome 与生命周期）；
- 在非 win32 平台、辅助进程不可用、缺少真实物理执行证据或存在 mock 标记时，强制执行 fail-closed 门控：`closedLoop: false`、`status: 'unavailable'`、`reason: '待真机验收'`，严禁假成功；
- 离线规划器不启动真实辅助进程、不发起任何网络连接。

---

## 2. 核心 Helper 规范与门控设计

### 2.1 证据形状校验：`assertWindowsSandboxEvidence(value)`

`assertWindowsSandboxEvidence` 是运行在客户端/宿主端的严格形状校验函数。任何被声称作为真机验收依据的对象必须满足以下全部条件，否则抛出 `ProtocolError('INVALID_ARGUMENT')`：
1. **对象类型**：必须是非 null 对象，不可为数组或原始类型；
2. **平台强制**：`platform` 必须严格为 `'win32'`，非 Windows 平台一律拒绝；
3. **后端限定**：`backend` 必须严格为 `'windows-psec'`；
4. **强制生效**：`enforced` 必须为 boolean 且严格为 `true`（受限执行路径必须真正由 OS 边界强制）；
5. **生命周期有效性**：`outcome` 必须为合法状态（`'exited' | 'cancelled' | 'timeout' | 'unknown' | 'unavailable'`），`executionStarted` 与 `stopped` 必须为 boolean；
6. **严禁 Mock 污染**：凡携带 `mock: true`、`isMock: true`、`synthetic: true` 或 `evidenceLevel: 'mock'` 的证据直接拒绝，防止测试桩冒充真机证据；
7. **Helper 身份固定**：
   - `helperPath` 必须指向 `WindowsJobProcessHost.exe`；
   - `helperSha256` 必须为 64 位十六进制 SHA-256 摘要；
   - `helperFilesSha256` 必须包含 `WindowsJobProcessHost.dll`、`WindowsJobProcessHost.deps.json` 与 `WindowsJobProcessHost.runtimeconfig.json` 三项关键文件的 64 位十六进制 SHA-256 摘要；
8. **标识与摘要规范**：若包含 `argumentsDigest` 须为 64 位十六进制摘要；`taskId`、`runId`、`sandboxRef`、`authorizationRef`、`evidenceRef`、`targetRef` 若提供均须为非空有效字符串。

配套导出类型谓词：`isWindowsSandboxEvidence(value): value is WindowsSandboxEvidence`。

### 2.2 离线验收规划：`planWindowsSandboxAcceptance(options?)`

`planWindowsSandboxAcceptance` 评估当前调用环境与提供的证据，计算验收闭环状态：
- **Fail-Closed 默认门控**：
  - 若运行平台（`options.platform ?? process.platform`）不为 `'win32'`；
  - 或辅助进程不可用（`options.helperAvailable === false` 或 `helperPath` 不匹配 `WindowsJobProcessHost.exe`）；
  - 或未提供 `evidence` 或 `hasRealMachineEvidence !== true`；
  - 或配置或证据中标记了 `mock === true` / `isMock === true` / `synthetic === true` / `evidenceLevel === 'mock'`；
  - **结果严格返回**：
    ```json
    {
      "closedLoop": false,
      "status": "unavailable",
      "reason": "待真机验收",
      "pending": [
        "helper_attestation",
        "psec_appcontainer_boundary",
        "job_object_containment",
        "filesystem_isolation",
        "network_deny_guard",
        "policy_binding"
      ]
    }
    ```
- **禁止假成功（Prohibit Fake Success）**：
  - 调用方即使在参数中传入 `{ closedLoop: true }`，若缺少真机六项门控凭据或处于 Linux/mock 模式，该标志被严格忽略/覆盖，决不输出虚假成功；
- **六项门控完整性判定**：
  只有当平台为 `'win32'`、`hasRealMachineEvidence === true`、`helperAvailable !== false`、无 mock 且 `assertWindowsSandboxEvidence` 校验通过，并且以下 6 项门控全部达成时，才输出 `closedLoop: true`、`status: 'verified'`：
  1. `helper_attestation`：辅助进程可信身份与文件 SHA-256 Pin 核验通过；
  2. `psec_appcontainer_boundary`：AppContainer 隔离生效且 `enforced === true`；
  3. `job_object_containment`：JobObject 容器锁定且子孙进程均随 helper 终止（`stopped === true`）；
  4. `filesystem_isolation`：读写根受限、副作用可控（`sideEffects: 'none' | 'possible'`）且符号链接逃逸受阻；
  5. `network_deny_guard`：网络连接在沙箱内部被内核拦截拒绝；
  6. `policy_binding`：参数绑定、任务引用及单次授权已被确实验证。

## 验收步骤

1. helper_attestation：辅助进程可信身份与文件 SHA-256 Pin 核验通过
2. psec_appcontainer_boundary：AppContainer 隔离生效且 enforced === true
3. job_object_containment：JobObject 容器锁定且子孙进程均随 helper 终止（stopped === true）
4. filesystem_isolation：读写根受限、副作用可控且符号链接逃逸受阻
5. network_deny_guard：网络连接在沙箱内部被内核拦截拒绝
6. policy_binding：参数绑定、任务引用及单次授权已被确实验证

## 证据要求

1. win32 平台 windows-psec 原生沙箱执行回执（含 helperPath、helperSha256、helperFilesSha256、enforced=true 与 outcome）
2. 辅助进程隔离审计日志与文件系统/网络内核级拦截读回证据

## 挂起项

- `helper_attestation`: 辅助进程可信身份与文件 SHA-256 Pin 核验通过
- `psec_appcontainer_boundary`: AppContainer 隔离生效且 enforced === true
- `job_object_containment`: JobObject 容器锁定且子孙进程均随 helper 终止
- `filesystem_isolation`: 读写根受限、副作用可控且符号链接逃逸受阻
- `network_deny_guard`: 网络连接在沙箱内部被内核拦截拒绝
- `policy_binding`: 参数绑定、任务引用及单次授权已被确实验证

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `windows-sandbox-acceptance-plan` | `packages/coding-tools/src/windows-sandbox-acceptance-plan.ts` | 代码 `PLAN_ID`；§1: `MOD-18 负责受限编程工具与 Windows 原生沙箱执行` |
| title | `MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107：Windows 原生沙箱（windows-psec）真机验收离线规划与契约校验` | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | L1: `# MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107：Windows 原生沙箱（windows-psec）真机验收离线规划与契约校验` |
| status | `unavailable` | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §1: `status: 'unavailable'`；§2.2: `status: "unavailable"` |
| closedLoop | `false` | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §1: `强制执行 fail-closed 门控：closedLoop: false`；代码 L347 |
| requiredEnvironments | `['windows_real_machine']` | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §1: `MOD-18 负责受限编程工具与 Windows 原生沙箱执行`；§2.1: `平台强制：platform 必须严格为 win32` |
| acceptanceSteps | 6 项完整步骤 | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §2.2: 六项门控完整性判定（helper, psec, job, fs, net, policy） |
| evidenceRequirements | 2 项证据要求 | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §2.1: `assertWindowsSandboxEvidence` 校验条件；§1: 辅助进程隔离审计日志与读回 |
| reason / pendingItems | `待真机验收` | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | §1: `reason: '待真机验收'`；§2.2: `WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON` |

---

## 3. 架构边界与修改范围

1. **最小导出**：
   - 仅在 `packages/coding-tools/src/index.ts` 导出 `windows-sandbox-acceptance-plan.js` 的核心函数与类型；
   - 不改变已有的 `windows-native-sandbox.ts`、`native-sandbox-probe.ts`、`command.ts` 等执行逻辑。
2. **零越界保证**：
   - 禁止修改 `apps/desktop`（Electron 宿主保持原样）；
   - 禁止修改 `apps/runtime`（Runtime Application 保持原样）；
   - 禁止修改 `packages/connectors/**`（连接器保持原样）；
   - 禁止修改 `artifact-service.ts`（#583 工作包由其独立维护，本 PR 绝不改动）；
   - 禁止修改根目录 `package.json` 或锁文件；
   - 避开任何 ZCode 清单或分支文件。
3. **模块状态**：
   - MOD-18 状态继续维持 `in_progress`；
   - 离线规划 helper 通过测试不代表物理真机验收已完成；实机测试需在 Windows 真机普通用户会话下执行真实 `WindowsJobProcessHost.exe` 与探针脚本。

---

## 4. 本地验证记录

| 验证项 | 执行命令 | 结果 |
| --- | --- | --- |
| 模块构建 | `npm run build --workspace=@personal-agent/coding-tools` | 退出码 0，tsc 编译通过 |
| 独立单元测试 | `node --test packages/coding-tools/test/windows-sandbox-acceptance-plan.test.mjs` | 17/17 通过 |
| 模块全量测试 | `npm test --workspace=@personal-agent/coding-tools` | 335/335（307 pass / 28 Windows skip / 0 fail） |
| 架构约束检查 | `npm run check:architecture` | 3/3 通过 |
| Git 格式检查 | `git diff --check` | 0 格式警告/冲突 |
