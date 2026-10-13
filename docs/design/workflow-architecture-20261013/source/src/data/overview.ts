import { ALL_FEATURES } from './architectureFeatures';

export const OVERVIEW_COLUMNS = [
  { title: '主对话 · 目标 · 记忆', ids: ['F01', 'F03', 'F28', 'F24', 'F02', 'F04', 'F05', 'F27'] },
  { title: '个人助理与信息', ids: ['F08', 'F09', 'F10', 'F11', 'F07', 'F06', 'F12'] },
  { title: '开发与工程', ids: ['F19', 'F17', 'F15', 'F16', 'F18', 'F20', 'F14', 'F13'] },
  { title: '平台 · 影子 · 改进', ids: ['F25', 'F21', 'F26', 'F22', 'F23'] },
];

export type RelationKind = 'flow' | 'decision' | 'evidence' | 'shadow';
export const OVERVIEW_LINKS: [string, string, string, RelationKind][] = [
  ['USER', 'F01', '文字 / 语音目标', 'flow'],
  ['EVENT', 'F03', '外部事件', 'flow'],
  ['F01', 'F03', '建立目标与责任', 'flow'],
  ['F03', 'F28', '拆分可执行子任务', 'flow'],
  ['F28', 'MODELS', '选择模型与原生思考参数', 'flow'],
  ['MODELS', 'F24', '候选输出，按依赖并行', 'flow'],
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
  ['F24', 'F22', '全功能轨迹只读进入影子', 'shadow'],
  ['EVIDENCE', 'F22', '当时的输入与工具结果', 'shadow'],
  ['F22', 'F23', '有标签的失败样本与改进候选', 'shadow'],
  ['F23', 'F22', '候选版本隔离评估', 'shadow'],
  ['F23', 'DECISION', '提示、调用配置或可用模型版本更新 / 回滚；不是改远端权重', 'shadow'],
  ['DECISION', 'F24', '返回结构化建议；校验节点、快照与revision后采用', 'decision'],
  ['DECISION', 'VERIFY', '语义判断不是完成证据', 'decision'],
  ['F28', 'F27', '模型上下文能力与数据许可反馈', 'flow'],
  ['F22', 'F03', '经验证的流程修改候选', 'shadow'],
];

const dispatch = ['F04','F05','F06','F07','F08','F09','F10','F11','F13','F14','F15','F16','F17','F18','F19','F20','F21','F25','F26','F27'];
dispatch.forEach(id => OVERVIEW_LINKS.push(['F24', id, '按任务选路；独立分支并行', 'flow']));
ALL_FEATURES.forEach(f => OVERVIEW_LINKS.push([f.id, 'DECISION', '语义问题与结构化建议', 'decision']));

export const INTERFACE_NOTES: Record<string, string> = {
  F01: '复用 task.submit / TaskRuntime；责任图与自然语言责任编译为待接线设计。',
  F02: '复用 authorization.respond；语音问题绑定与安全摘要仍需适配，演示不证明真实 ASR 确认。',
  F04: '复用 MemoryQueryPort 的事实版本与 KnowledgePort；Wiki 写入与纠错消费需按公开端口接线。',
  F05: '现有 MemoryQueryPort 为事实查询；KnowledgePort 提供 search。向量检索不能当成现有 MemoryQuery 能力。',
  F22: '轨迹与测试夹具可复用；影子是独立命名空间，不等于物理沙箱已经部署。',
  F23: '默认决策模型更换为 DeepSeek-V4.1-Flash；MaaS API 配置不能改远端模型权重，权重训练是独立拟议作业。',
  F24: '复用现有 TaskRuntime、状态、事件、取消和检查点；图节点恢复与副作用记录需继续接线。',
  F26: '复用 AgentArts 自有镜像与 CloudAgentPort；此网页不证明部署、调用或比赛验收已完成。',
  F27: '复用已有记忆、知识和模型端口；上下文分块、摘要引用映射与恢复为拟议编排。',
  F28: '现有 subagentModels 工厂有模型配置入口；Competition 多模型分派与原生参数仍需适配。',
};

export const SHARED_NODES = [
  {id:'USER',label:'用户输入',subtitle:'文字 · 语音 · 持续责任',kind:'flow'},
  {id:'EVENT',label:'外部事件',subtitle:'邮件 · 日程 · 订阅 · CI',kind:'flow'},
  {id:'DECISION',label:'唯一语义决策模型',subtitle:'DeepSeek-V4.1-Flash · 华为云 MaaS',kind:'decision'},
  {id:'MODELS',label:'执行模型池',subtitle:'DeepSeek · GLM · Qwen · openPangu',kind:'flow'},
  {id:'POLICY',label:'现有授权与参数检查',subtitle:'沿用 Runtime / Policy；不新增限制',kind:'flow'},
  {id:'TOOL',label:'ToolGateway',subtitle:'工具执行 · 资源锁 · 幂等',kind:'flow'},
  {id:'EVIDENCE',label:'执行证据与外部读回',subtitle:'未知结果先核实',kind:'evidence'},
  {id:'VERIFY',label:'验证与必需分支汇合',subtitle:'完成条件 · 失败修复 · 部分结果',kind:'evidence'},
];
