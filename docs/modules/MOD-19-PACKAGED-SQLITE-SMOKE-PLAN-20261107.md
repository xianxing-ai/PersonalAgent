---
id: sqlite-packaged-electron-smoke
title: MOD-19 打包后 Electron SQLite 烟测规划与占位
status: unavailable
closedLoop: false
requiredEnvironments:
  - windows_real_machine
reason: 待真机环境执行打包后 Electron SQLite 烟测
---

# MOD-19 打包后 Electron SQLite 烟测规划与占位（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

## 1. 范围与定位

- **Profile**：`huawei_ict_agentarts`
- **模块**：MOD-19 发布准备与打包
- **负责人**：zemeng（GitHub: `zemeng5208`）
- **状态**：`in_progress`（规划与占位就绪，真实执行待真机环境）
- **目标**：为 MOD-19 剩余缺口之一——**打包后 Electron SQLite 烟测**提供纯静态规划器与验收占位文件，明确验收清单与执行条件，绝不宣称已验收，保留 preflight 的阻断项 `PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`。

## 2. 关键安全与验收边界（占位 ≠ 验收）

1. **不可替代的运行时差异**：
   - 命令行 Node 环境（Node 24.15.0）与 Electron（44.2.0）内置的主进程 Node/V8 运行时并非同一二进制执行环境。
   - 尽管 `@personal-agent/storage` 基于 Node 原生 `node:sqlite`，但在打包（asar / win-unpacked / NSIS 安装包）后的主进程中，内置 SQLite 模块寻址、V8 快照兼容性、文件锁、WAL 机制均须在打包后二进制中实际执行验证。
2. **绝对禁止假成功（No Fake Success）**：
   - 占位文件 `tests/manual/release/windows-electron-sqlite.json` 固定为：
     - `status`: `"pending"`
     - `executed`: `false`
     - `verified`: `false`
     - `evidenceLevel`: `"unverified"`
   - 严禁声明 `"passed"` 或 `"verified": true`。
3. **只读静态规划器不拉起 Electron**：
   - `scripts/release/packaged-sqlite-smoke.plan.mjs` 为纯静态规划器，不导入 `child_process` 启动 Electron，即使传入假路径也绝不执行。
   - 在非 Windows（如 Linux CI）或未检测到安装包产物时，固定输出 `{ ready: false, reason: 'unavailable', pending: true }`。
   - 直接通过 CLI 运行规划器时固定以非 0 状态码（exit 1）退出，防止 CI/自动化脚本将生成规划误判为烟测通过。
4. **Preflight 固定阻断保持**：
   - `scripts/release/preflight.mjs` 中的 `sqlite-packaged-electron-smoke` 检查项固定为 `blocked`，错误码 `PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`。
   - 发布判定 `publishable` 必须仍为 `false`。

## 验收步骤（Checklist）

真机环境执行打包后 SQLite 烟测时，必须在打包后的 Electron 主进程中顺序完成以下 6 项验证：

1. **模块加载**：在打包后的 Electron 主进程环境中安全加载内置 `node:sqlite` 模块，无符号缺失或加载异常；
2. **Schema 建库与迁移**：在隔离的 `userData` 路径下创建 SQLite 数据库文件，执行完整 schema 建库；
3. **WAL 模式配置**：显式执行 `PRAGMA journal_mode=WAL` 与 `PRAGMA busy_timeout=5000` 并验证返回值生效；
4. **读写事务闭环**：执行 Task 表与 Runtime 状态写入并执行事务读回，校验数据完整性；
5. **正常关闭连接**：正常关闭数据库连接，确保存储 WAL 日志落盘与 checkpoint 正常；
6. **重启读回验证**：重新启动打包后的 Electron 主进程实例，对前序写入的数据执行独立读回校验，验证数据跨进程重启持久性。

## 证据要求

1. `tests/manual/release/windows-electron-sqlite.json` 验收占位文件（pending/unverified）保持无篡改；
2. 真实 Windows 环境下打包后 Electron 主进程运行 SQLite 建库、WAL 模式、读写事务与重启读回的完整审计回执。

## 挂起项

- `packaged_sqlite_smoke_real_machine`：待真机环境执行打包后 Electron SQLite 烟测（当前无真实环境验收证据，离线规划声明 closedLoop: false / status: unavailable）。

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `sqlite-packaged-electron-smoke` | `scripts/release/packaged-sqlite-smoke.plan.mjs` | L6: `const PLAN_ID = 'sqlite-packaged-electron-smoke'`；文档 §2.4: `sqlite-packaged-electron-smoke 检查项固定为 blocked` |
| title | `MOD-19 打包后 Electron SQLite 烟测规划与占位` | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | L1: `# MOD-19 打包后 Electron SQLite 烟测规划与占位（2026-11-07）` |
| status | `unavailable` | `scripts/release/packaged-sqlite-smoke.plan.mjs` | L141, L159: `reason: 'unavailable'`；文档 §2.3: `固定输出 { ready: false, reason: 'unavailable', pending: true }` |
| closedLoop | `false` | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | §1: `真实执行待真机环境...绝不宣称已验收`；代码 L144: `verified: false` |
| requiredEnvironments | `['windows_real_machine']` | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | §1: `真实执行待真机环境`；§3: `真机环境执行打包后 SQLite 烟测时，必须在打包后的 Electron 主进程中顺序完成以下 6 项验证` |
| acceptanceSteps | 6 项完整步骤 | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | §3: 模块加载、建库与迁移、WAL 模式、读写事务、正常关闭连接、重启读回验证 6 项步骤 |
| evidenceRequirements | 2 项证据要求 | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | §2.2: 占位文件 `windows-electron-sqlite.json`；§3.6: 重启读回与数据跨进程重启持久性回执 |
| reason / pendingItems | `待真机环境执行打包后 Electron SQLite 烟测` | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | §1: `状态：in_progress（规划与占位就绪，真实执行待真机环境）` |

## 4. 交付文件清单

| 文件路径 | 职责 | 状态 |
| --- | --- | --- |
| `tests/manual/release/windows-electron-sqlite.json` | 烟测验收占位文件（pending/unverified） | 新增 |
| `scripts/release/packaged-sqlite-smoke.plan.mjs` | 纯静态规划器与静态检查脚本（CLI 退出非 0） | 新增 |
| `scripts/release/packaged-sqlite-smoke.plan.test.mjs` | 静态规划器、占位文件与安全边界单元测试 | 新增 |
| `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | 本设计与规划说明文档 | 新增 |
| `docs/modules/MOD-19-RELEASE-PREFLIGHT-01.md` | 更新说明占位与验收边界 | 补充 |
| `package.json` | 提供 `node scripts/release/packaged-sqlite-smoke.plan.mjs --check` 静态检验脚本 | 补充 |

## 5. 验证方式

```bash
# 1. 运行烟测规划测试
node --test scripts/release/packaged-sqlite-smoke.plan.test.mjs

# 2. 运行 release preflight 测试
node --test scripts/release/preflight.test.mjs

# 3. 运行静态规划检查
node scripts/release/packaged-sqlite-smoke.plan.mjs --check

# 4. 差异安全检查
git diff --check
```
