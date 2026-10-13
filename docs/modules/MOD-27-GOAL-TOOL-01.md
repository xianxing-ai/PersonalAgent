# MOD-27-GOAL-TOOL-01：目标写入的受控工具薄适配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-27 / PA-024；负责人 `zemeng`。
- 所有权：`packages/goals/**` 与本文；Runtime、Policy、Desktop 和根 lock 保留原分工。
- 前置：Goal 命令 PR #136 head `0cb6e97`；DEP01 Draft PR #152 head `4930d43` 提供可信宿主发起的持久单工具任务、审批恢复和读回。本包依赖该 Draft 的接口形态，不把它当作已合并能力。

`createGoalTools(boundStoreOrResolver)` 复用现有 `createGoal`、`reviseGoal`、图版本 CAS 和
`CoordinationStorePort`，提供 `goals.create` / `goals.revise` 两个 `RegisteredTool`。
已有 boundStore 可直接传；Desktop 可先构造工具并传受信 callback，Application 建成后
绑定单个稳定 store。注册时不解析 callback，执行时缺失或换绑一律拒绝。当前
RuntimeApplication 构造仅注册 descriptor，不执行 host 工具；Desktop 必须先绑定 store，
再开放 IPC 或恢复已批准的任务。该时序兼容 DEP01 在构造中注册工具。
输入包含精确图版本、完整 Goal 字段，修订再包含精确旧 Goal 版本；不包含 namespace。
可信 Desktop 主进程负责固定并持久化不透明用户 namespace、绑定 store，以及由稳定
commandId 生成/校验 sourceRef；Renderer 不能指定这两者。ToolGateway/Policy 仍负责
`goals:write` 范围、参数摘要、审批和一次性授权，工具本身不签发授权。

成功写入后工具从存储按 graphRevision 读回刚提交的 Goal，返回旧/新精确 NodeRef
和 graphRevision，供 MOD-28 选影响及 MOD-11/12 显示。旧版本冲突作为确认的
`kind: 'conflict'` 返回当前图版本，不盲重试；确认为写前非法输入返回
`kind: 'rejected'`。意外写入或读回错误抛给 Runtime 作结果未知/待核实，不能报成功。
工具不提供自动重放/自动恢复承诺；Runtime 的 host task 负责同一 commandId 的任务
幂等和批准后恢复。已发生的图版本历史不会因代码回滚而撤销。

本包仅需定向验证工具 Schema、写后读回、冲突零追加及读回失败拒绝成功；已通过
的 Goal 图、SQLite CAS、Runtime 授权测试复用现有 CI。产品真实验收在 DEP01 集成、
MOD-11/12 Desktop 接线及 MOD-28 影响入口可用后，目标链只集中运行一次代表路径。

本工作树用现有已安装 TypeScript 5.9.3 工具链编译 goals，通过；
`node --test packages/goals/test/tool.test.mjs` 初版 3/3；延迟绑定修订后
TypeScript 编译与该文件定向测试 4/4 通过，未重复架构检查。
初版 `npm run check:architecture`
3/3 通过，`git diff --check` 通过。没有安装新依赖、运行
全仓检查或 Electron。新增包内 `@personal-agent/contracts` 声明，根 lock 登记
归公共接口任务，须在 CI `npm ci` 前完成；本包未修改根 lock。

## Desktop Goal 编辑器身份消费修复（2026-10-07）

本节记录 [PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302) 的续接增量，
尚未合入 `main@4b5ec61`，不改变上文历史、模块状态或权限边界。
[Goal 编辑器](../../apps/desktop/src/features/conversation/goal-view.js) 对异步读回绑定
发起时的草稿、目标选择、活动任务和打开视图；切换目标、编辑草稿或关闭重开后，
旧读回、失败、取消及审批反馈不能覆盖新选择。确认成功后，Goal 身份、内容、原因、
有效期和版本来自同一完整读回；修订仍携带原图/Goal CAS 及依赖，不由 Renderer 写图。

真实受理任务与提交结果未知的锁独立于视图保存。迟到受理回复保留原任务读回入口，
即使任务列表暂未出现也保留已知受理任务；关闭重开不将受理说成完成或允许重复提交。
同一任务的取消、同一任务/审批身份/审批版本的决定在请求进行中保持按钮锁，
刷新该任务不会提前解锁；其他任务的操作独立，旧回复不会解锁其新请求。

[公开控件测试](../../apps/desktop/test/goal-view.test.mjs) 使用实际
`createGoalControl` 配合显式 Fake DOM/bridge。修复前，Task A 的迟到读回把 B 草稿
ID 改为 A、内容仍为 B，生成合法 CAS 的错误目标修订；同一复现修复后保留 B 身份和内容，
错误目标请求由 `true` 变为 `false`。新动作锁回归先实际失败，再通过。
验证分批进行：9/9 后新增重开恢复及迟到取消/审批反馈定向 2/2，动作锁新增 1/1，
受影响取消/审批反馈定向 1/1；语法和 `git diff --check` 通过。
当前文件共有 11 项测试定义，不把这些分次结果记成最终 11 项整批通过。
这些证据不代表真实 Runtime 写入、云、Windows 设备或个人数据现场验收，
独立浏览器消费验收另据实际执行记录登记。

## 有效期精度与未知受理的历史反馈（2026-10-07）

本节仍是 PR #302 续接增量，未将其记为 `main@4b5ec61` 已合并成果。
公开 Goal 的有效期为完整 UTC 毫秒时间戳。此前编辑器只显示到分钟，
仅修订 summary 也会把原有秒、毫秒截断；同一修订仍可能通过图/Goal CAS 并实际写入。
现在 `datetime-local` 使用 `step="0.001"` 和完整本地时间；选择与 confirmed 读回同时
保存控件实际值及原 UTC。未编辑字段沿原 UTC，避免夏令时回拨的重叠本地时刻被
重新解释成另一个时刻；实际编辑时间仍按原本地输入转换与起止顺序校验，不增加时区 wire。

