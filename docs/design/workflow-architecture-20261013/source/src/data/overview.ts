import { ALL_FEATURES } from './architectureFeatures';
import { PLATFORM_NODES } from './currentPlatform';
import currentDesign from './currentDesign.generated.json';

export const OVERVIEW_COLUMNS = [
  { title: '主对话 · 目标 · 记忆', ids: ['F01', 'F03', 'F28', 'F24', 'F02', 'F04', 'F05', 'F27'] },
  { title: '个人助理与信息', ids: ['F08', 'F09', 'F10', 'F11', 'F07', 'F06', 'F12'] },
  { title: '开发与工程', ids: ['F19', 'F17', 'F15', 'F16', 'F18', 'F20', 'F14', 'F13'] },
  { title: '平台 · 影子 · 改进', ids: ['F25', 'F21', 'F26', 'F22', 'F23'] },
];

export type RelationKind = 'flow' | 'decision' | 'evidence' | 'shadow' | 'platform';
export const OVERVIEW_LINKS: [string, string, string, RelationKind][] = [
  ['USER', 'F01', '文字 / 语音目标', 'flow'],
  ['EVENT', 'F03', '外部事件', 'flow'],
  ['F01', 'F03', '建立目标与责任', 'flow'],
  ['F03', 'F28', '拆分可执行子任务', 'flow'],
  ['F28', 'MODELS', '选择模型与原生思考参数', 'flow'],
  ['MODELS', 'F24', '候选与局部观察，按真实依赖并行', 'flow'],
  ['MODELS', 'POLICY', '执行者在派定范围自主提工具请求', 'flow'],
  ['F03', 'F24', '局部重规划', 'flow'],
  ['F24', 'F03', '变化使关联节点失效', 'flow'],
  ['F04', 'F05', '有效事实与版本', 'flow'],
  ['F05', 'F27', '有来源的检索片段', 'flow'],
  ['F27', 'F28', '适合模型的上下文包', 'flow'],
  ['F08', 'F06', '回复后的跟进事项', 'flow'],
  ['F09', 'F10', '值得调查的信号', 'flow'],
  ['F10', 'F05', '历史与知识依据', 'flow'],
  ['F11', 'F07', '天气与出行影响日程', 'flow'],
  ['F07', 'F06', '修改日程使旧提醒失效', 'flow'],
  ['F06', 'F12', '到期提醒', 'flow'],
  ['F09', 'F12', '可行动的重要发现', 'flow'],
  ['F12', 'F02', '需要决定时主动语音询问', 'flow'],
  ['F19', 'F17', '可复现问题', 'flow'],
  ['F17', 'F15', '根因与修复范围', 'flow'],
  ['F15', 'F17', '行为验证', 'flow'],
  ['F15', 'F16', '提交检查', 'flow'],
  ['F16', 'F13', '环境故障', 'flow'],
  ['F16', 'F15', '代码缺陷的局部修复', 'flow'],
  ['F16', 'F18', '当前版本的检查结果', 'flow'],
  ['F15', 'F20', '公开接口有变化', 'flow'],
  ['F20', 'F18', '文档候选参与审查', 'flow'],
  ['F18', 'F19', '合并后核实问题', 'flow'],
  ['F25', 'F28', '可配置模型与数据许可', 'flow'],
  ['F25', 'F21', '账户配置引用', 'flow'],
  ['F21', 'TOOL', '已注册的公开工具能力', 'flow'],
  ['F26', 'F24', 'AgentArts 承载编排', 'flow'],
  ['F26', 'F13', '构建 / 部署 / 调用故障', 'flow'],
  ['F24', 'POLICY', '工具提案，不含授权', 'flow'],
  ['POLICY', 'TOOL', '现有授权通过后执行', 'flow'],
  ['POLICY', 'F02', '需要确认具体操作', 'flow'],
  ['F02', 'POLICY', '问题、版本与参数匹配的回答', 'flow'],
  ['F02', 'F24', '拒绝 / 修改 / 本地停止', 'flow'],
  ['TOOL', 'EVIDENCE', '实际执行记录与读回', 'evidence'],
  ['TOOL', 'F24', '未知写入先核实，不能重复', 'evidence'],
  ['EVIDENCE', 'VERIFY', '证据支持完成条件', 'evidence'],
  ['VERIFY', 'F24', '通过 / 补查 / 局部修复', 'evidence'],
  ['VERIFY', 'F12', '完成结果与未完成项', 'flow'],
  ['VERIFY', 'F04', '记忆候选，不自动改原始事实', 'flow'],
  ['F24', 'F22', '失败/变化/异常/调试或配置采样才触发', 'shadow'],
  ['EVIDENCE', 'F22', '当时的输入与工具结果', 'shadow'],
  ['F22', 'F23', '有标签的失败样本与改进候选', 'shadow'],
  ['F23', 'F22', '候选版本隔离评估', 'shadow'],
  ['F23', 'DECISION', '提示、调用配置或可用模型版本更新 / 回滚；不是改远端权重', 'shadow'],
  ['DECISION', 'F24', '返回结构化建议；校验节点、快照与revision后采用', 'decision'],
  ['DECISION', 'VERIFY', '语义判断不是完成证据', 'decision'],
  ['F28', 'F27', '模型上下文能力与数据许可反馈', 'flow'],
  ['F22', 'F03', '经验证的流程修改候选', 'shadow'],
  ['F01', 'F05', '已授权责任与事实先召回', 'flow'],
  ['F05', 'F01', '来源片段支持责任联合判断', 'evidence'],
  ['F03', 'F05', '时间/地点/人物/资源宽松召回', 'flow'],
  ['F27', 'F05', '按需扩充或恢复原文，不固定一跳', 'flow'],
  ['F04', 'F03', '事实/责任版本变更，局部失效', 'flow'],
  ['F08', 'F03', '线程变化关联原发送效果', 'flow'],
  ['F24', 'F03', '已发生效果的补偿候选', 'evidence'],
  ['EVIDENCE', 'F03', '具体原操作、读回与修正因果链', 'evidence'],
  ['F03', 'POLICY', '实际补偿授权；已覆盖则直接执行', 'flow'],
  ['F24', 'F12', '停止中/待核实徽章与必要通知', 'flow'],
  ['F26', 'AA_GATEWAY', 'AgentArts构建、编排、评估与部署Workflow', 'platform'],
  ['DECISION', 'AA_GATEWAY', 'AgentArts Agent/Workflow负责Competition编排', 'platform'],
  ['MODELS', 'AA_GATEWAY', 'ModelGateway → Inference Target', 'platform'],
  ['TOOL', 'AA_GATEWAY', '既有授权后，MCP客户端直连平台网关', 'platform'],
  ['AA_GATEWAY', 'AA_KNOWLEDGE', '知识检索Target：鉴权/区域待验证', 'platform'],
  ['F05', 'AA_KNOWLEDGE', 'KnowledgePort平台提供者', 'platform'],
  ['AA_KNOWLEDGE', 'F27', '原文片段、来源与上下文', 'platform'],
  ['AA_GATEWAY', 'EVIDENCE', '实际工具结果进入现有执行记录', 'evidence'],
  ['F26', 'AA_OBSERVE', 'Runtime日志 / 部署版本', 'platform'],
  ['MODELS', 'AA_OBSERVE', '模型角色Span与用量，异步上报', 'platform'],
  ['TOOL', 'AA_OBSERVE', 'MCP/本地工具日志与Span', 'platform'],
  ['EVIDENCE', 'AA_OBSERVE', '任务/操作引用关联，不复制事实库', 'platform'],
  ['F22', 'AA_OBSERVE', '按需影子与恢复轨迹', 'platform'],
  ['AA_OBSERVE', 'AA_EVALUATE', '真实输入输出回流至评测集', 'platform'],
  ['F22', 'AA_EVALUATE', '可比较的隔离结果，后台按需评估', 'shadow'],
  ['F23', 'AA_EVALUATE', '复用本地用例与候选版本', 'shadow'],
  ['AA_EVALUATE', 'F23', '真实评分与版本对照，沿原发布流程', 'shadow'],
];

