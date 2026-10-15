# MOD-31：owned workflow 固定输入与实际产物评估

- Profile：`huawei_ict_agentarts`；负责人：zemeng。
- 状态：`review`，源码与离线检查可交付；真实固定任务对照未完成。
- 工作树：`D:/PersonalAgent/.worktrees/mod31-workflow-evaluation`；分支：`codex/mod31-workflow-evaluation`。
- 基线：`81dc72b60240d761070c39515ce112032b6b22ca`，已由 Git worktree 登记。旧 `owned-repair-evaluation` 与该基线分叉，原样保留。
- Git 交付：独立堆叠 PR 以 `codex/laya-owned-runtime` 为 base；当前 `origin/main` 缺少本片导入的 `export-owned-release-evidence.mjs`，依赖 #356 的既有 owned workflow 基线。PR 差异仅本片 5 文件，不将 CPU 或 MOD-32 改动包含在本片提交中；依赖合入后由协调者核对并调整 base。
- 所有权：`tests/manual/agentarts/evaluation/score-owned-workflows{,.test}.mjs`、本文及专属 Evidence。无生产协议、依赖、数据库迁移、Laya、MOD-32 或总路线图改动。

## 可交付缺口

既有 fixed/paired synthetic repair runner 继续评分固定三例的提案及受信本地图读回；
`score-runs.mjs` 继续消费人工核验的三标签 trace 摘要。本增量不改变两者语义。
owned workflow 的真实记录另有完整读取、编译、续答和持久读回校验，但缺少固定输入、
实际文档、独立内容标签以及候选/基线配对的一致性检查。本入口补这条离线消费链。

入口复用 `projectOwnedReleaseEvidence` 已有的 F20 检查，不再写第二套工具授权或终态判定。
固定案例 `f20-public-api-docs-v1` 复用原 `ownedWorkflowFixtureInput('F20')` 和
`ownedWorkflowPublicFixture('F20')`。生产评估器只保存它们在上述基线的摘要，没有复制任务生成器。
本次只导入这两个纯函数取得摘要，没有调用 live 入口、模型或工具。

- 输入规范 JSON SHA256：`d4dc22dd4cb6f5ac1be70a49dcea2f5c1ef4b01eee2ea2f1f923336084fbe16a`。
- 来源文件原始 UTF-8 SHA256：`147a6469e4cd47c6730cd9fee51d1d2c4c216f64e935f10f924449a01341fbfb`。
- 规范 JSON 递归排序对象键，保留数组顺序；文档、编译检查文件按原始 UTF-8 字节计算摘要。
- 原 fixture 改动后需要新 caseId 和独立期望，不能覆盖旧摘要来使历史结果通过。

## 输入和调用

```javascript
import {scoreOwnedWorkflowRuns, workflowEvaluationDigest} from
  './tests/manual/agentarts/evaluation/score-owned-workflows.mjs';
const report = scoreOwnedWorkflowRuns({records, historicalEvidence: []});
```

`records` 每条包含下列字段。来源限经审查的公开合成任务材料，禁止加入凭据、私人原文或数据库。
文件输入最大 4,000,000 字节；纯函数拒绝 getter/toJSON、稀疏数组、循环/过深对象及额外顶层字段。
导入模块不会运行 CLI。

| 字段 | 内容 |
| --- | --- |
| `caseId` | 固定为 `f20-public-api-docs-v1` |
| `variant` / `runIndex` | `candidate` 或 `baseline`；实际运行的配对序号，从 1 起；不要为未运行轮次填空回执 |
| `surface` | `agentarts_cloud`、`local_owned_image` 或 `local_owned_source_runtime`，分别汇报 |
| `executionKind` | `real_provider_public_fixture` 或 `synthetic`；由独立记录者提供，不从 HTTP 200 猜测 |
| `releaseMetadata` | 既有发布投影器接受的源 revision、镜像 digest、CPU Torch、Laya revision 等 metadata；缺少时不要伪造 |
| `receipt` | 原 `owned-workflow-live.mjs` 的公开回执对象，保留实际失败与 unknown 条目 |
| `input` | 实际提交的原 F20 input 对象，须与固定摘要匹配 |
| `configuration` | 仅 `executionModel`、`selectorModel`、`modelSettingsSha256`、`environmentId`；模型及环境为不透明公开标识，设置摘要不得包含凭据 |
| `binding` | `inputSha256`、`sourceSha256`、`receiptSha256`、`configurationSha256`；后两者使用 `workflowEvaluationDigest` |
| `artifacts` | 实际 `documentText` 与 `checkText`，分别对应 `owned-api-final-doc.md`、`owned-api-check-result.json` |
| `review` | `documentSha256`、不透明 `reviewerId`、`answerSupported` 与 `citationsSupported`（布尔值或 `null`） |

`input/configuration/binding/artifacts/review` 可缺省以评估不完整记录；缺项保留 `unknown`，
不接受缺失数据作为通过。宿主应在运行前保存输入和模型设置，并在完成后关联原回执；
评估器只验证所提供内容之间的摘要一致性，**不能证明事后补写的 binding 是真实启动记录**。
`modelSettingsSha256` 应覆盖温度、采样、预算等全部非凭据模型设置；`environmentId` 应区分
Windows、QEMU、原生 ARM、资源规格等。策略或模型不同的实验须使用另一套明确实验设计，
本片不把它们纳入“仅工作流变体不同”的配对。

