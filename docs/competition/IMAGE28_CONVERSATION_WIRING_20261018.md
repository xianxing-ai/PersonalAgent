# 镜像 28 图与主对话接线矩阵（2026-10-18）

目标 profile：`huawei_ict_agentarts`。首轮接线已发布于 #406 提交 `2e45faa5885ed5370eaa654aa0802f79f7c69450`；本次通用驱动增量以该提交为基线，位于独立 `.worktrees/image28-driver-plan-20261018`，不改 primary。主线另到 `4168bd19`。本文件独占维护，不接管 goo122、Potatos498 或 2511375597-lab 的模块和 Renderer。

本轮只读源码与 Local 静态目录：28 图、185 节点、模板 `2026.10.15.2`，外部 adapterRequirements 共 **152 项：111 host、41 guard**。它们是接口要求，不是已注册能力。没有启动 Laya、镜像进程、真实模型、Windows、账号或云服务，没有全量测试。后续本地显式替身回归单列 **Synthetic**，不能提高真实验收等级。

## 共同调用链与已纠正事实

镜像 `apps/agentarts-runtime/src/main.mjs` 装配 `OwnedWorkflowEngine({externalHost:true,...})`；`binding-dispatch.mjs` 接收 `{workflowVersion:'1.0.0',operation:'catalog'|'advance',...}`。目录返回设计 coverage、templates 与 adapterRequirements；advance 只返回 frontier/proposals/checkpoint，不能替本机执行或宣布任务完成。所有真实操作仍经过原 Runtime → Policy → ToolGateway → Evidence，HostBridge 签署真实本地读回。

`packages/agentarts/src/owned-workflows.ts` 以 `workflow.host.fxx_nyy` 请求 host 节点；未有可信 branch selection 的 condition 节点还需要 `workflow.guard.fxx_nyy`。缺目录条目明确 `unavailable`。41 guard 是声明需求，不代表每一条执行路径都必定同时请求41次；不可用项不能由固定 selected/Fake 冒充真实观测。

生产提供者静态可见：F15 N04/N05/N06 由 `workspace-config-host.js` 和 `product-tools-composition.js` 将原隔离编程工具做别名；F23 N04/N05 有公开服务/工厂，Runtime 收到完整受信 `workflowShadowRelease` 后才装配。其余 host/guard 未找到相应生产注册，具体业务能力可能已作为独立对话工具存在，这不等于整图 adapter 已接。

**F15 不能仅凭 main 未显式写 codingRepair 就判断未注入。** 实际闭包为 main → `createAgentArtsRuntimeApplication()` → `agentarts.ts:183`：当 `initialRequestMode='goal-with-tools-json'` 且有固定 `deploymentVersion`，自动创建 ownedImage 并注入 `codingRepair:{image}`；`codingWorkspace.bindApplication()` 再调用公开 `configureCodingRepairSourceExport()` 挂上元数据与精确原生正文出口。缺版本/密钥/工作区/实际许可时继续 unavailable，不另造 image host。

本轮确定并修复的 F15 主对话断点是：main 的 `delegateUserTasks:true` 将 root 限制为 `subagent.dispatch`，实际 user-work child 能看到 `coding.repair.workflow`；旧 F15 execute 再调用 subagent dispatch 时会被 `subagent-host.ts` 的 `desktop-subtask:*` 禁止递归规则拒绝。现在 `coding-repair-worker-capability.ts` 在同一 user-work 的原 WorkerContext 中复用已有 F15 runner，绑定原proposal/config/deadline，保留递归禁止和旧 root dispatch。原直接 root/host F15 实验和单图云端历史证据不覆盖此新接线；本轮仅有下面明确列出的 Synthetic 验证。

