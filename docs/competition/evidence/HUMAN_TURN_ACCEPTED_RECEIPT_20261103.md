# 原任务受理后的用户回合回执修复

- Profile：`huawei_ict_agentarts`；范围：Desktop `recordExplicitUserTurn`。
- 真实发现：固定 `db3a5a74` Desktop 提交一次公开 F26 请求后，原 parent 与 child 已进入 `running`，UI 却返回 `stage=ipc; code=INVALID_ARGUMENT`，输入框没有清空。原任务未被重提、取消或修改。
- 原因：`Runtime.getTask()` 返回的 `TaskSnapshot` 没有 `createdAt`。Main 在已受理后把 `createdAt: undefined` 写入 `human-turns`；原宿主存储拒绝有损 JSON，错误经 IPC 返回。不是任务未受理，也不是平台验收成功。
- 修复：从原 Runtime 事件中同时匹配 `taskId` 与 `type=task.created`，使用其 `occurredAt`；缺少合法原创建事件时明确拒绝。保留 lossless JSON 校验，不扩展公共协议，不把后续任务状态时间当作创建时间。
- 定向回归覆盖生产 Main 提交分支：`TaskSnapshot` 不带 `createdAt`，另有其他任务的创建事件与原任务较晚进度事件，仍应保存精确原创建时间、返回原受理任务且只提交一次。这里的 Runtime/存储端口是显式本地夹具，不是真实云或设备验收。
- 实际验证：`node --test --test-name-pattern='actual accepted submission records the exact creation event' apps/desktop/test/conversation-main-actions.test.mjs` 为 **1/1 通过**；修改的两个 JavaScript 文件各做一次 `node --check`，以及 `git diff --check`，均通过。未重复整文件或全量测试。原固定版任务与真实 F26 验收由主任务继续读回，本修复未接管其执行。
