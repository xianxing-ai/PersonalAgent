# F04 Wiki 与作用域记忆接线（2026-11-01）

根整合追加：Main 已消费公开 `createF04WorkflowWorkerPorts`，复用同一 Knowledge config/export 和 `proactiveHost` 的原 Fact namespace；后者只代理原公共 source/Feed/impact 方法，`recordPublicSource` 的原 read context 完整传递。重复可选 host 不覆盖已配置 F04。F04/Main、F12 Live/归来及模型关联联合定向 95/95、零跳过，全量构建通过，日志 `.cache/integration-f04-voice-build.log`、`.cache/integration-f04-live-composition-tests.log`。

后续组合已将 `f04Recovery` 注入原 Runtime，并接同一对话核实按钮。Main 知识出口在原 projection 阶段消费 `createF04RecoveryExportConsent.prepare`，与普通 workflow 出口共用当前固定部署绑定；普通知识结果仍使用原 requirement，恢复确认失败直接拒绝。`f04-recovery-main.test.mjs` 实际 Main 回调 2/2 通过，涵盖 preflight、普通出口、新恢复确认及拒绝路径；首次测试源代码提取遇到 Windows CRLF，修正测试读取后通过，未修改产品门禁。真实原生点击、固定部署云出机及这些追加提交的最终组合检查仍待验。

Competition Profile，基线 `df3f6c48`；工作树 `.worktrees/pr531-f04`。已实现下列公开来源纵向路径及 N04 原投影只读恢复；F04 整体和真实 AgentArts 验收尚未完成。设计节点、现有模块和真实配置分别判断。

## 最小纵向范围

复用原七个节点、configured worker、Runtime/ToolGateway/Policy、受信模型选择、Knowledge source lease、原读写工具与 journal、既有 CompetitionFactHost/Memory Feed/FactProjectionStore。Main 与公开出口由集成树串行装配；不新增知识库、记忆库、任务库或授权机制。

首个路径固定同一已配置 public Knowledge 来源和 Memory namespace，只处理已有公开源映射及其已有 Fact 版本。输入是候选文本/类型及显式公开查询，不能让模型指定宿主目录、跨 namespace、当前版本、授权记录或事实确认状态。候选类型可以描述事实/偏好/责任/推断，但语义判断不是动作授权；写后记为原来源的 external_observation，不能冒充 user_confirmed。

| 节点 | 原消费与证据 |
| --- | --- |
| N01 | 冻结原任务候选、来源配置、公开查询和既有 Fact 标识。 |
| N05 | 原独立 knowledge.search 子任务及原 policy 的 200 字投影，固定 public Memory 当前头/版本链；引用是原来源，Fact 是摘要。 |
| N02 | 原 decision.choose_candidate 回执；只有相容、冲突、失效等有限候选，选择不产生写许可。 |
| N06 | 重新核对当前来源、原 Fact/版本关联、明确可写路径与原工具描述；缺失拒绝。 |
| N03 | 受信 host 绑定原候选到唯一原 knowledge.apply_note_patch 子任务，仍独立工具卡审批。路径和 expected SHA 来自宿主，结果仅按原写工具出口投影；raw receipt/backup/journal 留本机。 |
| N07 | 冲突候选保留在原 TaskRuntime checkpoint，绑定来源、scope、原选择和未解决项；不进入当前 Fact、不改写已有真实事实。 |
| N04 | 已确认源写入后只读核实原 afterSha，再沿既有 CAS/Feed/impact 更新当前来源观察、失效旧投影和索引；冲突分支只隔离候选并使本次候选上下文失效，不凭模型撤销当前事实。 |

初始可写范围收窄到原检索实际读回的单行、明确可写既有笔记和既有源映射；更广正文、私人 Wiki、跨作用域迁移、彻底遗忘仅在现有具体原授权/来源入口能够证明时开放，否则给出对应 unavailable，不用公开流程替代私人许可。不会为了凑齐节点把这些缺项标为完成。

## 一致性与恢复

原文写入会有意改变来源 revision，因此写前原版本、写后原已确认 afterSha 和 Fact 投影阶段必须分别核对。不能在写后继续要求旧文件 hash，也不能接受任意新文件版本。未知写入不重做：保留原 ToolGateway/Knowledge journal，沿 F24 原结果核实路径读回。已发生源写入后的投影错误保留原效果和未完成投影，不能把恢复变成第二次源写入。

隔离候选使用原 TaskRuntime 的持久 checkpoint，不被 Memory 查询当成生效事实。Fact 来源变化使用原 append/withdraw、Feed、投影与影响记录；不制造独立缓存失效总线。F04 条件分支需要受信 N03/N07 guard，N03 通过 host 包装原工具出口；只更改 F04 映射/模板摘要，不增加节点或改 Engine 调度。旧模板/部署摘要继续拒绝，历史证据保留。