**F15当前生产仍依赖原本机Laya选择链，不能仅凭Runtime消费接通称为可无Laya闭环。** `apps/agentarts-runtime/src/main.mjs:62-76` 在agentarts mode要求 `PA_AGENT_LAYA_MODE=local`，OwnedWorkflowEngine使用 `decision.choose_candidate`；Runtime该工具的selector沿main注入的 `createLocalLayaHost.choose()` 调用，`laya-local-host.js` 在未ready时直接拒绝。运行还受原selector资格、`eligibleForRuntime`及绑定回执约束。本轮不启动Laya、不修改既有选择算法，不用默认selected或另造teacher替代；Synthetic候选选择器只证明原Runtime消费契约，不能代替这项生产依赖。

`proactive.workflow.*` 是已有主对话入口，但镜像 `proactive.responsibility.v1` 明示 `changesOwnedF01ToF28:false`；它是持续责任补充链，不能计算为28图全部接通。

主文字与 Live 现可经原子任务调用 `workflow.image.catalog`，读取这28图的公共设计、精确入口与已注册 host/guard 缺项。该只读入口不探测 readiness、不执行 advance，不将本机设计目录冒充远端镜像版本；F20 即使没有 host/guard 要求，缺图入口仍报告 unavailable。真实可执行性和各图验收仍按下表分开。

## 逐图断点

下表“对话面”只表示已有独立能力或条件入口，仍受真实配置、scope、presence、出口许可限制；“H/G”是目录 host/guard 项数。除 F15 记录的有限历史单图证据外，其余27图无当前完整业务实机/云端验收证据；F15 也不能据历史结果声称当前文字/Live入口已通过。

