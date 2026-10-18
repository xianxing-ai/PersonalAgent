# AgentArts 手工验收记录

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本目录保存 `huawei_ict_agentarts` Competition Profile 需要真实账号或云端读回的验收记录。
记录只描述实际观察到的表面；配置、版本提交、部署、API、trace、工具闭环和本地 Evidence
必须分别证明，不能互相替代。

## 2026-09-12：持续认知多智能体首版

机器可读记录见 [`2026-09-12-multi-agent-build.json`](2026-09-12-multi-agent-build.json)。

通过华为云西南-贵阳一区域的 AgentArts 控制台直接读回：

- 多智能体 `PersonalAgent持续认知协调器` 已创建并提交第二版；控制器模型为
  `DeepSeek-V4-Flash`，最大对话历史 10 轮，最大跳转 9 次。
- 控制器已保存三个职责不同的任务工作流：世界状态影响分析、计划最小修复、
  证据安全审查；画布读回了三个子工作流名称和版本 ID。
- 第二版显式把世界状态影响分析绑定为起始工作流、计划最小修复绑定为默认工作流、
  证据安全审查绑定为结束工作流，不再只靠控制器提示词约定顺序。
- 控制器提示词明确云端只处理最小化事实与修复提案，本地 Runtime、Policy、
  ToolGateway、目标系统读回和 Evidence 仍是授权、执行与完成状态的权威来源。
- 四个资源提交版本后出现部署配置弹窗；本次均选择取消，没有填写模型 API Key，
  没有部署、试运行或发起模型调用。

因此，**2026-09-12 这份记录本身**只证明 AgentArts 构建、版本化、多智能体成员与
路由槽位配置的云端读回。当时 deployment、API、trace、usage、评估、知识/MCP/Skill、
工具提案与本地可信执行闭环均未验收；不能把当时的提交计为比赛 Golden Path 完成。

## 2026-09-13：运行时部署与首个 API 失败读回

机器可读记录见 [`2026-09-13-runtime-deployment.json`](2026-09-13-runtime-deployment.json)。
AgentArts 控制台已读回正常运行的运行时、已发布访问方式和 API 网关；使用纯合成文字进行的
真实 API 调用到达运行时并返回 SSE execution/workflow 标识，但首个工作流因模型鉴权错误失败。
这证明本地到 AgentArts 的网络与入站鉴权已接通，不证明模型执行、多智能体完整路由、trace、
usage 或比赛 Golden Path 成功。验收记录不包含任何 API Key；交付前必须轮换曾暴露于工具输出的
入站凭据，并重新完成成功 API、trace 和 Desktop 读回。

重新验收时应在不暴露凭据的前提下读回同一资源及版本；任何重新部署、试运行或
真实 API 调用都需要单独记录费用、身份、输入范围、trace 和失败/回滚结果。

## 2026-09-17：云端文字成功与 Desktop 失败读回

机器可读记录见 [`2026-09-17-runtime-text-success.json`](2026-09-17-runtime-text-success.json)。
已发布多智能体版本 `v20260917160941` 的一次最小合成文字调用返回 HTTP 200/SSE；
三个工作流均产生 completion answer，响应随后出现 `task_end` 和 `end`，`errors=[]`。
AgentArts 控制台另行读回 trace `beb5adfe9bbb8bc5520fe60d573ea828` 为成功。
SSE 事件序列与平台 trace 是两类独立证据；前者不能冒充平台 trace，trace 中的 token
指标也不等于已完成账单、费用或聚合 usage 读回。

同日以隔离 Desktop 数据库发起的一次真实 Competition 任务已受理并运行约 69 秒，
但本地终态为 `failed`，错误被净化为 `EXTERNAL_FAILURE`，没有 result 或 Evidence，
也没有静默回退到 Local/Fake。随后在不提交任务、无云调用的条件下重启 Desktop，
同一数据库仍读回该 `failed` 终态、`verification=unverified` 与空 Evidence。

