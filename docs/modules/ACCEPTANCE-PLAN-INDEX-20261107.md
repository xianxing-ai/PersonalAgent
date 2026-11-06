# 真环境待验收总表离线索引工具设计与使用说明（2026-11-07）

<!-- current-design-20261015 -->
> 当前设计与协作入口：[当前详细设计](../design/CURRENT_DESIGN_20261015.md) · [28项状态](../design/WORKFLOW_STATUS_20261015.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规范](../../AGENTS.md)。
> 本工具属于离线工程基础设施，不修改业务运行时（Runtime/Desktop/Policy/Connectors/Lab），不连接外部真机或云端，不读取私有凭据。

- 负责人：`zemeng5208`；状态：`ready`。
- 工具目录：`scripts/acceptance/`（跨包通用扫描与格式化工具层）。
- 产出清单：
  - `scripts/acceptance/types.mjs`：环境枚举、校验规则与未合并 PR 参考数据
  - `scripts/acceptance/parsers/markdown-plan-parser.mjs`：Markdown 规划适配与指令注入防护解析器
  - `scripts/acceptance/parsers/code-plan-parser.mjs`：代码规划（.plan.mjs/.plan.ts）适配器
  - `scripts/acceptance/parsers/json-plan-parser.mjs`：JSON 规划适配器
  - `scripts/acceptance/scanner.mjs`：文件系统收集与环境维度聚合扫描器
  - `scripts/acceptance/formatter.mjs`：Markdown 总表与 JSON 索引格式化器
  - `scripts/acceptance/build-pending-acceptance-index.mjs`：CLI 执行入口
  - `scripts/acceptance/__tests__/`：完整测试集与正反例 Fixtures

## 1. 背景与诚实原则

在当前仓库主线（main）上，历史验收文档多以证据回执（Evidence/Receipt）、状态矩阵（Matrix）或手工冒烟脚本（tests/manual/）形态分散存储，缺少统一的机器可读「待验收规划」规范。同时，一批 zemeng 离线规划 PR（如 #594, #596, #598, #599, #602, #604, #605, #606, #607 等）已在各子分支定义了含 `closedLoop: false` 的纯函数规划器，但**尚未合入 main**。

根据 [AGENTS.md](../../AGENTS.md) 核心开发规范：
1. **不提前把未合并 PR 当作已存在**：扫描范围严格限制为当前工作树已有文件，禁止跨分支 cherry-pick 或强行堆叠；
2. **不伪造或推断「已验收」**：缺失真实设备或云端独立外部读回证据时，`closedLoop` 必须为 `false`，状态标为 `unavailable`；
3. **指令注入安全防护**：将规划文件视作静态文本数据解析，严禁 `eval`、禁止外部网络请求、禁止执行规划步骤中的指令文本。

## 2. 架构位置选定

本工具选定放置在 **`scripts/acceptance/`**，理由如下：
- **职责解耦**：`@personal-agent/coordination` 是用于 Agent 运行时协议与分布式协调的包，依赖 `@personal-agent/contracts` 与 `ws`。离线文档扫描与校验属于仓库构建/门禁工具，不应污染 coordination 的运行时依赖与发布周期；
- **符合仓库惯例**：仓库现有的架构检查、文档同步及校验脚本均统一收敛于 `scripts/`（如 `scripts/checks/architecture.mjs`、`scripts/docs/sync-workflow-navigation.mjs`）；
- **零生产侵入**：纯 Node ESM 编写，无需新增生产依赖，不改变 `apps/*` 或 `packages/*`。

## 3. 规范化记录字段定义

每条进入待验收总表的记录必须包含以下规范字段：

| 字段 | 类型 | 规范说明 |
| --- | --- | --- |
| `id` | `string` | 唯一规划标识符（如 `sqlite-packaged-electron-smoke`） |
| `title` | `string` | 规划中文或英文可读标题 |
| `sourcePath` | `string` | 仓库相对路径（如 `docs/modules/foo.md`） |
| `closedLoop` | `boolean` | **核心闭环布尔值**：必须显式提供，缺失即报错，严禁默认 true |
| `status` | `string` | 状态枚举（`unavailable` \| `pending` \| `in_progress` \| `ready` \| `verified`） |
| `requiredEnvironments` | `string[]` | 所需真环境枚举集合（至少覆盖下述五类） |
| `acceptanceSteps` | `string[]` | 非空验收步骤列表，缺失即报错 |
| `evidenceRequirements` | `string[]` | 非空独立证据要求列表，缺失即报错 |
| `reason` / `pendingItems` | `string` / `string[]` | 若 `closedLoop === false`，必须提供明确未闭环原因或挂起项 |

### 所需真环境枚举（requiredEnvironments）
1. `windows_real_machine`：Windows 原生/真机环境（UIA、打包后安装包、注册表、窗口等）
2. `huawei_cloud`：华为云 / AgentArts 云端托管环境（网关、前缀路由、在线会话、Trace）
3. `real_account`：真实账号 / 授权凭据（GitHub Token、华为云鉴权凭据、企业邮箱凭据等）
4. `rights_holder_or_human`：权利人 / 用户原生审批与人工复核
5. `other`：其他物理或特殊环境（要求保留原始环境文本，禁止静默漏报）

