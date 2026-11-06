# MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107：Windows 记事本真机验收离线规划与契约校验

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`；MOD-16、PA-016；负责人 `zemeng`。
- 状态：`in_progress`（完成 Windows 记事本真机验收离线规划与证据校验纯函数 helper；真机 F9 确认、UIA 写入与物理独立读回仍维持待验收，严禁假成功）。
- 代码边界：`packages/windows-client/src/notepad-live-acceptance-plan.ts`，测试 `packages/windows-client/test/notepad-live-acceptance-plan.test.mjs`，由 `packages/windows-client/src/index.ts` 最小导出。
- 契约依据：`packages/contracts/src/windows-host.ts`（只读）、`tests/manual/windows/notepad-full-access-acceptance.mjs`。#586 已有跨平台契约校验测试（不复制、不改写其 validator，专注于真机验收规划门控）。

---

## 1. 交付目标与背景

MOD-16 负责 Windows 本地受限记事本执行（`computer.notepad.replace_text` / `notepad.replace_text`）。其核心安全架构依赖三项关键门控：
1. **F9 确认门控**：在操作实际 Windows 窗口前，必须获得操作者物理 F9 按键或受信本地确认，防止模型自主越权写入；
2. **UIA 写入**：由独立 WindowsHost 经 UI Automation（UIA ValuePattern）对前台单一已确认记事本编辑控件执行文本替换；
3. **独立读回**：写入完成后，必须脱离单纯的 `SetValue` 动作返回值，通过独立的 UIA 读取和受信日志（Isolated Journal）对实际文字内容计算 SHA-256 摘要核对，确认为 `verified`。

在离线 CI 或非 Windows（如 Linux/macOS）开发环境中，不能伪造实机执行证据或冒充真机闭环。为此，本工作包提供离线验收规划与真机证据校验纯函数 helper：
- 校验真机证据的严格数据结构（平台 win32、能力声明、确认门控、独立读回摘要与运行标识）；
- 在非 win32 平台、缺少真实物理执行证据或存在 mock 标记时，强制执行 fail-closed 门控：`closedLoop: false`、`status: 'unavailable'`、`reason: '待真机验收'`，严禁假成功。

---

## 2. 核心 Helper 规范与门控设计

### 2.1 证据形状校验：`assertNotepadLiveEvidence(value)`

`assertNotepadLiveEvidence` 是运行在客户端的严格形状校验函数。任何被声称作为真机验收依据的对象必须满足以下全部条件，否则抛出 `ProtocolError('INVALID_ARGUMENT')`：
1. **对象类型**：必须是非 null 对象，不可为数组或原始类型；
2. **平台强制**：`platform` 必须严格为 `'win32'`，非 Windows 平台一律拒绝；
3. **能力限定**：`capability` 必须严格为 `'notepad.replace_text'` 或 `'computer.notepad.replace_text'`；
4. **F9 确认门控**：`confirmationGate` 必须为有效对象，且 `confirmed` 必须严格为 `true`（支持携带 `confirmedAt` ISO 时间戳、`source` 及 `gate` 标识）；
5. **独立读回摘要**：必须包含非空的 `readbackSummary`（字符串或包含 `readbackDigest` 的对象）或 `readbackDigest`（SHA-256 摘要）；
6. **严禁 Mock 污染**：凡携带 `mock: true`、`isMock: true` 或 `evidenceLevel: 'mock'` 的证据直接拒绝，防止测试桩冒充真机证据；
7. **标识规范**：若包含 `source` 须为非空字符串（推荐 `'windows-uia'`），`targetRef`、`taskId`、`runId`、`evidenceRef` 均须为非空有效字符串。

配套导出类型谓词：`isNotepadLiveEvidence(value): value is NotepadLiveEvidence`。

### 2.2 离线验收规划：`planNotepadLiveAcceptance(options?)`

`planNotepadLiveAcceptance` 评估当前调用环境与提供的证据，计算验收闭环状态：
- **Fail-Closed 默认门控**：
  - 若运行平台（`options.platform ?? process.platform`）不为 `'win32'`；
  - 或未提供 `evidence` 或 `hasRealMachineEvidence !== true`；
  - 或配置或证据中标记了 `mock === true` / `isMock === true` / `evidenceLevel === 'mock'`；
  - **结果严格返回**：
    ```json
    {
      "closedLoop": false,
      "status": "unavailable",
      "reason": "待真机验收",
      "pending": [
        "f9_confirmation_gate",
        "uia_write",
        "independent_readback",
        "policy_authorization",
        "windows_host_pipe"
      ]
    }
    ```
- **禁止假成功（Prohibit Fake Success）**：
  - 调用方即使在参数中传入 `{ closedLoop: true }`，若缺少真机五项门控凭据或处于 Linux/mock 模式，该标志被严格忽略/覆盖，决不输出虚假成功；
- **五项门控完整性判定**：
  只有当平台为 `'win32'`、`hasRealMachineEvidence === true`、无 mock 且 `assertNotepadLiveEvidence` 校验通过，并且以下 5 项门控全部达成时，才输出 `closedLoop: true`、`status: 'verified'`：
  1. `f9_confirmation_gate`：`confirmationGate.confirmed === true`；
  2. `uia_write`：`source === 'windows-uia'` 或 `uiaWriteVerified === true`；
  3. `independent_readback`：具备独立读回摘要且 `nativeReadbackVerified === true`；
  4. `policy_authorization`：`exactGrantConsumed === true` 或 `policyDecision === 'allow'`；
  5. `windows_host_pipe`：`isolatedJournalReadback === true` 或 `pipeVerified === true`。

---

## 3. 架构边界与修改范围

1. **最小导出**：
   - 仅在 `packages/windows-client/src/index.ts` 导出 `export * from './notepad-live-acceptance-plan.js';`；
   - 不改变已有的 `computer.system.observe`、桌面控制、原生通信逻辑。
2. **零越界保证**：
   - 禁止修改 `apps/desktop`（Electron 宿主保持原样）；
   - 禁止修改 `apps/runtime`（Runtime Application 保持原样）；
   - 禁止修改 `apps/windows-host`（C# Host / PipeBridge 源码保持原样）；
   - 禁止修改 `packages/connectors/**`（连接器保持原样）；
   - 禁止修改 `packages/contracts/` 及 #586 所引入的测试；
   - 禁止修改根目录 `package.json` 或锁文件。
3. **模块状态**：
   - MOD-16 状态继续维持 `in_progress`；
   - 离线规划 helper 通过测试不代表物理真机验收已完成；实机测试需在真机环境执行 `tests/manual/windows/notepad-full-access-acceptance.mjs`。

---

## 4. 本地验证记录

| 验证项 | 执行命令 | 结果 |
| --- | --- | --- |
| 模块构建 | `npm run build --workspace=@personal-agent/windows-client` | 退出码 0，tsc 编译通过 |
| 独立单元测试 | `node --test packages/windows-client/test/notepad-live-acceptance-plan.test.mjs` | 14/14 通过 |
| 模块全量测试 | `npm run test --workspace=@personal-agent/windows-client` | 72/72 通过（包含既有 58 项 + 新增 14 项） |
| 架构约束检查 | `npm run check:architecture` | 3/3 通过 |
| Git 格式检查 | `git diff --check` | 0 格式警告/冲突 |
