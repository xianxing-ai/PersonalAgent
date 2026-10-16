// 查看器设计数据，不发请求、不创建云资源、不注册生产能力。
export interface PlatformIntegration {
 id:string;nodeId:string;name:string;subtitle:string;features:string[];shared:string[];
 existing:string[];increment:string[];steps:string[];reuse:string[];proof:string;status:string;
 code:string[];sources:{label:string;url:string}[];
}
export const PLATFORM_BASELINE = '2026-10-16 核对：查看器数据与 origin/main eb92311f 同步；生产代码、历史真实记录与本轮拟议接入分别标注。';
export const PLATFORM_SCOPE = 'Competition Profile由AgentArts实际构建Agent/Workflow、编排流程、执行评估并部署；本地Runtime经CloudAgentPort消费平台结果，再由TaskRuntime/Policy/ToolGateway执行获准工具并保留Evidence。Local Laya不属于本比赛路径；AgentArts故障不静默回退。图数量不等于业务验收。';
export const RESOURCE_ROUTES = [
 {name:'知识库：本地与云端并存',sources:['本地Wiki/Obsidian/自建资料库','AgentArts原生知识库','配置的其他云端知识服务'],route:'同一检索工作流选择或并行查询提供者 → 按来源/版本合并片段 → 原受信判断链重排 → 上下文与引用。',existing:'本地KnowledgePort、Wiki和引用已有；平台/其他云提供者、多来源汇合和云引用适配待接线。'},
 {name:'MCP：平台、自有与社区',sources:['AgentArts平台MCP网关','自有本地stdio服务','自有或第三方远程HTTPS/MCP服务','GitHub/Gitee/其他人项目部署出的服务'],route:'选择服务来源 → 现有宿主发现目录 → 映射RegisteredTool → 原ToolGateway调用 → 实际结果与Evidence。平台来源由远程MCP客户端直连平台网关。',existing:'固定本地stdio子集已有；远程传输、平台直连、通用来源配置与目录适配待接线。仓库地址是代码来源，实际连接目标是服务端点或本地进程。'},
 {name:'Skill：平台、自制与第三方',sources:['平台提供或分享的Skill资产','自己的本地Skill包','GitHub/Gitee/社区第三方Skill及资源'],route:'取得Skill包/说明及版本 → 复用安装目录册与既有worker → 按需加载说明/资源 → 经原工具入口执行 → 记录版本与结果。',existing:'本机Skill安装/启停/版本快照和云选择端口已有；网络获取、平台资产适配、通用资源/脚本执行与真实云闭环待接线。当前发送SKILL.md不等于完整执行脚本。'},
];
export const PLATFORM_INTEGRATIONS:PlatformIntegration[] = [
 {
  id:'gateway',nodeId:'AA_GATEWAY',name:'模型与MCP网关',subtitle:'推理Target · MCP客户端直连 · 待接线',features:['F21','F25','F26','F28'],shared:['DECISION','MODELS','POLICY','TOOL'],
  existing:['ModelGateway、OpenAI兼容Provider与镜像模型配置已有；已有受限场景的MaaS真实调用记录。','ToolGateway已有注册、目录、参数与Policy入口；MCP宿主已有固定本地stdio读取实现。','AgentArts Runtime的入站网关/WSS已用过；它与本次推理/MCP工具网关是不同入口。'],
  increment:['配置AgentArts Inference Target的地址、认证与实际模型参数兼容，复用现有Provider。','在现有MCP宿主补远程HTTPS/SSE传输、协议协商、tools/list与tools/call结果适配，直连平台MCP网关。','按平台支持的工具目录映射现有RegisteredTool；沿用宿主凭据、deadline、取消和既有授权。'],
steps:['AgentArts项目内的Agent/Workflow负责比赛主链的构建、编排和模型分派；本地Runtime通过CloudAgentPort调用，不复制执行循环。','AgentArts按实际配置运行受支持的执行模型并返回结构化提案；Local Laya不参与Competition决策。','本地TaskRuntime/Policy核对任务绑定和授权，再由ToolGateway执行已批准的工具操作。','平台工具按已验证的AgentArts接口调用；能力或协议未验证时明确失败。','本地Runtime记录真实工具结果与Evidence并返回AgentArts工作流；任务终态仍由TaskRuntime管理。','AgentArts故障、断线或写入结果未知时保留原状态并先核实，不静默转Local或盲目重发。'],
  reuse:['保留一个ModelGateway与一个ToolGateway，不新增模型路由器或授权器。','本地stdio MCP与平台远程MCP共用现有宿主职责；新增的是传输与平台目录适配。','模型选择仍归原受信判断链，平台网关负责连接和转发。'],
  proof:'平台Target配置与版本、实际模型/工具请求、tools/list与tools/call响应、原Policy/执行读回记录；Runtime入站WSS不能替代MCP工具网关调用证据。',
  status:'底座已有；平台推理Target、远程MCP客户端与目录映射尚未在所查生产代码中实现或验收。',
  code:['packages/models/src/index.ts:152','packages/models/src/openai-compatible.ts:28','packages/tool-gateway/src/index.ts:40','packages/mcp/src/index.ts:57','apps/agentarts-runtime/src/main.mjs:13'],
  sources:[{label:'网关Target：MCP与Inference',url:'https://support.huaweicloud.com/highcode-agentarts/agentarts_10_242.html'},{label:'网关协议与SSE响应限制',url:'https://support.huaweicloud.com/highcode-agentarts/agentarts_10_024.html'}],
 },
 {
  id:'knowledge',nodeId:'AA_KNOWLEDGE',name:'原生知识检索',subtitle:'KnowledgePort云端提供者 · 待接线',features:['F04','F05','F10','F27'],shared:['DECISION','TOOL'],
  existing:['KnowledgePort.search、文件Vault/Obsidian/Wiki、来源与正文版本、受控检索工具已有。','现有文件提供者是本地正文/行索引检索；不能把它标成已经接入平台知识库或云端向量检索。'],
  increment:['为现有KnowledgePort增加AgentArts原生知识库提供者，配置区域、知识库ID与宿主认证。','用公开项目资料建立平台检索资源，映射平台文档/片段引用到现有来源与版本；原文事实继续使用既有来源。','知识检索工具可作为平台MCP网关的Target；需核实该区域的检索API、Target认证与返回字段，统一复用工具入口。'],
  steps:['同一检索工作流按来源选择本地Wiki或平台公开知识库，私人资料沿用既有数据许可。','镜像形成查询，检索工具经原ToolGateway进入KnowledgePort提供者。','需要平台来源时调用AgentArts原生检索API；通过MCP Target接入的路径复用上面的直连客户端。','平台返回原文片段、文档/片段引用等实际支持字段，提供者校验并映射现有来源。','原受信判断链联合重排平台片段与本地事实，F27形成带来源的上下文包。','来源改变时按现有版本/核实机制失效或补查，不能把云摘要直接当作新的已确认事实。'],
  reuse:['继续使用KnowledgePort、知识工具、Wiki与事实投影，不重写本地检索和引用系统。','平台知识库是公开资料的检索提供者；不建立第二套任务事实来源。','MCP客户端和知识提供者分工清楚，共用宿主认证与原工具执行入口。'],
  proof:'实际上传/索引版本、检索请求与原文片段、可核实的引用、答案引用和缺证据案例；只有文件查询或空知识库配置不算原生检索验收。',
  status:'本地知识与公开端口已有；AgentArts原生检索API提供者及与镜像的真实消费尚未找到完成证据。',
  code:['packages/knowledge/src/index.ts:26','packages/knowledge/src/filesystem.ts:105','packages/knowledge/src/text-index.ts:8','apps/runtime/src/application/knowledge-tools.ts'],
  sources:[{label:'平台知识库检索API（区域版本须核对）',url:'https://support.huaweicloud.com/api-agentarts0/OpenBatchRetrieveKnowledgeBase.html'}],
 },
 {
  id:'observability',nodeId:'AA_OBSERVE',name:'平台日志与Trace',subtitle:'JSON日志→LTS · OTel→观测 · 待接线',features:['F13','F22','F24','F26','F28'],shared:['MODELS','TOOL','EVIDENCE'],
  existing:['镜像已向标准输出写结构化角色回执，包含started/completed/failed与可选Token用量。','TaskRuntime事件、工具执行记录与Evidence已有；手动ShowOpsTrace只读读取器也已有。','读取平台Trace的验收脚本与生产OTel上报器职责不同；所查生产代码尚无OTel/OTLP导出。'],
  increment:['先配置并验证Runtime日志采集，让现有JSON标准输出在平台/LTS可查询；必要时再补LTS日志上报。','在现有模型、工具、检索与恢复入口采集Span，通过OTel接入AgentArts观测，复用现有会话/请求/操作关联。','把部署版本、角色、模型、耗时、Token、结果状态和经许可的来源引用关联到同一任务；日志与Trace异步上报。'],
  steps:['复用原会话、请求、任务与操作身份，关联镜像部署版本，不另建任务库。','镜像角色回执继续输出JSON日志，Runtime/LTS记录启动、调用与失败信息。','按真实分工建立Root/Model/Tool/Knowledge/Recovery Span；独立分支保留并行关系。','对实际状态、耗时和用量异步上报；输入输出按已有数据许可处理，凭据不进入日志。','平台按同一请求查询日志、调用链、错误节点与模型用量，现有只读Trace读取器用于核对。','平台Trace关联本地Evidence引用；实际执行和终态仍由原Runtime判定，观测上报失败不改写已发生的工具结果。'],
  reuse:['已有日志和事件增加平台输出适配，不维护第二套日志数据库或Evidence仓库。','保留ShowOpsTrace读取器，新增的是生产Span采集和上报。','Trace展示运行过程，Evidence保留可信执行事实，两者通过身份关联。'],
  proof:'平台/LTS可查询的真实日志、同一任务的调用链、独立逻辑分支（当前串行推进）、失败/恢复节点、真实用量与本地结果关联；仅stdout文件或手工构造Span不算平台上报验收。',
  status:'角色日志、事件与Trace读取基础已有；平台日志可见性、生产OTel采集/导出及完整关联仍需接线与实测。',
  code:['packages/agentarts/src/index.ts:19','apps/agentarts-runtime/src/main.mjs:31','apps/runtime/src/application/coordination.ts','tests/manual/agentarts/support/read-platform-trace.mjs:90'],
  sources:[{label:'Trace、Metric与Log官方接入',url:'https://support.huaweicloud.com/ops-agentarts/agentarts_14_0123.html'}],
 },
 {
  id:'evaluation',nodeId:'AA_EVALUATE',name:'平台效果评估',subtitle:'真实结果→评测集→报告 · 待接线',features:['F22','F23','F26'],shared:['EVIDENCE','VERIFY'],
  existing:['固定用例、本地协议/修复范围评分、配对运行与可信读回脚本已有，继续作硬验收。','2026-09-30曾创建并发布4条协议用例的平台评测集0.0.1；记录中的output为空，评估器/任务未执行。','该历史资源可在版本、字段和账号读回一致后复用，不能算平台评分或新版工作流效果。'],
  increment:['复用现有用例与实际运行回执，导出input、实际output、reference_output、必要context及镜像版本。','补平台评测集字段映射、评估任务提交和结果读取；第一版采用真实结果的离线评测集评估。','沿用现有改进/影子触发，把平台报告用于候选比较；评估所用国内模型配置需实际确认，不新增在线全局决策模型。'],
  steps:['镜像按真实工作流运行；保留输入、真实回答、检索原文、工具状态和部署版本，不用参考答案冒充实际输出。','现有本地评分先核对协议、影响范围、读回与并发等硬判据，既有Evidence继续提供事实。','将适合评估且允许上传的结果映射到平台评测集，选择实际支持的评估器与字段。','AgentArts执行评估任务，保存真实taskId、评测集/评估器版本、得分、理由及报告。','候选提示/图/配置变化后，镜像按同条件重跑并比较；影子仍在镜像后台按需执行。','同一决策配置依据可比证据提出版本采用建议，沿原配置/测试/发布路径处理；平台分数不成为授权或任务成功证据。'],
  reuse:['不新建评分器、用例库、影子调度器或结果真值库；补结果导出与平台任务适配。','已有平台评测集先读回再复用，真实结果与合成用例分开标注。','评估后台按需运行，不把评分串进每次主对话。'],
  proof:'真实结果字段与原回执一致、平台任务实际完成、评分/报告及版本对照、本地硬判据；评测集已发布不等于评估已完成。',
  status:'本地评分与历史平台评测集已有；平台评估任务调用、完整报告和新版配对效果仍待真实验收。',
  code:['tests/manual/agentarts/evaluation/score-runs.mjs:136','tests/manual/agentarts/support/fixed-synthetic-repair-score.mjs','tests/manual/agentarts/evaluation/MVP-PLATFORM-EVALUATION-20260930.md:130'],
  sources:[{label:'真实结果的评测集评估',url:'https://support.huaweicloud.com/ops-agentarts/agentarts_14_0086.html'}],
 },
];
export const PLATFORM_NODES = PLATFORM_INTEGRATIONS.map(item=>({id:item.nodeId,label:item.name,subtitle:item.subtitle,kind:'platform'}));
export const PLATFORM_GOLDEN_PATH = ['在AgentArts创建或更新Competition Agent/Workflow并绑定版本','由AgentArts构建流程并核对构建回执','由AgentArts执行工作流评估并读回真实报告','由AgentArts部署指定版本并核对deployment状态','本地Runtime经CloudAgentPort调用已部署工作流，不静默回退Local','本地Policy/ToolGateway执行获准操作并记录实际Evidence','分别核对AgentArts部署/trace与本地任务终态和工具读回'];
export const PLATFORM_BOUNDARIES = ['这是当前架构实验（未定型）与实现核对，不是平台能力已上线的声明；不提升公共接口冻结或真实验证等级。','Competition Profile由AgentArts构建、编排、评估与部署；本地Runtime负责授权、ToolGateway、Evidence和TaskRuntime终态。','本机Laya仅属于既有可选Local路径，不进入本Competition图，也不新增或扩展Local能力。','区域、账号权限、平台API/日志/评估与部署状态仍需真实读回；Competition失败不得静默回退Local。'];
