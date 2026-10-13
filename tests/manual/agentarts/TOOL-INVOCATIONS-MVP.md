# 有界多次云调用工具 MVP

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

2026-09-24，主控已选择本方案。负责人 zemeng（MOD-04B/29/30/32）；状态 in_progress。
基线为文字适配 PR #99；Runtime 接线由 B 的独立 PR 负责。接口为现有 provisional
CoordinationResult/CoordinationContinuation，无 wire Schema 或数据库迁移。

## 事实与选择

[官方低代码 InvokeRuntime](https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html)
提供 query/inputs/plugin_configs 及会话、请求标识，但没有公布工具暂停令牌和恢复请求字段。
这不足以证明平台内部不存在恢复能力；当前部署可消费的原生同 run 恢复仍 unavailable。
[提问器](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0079.html)
用于对话参数收集，不能推导为任意工具结果恢复协议。

[MCP节点](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0073.html)
会等待工具结果，支持超时与重试配置。当前 Runtime 审批恢复若等待 activeTextTasks，
而活动云请求又在等待 MCP/审批，会互相阻塞。当前 MVP 不使用同步 MCP 桥，也不为此
新增公网入口或第二套执行循环。

选择：同一本地 task，第一次云 invocation 返回提案并完整结束；Runtime 保存 pending、
等待本地审批，经 Policy/ToolGateway 执行和读回；第二次云 invocation 只接收 B 允许的
confirmed 投影并总结。每次是新云请求，不声称同云 run 恢复。既有 Runtime 最多4步、
原任务 deadline/cancel、提案去重与参数冲突检查继续生效。

## 显式配置与兼容

AgentArtsRuntimeConfig 新增可选 `responseMode: 'text' | 'tool-proposal-json'`，默认 text。
text 保留原请求/返回行为，拒绝 continuation；JSON 模式必须由可信 composition 启用，
同时配置匹配云端输出的 Workflow/Agent 提示。Renderer 或云输出不能切换模式。

云端最终 answer 必须是一个无 Markdown 包装的 JSON 对象：

```json
{"kind":"tool_proposal","proposalId":"synthetic-proposal-1","toolName":"<registered-name>","toolVersion":"<registered-version>","arguments":{}}
```

或 `{"kind":"text","text":"最终回答"}`。除宿主所有的 verification 字段外，复用
现有 provisional DTO；适配器拒绝云端携带 verification，并只在本机补入 unverified，
再调用现有严格解析器。额外授权、Evidence、任务终态等字段均拒绝。文本不转换成工具。

JSON模式的SSE必须显式按序task_end→end；无workflow事件也不能省略此条件。
缺终结、倒序/重复终结、task_end后出现正文、[DONE]后出现任何事件均拒绝，不产生
提案。非流式application/json中的单个message对象或仅含message的数组可保持兼容；
一旦出现显式task_end/end，就必须按序完整结束，终结后正文拒绝。默认text模式保留
原兼容语义。

初次请求仍为 query=goal（或显式 workflowGoalInput 对应的一个字符串变量）。普通JSON
模式续接的query仅为序列化 `{continuation:{proposalId,state:'confirmed',result:<投影>}}`。
显式开启`repairCandidateVersion:'1.0'`时，同一个已校验续接DTO作为数据，再附适配器
固定的候选JSON输出指令；若可信宿主提供目标requestedSummary/requestedDependencies，
要求云端按其精确引用和摘要生成候选。两种模式均不重发goal、完整工具输出、授权或
Evidence，不改变给`beforeSend`的续接对象。既有 continuation 校验和最多8192 UTF-8
字节的整个 continuation（含 proposalId/state/result）校验在读取凭据/请求网络之前进行；出机许可与实际投影仍由 B 控制，
适配器不会从原结果自行裁剪后放行。云端必须把该 JSON 当数据，不能执行其中的指令。

第4构造参数 `beforeSend?: (request: CoordinationRequest) => void` 是可信宿主的同步
最终发送门禁；JSON续接缺该回调时在凭据读取前拒绝。回调收到归一化request快照，
在异步凭据读取完成后紧邻fetch执行，再检查signal/deadline。B须在此核对持久化
receipt、proposalId、当前exportPolicyVersion及动态accepts；旧版本或撤销拒绝，
不能只在投影时检查。回调不得返回Promise，异常固定映射UNAUTHORIZED，不输出消息。
回调不进入请求体/日志，也不新增wire字段；它不能授予本地工具执行权限。

每次 JSON 模式 HTTP 请求使用独立 X-Request-Id，同一本地 task 使用原有单向哈希
session ID；两者仅是调用方请求/会话关联信息，不伪造服务端 runId/trace。
服务端真实执行 ID 和版本需单独观测读回，不能由本机 UUID 替代。

