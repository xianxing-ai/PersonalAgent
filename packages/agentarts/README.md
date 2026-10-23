# 自有 AgentArts 编排包

2026-10-22 源码增量 `owned-1.9`：按用户最新要求只精简操作审批提示。普通任务直接提出目录内合法工具操作；审批由原统一宿主卡处理，聊天中不再索要“确认/同意”或复述。宿主仍认可的同任务批准不重复询问；工具续接继续完成原目标，不再被 FAST 的“只总结、不追加动作”阻断。JARVIS 身份与风格段、结果答复提示保持原字节，实际 Policy/授权/结果未知/Schema 门禁不变。源码构建与 46 项定向 Fake/字节检查通过，真实模型与云部署均未运行；现有钉版镜像不会因源码合并自动更新。见 [审批提示精简记录](../../docs/competition/evidence/TASK_ACTION_PROMPT_SIMPLIFICATION_20261022.md)。

2026-10-21 源码增量 `owned-1.8`：按用户提供的 JARVIS 原文仅替换指定声明，保留另外八个声明源码和执行门禁。此处版本是源码/角色诊断标识，**不表示已部署云端版本**；现有 Desktop 仍使用独立钉版 deployment 配置，不自动切换部署。原文 SHA、AST/hash 静态验证及未运行项见 [源码验证记录](../../docs/competition/evidence/JARVIS_EXACT_PROMPT_VALIDATION_20261021.md)。本轮没有真实模型、音频、镜像或平台部署。

2026-10-20 增量 `owned-1.7`：续接可接收经过宿主门禁的 `goal` 与 `priorContinuations`，增加补充、更正、来源省略和回答覆盖要求。旧 JSON 仍兼容；固定 `arm64-context-1-7-1020` 已部署，隔离真实文字上下文7项及历史原文工具取回通过，当前桌面显式启用新版。覆盖范围、启动配置和非全绿检查见 [会话完整性记录](../../docs/competition/CONTEXT_INTEGRITY_20261020.md)。

2026-10-19～20：`owned-1.6` 区分初始派发与 continuation 用户答复提示，分开助手身份与内部执行角色，避免将问候/写作/上下文回忆默认生成执行报告；保留严格 JSON、ModelGateway 和执行门禁。宿主投影、最终八项真实测试及整仓检查限制见 [修复记录](../../docs/competition/CHAT_CONTINUATION_REPLY_20261019.md)。

2026-10-14 增量：生产镜像注入公开进程内 `OwnedCandidateSelector`，普通结果、World/Plan KEEP/RECHECK 及修复终审候选由唯一镜像内 Laya 最后选取 `proposal` 或 `review`。候选先经过既有严格来源/Schema 校验，Laya 只返回有限标识，不产生长文、权限、Evidence 或任务终态。既有构造器前三参数保持兼容；不注入选择器的历史调用不是新的嵌入 Laya 比赛配置。

可选第五参数接 `OwnedWorkflowEngine`；`getOwnedWorkflowCatalog/getOwnedWorkflowTemplate/invokeOwnedWorkflow` 公布并推进 F01–F28 的独立版本图。`prepareOwnedWorkflowCandidates` 复用现有角色 ModelGateway 制备候选数据，然后由相同选择器选择；真实 Host、工具和回执验证仍须独立注入。不新建任务库或公共 task wire，详细行为及缺口见自有工作流模块文档和镜像 README。目录/离线测试不证明真实 28 功能闭环。

选择上下文包含节点种类、输入/输出字段、证据要求、前驱状态与完整实际值、完整候选值及分支/复核属性。候选制备要求语义有差异：单一明确输出只提供一份充分候选，不枚举同义措辞或样例变体；真实不同路线仍保留。此提示不保证真实模型一定消除冗余，须按实际候选与耗时读回；没有新增阈值、删除复核项或授予模型执行权限。

当前节点边界与整图目标明确分开：tool 候选只是尚未执行的 `{toolName,toolVersion,arguments}`，不要求在首个读取提案前拿到读取结果、后续比对产物或用户授权；执行仍由本地 Runtime/Policy 控制。完整用户输入及下游要求保留，适用于当前生成节点的额外合规字段也保留。运行日志用固定 `workflow_candidates/candidate_response`、nodeId、实际候选数量与错误码区分制备空结果和选择器失败。候选数组 SHA 只用于运行日志关联，不是模型质量、执行或授权证据，不记录候选正文、scope/path 或任意错误信息。

