# 连接器工作包与默认鹈鹕真实回执复核（2026-10-21）

状态：`in_progress`。目标 profile：`huawei_ict_agentarts`；工作树：
`D:\worktree\f809\PersonalAgent`；分支：`codex/autonomous-change-loop`。

## 检查范围与证据边界

本记录由本工作包测试代理负责。same-worker 目录修复也由该代理实现，因此该部分是作者自审，
不是非作者批准。其他代理产生的默认 Desktop 鹈鹕原始回执将在其隔离 Desktop 完整退出后
独立只读复核；运行中的数据库不另开 RuntimeApplication。

原始复核范围不修改生产代码；随后主控明确授权修复已确认的 `owned-review` 路由缺陷，见下文。
现场回执复核不修改 runner、原任务或数据库，不运行模型或测试，不读取真实邮箱内容、
凭据或私人会话。主控随后授权的有限测试复跑单列于末节。
真实邮件配置及天气现场验证分别由主控和对应代理负责，本页不把它们列为已验收。

## same-worker 目录修复自审

真实失败的旧子任务 `54edc24e-cddf-4d6d-94d8-fa820958a0b1` 固定深度为 1，
当时目录却允许 0～5；模型提出 3 后，原生产 guard 正确拒绝。
该次失败原始记录仍保留于[默认鹈鹕记录](CONNECTOR_TRIGGER_PELICAN_20261021.md)，不重开该终态任务。

| 检查项 | 当前代码与回归依据 | 结论 |
|---|---|---|
| 根目录与子 worker 区分 | 原注册 `coding.repair.workflow` Schema 保留模型、推理强度和深度选择；task 目录通过既有 worker describe 端口投影；仅已启用受信 codingWorker 且原 subtask 固定上下文存在时省去三项字段 | 作者自审通过 |
| 根权限 | 受保护默认 root 的 `taskTools()` 仍只返回 `subagent.dispatch`；其目录不会因为 coding worker 的描述端口而增加业务工具 | 作者自审通过 |
| 子权限 | 原 parent/deadline/goal/role、固定工具集合及工具版本检查仍在 `runDefaultSubagentWorker()`；目录不是授权，F15 原子操作继续使用原 ToolGateway/Policy | 作者自审通过 |
| 防替换 guard | worker dispatch 原模型、reasoningEffort、thinkingDepth 的 `REVISION_CONFLICT` 比较均保留；没有以目录收窄代替本地检查 | 作者自审通过 |
| 目录持续绑定 | `competition-tool-catalog` 原 entries 持久保留；续接只返回 saved.entries 并重验当前 Schema/readiness，Schema 改变时拒绝，不重建扩容 | 作者自审通过 |
| 预算和取消 | 该修复未改步骤、token、deadline、父子 maxSteps 或取消计算；describe 重用原 application-deadline 和取消检查 | 作者自审通过 |
| 旧 root 兼容 | 没有固定 worker 上下文的显式 root 保留三项选择；关闭默认委派的旧 root dispatcher/F15 子任务回归仍通过 | 作者自审通过 |

本地回归使用真实 Runtime/SQLite/Policy/ToolGateway 和明确 Fake 云端/F15 提供者，
不代表真实云模型或文件现场验收。已运行：

- Node 24.15 的 `tsc -p apps/runtime/tsconfig.json`：exit 0。
- `node --test --test-concurrency=1 apps/runtime/test/coding-repair-worker-capability.test.mjs`：16/16，通过，2012 ms。
  覆盖实际固定 depth=1 子 worker 的收窄目录及完整显式 Fake F15、同 app 无固定上下文 root 目录、
  三项伪造在 F15 前拒绝、无目录直接调用仍触发三项原 guard、审批恢复与 unknown 写入不重做。
- `node --test --test-concurrency=1 apps/runtime/test/competition-tool-catalog.test.mjs apps/runtime/test/user-task-delegation.test.mjs`：58/58，通过，10072 ms。
- 上述变更的语法与 `git diff --check`：exit 0。

## 新真实鹈鹕回执的复核门槛

新运行目录为 `.cache/desktop-pelican-default-9dlRFd/`。本轮现场运行和本页独立只读复核均已结束，
结果为 **未通过真实修复验收**，具体见下文。不能把 Laya ready、提交成功、父任务回答或作者测试当作修复通过。