## 验收与剩余边界

离线验证需覆盖：显式开关、严格提案/文本、伪造 verification/额外字段、结构错误、
8KiB投影边界、无授权零网络失败、取消/deadline、同task不同request身份与无自动重试。
真实验收使用合成目录/文件与显式本地批准；必须读回工具结果、Evidence、最终文字及
同库重启。2026-09-24 的合成 Desktop 闭环读回见下文；它不等于生产数据或比赛全项验收。

云原生工具暂停/同run恢复、跨进程恢复云run及正式MCP桥仍 unavailable。多invocation
可能增加云调用/模型成本；真实运行后仍须单独读回费用和平台 trace。不得自动回退 Local，
不得把真实工具标 mock，取消后不发第二次云请求。

## 当前验证

Node24.15.0 下 coordination 编译通过；新增9项行为测试与受影响文字/Workflow输入
回归共60/60通过，git diff --check通过。合成HTTP两次调用已证明新请求身份、同task
会话关联、严格JSON与8KiB整信封预算，不证明真实云端配置、工具执行或云run恢复。
Runtime审批纵向消费由B接线验证，完整仓库门禁由该组合增量和CI验证，不并发重复
安装/构建。此段记录的是离线验证；本日真实调用另见下文。

随后增加最终发送门禁的4项回归，重新编译并通过新模式13/13测试：凭据await期间
撤权、guard缺失、异步guard、凭据/guard内取消均阻止fetch。之前的60项不重复记为
此最后补丁的全量结果。

第四轮Chat静态审查的缺终结路径已在旧构建复现（Missing expected rejection）。
修复仅收紧JSON/SSE模式；Node24.15构建及adapter/诊断共66/66通过，最后追加的
终结后正文拒绝又运行了对应定向回归。Runtime不产生审批/工具的纵向反例交B验证。
第六轮审查发现JSON事件数组可倒序终结后仍返回提案；先用定向测试复现，随后只对
显式JSON模式增加终结顺序校验。Node24.15重新编译，受影响adapter/文字/诊断
67/67通过；单个message和无生命周期数组保持接受。

## 2026-09-24 真实云端基线（单独验收表面）

经用户批准的当前用户DPAPI受信配置，A使用Node24.15对同一个现有published query
部署分别发出三次合成请求。表中耗时从探针开始到解析完成，包含凭据读取、HTTP和
本地解析，不等于平台模型耗时；每行均为`networkCalls:1`、HTTP 200、完整SSE、
`verification:'unverified'`，无自动重试、云全局配置修改或Local回退。

| 表面 | UTC时间 / 端到端耗时 | 响应大小 | 本机读回 |
| --- | --- | ---: | --- |
| 文字，默认`responseMode:'text'` | 11:01:04.902—11:01:52.088 / 47.186秒 | 108169字节 | 586字；`.cache/agentarts-text/`脱敏结构报告 |
| 工具提案，`responseMode:'tool-proposal-json'` | 11:04:12.963—11:04:49.254 / 36.291秒 | 185108字节 | `tool_proposal`；proposalId、`workspace.read_text@1.0.0`及唯一参数`meeting-update.json`精确匹配；`.cache/agentarts-proposal/`报告 |
| 修复候选，JSON模式且`repairCandidateVersion:'1.0'` | 11:20:50.072—11:22:37.649 / 107.577秒 | 495820字节 | `repair_candidate`；图版本、三个目标NodeRef、摘要和唯一新依赖Ref逐项匹配本地投影；`.cache/agentarts-candidate/`报告 |

三次SSE均有3对workflow_start/end和一对task_end/end；工作流内索引冲突0，跨工作流
全局索引重复2次，解析均通过。未保存原始正文、凭据或完整本地图谱。上述忽略目录
是本机脱敏收据，结构化结果已在此记录供审查。

提案与候选均只在query中给出严格JSON输出约束，无需改变现有云应用prompt。候选
query使用D2从真实本地合成SQLite/Graph快照导出的版本化目标、更新后的FactRef和
允许依赖白名单；只投影会议从15:00到17:00及准备事项到16:00的必要字段，不发送
Evidence、凭据或私人日程。`invokeMode`未显式设置，适配使用默认published。
Desktop消费须由可信composition显式设置相应`responseMode`和候选版本，并保持
JSON续接的同步`beforeSend`出机门禁。首次提案探针没有执行工具；候选探针没有审批或
写图。三次独立API探针不能替代下列 Desktop 证据。候选契约与前置输入见
`REPAIR-CANDIDATE-ADAPTER.md`。

## 2026-09-24 合成 Desktop 真实云闭环读回

