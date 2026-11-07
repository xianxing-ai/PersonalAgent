# MOD-19-PACKAGING-SCAFFOLD-20261107：Windows 打包与安装首片脚手架

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`
- 负责人：zemeng
- 状态：`review`
- 工作树：`/workspace/mod19-packaging`，分支 `zemeng/mod19-packaging-scaffold`，基于 `origin/main` (`855a90c4`)
- 交付范围：MOD-19「打包与安装」首片脚手架，包含生产打包配置声明、Windows NSIS 安装器定义、打包脚本声明、本地静态检查器与测试、未执行的人工验收占位文件。
- 非完成声明：**本 PR 不代表 MOD-19 已完成（done），应用仍不可发布（publishable: false）。不在 Linux 环境伪造 Windows 安装成功或 SQLite 打包后运行成功。**

## 1. 背景与目标

此前仓库已有只读发布前检查器 `scripts/release/preflight.mjs`（[MOD-19-RELEASE-PREFLIGHT-01.md](MOD-19-RELEASE-PREFLIGHT-01.md)）和打包数据路径策略文档（[MOD-19-PACKAGED-DATA-PATHS-01.md](MOD-19-PACKAGED-DATA-PATHS-01.md)），但 ROADMAP 中 MOD-19 一直标为「未启动」，且缺少：
1. 生产打包配置（`apps/desktop/electron-builder.yml` 或 `apps/desktop/package.json` 中的 `build` 字段）；
2. Windows NSIS 安装器定义；
3. Windows 打包脚本声明；
4. 静态核验打包规则的安全校验工具；
5. 人工真机验收的标准化占位与清单。

本首片补齐上述脚手架要素，使工程具备确定性的本地打包前校验闭环，并将发布前检查器（preflight）推进至等待人工与真机验收状态。

## 2. 改动清单

| 文件 | 改动性质 | 目的说明 |
| --- | --- | --- |
| `apps/desktop/electron-builder.yml` | 新增 | 声明生产打包配置：appId、productName、output 目录、保守 NSIS 配置、明确 asar 与解包规则、明确排除危险文件。 |
| `apps/desktop/package.json` | 修改 | 增加 `build` 字段（含 `win.target: ["nsis"]`）、增加 `scripts["package:win"]`、增加 `scripts["check:packaging-scaffold"]`、devDependencies 钉死 `electron-builder: "24.13.3"`。 |
| `package.json` | 修改 | 根配置增加 `check:packaging-scaffold` 脚本快捷入口。 |
| `scripts/release/packaging-scaffold.check.mjs` | 新增 | 本地静态核验脚本：验证配置齐备性、NSIS 目标、打包脚本、排包规则、无危险文件 include、NSIS 保守选项。输出 JSON，失败返回非 0。 |
| `scripts/release/packaging-scaffold.check.test.mjs` | 新增 | 静态检查器的单元测试，覆盖完整齐备通过、缺配置失败、危险 include 拒绝、缺 installer target、缺 script、非保守 NSIS 等 6 组用例。 |
| `tests/manual/release/windows-install-start.json` | 新增 | 独立安装与启动人工验收占位（status=pending，明确 unverified，注明需要 Windows 11 真机与隔离 userData）。 |
| `tests/manual/release/windows-upgrade-data-retention.json` | 新增 | 覆盖升级与数据保留人工验收占位（status=pending，明确 unverified，必须验证旧 userData SQLite 数据库与会话未被清空或覆盖）。 |
| `tests/manual/release/windows-uninstall.json` | 新增 | 卸载人工验收占位（status=pending，明确 unverified，必须验证卸载移除程序并默认保留用户数据）。 |
| `docs/modules/MOD-19-RELEASE-PREFLIGHT-01.md` | 修改 | 补充「脚手架已声明、验收未做」一节，说明检查器各项在脚手架就绪后的状态迁移。 |
| `docs/ROADMAP.md` | 修改 | 更新 MOD-19 状态，记录本脚手架交付。 |
| `apps/desktop/README.md` | 修改 | 补充 MOD-19 打包与安装脚手架说明与检查命令。 |

## 3. 安全策略与打包配置规范

### 3.1 保守 NSIS 策略
- `oneClick: false`：禁止静默一键安装，确保用户知情；
- `perMachine: false`：默认以普通用户（Per-User）安装，不强制全机安装；
- `allowToChangeInstallationDirectory: true`：允许用户自定义安装路径；
- `requestedExecutionLevel: asInvoker`：严格不请求管理员提权，杜绝不必要的 UAC 提升；
- `deleteAppDataOnUninstall: false`：卸载时默认保留用户数据（含 SQLite 任务/会话数据库、配置），防止误卸载造成不可逆数据丢失。

### 3.2 源码与排包边界（Files 与 Asar）
- 仅打包运行必需的桌面文件：`electron/**/*`、`src/**/*`、`package.json`；
- 明确排除：测试目录及用例（`test/**`、`test-support/**`、`**/*.test.*`、`**/*.spec.*`）、源码映射（`**/*.map`）、Git 目录（`**/.git*`）、本地缓存（`**/.cache*`）；
- **危险凭据强隔离**：显式排除所有环境变量文件（`!**/.env*`）、凭据文件（`!**/credentials*`）、私钥与证书（`!**/*.pem`、`!**/*.key`、`!**/id_rsa*`）；
- `scripts/release/packaging-scaffold.check.mjs` 静态守卫会扫描包含规则，如果存在任何正向 include 包含 `.env`、`credentials`、`*.pem`、`*.key`、`id_rsa` 等敏感路径，立即阻断并退出非 0。

### 3.3 图标与原生工具边界
- **图标**：未提交任何未审查的二进制图标文件，当前配置使用 electron-builder 默认图标，配置中明确标注「图标待补」；
- **原生宿主工具（windows-host）**：由于当前原生编译与工具链尚未纳入标准打包，在配置与文档中明确标注为 `unavailable`，严禁假装已打包原生工具。
- **打包后依赖安装**：本 PR 在 `apps/desktop/package.json` devDependencies 中锁死版本 `electron-builder: "24.13.3"`，但不要求在 Linux 环境执行下载和真机打包，不伪造 `node_modules`。

## 4. 本地验证命令与结果

所有脚本均在本地通过无网络、无凭据静态执行：

```bash
# 1. 语法检查
node --check scripts/release/packaging-scaffold.check.mjs
node --check scripts/release/packaging-scaffold.check.test.mjs