待现场代理完成后逐项核验：

1. 原回执的 profile、非 Fake 标记、默认配置模式与无额外 continuation 环境覆盖；原父子任务、
   原 deadline、初始目录和实际云请求身份必须来自该唯一运行。
2. 重开原 SQLite 的只读查询：父任务和实际子任务均成功；原 root 仅发生一次确认委派；
   子任务固定思考深度与实际目录一致，不存在取消、未决云结果或待核实写入。
3. 原工具执行记录具有 `confirmed`、`policyDecision:allow`、`executionStarted:true`；
   每条原 Evidence 可按任务和 runId 读回，父任务保留实际子任务/host Evidence，参数散列与原意图一致。
4. 原 F15 六节点均 completed、图 settled、无 pendingSend/waiting/proposals；原 host command、
   所属父子任务与 confirmedHost 互相一致；原 N05 的 `npm-test` 回执为 VALID/exitCode 0；
   原 N06 CAS before/after SHA256 与该 fixture 实际前后文件一致。
5. 用户 workspace 仍恰好只有三个原普通文件，无新目录或链接；测试文件和 package.json 字节不变；
   pelican.svg 仅三个现有动画 begin 属性改变，独立固定 Node 检查通过。
6. 原 Chromium 两帧时间推进且两车轮与脚踏矩阵都变化；截图/播放数据只证明该公开 fixture，
   不外推所有编码任务、平台 Trace 全链、物理人工审批或其他连接器真实业务。

本轮新增检查记录不替代仓库要求的非作者审查、技术 CI 或 PR 合并流程；当前未提交或推送。

## `owned-review` 路由缺陷与修复自审

只读检查确认默认 Runtime 的 `decision.choose_candidate` 包装原先在 Laya 不满足
`state:selected && eligibleForRuntime` 时只寻找 `id:review`。
实际 owned 候选生成器则在确定性来源读取和模型候选后均追加保留候选
`{id:'owned-review',value:null,abstain:true}`，并禁止模型自行生成该保留 ID。
图将该候选的 abstain 值封存在原 pendingSelection 中。

因此，当实际候选包含业务候选与 `owned-review`，而 Laya 返回 `review`/低置信度或 `abstain` 时，
原包装会错误抛 `UNSUPPORTED_CAPABILITY`；高置信度且 eligible 的 `owned-review` 原本可经成功分支返回。
这不是业务授权缺失，也不能用强行选择业务候选解决。

主控授权后的最小修复仅在原 fallback 中优先寻找当前输入列表中的 `owned-review`，再兼容旧 `review`。
业务 eligible guard、输入候选校验、Policy、取消与 deadline 检查均未改变。
图收到该复核结果后保持 `unknown` 且不生成业务提案；这个本地复核路由不是 teacher 已执行的证据。
该修复由本记录作者实施，属于作者自审，不能列为非作者批准。

已运行单 Runtime TypeScript 构建：exit 0。定向命令：

```text
node --test --test-concurrency=1 apps/runtime/test/coding-repair-decision.test.mjs packages/agentarts/test/local-workflow-decision.test.mjs packages/agentarts/test/coding-repair-workflow.test.mjs
```

28/28，通过，3906 ms。其中新增 Runtime 决策测试 12 项使用原默认包装、原 host 任务、SQLite、
Policy、ToolGateway、Evidence，只有 chooser/image 是显式 Fake；覆盖正常业务选择、两种 review ID、
uncertain/abstain、缺少复核候选的拒绝、取消、期限，以及原封存图保持 unknown/零业务提案。
既有 owned/F15 图回归还覆盖未知写入不重放、原检查与发布、主/隔离图的边界。
这些测试不是新真实模型回执，也不修改旧真实失败记录。

## `9dlRFd` 原真实回执的独立只读复核

现场代理确认隔离 Desktop/SQLite 完整关闭后，本页使用 Node `DatabaseSync(...,{readOnly:true})`
直接查询原任务/检查点/工具与审批记录；未另开 RuntimeApplication、迁移数据库或改写任何任务。
原 `receipt.json` 记录：`status:failed`，`stage:wait-original-model-and-tools`，
`acceptanceMode:default_desktop_configuration`，结束于 `2026-10-21T14:52:28.516Z`。