失去提交受理回复后，选择一个已成功的历史任务，只能证明该任务与其目标读回。
当前投影没有将失回复请求绑定到 Host 生成 commandId 的额外关联，不能凭相同输入、
任意成功历史或列表没有 pending 就清除未知提交锁。提示明确区分“所选历史任务的目标
已确认并读回”与“先前提交结果仍待核实，请勿重复提交”；关闭重开、新建草稿仍保留锁。

本次必要验证分为：两个新回归与受影响正常 confirmed 保存定向 3/3，另受影响未知受理
重开恢复定向 1/1，语法与 diff 校验通过；没有重跑上节整批或整个 workspace。
精度回归运行实际 GoalHost、公开 Goal 工具和 `FakeCoordinationStoreHost` 的 CAS/读回；
Task、Policy 上下文、DOM 与 bridge 为显式 Fake。合成 summary-only 修订的原 UTC
秒/毫秒逐字保持，Goal/Graph 均由版本 1 到 2；纽约回拨第二个 01:30 原 UTC 06:30
被保留，强制重解析同一本地值会变成 UTC 05:30。未知受理组合读回后仍只提交一次，
确认文案与保存锁一致。这些结果不证明真实 Runtime、IPC、SQLite、云或 Windows 设备；
原 DOM 的新增消费证据待独立执行后登记。

后续验收沿当前 [Goal 编辑器与回归](../../apps/desktop/test/goal-view.test.mjs)
和既有可信 Host/Runtime 继续，不新增旁路写入：

1. 在已授权的 Competition 环境选一个合法 Goal，保留原图/Goal revision、依赖 refs
   与完整 UTC 起止值。仅改内容，通过原任务审批及 confirmed 工具结果读回新 Goal；
   内容改变，未编辑的起止 UTC 与依赖必须逐字不变，修订仍用原 CAS。
2. 在有夏令时回拨的现场时区，选取重叠本地时刻的第二个 UTC 实例，只改内容；
   记录 OS 时区与原/新 UTC，确认没有一小时偏移。另明确编辑时间，确认新 UTC 与
   用户本地输入转换一致；起止相等或逆序不得提交。保留原控件值规范化的实际 DOM 证据。
3. 在显式 Fake bridge 丢失受理回复的已有回归中，关闭重开并读回所选 succeeded 历史
   任务及对应完整 Goal：提示同时保留原提交待核实，保存/新建仍不能产生第二次请求。
   正常已识别的受理回复与 confirmed 读回则仍允许后续明确修订。
4. 真实现场另行核对原 taskId/commandId、Policy/审批、confirmed Evidence 与
   Goal/Graph 读回；若失回复仍缺请求关联，保留未知结果并沿原 Runtime 恢复，不能将
   上述 Fake 故障注入或独立 DOM 消费当作真实 IPC 恢复通过。没有使用 Calendar 或新 Fact 来源。

后续独立原 DOM 消费（同日）：正式源码工件 `8712599f49bd9f1593d277408e2accfb72c4d77c`，
Goal 控件 blob `32305afb25557b88b10b615cf1b690a6ef666930`，由 Desktop 线运行真实原 panel
HTML/renderer/CSS/CSP、Chromium native 日期输入/对话框与浏览器时区。
三个日期场景（UTC 未编辑、纽约回拨第二实例未编辑、明确修改开始时间）与一个未知受理
历史场景共四个独立场景通过，console/pageerror 均为 0；后者在 375px 下状态可见，
保留待核实文案、保存锁和一次提交。日期运行 head `1ff4631`，未知历史最终报告 head
`19a0228`，控件 blob 相同；这些 head 的 Desktop src 与正式工件一致。
私有工件位于 `.worktrees/mod15-host-20261007/.cache/review-evidence/20261007/`：
`goal-native-time-unknown-validation.md`、`goal-native-time-after.json`、
`goal-native-unknown-after.json` 及同名 `*-dom.mjs` 脚本/截图。
bridge、受理和写入/读回仍为显式 Fake；此补充只将上文原 DOM 待执行项补为该层通过，
不提升真实 Runtime/Policy、Electron IPC、Windows、云或个人数据现场验收状态。

## 主动方案卡片与许可读回（2026-10-07）

同 PR #302 的既有 Proactive 消费增量使用公开 GoalCognitionHost 的结构化状态。
Host 在 apply 等待期间发布新快照、替换卡片后，完成回执现在更新当前卡片；
已识别受理和未知结果跨空列表/重绘保留，迟到回复不能覆盖已核实快照。
已公布的本地分析或出云许可关闭在发起前提示设置，重新开启后可继续；不把
明确尚未发起的请求记为未知受理，不授予新权限。

恢复已有 handoff 时，损坏的 repair binding 可合法返回 waiting_reconciliation
而没有 taskId。此状态仍显示“处理结果待核实，请勿重复提交”并锁住操作，
不能降为“尚未交给主智能体”。只依据结构化 state/status，不解析 executionStatus
文字决定受理；未知状态仍沿原 Host/Runtime 核实，任意历史不清锁。

设置保存等待期间的观察许可可能到期：成功返回后按最新已公布 snapshot 投影四个
checkbox，不用旧 invoke receipt 覆盖撤销；失败则保留用户 dirty 草稿。公开
ProactiveHost.tick 的八小时 lease 到期读回使 enabled/cloudAnalysis 均为 false，
界面保持相同结果，未发第二次 configure 或自动延长许可。

必要验证分批为首个卡片/许可增量 7/7、恢复 reconciliation 的新增 2 项与受影响
mapper 2 项共 4/4、设置成功/失败新增 2/2；不能将这些相加当作一批完整检查。
实际公开 Host 配合显式 Fake Runtime/IPC/时钟及真实表单 DOM，原 panel/admin
HTML/CSS/CSP 和 native 浏览器前后读回均通过，console/pageerror 为零。
私有记录在 `.worktrees/mod15-validation-20261007/.cache/proactive-apply-repaint-20261007/`，
包括各固定 source blob、实际 exit 日志及 before/after JSON/截图；首轮测试空白
断言失败保留。没有修改 Host、公共 wire/Schema 或迁移，也不代表真实 Runtime、
云、Electron、Windows 或业务来源现场验收。

