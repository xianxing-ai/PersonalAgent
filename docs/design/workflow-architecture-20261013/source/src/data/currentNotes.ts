// Viewer-only clarification. Keep the reviewed production catalog and its
// template identity unchanged; candidate status is not domain qualification.
export const FEATURE_NOTE_REVISIONS:Readonly<Record<string,string>> = {
 '本机Laya仍为实验候选、架构未最终定型；未合格站点/复杂未知升级经AgentArts代理的DeepSeek。':'本机Laya仍为实验候选、架构未最终定型；仅作为独立 Local Profile 的可选方案，具体接线、场景适用性和领域资格尚待验证。Competition Agent/Workflow 由 AgentArts 负责构建、编排、评估和部署；AgentArts 失败不得静默回退 Local Profile。未合格站点/复杂未知升级经 AgentArts 代理的 DeepSeek。',
};

export const SHARED_DETAILS:Record<string,string[]> = {
 USER:['可信原话、版本、否定/条件与scope保留；inferred_interest不授写权限。','清楚且已有授权直接执行；缺关键决定才主动询问。','final绑定当前问题/参数指纹/revision；partial/echo/旧录音不授权。'],
 EVENT:['四入口：connector / user_instruction / subtask_feedback / wake。','pending持久化→sink按batchId durable确认→cursor CAS；断线/撤权不是无变化。','保留source/version、原话、Goal/责任、撤回更正；未订阅不等于无关。','独立来源可并行，同来源防重入；注册不等于开始监视。'],
 DECISION:['Competition Agent/Workflow由AgentArts负责构建、编排、评估和部署；本地Runtime经CloudAgentPort调用已部署版本。','本机Laya仍为实验候选，仅作为独立Local Profile的可选方案；具体接线与场景适用性尚待验证，不代表已纳入Competition产品路径。AgentArts失败不得静默回退Local Profile。','已有真实案例的本机镜像/Laya/远端代理记录保留为历史证据，不等于Competition平台编排验收。','六处历史Laya裁决均升级DeepSeek；182–618ms未达150ms，不能证明Competition目标或减少高级调用。','exactcase经验不是训练；原生Score/Noul/并发不能写成现有能力。'],
 MODELS:['Competition Agent/Workflow由AgentArts编排；已部署版本经CloudAgentPort接入本地Runtime。','DeepSeek经AA /inference/v1代理的历史证据仅证明模型代理调用，不证明完整Agent/Workflow路径。','角色/模型池按可信配置和实际能力选择，不预判厂商优劣；未支持参数明确拒绝。','思考开关/原生effort/步骤预算/验证强度分别记录，配置不等于真实效果。','本机Laya仍为实验候选，仅作为独立Local Profile的可选方案；尚未确认纳入Competition产品路径，AgentArts失败不得静默回退Local Profile。'],
 POLICY:['原Runtime/Policy/ToolGateway核task、scope、参数digest、revision与deadline；签名不是授权。','外部来源、模型、Skill不授新权限。模型不解释旧同意是否覆盖这次发信、删除或发布。','侧边栏禁止项按动作种类拦住。'],
 CONSTRAINT:['每个对话一个小图标，数字是本对话禁止项条数。只有用户能增删改。','闲聊里的“以后别这样”不是禁止项。条目不自动进其他对话。','否定句、期限、禁止项整段保留，摘要不能改写或丢掉。'],
 EGRESS:['密钥、口令、令牌、私钥、验证码，以及姓名、电话、邮箱、证件、住址、精确位置、健康与金融标识，不得进入云端。','其他隐私先请求批准。没答复就是不批准。分类不确定时按其他隐私询问。模型不能改松类别。','联系邮箱地址和通知正文留在本地。'],
 CONFLICT:['云端与本地不一致时，先只读核实，再问人。核实做不到或结果仍未知，也问人，不挂起。','跳过指令必须来自用户，并指向这一次冲突的任务、动作和对象。没有这条指令就停。停不是完成。','无人监管且用户明确跳过时，继续其他已经安排的任务。沉默不是跳过。','本地停止或重规划时世代号加一。旧世代的云端提案直接丢掉，不执行。'],
 IRREVERSIBLE:['发信和发布前，用户确认正文、收件人和发布位置。','失败或结果未知：停，问人，不重试。无人监管时，有联系邮箱就只发固定通知，否则跳过这一次并继续其他已安排任务。','能进回收站或能留下可恢复 git 的删除，本轮只做到这一步。下一轮向用户展示并得到知晓后才彻底清除。放不进回收站的大型对象，本轮不删，请求里附只读用途。'],
 TOOL:['本机工具统一ToolGateway；同资源写/鼠标键盘串行。','unknown保留原operation核实，不换ID重放；取消受理不等于停止。','平台MCP真实SDK已实现，执行仍经原ToolGateway；缺ToolExecution/官方port明确unavailable。'],
 EVIDENCE:['TaskRuntime是状态、执行记录与终态事实来源。','Wukong20+Pelican第二轮21=41条工具Evidence，首轮partial保留。','历史完整链为本机同版镜像+本机Runtime/Laya+远端AA代理，不证明Competition由AgentArts构建/编排Workflow。','协调锚点created、分支父succeeded分别说明；目录/模型自报不证明完成。'],
 VERIFY:['默认每图串行，分支/join是控制关系而非并发证据。','显式双方案等双方；普通任务可先交已验主结果，机会资源调度待验。','真实两套实验await main再await shadow；不证明主抢占/机会并行。','原期限/取消与未知写读回边界不变；编码最小修复已有实现，真实云/设备验收按各版本Evidence分别确认。'],
};
export const LATENCY_DESIGN=['Laya六次182–618ms，未达150ms；未合格站点均升级DeepSeek。','Wukong flow167.432s/外层183.618s/20条Evidence；Pelican第二轮81.611s/外层89.735s/21条，首轮partial保留。','两套主影子实际串行；网页/目录不证明28业务、机会并行、长期无人值守或减少模型调用。','云指定版本目录/关联日志已验；真实完整工具链表面是本机同版镜像+本机Runtime/Laya+远端AA代理。'];
export const FINAL_DESIGN_STATUS='历史实测基线2026-10-15 / abb70879：本机Laya实验、ARM64镜像28图185节点、DeepSeek经AA；Competition目标边界由AgentArts承担Agent/Workflow构建与编排，本地Runtime负责授权执行。';
export const MODEL_CATALOG=[
 {id:'laya-local',vendor:'本机Laya',name:'Laya multilingual · 本机实验候选（Local）',role:'仅为独立Local Profile的可选实验候选；尚未确认纳入Competition产品路径，不替代AgentArts Workflow编排',native:'模型/SDK在本机，不在镜像；具体节点接线与场景适用性待验证'},
 {id:'deepseek-v4.1-flash',vendor:'AgentArts',name:'DeepSeek-V4.1-Flash',role:'当前已验教师/执行模型，经AA推理代理',native:'实际原生参数按可信Provider映射；各档效果独立验'},
 {id:'bailian-live',vendor:'百炼',name:'百炼实时语音',role:'Live端口及有限无mic握手',native:'物理听说/主任务组合未全验，SIS经AA不可用'},
 {id:'configurable-pool',vendor:'可信配置',name:'其他厂商/模型池',role:'保留配置，不固定角色优劣',native:'按实际能力与原生参数验证；不支持明确拒绝'},
];
export const MODEL_SOURCES=[{label:'当前设计 / PR356 / abb70879',url:'https://github.com/zemeng5208/PersonalAgent/pull/356'}];
