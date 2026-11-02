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
| 通知意图 | `queueDeveloperDutyNotification` | F12：只记录意图，`delivered: false`。主进程把它放进现有通知列表，不声称系统已经弹出 | Fixture |
| 主对话工具 | `duty.watch` / `duty.unwatch` / `duty.policy.set` / `duty.personal.list` / `duty.status` / `duty.ci.triage` | 与 availability、export 一起进入模型可见目录。合并请求直接 `SCOPE_DENIED`，保存的策略里 `merge` 固定为 false | Fixture |
| 启动轮询 | Desktop `dutyPoll` | 启动时和之后每分钟调用 `poll()`。游标存在 Runtime 检查点。断线或缺口的 `noChange` 为 false，不前进游标 | Fixture |
| 状态评论接线 | `useFixtureComments` 或调用方传入的 `comments` | 分页读回、写前持久记录、同任务评论串行；未知结果先核实原 id/正文。Desktop 使用真实只读端口，缺逐次正文授权时不写 | Fixture；真实自动写 unavailable |

夹具：`packages/connectors/github/test/fixtures/developer-duty-github.json`。

主进程的 `readPage` 使用开发设置里已经保存的 GitHub 令牌（`developerSettings.readGitHubToken`），请求该仓库的事件、打开的 PR 和最近的 Actions。令牌不进入日志、检查点或工具结果。没有令牌时结果是 `not connected`，不是一条静默的 Fixture。任何请求失败或限流都是缺口：`noChange` 为 false，游标不前进。304 且没有新的 PR 或 workflow 才是没有变化。

状态评论按每个打开的 PR 各写一条，检查点键是 `仓库#PR号`。评论正文带标记、PR 号、计算结论时的 head SHA、CI 状态和结论。head、结论和 CI 都没变时不再创建或修改。写入前先读回该 PR 上的标记评论。默认关闭。合并始终拒绝。缺口或限流不写。没有令牌时不写，并说明未连接。`duty.personal.list` 读 `/user` 的真实登录名；没有令牌时同样是 `not connected`。测试用注入的 fetch，不代表真实 GitHub 账号已经验收。有已启用的健康主机时，轮询页仍可交给远端执行器，但令牌留在本机。

`policy.comment` 只表示仓库允许生成评论意图，不是逐次完整正文授权。`createGitHubDutyComments` 只接受由受信原 ToolGateway 宿主注入的同步 `assertWriteAuthorized({repo, number, action, body, commentId?})`；每次 POST/PATCH 的最终 fetch 前重验固定目标、完整正文及原评论 ID。不得从 Renderer/模型传入布尔授权。当前 Main 未接该授权端口，真实自动评论为 **unavailable**：写入口返回 `UNSUPPORTED_CAPABILITY`，原轮询只保存 `requires_authorization` 意图与完整正文，继续只读，不记成已派发 unknown 或已发布。测试显式注入 Fake assertion，不能作为真实授权验收。

评论列表按每页 100 条完整读回，最多 100 页；任一页失败、结构非法或达到上限仍未读完均返回 unknown，不允许创建或修改。Runtime 在原评论检查点先保存 unknown，再派发写入；同任务/评论键的并发提交串行。进程重启、请求抛错或未知回执均保留原正文/评论 ID，只有原评论精确读回后才允许处理新正文。尚未做真实 GitHub 写入验收。

## Stub

`developerDutyRemoteRunner()` 不传参数时仍返回 `createStubRemoteDutyRunner`，这是明确的无主机回退。传入 `createRemoteRunnerService` 后，`submit` 才走远端协议。桌面值班和异步子任务直接调用该服务的 `submit`，不经过无参数 stub。真机验收还没有做。