| 门槛 | 原始数据复核结果 | 本轮判断 |
|---|---|---|
| 原父子与目录 | parent `ce953ba2-026d-418d-bcd4-4c46e0a3f9a0`、child `6b1ac2f8-4cb0-423c-9585-64edc8e5677d` 均 waiting_approval；root 目录只有 subagent.dispatch，child 目录 19 项，coding subtask 仅 subtaskId/role/roleLabel/goal | 本次真实目录收窄已生效；任务未完成 |
| 固定偏好与预算 | child depth=1、原 reasoning effort=low；parent/child maxSteps 均 4，原 deadline 均为 `2026-10-21T14:54:02.405Z`，均未请求取消 | 未发现为通过而改偏好/扩预算的迹象 |
| Runtime/Policy/Evidence | 唯一工具记录为原 root 的 subagent.dispatch：confirmed/allow/executionStarted；原 evidenceId 同时在 root evidence_refs 中；没有任何 F15 host 执行记录 | 委派已确认，不能据此认定业务工具执行 |
| 原审批 | `coding-start-6b1ac2f8-4cb0-423c-9585-64edc8e5677d` 仍 pending/revision 1，toolName=coding.repair.start | 原首次 coding 操作尚未执行 |
| Graph/检查/CAS | 原 graph sequence=0、无 input、无 host 任务或 confirmedHost；没有 N05 测试或 N06 发布 | 整图和文件修复未通过 |
| 原云身份 | 一条原 child 请求身份已持久化，attempts=1；原任务没有 competition-cloud-unknown；请求 pin `arm64-v5-d92a17a4-r3`/WSS，平台独立版本读回仍 not_run | 仅证明请求身份；不冒充平台版本自省或整链成功 |
| 真实 Laya | 原回执 ready=true、calibrated=false、设置 UI 启动耗时 34751 ms | 仅该次加载成功 |
| 公开文件 | 恰好 package.json、pelican.svg、pelican.test.cjs 三个普通文件，无链接或目录；checker 与包配置分别与原生成字节完全一致；pelican.svg 与原 fixture 完全一致 | 文件受保护，但缺陷未修复 |

独立文件 SHA256：

- pelican.svg：`f89f9342473941d2a26c2759670f490068234cd1df456285e17b8a33ae06f268`，仍等于原 baseline。
- pelican.test.cjs：`876f69df966d77d449156f7b7b5133ddb100a6f8f93a62355debd6e53d69fed9`。
- package.json：`b00e66b64259594aeae4af3d60eebe06e66065146c2143720c52fedaf1cf1893`。

本次失败原收据明确记录 Playwright 对上述原 `coding.repair.start` “允许一次”按钮的
`locator.click` 30 秒超时。未把等待审批改成授权成功，也没有对该失败回执重发工具或修改 SQLite。
由于任务没有执行到修复阶段，本页没有追加重复项目测试、播放截图或业务成功声明。
现场代理正修正 runner 的原 UI 单次触发方式；之后应使用新独立 fixture 和原生产链产生新回执，
不能更新本轮旧失败任务来制造通过。

## `xfbPX6` 真实公开天气订阅回执的独立只读复核

原回执目录：`.cache/desktop-weather-watch-live-xfbPX6/`。现场代理确认 runner 正常退出且
本轮隔离 Electron 进程数为 0 后，本页以 `DatabaseSync(...,{readOnly:true})` 查询原
`user-data/runtime.sqlite`，没有开 RuntimeApplication、改状态或读邮箱数据/凭据。
本轮原回执结束于 `2026-10-21T15:02:25.166Z`，状态
`passed_real_default_desktop_public_weather_watch`。该状态的有效范围是本节的实际读取、订阅、恢复保留与停止检查。

独立核对了回执与原任务、执行记录、审批、原参数与 ToolGateway inputDigest、订阅 origin、
Scheduler、单用 grant、天气缓存和 Evidence 引用。只读断言全部通过，exit 0；没有调用外部天气、云模型或 Laya。
本次录入的 main、connector-watch-host、public-connector-host 与 runner 四项源码 SHA256
均与复核时工作树中的对应文件一致。

