# PR #495 主线集成记录（2026-10-22）

Profile：`huawei_ict_agentarts`；状态：`in_progress`。独立工作树
`.worktrees/connector-change-integration-20261022`，分支
`codex/connector-change-integration-20261022`。来源为原提交
`d9d07e5098a9ecd645ea40842bfe27b14fa3f827` 与
`db8085aa373606dac1b8730d88e61c86727f0900`，正常 merge 固定主线
`c15855f5`，没有 reset、rebase、强推或整文件 ours/theirs。

## 冲突归属与保留原则

| 文件 | 归属及融合原则 |
| --- | --- |
| `apps/desktop/electron/connector-conversation-tools.js` | main 统一 question 授权与资源 generation；同时保留来源实际读取前 onReadTask 绑定，回调失败仍不访问 provider。 |
| `apps/desktop/electron/main.js` | main 统一授权 namespace/question、独立 Laya 初始化及默认模型/停止队列行为；保留来源邮件监控撤权和原读取来源回调。删除旧位置重复 Laya 装配，独立初始化仍含原 chooser。 |
| `apps/runtime/src/application/mail-triage.ts` | main 整批授权及提交页 prepare 围栏；保留实际 task/session 来源绑定，绑定失败停止原租约，不返回内容。 |
| `apps/desktop/test/quit-task-preflight.test.mjs` | 合并两侧宿主占位：question/intent/native 与 connector change/watch/closing 均保留。 |
| `packages/agentarts/src/prompts.ts` | 保留 main 当前用户交互风格及边界；增加来源显式 goal+原目录续接规则与专用 prompt，普通无目录 continuation 仍只答复。 |
| Desktop README、ROADMAP、接口目录 | 两侧独立记录均保留；来源 watch/owned-1.8 保持 provisional/in_progress，不替代 main 授权/模型记录。 |

自动融合的 Runtime coordination/worker、Desktop 停止队列及 picker 未用冲突选择覆盖。
保持单一 Runtime/Policy/Gateway/Scheduler/Evidence；邮件许可不跨重启，天气恢复仍按原
watch/task/command，unknown 不重放。目录不是授权，最终模型目的地/原任务绑定不放宽。
owned-1.8 仅源码协议，本轮不部署、不更改用户 pin。

## Manual 前置校核

三个来源 runner 已逐项静态检查。本环境无 Windows 用户现场或受信账号配置，未读取私有
配置、邮件数据库或凭据，未启动 Electron/模型/真实账号操作。

- `desktop-mail-cloud-live.cjs` 仍使用旧设置 enable/cloudEnable 与 sessionAllowed。
  main `mail-config.js` 在 question 模式明确拒绝这两个旧许可入口；不能直接复用该 runner
  宣称新 head 的真实验收通过。须先改为原统一提问卡，精确限定一封 INBOX 信头及原任务目的地。
- weather、mail、pelican runner 仅消费旧 `snapshot.approvals`；main 会隐藏已有 pending
  question 对应的旧 approval。续验须消费原 `authorizationQuestions`，核验原 task/run、参数、
  deadline、目标和 revision 后通过原 `authorization.question.respond`，不能改数据库授权。
- 真实自然新邮件/显著天气到 Laya/实际提醒、默认鹈鹕 unknown 原因及业务修复仍未通过。
  旧任务不重放，不强选候选。来源根 check 原生退出仍为 exit 1，单文件/工作区/51项 integration
  的后续通过不能将其改写为整条 check 通过。

本轮尚未 install/build/运行测试：Linux 安装构建槽由主控真实天气工作树占用。
仅允许语法、diff 及静态前置校核；完整受影响 build/check 与本 head CI、独立批准由主控串行协调。