const dispatch = ['F04','F05','F06','F07','F08','F09','F10','F11','F13','F14','F15','F16','F17','F18','F19','F20','F21','F25','F26','F27'];
dispatch.forEach(id => OVERVIEW_LINKS.push(['F24', id, '按任务选路；独立分支并行', 'flow']));
ALL_FEATURES.forEach(f => OVERVIEW_LINKS.push([f.id, 'DECISION', '语义问题与结构化建议', 'decision']));

export const INTERFACE_NOTES: Record<string, string> = {
  F01: '复用 task.submit / TaskRuntime 与既有授权；责任来源映射、联合判断与按需扩充为拟议内部编排，不新增wire DTO。',
  F02: '复用 authorization.respond；语音问题绑定与安全摘要仍需适配，演示不证明真实 ASR 确认。',
  F03: '复用现有世界/目标/计划与TaskRuntime；四维宽松召回、原效果因果关联及补偿分类仍需接线，REVISE不等于撤销外部效果。',
  F04: '复用 MemoryQueryPort 的事实版本与 KnowledgePort；Wiki 写入与纠错消费需按公开端口接线。确认事实不自动授权动作。',
  F05: '现有MemoryQueryPort为事实查询，KnowledgePort提供本地search；新增平台知识库提供者和来源映射，不重写Wiki。当前尚无原生检索API接入证据。',
  F08: '复用邮件公开能力、既有Policy与ToolGateway；事件责任、条件语音与发送读回按真实连接器逐项验证。此页不连接真实邮箱。',
  F21: 'MCP与Skill支持平台、自有及GitHub/Gitee/第三方来源。固定stdio MCP、本机Skill安装/快照和云选择端口已有；远程传输、通用资源执行及平台资产适配待接线，不新建宿主或执行器。',
  F22: '按需消费已有轨迹与测试夹具；影子逻辑留在镜像。适合的真实结果送平台评测集评估，独立宿主/上报/报告仍待验收。',
  F23: '复用已有本地评分和配对用例，补平台真实结果导出与任务适配；历史平台评测集已发布不等于评分完成。MaaS配置不直接修改远端权重。',
  F24: '复用现有 TaskRuntime、状态、事件、取消和检查点；四种操作结果、效果关联与读回UI待接线，不新增公共task终态。',
  F26: 'Competition由AgentArts承担Agent/Workflow构建、编排、评估和部署；本地Runtime经CloudAgentPort调用部署版本并保留授权、Evidence与读回。已有自有镜像/Laya记录属于历史实测，不能证明平台编排已验收。',
  F27: '复用已有记忆、知识和模型端口；上下文分块、摘要引用映射与恢复为拟议编排。',
  F28: 'Competition Agent/Workflow由AgentArts编排；subagentModels和本机受限循环不替代平台职责。CloudAgentPort接线、原生参数与完整主控流程仍需实测。',
};

