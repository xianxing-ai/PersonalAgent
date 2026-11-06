# 真环境待验收总表离线索引工具设计与使用说明（2026-11-07 重新设计版）

<!-- current-design-20261015 -->
> 当前设计与协作入口：[当前详细设计](../design/CURRENT_DESIGN_20261015.md) · [28项状态](../design/WORKFLOW_STATUS_20261015.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规范](../../AGENTS.md)。
> 本工具属于离线工程基础设施，不修改业务运行时（Runtime/Desktop/Policy/Connectors/Lab），不连接外部真机或云端，不读取私有凭据。

- 负责人：`zemeng5208`；状态：`ready`。
- 工具目录：`scripts/acceptance/`（跨包通用扫描与格式化工具层）。
- 产出清单：
  - `scripts/acceptance/types.mjs`：环境枚举、校验规则、逐字段 provenance 与 cannotConfirm 规范
  - `scripts/acceptance/parsers/code-plan-parser.mjs`：纯静态文本代码规划解析器（严禁 import/eval/vm，检测 ambiguous_closedLoop）
  - `scripts/acceptance/parsers/markdown-plan-parser.mjs`：纯静态 Markdown 规划解析器（含逐字段行号 provenance）
  - `scripts/acceptance/parsers/json-plan-parser.mjs`：纯静态 JSON 规划解析器（含键名行号 provenance）
  - `scripts/acceptance/scanner.mjs`：纯静态文件系统收集与环境维度聚合扫描器
  - `scripts/acceptance/formatter.mjs`：Markdown 总表与 JSON 索引格式化器（含核心免责声明）
  - `scripts/acceptance/build-pending-acceptance-index.mjs`：纯静态 CLI 执行入口
  - `scripts/acceptance/__tests__/`：全量单测集、恶意 JS 防执行夹具、多分支歧义夹具及 18 份真实未合并输入快照（带 MANIFEST.json）

## 1. 核心安全红线与诚实设计原则

在经历前轮合规审查与预演反思后，本工具确立以下不可动摇的设计红线：

1. **绝对纯静态文本读取，严禁动态执行**：
   - 彻底废除任何 `import()`, `require()`, `eval()`, `vm.runInContext()` 动态执行外部规划输入文件的行为；
   - 工具代码自身仅使用标准固定 Node 内置模块（`node:fs`, `node:path`, `node:url`）；
   - 所有输入规划文件（包括 `.mjs`, `.ts`, `.json`, `.md`）均严格作为只读纯文本处理（`fs.readFileSync`）；
   - 测试集中包含恶意顶层 JS 夹具（`malicious-exec-test.plan.mjs`，顶层直接抛出异常），证明解析过程绝不触发代码执行。

2. **禁止全文关键词猜测环境**：
   - 全文中散落出现 `profile: 'huawei_ict_agentarts'`、`token`、`windows`、`win32` 等单词，绝对不代表显式声明了所需物理/外部环境；
   - 仅当文件中包含明确的机器可读环境字面量数组（如 `export const REQUIRED_ENVIRONMENTS = [...]` 或 FrontMatter/元数据行显式声明）时才予以提取；
   - 缺失明确声明时一律判定为缺失（`missingFields: ['requiredEnvironments']`）并记录 `cannotConfirm: missing_environment_declaration`。

3. **禁止将 true 改为 false，严禁伪造齐套**：
   - 代码中若出现 `closedLoop: true` 或动态表达式，绝不能通过正则硬替换或假设默认分支将其篡改为 `false`；
   - 严禁将挂起项（`pendingItems`）或普通描述字符串擅自复制填充为 `acceptanceSteps` 或 `evidenceRequirements`；
   - 缺步骤即报缺步骤，缺证据即报缺证据。不强迫输入文件必须全部 valid，实事求是反映真实状态。

4. **检测多分支歧义（`ambiguous_closedLoop`）**：
   - TS/代码规划函数中若存在多个条件分支（例如非 Windows 时返回 `closedLoop: false`，通过门控后返回 `closedLoop: true` 或 `closedLoop: isClosedLoop`），静态解析器无法在不运行代码的前提下确定默认分支走向；
   - 此时必须严格将 `closedLoop` 标记为 `undefined`（缺失），并在 `cannotConfirm.closedLoop` 中明确记录 `ambiguous_closedLoop`、分支数量及各分支所在行号与原始语句，绝不擅自猜测默认分支。