### 防伪校验机制
若规划声称 `closedLoop === true`：
- 必须具备 `hasVerifiedEvidence: true` 及合规证据签名（如真实 SHA256 回执摘要）；
- 若带有 `mock: true`、`synthetic: true` 或 `evidenceLevel === 'mock'`，一律按防伪违规报错；
- 即便具备证据，总表仍将其单独归入「规划声称已闭环（需人工复核 - 工具不背书）」小节，不作为工具确认的结论。

## 4. 已知未合并验收规划 PR（待合并后自动纳入）

下表列出当前各 PR 的规划目标与待合入环境。各 PR 合并入 main 后，本工具运行扫描将自动将其纳入对应环境总表，无需修改工具代码：

| PR | 分支 / 描述 | 规划目标 | 涉及环境 | 状态 | 核心函数 |
| --- | --- | --- | --- | --- | --- |
| **#594** | `zemeng/mod19-sqlite-smoke-plan` | MOD-19 打包后 Electron SQLite 烟测离线规划 | `windows_real_machine` | 开放待合入 | `planPackagedSqliteSmoke` |
| **#596** | `zemeng/mod29-deployment-readback-plan` | MOD-29 云端部署与版本读回离线规划 | `huawei_cloud` | 开放待合入 | `planDeploymentReadback` |
| **#598** | `zemeng/mod19-release-acceptance-plans` | MOD-19 安装/升级/卸载全生命周期离线规划 | `windows_real_machine` | 开放待合入 | `planReleaseLifecycleAcceptance` |
| **#599** | `zemeng/mod16-live-acceptance-plan` | MOD-16 真实记事本 UIA/原生窗口读回规划 | `windows_real_machine` | 开放待合入 | `planNotepadLiveAcceptance` |
| **#602** | `zemeng/mod27-privacy-deletion-plan` | MOD-27 隐私擦除与数据持久化清空规划 | `windows_real_machine` | 开放待合入 | `planPrivacyDeletionAcceptance` |
| **#604** | `zemeng/mod18-windows-sandbox-acceptance-plan` | MOD-18 Windows 沙箱安全隔离执行规划 | `windows_real_machine` | 开放待合入 | `planWindowsSandboxAcceptance` |
| **#605** | `zemeng/f09-cloud-prefix-acceptance-plan` | F09 订阅云前缀与会话授权读回离线规划 | `huawei_cloud`, `real_account` | 开放待合入 | `planF09CloudPrefixAcceptance` |
| **#606** | `zemeng/cloudpersist-acceptance-plan` | MOD-04B 关机后云持续离线验收规划 | `huawei_cloud` | 开放待合入 | `planCloudPersistentAcceptance` |
| **#607** | `zemeng/mod04b-agentarts-acceptance-plan` | MOD-04B AgentArts 端到端云编排验收规划 | `huawei_cloud` | 开放待合入 | `planMod04bAgentArtsAcceptance` |
| **#572** | `zemeng/real-acceptance-guide` | 真实验收指引（指引规范，非闭环记录） | 跨环境指引 | 开放待合入 | `guideline_only` |

## 5. CLI 使用命令与验证

### 常用命令
```bash
# 1. 扫描当前工作树并输出总表（遇到缺字段错误时输出错误并 exit 1）
node scripts/acceptance/build-pending-acceptance-index.mjs --root . --out-dir docs/modules

# 2. 遇到错误仍强制输出报告文件（用于排查与生成全量错误清单，仍 exit 1）
node scripts/acceptance/build-pending-acceptance-index.mjs --root . --out-dir docs/modules --report-errors

# 3. 指定扫描特定 glob（例如仅扫描合规规划夹具，验证主路径 exit 0）
node scripts/acceptance/build-pending-acceptance-index.mjs --root . --include-globs="scripts/acceptance/__tests__/__fixtures__/valid-*.plan.mjs,scripts/acceptance/__tests__/__fixtures__/valid-*.md"

# 4. 运行全量单元与集成测试
node --test scripts/acceptance/__tests__/*.test.mjs
```

### 输出文件
- `docs/modules/pending-acceptance-by-env.md`：按所需环境分组的人类可读 Markdown 总表
- `docs/modules/pending-acceptance-index.json`：机器可读的规范化 JSON 索引

## 默认扫描排除

- 始终忽略：`.git` / `node_modules` / `dist` / `.worktrees` / `coverage` / `build` / `tmp` / `artifacts` / `.gemini`
- **默认全库扫描**另跳过 `__tests__` / `__fixtures__`，避免测试样例进入真实待验收总表
- 单测或定向验证可通过 `--include-globs` / `--globs` 显式扫到夹具
- 工具设计说明 `ACCEPTANCE-PLAN-INDEX-*.md` 与生成物 `pending-acceptance-*` 不作为验收规划候选