| 图 / 节点数 | 归属 | H/G | 现有对话面/实现 | 镜像→原宿主断点与配置限制 |
| --- | --- | --- | --- | --- |
| F01 主对话与责任理解 / 9 | zemeng；记忆公共口 goo122 | 6/3 | 原用户 root→user-work、goals、context 已有 | N02 memory/responsibility/model snapshot host 未注册；N04/N05 scope/native-config、N06/N09 task/responsibility commit、补问及条件 guard 未接；普通对话不等于F01整图 |
| F02 语音交互与确认 / 11 | zemeng 14/15 | 10/3 | Live/final transcript、当前审批桥已有 | N01 pending-question/guard 即缺；N02/N03播报/最终转写、N05/N06原审批核验恢复、取消/急停/效果读回未提供对应graph adapter；物理音频未验 |
| F03 世界状态、目标与局部重规划 / 10 | zemeng 27/28；Runtime goo122 | 8/4 | goals create/revise、原 localRepair/proactive 链 | N05 memory.query host、N03失效子图、N06原效果绑定、N07核实、N08补偿授权/N09执行、N04调度与guards缺；不能把模型建议当实际变更 |
| F04 Wiki与作用域记忆 / 7 | goo122 08/09 | 4/2 | knowledge.search/apply_note_patch与公开记忆消费 | N05 memory query、N06来源/写许可、N07隔离候选、N04投影失效及N03/N07 guard缺；Owner不改Wiki提供者 |
| F05 记忆搜索与来源回答 / 7 | goo122 08/09 | 3/2 | knowledge.search、来源出口 | N02组合memory host先缺；N05 citation revision、N07发布来源答案及N04/N06 guards缺；独立检索不是整图完成 |
| F06 待办、提醒与跟进 / 5 | Potatos498 20/23 | 3/0 | todo-host原持久工具与Reminder/NotificationHost | N03 registered_write、N04 clock/revision、N05 deliver graph aliases缺；实际待办能力可用性按本业务宿主判断 |
| F07 日历安排与冲突 / 5 | Potatos498 20 | 2/0 | calendar.events和calendar-meeting-host | N04 freshness、N05 registered_write缺；账号/provider/读写许可缺失则unavailable，不代选提供商 |
| F08 邮件分类、草稿与发送 / 13 | Potatos498 21 | 6/4 | mail.inbox/reconcile_send及mail-analysis-host | N03 archive、N10 operation scope、N06补问、N07 send、N12 wait reconciliation、N13 replan/guards缺；本轮禁止邮件真实调用 |
| F09 订阅、信号发现 / 4 | Potatos498 22/23 | 2/0 | feeds.collect、持久cursor和通知消费 | N02 validate/deduplicate、N04 enqueue_research的graph adapter缺；独立collect证据不算整图 |
| F10 深度研究与证据汇总 / 6 | Potatos498 24；knowledge goo122 | 1/0 | research.search/knowledge.search动态工具 | N05 supported_claims host缺；需实际来源/引用出口与固定模型，研究provider缺配置仍unavailable |
| F11 天气、出行及计划影响 / 5 | Potatos498 20/25；语音zemeng | 2/2 | weather.forecast、calendar.events、已有问答 | N04 voice.ask/guard、N05 calendar update/invalidate_reminder/guard缺；不凭天气读回推断日程已改 |
| F12 通知/安静时段 / 5 | Potatos498 23 | 3/2 | 单个Runtime NotificationHost+原设置/CAS | N02 quiet_hours、N04即时投递、N05到期投递及guards缺；Fake静默/配额不是实机送达 |
| F13 系统检查与诊断 / 4 | zemeng 16/17 | 2/0 | computer.system.observe已注册聚合探测 | N02 system.registered_probe graph alias缺；N04 confirmed_recovery缺，TraceGuard治理/恢复本来排除，不能为凑整图恢复旧需求 |
| F14 浏览器与桌面操作 / 6 | zemeng 16/14 | 5/2 | 新独立安装Windows-MCP受控对话工具；旧Notepad强目标工具 | N01 observation/N02唯一输入锁/N03 registered_input/N05补问/N06 submit的graph aliases和guards缺；本轮跨引擎锁已通过Synthetic互斥/未知结果封闭测试，真实Windows、坐标/DPI与设备并发仍未验证，不把MCP观察当强OS绑定 |
| F15 代码/补丁/命令 / 6 | zemeng 18/29/30 | 3/0 | 自动ownedImage、隔离coding工具与N04/05/06别名、原Graph runner；本轮same-worker capability已接 | 主对话root→user-work→原F15 runner已Synthetic通过，start与两次原HostTask审批恢复同Task；原decision.choose_candidate仍依赖本机Laya ready/资格及回执，本轮未启动或改算法。未做当前Windows/Live/云实机验收；固定version、receipt secret、工作区读写/命令/元数据及exact正文许可缺失仍unavailable |
| F16 CI检查与修复 / 5 | Potatos498 34；GitHub goo122 33 | 2/0 | developer.ci_list/ci_fix虚拟worker及原工具（条件配置） | N01 bound_ci_failure/N04 test_intent_check graph aliases缺；独立developer worker不等于F16图。Owner不接管CI业务 |
| F17 测试失败定位 / 4 | Potatos498 35 | 1/0 | workspace.locate_test_failures、固定命令与CI消费 | N04 deliver_failure_report graph alias缺；其余model/tool节点还需真实目录/配方与元数据出口 |
| F18 PR预审与合并 / 5 | goo122 33/36 | 3/0 | developer.code_review、github.pr.*（条件配置） | N01 bound_pr_diff、N04 current_head_merge_gate、N05 registered_merge均缺图adapter；本轮无Approve/merge授权，不把预审改为合并 |
| F19 Issue分诊与修复 / 5 | Potatos498 38；GitHub goo122 | 4/0 | developer.issue_list/issue_triage（条件配置） | N01 snapshot/N03 enqueue repair/N04 merged readback/N05 close graph aliases缺；保留原模块owner |
| F20 API文档一致性 / 4 | goo122 37（业务）；镜像zemeng | 0/0 | workspace.read_text与run_allowed_command可条件公布 | 唯一无host/guard要求的图；缺主对话generic graph worker入口/固定schemaFile和recipe绑定及图结果消费。最适合先做Synthetic图入口证明，不代写API文档业务 |
| F21 MCP/Skills/连接器接入 / 5 | goo122 05/06/07 | 5/0 | 当前remote-MCP/installed-Skill公开管理与执行 | N01 source_manifest到N05enable_authorized均缺graph aliases；安装不等于启用，Owner不接管registry/安装授权 |
| F22 工作流调试与影子 / 9 | zemeng 30/31；Runtime公共口goo122 | 6/5 | shadow-controller/trace-replay、HostBridge影子签名/准入已有 | N09 trigger/N01snapshot/N03decision/N04trace/N05isolation/N06counterfactual与guards缺生产绑定；daily sampling/资源/同基线真实收益未验 |
| F23 决策配置/评估/晋升 / 5 | zemeng 31/32；既有配置宿主公开口goo122 | 5/0 | N04 promote/rollback与N05readback公开factory+Runtime options已有 | N01dataset/N02temporal-leakage/N03actual-results缺；N04/N05无受信configuration CAS/readOperation、acceptance及完整receipt/test验证端口，main未注入，保持unavailable；禁止新造CAS库 |
| F24 调度/取消/恢复 / 12 | goo122 02/03；镜像消费zemeng | 11/6 | 原TaskRuntime/checkpoint/cancel/reconciliation | N01 persist_graph起全部graph adapters/guards缺；已有Runtime基础能力不自动成为云可调用工具，不另建任务库/调度器 |
| F25 配置/账户/凭据/范围 / 4 | goo122 02/05；主进程zemeng | 2/0 | 主进程可信设置/安全凭据引用已有 | N03 outbound-context check/N04 save_credential_ref的graph adapters缺；凭据永不进模型，不能用任意settings patch代替 |
| F26 镜像/部署/比赛验收 / 5 | zemeng 29/32 | 4/0 | 平台观察端口、固定版本镜像/历史发布证据 | N02 arm64 build/N03runtime readback/N04real_tool_evidence/N05publish_coverage均缺graph adapters；发布/部署另需授权，目录不是验收 |
| F27 上下文预算/压缩/恢复 / 7 | zemeng 04B；models/knowledge goo122 | 4/3 | 已有context compile/budget/projection与knowledge.search | N01 model capabilities/N05memory/N04source-map check/N07invalidate与guards缺；token预算展示不等于F27图执行 |
| F28 多厂商/思考深度/任务分配 / 12 | zemeng 04B/30/31；ModelGateway goo122 | 4/3 | 原模型目录、native effort、child/subagent执行 | N03native config/N10source-test check/N11completion/N12scoped-tool-loop及guards缺；N02也可能先请求guard，不能另起Agent loop充数 |

