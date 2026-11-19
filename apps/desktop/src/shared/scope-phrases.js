const nouns = {
  workspace: '工作区', mail: '邮件', todo: '待办', calendar: '日历', knowledge: '知识库',
  memory: '记忆', feeds: '订阅', notification: '通知', notifications: '通知', weather: '天气',
  skill: '技能', plugin: '插件',
};
const verbs = {
  read: '查看', list: '查看', search: '搜索', get: '查看', status: '查看状态',
  write: '修改', create: '新建', patch: '修改', update: '修改', send: '发送',
  delete: '删除', execute: '执行',
};
const actions = {
  'workspace.apply_text_patch': '修改工作区文本',
  'workspace.read_text': '读取工作区文本',
  'calendar.respond': '回复日历邀请',
  'todo.create': '创建待办',
  'mail.send': '发送邮件',
  'mail.inbox': '查看邮件',
};
const scopes = {
  'workspace:write': '修改工作区里的文件',
  'workspace:read': '读取工作区里的文件',
  'mail:read': '读取邮件',
  'mail:send': '发送邮件',
  'todo:write': '修改待办',
  'todo:read': '查看待办',
  'calendar:read': '查看日历',
  'calendar:write': '修改日历',
  'notifications:settings': '修改通知方式',
  'cloud:context': '把必要内容用于这次对话',
  'model:export': '把结果交给模型',
};

function phraseForScope(scope) {
  if (scopes[scope]) return scopes[scope];
  if (typeof scope !== 'string' || !scope) return '需要你确认的操作';
  const separator = scope.includes(':') ? ':' : scope.includes('.') ? '.' : '';
  if (!separator) return '需要你确认的操作';
  const [head, verb] = scope.split(separator);
  if (!verbs[verb]) return '需要你确认的操作';
  return `${verbs[verb]}${nouns[head] ?? '这项内容'}`;
}

/** People-facing permission text. Unknown internal ids are not shown raw. */
export function describeScopes(items) {
  if (!Array.isArray(items) || items.length === 0) return '需要你确认的操作';
  return [...new Set(items.map(phraseForScope))].join('、');
}

export function describeAction(action) {
  if (typeof action !== 'string' || !action.trim()) return '本次操作';
  if (actions[action]) return actions[action];
  if (/^[a-z0-9_.]+$/iu.test(action)) {
    const head = action.split('.')[0];
    return nouns[head] ? `操作${nouns[head]}` : '这项操作';
  }
  return action.trim();
}