5. **逐字段可追溯 Provenance（文件 + 行号）与严禁字段回填（No Fallback）**：
   - 每个提取出的合法字段均附带 `provenance[field]`，记录 `sourcePath`、`lineStart`、`lineEnd`、`source`（来源形态）与 `raw` 片段；
   - 每个无法确认或缺失的字段均附带 `cannotConfirm[field]`，记录确切的不可确认原因与详情；
   - **严禁以文件名或其它字段ID回填缺失的 `id` 或 `title`**：文件名仅用于报告展示定位，绝不作为提取出的源字段；源码中未显式声明的必需字段必须严格进入 `missingFields` 并记录 `cannotConfirm`（`missing_id` / `missing_title`），杜绝因临时赋值而绕过校验掩盖缺项。

6. **样例文档核心声明**：
   - 针对未合并 PR 离线快照生成的样例文档，明确声明：**“仅假设这些文件合入后的离线输入汇总、非真实验收、非已合并主干”**；
   - 旧 WIP 报告自称的「8 valid」不代表人工确认，系由规则过宽推断（猜关键词、true改false、pending拼凑、文件名回填id/title）造成的虚假齐套；本工具在严格静态文本规则下，如实反映 18 份输入的真实缺项（0 valid）。

## 2. 规范化记录字段定义

每条进入待验收总表的合规记录必须包含以下规范字段：

| 字段 | 类型 | 规范说明 |
| --- | --- | --- |
| `id` | `string` | 唯一规划标识符（如 `sqlite-packaged-electron-smoke`） |
| `title` | `string` | 规划中文或英文可读标题 |
| `sourcePath` | `string` | 仓库相对路径（如 `docs/modules/foo.md`） |
| `closedLoop` | `boolean` | **核心闭环布尔值**：必须显式且无歧义提供，缺失即报错，严禁默认 true 或猜分支 |
| `status` | `string` | 状态枚举（`unavailable` \| `pending` \| `in_progress` \| `ready` \| `verified`） |
| `requiredEnvironments` | `string[]` | 明确声明的真环境枚举集合（至少覆盖五类标准枚举） |
| `acceptanceSteps` | `string[]` | 明确声明的非空验收步骤列表，严禁借用 pending 拼凑 |
| `evidenceRequirements` | `string[]` | 明确声明的非空独立证据要求列表，严禁借用 pending 拼凑 |
| `reason` / `pendingItems` | `string` / `string[]` | 若 `closedLoop === false`，必须提供明确未闭环原因或挂起项 |

## 3. 18 份真实未合并规划输入快照管理

18 份来自 zemeng 未合并规划 PR 的真实快照（通过 `git show <head>:<path>` 抓取）已保存在：
`scripts/acceptance/__tests__/__fixtures__/unmerged-zemeng-plans/`

同级维护完整的 `MANIFEST.json` 清单，严格记录：
- `pr`：来源 PR 编号（#594, #596, #598, #599, #602, #604, #605, #606, #607）
- `branch`：来源分支名称
- `head`：固定 Git commit SHA
- `originalPath`：主干目标路径
- `sha256`：逐字快照内容的 SHA256 哈希值
- `bytes`：文件精确字节大小

> **隔离说明**：测试夹具存放在默认全库扫描排除的 `__fixtures__` 目录下，严禁拷贝至业务代码 `src/` 中冒充 main 已存在。

## 4. 验证命令与测试

```bash
# 1. 运行验收规划索引工具全量单元测试（包含安全防执行测试、歧义分支测试、18份真实快照逐份覆盖测试）
node --test scripts/acceptance/__tests__/*.test.mjs

# 2. 扫描真实未合并快照生成离线样例报告（因如实报错缺少字段，需带 --report-errors）
node scripts/acceptance/build-pending-acceptance-index.mjs --root scripts/acceptance/__tests__/__fixtures__/unmerged-zemeng-plans --globs "**/*" --out-dir docs/modules --report-errors
```
