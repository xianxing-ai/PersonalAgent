# MOD-10：2026 年参赛规则与证据缺项

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标：`huawei_ict_agentarts` Competition Profile。负责人：`zemeng`。核对日期：2026-09-25；iCAN 日期歧义复核：2026-09-28。

本页只记录会改变参赛准备的官方规则。产品能力和模块完成状态仍以实际代码、验收回执及 PR 为准。

## 官方入口

- [第十一届华为 ICT 大赛中国区创新赛规则](https://e.huawei.com/cn/talent/#/ict/innovation-details?zoneCode=027425&zoneId=98269700&compId=85132021&divisionName=%E4%B8%AD%E5%9B%BD%E5%8C%BA&type=C002&isCollectGender=N&enrollmentDeadline=2026-11-30%2023%3A59%3A59&compTotalApplicantCount=1113)：在华为人才在线页面直接读回赛题 2、各阶段材料、评分与参赛须知。仓库原先引用的 2025—2026 全球总决赛页面属于上一届，不能充当本届提交规则。
- [2026 年 iCAN AI 应用创新挑战赛通知（id=138）](https://www.g-ican.com/competition/details?id=138)：iCAN 大赛组委会发布的独立赛事通知。

## 两项赛事的必要差异

| 条件 | 华为第十一届 ICT 创新赛·赛题 2 | iCAN AI 应用创新挑战赛·软件赛道 |
| --- | --- | --- |
| 报名与赛程 | 报名 2026-08-31 至 11-30；初赛 2026-12，中国总决赛 2027-03，全球总决赛 2027-05 | 页面赛程栏写报名至 **2026-09-29**，正文写报名及作品提交截至 **2026-09-30**；建议不晚于 09-29 完成报名，最终以赛事系统读回为准；复赛 10 月，全国总决赛 11 月 |
| 平台与作品 | 必须基于华为云 AgentArts 完成 Agent 构建、编排和部署，并用可视化 Demo 展示；体现工具、知识、多 Agent 和效果评估的价值 | Agent、网页或移动应用、行业方案等软件作品均可，须可在线演示或提供可运行程序；通知未要求使用 AgentArts |
| 初次提交 | 初赛提交作品信息收集表及作品介绍材料，说明 Agent 设计、场景、模型与资产选择，并展示基于 AgentArts 构建和运行的 Demo 视频 | 应用方案 PDF 不超过 20 页；演示视频 MP4 不超过 5 分钟；可运行程序提供稳定链接或源代码 |
| 后续展示 | 中国总决赛需在线可交互 Demo 地址、Agent 设计文档、自定义 Skill/MCP 说明（如有）和社区分享帖截图；全球总决赛还需应用落地进展与社区反馈 | 通知要求作品实际可运行；复赛线上评选，总决赛现场比赛 |
| 评分 | 初赛创新性 60%、应用价值 40%；中国总决赛创新 40%、应用 35%、完整展示 15%、答辩 10%；全球总决赛创新 40%、应用 30%、完整展示 15%、落地 10%、答辩 5% | 创新 30 分、技术实现 30 分、实用价值 20 分、用户体验 10 分、展示效果 10 分 |

华为赛题 2 对晋级中国总决赛或全球总决赛的作品要求发布社区分享帖；同页赛题 1 的强制开源条款不能直接套用到赛题 2。华为赛事限定同校 3 名在校学生和 1 名指导教师，报名截止后不得换人；iCAN 允许个人或 2—5 人团队，高校组与社会组分别参赛，不能混组。

## 对 PersonalAgent 的决策与待证项

1. 当前 Competition Profile 继续以 AgentArts 为主路径。iCAN 是另一个提交口径；复用同一产品时，应分别准备材料和证据，不把 iCAN 的可运行程序要求误当成华为 AgentArts 平台验收，也不把华为赛题 2 的云平台要求套到 iCAN。
2. 华为初赛需能展示 AgentArts **构建与运行全过程**。后续还需可公开访问并交互的 Demo、工作流/知识/模型资产选择说明、实际效果验证、社区分享证据。一次合成主链通过只覆盖其中一个运行场景，不能替代全部提交材料或各能力读回。
3. 若决定投 iCAN，优先不晚于 2026-09-29 完成报名，并按正文所述 09-30 截止日准备符合格式的 PDF、MP4 和稳定可运行入口；两处日期不一致，须以赛事系统实际截止提示为准。目前没有这些材料已提交的证据。
4. 华为页面称云代金券预计 10 月开放申请，具体额度、使用范围、有效期以组委会后续通知为准；本页不据此承诺可用资源或启动付费模型实验。各阶段具体材料提交截止时刻仍需读回后续赛事通知。
5. PA-022 参数微调仍是后续研究项。现有提示词、知识库、记忆和评估都不构成参数训练；未确认训练服务、授权数据、成本及可重复评估前，不宣传“自训练”能力。

## 参赛要求到材料的映射（2026-09-25）

此表供准备材料时逐项取证。PR、代码、平台配置和一次运行回执分别代表不同证据层级；开放 PR 不等于已合并，单个合成场景不等于完整产品或赛事验收。技术状态优先按对应当前 PR 与真实目标系统读回核对，不沿用旧接口目录中的进度描述。

| 赛事要求 | PersonalAgent 对应功能 | 现有可引用证据 | 待形成的提交材料与未覆盖项 |
| --- | --- | --- | --- |
| 华为赛题 2：AgentArts 构建、编排、部署 | `huawei_ict_agentarts` 的云端 Agent/Workflow；本地 Runtime 保留 Policy、执行与终态 | [PR #130](https://github.com/zemeng5208/PersonalAgent/pull/130) 记录 2026-09-25 控制台提示词、引用、发布和原运行实例 `Latest v8` 的独立读回；[PR #108](https://github.com/zemeng5208/PersonalAgent/pull/108) 记录此前工作流修复与合成运行；[PR #134](https://github.com/zemeng5208/PersonalAgent/pull/134) 登记请求级观测缺口。这些 PR 当前开放 | 作品介绍中画出实际 Agent/Workflow 及部署关系，附脱敏配置和部署详情读回。还需把**参赛演示的每次请求**与实际部署版本、平台 trace 精确关联；发布页或旧 trace 不能代替请求级证据 |
| 华为赛题 2：可视化 Demo 与完整交互 | Desktop 中的目标、任务、审批、工具读回和受影响计划修复 | [PR #104](https://github.com/zemeng5208/PersonalAgent/pull/104) 的旧验收 head 记录一次固定合成会议场景：两次真实 AgentArts HTTP 200、本地审批/工具、图修订及同库重启读回；审批页由合成脚本操作，原生预览由本地主控点击。该 PR 当前开放 | 录制可复核的构建与运行演示，展示真实 profile、授权、目标读回和失败状态；补齐普通非会议目标及当前演示版本的联合验收。不能把合成脚本点击描述为终端用户手工批准 |
| 华为赛题 2：工具、知识、多 Agent 与效果评估的实际价值 | AgentArts 提案由本地严格校验，经 Policy/ToolGateway 执行；知识与角色协作各有独立消费和评估 | [PR #104](https://github.com/zemeng5208/PersonalAgent/pull/104) 仅证明该合成场景的工具闭环；[PR #137](https://github.com/zemeng5208/PersonalAgent/pull/137) 提供三项合成任务的离线评分入口，明确未做真实平台对照。现有 Fake 知识检索不构成真实知识接入 | 材料需给出知识来源/引用、工具提案与本地授权边界、角色交接 trace、同输入基线与重复评估结果；缺项标注未验证，不把评分脚本或 Fake 当作云端评估 |
| 华为创新性与应用价值 | 版本化世界状态、持续 Goal、影响传播、最小 PlanPatch 和可信 Evidence | [PR #105](https://github.com/zemeng5208/PersonalAgent/pull/105) 的显式修复首片已合并；[PR #118](https://github.com/zemeng5208/PersonalAgent/pull/118) 的公开 Demo 来源投影已合并；[PR #136](https://github.com/zemeng5208/PersonalAgent/pull/136) 的目标命令目前开放且仅有离线验证 | 作品介绍应以同一场景展示变化前后版本、受影响与保持不变的计划、实际用户价值和读回依据；生产目标创建/修订、自动事实消费和跨场景效果未完成前不宣传为完整持续认知 |
| 华为后续阶段：在线交互地址、设计文档、社区分享与落地反馈 | 正式可用 Demo、架构/技能说明及公开反馈 | 当前 PR 和内部运行回执只能作准备依据，没有上述提交或公开发布的读回 | 晋级后按届时通知提供可访问地址、Agent 设计及自定义 Skill/MCP 说明（如有）、社区帖截图；全球总决赛另补落地与反馈。公开前移除凭据和私人内容 |
| iCAN 软件赛道：方案 PDF、演示 MP4、可运行入口 | 复用同一产品的可运行能力，另按 iCAN 口径组织说明 | 产品技术 PR 可作素材；截至本次核对，未见 PDF、MP4、稳定入口或提交成功回执 | 报名建议不晚于 **2026-09-29**；按通知正文在 **09-30 前**准备不超过 20 页的方案 PDF、不超过 5 分钟的 MP4，以及稳定链接或源代码，并以赛事系统读回确认提交；不把华为 AgentArts 部署当作 iCAN 提交完成 |

华为队伍资格、报名状态及各阶段实际提交状态属于赛事系统事实，须由参赛人按对应页面读回；此表没有这些证据。主线的一次联合验收回执由各模块共同引用，仅在具体失败或新风险出现时补定向证据，不为材料重复运行整链。

## AgentArts 官方能力与源码映射（2026-10-07）

本节为 MOD-10 的公开资料核对，服务 MOD-29/30/32；不更新上面的历史验收结论。本次只读获取官方文档，未登录账号、创建资源、调用部署、执行评估或启动训练。以下链接在 **2026-10-07 UTC** 均实际返回 HTTP 200，且已提取对应 AgentArts 文档正文、标题和更新时间；产品页、成长地图和导航入口本身不充当 API 合同。官方页面更新于 2026-09-14 至 2026-09-30，能力是否在当前账号、区域和套餐可用仍需读回。

源码核对基于本工作树 `0fffa2d`，真实实现是 [coordination 公共端口](../../../packages/coordination/src/index.ts)、[AgentArts adapter](../../../packages/coordination/src/agentarts.ts) 和 [Desktop 受信配置宿主](../../../apps/desktop/electron/agentarts-config.js)。模块分工中的 `packages/agentarts/src/foundation`、`workflows`、`observability` 是规划目录，本次核对时 `packages/agentarts` 尚不存在；不据此重复建设已存在的 adapter，也不把规划目录记为已交付。

| 真实公开能力 | 当前源码 | 未验收 |
| --- | --- | --- |
| **MOD-29：项目、成员与资源。** [成员与空间管理][aa-members]说明服务开通、套餐席位和 IAM 成员许可；[基本概念][aa-concepts]区分 Agent、运行时和绑定版本的访问方式。该成员文档正文没有提供“项目创建 API”的合同，不能从标题推导端点 | `AgentArtsRuntimeConfig` 保存 `gatewayUrl`、`runtimeName` 和调用模式；`CloudAgentPort.invoke` 是调用端口，没有项目/Agent/部署的创建、查询或管理方法 | 当前账号所属区域、成员许可、实际应用 ID、运行实例及访问方式与部署版本的关系；不从本地配置补造这些引用 |
| **MOD-29：Agent/Workflow 发布与部署。** [发布应用][aa-deploy-agent]明确提交版本保存不可变配置快照，部署创建可调用的运行实例；[发布工作流][aa-deploy-workflow]要求试运行后提交版本，未部署时 API 详情为空 | adapter 调用已存在的运行实例；配置 `runtimeReady` 只验证本地绑定格式，`configured` 只表示已保存配置；没有发布或健康探测实现 | 当前部署状态、实际访问入口、绑定版本及一次成功调用；9 月旧发布记录不能证明当前配置可用 |
| **MOD-29/30：部署调用合同。** [单/多智能体 API][aa-agent-api]和[工作流 API][aa-workflow-api]均为 `POST /runtimes/{runtime_name}/invocations`；使用完整 `Authorization`，API Key 示例为 `Bearer {api_key}`，包含会话头，支持 `debug`/`published`。Agent 使用 `query`；Workflow 必填 `inputs`，其 key 来自开始节点变量，示例中的 `query` 不是固定保留变量 | adapter 使用同一路径，发送宿主提供的完整鉴权值、`x-hw-agentarts-session-id`、`X-Invoke-Mode`，默认 `published`；`workflowGoalInput` 显式映射一个开始节点变量，否则发送 `{query}` | 实际渠道管理/API 页面生成的域名、运行实例名称、入站认证方式、开始节点定义与当前调用必须一致；不猜域名、添加 `endpoint=Latest` 或自动切换协议 |
| **MOD-29：入站身份与模型条件。** [认证鉴权][aa-auth]分别说明 API Key、AK/SK 和 OAuth，适用方式随接口而异；上述 Agent/Workflow 调用示例明确 **API 不支持平台赠送的免费模型 token**，需已接入可用模型，例如配置 API Key 的 MaaS 模型 | `AgentArtsAuthorizationProvider.read(signal)` 由受信宿主逐请求读取完整请求头；adapter 不签 AK/SK、不执行 OAuth 获取/刷新，也不创建 MaaS 模型或证明模型额度 | 当前认证方式、密钥状态、模型授权/余额和模型可调用性。运行实例入站 API Key 与模型服务 API Key 用途不同；不能把鉴权读取成功或控制台免费调试当成部署 API 成功 |
| **MOD-30：平台响应与本地提案。** [InvokeRuntime][aa-invoke]说明流式调用，公开响应包含事件及 `data.text/index/node_id/node_type` 等字段。官方响应合同不定义 PersonalAgent 的 `tool_proposal`、`repair_candidate` 或 continuation 对象 | adapter 严格消费 JSON/SSE；`responseMode`、`initialRequestMode`、`repairCandidateVersion` 是显式应用协议开关。提案由本地解析校验，再交给 Runtime/Policy/ToolGateway；continuation 是另一次调用，代码明确不宣称云原生同 run 恢复 | 当前部署提示词/Workflow 是否实际输出约定对象、错误/终止事件与成功响应、批准后工具读回及后续请求；平台运行成功不能替代本地执行 Evidence |
| **MOD-30：知识与 MCP。** [添加知识库][aa-knowledge]要求已创建/接入且启用的知识库；[添加 MCP][aa-mcp]说明预置和自定义服务及其费用/外部凭据条件。产品页的 Skill 能力叙述不提供本项目的 Skill 调用 DTO | 当前 `CloudAgentPort` 没有知识/MCP/Skill 管理接口；已发布流程可以在云端使用这些资产，但本地受限工具目录和提案协议不等于云 MCP 接入 | 当前部署引用的资产、来源/检索引用、实际 MCP/Skill 调用及费用；不得从平台能力存在推导本项目已绑定或扩大本地权限 |
| **MOD-32：调用链与请求关联。** [调用链分析][aa-trace]提供 TraceID、会话、输入输出、Model Span token、元数据和日志；[Trace 详情 API][aa-trace-api]明确 `GET /v1/ops/observation/traces/{trace_id}`。Agent/Workflow API 将可自定义的 `X-Request-Id` 描述为用于日志追踪的调用链 ID | adapter 已发送 `X-Request-Id`；失败诊断包含固定 stage、请求 ID、HTTP 状态、终止事件及服务错误码。`CoordinationResult` 不含平台 trace、部署版本或 usage，adapter 没有查询 Trace API | 需要实际平台读回请求 ID 与 TraceID 的关系、版本元数据和模型跨度；官方说明请求头可追踪不补足历史未回显的精确 ID join，不能把本地 SSE、根 span 的 `draft` 或调用前 `Latest v8` 当作逐请求部署版本 |
| **MOD-32：观测入口的身份。** [观测 API 示例][aa-observation-api]单独给出服务域名和 Trace 列表查询，说明 `agentarts::listOpsTrace` 与依赖的 APM 权限，建议限定存在实际调用的时间范围 | 当前 adapter 只访问配置的运行实例入口；没有观测管理客户端，也没有自动复用入站凭据调用观测 API | 观测授权、实际有数据的查询区间、当前账号的 API 读回；运行实例 Bearer 入站认证不能推导观测服务权限 |
| **MOD-32：usage 与成本。** [套餐用量][aa-usage]提供套餐资源总量及今日/本周/本月消耗构成；[计费项][aa-price]区分套餐/CU 和关联服务，说明模型、LTS 日志、APM 调用链、AOM 指标及 DEW 凭据等可能另收费 | adapter 没有计费或套餐查询接口；失败诊断也不返回 token/cost。平台 Model Span token、本地时延与一次 HTTP 回执各自只代表对应观测值 | 当前套餐、模型账单、关联服务费用和时间范围对应的实际用量；token 不等于账单金额，免费套餐不等于全部关联资源免费 |
| **MOD-32/31：平台评估。** [评估介绍][aa-evaluation]区分固定评测集的离线评估与基于 API Trace 的在线评估，明确控制台调试不触发在线任务；[创建评估任务 API][aa-evaluation-api]为 `POST /v1/ops/evaluation-tasks`，支持 `OFFLINE`/`ONLINE` 与评估器配置 | 当前 adapter 没有平台评测集/评估器/评估任务管理；[既有验收索引](../../../tests/manual/agentarts/README.md)的固定合成评分入口属于本地离线证据 | 实际评测集与评估器版本、任务 ID、原始分数/失败、同输入基线及 token/费用；本地评分不替代平台评估，不启动未授权模型优化或 Local 训练 |

优先取证顺序：MOD-29 先读回当前资源、入站方式、模型条件和实际部署 API；MOD-30 在同一确定版本上验证受限提案 → 本地授权 → 目标系统读回；MOD-32 为该请求分别取得平台 Trace、版本关系、日志设置与成本，并再按固定评测集做效果对照。已有 [2026-09-30 共用调用入口记录](../../../tests/manual/agentarts/SAVED-CONFIG-CALL.md)明确真实调用返回 HTTP 403；本次公开文档取回没有恢复账号或更新该结果。历史成功探针的日期、合成范围和关联粒度继续按原收据引用。

[aa-members]: https://support.huaweicloud.com/resources-members-agentarts/agentarts_15_0004.html
[aa-concepts]: https://support.huaweicloud.com/productdesc-agentarts/agentarts_03_0010.html
[aa-deploy-agent]: https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0031.html
[aa-deploy-workflow]: https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0053.html
[aa-agent-api]: https://support.huaweicloud.com/api-agentarts/agentarts_07_0046.html
[aa-workflow-api]: https://support.huaweicloud.com/api-agentarts/agentarts_07_0047.html
[aa-auth]: https://support.huaweicloud.com/api-agentarts/agentarts_07_0005.html
[aa-invoke]: https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html
[aa-knowledge]: https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0025.html
[aa-mcp]: https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0021.html
[aa-trace]: https://support.huaweicloud.com/ops-agentarts/agentarts_14_0012.html
[aa-trace-api]: https://support.huaweicloud.com/api-agentarts/ShowOpsTrace.html
[aa-observation-api]: https://support.huaweicloud.com/api-agentarts/agentarts_07_0037.html
[aa-usage]: https://support.huaweicloud.com/resources-members-agentarts/agentarts_15_0005.html
[aa-price]: https://support.huaweicloud.com/price-agentarts/agentarts_08_0003.html
[aa-evaluation]: https://support.huaweicloud.com/ops-agentarts/agentarts_14_0023.html
[aa-evaluation-api]: https://support.huaweicloud.com/api-agentarts/CreateOpsEvaluationTask.html

## PA-022 参数优化的官方研究条件（2026-10-07）

取证日期：**2026-10-07 UTC**。本节仅补充 MOD-10 的公开官方资料研究，未登录账号、创建训练任务、调用模型或执行评估与部署。华为云[优化介绍](https://support.huaweicloud.com/ops-agentarts/agentarts_14_0143.html)（页面更新 2026-09-14）分别介绍诊断、配置优化和模型训练；提示词、工具或 Skill 的配置调整不能据此记为参数训练。

[模型优化概述](https://support.huaweicloud.com/ops-agentarts/agentarts_14_0094.html)（页面更新 2026-09-17）描述面向特定 Agent/Workflow 任务的强化学习优化，并限制优化对象：单 Agent 不能包含工作流，插件与 MCP 各不超过 5 个；从开始节点到被优化大模型节点的 Workflow 路径不能包含用户交互暂停节点，目标 LLM 节点不能位于循环内。这是窄任务的服务说明；不能据此推导通用模型能力提升或本项目的实际效果。优化仍需明确的数据质量、任务分布与奖励定义。

当前西南区域账号的训练服务权限、可用基础模型（包括盘古）、价格与额度、授权训练数据、可重复效果评估及训练后实际部署均**未证实**。本次没有取得这些条件的账号读回，也没有训练或效果回执。PA-022 仍是 future research，不能推成当前训练已可用、已完成“自训练”或华为比赛的必要条件；参赛要求继续按上面的独立赛事来源核对。

## 官方文档的区域与产品边界（2026-10-07）

同日公开取证发现两套快速入门并存：[通用平台快速入门](https://support.huaweicloud.com/qs-agentarts/agentarts_04_0000.html)（更新 2026-09-23）介绍服务开通和 CU 订阅；[华北-北京四开发平台快速入门](https://support.huaweicloud.com/qs-agentarts0/agentarts_04_0000.html)（更新 2026-04-29）保留基础版/企业版及另一套资源限制。[产品动态](https://support.huaweicloud.com/wtsnew-agentarts/index.html)（更新 2026-09-24）另记平台升级与 Managed Agents。引用这些资料时须保留各自的区域、产品和日期，不将套餐、限制或新能力直接套用到当前西南账号与已有运行实例。

上述公开页面不证明当前账号权益、模型授权、余额、运行实例绑定或部署状态；平台试用模型额度也不等于已部署 API 的模型授权。本次未取得赛事页面新的完整规则正文，不更新赛事截止日期或代金券结论。