独立评审者对实际文档检查：回答是否由固定来源的契约/实现支持，是否准确解释新增的
`language` 字段和示例，引用是否确实支持对应内容，有无虚构同步/发布或额外功能。
标签绑定实际文档摘要；只有词语出现、文档存在或编译通过均不代替内容评审。
检查文件必须绑定同一来源、候选、文档正文和摘要，并实际报告编译/字段差异检查通过。
这仍是输入记录的内容一致性检查，不会重新执行编译器或核验签名。

命令只读一个明确文件，向 stdout 写报告，不扫描目录、不读环境凭据、不联网：

```powershell
node tests/manual/agentarts/evaluation/score-owned-workflows.mjs --input .cache/mod31/input.json
```

## 评分和完整性

每条记录分别给出固定输入、实际产物、回答、引用、工具读回及工作流状态的
`passed/failed/unknown`。任一已知失败使该例失败；全部检查通过才可记录该**公开 fixture**
通过。失败和未知分别保留，不输出正文、候选、reviewerId、路径、任意错误文本或原始回执。

配对只接受同 case/runIndex、相同输入与配置、相同 surface/executionKind、不同实际回执摘要。
缺基线、输入不完整、产物摘要错配、环境或配置不一致、质量仍未知时不计算差值。已有失败在可绑定的完整配对
中计为 0，不能丢弃失败提高正确率。重复身份和同一回执重放到另一侧均拒绝。
`qualityDelta` 是单对 fixture 通过值的差，不是多 Agent 收益或统计显著性。
报告保留 `executionKind`；合成端口测试不能当业务成功。

耗时仅用回执 `finishedAt - startedAt` 的整次 harness 墙钟；缺失、非法或倒置为 `null`。
HTTP、SDK、selector、排队的相互包含区间不相加，也不把两侧不同执行环境的时间作配对。
本片不接管 MOD-32 平台 trace/费用采集。

F20 是直接读取固定来源的案例，`retrieval=not_applicable_direct_source_fixture`，没有检索片段
准确率。`owned-review` 只记 `review_observed`，不自动判正确弃权；失败恢复和弃权正确性保持
`unknown`，须另有独立标注失败场景及恢复前后证据。F01–F28 全部保留覆盖槽位，其余为
`not_run`，没有按模板数给出功能成功率。原三例修复任务和评分继续由已有 runner 维护。

## 已有真实 Evidence 的消费

`historicalEvidence` 只接受既有 `personal-agent-owned-release-public` 格式。
其读取/完成标记仅保留为 `recordedRead/recordedCompletion`，整体状态固定 `unknown`。
旧投影没有绑定固定 input、完整实际文档和独立内容评审，不能冒充新的可评分运行。
它不会进入 `counts` 或候选/基线差值，也不会与 synthetic 记录混成真实通过率。

本次读取既有 `docs/competition/evidence/OWNED_LAYA_20261014.json`，生成专属
[评估报告](evidence/MOD-31-OWNED-WORKFLOW-EVALUATION-20261015.json)。它是历史真实云端
partial 回执的离线再评估：新可评分运行 0、完整配对 0、F20 `historical_unscored`，
其余 27 项 `not_run`。没有增加云请求、模型调用或工具执行，没有把旧 fe 版本变成本基线的验收。

## 验证与边界

定向命令：

```powershell
node --test --test-isolation=none tests/manual/agentarts/evaluation/score-owned-workflows.test.mjs
```

首次检查使用本机已有 Node **24.20.0**，定向测试 **13/13 通过，0 失败、0 跳过**；
CLI 实际输出与保存的报告解析后逐字段一致。这一结果保留为初次历史，不替代仓库指定版本验证。

2026-10-15 交付收尾使用仓库已准备的 Node **24.15.0**（与 `.node-version` 一致）：
`D:/PersonalAgent/.worktrees/agentarts-owned-image/.cache/toolchain/node_modules/node-win-x64/bin/node.exe`。
同一份源码的上述 **13 项全部通过，0 失败、0 跳过**；实际 CLI 输出与已保存报告逐字段一致。
没有安装依赖、加载权重或扩大测试矩阵。原始记录保存在本工作树的忽略目录：
`.cache/mod31/node-24.15.0-tests.log`、`cli-report-node-24.15.0.json`、`validation-node-24.15.0.json`。
保存的报告 SHA256 为 `ef7a530a994cf2a4285c84fbacd6d301dfdd33bd1735df464bf3b5bcc4c72221`；
验证记录另存测试日志及两份源码的摘要，以对应本次实际检查。
覆盖固定输入、空数据、实际文档/检查文件绑定、独立负标签、回执/来源错配、持久读回缺项、
配对配置与身份、不完整数据、失败分母、弃权边界、历史 Evidence、时间不重复相加和数据入站限制。
全部为无权重离线 fixture；不等于真实回答质量、签名来源、平台或业务验收。

AgentArts 原生 evaluation 为 `unavailable_not_connected`；未确认当前账号端口/API，不猜造
远程适配，不创建资源。本片为本地评估消费器，不能宣称平台原生评估已经交付。
无全仓重建、真实模型或 Laya 权重加载、镜像发布或部署。
本轮按授权提交、推送并创建独立 PR，不等待 CI、不合并；后续整合由主对话协调。
真实运行授权后保存启动绑定及独立评审，再输入同一入口。
