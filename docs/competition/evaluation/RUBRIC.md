# 判分规则（评测集 RUBRIC）

> 适用于 `docs/competition/evaluation/cases.json` 与 `scripts/competition/run-evaluation.mjs`。本文件是判分口径的唯一来源，runner 与本规则不一致视为 runner 缺陷。

## 1. 用例结构与口径

每个用例：

| 字段 | 含义 |
| --- | --- |
| `id` | `EVAL-Fxx-NNN`，全局唯一 |
| `workflowId` | 所属工作流图（必须是 `docs/competition/workflow-wiring.json` 中的 28 图之一） |
| `input` | 题目输入（合成资料场景，无真实个人数据） |
| `requiredCapabilities` | 判题所需能力，必须是该图在 wiring 中已登记的能力子集（contract adapter 强制校验） |
| `expectedEvidence` | runtime adapter 判分要求出现的证据字段名 |
| `checks` | 逐条判分项，`weight` 之和必须为 1 |
| `requiresRealAccount` | true = 需真实账号/真机/真云；无真实环境时判 `unavailable`，不判 fail |

## 2. 单条判分项（check）

三种结果，只允许这三种：

- `pass`：证据存在且满足该条描述。必须有对应的 trace 事件引用（tool call id / evidence 字段 / 文档引用）。
- `fail`：证据存在但不满足描述；或证据明确缺失且原因在用例范围内。
- `unverified`：无法取得判定所需的证据（如 runtime 不可达、返回缺少结构化事件）。**unverified 不计分也不计负分**，但必须出现在 trace 中并给出原因。

**禁止**：以模型自述（“我已完成”“工具调用成功”）作为 pass 证据；必须以 trace 中记录的实际工具回执、读回结果或可独立读回的文件/引用为准。

## 3. 用例分与运行分

- 用例分 `caseScore = Σ(check.weight × checkScore)`，其中 `pass=1`、`fail=0`、`unverified 不计入分母`：即 `caseScore = Σ pass 的权重 / Σ (pass+fail 的权重)`。
- 用例状态：全部可判项 pass → `pass`；任一可判项 fail → `fail`；全部项 unverified → `unavailable`。
- 运行总分 `runScore = Σ caseScore（仅 pass/fail 用例） / 可判用例数`；`unavailable` 用例单独计数并在报告里列原因，**不进分母、不默认为 0**。
- `requiresRealAccount: true` 且环境不满足 → 用例 `unavailable`（原因 `missing_real_account`）。

## 4. Trace 记录（MOD-31/32 对齐）

每次运行输出到 `--out` 目录：

- `trace-<runId>.manifest.json`：运行元数据（adapter、git HEAD、时间、统计、输出文件）。
- `trace-<runId>.events.jsonl`：逐事件 JSONL——`run_started` / `case_started` / `check` / `case_finished` / `run_finished`，runtime adapter 当前不发起调用，不记录原始响应。

Trace 是审计证据：判分结论必须能在 events.jsonl 中逐条对应；manifest 的分数必须与 events 汇总一致（runner 内部自检，不一致即退出码 2）。

## 5. 两档 adapter 的判分边界

| adapter | 能判什么 | 不能判什么 |
| --- | --- | --- |
| `contract`（离线，默认） | 评测集与整图契约的结构一致性：workflowId 存在、requiredCapabilities ⊆ 图能力、权重和=1、expectedEvidence 非空、依赖用例存在。**验证的是题集质量**，不评测模型行为。 | 模型行为（无法离线判定，一律 unverified） |
| `runtime`（需已部署 Runtime） | 当前缺少可信隔离授权和逐项验证器，不发送调用，行为项为 unverified，用例为 unavailable。 | 无部署时的任何行为结论（全部 unavailable，不做本地模拟替代） |

## 6. 与 AgentArts 平台评测的关系（比赛口径）

- **最终比赛跑分以 AgentArts 平台评估为准**（MOD-29/31/32）；本地 runner 用于离线回归与题集自检，其分数不得替代平台结果，也不得写“平台已验收”。
- 平台侧跑完后的 Trace 读回按 docs/competition/evidence/ 现行要求登记；本 runner 的 trace 格式与平台 trace 独立，二者通过 `runId` 与 git HEAD 关联。
