---
id: release-install-upgrade-uninstall
title: MOD-19 Windows 安装/覆盖升级/卸载全生命周期离线规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - windows_real_machine
reason: 待 Windows 真实环境人工执行安装、覆盖升级与卸载验收
---

# MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107：Windows 安装/升级/卸载离线规划

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-11-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 1. 范围与定位

- **Profile**：`huawei_ict_agentarts`
- **负责人**：zemeng
- **状态**：`review`
- **核心目标**：提供确定性、只读的 Windows 安装、覆盖升级数据保留、卸载验收的**离线静态规划器**与**人工验收占位脚手架**。
- **文件清单**：
  1. 静态规划脚本：`scripts/release/release-install-upgrade-uninstall.plan.mjs`
  2. 规划单元测试：`scripts/release/release-install-upgrade-uninstall.plan.test.mjs`
  3. 人工验收占位文件（3份）：
     - `tests/manual/release/windows-install-start.json`
     - `tests/manual/release/windows-upgrade-data-retention.json`
     - `tests/manual/release/windows-uninstall.json`
- **非完成声明**：
  - 本工作包是 MOD-19 的离线规划与脚手架补齐，**不代表 MOD-19 完成，不代表 Windows 安装包已完成真实环境验收，更不代表 PersonalAgent Desktop 可以发布**。
  - 占位文件仅代表离线脚手架到位（`MANUAL_EVIDENCE_NOT_EXECUTED`），**占位≠验收通过**。

---

## 2. 核心架构约束与安全不变量

### 2.1 纯静态规划，绝不执行安装器或 Electron

- 规划脚本 `scripts/release/release-install-upgrade-uninstall.plan.mjs` 仅使用 Node 原生 `node:fs`、`node:path` 与 `node:url` 读取占位清单并检测候选安装包。
- **绝不引入 `node:child_process` 运行安装程序或拉起 Electron**。绝不拉起 UI，绝不触发静默安装，绝不向系统注册表或程序目录写入任何文件。

### 2.2 确定性 Unavailable 降级与 pending 保持

规划器在以下三种情况下固定输出降级与 pending 状态，返回 `{ ready: false, reason: 'unavailable', pending: true, executed: false, verified: false, evidenceLevel: 'unverified' }`：
1. **非 Windows 平台**：在 Linux/macOS 环境下无法执行真实 Windows 安装程序验收，规划器固定输出 `ready: false, reason: 'unavailable', pending: true`。
2. **无安装包产物**：在 Windows 环境但未检测到打包生成的 NSIS `.exe` 安装包时，固定输出 `ready: false, reason: 'unavailable', pending: true`。
3. **缺少或非法占位文件**：若三份人工验收占位文件任一缺失，或文件格式损坏、缺少必要字段，固定输出 `ready: false, reason: 'unavailable', pending: true`。

即使在 Windows 真实主机上发现安装包且占位齐全，规划器输出 `{ ready: true, reason: 'planned_manual_acceptance_required' }`，但其属性**依然严格保持**：
- `pending: true`
- `executed: false`
- `verified: false`
- `evidenceLevel: 'unverified'`
- notes 明确提示须由人工在 Windows 真实主机隔离环境中执行并读回证据。

### 2.3 严禁假成功（Reject Fake Claims）

- 占位文件及静态规划绝对禁止声明 `status: 'passed'`、`verified: true` 或 `executed: true`。
- 规划检查器（`--check`）对占位文件进行严格审查：
  - 若占位文件中包含 `"status": "passed"` 或 `"verified": true`，校验器立即判定为非法假成功声明（`ILLEGAL_PASSED_CLAIM`），报告错误并退出。
  - 若规划器检测到占位文件被篡改为 `passed`，规划器直接拒绝将其视作有效就绪，将其归入非法占位并返回 `ready: false, reason: 'unavailable', pending: true`。

### 2.4 CLI 退出码契约

- **无 `--check` 直接运行 CLI**：
  - `node scripts/release/release-install-upgrade-uninstall.plan.mjs .`
  - 规划器输出当前规划 JSON 后，**固定以退出码 1 退出**（`process.exit(1)`）。这向调用方与 CI 明确传达：“当前仅为纯静态规划就绪，验收尚未完成，不可作为已通过判定”。
- **带 `--check` 运行校验**：
  - `node scripts/release/release-install-upgrade-uninstall.plan.mjs --check .`
  - 执行所有占位文件结构、关键词及安全性校验。校验全部通过时退出码为 0；若有任何缺项或非法假声明，退出码为 1。

---

## 3. 边界说明与纪律遵守

1. **不修改根 `package.json`**：遵循 #594 CI 教训，不增删根脚本与依赖，确保公共 CI 门禁与锁文件保持严格稳定。
2. **不修改 preflight 将三项改为 pass**：
   - `scripts/release/preflight.mjs` 中对 `windows-install-start.json` 等三项的检查规则保持为：文件存在时标记为 `unverified`（`MANUAL_EVIDENCE_NOT_EXECUTED`），发布状态固定为 `releaseStatus: blocked`。
   - 绝不通过投机篡改 preflight 逻辑制造虚假通过。
3. **不提前实现或篡改 SQLite 运行验收**：
   - Electron 主进程内 `node:sqlite` 的打包运行验证保持独立边界（`PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`），由后续打包实施工作包单独覆盖。
4. **不修改 `electron-builder` 配置**：生产打包工具链配置归属后续授权的打包实施任务，本规划工作包不修改或添加打包配置文件。

---

## 4. 离线验证与执行证据

执行以下验收命令：

