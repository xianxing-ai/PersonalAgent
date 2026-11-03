#!/usr/bin/env node
/**
 * 只检查真实环境是否齐。不访问 GitHub，不发 webhook，不连远端机器，也不弹系统通知。
 * 缺项时退出码为 2，并把缺什么、下一步看哪一节写出来。
 */
import {spawnSync} from 'node:child_process';

const hasNotifySend = spawnSync('notify-send', ['--version'], {stdio: 'ignore'}).status === 0;
const checks = [
  {
    id: 'github-write',
    title: '真实 GitHub 写入',
    names: ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_TEST_PR'],
    doc: 'docs/design/DEVELOPER_DIRECTION_REAL_ENV_ACCEPTANCE.md#1-真实-github-写入',
  },
  {
    id: 'public-webhook',
    title: '公网 webhook',
    names: ['GITHUB_WEBHOOK_URL', 'GITHUB_WEBHOOK_SECRET'],
    doc: 'docs/design/DEVELOPER_DIRECTION_REAL_ENV_ACCEPTANCE.md#2-公网-webhook',
  },
  {
    id: 'remote-runner',
    title: '远端机器',
    names: ['REMOTE_RUNNER_HOST', 'REMOTE_RUNNER_REPO'],
    doc: 'docs/design/DEVELOPER_DIRECTION_REAL_ENV_ACCEPTANCE.md#3-远端机器',
  },
  {
    id: 'desktop-notification',
    title: '操作系统通知弹窗',
    names: ['DISPLAY 或 WAYLAND_DISPLAY', 'notify-send'],
    doc: 'docs/design/DEVELOPER_DIRECTION_REAL_ENV_ACCEPTANCE.md#4-操作系统通知弹窗',
    present(env) {return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY) && hasNotifySend;},
    detail(env) {
      const graphical = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
      if (!graphical && !hasNotifySend) return '没有图形会话变量，也没有 notify-send';
      if (!graphical) return '有 notify-send，但没有 DISPLAY 或 WAYLAND_DISPLAY';
      return '检测到图形会话变量，但没有 notify-send。本命令不会弹窗';
    },
  },
];

const missing = [];
for (const check of checks) {
  const absent = check.present ? (check.present(process.env) ? [] : check.names) : check.names.filter(name => !process.env[name]);
  if (absent.length) missing.push({...check, absent, detail: check.detail?.(process.env)});
}

if (!missing.length) {
  console.log('四项环境变量都在。这只说明可以开始照文档验收，不代表真机已经通过。');
  for (const check of checks) console.log(`- ${check.title}：见 ${check.doc}`);
  process.exit(0);
}

console.log('真实环境还没齐。下面这些没有做真机验收：');
for (const item of missing) {
  console.log(`- 缺${item.title}：${item.detail ? `${item.detail}。` : ''}需要 ${item.absent.join('、')}。步骤和预期输出见 ${item.doc}`);
}
console.log('不要把 token 贴到聊天或写进仓库。本命令没有读取变量的值，也没有发起网络请求。');
process.exit(2);