既有适配器只消费 `message.data.text`，而脱敏云端采集保留的是三个
`workflow_end.data.answer` 及完整终止事件，因此最初形成了响应解析假设。该兼容修改完成
离线定向测试后，又经用户单独授权执行了一次真实 Desktop 合成任务；第二个独立任务仍在
约 69 秒后以同一净化错误进入 `failed`，同库无提交重启也保持该终态。没有自动重试。

两次 Desktop 脚本均未保存原始响应或无内容事件统计；第二次运行的 AgentArts 平台 trace
因当前浏览器表面不可用而未能读回。因此离线 fixture 只证明新选择规则自身的兼容性，不能
证明它命中了真实根因，也不能在没有证据时继续归因为 terminal 顺序。后续改生产解析前，
需要在另行授权的调用中仅采集 HTTP/content type、事件名、字段类型、计数、顺序和有界大小，
并区分云端节点错误、字段形状、体积限制、SSE framing 与终止事件顺序。云端文字链仍为
`conditional`；Desktop 成功闭环、结构化工具提案、本地 Policy/Approval/ToolGateway、
目标系统读回、本地可信 Evidence、usage/cost、评估、回滚及凭据轮换仍未验证。

## 后续诊断的执行与证据边界

下一次真实调用前，先用离线合成响应验证诊断辅助代码；测试通过不是发起云调用的授权。
两次已批准调用均已使用，不自动重试或复用这两次授权。新调用需明确入口、合成输入、
凭据来源及次数；凭据只由可信测试宿主在内存提供，不写入示例、命令参数、报告或日志。

- 诊断仅输出 HTTP 状态、归一化媒体类型、白名单事件类别、字段类型、长度、计数及
  有界顺序。未知事件名归入固定 `other`，不能原样输出外部事件名或错误文本。
- 不采集请求 URL、请求体、Authorization、其他头值、回答正文或原始响应；结构数据
  也不能带入任意外部字符串。观测上限达到后明确标记截断，不据缺失事件判断云端未执行。
- 通过现有 `fetchImpl` 注入的辅助工具只用于隔离测试宿主，不修改生产错误净化、
  解析准入、重试策略、公共协议或 Runtime 状态逻辑。结构观察只能缩小候选范围，不能
  自动证明适配器内部失败分支。
- 若直接使用 Runtime Application 入口验收，必须标明没有经过 Desktop/IPC；即使
  该入口成功，也不能补记为 Desktop 成功。平台 trace 仍需独立读回。
- 每次记录独立任务与实际代码版本，保留成功或失败终态；重启读回不提交新任务。
  成功文字仍为 `unverified`，不能作为工具执行、授权或可信 Evidence 的证明。

诊断辅助代码的离线验证入口为
`node --test tests/manual/agentarts/support/structural-fetch.test.mjs`。
它不读取本机凭据或环境配置、不联网，不要求启动 Electron。调用方将
`createStructuralDiagnosticFetch(innerFetch).fetch` 注入现有测试宿主的 `fetchImpl`；
只在响应消费结束后取得 `finish()` 的结构快照，不把原响应或异常对象写入日志。
达到诊断采集上限只停止采集，不截断交给适配器的响应；报告中的截断、饱和计数和未知值
不代表云端未发送对应事件，也不能代替生产适配器的协议校验。

事件结构分析当前仅支持 SSE，JSON 的事件观察标为 `json_unparsed`，不是“没有事件”。
仅有 `.text()` 的测试替身无法证明原始响应字节数，报告标为 `unavailable`。
2026-09-17 离线辅助测试 18/18 通过；本机普通测试进程启动遇到 `spawn EPERM` 后使用
`node --test --test-isolation=none tests/manual/agentarts/support/structural-fetch.test.mjs`
通过。另以原生 `Response`、合成 SSE 和已构建的真实 `AgentArtsCloudAgentPort` 完成
不联网组合验证：一次 fetch、正确文字结果、`unverified`，快照无正文。未据此宣称云端成功。