随后对固定集成源码 `42ede95d0bf12f85bf0d363f88e245276ec20fb6`、tree
`4fd88428d425a3207d91e4c396080a0ac51bc7ea` 运行受影响 Desktop 工作区 typecheck 与测试，
两条命令实际 exit0；586 项中 575 通过、0 失败/取消、11 跳过。使用 Node24.15.0、
两核亲和度，日志 `.cache/review-evidence/20261007/core-desktop122-check.log`。
该检查覆盖本节三次增量和原 panel 审批到期刷新最终源码；其后至交付仅变更模块记录，
没有将结果称为根完整 check、Windows/Electron 或跳过场景已通过。

## 本地 KEEP 与已受理回执（2026-10-07 续接）

公开 Fact/GoalCognitionHost 的 `action=KEEP`、`state=local`、无 taskId 卡片现在显示
“保持现状，无需交给主智能体处理”，不触发已知的“没有合法选择”前置拒绝。
门禁仅消费公布的结构化状态，不解析异常文字；已保留的 unknown、accepted、verified
以及 pending/reconciliation 锁优先，不把 KEEP 当作执行或图更新已核实。
新增 2/2、因原 Host helper 增加 KEEP 模式而受影响的默认分支 2/2 分别实际 exit0；
公开 Host/SQLite/Fake Laya 与 HTTP 产生的原 panel AFTER 为 apply0、额外 cloud0、console0。

另一合法回执为编排 task 已 succeeded，但受控修复端口未装配，返回
`status=unavailable` 且含原 taskId。界面按该结构显示“编排任务已受理，受控修复暂不可用；
目标更新尚未核实”；已交接标签和锁不变，无 taskId 的 unavailable 保留未能交接语义。
新必要对照 1/1、原 panel 同一实际回执 BEFORE/AFTER 分别 exit0，
不以 reason 文本判断执行，不改 Host/Runtime 或目标图。证据在原认知私有目录的
`keep-*` 与 `unavailable-accepted-*` 脚本、JSON、实际 exit 日志/截图，Fake IPC 与
真实 Runtime producer 分开记录，均不替代云、Electron 或 Windows 验收。

不确定 Laya 的既有 machine-review 路径仍由主智能体复核，区别于用户审批；
Host choice 文案改为“Laya尚不确定，需主智能体复核 (RECHECK)”。仅修改一处文字，
判定/许可/交接不变，语法与 diff 校验通过，没有新增或重复正式测试。
公开 Host snapshot 配合 Fake Runtime 的原 panel native 读回在许可前后均显示新文案，
实际 exit0、call0、console0；原实际 Runtime 路由 producer 的一项 Fake HTTP/succeeded
证据另记，不能称该文字读回阶段重新执行了 Runtime 或云端。

Goal router 的 targets.summary 是原节点 baseline，不是旧 Fact 的 requestedSummary。
actual Host/Public Runtime 的 4096/5000 字符对照发现合法 5000 baseline 在不足 32 KiB 请求内
被旧 4096 限制拒绝；现在与既有 nodes.summary 一致使用 8192 上限。
原 deterministic verifier 新增 direct Goal 边界、旧 Fact 4096/5000 及大 wrapper 拒绝对照，
实际 exit0；独立 goal-with-tools 的 8192 字符、总请求 32 KiB、公开 adapter 总预算与
候选输出限制保持原值。源修复不代表新版本已部署或所有 8192 长摘要可通过总预算。

上述源码与 Evidence 详情/分页增量的受影响 Desktop 检查固定
`cfbdce670283ef52914c2fc040af1e01dad9b2e2` / tree
`0c9ef9db1784c41aede94088828283fb250e87ca`：typecheck 与工作区测试两条命令实际 exit0，
594 项中 583 通过、0 失败/取消、11 跳过，Node24.15.0、两核，
完成于 2026-10-07 20:31:50 UTC，日志 `core-desktop126-check.log`。
这不覆盖 Windows CI：前 f584 的 push 在默认子任务候选恢复 1.0→1.0 分支失败，
相同 head 的 PR CI success；原断言的本地定向 5/5 通过仍未解释 Windows 失败根因。

## 影响原因的实际节点与状态（2026-10-07 续接）

Goal/Plan 影响原因按公开 ImpactCause 的 `superseded`、`withdrawn`、`not_effective`
显示依赖版本更新、撤回或当前不在有效期内；其他原因保留状态变化说明。
此前统一写成“事实变更”会把 Goal 版本变化及只随时间过期的 Plan 原因误标为 Fact。
仅修改 snapshot.trigger 的显示文字，未改变选择、版本校验、云许可或交接。

固定 Host blob `d4401236dcecaec84a4bf1d2111f4a74cd875628` 的实际公开
Goal/Fact/GoalCognitionHost、SQLite Runtime 与显式 Fake Laya 读回覆盖 Goal1→2
及 Plan 过期：无新 Fact，graphRevision 仍为3、dispatch0。原 panel/CSP 文案读回
实际 exit0，操作保持禁用、bridge0、console/pageerror 为零。语法及 diff 校验通过，
此低风险文案没有新增或重复正式测试。私有证据为认知工作树下
`goal-plan-cause-*`；首轮错误选择器超时也保留，不将该项提升为真实云或设备验收。

## 新到期分析与待云许可 Goal 分离（2026-10-07 续接）

公开 Fact source record/drain/process completed receipt 和公开 createGoal 命令的实际
对照发现：Fact 水位及 receipt backlog 已清空后，旧 Goal 已有本地选择、等待云许可，
每次 idle consume 都返回该旧 review，导致独立的只随时间到期分析一直未启动。
同图仅开启云许可才出现 expiry，违背本地持续认知与云交接分别授权的边界。

核心 producer 仅让尚未记录 exact expiry trigger 的第一次本地分析，在较旧 Goal
交接重放之前取得一个计入 request.limit 的名额。新 Goal 与 Fact backlog 仍优先；
任何已记录 expiry 都沿原零-review fallback，不反向占据 Goal 恢复名额。
保留原任务稳定 key、Fact cursor、fullgraphRevision/CAS、云许可及历史 checkpoint，
不新增持久队列、不改 TaskRuntime/FactHost/Policy，也不宣称普遍调度轮换。

