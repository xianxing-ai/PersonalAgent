# F10 原检索与独立审查接线

Competition 最小纵向链复用原 research.search 两个明确查询、已配置公开 knowledge query、原结果出口投影与 configured driver。N02/N03/N04 经原业务 child/Policy，不把 raw 知识结果送入图；模板摘要改变，旧部署不自动视为兼容。

OpenAlex 当前提供题名/作者/出处/日期等元数据，不提供论文正文；研究引用明确 metadata_only，revision 是原读取快照摘要，不冒充当前远端版本。知识引用继续本机原文件版本核验，只将原出口允许的摘录交审查。

N05 沿已有 supported-claims host，候选仅引用前三个分支的确认回执。独立辅助 guarded ModelGateway 使用其实际 provider/model，原生确认精确请求与目的地；它不是 AgentArts 主模型或事实权威。图仍由原 AgentArts 调度；N06 输出原引用/审查表，建议明确 model_advisory。未知模型请求不重发。无新任务库、模型库、授权层或依赖。

实际本机文件、Fixture、云与真人验收分开记录；此记录不宣称真实研究或整图验收完成。

2026-11-01：新隔离树完整基线 build、修改后的 AgentArts/Runtime build 通过；`node --test apps/desktop/test/f10-workflow-worker.test.mjs` 单条生产链检查 1/1 通过。实际 Engine/Runtime/Policy/SQLite、文件来源与原 200 字出口、OpenAlex 适配器和 guarded ModelGateway/HTTP adapter 被调用；研究 HTTP、图候选、审查回复、原生确认和凭据存储明确为 Fixture。三次原引用审查完成，知识尾部未进入云/模型结果；下一原图在读取凭据后撤销来源，新增模型 HTTP 为零。未重跑已过套件，最终集成 check 由根统一执行。

Main 已消费 `createConfiguredDesktopF10WorkflowPorts({runtimeModule,getApplication,getKnowledgeSourceConfig,modelApiHost,toolExports,prepareCompetitionToolExport,authorizeExport,confirmModelExport})`，注册实际 `tools/configuredWorkflowWorkerPorts`。`modelApiHost` 延迟绑定原 `snapshot/getGuardedModelGateway`；`confirmModelExport` 经原独立 `developer.export` 确认精确请求、目的地、任务和原期限，不能用广义允许代替。Main 语法检查通过。真实服务、部署与真人确认仍未验。
