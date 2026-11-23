# Z-09 · #17/#19/#25/#649 本地收口（2026-11-20）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/zemeng-owned-image-remediation-20261119`。

## 做了什么

| 项 | 改动 |
| --- | --- |
| **#17** | `todo.create` 可执行 `recovery`；冷激活 `activateByNativeTag` → `compensate` → 待办 `cancelled` 存储读回 |
| **#19** | `failure-repair-host` 经 `parentReplanIntent` 派发 TaskRuntime 跟进任务；**main 装配 `createCrewReplanDispatcher`** → `CrewKernel.replanChildTask` |
| **#25** | `minimalPermissionPositivePlugin` / high-risk 夹具；notes/ 正例 + 越界/symlink 拒 + 启用授权 |
| **#649** | 失败任务投影 `resultMetadata.diagnostics.stderr`；定位按钮优先用该字段；**「在编辑器打开」** → `task.locate.open`（Cursor/VS Code URI → spawn → shell.openPath） |

## 定向验证

```text
node --test apps/desktop/test/crew-replan-dispatcher.test.mjs \
  apps/desktop/test/locate-open-host.test.mjs \
  apps/desktop/test/risk-autonomy-todo-compensate.test.mjs \
  apps/desktop/test/notification-cold-activation.test.mjs \
  apps/desktop/test/failure-repair-card.test.mjs \
  apps/desktop/test/node-check-diagnostics.test.mjs
```

`npm test --workspace=@personal-agent/productivity`  
`npm test --workspace=@personal-agent/plugin-catalog`

## 真机 toast 手点说明

生产路径已接：`Notification.handleActivation` → Tag → `activateByNativeTag` → `riskAutonomyHost.compensate`。  
本地用冷激活 + FakeStorage/TodoService 读回证明补偿闭环；**Windows 通知中心真人手点**仍需本机有自动执行后的 toast 时点一次确认（不另造第二套协议）。

## 未宣称

- 未在本会话完成真人点击 Action Center 的录屏回执（环境/时机依赖）