固定 producer blob `a1f14df4a1cdc16b2eb99bd927a3be105ada5de6`、专属测试 blob
`b0a9613653692ef4888a636af8a56b62a5c70e00`，认知线在私输出编译该新 producer 后，
Host suite24/24实际 exit0：覆盖limit1、新Goal优先、旧expiry不可受理不挡Goal、
SQLite重启与分开许可的两个原 handoff各受理一次，图及cursor不变。
实际公开 DesktopHost 消费在 cloudfalse 下 infer2/dispatch0、随后许可 infer仍2/dispatch2，
graph始终3；Laya/HTTP为明确Fake、时间注入，未运行 Goal.create 的UI IPC或DOM现场。
认知私目录 `expiry-fairness-frozen.json` 保存私编译出口、baseline依赖、命令与实际退出
回执，`public-goal-pending-expiry-*` 保存公开消费者前后；初次错误createGoal签名日志保留。
根集成检查与真实模型/云/设备验收另记，不把旧599项结果借给新 producer。

上述新 producer 与公开 progress 消费集成后，根 `npm run check` 固定
`874e38ef7267fc22b71315e0d6810134a43767c4` / tree
`10ee9a784ec399f395bdc6bfee4cb6ea2a07a830` 实际 exit0，
完成于2026-10-07 21:24:31 UTC：34组2455项、2405通过、0失败/取消、50跳过，
其中工作区2376通过、根integration22、architecture3、contract fixtures4。
Desktop603项592通过/11跳过，Runtime419/419；Node24.15.0、两核，
日志 `core-cognition-desktop130-full-check.log`。其后至ebfb1a9交付只追加自有研究/模块
记录，source/tests相同；此检查不覆盖下面续接新源，也不把跳过、Fake或Linux结果
当作真实云/Windows验收。

## 来源版本提示与已提交修订消费（2026-10-07 续接）

来源版本变化现在由 Host 每次 snapshot 的一次公开 store.read().revision 读回逐卡显示。
只有合法非负 safe integer 的 review.graphRevision 不同才标记 sourceOutdated；false
不证明当前许可或目标有效性。在已有回执、KEEP及许可反馈之外，旧方案卡显示
“来源版本已变化”并禁用提交，点击前再次
核对；已受理、verified、pending、reconciliation 与保留的 unknown 回执优先，不因
后续图变化被覆盖。此提示不持久保存成终态，不自动重新分析或重发，原 applyDecision
的整图 CAS、版本拒绝与云许可保持不变。

固定四文件 blob 为 Host d5d597bbfa5a3653a7e833edc47d7d5c9dc6b4dd、控件
3424e89e7a22775b111a2a0fe2eca1eb2adfdae6、Host test
bc8eaad4e7c90609e7633dff3d14aaa244c822f4、控件 test
cdea490f1d90e282e5f806123834d662519f37e4。定向33/33实际exit0；实际公开 createGoal、
Fact source record/drain/processImpacts 与 SQLite AFTER 为 graph2/infer1/dispatch0，
仅旧 Goal 卡标记 true，当前 Fact KEEP 为 false，整体仍 reviewed。原 panel/CSP 通过
明确 Fake IPC 消费该实际状态，禁用且 apply0，console/pageerror为零。私证据
source-outdated-frozen.json 保留编译/出口映射及错误探针尝试；后续独立验证在同一个
已打开的 RuntimeApplication 上重建 Desktop Host，并在既有 nextTick 和 Fact backlog
后恢复同 reviewTaskId。这不是完整 Runtime/SQLite 关闭重开或 Goal.create IPC 验收，
不借初轮错误探针声称缺卡。
此项不解决稳定 Goal review 的重新分析/继任合同，不放宽 CAS。

另一个独立公开 producer 对照发现：合法 GoalCloudHost goals.revise 把 Goal 修订为
withdrawn 后，旧 Plan 精确依赖可由公开 reviewGoalRevision 选为 RECHECK，但 idle
发现过滤只接受 active/effective，因而漏掉该修订。同样合法的 future有效期修订也会
漏掉依赖旧Goal的Plan。核心 producer 将 revision>1 已提交 head 交给既有 Goal revision
review；首次 inactive 或 future Goal 创建
仍不进入规划，无受影响 Plan 时 KEEP 不调用 Laya。有受影响 Plan 时只复核，不复活
Goal 或修改 Plan，原 limit、Fact cursor、backlog、稳定身份、expiry、CAS 与许可不变。

固定 producer 594c458e2aeab3ba7d0e5a588b59316d93db617a、专属 test
9ba3d23025ab50c784b00b87a93dacbb161af9cc，私编译和26/26专属测试实际exit0，覆盖
inactive/future creation、future/expired修订各有无Plan、KEEP/RECHECK、SQLite重启同id、
恢复许可后单次handoff及图不变。公开命令与实际 GoalCloudHost 的撤回 BEFORE/AFTER
独立保存；新有效期 producer 的 actual adapter future BEFORE/AFTER 同样从
idle[0,0]→[1,0]、infer0→1，active/withdrawn 对照不变，图3/dispatch0。
Plan/Laya 与 ToolGateway context 为明确合成/Fake，公共 Goal tools/SQLite 为真实本地
出口，不是 Policy ledger或实云验收。validity-revision-frozen.json 固定新编译 producer，
旧 withdrawal/source-outdated/expiry 私输出保留；根必要检查另记，不借固定874的2455项。

## 合并修订后仍未复核的Goal祖先依赖（2026-10-07 续接）

