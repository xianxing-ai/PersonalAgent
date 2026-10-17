export const SHARED_DETAILS:Record<string,string[]> = {
 USER:['可信原话、版本、否定/条件与scope保留；inferred_interest不授写权限。','清楚且已有授权直接执行；缺关键决定才主动询问。','final绑定当前问题/参数指纹/revision；partial/echo/旧录音不授权。'],
 EVENT:['四入口：connector / user_instruction / subtask_feedback / wake。','pending持久化→sink按batchId durable确认→cursor CAS；断线/撤权不是无变化。','保留source/version、原话、Goal/责任、撤回更正；未订阅不等于无关。','独立来源可并行，同来源防重入；注册不等于开始监视。'],
 DECISION:['本机Laya是当前实验候选，架构/模型选型未最终定型。','仅独立资格验证站点可直接决定；未合格/复杂未知/重要抑制升级AgentArts DeepSeek。','镜像无权重/Python/PyTorch；单实例宿主已有，长期Desktop驻留/休眠恢复待验。','六处真实裁决均升级DeepSeek；Laya约182–618ms未达150ms，未证明减少高级调用。','exactcase经验不是训练；原生Score/Noul/并发不能写成现有能力。'],
 MODELS:['DeepSeek经AA /inference/v1代理；底层MaaS如实记录，无客户端直连fallback。','角色/模型池按可信配置和实际能力选择，不预判厂商优劣；未支持参数明确拒绝。','思考开关/原生effort/步骤预算/验证强度分别记录，配置不等于真实效果。','一般新任务：能力/记忆/授权→通用模型临时图候选→代码校验→合格Laya或未合格教师→执行观察调整；任意动态任务闭环仍待验。'],
 POLICY:['原Runtime/Policy/ToolGateway核task、scope、参数digest、revision与deadline；签名不是授权。','外部来源、模型、Skill不授新权限；已有有效授权复用，缺项沿原审批。'],
 TOOL:['本机工具统一ToolGateway；同资源写/鼠标键盘串行。','unknown保留原operation核实，不换ID重放；取消受理不等于停止。','平台MCP真实SDK已实现，执行仍经原ToolGateway；缺ToolExecution/官方port明确unavailable。'],
 EVIDENCE:['TaskRuntime是状态、执行记录与终态事实来源。','Wukong20+Pelican第二轮21=41条工具Evidence，首轮partial保留。','完整链为本机同版镜像+本机Runtime/Laya+远端AA代理，不是云端全工具链。','协调锚点created、分支父succeeded分别说明；目录/模型自报不证明完成。'],
 VERIFY:['默认每图串行，分支/join是控制关系而非并发证据。','显式双方案等双方；普通任务可先交已验主结果，机会资源调度待验。','真实两套实验await main再await shadow；不证明主抢占/机会并行。','原期限/取消与未知写读回不变；最小修复算法暂停。'],
};
export const LATENCY_DESIGN=['Laya六次182–618ms，未达150ms；未合格站点均升级DeepSeek。','Wukong flow167.432s/外层183.618s/20条Evidence；Pelican第二轮81.611s/外层89.735s/21条，首轮partial保留。','两套主影子实际串行；网页/目录不证明28业务、机会并行、长期无人值守或减少模型调用。','云指定版本目录/关联日志已验；真实完整工具链表面是本机同版镜像+本机Runtime/Laya+远端AA代理。'];
export const FINAL_DESIGN_STATUS='2026-10-15 / abb70879：本机Laya实验；ARM64镜像28图185节点默认串行，DeepSeek经AA。架构未最终定型，最小修复算法暂停。';
export const MODEL_CATALOG=[
 {id:'laya-local',vendor:'本机Laya',name:'Laya multilingual · 实验',role:'合格站点有限候选选择；未合格升级DeepSeek',native:'模型/SDK在本机，不在镜像；领域资格未验'},
 {id:'deepseek-v4.1-flash',vendor:'AgentArts',name:'DeepSeek-V4.1-Flash',role:'当前已验教师/执行模型，经AA推理代理',native:'实际原生参数按可信Provider映射；各档效果独立验'},
 {id:'bailian-live',vendor:'百炼',name:'百炼实时语音',role:'Live端口及有限无mic握手',native:'物理听说/主任务组合未全验，SIS经AA不可用'},
 {id:'configurable-pool',vendor:'可信配置',name:'其他厂商/模型池',role:'保留配置，不固定角色优劣',native:'按实际能力与原生参数验证；不支持明确拒绝'},
];
export const MODEL_SOURCES=[{label:'当前设计 / PR356 / abb70879',url:'https://github.com/zemeng5208/PersonalAgent/pull/356'}];
