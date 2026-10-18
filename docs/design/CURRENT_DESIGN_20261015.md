# 当前详细设计：常驻责任、可信执行与按需影子

> 2026-10-17增量：Owner 已明确恢复编码最小修复的实现，要求算法与对应多轮工作流进入自有镜像，见 [ADR-0033](../adr/0033-coding-minimal-repair-workflow.md)。该工作包当前 in_progress；下文及历史记录中对此部分的暂停不再是现行指令。模型资格、整体架构与其余工作流完成状态不由此升级。

日期：2026-10-15。目标 Profile：`huawei_ict_agentarts`。**当前设计意图与实验实现对齐；架构未最终定型。**
本页取代历史设计中冲突的模型部署、默认并行、发布和完成状态描述；不撤销既有 Runtime 权限边界，
不把设计保存、接口存在或单条真实案例提升为全部模块完成。历史原文与日期见[导航](README.md)。

入口：[PRD](../PRD.md) · [架构](../ARCHITECTURE.md) · [28项状态](WORKFLOW_STATUS_20261015.md) ·
[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作者接口](../competition/PROACTIVE_COLLABORATOR_INTERFACES.md) ·
[具体分工与下一工作包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [运行指南](../competition/TEST_IMAGE_V3_RUN.md)。

## 1. 当前模型、部署与事实来源

| 部分 | 当前设计选择 | 已有实现与证据边界 |
| --- | --- | --- |
| 语义判断 | 本机常驻 Laya 从有限候选中选择；仅经独立任务资格验证的站点可直接决定 | 原权重及 SDK 单实例宿主服务/selector 已可调用；领域资格未证明，两个真实案例各3处裁决全部升级 DeepSeek，不能称全局主决策已合格 |
| 高级模型 | DeepSeek 经 AgentArts 新 `/inference/v1` 模型代理，底层平台 MaaS 来源如实记录 | 真实代理 API 已返回；不直连供应商 fallback，不把语音百炼入口用作 DeepSeek 替代；文字 JSON 工具提案不等于原生 function calling |
| 工作流 | 全部 F01–F28、185 节点模板及其依赖、条件与串行推进逻辑在自有 ARM64 镜像 | 代码/catalog/云指定版本目录已读回；图和节点数量不等于28项真实业务验收 |
| 实际执行 | 原本机 Runtime/Policy/ToolGateway/Evidence 负责权限、工具、副作用读回与任务终态 | 镜像只提出候选/宿主请求；验签 receipt、模型结论与来源文本都不能授予权限 |
| 语音 | 百炼已有 Live 端口与本机加密配置；语音可主动询问、接受确认/暂停/静默设置 | 已有端口及有限握手证据；真实麦克风、听说、通知设置和 AgentArts 主任务完整组合仍分别验收；AgentArts SIS 适配不可用 |
| 记忆 | Wiki 正文/来源版本与 Memory/FactChangeFeed 分工，按权限读取上下文、目标与经验 | 消费公开端口；引用、实体、版本、撤回和缺口保留，不把摘要当原文或把记忆当授权 |

Laya 的“本机常驻”是部署与产品生命周期目标，不是容器内嵌模型；镜像不含权重、Python 或 PyTorch。
现有宿主可管理单实例生命周期，真实测试按轮启动/停止；Desktop 长期驻留、设备休眠/恢复和长期资源占用
仍需对应接线与验收。电脑离线不虚构可执行能力；不新增云电脑、任务库、调度器或模型入口。

## 2. 从世界变化到责任推进

四个入口保持 `connector / user_instruction / subtask_feedback / wake`，复用原 `/invocations` 增量协议。
进入系统的是带来源与版本的变化，不是来源自报的权限。记录实体/字段锚点、观察时间、事件/批次身份、
原 conversation/message/quote、Goal/责任引用及 Evidence；upsert/delete/retract/correction 不能只取最新摘要吞掉。

1. ConnectorHost 先持久化 pending 批次，event sink 以原 batchId 幂等确认 durable 后才提交 cursor。
   丢失确认、重启或授权缺口先恢复同批次；未订阅不直接代表与所有目标无关。
2. 读取当前 TaskRuntime、用户目标/持续责任、必要原文与 Wiki/Memory、既有经验和作用域引用。
   同源同版本去重；冲突或证据不足保留不确定性，不能靠关键词匹配普遍证明语义一致。
3. 确定性代码处理明确规则、版本和数值；语义候选交现有判断。资格不足、复杂/不确定、来源冲突、
   重要事项抑制或执行风险未知时升级 DeepSeek，不以 Laya 自报高置信填补资格。
4. 候选包括继续、补查、委派、局部计划、影子、通知、问用户、延后或忽略，但动作名不是已绑定能力。
   主控将模型建议映射到原公开工具；Policy 核对当前授权、参数摘要、revision、deadline 与取消。
5. 实际回执更新原事项、依赖和 Evidence；有明确原因才交原 Scheduler 唤醒，不制造无依据循环。
   未知副作用先读回原 operation，不能从新 revision、重启或新候选盲重做。

现有 `createRuntimeProactiveConnectorHost`、`createProactiveWorkflowSession`、`createRuntimeAtomicStatePort`
与 `createRuntimeNotificationHost` 复用原 SQLite/CAS、ConnectorHost、Policy/ToolGateway 和 Scheduler。
session 先存 intent，验签/CAS 提交后释放 proposal；仅受信纯 frontier 能重算丢失响应，不运行模型或工具。
真实连接器账号、长期运行、无设备云宿主与完整业务消费方接线仍按接口目录逐项确认。

## 3. 无人值守、归来与语音确认

用户进入无人值守后，系统继续已有授权下的工作和来源摄取；沿原任务/检查点运行，不延长原期限或 scope。
设备依赖离线时保留 waiting_device；独立且真实可用的 cloud_persistent 分支可继续，不能凭配置名声称云持久宿主存在。
pause/resume/cancel/return 都绑定原会话与控制 revision。取消受理与执行停止区分，未知结果保留核实入口。

需要用户决定时，语音/界面说明当前事实、证据、具体问题和需要的动作；清楚且已有授权的步骤不机械再问。
最终结构化用户命令由受信宿主核验来源、finality、echo、有效期与参数摘要，再走原授权路径。
语音 partial、播报回声、模型自述“用户同意”或旧录音不能自行更改权限、静默或打扰额度。

归来摘要从原持久状态汇总 done/changed/pending/blocked 和新增 Evidence，只保留仍有效变化；
不重发过去横幅或语音，不把 return、已读和投递确认混为一件事。普通查阅通知中心不计主动打扰。

## 4. 用户可调打扰、静默 feed 与投递

在同一 NotificationService/原存储状态上维护 global→connector→responsibility 继承。
用户可调 `mode`、非负或 null 的 `maxInterruptions`、`windowMinutes`、`silentUntilUtc`、
`preferredChannel`、`allowUrgentBreakthrough`、`digestMode` 与原 quietHours；不擅设固定每小时次数。
全局静默和父级额度不能被局部放宽绕过，紧急突破仍必须符合用户明确规则与真实渠道授权。

静默继续 ingest/工作/feed，unread 独立于 deliveredAt；撤回/过期不在归来摘要重新打扰。
一次通知 round 跨通道/重试只计一次：原子预占→发送前读最新策略（含 preferredChannel）→持久 sending→渠道回执。
未知投递不退款、换轮次重发或重置额度；操作幂等/CAS 不清旧队列、批次游标和未读状态。
普通 StoragePort 不提供跨进程原子保证；未绑定实际 CAS/事务 port 时保持 quota safety unavailable。
实际横幅、语音与设置消费方还需原 Runtime 端口验收，不把库测试当真实设备成功。

## 5. 高级影子：开关、主任务优先与交付条件

这是最新用户设计意图，不能把现有顺序实验写成已实现的机会并行调度。
高级模式开关由受信用户设置提供，**并入已有语义判断与候选选择**，不为每个节点固定增加一次独立判断或教师调用。
是否启动影子同时考虑当前任务价值/风险、已有验证、机会资源、与主任务的竞争和预期收益；参数来自可信设置及实际观测，
不能由模型自报资源空闲或固定收益分数替代。资源/收益证据不足时升级 DeepSeek或保持未启动，不自动认定值得运行。

- 主任务拥有优先级。影子使用隔离目录/namespace/权限、同基线与任务条件；不得污染用户工作区或消耗原授权重做未知写。
- 明确要求“双方案比较择优”的任务，需要双方达到原验收条件后再比较；一方失败应披露 partial，不能补造双方成功。
- 其他任务可以先交付已验证主结果，影子按机会继续/停止或供后续改进；不因高级开关永久阻塞用户等影子。
- 候选晋升只使用可信验签、同 task/session/revision/deadline 的可比结果与明确验收配置；configuration port
  经原 Policy/ToolGateway 授权，以 revision CAS/原参数 digest 写入并回读。结果未知先核实原 operation，不盲重试或回滚新版本。
- 收益与资源趋势供现有主控/委派/Scheduler 使用，不新建独立“影子调度器”。经验复用与权重训练分开，未执行训练不能宣称持续训练。

当前源码已有主/影子策略、签名控制器、只读 replay、评估与 CAS 晋升/回读/回滚接口；真实配置写端口未绑定时 unavailable。
两套真实手工验收为 `await main` 后 `await shadow`，均属于显式双方案比较，证明隔离修复与交付，
**没有证明真实并发、主任务抢占优先、机会资源收益选择、普通任务先交主结果或减少高级模型调用**。
这些差额按[具体工作包](../competition/COLLABORATOR_WIRING_PACKAGE.md)接入原判断及实际调用方，不从设计文字直接变成完成状态。

## 6. 当前真实证据与不可外推范围

发布/云读回：[owned-release.json](../competition/evidence/test-image-v3-20261015/owned-release.json)、
[platform-log-readback.json](../competition/evidence/test-image-v3-20261015/platform-log-readback.json)。
SWR tag `local-laya-v3-244ca434`，ARM64 digest
`sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`；
AgentArts 指定版本 `arm64-local-v3-244ca434` 目录及关联请求日志已读回。它们分别证明发布、该版本目录和请求关联日志，
不等于云端已完整执行下列工具循环。runner 的硬编码 imagePublished=false 不能推翻独立发布回执。

[full-workflow-results.json](../competition/evidence/test-image-v3-20261015/full-workflow-results.json) 的真实完整案例表面为：
本机同版镜像 + 本机 Runtime/Policy/工具/Laya + 远端 AgentArts 模型代理；测试工作区为公开隔离 fixture。

| 案例 | 实际通过 | 时间与保留限制 |
| --- | --- | --- |
| 孙悟空骑白龙马 | 模型从 scaffold 生成原图，显式暂停故障；main/shadow 同基线修复，实际结构/浏览器运动验证后单 CAS 交付，20条 Evidence | flow 167.432s；外层启动/清理183.618s；可辨识美术质量仍需人工视觉审查 |
| 鹈鹕第二轮 | 固定 SVG 故障，main/shadow 同基线、原几何保留、三运动目标通过，单 CAS 交付，21条 Evidence | flow 81.611s；外层89.735s；首轮 partial/shadow max24失败独立保留，第二轮补了验收合同，不能抹平或冒称同源码一次成功 |

41条工具 Evidence 与参数/父关联经只读 SQLite核对；分支父任务成功，协调锚点仍 created，不能声称整体协调父任务终态成功。
两套各3个判断均因站点未合格升级 DeepSeek；6次 Laya 实际判断约182–618ms，150ms目标未达。
短合成质量标签只是宿主冻结期望，不是人工金标或真实账号；原始业务选择质量未达可直接决定/抑制的资格。
没有证据证明本轮减少了高级模型调用、全域质量达标、真实同时前向、权重训练、全部28业务或长期无人值守已验收。
平台日志没有独立版本字段时按关联 request 说明，不假设本机与云时钟完全同步。

## 7. 继续实施与历史适用性

当前分工采用已有三人归属，并由[新工作包矩阵](../competition/COLLABORATOR_WIRING_PACKAGE.md)列唯一 owner、文件、
公开依赖、调用方、验收/Evidence 和下一任务；[ROADMAP](../ROADMAP.md)只引用该矩阵，不制造另一份归属表。

旧设计中的“嵌入式 Laya”“直连 MaaS 默认”“每件事固定多模型判断”“全部影子等双方”“尚未发布”及旧 review 门槛，
与本页冲突的部分已被后续设计/事实 superseded；原日期、作者、测试和有条件能力边界保留。
现有 Runtime 权限、依赖方向、未知结果和来源边界继续有效；PR 合并规则以当前 CONTRIBUTING/AGENTS 为准。
最小修复/依赖重规划算法保留交接，不因本文恢复实施或擅自定稿。新方案不能以文档或 helper 存在越过真实验收。
