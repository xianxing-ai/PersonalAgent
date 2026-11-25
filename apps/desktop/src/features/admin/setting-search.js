// Search the existing settings routes using the words people use for their capabilities.
const aliases = {
  profile: '个人 资料 头像 名字 用量 仪表盘 统计 热力图 token 费用 预算 花费 账单',
  settings: '常规 外观 主题 深色 浅色 动效 桌面宠物 ORB 开机 启动 退出 桌面偏好',
  models: 'API AgentArts 运行时 网关 密钥 模型 主模型 子模型',
  capabilities: 'MCP Skills 技能 插件 能力',
  dashboard: '看板 趋势 汇总 周期 花销 邮件 时间',
  connections: '连接器 邮件 日历 订阅 待办 提醒 简报',
  authorizations: '授权 审批 安全 权限 沙箱',
  tasks: '进度 执行 Evidence 证据 任务',
  activity: '活动 时间线 撤销 为什么 它替我做了什么',
  worktrees: '工作树 分支 工作文件夹',
  workspace: '工作文件夹 工作区 环境',
  usage: '用量 计费 预算 额度 上限 费用 降级 暂停',
  memory: '知识 笔记 记忆',
  voice: '麦克风 语音 实时语音 听写 唤醒',
  briefing: '简报 日报 日程 审批 早上',
  shortcuts: '热键 快捷键',
};

export function matchesSettingSearch(page, label, query) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = `${label} ${page} ${aliases[page] ?? ''}`.toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
