# F11 原方案决定接线兼容方案

只补原完整 update/reminder 方案的缺决定分支：N03 选择 requiresVoiceConfirm=true 时，N04 等同一受信对话的明确 accept/decline；答复绑定原图、节点、任务、方案摘要、消息 commandId、revision、deadline。accept 只允许后续原 N05 进入各自 Policy，不成为日历或提醒工具的授权；decline 跳过 N05，以明确 declined 结果结束，不写日历或删除提醒。缺新时间等任意字段不猜、不由 allow 卡补齐。

复用地点包的原 TaskRuntime 问题/单次答复验证，新增固定字段 plan.decision 与两个选项。地点公开 API 保持兼容；新决定宿主另导出，不修改 F02 的审批含义。N04 模板说明明确语音或文字，真实语音来源/声学证据仍待验，文字回答不算其替代验收。N04 的原逻辑资源声明不扩为设备执行证据，实际文字分支不会启动音频。

F11 completion Schema 兼容保留原成功结构，增加 decision=declined、calendarUpdated=false、oldTrafficAlarmVoided=false 的无写入分支；配置摘要升级拒绝旧图。无新增节点、任务库、授权层、调度或数据库迁移。Main 负责原对话文字入口及显示当前方案/选项，实际云/日历/语音证据另行验收。

## 实际接线与 Main 接口

- 同 `apps/desktop/electron/f11-location-question-host.js` 导出 `createF11DecisionQuestionHost({getApplication,onUpdate,now})`，在 `createBusinessWorkflowWorkerPorts` 注入 `f11DecisionQuestion`。地点的 `createF11LocationQuestionHost` / `f11LocationQuestion` 及参数不变。
- `readQuestion({taskId,conversationId})` 只沿原 root/graph/N04 的公开关系发现。返回原 `taskId,graphTaskId,sourceTaskId,questionId,revision,state,conversationId,deadline`，以及 `field:'plan.decision'`、当前完整 `plan:{update,reminder}`、`choices:[{id:'accept',label:'采用原方案'},{id:'decline',label:'不采用'}]`。`sourceTaskId` 是绑定的原用户任务上下文，不声称原任务文字已含新回答。
- Main 在同一对话的真实文字/选择事件调用 `submitReply({taskId,questionId,expectedRevision,sourceTaskId,commandId,decision},{conversationId})`；`decision` 只能是 `accept` 或 `decline`。`commandId` 来自稳定的原 UI 事件；不能接受模型自造的事件身份或把审批卡 `allow_once` 当回答。
- 原 N04 自己在 TaskRuntime 生命周期中等待；问题 checkpoint 和原子单次答复 checkpoint 绑定任务、原方案、运行、会话、期限及 revision。原问题 pending revision=1、答复后 view revision=2；精确重复是只读，替换回答拒绝。取消、原 Policy 撤销、来源擦除、过期会停止原等待或禁止读回，不直接改任务终态。
- 新公开 Runtime 工厂 `createRuntimeF11DecisionQuestionHost` 只向图返回 `{decision}`，不导出私有消息/任务 proof。N05 当前检查和原业务 child bridge 执行前检查共同核对该原回答。配置版本为 `business-20261101-f11-v4`。

## 本地行为证据与限制

实际 OwnedWorkflowEngine、TaskRuntime、SQLite、AuthorizationQuestions、Todo 和原 reminder schedule 参与测试。云传输、候选生成/选择、审批回答、显式文字事件、日历 provider 和天气 HTTP 是显式 Fixture；没有真实邮箱发送、个人日历写入、真实 UI 点击或语音验收。

10 项原方案定向用例通过：采用及各自独立写入卡；拒绝及零写入；写入拒绝；原任务取消；原问题撤销；等答复时原提醒变化；日历卡待批时原问题撤销或来源擦除；提醒卡待批时撤销保留已发生的日历效果和原提醒；unknown 日历写入后 SQLite reopen 仅只读原答复，未重发。答案替换、非法枚举、跨会话在实际问题生命周期内被拒绝。

新增测试曾真实复现：N04 已回答后、`calendar.update` 独立卡待批时撤销 N04，旧代码仍发生一次写入。修复使用原 `createWorkflowBusinessToolBridge.assertCurrent` 的固定 F11_N05 来源检查，原 Runtime 执行前 guard 再次核对，恢复为零写入。未另建授权层或绕过 Tool Policy。

SQLite reopen 只证明原答复持久化、终态/unknown 不重放，不证明任意中断点自动续跑。缺新日期等任意字段的补问、真实语音声学证据、Main/UI 接线及云/真实日历整图验收仍由各自实际调用方记录，不能由本次文字 Fixture 代替。

验证命令与结果：AgentArts / Runtime workspace build 通过；`npm run check:workflows --workspace=@personal-agent/agentarts` 通过；`node --test --test-concurrency=1 apps/desktop/test/business-workflow-f11-runtime.test.mjs apps/desktop/test/business-workflow-worker-ports.test.mjs apps/desktop/test/f06-f07-f11-workflow-ports.test.mjs apps/runtime/test/workflow-f11-calendar-receipt-guard.test.mjs packages/agentarts/test/owned-workflow.test.mjs` 共 72/72 通过；架构 3/3、`git diff --check` 通过。全仓检查由主集成统一执行，本增量未另跑全仓。
