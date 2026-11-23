# MOD-17-OBSERVATION-LOOP-HELPER-20261107：系统观测闭环契约 Helper 与验收规划

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`；负责人 `zemeng`；需求 PA-011。
- 状态：`in_progress`（实现切片与纯函数契约 helper 补齐；真机项标待验收，不宣称模块完成）。
- 代码边界：`packages/windows-client/src/system-observation-loop.ts`，测试 `packages/windows-client/test/system-observation-loop.test.mjs`，从 `packages/windows-client/src/index.ts` 最小导出。
- 既有实现：复用已有的只读提供者 `computer.system.observe@1.0.0`、范围 `computer:system:read`、`createSystemObservationTool` 与 `packages/windows-client/test/system-observation.test.mjs`。

## 1. 交付目标与背景

MOD-17 提供 Windows 本地系统状态只读观测（CPU、内存与 uptime 汇总），已具备 Windows provider 直读历史证据与 Desktop 只读消费入口。为确保后续完整闭环（Policy 授权、AgentArts 提案与回传、Desktop UI 渲染及 Windows 宿主现场）具备可本地自动执行的契约校验，本 PR 补齐「闭环契约纯函数 helper」：
1. 把读回结果形状校验、指标边界、失败语义做成可本地测试运行的纯函数；
2. 明确支持范围与不可用声明，防止失败时虚构零值冒充成功；
3. 设立验收规划 helper `planSystemObservationAcceptance`，在非 Windows 或缺少真机证据时明确标记未闭环与待验项，绝不宣称 Policy/AgentArts/Desktop UI/Windows Provider 真机已通。

## 2. 闭环契约校验规范

### 2.1 严格指标边界与不可观测声明
- **仅支持指标**：仅允许 `cpu`、`memory`、`uptime`（`uptimeSeconds`）。
- **来源限定**：`source` 必须严格为 `'node:os'`（实际系统读取）或 `'injected'`（合成测试探针）。
- **明确不可用指标**：`unavailable` 必须包含且仅包含 `['process_breakdown', 'disk_io', 'thermal', 'network_activity']`。禁止以顶层属性或指标形式返回进程明细、磁盘 I/O、温度或网络吞吐。
- **隐私保护与敏感字段防御**：禁止包含主机名、用户名、进程名、命令行、文件路径、网络地址或凭据等字段。

### 2.2 失败语义与防虚构零值
- **禁止零值冒充**：如果系统读取失败，提供者不得返回 `logicalProcessorCount = 0` 或 `totalBytes = 0` 冒充成功。`assertSystemObservationLoopResult` 对逻辑核数 `< 1`、内存总量 `< 1`、负值或内存算式不一致（`usedBytes !== totalBytes - freeBytes`）一律抛出 `ProtocolError('INVALID_ARGUMENT')`。
- **脱敏错误码**：探测失败仅允许返回协议约定的标准错误码（`EXTERNAL_FAILURE`、`CANCELLED`、`TIMEOUT`、`INVALID_ARGUMENT`），由 `assertSystemObservationFailure` 校验。
- **禁止错误载荷造假与路径泄露**：失败错误对象不得嵌套虚构的观测数据，且错误信息不得泄露本地敏感文件路径（如 `C:\Users`）或凭据。

### 2.3 验收规划与实机门禁 (`planSystemObservationAcceptance`)
- 纯函数 `planSystemObservationAcceptance(input)` 评估当前环境与证据：
  - 在非 Windows 平台（如 Linux、macOS）或缺少真机物理执行证据时，严格返回：
    ```json
    {
      "closedLoop": false,
      "pending": ["policy", "agentarts", "desktop-ui", "windows-provider"],
      "reason": "待真机验收"
    }
    ```
  - **绝不返回 `closedLoop: true`**：在离线、合成或非 Windows 测试环境中绝不宣称真机闭环；真机验收项标待后续现场协同执行。

## 3. 架构与改动范围说明

- **最小导出**：`packages/windows-client/src/index.ts` 仅追加 `export * from './system-observation-loop.js';`，不修改默认 `register(host)` 行为。
- **无越界改动**：不修改 Runtime、Desktop UI、连接器或根装配；不修改 `contracts` 或公共 wire Schema；不改动 ZCode T4–T15；不改动任何架构红线。
- **模块状态**：MOD-17 保持 `in_progress`。

## 4. 本地验证记录

| 验证项 | 执行命令 | 结果 |
| --- | --- | --- |
| 模块构建 | `npm run build --workspace=@personal-agent/windows-client` | 退出码 0，tsc 编译通过 |
| 闭环 helper 测试 | `node packages/windows-client/test/system-observation-loop.test.mjs` | 6/6 通过（成功形状、失败不造零、unsupported 指标、Linux 下 closedLoop=false） |
| 既有提供者测试 | `node packages/windows-client/test/system-observation.test.mjs` | 13/13 通过 |
| 模块工作区全量测试 | `npm run test --workspace=@personal-agent/windows-client` | 64/64 通过 |
| 架构约束检查 | `npm run check:architecture` | 3/3 通过 |
| Git 格式检查 | `git diff --check` | 0 格式警告/冲突 |

## 5. 2026-11-10 直读证据形状（仍非闭环）

`assertDirectProviderReadEvidence` 只接受 `capture-windows-evidence.mjs` 写出的脱敏结构：`evidenceKind` 为 `direct_provider_read_only`、`platform` 为 `win32`、`source` 为 `node:os`，且 `productionAuthorizationVerified` 与 `agentArtsVerified` 必须为 `false`。多余字段、`mock`，或把授权/云验收标成 true，一律拒绝。`planSystemObservationAcceptance` 仍然恒为 `closedLoop: false`。这份校验不代替 Policy、Desktop 或 AgentArts 实机读回，也不在非 Windows 上写出证据文件。
