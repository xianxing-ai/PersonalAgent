// Search the existing settings routes using the words people use for their capabilities.
const aliases = {
  models: 'API AgentArts 运行时 网关 密钥 模型',
  capabilities: 'MCP Skills 技能 插件 能力',
  connections: '连接器 邮件 日历 订阅 待办',
  authorizations: '授权 审批 安全 权限',
  tasks: '进度 执行 Evidence 证据 任务',
  worktrees: '工作树 分支',
  memory: '知识 笔记 记忆',
  voice: '麦克风 语音 Live SIS 唤醒',
  shortcuts: '热键 快捷键',
};

export function matchesSettingSearch(page, label, query) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = `${label} ${page} ${aliases[page] ?? ''}`.toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