## 当前实现与验证

Runtime `createF04WorkflowWorkerPorts` 返回原 7 节点的 configured worker、5 个受信 host、2 个 guard 及 `recovery`；Desktop `createDesktopF04WorkflowWorkerPorts` 消费与 F05 相同的已配置 Knowledge source 和 `{memoryNamespace,facts}`。工厂缺少原来源/同步版本检查/原工具投影/公开 Fact CAS 与消费端口时不注册。`recovery.readAvailable/reconcileOriginalReadback({taskId,deadline,signal})` 只接受该原图当前 N04，原会话/期限/父边/执行授权/参数/索引失效记录/源写回执/投影意图必须逐项一致。只有原 Fact 修订与原 durable impact 均读回才核实 N04；不执行来源写入、CAS、Feed、impact 或索引变更，不自行恢复图。Main 与 Runtime 公开消费桥由集成树接入，尚未作为本包验收。

本树依赖独立离线安装；初始根 build、修改后 AgentArts/Runtime build、AgentArts 原 Engine 22/22、F04 Runtime+Desktop 10/10 通过。F04 测试实际执行 Windows 受控文件写入/原恢复日志、SQLite Memory、原 Knowledge policy、Runtime/ToolGateway、原 Engine 和 Desktop 来源适配；模型分类、云传输、原生选择/确认与加密存储替身明确 Synthetic。正常更新保留原 Fact 引用并追加 external_observation；冲突/无效候选写入与 CAS/Feed 均为零；原长摘录裁剪后不能写完整行；异步原 policy 撤销不导出。N04 durable impact 已完成但回执丢失可跨 SQLite 重开只读核实；未完成 impact 保持 unknown；重复/并发读回零执行，意图污染、文件替换、取消/过期拒绝。此处不将同进程数据库重开冒充独立 OS 进程重启或真实云验收。

### N03 原知识观察恢复增量

原 business origin 证明单独交付 `c6e57338`；恢复消费沿其 original graph/host/child、原参数/配置/期限/Policy 执行身份，再复用原 F24 完整核实器提取的同步 `readFinalizedKnowledgeWriteEffect`。原 KnowledgeWriteReconciliationAdapter 读取现有 journal，接受已核实 observation 并完成匹配锁的元数据清理；从不再次执行源写入。`applied/not_applied` 保持观察语义，不改写成原 writer 的 `verified`。知识写出口仅此目的升为 `knowledge-explicit-public-write-v2`，原 search 仍 v1、原工具输出 Schema 不变；只有原 task/参数/配置/已接受回执与 verified observation 全部相符才输出 `{state,changed}`，不导出 path/hash/backup/operation/evidence。原 normal verified 路径兼容。

F04 配置摘要升级为 `f04-public-source-v2`，最终结果可明确 `not_applied`；旧配置摘要拒绝，不迁移旧未知操作身份。恢复资格仅原 N03/N04；未完成/文件替换继续 unknown，已核实 N03 最小投影之后再由原 resume 路径继续 N04，副作用各自审批，不自行重放。N03 与 N04 均已在独立新 Node 进程重新装配原 SQLite、来源 writer 与工厂后核实；子进程 source write/CAS/Feed/impact/index 次数全部为零。N03 原 journal读回后父进程续图，源写入仍仅 1 次，Fact CAS/Feed/impact 各 1 次。观察污染、不同结果及私有撤销拒绝。

增量 F04+Desktop 13/13；最终 v2/投影精确性补丁重跑三项恢复 3/3；原 Knowledge/F24 核实器与工具 16/16，F24 worker/native消费 17 pass/1 skip（该命令未设置 Windows helper，跳过的是旧 F24 真实 writer 项；本包 F04 已实测实际 writer）。Runtime build通过。`not_applied` 原运行、Policy 与观察核实是实际代码，但负效果 journal/finalizer 在该单独用例是显式 Synthetic；不冒充测得真实失败前持久恢复。

**实际 Main 恢复出机还未通过**：本包 prepareCompetitionToolExport、模型和原生审批使用 Synthetic。生产 authorization-question-host 的 `operations` 内存授权在新进程不存在，`currentRequirement('knowledge-export')` 不会为已完成/失败旧 child 新发授权；恢复 observation 不能沿旧已失效卡静默出机。已加入实际 question host+原 Runtime 已完成 child 的拒绝断言，并交集成树沿既有 `workflow.export` 原生入口补精确重新确认，必须绑定原 observation/source/config/当前部署。该缺口不影响真实原 journal 核实证据，但阻止宣称完整产品恢复已经可用。