实际公开GoalCloudHost消费者先建立Goal1与依赖它的Plan，再在首次idle前合法提交
Goal2、Goal3。旧入口严格处理最新2→3，因而KEEP/affected空/infer0，完整影响分析却仍
对Plan的Goal1旧pin报告RECHECK。保留原连续修订及repair函数逐字节行为，新增本地
selectGoalAncestorImpact/reviewGoalAncestorImpact：精确graph/currentGoal head，只选旧pin
小于current-1的superseded RECHECK，并剔除原入口已覆盖的整个item；mixed因果不重复。
空差集不创建任务或调用Laya，新trigger身份绑定当前Goal与排序后的精确消费者refs，
不同合法ref属性顺序归一化，旧choice/稳定key不变。limit1仍有界，未记录差集优先于
旧pending handoff；同scope SQLite重开不重新选择，恢复许可handoff仍一次受理。

EXACT5源码/出口/测试在ancestor-exact5 manifest固定，SHA
1d22a6c9cca4b75cf5502f6513681f1bfc5a645199a1d3879623937291bc409d；
两受影响测试文件36/36实际exit0，覆盖旧入口拒绝、混合范围、stalegraph/head、空范围、
重放/新消费者身份、limit1与ref属性顺序。公开producer AFTER graph4保留原KEEP并新增
祖先RECHECK，infer1/dispatch0、第二idle为空；单次修订graph3行为不变，不写Plan。
既有Desktop投影消费实际新review：合成private Fact两个revision在本地参与cause但
出云均省略，REVISE仅一个精确repairContext目标；FakeHTTP发送一次、graph6不变。
Desktop源码和原整图CAS/permit/digest复核未改，祖先触发不伪装成Fact收据。
ToolGateway context、Plan/背景、Laya与HTTP明确合成/Fake，Goal工具/SQLite为真实本地
公开出口；不提升实云/Windows验收。首次规划前Goal已修订、Plan自身到期的另份只读
证据仍为未接入范围，本次不放宽rev1首次规划或public Fact expiry契约。

## 原窄屏方案卡片与本地整仓检查（2026-10-07 续接）

原320×480 panel消费实际已受理Host状态时，长Fact来源引用令thread横向scrollWidth
396而可用宽318，卡片378而可用宽274；420宽卡片也有378/374的横溢。
仅为触发原因和方案两个段落复用既有assistant-message类，控件blob由
3424e89e7a22775b111a2a0fe2eca1eb2adfdae6变为
4fc387698fdb753a697624dc63904a6035a242b2，没有修改CSS、事件、转义、许可或CAS。
原HTTP/CSP panel在320/420的12项AFTER均无横向溢出；实际受理引用与明确合成长无空格
方案分开记录，accepted/unknown锁定、stale/permit拒绝及KEEP反馈保持。
复用panel类也令字体为14px/1.8，长文本卡片变高，仍通过原thread纵向滚动到达按钮；
不声称全部内容同时可见或每个按钮像素严格contain，原320边缘约0.109px舍入保持。
私narrow-panel-frozen.json固定源码、探针、前后JSON/日志与24张截图；独立审查核对
全部40个source/artifact SHA及关键截图。IPC明确Fake，workspace/admin布局未浏览器验收。

固定23ad629/treeeac85fde的完整npm run check在22:02:16Z实际exit1：33组2438项、
2386通过、1失败、1取消、50跳过。唯一独立失败是未改动GitHub repair-link原1000ms
子测试超时，其父项聚合为失败；root integration未执行。Desktop606项595通过11跳过、
Runtime421/421。日志core-cognition-revision131-full-check.log保留；同head原文件隔离
71/71实际exit0仍不是整仓通过，也未确定原失败根因。后续新源码必须另作必要检查。

后续固定5946141d3916cd5c0b5600e380185cdc7d3cc534/tree1183d52c的必要完整检查实际exit0，
2026-10-07 22:47:26 UTC完成：34组2469项、2419通过、0失败/取消、50跳过；
Desktop608项597通过11跳过、Runtime426/426、root integration22/22，构建/类型/架构/
contracts/generated门禁均执行。Node24.15.0、实际4CPU，原断言和期限未改；日志
core-ancestor-reference137-full-check.log SHA256
db9cb86a352e0d122dfdf2a71de1533d2f03bf2e89bc826fe74524b4a9cff5a8。
包含前述来源/有效期/祖先差集、窄屏与参考工具pending修复；5946141到已发布a5b5bbd
仅本DOC结果行改变，source/tests相同。原23ad失败仍保留，不据本次通过认定其根因，
也不覆盖后续新增源码。

## 首次规划前已修订的未复查目标（2026-10-07 续接）

合法公开Goal1创建后、首次idle前修订为Goal2且无历史规划，原连续修订入口保存KEEP，
不会进入首次规划。新增本地reviewUnplannedGoal只接受精确当前graph/Goal head、rev>1
且active/effective，排除同namespace任何可信Goal相关复查intent和曾依赖该Goal任一版本的
历史Decision/Plan；后来的依赖重绑不擦除规划历史，无关Plan不阻塞新Goal。
原rev1、已selected/unavailable/真实failed/KEEP选择保留，不重新规划。身份绑定精确Goal，
ref属性顺序归一化，先恢复同scope；idle采用固定分页task快照，旧初次选择不能遮住后来
新增的连续修订/祖先消费者。历史依赖用stack/visited遍历，不引入递归深度假设。

Runtime producer/test EXACT2冻结manifest SHA256
9e4a39d8d6fe6715df569f1904fac4e2493990d78fb81be49be79c920c7f1854，
14项artifact及两源码hash独立核对；受影响host文件38/38实际exit0，Runtime构建通过。
实际公开producer六矩阵中never-reviewed/unrelatedPlan由KEEP0infer变为subjectGoal2
RECHECK1infer；其余旧复查/历史规划矩阵保持，second idle不重复，graph/旧choice不变。
所有首次选项仍RECHECK、affected空，不追加Plan或伪造Fact收据，不更改DTO/schema、
permit/整图CAS、Fact cursor或Plan自身expiry合同。

