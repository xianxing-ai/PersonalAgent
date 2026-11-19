// Search the existing settings routes using the words people use for their capabilities.
const aliases = {
  models: 'API AgentArts 运行时 网关 密钥 模型 观测 AK SK 思考',
  capabilities: 'MCP Skills 技能 插件 能力 28图 工作流 目录 workflow catalog',
  dashboard: '看板 趋势 汇总 周期 花销 邮件 时间',
  connections: '连接器 邮件 日历 订阅 待办',
  authorizations: '授权 审批 安全 权限',
  tasks: '进度 执行 Evidence 证据 任务',
  activity: '活动 时间线 撤销 为什么 它替我做了什么',
  worktrees: '工作树 分支 工作文件夹',
  workspace: '工作文件夹 工作区 环境',
  usage: '用量 计费 预算 额度 上限 费用 降级 暂停',
  memory: '知识 笔记 记忆',
  voice: '麦克风 语音 实时语音 听写 唤醒',
  notifications: '通知 提醒 安静时段 汇总 风险 自主',
  appearance: '外观 主题 深色 浅色 动效 玻璃',
  pets: '桌面宠物 悬浮球 形态 ORB 粒子 伙伴 状态预览',
  computer: '电脑 操控 浏览器 视觉 观察 主动 持续工作流',
  profile: '个人资料 头像 身份 偏好 个性化',
  briefing: '简报 日报 日程 审批 早上',
  shortcuts: '热键 快捷键',
};

export function matchesSettingSearch(page, label, query) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = `${label} ${page} ${aliases[page] ?? ''}`.toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
