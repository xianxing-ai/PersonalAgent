# 评测集（AgentArts 评测 · MOD-29/31/32）

覆盖主要工作流的评测题集 + 本地评估 runner + Trace 记录。比赛必需项（总清单「赛题-评测」）。

## 组成

| 文件 | 说明 |
| --- | --- |
| `cases.json` | 23 条评测用例，覆盖 F01–F28 主要工作流：题目（合成资料场景）、期望结果、逐条判分项与权重、requiredCapabilities、是否需真实账号 |
| `RUBRIC.md` | 判分规则（唯一口径）：check 三态 pass/fail/unverified、用例分、运行分、unavailable 不进分母、Trace 与判分对应关系、两档 adapter 边界、与平台评测的关系 |
| `runs/` | runner 输出目录（每次运行生成 `trace-<runId>.events.jsonl` + `trace-<runId>.manifest.json`） |
| `../../scripts/competition/run-evaluation.mjs` | 本地评估 runner |

## 运行

```bash
# 离线（默认）：校验题集与整图契约的结构一致性；行为判分项一律 unverified
node scripts/competition/run-evaluation.mjs --adapter contract

# 只跑部分用例
node scripts/competition/run-evaluation.mjs --filter EVAL-F01-001,EVAL-F04-001

# runtime 档：runtime 档当前不调用 Runtime，行为项为 unverified
node scripts/competition/run-evaluation.mjs --adapter runtime --runtime-url http://127.0.0.1:8787

# 指定输出目录
node scripts/competition/run-evaluation.mjs --out /tmp/eval-runs
```

退出码：0 完成；1 参数/文件错误；2 manifest 与 events 汇总不一致（判分无效）；3 runtime 执行不可用。

## 边界（重要）

- `contract` adapter **不评测模型行为**——它验证的是题集质量（workflowId/能力引用/权重/证据字段与 28 图契约一致），行为判分项全部记 unverified，不会伪装成通过。
- `runtime` adapter 因缺少可信隔离授权及逐项验证器，不派发任何调用；行为项为 `unverified`、用例为 `unavailable`，不生成假 Trace。
- `requiresRealAccount: true` 的用例（真实邮件/日历/通知/GitHub/云）在无真实账号环境下按 RUBRIC 判 unavailable，列明原因。
- 最终比赛跑分以 AgentArts 平台评估为准；本 runner 的分数是本地回归口径，不替代平台结果。

## 与其他交付的关系

- Trace 格式对齐 MOD-31/32 观测边界：事件级 JSONL + manifest 汇总，manifest↔events 自检不一致即判分无效。
- 用例 `requiredCapabilities` 直接引用 `docs/competition/workflow-wiring.json` 中各图登记的能力名，contract adapter 强制校验——题集与整图接线使用同一份契约来源。
- Web Demo（docs/demo/web-demo）的 F23 卡片展示“evaluation.actual_result_dataset”等能力：本评测集是这些能力的实际数据集入口之一。

当前所有 runtime 用例均不派发；恢复执行须先接入可信隔离授权和逐项证据验证。