未改Desktop的实际project/assertCloudSend消费新review，FakeHTTP1send/1infer、graph4；
公有Goal当前摘要及hashedid进入原nodes，private Fact2仅背景并省略1来源，无private正文/ref。
另一个实际本地GoalHost工具消费者有两条原Policy allow/confirmed写收据：cloudGoalConsent
保持off，Runtime watermark规划一次，Desktop原revision marker另保存KEEP但不再次规划。
同Runtime重建DesktopHost且grant不恢复后不重发；此时UI仅恢复旧KEEP，不冒称所有卡片
恢复或完整Runtime重启。Goal工具/SQLite/本地Policy为实际出口，Laya/HTTP/背景明确Fake。
新Runtime源码合入e9cb64b；后续根完整检查另记，5946141通过不覆盖本节新源码。

该实际消费者还发现首次规划defer出云策略错误沿用“保留当前计划”。Desktop仅两处
表达式：subjectGoal的defer改“暂缓首次规划，安排后续复核，不执行目标”，rev>1卡片改
“待首次规划目标”；rev1标签和无subject影响范围的defer原样保持，不声称整个图无Plan。
goal-cognition-host.js最终blob fdeb8754369f09550854ca21f92aa46f166b0824；反向两表达式
逐字节恢复原文件。三项实际before/after分别覆盖Goal1/Goal2初次规划和Goal3祖先Plan
影响范围，均1infer/1FakeHTTP，graph2/4/6不变，private来源省略1/1/2；wire除strategy
全部逐字段相同，原影响范围策略/标签不变。冻结manifest SHA256
0b26860ffc6ad79b91e15a4eeb6616541e29cfe28ad34a0b8d6ca6fb05dc70a9；21项artifact，
新AFTER报告复制的boundary/case元数据纠正记录与旧原件保留，实际observation/log未改。
低风险文案不增镜像正式测试，syntax/diff通过，projection/CAS/permit/handlers保持。

本批固定d654295c8c1cb73abdcf6f9b95030d371728f4e9/tree183beac055e440c3的完整
npm run check于2026-10-07 23:16:02 UTC实际exit0：34组2476项2426通过、50跳过，
失败/取消0；Desktop608/597通过11跳过、Runtime433/433、root integration22/22，全部
build/type/generated/contracts/architecture门禁执行。Node24.15、实际4CPU、原断言期限
不变；日志core-initial-planning137-full-check.log SHA256
7444f126386ada32dfa0218774f6aa35325b1054bfc2c7c385a9164988ea3250。独立完整日志/
34组和源码集成读回一致；不解释23ad旧超时，也不覆盖本批之后的控件/卡片恢复新源码。

## 保存 Goal 卡片的显示恢复（2026-10-07 续接）

上节本地消费者实际保存的初次规划 review 没有旧 Desktop marker，重建 Host 只显示旧
KEEP。恢复入口保留旧 marker 扫描，另用 public runtime.listTasks 在同 proactive namespace
固定快照分页100，接受精确 v1 四类 Goal intent 与 task/namespace/review 绑定，并去重。
无 review、错误 namespace/kind/binding 均忽略；恢复已有 choice/receipt/status，不产生
新的 infer/repair/handoff/出云或许可。任务无需 succeeded，合法 waiting_reconciliation
卡片也可显示；Fact/meeting 通用 intent 不被纳入，当前 sourceOutdated 优先关系保持。

仅 goal-cognition-host.js 与已有 test 两文件，源码 blob97a58846、test2395dd5c，冻结
manifest SHA256 539e668617056fc69e9efcb2dfbc74f8b4d19bbbbe3fe036016b3fa8da8fcdeb。
新增两项测试原源码0/2实际失败，修后2/2、受影响文件18/18；包含实际 Runtime/SQLite
关闭重开且不恢复权限的正式案例。另一次实际本地 GoalHost/Policy confirmed 工具消费者
before/after：原两卡同 id 和旧 handoff receipt 均恢复，重建后 local-only tick 不增调用。
该消费者仍明确 Fake 模型/HTTP，不将显示恢复当重新授权或真实云验收。

根 dcfcf6bc/tree6f0edd11 的完整 Desktop 检查18527/1470c2实际0、612项601通过11跳过；
日志 SHA256 3afda5190a65e169d20caa13ed2df6e0830c38035e09b67c8526ebebe67c20bc。
独立审核冻结10artifact及原读回链，未改变 Runtime producer/Plan expiry/稳定 review
重新分析合同。本节 Desktop 检查与上节 d654 完整2476项分别记载，不挪用整仓覆盖。

## 已受理但丢失回执的卡片恢复（2026-10-08 续接）

实际原Client/Runtime受理任务后，明确Fake delivery仅丢submit回执，Runtime已有原
idempotency任务和HANDOFF checkpoint，Desktop marker却未写，重建后原卡缺task反馈。
record在marker确实不存在时，仅对同namespace/binding的四类Goal intent读取持久HANDOFF，
严格reviewTaskId/selectionDigest/exportPolicyVersion/确定性commandId，再通过public
findTaskByIdempotencyKey核task conversation/goal。原Desktop marker优先，present-malformed
不被fallback替换；不重发、重推理、写marker或恢复当前许可。过期dispatch deadline不
抹掉已经受理的历史task receipt，created/running/succeeded分别按实际任务显示。

host/test EXACT2首批冻结manifest SHA256
04d12636e92ccbf24103b877f6ec2307c262e8f7a432d011588ca6f4c5f4a30e，sourcefc536133/test8d9770f4。
最终immutable原源码回归1pass3fail，修后60931/47e4fe actual0、22/22。原公开Goal/Policy
两confirmed工具写入、SQLite/原Client/实际Runtime的after320b4e actual0：恢复精确受理
task及原KEEP两卡，1infer/1FakeHTTP、private省略1、defaultgrantfalse，marker仍不存在。
这是同Runtime重建Desktop的故障注入，不是真实IPC故障/Runtime重开/云验收；Task succeeded
也不说明所有step已终态或Graph已更新。首两个held-helper中断actual1及原before24.19
均留历史，最终正式/after使用Node24.15。28artifact核实后另保存将随根构建变化的旧
compiled producer原字节；此记录不依赖它之后仍停留在旧版本。