## 已有公开组合 API

- F15：`createRuntimeOwnedWorkflowImageAdapter()` → `{bindingId,advance,receiptSecret,close}`；`RuntimeApplicationOptions.codingRepair = {image,authorizeMetadata?,projectSource?}`。AgentArts factory已自动注入；workspace `bindApplication()` 已调用公开 `configureCodingRepairSourceExport(projectSource,authorizeMetadata)`，不重复宿主。
- F23：`RuntimeApplicationOptions.workflowShadowRelease = {sideEffect,requiredScopes,configurationPort,acceptance,verifyBranch,verifyComparable,verifyTestEvidence}`。configurationPort 必须是既有受信宿主的持久 `read/readOperation/compareAndSet`；Runtime通过`createRuntimeOwnedWorkflowTools()`生成N04写/N05读，不能重复注册、自动批准或伪造receipt。
- 统一Bridge：`createRuntimeOwnedWorkflowHost(application,{receiptSecret,parentTaskId,assertActive,...})` / `application.createOwnedWorkflowHost()`；持久原 operation intent/binding、原host child、真实授权/结果与HMAC receipt。`ControlStatus`、云端text或新Snapshot都不是未知写入的持久核实。
- 原虚拟worker扩展面：`CompetitionWorkerCapability`（目录）与 `CoordinationWorkerCapabilityPort`（accepts/dispatch/assertReceiptAllowed），现有 developerWorker/Skill 已消费。新图应复用当前user-work WorkerContext，不创建第二Runtime、Agent loop或任务库。

## Owner纵向任务与文件fence