| 原主对话目的 | parent → 实际 user-work child | 原结果 |
|---|---|---|
| 单次公开天气 | `19bde657-c934-4834-b766-047ffef9e5ef` → `1a219c95-ca45-4711-ab51-adff00154cf4` | 两者 succeeded，实际 weather.forecast confirmed |
| 开始精确订阅 | `28139fa2-d3c1-4f23-8a9f-50dd9d0548fa` → `8878cf40-ebe2-48f5-8597-c6e269b36f4b` | 两者 succeeded，实际 connector.watch.start confirmed |
| 停止原订阅 | `acc029c3-0100-4050-ac48-6182b6d96dfe` → `dd46d938-6144-4344-b65e-5c2f4c9b26ce` | 两者 succeeded，实际 connector.watch.stop confirmed |

这三组的 profile 均为 `huawei_ict_agentarts`，每个 root 目录只有 `subagent.dispatch`，
且每个 root 仅有一次实际确认委派；原 parent 保留对应 child 的实际执行 Evidence 引用。
原 child 云请求身份持久存在，未用父任务回答代替业务工具记录。

精确 start 参数为 `source:weather`、公开测试地点北京/Beijing、metric、intervalMs=15000、
expiresAt=`2026-10-21T15:11:30.173Z`；不代表用户所在地。
start/stop 原审批均为 allowed/revision 2、scope `connectors:watch`，与原嵌套参数及执行 inputDigest 一致：

- start argumentsDigest：`0e820d0859e8a3b5a0b8fcc50330236ce572e4a8a560609f02ee87d40460e43f`。
- stop argumentsDigest：`b1bbf13a4ecad61473ba4aeb1fb949533cb2b76244dda5f684e131a5d04d2e21`。

最终原 SQLite 中仅此一项 watch：
`watch-bc3ceb13f4ecba60c91b31f0ed1c7593a78867a8cc6940f0ed681904d850c120`。
其原 origin 始终为上述 start child/run，未替换为重启或 stop 的任务。

| 序号 | 原 Scheduler wake task | 原 host 读取 task | 原记录 |
|---|---|---|---|
| 0 | `354cbe6d-01e2-4bc5-bf71-aa1ffccc6932` | `aafe1ac6-435f-4082-931d-0d651ca7f5be` | wake succeeded；weather.forecast confirmed/allow/executionStarted；完成于 15:01:41.553Z |
| 1 | `bdf71106-d0b7-4df3-be05-72c572ba2f27` | `a9fc0c74-ddd6-48f9-9cd8-38722fde1f51` | wake succeeded；weather.forecast confirmed/allow/executionStarted；完成于 15:01:56.779Z |

两次 wake admission 的 scheduleId、taskId、幂等键和订阅截止时间一致；host commandId
与原 watchId/sequence 的确定散列一致，preparation、intent、queryDigest、configurationRef
及原 start origin 互相匹配。逐次 `weather:read` grant 的任务和精确参数一致，均已单用消费为
usesRemaining=0，未借原 start 参数授权其他查询。

原记录合计 8 次工具执行均 confirmed/Policy allow/executionStarted，包括三次 root 委派、
单次查询、start、两个 host 天气读取及 stop。实际天气 provider 为 Open-Meteo、公开数据；
首次单次查询为 fetched，fetchedAt=`2026-10-21T15:01:22.957Z`。
两个调度结果均是同一 fetchedAt 的 fresh 缓存，ageMs 分别为 18585 和 33817，TTL=600000。
这证明两个真实受限工具读取，**不证明两次新的供应商网络抓取**。

原 runner 记录两次默认 Desktop 启动，在同一隔离 userData 中确认同 watch 重启后仍启用，
随后从主面板精确停止它。最终 SQLite 为 enabled=false/state=stopped/sequence=2；
下一原调度 `15:02:11.915Z` 已 cancelled 且没有 wake task。
stop 实际完成于 `15:02:02.159Z`，直到原回执结束未再出现天气读取；runner 的停止后观察窗为 17000 ms。
该有限窗口支持“本次停止后没有继续读取”，不外推任意未来时长。

两个调度读取发生在重启前；本次证明同 watch 的持久保留和重启后原 UI 停止，
没有证明重启后又发起一次新的读取或网络抓取。
原变化存储有两个独立责任基线、weather.changed 事件数为 0；本轮未请求启动 Laya，
significantChange=`no_significant_change`、realChangeNotification=`not_verified`。
因此，**真实显著天气变化 → Laya 决策 → 用户提醒仍未验收**。
平台独立版本/Trace 读回、物理人工点击也仍不在本次证明范围；原回执、数据库均保持不变。