同一after原观测还显示未重建时卡片仍缺task反馈。第二个最窄增量只在handoff await抛错
后一次readonly record(readReview)+onUpdate，并原样抛出同一错误；内部读回/通知失败也
不替换原错，正常路径不重复record/submitRepair。原源码新增两回归1fail1pass，最终
55204/527633 actual0、24/24；新public after03e418 actual0，同进程卡片已有精确受理
task/status，同时原丢回执Error仍交调用者，infer/send均1、graph4/两卡/私有省略保持。
未受理的普通拒绝不伪造task；关闭/撤销不恢复permit，原已受理任务的reconcile返回合同
保持。冻结manifest SHA256 64c60540e864f95b733ff2c4c52a418395f6aaaf0b3dda0d9a5a1409f74aa8aa，
source2f395759/test25524830。17artifact明确消费者实际仍加载旧compiled bf211而非仅凭
新TS版本，后续根完整check另验证已集成新producer；初helper误判撤销后应reject的actual1
保留，不把原API合法受理返回改成失败。

## 祖先复查身份不依赖系统语言（2026-10-08 续接）

原默认localeCompare让相同Unicode Plan refs在en-US与sv-SE进程中顺序不同，真实SQLite
重开后同graph5/Goal3创建第二ancestor task并再次infer，旧choice未被改写。仅ancestor
消费者按code-unit id/numeric revision复制排序，新scope和旧INTENT identity及scope比较
双方canonical，保精确集合/重复项数与原ref字符串；既有fallback恢复原task/INTENT/choice，
不写旧数据，不改consecutive/Fact/expiry/CAS/隐私/许可/limit合同。

producer/test EXACT2冻结manifest SHA256
241a303fcea5f743adc48aa3d97f92687c571739dd44db76e690e91920f2657d，source818e6553/test746a860c。
新增回归旧源码59d5c5 actual1；修后新2/2、受影响文件40/40及Runtimebuild actual0。
正式双向worker明示Intl.Collator注入；另一未选择的legacy INTENT恢复原id且chooser一次。
原失败DB保留两task。新独立DB用精确旧compiled producer经public GoalHost在en-US保存
原1task，fixed sv-SE真实进程/SQLite重开eac6c3 actual0：同fc3b50c0 task、INTENT/review
逐字不变，graph5/ancestor1、idle[]、infer0/dispatch0。公开工具context/Plans/Laya明确
Fake/合成，无Policyledger、真实云或Windows默认locale验收；30artifact及两DB独立只读核对。

## 完整 Goal 影响范围超过可选修复候选上限（2026-10-08 续接）

原公开 Goal 工具合法更新被101个 Plan 引用的 Goal，完整 publicImpact 已有101条 RECHECK，
但默认可选结构修复候选的100-target上限使自动复查 task failed，尚未进入语义选择。
仅在完整 scope 超过100项时跳过该可选候选，仍以全部精确 affected 提供原 recheck/defer；
100项边界保留原 revise 候选。未截断 scope、拆任务或提高公共修复上限，custom
prepareOptions、身份、CAS、隐私与许可合同保持。既有 failed task 仍为终态，本修复
防止新的合法范围失败，不迁移旧失败数据，也不新增自动重试。

producer/test EXACT2 manifest SHA256
d4e9a8191f96ab1c0c58709e4ac2d08b5627f2cb5499ae9d7e5f56b2672597ba，source02dde507/testaa3245a4。
旧源码新增100/101边界回归 b2faee actual1；修后84c5a3 actual0，包括真实SQLite重开后
同task/choice及推理一次；受影响文件1f4fcc 41/41、Runtime build9a5283 actual0。
fresh公开工具 after bb0c34 actual0：graph103、完整101 affected、仅recheck/defer、
infer1/dispatch0。原failed DB及全部11个before artifact逐字保留，32artifact独立核实。
工具context/Plan/FakeLaya为受控消费者，不称Desktop投影、Policyledger、真实云或设备
验收通过；后续根固定HEAD完整check另行记载。

同轮另外经原公开Goal/SQLite、原Desktop project及AgentArts adapter核大范围导出边界：
101个Plan与两版私有Fact的图为graph106，本地101项RECHECK/1infer；projection完整103
nodes、私有版本省略2、无repair context，但goal为24338字符，超过原16000文本上限。
实际cloud task失败外层EXTERNAL_FAILURE；同原journal goal直接调用公开adapter确认内层
INVALID_ARGUMENT。auth/hook/HTTP均0，probe自身exit0仅表示成功观测拒绝，不是云交接
通过。不截断、不扩大DTO或出云上限。只读manifest a75a599e及8artifact/A独审分别保留。

## 本轮已集成源码的完整检查（2026-10-08）

固定d3cb172cce433069e5a72dc1187430e4e25e776b、tree
f4fc3c6c01fb15ee0a395e0fad0d9d52de713b07，原npm run check在Node24.15/实际4CPU、
原断言与期限下5746/d08bc9 actual0，于00:19:47.508Z完成：34组2497项、2447通过、
0失败/取消、50跳过；Desktop626/615通过11跳过、Runtime436/436、root integration22/22。
构建、类型、生成、合同与架构检查均执行；原log 246437B，SHA256
eb1d56b2433236efeb708528d903d3af7bd70871f827aebf34ffd30c9fe83323。
本结果覆盖上述Goal回执/即时反馈、locale/101及Live/手动录音集成源，不覆盖随后
reference停止pending增量。手动SDK9+官方离线2例仍独立记录，不计入此自动测试数。

## 精确 Unicode Goal ID 的分页与受理任务面板登记（2026-10-08 续接）

Goal 导出原先用 localeCompare 排序及推进游标，合法且不同的 `a\u0301` 与 `\u00e1`
会比较为相等，limit=1 的遍历遗漏后者。仅统一为原字符串 code-unit 排序与 afterId
比较，不归一化 ID、不新增游标或迁移。排序由 locale 改为固定顺序；跨版本旧游标
不保证同一快照，原 filter、scope、limit、许可与 Graph/CAS 合同保持。
EXACT2 manifest SHA256 6291f99d393b180bcc63ab1bb24144fb840a252596735009ecdaba5c9302355c。
正式旧源码98bdc4 actual1；修后71636/1c7955 actual0、4/4。fresh public after
98911/83241a actual0：原 SQLite 真正重开、新会话明确授权后遍历全部三个精确 ID，
get/graph 对应，撤销拒绝，无新 graph 写入。Gateway context 明确 Fake，不是云或
Policy ledger 验收。根已整合7a2dd6a，不挪用此前完整检查结论。

