# MOD-16-F9-UIA-READBACK-CONTRACTS-20261107：Windows 记事本 F9 确认、UIA 写入与独立读回契约验证

<!-- current-design-20261015 -->
> 当前设计与协作入口：[当前详细设计](../design/CURRENT_DESIGN_20261015.md) · [28项状态](../design/WORKFLOW_STATUS_20261015.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [协作与评审规则](../../CONTRIBUTING.md)。

- 目标 Profile：`huawei_ict_agentarts`（比赛主路径，Local 保留为可选 baseline）。
- 模块与需求：MOD-16 / PA-016；负责人 `zemeng`，非作者评审 `goo122`。
- 工作树与分支：`/workspace/mod16-contracts`（独立 worktree），分支 `zemeng/mod16-f9-uia-readback-contracts`，基于最新 `origin/main`（已含 #576）。
- 变更范围：`packages/contracts/src/windows-host.ts`、`packages/contracts/test/windows-host-f9-uia-readback.test.mjs`、`docs/ROADMAP.md`、本文档；不修改 `apps/runtime`、Policy、`apps/desktop/src` Renderer、Electron main 组合、`packages/connectors`、MOD-10；不碰 ZCode 分支/PR；不重复 #555（RunJournal）与 #560（NotepadTargets portable）已覆盖内容。
- 当前模块状态：`in_progress`（契约与跨平台测试已补齐；完整 F9、真实 UIA、物理读回与授权链**待真机验收**）。

---

## 1. 背景与目标

MOD-16 受限记事本执行（`computer.notepad.replace_text@1.0.0`）是 Windows 本地受限受控写入能力。此前历史验收（#179@c7af939）已取得普通用户 Windows 会话下通过 Win32 NamedPipe Bridge 进行进程身份核验并完成 `hello_ack` 的定向回执。

然而，按照架构安全边界规范（AGENTS.md 第 4、5 条）：
1. **握手到达 `hello_ack` 仅证明进程与管道传输就绪，绝不等于已获得授权或用户已确认**；
2. **执行前必须存在受信用户确认门（如物理 F9 按键或显式前台确认）**，无确认不得进入 `execute`；
3. **真实 UIA 写入必须绑定单一可编辑控件**，并在完成后由独立后置路径重新读回控件实际文本以出具 `verified` 凭证；
4. **`result_unknown` 是关键安全状态**，当进程崩溃、超时或写入后无法核实时，必须保持未知，绝不可伪装为 `verified` 或盲目重试。

本工作包在 `contracts` 侧正式补全针对 F9 确认门控、UIA 写入字段约束、目标过期与 stale 判定、以及独立读回身份绑定的纯逻辑契约测试与纯函数门控约束。所有测试均可在 Linux 及跨平台 CI 纯内存运行，不调用 Windows API，不启动记事本，不窥探任何私人窗口。

---

## 2. 契约覆盖矩阵 (Contract Coverage Matrix)

| 序号 | 契约维度 | 规范定义与断言依据 | 测试用例与验证方式 | 本地执行结果 |
| --- | --- | --- | --- | --- |
| 1 | **握手与会话边界** | `hello_ack` 仅确认对端进程 PID/SID 并交换 nonce，不包含 `targetRef`、`authorizationRef` 或用户确认；未收到 `bind` 不得进入会话；不可跳过 `bind` 直接调用 `observe` 或 `execute` | `test('1. Handshake reaching only hello_ack does NOT equal authorized or confirmed session')`：校验未绑定抛错、nonce/session 漂移拒绝、字段缺省断言 | **PASS** (Linux Node) |
| 2 | **Execute 帧强校验** | 必需包含 13 个关键字段（`taskId`, `runId`, `toolName`, `toolVersion`, `authorizationRef`, `argumentsDigest`, `targetRef`, `deadline`, `expectedText`, `replacementText` 等）；文本长度上限 4096 code units；digest 严格 64 位十六进制 | `test('2. Execute frame strictly validates all mandatory fields and result constraints')`：逐一删除必需字段断言 `fail-closed`，校验非法 digest 与超长文本拒绝 | **PASS** (Linux Node) |
| 3 | **Result 状态不变式** | `state: 'verified'` 必须携带 `evidenceRef` 且严禁包含 `errorCode`；非 verified 状态（`refused`, `cancelled`, `result_unknown`）必须携带规范 `errorCode`；时间序 `finishedAt >= startedAt` | `test('2. Execute frame ... and result constraints')`：验证 verified 缺证/带错拒绝，非 verified 缺错拒绝，时序颠倒拒绝 | **PASS** (Linux Node) |
| 4 | **UIA 目标来源与就绪** | `observed.source` 必须严格为 `'windows-uia'`；`target_ready_result` 在 `ready: true` 时必须携带有效 UTC `expiresAt` 且禁带 `errorCode`；在 `ready: false` 时必须携带 `TARGET_STALE` 或 `TIMEOUT` 且禁带 `expiresAt` | `test('3. observed.source must be windows-uia, and target_ready shapes enforce strict validity')`：测试伪造来源（mock/web/win32）、stale 与 timeout 形状及相关性断言 | **PASS** (Linux Node) |
| 5 | **独立读回与身份绑定** | `status` 查询与终态 `result` 严格与原始 `execute` 的六元组身份绑定（`taskId`, `runId`, `toolName`, `toolVersion`, `argumentsDigest`, `targetRef`）；重连恢复必须在全新会话查询原身份，旧 targetRef 仅作为历史标识；`result_unknown` 不得伪装为 `verified` | `test('4. Independent readback: status/result binds strictly to run identity, and result_unknown cannot masquerade as verified')`：篡改任一元组字段均抛错拒绝；断言 result_unknown 无法携带 evidenceRef | **PASS** (Linux Node) |
| 6 | **F9 / 用户确认门控** | 契约层纯函数 `assertNotepadConfirmationGate` 与复合校验 `validateWindowsHostExecuteConfirmation`：未经确认（`confirmed: false`）直接拒绝（返回 `state: 'refused', errorCode: 'UNAUTHORIZED'` 或抛出协议异常）；确认时间戳与 `targetRef` 必须精确匹配 | `test('5. F9 / User manual confirmation gate: unconfirmed execution is refused with UNAUTHORIZED')`：测试未确认拒绝、时间戳非法拒绝、targetRef 不匹配拒绝、确认通过 | **PASS** (Linux Node) |
| 7 | **沙箱与隐私安全** | JSONL 帧严格小于 1 MiB 上限；帧载荷杜绝泄漏本地密码、凭据与私有窗口标题 | `test('6. Safety & Sandbox: no external UIA, no Notepad process, no private window inspection')`：纯内存对象，无 Windows API 调用，跨平台零外部进程 | **PASS** (Linux Node) |

---

## 3. 契约门控实现说明

在 `@personal-agent/contracts/windows-host`（`packages/contracts/src/windows-host.ts`）中补充导出纯函数门控：

```typescript
export type NotepadConfirmationGateInput = {
  confirmed: boolean;
  source?: string | undefined;
  confirmedAt?: string | undefined;
  targetRef?: string | undefined;
};

export type NotepadConfirmationGateResult =
  | { state: 'confirmed'; allowed: true; source: string; confirmedAt: string; targetRef?: string | undefined }
  | { state: 'refused'; allowed: false; errorCode: 'UNAUTHORIZED'; reason: string; targetRef?: string | undefined };

export function assertNotepadConfirmationGate(input: NotepadConfirmationGateInput): NotepadConfirmationGateResult;

export function validateWindowsHostExecuteConfirmation(
  execute: WindowsHostExecute,
  confirmation: NotepadConfirmationGateInput,
): void;
```

该实现满足以下架构约束：
1. **纯函数约定**：不依赖 Desktop、Runtime 或 Windows API，可在任何平台与测试环境中执行；
2. **默认拒绝 (Fail-Closed)**：凡 `input.confirmed !== true` 或时间戳异常，直接输出 `refused`（错误码 `UNAUTHORIZED`），杜绝因未经确认而流向宿主执行；
3. **目标引用绑定**：确认上下文若指定 `targetRef`，必须与当前 `execute` 帧的目标引用完全一致，杜绝向其他已确认窗口投递写入。

---

## 4. 本地测试与架构门禁结果

在 Linux 工作树环境（`/workspace/mod16-contracts`）运行验证：

```bash
# 1. 契约编译与测试
npm run build --workspace=@personal-agent/contracts
npm test --workspace=@personal-agent/contracts

# 测试输出摘要：
# ✔ 1. Handshake reaching only hello_ack does NOT equal authorized or confirmed session (4.905055ms)
# ✔ 2. Execute frame strictly validates all mandatory fields and result constraints (2.00602ms)
# ✔ 3. observed.source must be windows-uia, and target_ready shapes enforce strict validity (1.029089ms)
# ✔ 4. Independent readback: status/result binds strictly to run identity, and result_unknown cannot masquerade as verified (1.576618ms)
# ✔ 5. F9 / User manual confirmation gate: unconfirmed execution is refused with UNAUTHORIZED (0.545433ms)
# ✔ 6. Safety & Sandbox: no external UIA, no Notepad process, no private window inspection (0.266431ms)
# ✔ portable C# wire fixtures match the parser (5.623567ms)
# ...
# ℹ tests 31
# ℹ pass 31
# ℹ fail 0

# 2. 架构分层门禁检查
npm run check:architecture

# 检查输出：
# ✔ workspace dependencies obey the documented architecture boundaries (65.527808ms)
# ✔ the standard check gates root integration tests after workspace build and tests (0.618187ms)
# ✔ the integration runner serially discovers every root integration test without filtering failures (0.119872ms)
# ℹ tests 3, pass 3, fail 0

# 3. Git 格式检查
git diff --check
# 退出码 0，无任何空白或格式异常
```

---

## 5. 待真机验收清单（绝不宣称通过项）

依据 AGENTS.md 第 1、5 条及用户任务要求，本次提交仅证明契约层模型与纯函数门控在跨平台环境下的逻辑正确性。以下实体环境链路**明确标明为待真机验收**，本 PR 不宣称通过：

| 实体项目 | 当前状态 | 现场真机验收要求 |
| --- | --- | --- |
| **管道握手与 Win32 PID/SID 核验** | **已由历史证据覆盖**（#179@c7af939） | Windows 普通用户会话下 PipeBridge 真实 Win32 PID 核验与反向 SID 核对，已验证通过 `hello_ack` 短链 |
| **F9 物理按键与受信确认捕获** | **待真机验收** | 需在 Windows 前台实体桌面，由人工通过实际 F9 快捷键或受限确认窗核对目标窗口 HWND、PID、预期文本后显式确认 |
| **Windows 11 记事本真实 UIA 树与单标签判定** | **待真机验收** | 需在实际装有 Windows 11 记事本（MSIX 包 `Microsoft.WindowsNotepad_8wekyb3d8bbwe`）的真机上，核验多标签自动拒绝、单一选中标签与唯一 ValuePattern 编辑控件解析 |
| **真实 UIA 文本替换写入与用户键鼠接管** | **待真机验收** | 需在实体机触发受限文本替换，实测键鼠活动触发 `USER_TAKEOVER` 抢占并切断自动输入 |
| **独立物理读回与 Evidence 生成** | **待真机验收** | 需在真实写入完成后，由独立路径从记事本控件读回实际文本，并与 expectedText/replacementText 进行外部比对，生成真实 Evidence |
| **Policy/ToolGateway 授权闭环与重启恢复** | **待真机验收** | 需走通 AgentArts 提案 → 桌面确认 → 一次性授权消费 → Host 执行 → 崩溃/断电重启后通过 SQLite attempts 和 RunJournal 读回未知状态，拒绝重复写入 |

本模块在 ROADMAP 中继续保持 `in_progress`。