## `LUCLdz` 新真实鹈鹕失败回执的独立只读复核

现场代理明确确认本轮隔离 Desktop/SQLite 完整关闭后，本页只读核验
`.cache/desktop-pelican-default-LUCLdz/receipt.json` 与原 SQLite、公开 workspace，
没有重开任务、重新执行工具、启动模型或修改回执。
原记录为 `default_desktop_configuration`、`default_ui_coding_repair_workflow`，
profile=`huawei_ict_agentarts`；自动化声明 fakeModel=false/fakeTools=false，
审批仍走原可见启用 DOM 按钮与生产 UI handler，physicalHumanClick=not_run。

本次验收结果为 **failed**，结束于 `2026-10-21T15:17:05.071Z`；
原任务 deadline 为 `2026-10-21T15:16:25.517Z`，runner 因未在原期限达到所需完成状态拒绝通过。

| 门槛 | 原始数据独立核验 | 判断 |
|---|---|---|
| 原父子 | parent `4074d8ad-d796-425d-8203-3bd14e48e64c` 为 waiting_approval；child `dacfd393-4494-48b8-a5bc-7f3c7a156ee6` 为 waiting_reconciliation；原 parent/subtask 互相绑定 | 未完成，不能按父任务受理认定通过 |
| 目录与预算 | root 仅 subagent.dispatch；child 19 项，coding subtask 只含 subtaskId/role/roleLabel/goal；固定 depth=1、reasoning effort=low；父子 maxSteps 均4，deadline相同 | 收窄生效，未放宽预算或改用户偏好 |
| 原执行记录 | 仅原 subagent.dispatch、coding.repair.start 和 decision.choose_candidate 三项；均 confirmed/Policy allow/executionStarted | 原委派、初始编码会话和本地决策工具已执行 |
| 原审批 | start 与 decision 均 allowed/revision 2；原参数散列和 ToolGateway inputDigest 重算匹配 | 原 UI 审批已生效，不再是上一轮 actionability 超时 |
| 原决策 host | `ce4472d3-f491-416a-95b1-002d7fc875ca` succeeded；原 host command、reciprocal parent、owner 的原 host checkpoint、confirmedHost 及缓存结果一致 | 没有替换 host 身份或结果 |
| 原选择结果 | 原缓存严格为 `{selectedId:'owned-review'}`；原候选 context.candidateValues 中该 ID 为 abstain=true/value=null；原候选列表另有 bound-coding-operation | 合法复核结果，未授权业务动作 |
| Graph/Evidence | sequence=2、state=unknown，N01 unknown，N02～N06 pending；唯一 confirmedHost 是 decision.choose_candidate，其原 Evidence 在 graph.evidenceRefs 中；无 pendingSend/waiting | 保留复核状态，没有伪造 settled 或业务完成 |
| 文件与实际检查 | 没有 coding.repair.read、N04、N05、N06 执行记录；没有目标源码补丁、项目通过检查或 CAS 发布；三个普通文件均原字节 | 文件修复验收未通过 |

原 start approvalId 为 `coding-start-dacfd393-4494-48b8-a5bc-7f3c7a156ee6`，
argumentsDigest 为 `954b889cc4a6f7ef55ba78767da94a703c2737562ee5877615cff47f7348cde8`。
原 decision approvalId 为 `host-tool-ce4472d3-f491-416a-95b1-002d7fc875ca`，
argumentsDigest 为 `5329cbec11221860a690dc03ced27389acd896cc4b87e6522904e143a1ed64a8`。
原 decision commandId 为 `wf-decision-79dbfec57a0d2a9f3a51d3a836b2d66ef16007f7164be7a1`。
这些绑定只说明原权限和实际返回值，不构成业务执行或 teacher 参与证明。

本页只读断言对上述精确参数、原 host 归属、graph/cache/result/Evidence 一致性及文件字节
全部通过，exit 0；这是对**失败验收完整性**的核验，不是鹈鹕测试通过。
pelican.svg 仍等于原 baseline `f89f9342473941d2a26c2759670f490068234cd1df456285e17b8a33ae06f268`，
checker/package 仍与原生成字节一致、SHA256 与 `9dlRFd` 节相同，无额外文件、目录或链接。
本轮 independentNodeVerification 与 Chromium playback 均为 not_run；没有为已知未改动的失败 fixture
补造项目通过或播放结果。