原 Goal task.submit 已受理而回执丢失时，卡片可恢复 task，但原 main 的 panel 过滤
还缺 onTask 登记；重建 Host 后正常受理的旧任务也缺该登记。只在同一 Host 内以 Set
先记录通知尝试，让正常 dispatch 与已验证 submitted receipt 共用原最小元数据通知，
卡片先保存后再通知；不重发任务、不恢复云许可，不改 main、过滤器或公共协议。
通知可能部分持久化后抛错，同 Host 不自动重试；原 delivery Error 保留，新 Host
可以恢复历史登记一次。这不证明失败通知已完成持久化。
EXACT2 manifest SHA256 2ab26c96f2ae03743d3c47fa2d8444f075bda51c9add57122afe289b0fbdde7c，
source3bc48182/teste1c7fb61；旧正式33963/fb38ca actual1，修后18781/85d4a3 actual0、
27/27。fresh 原 main AST snapshot/filter/onAnalysisTask、原公开 task.list 与持久
Conversations after46301/c14ff3 actual0：精确受理 task 出现在 panel，通知一次，
持久 turn 可重读，infer1/FakeHTTP1/graph4；原 Goal 工具与 Policy 两条 confirmed
写入保留。其他模块快照与 IPC 明确 Fake，非 Electron/真实云验收；task succeeded
但 step 仍 running、evidence 空，不能提升为图更新已 verified。根3b309d已整合，
后续固定 HEAD 完整检查另记。

## 公开 Fact 到期复查跨语言恢复（2026-10-08 续接）

原 expiry 的 Fact/consumer 身份依赖 localeCompare；相同图在 en-US 保存任务后，
sv-SE 真进程/SQLite 重开产生第二 expiry task 并再次推理。仅 expiry 新身份使用
精确 ref 的 code-unit/numeric revision 多重集顺序，并用同一 canonical identity
查可信旧 INTENT，保留项数及重复项、namespace/binding 与旧 checkpoint 字节。
历史 expiry 在 limit=1 不再被误作新工作抢占 Goal 恢复槽；新增 consumer 范围
仍产生新 review。原公开 Fact selector/到期时间/cursor、Plan/Goal/其他 trigger、
100-target 修复边界、CAS、许可、handoff 与 terminal failed 合同保持，无迁移。

EXACT2 manifest SHA256 b04194927206104ac69a5ca24a9cd3f74c567f7214b0c6badf328f5154ecdf0b，
source4f95bf7c/testcd1d20ec。Node24.15 portable 旧源码23394/696bd6 actual1；
build2969/72dbac、受影响文件42887/9a69ed actual0、44/44。独立旧 compiled
b4f658b7 与原 TS ESM emit 逐字一致，新 one-task 数据库用它在 en-US 创建，
51051/fe2f21 actual0；fixed sv-SE 真进程重开4c1c19 actual0，同原 task
2b310c13、review/choice/INTENT/所有 rows/graph3 完全相同，infer0、dispatch0、
cursor1。原坏两任务 DB 和不合格/诊断日志保留。32 artifacts 冻结核对；公开
Vault/SQLite 为实际本地消费，Plans/Laya/context 为合成 Fake，不是 Calendar、
真实云、Policy ledger 或 Windows 默认 locale 验收。后续新固定 HEAD 全仓结论另记。

## 本地计划修复的原面板审批入口（2026-10-08 续接）

原 local repair 任务已 waiting_approval、原 approval.list 有 pending1，卡片也有
repairTaskId，但任务未登记原 panel 元数据，原 main 过滤后缺失，Renderer 按任务
遍历的审批入口因此不可见；admin 无 surface 过滤，原管理入口仍可恢复。
仅在 submitRepair 保存原 marker 后，以及 record 经既有 repairTask 验证历史绑定
后，共用 per-Host once-attempt 的原 onTask 通知，使用固定本地修复描述。错误 marker
保持 reconciliation、不通知，不改原 task/INTENT/marker、Policy、审批、CAS 或执行。
通知可能部分持久化再失败，同 Host 不盲重试，原回调 Error 保留；新 Host 可恢复一次。

EXACT2 manifest SHA256 64b6ec05d0f170caca8137ee5caa6a3cee34b4dc8d2df71fac974a301e78d15c，
source0883b3c7/test09e95651，21 artifacts。Node24.15 旧3回归88670/0d8d94 actual1，
完整受影响文件57543/0cdfed actual0、30/30。fresh 原 main callback/filter、真实
Runtime/Policy/SQLite、公开 task.list/approval.list 和原 approvalCards
3417/95cc0b actual0：repair waiting_approval、pending1、panel/admin 均可见，原
allow_once markup 有入口；cloud panel 仍可见，通知各一次、infer1/FakeHTTP1、graph5。
未点击审批、未执行修复，重建仍无云许可；Fake Laya/HTTP/credential 和合成 Graph
明确标记，不是 Electron/真实 IPC/云或物理 Windows 验收。诊断 loader/compiled drift
失败保留；前1f548完整检查不覆盖本增量，根后续固定源码再验证。

证据路径精确更正：原before-v2清单8项中7项原路径连续保持；生成的extracted fixture路径被after生成器复用，99fc2f6/9020B变为426d17a/9268B。原before JSON/log/DB/producer及final21项未变，旧清单未重写。以冻结原testbase和纯AST提取逻辑在独立路径严格重建原99fc字节（638e66/0），保存两版；这不是原路径连续保留或重跑原测试。补充manifest b9b2d985cbbd707225e25e08a92e660ccabb6788fc05e5e827543655d4e7863e，4项逐hash核；D独审4d6b6975确认。