## 2026-09-17：单次 Runtime 结构诊断仍失败

另行批准的一次 Runtime Application 诊断见
[`2026-09-17-runtime-structural-diagnostic.json`](2026-09-17-runtime-structural-diagnostic.json)。
该入口没有经过 Desktop/IPC；网络调用和凭据读取各一次，无自动重试。响应 HTTP 200、
媒体类型 SSE，完整读取 466,009 bytes / 1,727 chunks，低于生产 1 MiB 上限。
任务仍为 `failed / EXTERNAL_FAILURE`，没有结果或 Evidence；无提交重启后仍失败，
该测试宿主报告 `verification=unavailable`，重启凭据读取与 fetch 均为零。

使用的是 helper `1fda774`：仅检查前 131,072 bytes，看到 459 个合法 JSON SSE 候选、
零 JSON 解析失败，但只保留前 64 个事件。观察已截断，不可把未保留的 `task_end/end`
解释为云端没有发送，也无法排除尾部错误、字段/文字限制或终止顺序问题。该记录只缩小
传输、HTTP、媒体类型、响应读取和总字节上限方面的候选，不证明具体解析根因。
后续辅助工具的离线改进不能倒填为本次已经采集到的证据。

### 后续诊断格式 v2

v2 将结构扫描上限调整为生产已有的 1 MiB 响应上限；只保留前 32 与后 32 个事件形状、
固定白名单计数、字段类型和有界长度指标。窗口被截断与扫描被截断分别标记，仍不影响
原响应消费。文本累计值是观察到的原始字符串累计，不是生产适配器去重后的长度，不能
仅凭累计值饱和就断言生产文本上限触发。

索引冲突观察内部最多保存 1,024 个索引及文本摘要，仅输出固定计数、冲突布尔值与覆盖
标记，不输出索引、摘要或正文。覆盖不完整时，“未观察到冲突”不代表全流没有冲突。
未确认 SSE 媒体类型、JSON 响应或媒体类型读取失败时，索引覆盖也保持不完整。
这些计数不是第二套协议验证器，也不构成自动修改生产解析规则的依据。

v2 离线测试 21/21 通过，包含约 466 KB、多于 4,200 个事件的首尾保留、有界计数、
索引冲突/容量不足、Unicode 和采集截断；原响应 chunk 保持透传。原生 `Response`
与真实适配器的不联网组合也验证了超过 64 个事件后的尾部保留及原文字结果不变。
这些是离线辅助工具验证，不新增真实云验收证据。

### v2 首次 Runtime 诊断：收到 HTTP 响应前失败

`2026-09-17-runtime-fetch-rejection.json` 记录 helper `ece2151` 的一次合成调用。
任务 `446bee58-a2b0-452a-b824-2e8067773a58` 在 fetch 层拒绝，未取得 HTTP
状态、媒体类型或 body，采集字节与事件均为 0；Runtime 为 `failed / EXTERNAL_FAILURE`、
`verification=unavailable`。没有自动重试；同库无提交重启保持失败，额外凭据读取和 fetch 均为 0。

本次没有 SSE 尾部可分析，不能解释上一次已完整收到响应的失败，也不能仅凭这些指标
区分 DNS、TLS、代理或网络策略。云端是否执行及计费未验证；不计为 Desktop 或工具闭环成功。

### 后续单次诊断：TLS 类别拒绝

`2026-09-17-runtime-tls-rejection.json` 记录独立任务
`c460c996-dd21-4eb7-8f21-07cfca96c12e`。隔离 harness 仅新增固定 transport
类别，不记录原始错误码、消息或证书；helper 与生产代码未改变。该次单次调用在收到
HTTP 响应前以 `tls` 类别失败，0 字节/事件，未重试；Runtime 及同库无提交重启均为
`failed / EXTERNAL_FAILURE / unavailable`，重启没有额外 fetch 或凭据读取。
这只定位本次连接错误类别，尚不能确定具体证书原因，也不能解释之前完整 SSE 响应后的失败。

