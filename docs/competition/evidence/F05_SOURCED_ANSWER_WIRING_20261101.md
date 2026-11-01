# F05 原来源回答接线（2026-11-01）

Competition Profile；基线 `c6577b91`，含通用最终回执读取修复 `22fcb126` 及共享发送前 guard `9be0666a`（本树 cherry-pick 为 `b127323c`）。本包交付生产工厂与本地实际调用链；真实 AgentArts 和独立审核仍未验收。

复用现有 configured worker、原 IMAGE28 Engine、Runtime/ToolGateway/Policy、`decision.choose_candidate`、Knowledge source lease 和固定公开 Memory namespace。N02 保存原多路召回与独立知识查询 task/run；N03 判断、N04 答案候选及 N05 支持复核分别核对原选择回执及 predecessor。N05 再用原 `readCitation` 检查同一来源版本与逐字引文；N07 发布本次原答案/引用映射，completion 再核对原回执。不存在第二套 Memory、任务库、模型入口或授权层。

首个纵向范围只接受本机已配置的公开查询与公开 Fact 过滤。Fact 摘要明确是版本化摘要，不能冒充原文；支持性回答的引用只能来自本次原 Knowledge 检索回执中的原文片段。未读回原文、引用不足、模型保留未知或来源后来变化，均不得宣称支持已验证。源已撤销、私人来源、无当前 Fact reader、没有原 decision 工具时保持不可用；不偷偷使用 Fake。

F05 答案候选使用新增版本化严格 Schema；它只描述答案、各项陈述、引用 ID/逐字片段及未解决项。路径、来源配置、Fact namespace、实际版本、查询子任务和原许可仍由宿主确定。扩充仅允许原配置公开查询，原查询没有新增信息时不换 ID 再做相同调用。旧 F05 目录/可选 N02 工厂不提升为完整能力；新的生产工厂必须交付 tools、configuredWorkflowWorkerPorts 和实际 Desktop 来源适配。Main/公开出口由集成树串行处理。

验收目标：真实 Engine+Runtime+Policy 的原链、独立工具审批、原引用/Fact 版本变更、伪造来源/候选/参数/选中回执拒绝；未知/取消/期限不完成；重新读回零重发原操作；受控实际文件与 SQLite；明确 Synthetic 模型/网络与真实 AgentArts/独立审核的边界。

## 实际交付与 Main 组合

`createF05WorkflowWorkerPorts` 返回 `workflow.memory.answer@1.0.0` configured worker 和六个原图适配工具：N02/N05/N06/N07 host、N04/N06 guard。输入只含 `{query,factId,limit}`；配置、原 session、来源、版本与候选 Schema 均由原宿主绑定。缺必需端口不注册；来源不公开、撤销或版本改变时不可用。

Desktop 的 `createDesktopF05WorkflowWorkerPorts` 必需参数为 `runtimeModule`、`getApplication`、`getKnowledgeSourceConfig`、`getPublicFactHost`、`authorizeExport`、`knowledgeToolExports`、`prepareCompetitionToolExport`。`getPublicFactHost()` 返回 `{memoryNamespace,facts}`，其中 `facts.publicMemory.listCurrent` 与 `facts.readCurrentPublicFact` 必须来自同一实际 CompetitionFactHost。其余两端口分别注入原 `knowledgeTools.competitionToolExports` 与 `prepareWorkflowToolExport`；无原出口不能用新图出机确认代替。Main 需将六个工具优先于通用旧 host、worker 加到原 configured ports；公开 Runtime 导出本工厂及 `F05WorkflowOptions`/`F05SourceConfiguration`。本分支不改共享 Main/application.ts 出口。

N02 和 N06 都通过原业务桥建立独立 `knowledge.search` 子任务。返回原结果后执行同一工具出口的 preflight、原 prepare、project、final accepts；图只拿投影结果。实际 Knowledge policy 将每项片段裁剪至 200 字、最多 5 项。原 raw 结果保留在本机 TaskRuntime，不进入图/模型；最终许可之后继续核对同一原子任务、配置、policy 版本与 final accepts。Fact 只是版本化摘要，不能替代原引用。

新增 host-only `ReadOnlyPageVaultPort.assertCitationCurrent({source,deadline,signal}):void`，保持原固定根、普通文件、非链接、512 KiB、原 revision 哈希、UTF-8 与取消/期限边界，不返回正文。F05 的同步 `assertCurrent` 从原公开绑定和真实已确认操作重读 Fact 当前头及引用；共享 AgentArts image 在凭据 await 后、WSS beforeSend 再调用它。无同步来源提供者拒绝。原投影与最后操作引用使用现有 Runtime checkpoint，重启不能重置原调用身份。

## 兼容与状态边界

新增 `@personal-agent/contracts/f05-answer` 严格 version 1 Schema，通过现有 generator 生成类型/schema。类型生成关闭数组长度枚举以避免无意义的类型展开，运行时 Schema 的上下界保持有效。没有新依赖、任务库或数据库迁移。

F05_N04 的规范化执行依赖增加可选 N06，N04/N06 为受信 hostGuard；N06 的能力映射为原知识查询投影 host。节点总数仍为 185，Engine 循环不变。每图最多一次明确配置且不同于原查询的补充检索；需要补充但无合法新查询时拒绝，不能跳过新证据直接回答。该变更改变 F05 template digest，旧部署/检查点不得冒充当前模板；原历史记录保留。

N05 的支持性判断仍是原模型的 advisory 输出；宿主只证明引用来自本次原检索、逐字片段吻合且版本当前。结果使用 `source_versions_checked_model_support_advisory`，不宣称独立语义验证。原 N03 unknown 不允许后来候选升级为 supported。来源不足时输出明确 unknown 和未解决项。

真实撤销反例中，原知识 child 可已成功、N02 host 明确失败，而外层图因原配置/描述符失效保留 `waiting_approval`。此状态没有活动执行、没有 N02 原文出机、没有最终成功；不能标为 failed 或已完成，也不自动重做原查询。未知查询另测 SQLite 重开后仍 `waiting_reconciliation`、原搜索计数不增加。

## 本地验证与未验证项

已执行根 build、后续 AgentArts/Runtime 目标 build，contracts generator `--check`、AgentArts `check:workflows`、架构门禁 3/3。AgentArts 全包 246/246。通用当前回执/原 image/共享生产 composition、知识真实文件与 Schema 等定向消费者通过；最终 F05 Runtime + Desktop 链 14/14、0 skip（`.cache-pr531-f05-final-chain.log`）。

F05 验证使用实际 Engine、Runtime、SQLite、Policy、ToolGateway、Knowledge 文件宿主和真实 `createTrustedKnowledgeTools` 出口，模型候选/选择、原生确认及网络为显式 Synthetic。覆盖无补充/补充后新引用、不可用或重复查询、伪造引用、Fact/文件变更、配置撤销与取消、未知不重发、长原片段仅投影 200 字、确认前及异步 projection 后转私有、真实编译后 Competition 组合在凭据读取后文件变化时 HTTP 计数为零。未向外部服务发送真实数据。

仍需 Main 整合与最终 `npm run check`、本机实际原生授权/展示 smoke、固定 AgentArts deployment/template 读回、真实模型来源支持审查与平台整图 trace/评估、独立非作者审核。此包不满足 #531 的真实验收合并门槛，保持未合并。