```bash
# 1. 语法检查
node --check scripts/release/release-install-upgrade-uninstall.plan.mjs
node --check scripts/release/release-install-upgrade-uninstall.plan.test.mjs

# 2. 规划单元测试（覆盖 unavailable、占位 pending、拒绝 passed、CLI 退出码）
node --test scripts/release/release-install-upgrade-uninstall.plan.test.mjs

# 3. 发布前检查回归测试
node --test scripts/release/preflight.test.mjs

# 4. 静态规划校验器（退出码 0）
node scripts/release/release-install-upgrade-uninstall.plan.mjs --check .

# 5. 直接规划生成（固定退出码 1）
node scripts/release/release-install-upgrade-uninstall.plan.mjs .

# 6. 代码差异与格式检查
git diff --check
```

### 实际验证结果
- `release-install-upgrade-uninstall.plan.test.mjs`：10 项测试全部通过（通过耗时约 150ms）。
  - unavailable：验证了非 Windows 平台降级、Windows 无安装包降级、缺少占位文件降级；
  - 占位 pending：验证了合法占位通过静态检查并输出待人工验收规划，强制 pending 与 unverified；
  - 拒绝 passed：验证了篡改 `status=passed`、`verified=true`、`executed=true` 会被检查器与规划器拒绝；
  - CLI 退出码：验证了无 `--check` 固定退出码 1，`--check` 合法退出码 0，`--check` 非法退出码 1。
- `preflight.test.mjs`：7 项测试全部通过。
- `git diff --check`：无空白或格式告警。
- 没有改动根 `package.json`、没有改动 `electron-builder` 配置、没有改动 `preflight.mjs` 的判定逻辑。

---

## 5. 后续真实环境人工验收路线

## 验收步骤

1. 全新安装与启动（`release-install-start`）：运行独立安装包，验证无需管理员提权即可在当前用户空间安装，桌面及开始菜单快捷方式正确生成，首次启动主进程正确初始化 `userData` 目录
2. 覆盖升级与数据保留（`release-upgrade-data`）：预先写入测试版本 `userData` 后运行新版本安装包覆盖安装，启动新版本验证 SQLite 任务与会话数据完好保留且表结构未重建
3. 安全卸载（`release-uninstall`）：通过系统设置或快捷方式触发卸载，验证安装目录及快捷方式被彻底清理且用户数据（`userData`）按默认策略完整保留
4. 真实证据读回：真实人工验收完成后，将具体操作环境信息、执行人、日志与时间戳记录至三份 json 占位文件

## 证据要求

1. `tests/manual/release/windows-install-start.json` 人工验收占位文件（pending/unverified）及真实启动日志
2. `tests/manual/release/windows-upgrade-data-retention.json` 人工验收占位文件及覆盖读回日志
3. `tests/manual/release/windows-uninstall.json` 人工验收占位文件及卸载残留检测日志

## 挂起项

- `release_install_start_real_machine`：全新安装与启动待 Windows 真实机人工执行验收
- `release_upgrade_data_retention_real_machine`：覆盖升级与数据保留待 Windows 真实机人工执行验收
- `release_uninstall_real_machine`：安全卸载与数据保留待 Windows 真实机人工执行验收

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `release-install-upgrade-uninstall` | `scripts/release/release-install-upgrade-uninstall.plan.mjs` | L6: `const PLAN_ID = 'release-install-upgrade-uninstall'` |
| title | `MOD-19 Windows 安装/覆盖升级/卸载全生命周期离线规划` | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | L1: `# MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107：Windows 安装/升级/卸载离线规划`；代码 `PLAN_TITLE` |
| status | `unavailable` | `scripts/release/release-install-upgrade-uninstall.plan.mjs` | L226, L246, L265: `reason: 'unavailable'`；文档 §2.2: `ready: false, reason: 'unavailable', pending: true` |
| closedLoop | `false` | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | §1: `不代表 Windows 安装包已完成真实环境验收`；代码 L229: `verified: false` |
| requiredEnvironments | `['windows_real_machine']` | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | §2.2: `在 Linux/macOS 环境下无法执行真实 Windows 安装程序验收`；§5: `须在真实 Windows 11 x64 干净实体机（或隔离虚拟机）按以下规范执行人工验收` |
| acceptanceSteps | 4 项完整步骤 | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | §5: 全新安装与启动、覆盖升级与数据保留、安全卸载、证据读回 4 项验收清单 |
| evidenceRequirements | 3 项证据要求 | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | §1: 文件清单列出的三份人工验收占位文件；§5.4: 证据读回要求 |
| reason / pendingItems | `待 Windows 真实环境人工执行安装、覆盖升级与卸载验收` | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | §1: `非完成声明...占位文件仅代表离线脚手架到位，占位≠验收通过`；§2.2: `reason: 'unavailable'` |

当后续主对话授权生产打包配置实施并生成实际安装包（`.exe`）后，须在真实 Windows 11 x64 干净实体机（或隔离虚拟机）按以下规范执行人工验收并读回证据：

1. **全新安装与启动（`release-install-start`）**：
   - 运行独立安装包，验证无需管理员提权即可在当前用户空间安装；
   - 验证快捷方式正常生成；首次启动正常，主进程正确初始化 `userData` 目录，无报错。
2. **覆盖升级与数据保留（`release-upgrade-data`）**：
   - 在旧版本已写入用户数据（SQLite 任务表与会话记录）的环境下，运行新版本安装包覆盖安装；
   - 启动新版本，验证 `userData` 数据完好读回，会话无丢失、表结构未重建。
3. **安全卸载（`release-uninstall`）**：
   - 通过 Windows 设置触发卸载，验证程序目录及快捷方式被彻底清理；
   - 验证用户数据（`userData`）按默认策略完整保留，不发生静默清除。
4. **证据读回**：
   - 真实人工验收完成后，方可将具体操作环境信息、执行人、日志与时间戳记录至三份 json 文件，并按流程推进。