# 2. 本地脚手架测试（6/6 全部通过）
node --test --test-isolation=none scripts/release/packaging-scaffold.check.test.mjs

# 3. 既有 preflight 检查器回归测试（7/7 全部通过，不破坏已有行为）
node --test --test-isolation=none scripts/release/preflight.test.mjs

# 4. 运行打包脚手架静态检查器（9/9 pass，ok=true）
node scripts/release/packaging-scaffold.check.mjs .
# 或通过 npm script
npm run check:packaging-scaffold

# 5. 运行发布前检查器（前序 blocked 项推进）
node scripts/release/preflight.mjs .

# 6. git 格式检查
git diff --check
```

## 5. 发布前检查器（preflight）状态变动对比

| 检查项 ID | 检查路径 | 前状态 (Baseline) | 后状态 (Current) | 说明 |
| --- | --- | --- | --- | --- |
| `production-packaging-config` | `apps/desktop/package.json` | `blocked` (`PACKAGING_CONFIG_MISSING`) | **`pass` (`PACKAGING_CONFIG_DECLARED`)** | 检测到 `electron-builder.yml` 及 manifest `build` |
| `windows-package-script` | `apps/desktop/package.json` | `blocked` (`WINDOWS_PACKAGE_SCRIPT_MISSING`) | **`pass` (`WINDOWS_PACKAGE_SCRIPT_DECLARED`)** | 检测到 `scripts["package:win"]` |
| `windows-installer-definition` | `apps/desktop/package.json` | `blocked` (`INSTALLER_DEFINITION_MISSING`) | **`pass` (`INSTALLER_DEFINITION_DECLARED`)** | 检测到 `build.win.target` 包含 `nsis` |
| `release-install-start` | `tests/manual/release/windows-install-start.json` | `blocked` (`MANUAL_EVIDENCE_MISSING`) | **`unverified` (`MANUAL_EVIDENCE_NOT_EXECUTED`)** | 占位建立，明确为未执行，等待真机验证 |
| `release-upgrade-data` | `tests/manual/release/windows-upgrade-data-retention.json` | `blocked` (`MANUAL_EVIDENCE_MISSING`) | **`unverified` (`MANUAL_EVIDENCE_NOT_EXECUTED`)** | 占位建立，明确为未执行，等待真机验证 |
| `release-uninstall` | `tests/manual/release/windows-uninstall.json` | `blocked` (`MANUAL_EVIDENCE_MISSING`) | **`unverified` (`MANUAL_EVIDENCE_NOT_EXECUTED`)** | 占位建立，明确为未执行，等待真机验证 |
| `sqlite-packaged-electron-smoke` | `tests/manual/release/windows-electron-sqlite.json` | `blocked` (`PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`) | **`blocked` (`PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`)** | 核心阻塞项保持，必须由真机打包后 Electron 运行验证 |
| 总体结论 | - | `publishable: false`, `releaseStatus: blocked` | **`publishable: false`, `releaseStatus: blocked`** | 结论保持不变，严禁宣称可发布 |

在未编译干净工作树下，`nextStep` 保持为 `run_build`；在编译完依赖的工作树中，`nextStep` 会从原来的 `implement_packaging` 正确推进至 `perform_release_acceptance`。

## 6. 仍阻塞项与真机待验收清单

本 PR 明确声明不发布，以下事项必须在真实的 Windows 11 环境下逐一完成并记录凭据后，才能进入发布评审：

1. **打包后内置 SQLite 烟测（`PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED`）**：
   - 依赖 Node 内置 `node:sqlite` 在真实 Electron 44.2.0 打包环境下的二进制 ABI 行为；
   - 必须在打包生成的 `app.asar` 内由 Electron 主进程实际执行建库、WAL 模式读写、关闭、重新打开验证。
2. **全新安装与首次启动（`windows-install-start.json`）**：
   - 在干净的 Windows 11 虚拟机/物理机上运行生成的 NSIS 安装包；
   - 验证无提权提示（`asInvoker`）；
   - 自定义路径安装通过；
   - 启动应用后，验证 `userData` 正确创建且数据库/会话记录正常。
3. **版本升级与数据保留（`windows-upgrade-data-retention.json`）**：
   - 先前安装中已有任务数据和会话历史；
   - 运行新版本安装包直接覆盖安装；
   - 启动新版本后，验证既有数据完好无损，无清库或会话丢失。
4. **安全卸载（`windows-uninstall.json`）**：
   - 执行卸载程序，验证安装目录和快捷方式彻底清除；
   - 验证用户私有数据（`userData`）默认得到保留。
5. **应用图标与资源规范化**：
   - 补充合规的高分辨率 Windows `.ico` 图标。