候选制备与 Laya 选择共用同一当前节点边界；两处均可见该节点精确已公布工具目录及 inputSchema。选择问题评估“该阶段的候选是否受任务、参数、Schema 或实际来源支持”：尚未执行的请求不要求未来执行结果，生成事实/文档仍要求实际来源。此接线补足判断材料，不保证 Laya 必须接受任何候选，不改变复核项或本地 Policy。

2026-10-12：新增 `getOwnedBindings()`、`invokeWorkflow()`、`invokeController()`，固定8个Workflow与3个Controller。
World/Plan独立阶段返回 role_report；Review/Controller 返回 application_result；均为 unverified。
前置报告逐次按当前宿主来源重验，不扩 candidateVersion1.0、授权或执行范围。
原空 MVP Controller 使用标明 new-owned-binding 的新路由。接口见
[镜像绑定说明](../../docs/competition/OWNED_IMAGE_BINDINGS.md)。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

`OwnedAgentOrchestrator` 只负责云端语义编排，复用 ModelGateway 和现有严格
Coordination parser。普通目标走 fast，合法修复走 world → plan → review；
confirmed 普通结果只总结，不误入修复；命令检查回执可确定性总结。
所有输出仍是不可信提案。本包不拥有授权、工具执行、任务终态、数据库或 Evidence。

入口为既有 `{goal,availableTools}`、`{continuation}`、普通文字或固定主动 Goal 包装。
续答来源接线采用独立 wire 投影：`repairContext` 仅含 revision、targets、allowedDependencies，
target 仅含 node、requestedSummary、requestedDependencies；本地 fact/projectedFact 和原始边留在宿主。
新增 `repairSources`（sourceVersion `1.0`、expectedGraphRevision、nodes）只承载实际已确认图谱的
最小原/新 Fact 与目标节点投影，不能从引用补造来源。解析器重验重复、最新 active 基线和依赖；
同批目标下一版只记 prospective，不记已观察来源。初始输入仍要求 64hex ID，续答沿用已有引用 ID。
旧续答无 repairSources 时继续 sources=[]/RECHECK；未知字段或版本拒绝。新 wire 不授权执行，
不清除既有 hold、不重发旧任务；合成宿主导出策略版本随之更新。
ModelPort 按角色注入，可替换供应商；每次调用必须提供输出 token 预算、原期限和取消信号。
模型失败不回退；角色回执仅记录角色/请求标识/状态/token，不记录内容或凭据。
`RoleReceipt` 兼容增加 `spanId`、`startedAt`、`endedAt`、`durationMs`：每次角色模型调用生成
独立 span，同一 request 内的 World/Plan/Review 可关联，同角色并发也不会混淆；时间为 UTC ISO，
耗时来自单调时钟。已开始的调用在成功、失败、取消或超时时各有一次结束回执，预先取消不开始调用。
`completed` 仅表示模型输出已解析为对象，后续报告/候选校验仍可能拒绝，不能作为任务成功或工具执行证据。
observer 的同步异常及异步拒绝均隔离；不维护额外 span 缓存。这是应用回执，不是华为平台 trace。
部署入口在 `apps/agentarts-runtime`，迁移边界见 ADR-0012。

这是 code-owned 路径的受限实现，提示词进入版本控制。2026-10-09 已核对已授权的8个 Workflow、
3个顶层 Controller 导出，按原有内部职责补充完整 World/Plan 报告；逐项迁移与缺口见
[迁移矩阵](../../docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md)。清点不等于全量等价或真实云验收。

`owned-1.4` 调整 FAST 角色的回答口径：先给用户问的那件事的可用结论，再给依据；已核实数据足以支撑建议时
给出带限定条件的判断（例如“按目前获取到的数据，下午适合户外活动”），不把“未逐项验证”当成“不能给建议”，
也不只罗列数字或内部字段。信息不足时说明缺什么并给出基于现有数据最稳妥的选择。权限、工具提案格式、
校验与“不编造”的边界不变。

`owned-1.3` 为 World 增加代码从已解析来源生成的输出词表：合法 Fact/Goal 原文、最新连续变化对、
允许的目标引用及报告类型。词表不预选影响或处置，不修补/放宽模型报告；原始投影仍是数据。
它修复真实模型把 Plan 放进 observed_facts、编造额外变化对及输出 `kind: plan` 的格式问题；
模型输出仍须通过原有严格校验。输出契约、候选版本、权限和执行边界均不改变。

