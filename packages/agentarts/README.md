# 自有 AgentArts 编排包

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-29（zemeng5208）、MOD-30（zemeng5208）、MOD-31（zemeng5208）、MOD-32（zemeng5208）。产品流程：F26、F28、F01、F02、F03、F04、F05、F06、F07、F08、F09、F10、F11、F12、F13、F14、F15、F16、F17、F18、F19、F20、F21、F22、F23、F24、F25、F27；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

执行模型协作与候选评估；不创建第二个最终语义裁决模型，建立独立影子宿主的能力与证据。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

统一语义裁决默认在华为国内MaaS唯一决策配置；本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。独立节点按真实依赖并行，影子/历史评估默认后台。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

2026-10-12：新增 `getOwnedBindings()`、`invokeWorkflow()`、`invokeController()`，固定8个Workflow与3个Controller。
World/Plan独立阶段返回 role_report；Review/Controller 返回 application_result；均为 unverified。
前置报告逐次按当前宿主来源重验，不扩 candidateVersion1.0、授权或执行范围。
原空 MVP Controller 使用标明 new-owned-binding 的新路由。接口见
[镜像绑定说明](../../docs/competition/OWNED_IMAGE_BINDINGS.md)。


`OwnedAgentOrchestrator` 只负责云端语义编排，复用 ModelGateway 和现有严格
Coordination parser。普通目标走 fast，合法修复走 world → plan → review；
confirmed 普通结果只总结，不误入修复；命令检查回执可确定性总结。
所有输出仍是不可信提案。本包不拥有授权、工具执行、任务终态、数据库或 Evidence。

入口为既有 `{goal,availableTools}`、`{continuation}`、普通文字或固定主动 Goal 包装。
ModelPort 按角色注入，可替换供应商；每次调用必须提供输出 token 预算、原期限和取消信号。
模型失败不回退；角色 trace 仅记录角色/请求标识/状态/token，不记录内容或凭据。
部署入口在 `apps/agentarts-runtime`，迁移边界见 ADR-0012。

这是 code-owned 路径的受限实现，提示词进入版本控制。2026-10-09 已核对已授权的8个 Workflow、
3个顶层 Controller 导出，按原有内部职责补充完整 World/Plan 报告；逐项迁移与缺口见
[迁移矩阵](../../docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md)。清点不等于全量等价或真实云验收。

`owned-1.2` 提示词支持显式 prepared Goal target 的完整内部 World/Plan `reportVersion: "1.2"`；
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

来源摘要上限为 8192 字符；完整初始 goal 仍受 16000 字符约束，
`{goal,availableTools}` 包装同时受公开 Coordination 和本包的 32768 UTF-8 字节限额约束。
已提交的长基线不扩大 replacement、继续轮次 requestedSummary 或公开候选的 1024 字符限制。
每角色输出 token 预算、原期限与取消仍生效；生产宿主默认输出预算为 2048，
未证明真实模型能在该预算内输出包含长来源原文的完整报告。

2026-10-11 的 1.2 消费验证使用合成图谱、Fake Laya/模型/HTTP，区分云端候选与独立本地
审批/CAS，不代表真实云模型、费用、实体 Desktop 或全模块验收。
此前基于 `7dfd4ada` 的全量检查不覆盖这次 1.2 累计变更，最新组合仍需重新完整验证。