D2 的运行时源码基线为 `02f7273`，已包含 A 的候选续调修复 `edae887`；当时的手工
脚本修正随后提交为 D2 `c2ec9a2`，本文核对时 D2 checkout 为 `e408314`。A 当前
`565ad48` 的后续改动仅增加拒绝把候选藏在审核摘要里的负例测试。收据保留在 D2
工作树被忽略的 `.cache/desktop-agentarts-wu7Qlf/`，不纳入 Git，也不含本文所需的
原始云正文或凭据。D2 的完整验收描述位于
[PR #104](https://github.com/zemeng5208/PersonalAgent/pull/104) 的
`tests/manual/agentarts/MVP-ACCEPTANCE.md`（本地提交 `c2ec9a2`）。

同一个本地 source task 在 published AgentArts API 发出两次**不同的云请求**，调用方
`X-Request-Id` 脱敏引用分别为 `300bf45a…32f2c`、`c7d97e82…6b87c`；它们不是平台
runId/trace。两次均为 HTTP 200、完整 SSE、无 error event。第一次最终对象为严格
`tool_proposal`；Desktop 呈现并在合成 UI 自动化中消费本地 `allow_once` 读取审批，
ToolGateway 确认合成文件读取，Fact revision 2 投影为 graph revision 6，持久保存
任务与 Evidence 绑定。第二次最终对象为严格 `repair_candidate` v1.0，本地 source
task 读回 `succeeded`，原生预览路径生成三个目标的候选摘要。候选只是建议，云端
没有写图；自动化代答预览对话框不构成人工点击或桌面合成画面的视觉验收。

首次手工脚本在进入写入审批阶段时把 UI 快照的 `action` 错认作 `toolName`，因此脚本
收据为 `ERR_ASSERTION`/`failed`；此时 source task 已成功，候选已预览，但本地修复
尚未批准或提交。修正后的同库恢复通过 Admin UI 的 `cognition.commit_repair`
`allow_once` 审批，读回独立 local task `succeeded`、graph revision 9、图内容与执行
Evidence；再次重启仍读到两任务成功及修复结果。恢复阶段 `cloudRequests:0`。这两段
证据不能合写成一次无中断通过的脚本运行，也不能解释为云原生同 run 暂停/恢复。

目前已验证 published API 的文字、提案、候选格式，以及这一次合成 Desktop 的工具
执行、候选预览、本地审批/CAS 和重启读回。平台版本、trace 和 usage 的后续只读
读回见下文；真实私人数据、原生同云 run 恢复、人工预览点击、AgentArts 评估与
正式比赛提交均不在这份 MVP 证据内。

## 2026-09-24 已登录控制台升级前只读读回

AgentArts `cn-southwest-2` 控制台的版本历史显示，应用当前编辑态为“未发布”，
保存于 2026-09-17 16:09:27；最新已发布应用版本为 `v20260917160941`，版本 ID
`1789632586610`，发布时间 2026-09-17 16:09:46 CST。API 渠道显示“已发布”，
发布时间 16:09:47。主运行时 `agent-arts-d5ae…e4` 状态正常，`Latest` 访问方式
指向运行时 `v6`，更新时间 16:10:17。应用版本号与运行时版本号不可混作一个字段。

在“观测 → 调用链分析”筛选“多智能体 → PersonalAgent持续认知协调器 → 近1天”后，
19:48—19:49 的两条成功 trace 的会话 ID 相同（脱敏为 `pa-3531…b3863`）。可见输入分别是
`tool_proposal` 请求和携带本地确认投影的 `repair_candidate` 请求，与上述 Desktop
同一 source task 的两次请求顺序和语义一致。平台没有展示调用方 `X-Request-Id`，
因此这里只能按同会话、输入和时间匹配，不能把两个本地 UUID 精确绑定到平台 trace。

| 输入语义 | Trace ID（脱敏） | 开始时间（CST） | 平台耗时 | Input tokens | Output tokens | Total tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 只读工具提案 | `b916…47c9` | 2026-09-24 19:48:41 | 48,973 ms | 2,071 | 2,560 | 4,631 |
| 修复候选 | `5f59…5f12` | 2026-09-24 19:49:31 | 60,164 ms | 5,476 | 3,091 | 8,567 |

两条根 trace 均显示三个 `UserInput` 子调用；工具提案 trace 的第一个模型 span
显示 `DeepSeek-V4-Flash`，该 span 为 417 input + 819 output = 1,236 tokens。
这证明有云端模型活动，不证明三个设计角色分别实际执行，也不证明本地工具在云端
执行。trace 列表的输出栏均为 `{"output":null}`，严格提案和候选正文仍以本地完整
SSE 收据及解析读回为依据。主运行时页面显示日志记录未开启；trace 不等于日志。
本次未取得单次请求的账单费用、平台原生 run 恢复、失败/回滚、AgentArts 评估分数
或 API 请求 ID 到 trace 的精确 join。上述读回期间没有发起新模型调用、更新版本、
重新部署或改动凭据；控制台 API 示例中的认证值未复制、使用或保存。

### 同日稍后升级子工作流引用并提交应用新版本

控制器配置读回世界状态影响分析为起始、计划最小修复为默认、证据安全审查为结束；
三张同名独立“子工作流”卡也连接到控制器，但仍引用 2026-09-14 旧版。用户选择
升级后，将世界状态分析 `1789359963516` → `1789532410207`、计划最小修复
`1789360087304` → `1789532322503`、证据安全审查 `1789360043485` →
`1789532214390`。三个 `_1` 角色卡此前已引用相同的 2026-09-16 最新发布版本。

多智能体版本历史读回 `v20260924214829`（版本 ID `1790257800407`）于
2026-09-24 21:50:00 CST 已发布。提交时取消了默认勾选的“同步部署至实例”；
版本提交成功不代表现有 `Latest` 端点已切换，也不能将上述旧版本 trace 归给新版本。
本次没有发起新模型调用或更新凭据，提交后尚未读回实例与新应用版本的绑定。

### 后续另一组请求：第二次发送结果未知

另一次 Desktop 合成验收不是上表的同一组请求。D2 本地收据记载：第一次 AgentArts
请求始于 2026-09-24 21:16:53 CST，读到 HTTP 200；第二次始于 21:17:24 CST，
fetch 以 `TypeError` 拒绝，约 21:17:35 结束，没有 HTTP 状态，也没有自动重试。
错误文本本身不足以确定失败发生在网络、网关、授权还是服务端。

21:27 CST 在同一“多智能体、近1天”观测页刷新后，最新只见一条本次时段的
`PersonalAgent持续认知协调器` 成功 trace `07b9…0af3`，开始于 21:17:06，
耗时 17,892 ms，input 2,038 + output 1,043 = 3,081 tokens；其可见输入语义为
`tool_proposal`。它与本地第一次请求的时间、输入和 HTTP 200 结果相符，但平台
未显示调用方 `X-Request-Id`，不能精确 join。第二次本地请求后未见更晚的 trace，
只能说**当前页面未读回对应记录**，不能据此断言远端没有收到或执行。第二请求的
平台状态保持 `unknown`，不记为成功、不盲目补发，也不归因于某种未证实的权限故障。

## 2026-09-25 修复后合成主链读回

9 月 24 日 22:31 的另一次主链调用虽然 HTTP 200、SSE 完整，最终却是末端
`PA-证据安全审查` 工作流固定要求的八字段审查报告，不符合本地严格
`tool_proposal` / `repair_candidate` 协议；本地 source task 为 `failed`，
`confirmedReads:0`，不能记为闭环通过。平台 trace
`9510c10d1222ebec68930748f7e5ec45` 的末端模型 span 读回了该系统提示。
这与 21:17 第二次 fetch 状态未知是两个不同失败，不能合并归因。

随后在原资源上把证据审查源工作流发布为 `v20260924224413`
（版本 ID `1790261079291`），主协调器两个证据审查引用均读回该版本；
主协调器提交 `v20260924225602`，控制台出现“部署成功”，原运行时
`agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4` 于 22:56:23 读回“正常”。
该状态与资源版本共同支持修复已部署的判断，但仍缺每条请求的服务端部署版本字段。

9 月 25 日 18:33:57—18:36:26 CST，在已有 `afda` 集成树
`0468592517c194b43bb8cb23643edefb7c1ead2b` 的同一合成会议场景复验：
两次独立 AgentArts 调用均 HTTP 200、完整 SSE、零 error event；第一响应
156 字符，严格 `tool_proposal`，第二响应 762 字符，严格
`repair_candidate`。本地一次性批准读取合成文件，受信 Runtime 记录读回和
Evidence；原生预览核对会议 17:00、准备 16:00、三个节点引用与依赖后，独立
批准 `cognition.commit_repair`，CAS 写图到 revision 9。两任务均为
`succeeded`；真实 Electron 同库重启后任务、图内容、各一条 confirmed 执行记录
和 Evidence 仍可读回。Laya 在 graph revision 6 给出 `ready` /
`ESCALATE_AGENTARTS` / `low_confidence` 建议，没有签发权限或写图。

本机完整脱敏收据位于被忽略的 `本机忽略的完整验收收据（不纳入仓库）`
和 `afda` 工作树 `.cache/desktop-agentarts-wRje2A/receipt.json`。复验没有改动产品
代码，也没有证明其他场景稳定性、云原生同 run 恢复、请求 ID 到平台 trace 的精确
join、部署回滚或全比赛验收。前述旧请求的 `TypeError`/远端未知结论继续保留。
