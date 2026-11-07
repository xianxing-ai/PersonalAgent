# MOD-30 MCP/Skill 与目标系统读回离线契约校验与验收规划（2026-11-07）

- Profile：`huawei_ict_agentarts`；MOD-30 离线契约与验收规划增量。
- 实现：`zemeng`（分支：`zemeng/mod30-mcp-skill-readback`，基线 main `0e7f3aa1`）。
- 状态：`in_progress`；离线契约 helper 与测试可用，不代表真实 MCP/Skill 读回或真机/真云闭环已完成。
- 原则：不连真实云、不读真实凭据、不改动默认连接行为、禁止伪造成功（no fake success）；真机/真云标 `待验收/unavailable`。

## 1. 背景与未验项承接

依据 [MOD-30-COMPETITION-EXPORT-01](MOD-30-COMPETITION-EXPORT-01.md) 与 [MOD-29/30 定向验收记录（2026-10-25）](MOD-29-30-SCOPED-VERIFICATION-20261025.md)：
1. 工具提案、本地审批、一次性授权、出机投影及 continuation 离线链已经具备。
2. 真实 MCP/Skill 与目标系统读回尚未完成，云端原生同云 run 暂停/恢复仍 unavailable。
3. 本工作包专注于建立严格的**本地离线读回形状校验门禁**与**真实验收规划 helper**，确保测试与离线链路不能将 mock/synthetic 数据或云端纯文本冒充为真实读回收据。

## 2. 核心 Helper 规范与固定错误码

全部 helper 位于 `packages/mcp/src/mcp-skill-readback.ts` 并由 `@personal-agent/mcp` 统一最小导出：

### 2.1 `assertMcpReadbackReceipt(input)`
校验 MCP 读回收据的形状与安全性约束，返回强类型的 `McpReadResult`：
- **来源与版本校验**：`source === 'mcp'`，`serverVersion === '2026.8.31'`；不符合固定抛 `PROTOCOL_MISMATCH`。
- **内容摘要校验**：`contentDigest` 必须为 64 位纯小写十六进制字符串（`/^[a-f0-9]{64}$/`）；不合法抛 `INVALID_ARGUMENT`。
- **路径文本面校验**：必须为相对路径，禁止绝对路径（`/root`、`C:/...`）、禁止反斜杠（`\\`）、禁止冒号（`:`）、禁止目录穿越（`..`、`.` 或 `//`），扩展名必须严格属于 `.txt` 或 `.md`；不满足抛 `INVALID_ARGUMENT`。
- **敏感路径硬性拦截**：禁止任何路径段匹配敏感特征（包括 `.env*`、`.git`、`.codex`、`.agents`、`.ssh`、`.aws`、`.azure`、`.kube`、`.npmrc`、`credentials*`、`secrets*`、`passwords*`、`tokens*`、`id_rsa*`、`id_ed25519*`、`id_ecdsa*` 等）；命中抛 `INVALID_ARGUMENT`。
- **文本防泄漏校验**：当传入 `text` 字段时，校验大小不超过 256 KiB、禁止包含私钥模式（`-----BEGIN ... PRIVATE KEY-----`），并校验 `sha256(text) === contentDigest`；不一致抛 `INVALID_ARGUMENT`。

### 2.2 `assertSkillReadbackReceipt(input)`
校验 Skill 只读摘要与选择结果的最小字段：
- **状态合规性**：`state` 必须为 `'confirmed' | 'pending' | 'unknown'` 之一；未知或非法状态抛 `INVALID_ARGUMENT`。
- **禁止假成功**：当 `state === 'confirmed'` 时，凡附带 `mock: true`、`synthetic: true`、`fake: true`、`isFake: true`、`verification: 'mock'` 或 `verification: 'synthetic'` 标记，一律判定为伪造真实执行，固定抛出 `UNAUTHORIZED`。
- **真实执行证据要求**：`state === 'confirmed'` 必须包含经核验的执行证明（有效的 64 字节 `contentDigest`，或非空的 `sources` 列表且逐项通过路径文本面与 64 字节 digest 校验）；缺失真实证据抛 `INVALID_ARGUMENT`。
- **非终态保全**：`state === 'pending'` 或 `'unknown'` 时保留必要索引标识，允许挂起等待读回，不盲目标记成功。

### 2.3 `planMcpSkillReadbackAcceptance(input)`
在缺乏真机/真实云/真实目标系统环境时，规划验收待办：
- 固定返回 `{ closedLoop: false, pending: ['real-mcp', 'real-skill', 'agentarts-deployment', 'target-system'], reason: '待真机/真云验收' }`。
- 绝不返回 `closedLoop: true`；即使输入参数声称具备真实环境，在离线阶段一律保持 `closedLoop: false`。
- 在 Linux 等无 Windows 原生组件或离线沙箱环境中，如实记录当前平台与未闭环状态。

### 2.4 `normalizeMcpReadResult(input)`
将 Fake 或合成夹具收据转换为规范的 `McpReadResult` 形状（补充 source、serverVersion 并根据 text 自动生成 contentDigest），并立即通过 `assertMcpReadbackReceipt` 校验。

## 3. 待真实验收清单（真机/真云/真实目标系统）

本轮交付严格保持离线状态，以下真实项保持 `unavailable` 或 `待验收`：
1. `real-mcp`：真实 Windows 桌面/原生 stdio MCP 服务的实体进程调用与读回。
2. `real-skill`：真实两步 Skill（读取参考与摘要）真实环境落地执行与真实 Evidence 收据读回。
3. `agentarts-deployment`：华为 AgentArts 真实在线 deployment 命中、trace 关联与真实 continuation 往返。
4. `target-system`：真实系统文件、外部资源与目标系统的整条端到端现场闭环。

## 4. 实际验证结果

- 工作树：`/workspace/mod30-readback`，分支：`zemeng/mod30-mcp-skill-readback`。
- 环境：Linux, Node v24.15.0。
- 构建与测试：
  - `npm run build --workspace=@personal-agent/mcp`：exit 0。
  - `node --test packages/mcp/test/mcp-skill-readback.test.mjs`：11/11 通过（覆盖合法收据、固定错误码、敏感路径拦截、私钥拦截、digest 一致性、假成功拒绝、Linux 下 closedLoop=false、夹具规整）。
  - `npm test --workspace=@personal-agent/mcp`：44/44 通过（既有绑定/remote/manager/stdio 测试无回归）。
  - `npm test --workspace=@personal-agent/skills`：15/15 通过（既有 cloud-selection/real-skill 测试无回归）。
  - `npm run check:architecture`：3/3 通过（无依赖成环或跨层违规）。
  - `git diff --check`：exit 0（无多余空白或冲突标记）。