1. **IW-F15（本轮已授权实施）**：same-user-work F15 capability，保留root直接dispatch兼容。独占 `apps/runtime/src/application/coding-repair-application.ts`、新 `coding-repair-worker-capability.ts`、新定向测试；`runtime-application.ts`仅必要composition/原nested审批读取/恢复，先与devtools已冻结增量对齐；`application.ts`仅必要export。绑定原proposal digest/config/deadline，复用已有graph runner/HostBridge，原approval和unknown不重放；不放宽递归。
2. **IW-CATALOG/F20（目录已接；通用消费契约待Root选定）**：28图只读设计/入口及注册缺项目录已接主文字和Live；F20无缺失host/guard，但通用图消费入口与该业务的可信输入契约尚未实施。仅Owner镜像消费/原Runtime capability新文件、对应定向测试和root composition；模型只能给受限workflowId/业务输入，不能给checkpoint/receipt/session/signer/availableTools。宿主注入原目录、固定部署/期限/身份，在同一WorkerContext持久消费frontier；缺其他图adapter返回结构化unavailable。先冻结contract，不能先写第二引擎，也不代接goo122的MOD-37业务。
3. **IW-F23（端口接收/配置工作包，暂不假实现）**：Root确认既有configurationPort/acceptance/receipt/test验证的真实提供者后，Owner仅完成公开options/availability/受限结果出口消费；配合goo122交付公共配置口，不接管其存储与事务实现。没有真实端口时提供缺项清单，不生成假CAS、假签名或全部图成功。

全28图接线应按上述矩阵逐owner交付，不能让本轮Owner代接111个host及41个guard。主对话与Live都沿原task.submit；某图专用IPC/CLI、目录存在或独立业务工具可调用均不能代替该图的当前用户入口证据。

## 已抽取的通用驱动与尚未实施的通用模型入口

`apps/runtime/src/application/owned-workflow-driver.ts` 从现有F15 runner抽取 frontier→原HostBridge→本地审批/执行/签名receipt→原image.advance 的推进循环。生产 `runRuntimeCodingRepairWorkflow()` 实际调用该驱动；原 `coding-repair:graph` 字段、初始 `coding-start-*`、`coding-*` 请求ID、HostTask关联和legacy root路径保留。F15 wrapper继续负责隔离会话初始化、metadata/精确源码出机、N05必要检查、N06主工作区CAS发布或隔离产物验证，驱动没有默认“云settled即成功”。

驱动只接收可信composition传入的workflowId、完整input、原catalog/HostBridge、投影及本地完成验证hook，不注册任何新模型工具。原WorkerContext、TaskRuntime、Policy、ToolGateway、Evidence和SQLite checkpoint不变；原host未知结果只读原operation，已持久化pendingSend阻止另发。追加的driver绑定检查workflow/task/session/deadline/image/input/catalog摘要，旧F15检查点不改版、不清库。

第二图验证使用现有真实F20模板/OwnedWorkflowEngine及原TaskRuntime worker，候选、输入、读取与命令工具显式Synthetic；这仅证明驱动可消费第二图及原ID暂停/恢复，不交付goo122的MOD-37业务、真实API文档变更或生产F20入口。`owned-workflow-driver.test.mjs` 6个用例覆盖全4节点/两次原审批/SQLite重启、未知写入不重放、原workflow/catalog不可替换、原pendingSend阻止再发、无本地证据的云settled拒绝及原worker取消传达原host；与原F15 7用例、原HostBridge 2用例合计15/15通过。隔离树依赖构建及最终Runtime构建通过，未扩大测试到全仓，未运行云、Laya、真实Windows或业务命令。

下述通用模型capability仍是未实施提案，不能与已被F15消费的通用驱动混为一项：

复用 `CoordinationWorkerCapabilityPort.accepts/dispatch/assertReceiptAllowed`，不扩建 `TaskRuntime` 或增加 Agent 调度循环。F15 专用capability不应改成28图全部可用；先新增一个受限 capability，首个 allowlist 只有F20（仍需goo122确认其API文档消费输入）。目录能列出28图设计项，但每项分开报告 `registered`、`configured`、`missingAdapterNames`、`realAcceptance`；目录读取不执行 readiness、申请scope、推进graph或返回凭据。