`owned-1.2` 起支持显式 prepared Goal target 的完整内部 World/Plan `reportVersion: "1.2"`；
旧 Decision/Plan target 的完整 `reportVersion: "1.1"` 报告继续兼容。报告校验 graph revision、
宿主提供的事实/Goal前后版本及原文、最新目标与允许依赖引用。World保留显式/推断观察、
变化与 direct/transitive 影响标签；推断、缺项和缺少前后版本不能生成修复。
direct/transitive 是待本地图谱预览的模型分析，当前投影没有完整旧依赖边，不能据此证明因果。
Plan保留保留/复核/修订/移除、依赖更新、证据需求与本地后续建议这些独立职责。
步骤分类互斥，影响目标不可遗漏；未列出的无关目标默认不改。

确定的 `revised_steps` 映射既有 `repair_candidate`，依赖逐字采用宿主
`requestedDependencies`，Review不得替换或遗漏方案。`preserved_steps` 不产生写入，
未满足的 `rechecked_steps` 返回RECHECK。现有候选不能表达删除、新步骤或工具动作，
含确定移除/后续动作的报告返回 `UNSUPPORTED_CAPABILITY`，不假装已经迁移这些行为。
`evidence_required` 仅是尚需可信本地核实的要求，保留给Review，不生成或满足真实Evidence。

Goal target 必须精确对应宿主投影中已提交、最新且 active 的 Goal 节点及原基线；
World 的影响类型只能按实际 source.kind 声明，不能把 Goal 冒称 Decision 或 Plan。
有 Goal target 时只能使用完整 1.2。World、Plan、Review、Router、Controller 和默认 Controller
都不接受没有 `reportVersion` 的 World/Plan 报告，并核对来源摘要、连续事实变化、节点修订、
`expectedGraphRevision` 和影响范围。严格校验由这些可信入口固定开启，调用方不能传参关闭。
直接 `invoke()` 在没有 Goal target 时保留 owned-1.0 紧凑报告，包括带来源的 Decision/Plan
初始投影，以及只含 `repairContext` 的继续轮次；该路径不读取绑定信封。
完整 World/Plan 必须声明相同版本，拒绝 1.1/1.2 混版和完整/紧凑混用，
也不直接执行无版本的旧导出 DSL 或报告。
继续轮次只含 `repairContext` 时 `sources` 为空。直接 `invoke()` 先判断 World 处置，再判断 sources：
紧凑 KEEP 且 `affected` 为空、没有缺项时返回「KEEP：世界状态分析无需修复。」；
紧凑 REVISE、RECHECK 或其他不能确定修复的结果才返回 RECHECK。
没有事实或 Goal 来源时，版本化 KEEP 或 REVISE 在 `validateWorld` 被拒绝，不会返回 KEEP 文本；
版本化 RECHECK 且写明缺项时，直接 `invoke()` 返回 RECHECK 文本。
这些直接调用都不进入后续 Plan/Review，不产出 `repair_candidate`。
绑定 Plan/Review 不接受无版本报告；版本化报告通过校验后 sources 仍为空，则返回
`Repair source projection required`，同样不调用后续模型。
后续需宿主公布来源投影契约，不能由模型补造。缺来源不静默切换旧提示词或供应商。
应用 JSON 和本地 Runtime 契约保持原有 provisional 状态。

公开 `candidateVersion: "1.0"` 保持不变。云端返回候选不会修改 Goal/Plan；
只有后续独立的本地 Policy 审批、范围预览、CAS 提交及 Evidence/读回才能确认图更新。
没有来源节点的继续轮次不能猜测 Goal 类型或把内部影响标签当成已校准图事实。

来源摘要上限为 8192 字符；完整初始及续轮 goal 上限为 128000 UTF-16 单元，
`{goal,availableTools}` 包装同时受公开 Coordination 和本包的 1100000 UTF-8 字节限额约束。
这是应用输入预算，不代表模型原生 Token 窗口；已发布云镜像需同步更新后另验收。
已提交的长基线不扩大 replacement、继续轮次 requestedSummary 或公开候选的 1024 字符限制。
每角色输出 token 预算、原期限与取消仍生效；生产宿主默认输出预算为 2048，
未证明真实模型能在该预算内输出包含长来源原文的完整报告。

2026-10-11 的 1.2 消费验证使用合成图谱、Fake Laya/模型/HTTP，区分云端候选与独立本地
审批/CAS，不代表真实云模型、费用、实体 Desktop 或全模块验收。
此前基于 `7dfd4ada` 的全量检查不覆盖这次 1.2 累计变更，最新组合仍需重新完整验证。