原回执报告真实 Laya ready=true/calibrated=false、设置 UI 启动耗时54822 ms；
它与原 decision 工具执行记录一起证明本次加载和工具调用。
**原 SQLite 只保存默认决策包装的 selectedId，没有保存 Laya 原 typed state、reason 或概率。**
因此，本页不能区分高置信度直接选择 owned-review，与 uncertain/abstain/unavailable 被安全 fallback
路由为 owned-review；也不能据此认定模型语义判断错误、某一 fallback 分支已真实验收或 teacher 已执行。
默认鹈鹕闭环仍未通过。后续若继续，应先补足该真实判断原因的可核验证据，不以强制业务候选、
降低拒绝门槛或重做本轮旧任务制造成功。

## `k3MKzk` 增强天气重启后读取的独立只读复核

现场代理确认新的隔离 Desktop 完整关闭后，本页只读核验
`.cache/desktop-weather-watch-live-k3MKzk/receipt.json` 与原 SQLite。
这是新的独立运行，旧 `xfbPX6` 回执和数据库未改写。
原回执为 `passed_real_default_desktop_public_weather_watch`，结束于
`2026-10-21T15:20:41.091Z`；所有新增只读原始数据断言通过，exit 0。
本次 main/watch host/public provider host/runner 四个源码散列均与复核时工作树一致。

原三组主对话与实际 child 均 succeeded；每个 root 只有一次原 subagent.dispatch，
原 parent 保留对应 child 的执行 Evidence 引用：

| 目的 | parent → child |
|---|---|
| 单次公开天气 | `8648eaaf-0f40-411f-814f-0e00480fb4e6` → `f5f32fba-c6eb-4b22-9bc9-5bec8f34dfcc` |
| start | `8967222c-8d8a-4a6e-8958-fdb72c161c6e` → `16b7b82c-e0a6-4b62-9270-ab5994d8cab8` |
| stop | `8e8a05c8-c22d-40ae-9c70-b5d7a37e9c44` → `bb804940-b367-4185-a1aa-97463eaf4f57` |

唯一 watch 为 `watch-510a310c712d418e681841977e529a59a674c552ca1365089902f2c26b6355c1`。
原精确参数为北京/Beijing/metric、intervalMs=15000，expiresAt=`2026-10-21T15:29:31.142Z`，
与重启前冻结参数完全相同；同一原 start task/run、configurationRef、queryDigest 在后续读取中没有替换。
start/stop 原审批均 allowed/revision 2，原参数和 ToolGateway inputDigest 重算一致。
start argumentsDigest 为 `3d3ce76993e37190ed82d40577c022d01e8ec5ba24a67cf57c657dc597ddbdb0`，
stop argumentsDigest 为 `f3d6f737cb5512d253f9ef3353f56296fffddab3a924d49320cdab5e6465be45`。

重启前 sequence 0/1 的原 host 读取分别为
`fd6abaf4-9dad-4bb8-ba9d-7c711e222270` 与 `9ee06044-7c6c-44b0-a555-e12b82f33cb5`，
均使用 fetchedAt=`2026-10-21T15:19:25.766Z` 的 fresh 缓存。
原 runner 的 restart.startedAt=`2026-10-21T15:19:51.905Z`；之后的新数据是：

| 原绑定 | 重启后实际回执 |
|---|---|
| 新 host task/run | `a76624ad-76b3-411f-8924-865ea81a10f9` / `host-tool-a76624ad-76b3-411f-8924-865ea81a10f9`，不在重启前 task 集合 |
| 原 sequence / 开始 | sequence=2，startedAt=`2026-10-21T15:20:06.320Z`，晚于 restart.startedAt |
| 原 Scheduler | `connector-watch-77454d9173f4d59539875aa4e447b6ff4d4d89781cd1dac1cc0060d2d408adb6`，fired |
| 原 wake/admission | `a0192423-9bb6-4ab2-8875-0e01d92aa509` succeeded；admission 的 scheduleId、taskId、幂等键与原订阅截止时间匹配 |
| 原权限 | weather:read 单用 grant 绑定该 task 和原精确 query；usesRemaining=0；expiry 等于原 host intent deadline 且不超过 watch 截止时间 |
| 原执行和输入 | 唯一一条该 run 的记录，confirmed/Policy allow/executionStarted；原 commandId、preparation、intent、origin 及 inputDigest 全部匹配 |
| 实际 provider 结果 | Open-Meteo/public，cache=fetched，fetchedAt=`2026-10-21T15:20:10.798Z`；host finishedAt=`2026-10-21T15:20:10.810Z` |