仍可推进项：Main 恢复精确出机确认、F04 recovery 原用户父任务 UI/公开调用桥（下一包）、私人 Wiki/私人 Memory、跨作用域迁移与彻底遗忘。现私人消费只允许用户明确选择的已确认 Fact 摘要经原生确认出机，Knowledge private 原读写出口仍拒绝；public 工厂不能借此读取或写入任意私人来源。不得以本包提升 F04 或 #531 总体验收状态。

### 原用户任务恢复调用方

Runtime 新增 `f04Recovery` 受信选项及 `readF04RecoveryStatus/readF04RecoveryAvailable/reconcileF04WorkflowTask`，与原 F24 共用父任务→唯一原委派子图→当前待核实 host 的资格/核实/原 resume 实现。旧 F24 方法与 kind 保持兼容，F04 kind 是 `f04_knowledge`；新观察期限不能延长原任务期限，旧 revision、变更的委派父边/部署、取消和其他图均拒绝。Desktop 原 `task.reconcile.finish` 消费 F04/F24 自有资格；按钮说明核实后继续且后续独立审批仍保留，不改变任务终态。

Runtime build、Desktop 入口与状态 20/20、F04/F24 原父任务消费定向 6/6 通过，后者包括实际 F24 Windows writer 恢复（前述未设 helper 的 skip 已补验）。F04 public 方法实际定位原 user parent、保持未完成 impact unknown，已核实 N03 后调用原 graph resume；源写入仍为一次。Desktop sender/surface/observer 是显式 Fixture，此处不宣称 Electron 目视已验。Main `f04Recovery` 注入及最终 UI/精确出机重新确认由集成树接线，尚不能宣称完整产品恢复已验收。

### 原观察的单次精确原生出机确认

`readF04RecoveredWriteExport` 仅为原用户父任务的当前 F04 pending N03 读取已接受的原知识 observation；原 graph/host/business child、参数、配置、操作、会话、父任务 revision、原期限与当前部署仍须匹配。未核实、其他任务/图/运行、取消、过期或污染的 observation 不产生出口绑定。返回最小 `{state:applied|not_applied,changed}` 和本机身份摘要，不包含正文、路径、备份或日志。

Desktop `createF04RecoveryExportConsent(...).prepare(scope)` 在知识写结果 projection 阶段调用此公开读口，再沿既有 `confirmApplicationAuthorization('workflow.export', value, {scope,deadline,signal,isCurrent})` 产生一次新的精确确认；不恢复旧内存许可，不放宽 `currentRequirement`，不授予业务执行权限。确认前后复核原来源/观察/父任务 revision/配置/部署/原 proposal/最小 payload，异步变更后已记录的同意不再放行。普通知识读写和 preflight 返回原路径。此 helper 和公开口无需数据库迁移，F24 原接口不变。

实际 AuthorizationIntentHost、AuthorizationQuestionHost、Runtime/Policy 的 10 项定向测试通过，确认后的来源、观察、部署、目的、父任务 revision、payload 和取消变化均拒绝。原受控 writer/journal、SQLite 重开、公开父任务 recovery→新原生 intent→原图 resume 的 applied/not_applied 两条链通过；等待确认时不执行写入/CAS/Feed/impact，恢复后原写入调用总数仍为一。真实原 observation 被污染时，实际公开绑定和确认有效性立即拒绝。模型/云传输/人类点击是 Synthetic；负效果用例的 journal/finalizer 也是显式 Synthetic，不能代替真实失败前持久恢复证据。

最终 Runtime build、F04/桌面来源/精确授权/旧 F24 恢复与桌面核实入口联合 46/46 通过（无 skip）。这解决前述旧卡不能恢复的实现缺口；Main 的 helper 构造及知识 projection 分支消费由集成树接入，尚未在本树宣称真实 Electron 操作或 AgentArts 出机完成。私人 Wiki/Memory、跨作用域迁移与彻底遗忘仍属于 F04 后续范围，不提升整体完成或 frozen 状态。

## 后续验证

实际 Engine/Runtime/Policy/ToolGateway、受控文件写入和原 journal、独立 Memory SQLite：相容更新前后版本/旧来源保留；冲突隔离零事实写入；未授权/跨作用域/版本变化/候选改参拒绝；原工具投影及异步撤销；未知写入跨重启零重放；已知写入后投影中断保留原效果；Fact Feed 与原依赖失效读回。模型/网络/原生确认的 Synthetic 部分独立标注。

真实 AgentArts 固定部署/模板/trace/评估、实体应用授权与 UI、来源账号和独立非作者审核另验；本计划和本地编译/Fixture 不能解除 #531 全接线及真实验收后合并的门槛。
