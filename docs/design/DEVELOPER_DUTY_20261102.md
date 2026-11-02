# 开发值班（GitHub PR / CI / Issue）

目标 profile：`huawei_ict_agentarts`。本增量只增加模块，不替换 F09、F03、F12、F15–F19、F23、F24、F25 或 F28 的现有实现。

证据等级：**Fixture**。测试使用固定的 GitHub 响应形状，没有真实 GitHub 账号、webhook 投递或云端 runner。不能据此声称真实值班已验收。

## 已实现

| 要求 | 新增入口 | 接到的现有链 | 状态 |
| --- | --- | --- | --- |
| 事件源 | `reduceDutyPoll` / `acceptGitHubWebhook` / `ingestDeveloperDutyPoll` | F09：成功页写成现有 `feeds.collect` 回执 | 断线、缺口或游标对不上时不前进游标，也不记成“无变化” |
| 仓库授权 | `defaultRepoDutyPolicy` / `evaluateRepoDutyAction` / `assertDutyCredentialScope` | F25：只保存凭据引用，拒绝 token 原文；合并默认禁止 | Fixture |
| 状态评论 | `planStatusComment` / `executeStatusComment` / `commitDeveloperDutyStatusComment` | F24：未知结果先读回，不再次发帖；已有标记评论就地修改 | Fixture |
| Head 结论 | `bindHeadConclusions` / `recordDeveloperDutyConclusions` | F03：同一 PR 的旧 head 标为 `superseded` | Fixture |
| CI 分诊 | `classifyCiFailure` | F16/F17：分类和日志摘录只作为证据，不宣称已经修复 | Fixture |
| 个人视图 | `buildPersonalView` | 指派给我、等我审查、我的失败 PR | Fixture |
| 限流与分支保护 | `interpretGitHubRateLimit` / `assessDutyPush` | 传输失败不是“无限额”；保护规则未知时拒绝推送 | Fixture |
| 离线评估集 | `buildOfflineEvalSet` / `storeDeveloperDutyEvalSet` | F23：`evaluation.dataset_snapshot`，`evidenceLevel: fixture` | Fixture |
| 评论动作 | `developerDutyToolIntent` | 允许评论时指向现有 `github.pr.comment`；本模块不调用合并 | Fixture |
| 通知意图 | `queueDeveloperDutyNotification` | F12：只记录意图，`delivered: false`，不声称设备已显示 | Fixture |

夹具：`packages/connectors/github/test/fixtures/developer-duty-github.json`。

## Stub

`createStubRemoteDutyRunner` 是远端值班适配器的占位。`implementation` 为 `stub`，`submit` 固定拒绝，`runsWhenLocalMachineOff` 为 false。本机 Windows 关机后，值班不会继续。这里没有真实云端进程、队列或账号。