本轮由此补齐了旧回执未证明的 **同一 watch 重启后由原 Scheduler 发起新读取并重新获取供应商结果**。
并非仅重读旧页面，也不是把旧缓存标为新网络结果。

最终共9条工具记录，均 confirmed/allow/executionStarted；三个调度 host 的 sequence 为0/1/2，
每次原单用 grant 均耗尽为0。原 stop 在 `2026-10-21T15:20:15.418Z` 完成，
最终 watch enabled=false/state=stopped/sequence=3，下一原 schedule cancelled、无 task。
原停止后17000 ms观察窗及直到回执结束均没有新的天气读取；没有将这个有限窗口外推为无限时长保证。

本轮 weather.changed 事件仍为0，LayaStartup=not_requested，realChangeNotification=not_verified。
因此增强结果只增加真实重启恢复和来源读取证据，**真实显著天气变化 → Laya → 通知仍未验收**；
平台独立版本/Trace和物理人工点击的边界不变。本节只读复核没有访问邮箱数据库、凭据，也未启动应用或测试。

## 最后根检查的原生退出调查与有限复跑

主控原 `npm run check` 为 **exit 1**。本页只读核对
`.cache/connector-check-live-final.log`：该次 `@personal-agent/agentarts-runtime` 汇总为
212项、205通过、1失败、6跳过；唯一失败为 `test/test-version-controller.test.mjs` 文件进程，
退出码 `3221226505`（`0xC0000409`），`ERR_TEST_FAILURE`，记录仅为 `test failed`，
没有行为断言、JavaScript 错误栈或能定位原生故障原因的转储。
原根 `&&` 链中的 integration 因前序非零未运行，不能把后续局部复跑改写成原根检查全绿。

只读源码检查确认该文件只有两项本地 Fake HTTP 测试：配置好的显式 Fake 模型完成一次受控调用，
以及默认禁止 testVersion 协议；它不会启动真实模型、Laya、业务工具或真实账号。
本页未改 server/controller/原测试/包脚本，也没有删改断言。

按主控授权使用固定 Node 24.15.0、npm 11.12.0 和新建的仓库外系统任务 TEMP/TMP 复跑。
默认 sandbox 的 CIM 只读查询被拒绝，已通过平台 `require_escalated` 原机制完成查询与本地回环测试；
没有绕过拒绝或关闭用户应用。复跑前、复跑结束后的本工作树相关 Node/Electron/Laya 进程查询均为0。
临时目录只用于测试输出，未加入 Git；未读取或输出凭据。

| 复跑范围 | 实际命令和结果 | 原始本地日志 |
|---|---|---|
| 原失败文件，保留原双 reporter | 在 apps/agentarts-runtime 执行原 Node 测试命令，仅将 glob 指定为 test/test-version-controller.test.mjs；2/2通过、0失败，exit0，356.6676 ms | `.cache/connector-test-version-controller-rerun.log` |
| 该 workspace 一次完整复跑 | 固定 Node/npm 运行 `npm run test --workspace=@personal-agent/agentarts-runtime`；保留原脚本默认文件并发及双 reporter；213项、207通过、6跳过、0失败，exit0，8058.2985 ms | `.cache/connector-agentarts-runtime-workspace-rerun.log` |

原聚合中失败文件尚未展开为两项子测试，所以总数212；成功包复跑展开两项后为213。
两次复跑均未重现该原生退出，**原因仍未确定**；这些结果不能证实内存不足、并发竞争或任何其他具体原因。
没有为此新增生产修复、放宽测试、重复全仓检查或启动真实验收。
重测试槽已交回主控；根 integration 的补跑结果由主控另行记录，本节不预先声明其通过。
