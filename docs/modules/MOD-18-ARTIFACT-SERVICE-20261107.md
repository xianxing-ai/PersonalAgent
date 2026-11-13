# MOD-18：Artifact 服务独立实现首片（2026-11-07）

<!-- current-design-20261015 -->
> 当前设计与协作入口：[当前详细设计](../design/CURRENT_DESIGN_20261015.md) · [28项状态](../design/WORKFLOW_STATUS_20261015.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [具体分工与接线](../competition/COLLABORATOR_WIRING_PACKAGE.md)。各 MOD 负责人交付实现、实际调用方接线、测试、Evidence 和文档。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng5208`；状态：`in_progress`（首片实现已完成，待审计项继续推进）。
- 模块：`@personal-agent/coding-tools`。

## 背景与问题

根据当前审计清单，MOD-18 存在三个关键未闭环项：Artifact 服务、真实项目写入/命令、Windows 恢复未完成。
此前引入的 `execution-artifact.ts` 仅提供了本地命令执行的校验摘要与只读范围核对（文档明确指出「这不是公共 Artifact 服务」）。
本片（首片）聚焦于交付独立的本地 Artifact 服务模块与 Windows 恢复绑定纯函数，提供可测试、安全受限的本地生命周期管理，而不污染 Runtime/Desktop，也不破坏架构边界。

## 范围与已交付内容

### 1. 本地 Artifact 服务核心模块 (`packages/coding-tools/src/artifact-service.ts`)

- **生命周期能力**：
  - `create`：创建 Artifact 记录，校验并计算 SHA-256 摘要与字节数。支持纯内存缓存或可选持久化落盘至指定的 `artifactsRoot`。
  - `get`：获取 Artifact 元数据，当前时钟越过 `expiresAt` 时自动将状态转为 `expired`。
  - `read`：读取 Artifact 实际内容（Buffer）。若状态为 `expired` 或 `released` 则拒绝并抛出 `PRECONDITION_FAILED`；从磁盘读取时二次校验 SHA-256 防止篡改。
  - `list`：根据 `kind`、`sessionId`、`runId` 过滤列出记录，默认排除已过期和已释放项（可传参数包含）。
  - `expire`：显式将目标 Artifact 置为 `expired`，更新 `expiresAt` 为当前时间。
  - `release`：释放 Artifact，清理内存并物理删除磁盘上的 payload 文件。重复调用保持幂等（返回 `{released: false, alreadyReleased: true}`）。若 ID 不存在明确抛出 `NOT_FOUND`。
- **身份规范**：
  - `artifactId`：UUID v4。
  - `sha256`：64 位十六进制散列值。
  - `createdAt` / `expiresAt`：ISO 8601 格式时间戳。
  - `kind`：标准类型（如 `coding-repair-verification`、`workspace-patch`、`command-run`）或自定义字符串。
  - `sessionId` / `runId`：关联的任务执行标识（可选）。
- **安全约束**：
  - 路径强制落在 `artifactsRoot` 内部（经 `realpath` 规范化与 `pathIsWithinRoot` 检查，拒绝 `..` 越界与绝对路径逃逸）。
  - 严格阻断敏感路径（复用 `isSensitivePath`，拒绝 `.env`、`.git`、`id_rsa`、`credentials.json` 等）。
  - 不读取仓库外凭据，不把 Artifact 内容作为 Runtime Evidence 或 Policy 自动批准。
- **边界与装配**：
  - 明确：这不是 Runtime Evidence，不是 AgentArts 平台 Artifact。
  - 默认不注册到全局 `ToolHost`。提供可选组装工厂 `assembleArtifactServiceTools(service)`，由外部受信宿主自主按需装配。2026-11-10 起该工厂包含 `artifact.read` / `artifact.expire` / `artifact.release`，与 create/get/list 一样不自动注册；过期或已释放的读取仍拒绝，重复 release 幂等。这仍不是公共 Runtime Artifact 端口，也不是 AgentArts 平台 Artifact。

### 2. Windows 恢复绑定规划 (`planWindowsRecoveryArtifact` / `assertRecoveryArtifactBinding`)

- 提供纯函数/接口对 `rootPath`、`recoveryRootPath`、`relativePath`、`runId`、补丁哈希做确定性绑定计算，并推导预期的 `.inflight` 标记文件名。
- **绝不伪造成功**：在非 Windows 平台（如当前 Linux 运行环境）或缺少受信 helper（`PowerShell` / `WindowsJobProcessHost.exe`）时，严格返回 `{available: false, reason: 'unavailable'}`。
- 绝不静默启动真实 PowerShell 或 native 子进程。

### 3. 公共导出 (`packages/coding-tools/src/index.ts`)

- 最小导出：导出 `createArtifactService`、`ArtifactService`、`planWindowsRecoveryArtifact`、`assertRecoveryArtifactBinding`、`assembleArtifactServiceTools` 及相关类型。
- 保留既有默认 `register()` 行为，未向其追加自动工具注册。

## 本地测试验证

- 测试文件：`packages/coding-tools/test/artifact-service.test.mjs`
- 执行命令：`node --test --test-isolation=none packages/coding-tools/test/artifact-service.test.mjs`
- 结果：**8 项测试全部通过（0 失败，0 跳过）**：
  1. `ArtifactService: create, get, read, list, expire, and release (in-memory mode)`：通过
  2. `ArtifactService: disk-backed persistence in artifactsRoot`：通过
  3. `ArtifactService: path escape and sensitive path rejection`：通过
  4. `ArtifactService: clock injection and automated expiration`：通过
  5. `ArtifactService: release non-existent artifact throws NOT_FOUND`：通过
  6. `ArtifactService: digest verification rejects mismatched sha256`：通过
  7. `planWindowsRecoveryArtifact & assertRecoveryArtifactBinding: strictly available=false on Linux`：通过
  8. `assembleArtifactServiceTools: provides unattached tools without auto-registration`：通过

相关既有测试：
- `workspace-patch-reconcile.test.mjs`、`workspace-create-text.test.mjs`、`workspace-patch-preview.test.mjs`：23 通过，6 平台门控跳过，0 失败。
- `npm run check:architecture`：3/3 全部通过。

## 明确未做与待验收项

按照审计清单与开发原则，本片交付不冒充完整 MOD-18 验收，以下项目保持明确标注：

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| 本地 Artifact 服务实现与生命周期 | **已交付 (Done)** | 内存+落盘、过期、释放、防逃逸与敏感路径拒绝通过本地测试 |
| 真实项目写入/命令联跑 | **待验收 (Pending Acceptance)** | 需与后续受控真实环境任务编排验证 |
| Windows 真机补丁与恢复 | **unavailable / 待验收** | 当前为 Linux 环境，真实 PowerShell helper 与 Job Object 需在 Windows 实体机验收 |
| AgentArts / Evidence 平台接线 | **unavailable / 待验收** | 本地 Artifact 不是云端平台 Artifact，不直接等同于 Evidence |

ROADMAP MOD-18 保持 `in_progress`，记录本片交付进展。
