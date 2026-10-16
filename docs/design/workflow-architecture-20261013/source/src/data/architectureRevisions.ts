export interface ArchitectureArea {id:string;name:string;description:string;features:string[];shared:string[]}
export interface ArchitectureMechanism {id:string;name:string;summary:string;features:string[];shared:string[];steps:string[];exceptions:string[];status:string}

// 逻辑阅读分组，不新增进程、服务、任务库或生产接口。
export const ARCHITECTURE_AREAS:ArchitectureArea[] = [
 {id:'interaction',name:'交互与主动服务',description:'主对话、语音、责任入口与必要通知；明确授权直接执行，缺决定才补问。',features:['F01','F02','F06','F12'],shared:['USER']},
 {id:'runtime',name:'Runtime与责任图',description:'本地TaskRuntime保有状态、调度、控制revision与终态；图修订与外部效果分开。',features:['F03','F24'],shared:['POLICY','VERIFY']},
 {id:'cloud',name:'Competition AgentArts主链',description:'AgentArts负责Competition Agent/Workflow构建、全局编排、评估与部署；本地Runtime执行授权、ToolGateway和Evidence。',features:['F25','F26','F28'],shared:['DECISION','MODELS','AA_GATEWAY','AA_OBSERVE']},
 {id:'tools',name:'工具与业务执行',description:'公开连接器与开发工具统一消费现有Policy/ToolGateway；独立分支并行，同资源写入协调。',features:['F07','F08','F09','F10','F11','F13','F14','F15','F16','F17','F18','F19','F20','F21'],shared:['TOOL','EVENT']},
 {id:'knowledge',name:'知识、记忆与上下文',description:'复用本地Wiki、事实查询与KnowledgePort；平台原生知识提供者返回来源片段，原受信判断链参与排序/压缩/恢复。',features:['F04','F05','F27'],shared:['AA_KNOWLEDGE']},
 {id:'evaluation',name:'证据、影子与改进',description:'复用Evidence与本地评分；镜像按需影子，真实结果送平台评测集评估，报告沿原配置/版本发布路径消费。',features:['F22','F23'],shared:['EVIDENCE','AA_EVALUATE']},
];
export const ARCHITECTURE_MECHANISMS:ArchitectureMechanism[] = [
 {id:'responsibility',name:'责任来源与语音',summary:'决策模型承担范围内选择，可信用户授权与宿主保持实际权限。',features:['F01','F02','F04','F08'],shared:['USER','POLICY'],steps:['保存完整指令、版本及原文定位，保留否定、条件、动作对象和参数关系。','并行召回既有责任/事实；原受信判断链提出责任、计划与分派候选。','宿主核对来源身份、revision、适用范围与动作授权；事实rule_ref不自动授权动作。','含义明确且已授权时直接激活责任/执行；不对每条新责任强制首轮确认。','真正缺决定时主动语音补问，文字同步；两种回答绑定同一问题、操作和版本。','参数或来源改变使旧确认失效；已有授权仍覆盖新候选时无需额外补问。'],exceptions:['“别发给张总”含有“发给张总”；includes只能定位字符，不能证明逻辑等价。','模型推断不静默新增授权；沉默、回声、旧回答和中途转写不作同意。'],status:'责任编译、来源映射与完整语音接线为拟议；现有Policy/授权端口复用。'},
 {id:'retrieval',name:'检索与上下文',summary:'先召回再联合判断；真正缺证据才扩充，没有固定一跳或强制固定轮数。',features:['F03','F04','F05','F27','F28'],shared:['DECISION'],steps:['事件用时间、地点、人物、资源和来源版本召回；开放指令可能先理解查询再检索。','代码检查现有数据范围/有效版本，多路检索并行；未知属性保留。','同一主模型联合重排责任、记忆、模板、计划和模型/深度候选。','需要新信息时在既有授权范围扩充；相同检索无新增信息时停止重复。','实际模型容量与用户配置决定上下文；长日志按需摘要，保留原文区段映射。','核实时恢复原文；事实或任务版本变化使旧映射失效，反馈模型分派。'],exceptions:['DecisionReady / NeedContextExpansion是拟议内部概念，未发布新wire DTO。','不保证O(1)召回或发现所有隐含依赖；未知地点/时间不因低优先级静默排除。'],status:'复用MemoryQueryPort事实查询、KnowledgePort.search与模型端口；完整映射/宽松召回仍需接线。'},
 {id:'effects',name:'局部修订与补偿',summary:'修改计划保留已发生的现实；更正外部效果关联具体原操作因果链。',features:['F03','F07','F08','F15','F24'],shared:['TOOL','EVIDENCE','POLICY'],steps:['事件召回可能受影响节点和实际操作证据，主模型判断影响范围。','保留有效结果，只使过时计划失效；新revision不抹去已发送邮件。','宿主把候选绑定原operation/effect ID、读回状态、变更原因与补偿前提。','原写入结果未知先核实，不能盲重试或盲补偿。','确有更正需要时，现有Policy核对具体补偿范围；已有授权覆盖则自动执行。','缺授权/条件保留草稿并语音补问，独立分支继续；补偿后保存独立读回。'],exceptions:['REVISE与同一目标存在历史写入不等于补偿，模型自报operation_kind也不够。','初次授权不自动覆盖所有更正；同一对象的新正向动作不能误判成补偿。'],status:'效果/因果关联为拟议内部记录；复用既有稳定操作身份、Policy、读回与恢复。'},
 {id:'cancellation',name:'取消四种结果',summary:'先响应本地停止，再据实际执行状态描述结果；受理不是停止证明。',features:['F02','F12','F24'],shared:['TOOL','EVIDENCE'],steps:['直接停止更新控制revision并传播取消，不等云模型；口头停止仍依赖ASR。','当前操作未开始：阻止提交，保留任务此前已发生的效果。','已提交或在途：显示正在停止，等待真实宿主/工具结果。','外部结果未知：保留原操作身份并读回；单次读回缺失不证明未执行。','已确认发生：保留事实与证据，必要时转F03补偿，不假装回滚。','恢复复用已确认结果；迟到云返回留审计，不覆盖新控制revision。'],exceptions:['四种是操作结果说明，不能私设为公共task wire终态。','普通等待可静默徽章；重要副作用、截止冲击或真正需要决定时主动通知。'],status:'现有取消、状态、检查点可复用；完整阶段关联、读回与UI仍需生产接线。'},
 {id:'delegation',name:'AgentArts工作流编排与本地工具执行',summary:'Competition由AgentArts Agent/Workflow分派模型与工作范围；本地Runtime消费提案并执行授权工具。',features:['F01','F24','F27','F28'],shared:['DECISION','MODELS','POLICY','TOOL'],steps:['AgentArts Agent/Workflow接收Competition目标并编排任务、范围与角色。','AgentArts按已部署Provider能力选择执行模型及参数；本机Runtime不复制平台调度。','平台工作流按真实依赖运行；未实测的并行或调度能力不从图中推断。','执行者提出的工具请求经CloudAgentPort返回本地Runtime。','本地Policy核对任务和授权，ToolGateway执行；执行者不签发授权或判定本地终态。','本地Evidence与读回结果返回平台，TaskRuntime保留本地任务状态和终态。'],exceptions:['不采用Flash+Pro双全局决策层；执行者局部思考不构成另一套责任/权限系统。','接口接受参数不证明实际思考量；模型角色优劣用相同工作负载评测。'],status:'AgentArts工作流编排为目标路径；平台部署版本、模型能力和本地提案消费需逐项实测。'},
 {id:'shadow',name:'按需影子与改进',summary:'由AgentArts评估流程按配置与条件触发，不默认双跑。',features:['F13','F22','F23','F26'],shared:['DECISION','EVIDENCE'],steps:['固定实际触发依据、当时快照、来源版本与历史轨迹。','AgentArts按需调度评估或影子工作流；未验证的隔离和并行能力不作成功声明。','平台比较候选与真实结果；缺反事实工具返回就明确未知。','隔离实验不写主任务/主记忆、不用主授权，只覆盖实际支持的测试环境。','标完全可比、部分可比、缺证据或不可比，记录额外调用/资源与失败证据。','提示/图/配置候选、用户项目补丁、宿主升级分别走已有测试/版本/发布，留回滚点。'],exceptions:['无触发请求不默认双跑；不新增固定采样比例。','不承诺克隆真实邮箱/微信环境，不直接改MaaS远端权重；无实测就没有成绩。'],status:'AgentArts Evaluation与影子消费仍需真实作业、部署与结果读回。'},
 {id:'cloud',name:'云端与证据分工',summary:'AgentArts负责Competition Agent/Workflow构建、编排、评估和部署；本地Runtime管理授权工具与Evidence。',features:['F05','F21','F22','F25','F26','F28'],shared:['DECISION','TOOL','EVIDENCE','VERIFY','AA_GATEWAY','AA_KNOWLEDGE','AA_OBSERVE','AA_EVALUATE'],steps:['AgentArts项目内的Agent/Workflow负责Competition主链构建、编排、评估和部署；本地Runtime通过CloudAgentPort调用已部署版本。','AgentArts按真实Provider配置执行模型与工具分派；本地Runtime不另建执行循环或路由器。','本地Runtime核对任务绑定和Policy授权，经ToolGateway执行批准的工具提案并记录读回Evidence。','平台部署、日志/Trace和评估报告与本地TaskRuntime及工具Evidence按版本/任务ID关联。','未配置或未验证的平台能力明确失败；Competition调用不静默回退Local。','平台与本地各自结果需实际读回；图中逻辑关系不代表生产接线或验收完成。'],exceptions:['Runtime入站网关、MaaS直连和stdio MCP不等于已接平台推理/MCP工具网关。','AgentArts工作流归平台编排；本地Runtime保留授权执行和可信Evidence。','本地保存不等于数据不出机；Competition失败不静默转Local。'],status:'AgentArts构建/编排/评估/部署与本地提案消费均需逐项接线和验收。'},
];
export const DESIGN_GOALS = [
 {name:'可追溯责任与低打扰语音',mechanism:'明确责任直接执行，缺决定才语音补问。',metrics:'授权来源一致性、正常放行/错误放行、条件/否定识别、用户打扰与等待分布。'},
 {name:'感知真实效果的局部重规划',mechanism:'保留有效成果与已发生效果，修正动作关联具体原操作。',metrics:'子图准确性、召回漏检/误召回、复用量、补偿关联准确性、四阶段取消一致性。'},
 {name:'分级判断与按需影子',mechanism:'联合判断、范围内探索、按需隔离比较。',metrics:'调用轮数、首响/P50/P95、Token、排队/读回等待、影子开销、合法接受/注入拒绝率。'},
];
export const ACCEPTANCE_MATRIX = [
 ['F01/F02','明确授权、否定、附条件、来源过期、语音修改、旧回答','比对来源与实际权限；记录必要/多余补问'],
 ['F03/F05/F27','重叠时间、邻近地点、共享资源、未知属性、摘要失效','测召回漏检/误召回、原文恢复、调用轮数与Token'],
 ['F03/F08/F24','同对象新动作、原动作重试、已发更正、发送未知','核对原操作/效果/补偿因果链与读回；无重复写入'],
 ['F02/F24','提交前、在途、外部未知、已确认发生四阶段停止','受理与结果分开；迟到返回不覆盖新控制版本'],
 ['F28','并行研究/分析、依赖资料编码、工具探索、深度不支持','核对依赖、受派范围、实际参数与工具记录'],
 ['F22/F23/F26','无触发、有触发、缺反事实、隔离失败、回滚','主库/授权隔离、时序公平对照、独立读回；缺证据标未知'],
] as const;
export const GOLDEN_PATH = ['邮件事件匹配责任','分类与资料检索并行','执行者形成带依据草稿','仅必要时语音修改/确认','现有Policy核验后执行','外部读回并保留原效果','变更只修订关联子图','失败轨迹按需影子回放'];