### 系统信任库隔离诊断：完整 SSE 与索引冲突

`2026-09-17-runtime-index-conflict.json` 记录任务
`1fecb109-1f76-4960-b1f7-3b0c513ce73e`。仅隔离 Node 进程启用系统信任库，未关闭
证书校验或更改系统配置。一次调用完整收到 HTTP 200/SSE，共 510,406 字节、1,878 个
事件；结构扫描未截断，末尾含有序 `task_end → end`，但 Runtime 及无提交重启仍失败。

全响应消息文本累计 2,180 UTF-16 单元，未触及 16k 限制；诊断观察到 2 次全局索引
文本冲突，当前生产适配器会拒绝这类冲突。索引观察容量为 1,024，覆盖仍为 partial：
已观察到的冲突有效，但不能据此断言冲突总数，或判断它们发生在同一还是不同 workflow。
该记录支持下一步离线复现，不证明已定位生产首个失败分支，也不代表 Desktop 成功。

## 2026-09-24～25 Competition Profile 证据索引

| 表面 | 当前可核对证据 | 证据边界 |
| --- | --- | --- |
| 云端构建与版本化 | [2026-09-12 控制台读回](2026-09-12-multi-agent-build.json)：多智能体和三个子工作流提交版本；2026-09-24 将三张旧子工作流引用升级并提交多智能体 `v20260924214829`（版本 ID `1790257800407`） | 六张工作流卡均引用三个子工作流各自的 2026-09-16 最新发布版本；控制器仍有一个“未配置”槽，未从 trace 证明其执行影响 |
| 部署与 API 渠道 | 9 月 24 日 21:50 提交 `v20260924214829` 时未同步部署；随后证据审查 `v20260924224413` 和主协调器 `v20260924225602` 完成修复，控制台显示“部署成功”；9 月 25 日原运行时状态“正常” | 运行时名称与更新时间已读回，但未取得每条请求对应的部署版本标识；应用版本与运行时版本不可混同 |
| 已发布部署的调用 | [有界多次云调用工具 MVP](TOOL-INVOCATIONS-MVP.md)：早期三次独立探针及一次 Desktop 两请求读回；9 月 25 日修复后同一合成任务的两次云请求均 HTTP 200、严格提案/候选解析，本地完整闭环通过 | 平台未展示调用方 `X-Request-Id` 与部署版本的逐请求精确 join；早期 trace 列表输出列为 `{"output":null}`，响应正文以本地 SSE 收据为准 |
| 本地执行与修复 | [D2 PR #104](https://github.com/zemeng5208/PersonalAgent/pull/104) 的 `tests/manual/agentarts/MVP-ACCEPTANCE.md`、[A 脱敏调用读回](TOOL-INVOCATIONS-MVP.md)：9 月 25 日又在同一合成场景完成两次真实云调用、一次性本地读取批准、独立修复批准/CAS、原生预览与同库重启读回 | 9 月 24 日初次脚本失败及第二次 fetch 未知仍是独立历史记录；新通过只覆盖一个合成会议场景，不证明云原生同 run 恢复或生产私人数据 |
| 平台评估与扩展能力 | 尚无 AgentArts 平台评估分数、重复运行/基线对照、知识/MCP/Skill 的真实云端读回 | 离线三案例 Fake runner 不是云端模型质量或比赛评估 |

后续云请求的调用方 `X-Request-Id` 只能关联本机请求，不代替平台 trace。上述索引
覆盖本次合成 MVP，不扩大为 AgentArts 原生暂停/恢复或全部比赛要求已完成。

### 2026-09-24 平台读回、引用升级与下一验收包

升级前，用户已登录的 `cn-southwest-2` 控制台显示：编辑态保存于
2026-09-17 16:09:27；当时最新应用发布版本 `v20260917160941`（版本 ID
`1789632586610`）发布于同日 16:09:46，API 渠道随后显示已发布。主运行时
`agent-arts-d5ae…e4` 状态正常，`Latest` 指向运行时 `v6`，更新于 16:10:17。
控制器显示 `deepseek-v4-flash`；已发布版本预览和当前编辑态都显示六个工作流卡
（三个无后缀、三个 `_1` 起始/默认/结束）及一个“未配置”槽。该画布不能单独证明
实际角色交接、未配置槽的执行影响或发布版本的安全性。

同日 21:50 CST，经用户选择升级引用后，控制器配置读回起始=世界状态影响分析、
默认=计划最小修复、结束=证据安全审查，三张独立“子工作流”卡均连接到控制器。
三张旧引用分别从 `1789359963516`、`1789360087304`、`1789360043485` 升到各自
最新发布版本 `1789532410207`、`1789532322503`、`1789532214390`；三个 `_1`
角色卡原已使用这些版本。版本历史读回新多智能体 `v20260924214829`（ID
`1790257800407`）于 21:50:00 已发布。提交时取消了默认勾选的“同步部署至实例”，
因此本次没有重新部署或发起模型调用；提交后尚未核对运行时的精确版本绑定。

同一会话的两条成功平台 trace 与本地合成 source task 的提案、候选输入语义相符：
提案 2026-09-24 19:48:41 CST，48,973 ms、4,631 tokens；候选 19:49:31，
60,164 ms、8,567 tokens。模型 span 读到 `DeepSeek-V4-Flash`。脱敏 trace
引用、input/output token 拆分和证据边界见[有界多次云调用工具 MVP](TOOL-INVOCATIONS-MVP.md)。
运行时页面显示日志记录未开启；trace 可见不等于日志、账单或本地执行证据。

随后另一组 Desktop 合成请求中，本地第一请求 HTTP 200，第二请求在 fetch 阶段以
`TypeError` 结束且没有 HTTP 状态。平台在第一请求时段只读回一条成功 trace，第二
请求后刷新未见新 trace；平台没有给出 `X-Request-Id` 精确关联，远端是否收到第二
请求仍为未知。详见同一[调用记录](TOOL-INVOCATIONS-MVP.md)，不可与前述两条
成功 trace 合并计数。

基于当前 Competition Profile，剩余最小平台工作包按下列顺序验收，均须另取当前证据：

1. **角色编排与发布配置**：已核对六张卡的起始/默认/结束和独立子工作流配置，
   并更新旧引用；仍须确认“未配置”槽的执行影响，在固定输入下读回三个角色的真实
   交接 trace 与失败分支。现有 trace 只证明三个 `UserInput`/模型 span，不能用
   配置或连线代替实际执行证据。
2. **平台效果评估**：把固定合成场景映射到 AgentArts 可复跑评估集，记录多次运行、
   原始分数/错误、成本或 token、版本和 trace，并用单角色或等价基线作对照。现有
   Fake 三案例 runner 和两条成功调用不能给出多 Agent 必要性或质量结论。
3. **部署验收与回滚**：将新应用发布版本、运行时版本、`Latest` 端点和每条正式调用
   建立可核对关联；验证健康/失败、降级不静默切 Local、版本回退及账单费用读回。
   9 月 24 日 21:50 的版本未同步部署；随后修复版本显示部署成功且原运行时正常，
   9 月 25 日一个合成主链通过。仍缺逐请求部署版本、回滚和费用读回。

知识接入、MCP/Skill 的真实平台编排价值仍无读回，不能用本次本地工具提案代替。

### 2026-09-25 已验证配置与恢复核对

9 月 24 日 22:31 首次主链请求虽为 HTTP 200，但末端证据审查工作流固定输出
八字段报告，不符合本地严格 `tool_proposal` / `repair_candidate` 协议，本地任务
明确失败。随后在原有资源上修复：`PA-证据安全审查`
（`998031d7-ec28-40ed-83e6-96667f22ff51`）版本 `v20260924224413`
（ID `1790261079291`）；主协调器（`32d4d44c-eade-4f3f-8f76-209c74609e79`）
版本 `v20260924225602`，两个证据审查引用均指向修复版本。原运行时
`agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4` 于 9 月 24 日 22:56:23
读回“正常”。没有取得请求级部署版本字段，不能仅凭草稿或 API 渠道状态推定绑定。

恢复或复测前，在 `cn-southwest-2` 控制台按上述**原资源 ID**核对已提交的源工作流、
主协调器版本历史、六张引用卡和原运行时状态；证据审查应输出单个严格应用协议对象，
三个源工作流的输入仍为 `query`，输出为 `raw_output:String`。若版本、引用或运行时
绑定不一致，先停止真实调用，按单独授权完成平台恢复并读回，不从草稿或截图猜测部署。
本地配置只从受信宿主读取 `gatewayOrigin`、`runtimeName`、`invokeMode` 与响应协议开关；
凭据由本机受信存储提供，不放进仓库、提示词、API 页面截图或验收收据。已有的一次
合成闭环收据在本机被忽略的 `.cache/full-chain-acceptance-20260924.md`；它记录了
真实调用与重启结果，但不能替代恢复后新请求的版本和 trace 读回。

9 月 25 日对已发布 `PA-证据安全审查` `v20260924224413` 的版本预览又读回一项范围限制：
末端系统提示的 `tool_proposal` 分支限定合成 `meeting-update.json` 读取，
`repair_candidate` 分支要求已确认的“会议变更”和 `repairContext`，其他情况返回
`kind:text`。因此上述成功证据只覆盖会议合成场景；即使本地候选续接改为通用描述，
也不能据此推断当时云端版本支持非会议事实变化；后续新版本与实调须单独记录。

### 2026-09-25 非会议单次调用的部署关联粒度

MOD-30 在同一原运行实例上读回：主协调器已发布 `v20260925192219`，证据审查
`v20260925191806`（ID `1790335103598`）被两个引用使用；运行实例
`agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4` 状态“正常”，`Latest v8`
更新于 19:22:49 CST。这是调用前的配置与实例读回，不是请求级版本字段。

MOD-04B 的同一份本机脱敏回执
`本机忽略的 MOD-04B 收据（不纳入仓库）`
记录：一次请求发送到上述 runtime 名称的 `/invocations` 端点，调用方
`X-Request-Id` 为 `11ba…6c2e`，时间 19:30:13–19:30:53 CST，HTTP 200、
17,089 字节完整 SSE、零 error event；严格解析接受一个 `repair_candidate` v1.0。
这是合成交付截止时间变化的 **query-level 候选协议探针**；没有本地工具执行、审批、
图写入、重试或 Local 回退，`verification` 仍为 `unverified`。

平台“观测 → 调用链分析”在同一时间只读回成功 trace `668c…736d`：开始于
19:30:13 CST、耗时 38,937 ms、会话 `pa-49c8…98d8`，输入 3,365 + 输出
2,288 = 5,653 tokens。可见输入中的合成 `factChange`、`draft-review` 和截止时间
与本机请求一致；调用树有三段 `UserInput`／模型跨度，末段输出含
`repair_candidate`。这支持按时间和输入语义关联该次调用，但平台页面未回显调用方
`X-Request-Id`，本地 HTTP/SSE 也没有服务端 trace ID，因此不是精确 ID join。
三个 `UserInput` 是同一 Agent 下的同级跨度；逐段模型元数据的
`gen_ai.resource.id` 均为主协调器 `32d4…9e79`，未显示三个源工作流 ID、
各自的设计角色或跨段交接标识，不能据此宣称角色路由已验收。根 span
元数据的 `resource_version: "draft"` 也不是该请求的运行实例部署版本；未见
请求级 runtime/deployment/version 字段，不能把 `Latest v8` 或已发布应用版本
冒充精确绑定。tokens 是平台用量，不是单次账单费用。

## 固定合成分类 runner

[`support/fixed-synthetic-batch.mjs`](support/fixed-synthetic-batch.mjs) 提供 MOD-31 的离线
三案例分类 runner。它只接受显式注入的 CoordinationPort、未来 UTC deadline 和取消
信号；内置 prompt 不接收私人输入，也不写入案例预期答案。直接 CLI 要求 `--deadline`，
并始终使用返回私有固定序列的显式 Fake，仅验证 runner plumbing，不衡量模型能力；它不会
读取环境凭据或自动连接 AgentArts。输出只记录 case 状态、验证等级、固定错误码、计数和
耗时；`mock` 结果不构成真实 AgentArts、工具执行或 Evidence 验收。

## 2026-10-07：显式评估与只读观测入口索引

以下新增入口及诊断修正沿 [PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302)
交付，尚未进入 main；不改变上方历史真实调用、验收或授权记录。导入这些模块不会
主动执行评估、采集文件或发出网络请求。固定修复评估所需的 `CoordinationPort`，以及
观测所需的 SDK 签名回调，均由受信调用者显式注入；没有自动服务选择或凭据读取。

| 入口 | 用途与必要验证入口 | 边界说明 |
| --- | --- | --- |
| [固定修复 runner](support/fixed-synthetic-repair-batch.mjs) | `runFixedSyntheticRepairBatch(port, {deadline, signal, repetitions})`；[runner 测试](support/fixed-synthetic-repair-batch.test.mjs) | 原三个合法合成世界，隐藏期望不送模型；按节点、摘要、依赖及版本精确评分，错误计入实际尝试分母；[MOD-31](../../../docs/modules/MOD-31-FIXED-EVALUATION-01.md) |
| [配对修复 runner](support/paired-synthetic-repair-batch.mjs) | `runPairedSyntheticRepairBatch({candidate, baseline}, {deadline, signal, repetitions})`；[组合测试](support/paired-synthetic-repair-batch.test.mjs) | 复用原修复评分，1～3 对、最多 18 请求；共用原期限与取消，只比较两侧完整批次，未配对保留事实；[MOD-31](../../../docs/modules/MOD-31-FIXED-EVALUATION-01.md) |
| [平台 Trace 只读 helper](support/read-platform-trace.mjs) | `readAgentArtsTrace({traceId, deadline, signal, authorize, fetchImpl})`；[独立消费测试](support/read-platform-trace-consumer.test.mjs) | 固定已公布区域/GET，显式 SDK 签名；总 Span 数与返回数分开，不合计 token、不推断请求/版本关联或费用；[MOD-32](../../../docs/modules/MOD-32-AGENTARTS-OBSERVABILITY.md) |
| [文本响应诊断](support/text-response-diagnostic.mjs) | `createTextDiagnosticFetch(innerFetch)`；[解析及生命周期测试](support/text-response-diagnostic.test.mjs) | 保留公开 Reader 消费形态，取消/早停立即转发底层 cancel，清理异常与迟到读取不覆盖终态，各请求快照隔离；诊断只报告有界结构与固定原因，不返回正文 |

测试链接对应显式 Fake 端口、签名头、传输及流，仅验证辅助管线。合成签名头不证明
服务端验签、账号权限或真实 Trace；有限重复与本机 await 时长不证明统计显著性、
平台推理耗时、真实角色协作或多 Agent 优势。现有运行实例 Bearer 不能替代观测 API
的 AK/SK 签名。真实调用、目标读回、部署/版本及 Trace 的证据仍须逐批独立核实，
不从这些离线测试或旧记录推定能力已可用。