export const SHARED_NODES = [
  {id:'USER',label:'可信用户指令',subtitle:'原句 · 条件 · 版本 · 授权',kind:'flow'},
  {id:'EVENT',label:'外部事件与变化',subtitle:'邮件 · 日程 · 订阅 · CI',kind:'flow'},
  {id:'DECISION',label:'AgentArts Agent/Workflow',subtitle:'Competition主流程由平台构建与编排',kind:'decision'},
  {id:'MODELS',label:'ModelGateway → AA DeepSeek',subtitle:'实际参数 · 范围内工具探索',kind:'flow'},
  {id:'POLICY',label:'现有授权与参数检查',subtitle:'沿用 Runtime / Policy；不新增限制',kind:'flow'},
  {id:'TOOL',label:'ToolGateway',subtitle:'执行 · 稳定操作ID · 取消',kind:'flow'},
  {id:'EVIDENCE',label:'执行证据与外部读回',subtitle:'未知结果先核实',kind:'evidence'},
  {id:'VERIFY',label:'验证与必需分支汇合',subtitle:'完成条件 · 失败修复 · 部分结果',kind:'evidence'},
  ...PLATFORM_NODES,
];

// All feature status badges and detail adapters use the same committed matrix.
for(const feature of currentDesign.workflows)INTERFACE_NOTES[feature.id]=feature.status;
for(const link of OVERVIEW_LINKS){
 link[2]=link[2].replaceAll('独立分支并行','独立依赖分支；当前Engine串行').replaceAll('按真实依赖并行','按真实依赖；当前Engine串行').replaceAll('平台Target','平台端口（缺配置unavailable）');
}
OVERVIEW_LINKS.push(['USER','EVENT','user_instruction / 原话来源','flow'],['F24','EVENT','subtask_feedback / 原Scheduler wake','flow'],['EVENT','F12','durable批次 / 静默feed / 有效摘要','flow']);
