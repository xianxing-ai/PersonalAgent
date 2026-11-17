# CW-05 活动时间线

- 关联需求：常驻助手归来后能看见「它替我做了什么」
- 目标 Profile：`huawei_ict_agentarts`
- GitHub 负责人：zemeng5208
- 独占目录：`packages/activity`
- 当前状态：in_progress
- 接口状态：provisional

## 职责

把自动执行、主动触发、失败自愈和插件安装/启用收成一条只追加的记录。Desktop 管理后台「活动」页按时间展示。每条可以查看触发原因和决策依据。只有存在补偿动作，并且该来源的补偿执行器已经接上时，才出现「撤销」。

## 非职责

不改 Runtime 任务终态，不签发授权，不执行尚未合入的自主档、主动触发或自愈策略。不记录消息正文、邮件主题或工具参数。不替代 CW-05 的 enter/return checkpoint。

## 输入与输出

| 接口 | 提供方 | 状态 | 说明 |
| --- | --- | --- | --- |
| `createActivityLedger` | `@personal-agent/activity` | provisional | JSONL 只追加。撤销追加补偿结果 |
| `fromPluginAction` | 同上 | provisional | 已接插件目录 `onActivity` |
| `fromAutonomyAudit` | 同上 | provisional | 等 #630。字段对应 `AutonomyAuditRecord`，不接收参数摘要 |
| `fromProactiveOutcome` | 同上 | provisional | 等 #631。字段对应 `TriggerOutcome`，不接收来源摘要 |
| `fromRepairDecision` | 同上 | provisional | 等 #633。字段对应 `RepairDecision`，依据只接受决策码 |

## 产品接入

桌面启动在 `app.whenReady` 里调用 `openDesktopActivity`，记录文件是用户数据目录中的 `activity-ledger.jsonl`。插件目录宿主把 `onActivity` / `onActivityFailure` 交给这份记录，并在同一启动流程里 `bindPlugin`。管理后台快照带上 `activity`。渲染进程沿现有 `desktop.invoke` → `desktop:action` 调用 `activity.undo`。设置导航的「活动」页渲染这份快照。重启后仍读同一文件；撤销会改插件的启用状态。

#630、#631、#633 仍只用适配函数，不在本分支调用未合入的实现。

## 合入后的对接

不把 #630、#631、#633 的源码拷进本分支。合入后由各自主进程在动作成立时调用适配函数并 `append`：

- #630：`fromAutonomyAudit`，使用审计 id、工具名、风险档、处置、`rollback`、分类 `reason` 和补偿工具名。`rollback === 'available'` 且有补偿工具名时，补偿动作为 `revert`，引用是审计 id。接入补偿执行器后，`list(new Set(['autonomy', ...]))` 才会把按钮交给界面。
- #631：`fromProactiveOutcome`，使用事件 id、来源、变化类型、状态、规则 id 和风险。不要传入 `SourceChangeEvent.summary`。
- #633：`fromRepairDecision`，使用指纹、策略、失败类型、风险、尝试结果和 `RepairDecision.reason`。有 `compensationRef` 且策略不是停止时，补偿动作为 `stop_retry`。不要传入 `FailureSignal.message`。

插件补偿已经接在 Desktop：安装的撤销是卸载，启用的撤销是停用。用户在插件页取消确认不会记一条记录。

## 验证

`npm test --workspace=@personal-agent/activity`，以及 `node --test apps/desktop/test/activity-timeline.test.mjs`。没有真实 Electron 窗口、系统通知或云端读回。