| 边界 | 最小约束 |
| --- | --- |
| 模型入口 | 一个图选择工具，初始JSON schema只允许 `workflowId:'F20'` 和宿主公布的有限 `inputRef`；`additionalProperties:false`。不接受模型传checkpoint、receipt、taskId、deadline、availableTools、签名材料或任意文件/命令 |
| 可信输入 | 原宿主将inputRef解析为F20所需schemaFile/codeFile及固定recipe/template/target版本，绑定原workspace/source权限；未有真实提供者时返回unavailable，不用模型构造替代 |
| 持久绑定 | 在当前user-work保存原proposal digest、原revision/deadline、固定deployment/image binding、输入摘要、原tool descriptor集合、graph checkpoint、原operation到HostTask映射；由原SQLite checkpoint承载 |
| 推进 | 原image adapter.advance产出有限frontier；宿主仅消费原ToolPort注册项并提交原HostBridge。沿原WorkerContext取消信号/期限推进，不产生第二Runtime或自由Agent loop |
| 审批/恢复 | 嵌套操作保留原runId、exact参数/digest、scope、approval revision、期限、原HostIntent；等待后复用当前worker。未知发送或未知写入停在waiting_reconciliation，不换operation/taskId重放 |
| 结果出口 | 仅在原graph已settled并有本地操作证据后导出受限metadata；源码/文档正文另走精确投影授权。F20候选文档不宣称已发布，模型自报synchronized不构成生产写回证明 |
| 其他图 | 缺111host/41guard中的实际需求或trusted配置时结构化unavailable；不得用空receipt、固定branch、Fake成功补全，也不接管goo122/Potatos498的业务提供者 |

这是下一工作包的模型入口契约建议；当前已有被F15实际消费的通用驱动，但未新增通用模型工具或F20生产业务入口，也没有F20当前用户入口验收。其他图的trusted input、host/guard及出机/本地完成验证必须由各owner按逐图矩阵提供；声明模板或具备驱动不代表这些端口存在。

## 本轮F15本地证据

`apps/runtime/test/coding-repair-worker-capability.test.mjs` 使用显式Synthetic frontier和coding工具，实际消费原TaskRuntime/Policy/ToolGateway/HostBridge。7个定向用例覆盖：主对话root→同user-work、start与两次HostTask审批、精确原HostIntent public读回（不依赖冗余application checkpoint）、legacy root直接dispatch保留原coder child、metadata/source授权拒绝、原proposal/deployment/deadline不可替换、foreign/missing HostIntent绑定与受损双向graph循环拒绝、未知原host write不重放。该文件最终7/7通过；此前与developer-workflows、user-task-delegation、subagent-conversation、owned-workflow-host-bridge、default-coordination-subagents及旧F15的组合回归共73项（66通过/7跳过/0失败），之后仅追加legacy兼容用例，无生产源变更。`npm run build --workspace=@personal-agent/runtime`通过。没有执行真实Windows、云模型、账户、Laya或文档发布。Windows专用旧F15用例在当前Linux环境明确SKIP，不能作为通过证据。

## 事实来源

`docs/MODULE_ASSIGNMENTS.md`（含2026-10-17前端交接与DEV分工）；`packages/agentarts/src/{owned-workflow-data,owned-workflow-templates,workflow-adapters,owned-workflows,owned-workflow-host-bridge,workflow-dataflow}.ts`；`apps/agentarts-runtime/src/{main,binding-dispatch,image-services}.mjs`；`apps/runtime/src/application/{agentarts,runtime-application,coding-repair-application,owned-workflow-driver,owned-workflow-application,owned-workflow-image-adapter,tool-catalog,developer-workflows,subagent-host}.ts`；Desktop `main.js/workspace-config-host.js/product-tools-composition.js/proactive-workflow-host.js`。历史V4/V5证据保持原日期与有限场景，不升格当前主对话或28图验收。
