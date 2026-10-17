# MOD-11/13：原任务补丁结果核实入口

Profile：`huawei_ict_agentarts`；负责人 zemeng；状态 `review`。
工作树 `.worktrees/zemeng-windows-tools-completion`；分支 `codex/desktop-workspace-patch-recovery`。
基于 PR #359 的 `3b6d5c19`，依赖其取消收尾语义；本包不重复实现 Runtime 恢复。

## 行为与边界

管理后台 → 任务监控 → 原任务行“核实补丁结果”，使用原 taskId 和当前 revision。
受信主进程调用既有 `RuntimeApplication.reconcileWorkspacePatchTask`；不提交新任务、不执行 apply、
不创建授权。适用性、namespace/workspace/run/input 绑定及原 marker 核实均由 Runtime 决定，
不从私有 checkpoint 推测任务类型；其他任务、旧 revision、活动 worker 或绑定变化会被拒绝。

页面仅接收 taskId、原 runId、任务 revision、任务状态及四种补丁结果：已写入、未写入、结果未知、仍在执行。
已取消但补丁已写入时明确分别显示。仅在核实 revision 不早于当前快照时显示其任务状态，
新的任务快照会使旧结果失效。路径、PID、凭据、Evidence 明细和原始工具输出不进入该响应；异常统一为固定文本。

IPC 只允许正式 Competition 的当前可信管理窗口主 frame；窗口失效或 Runtime 被替换后不回传。
同一 Runtime/task 的并发核实合并，丢回复后可刷新并核实原任务；Runtime 的幂等恢复决定是否只读取已确认结果。
按钮等待期间不再发请求；页面切换、任务消失、卸载或版本更新使迟到回复无效。
收到核实结果不等于整个任务成功，不代表保存文件、真实云端或工具整体能力已验收。

## 实际验证

- Host/controls/task-monitor 定向测试 8 项通过、0 跳过；覆盖四种结果、白名单、并发、旧版本/未知任务/非法参数、
  失效会话、Runtime 拒绝、错误脱敏、重复点击、页面切换、卸载、任务移除及旧响应。
- `node --check apps/desktop/electron/main.js` 通过；`git diff --check` 通过。
- 因本会话未列出 Browser skill，使用现有 Playwright 和本机 Edge 的隔离 headless 实例，未安装依赖。
  实际渲染生产 admin/view.js、CSS 和 controls，1280×900，点击按钮后任务列显示“已取消”、补丁显示“已写入”；
  标题/非空页面/无错误浮层/控制台错误检查和单次核实断言通过，未出现私有路径标记。
- 渲染发现旧任务列仍显示旧快照，已改为按 revision 采用可信核实投影；仅重跑受影响的 task-monitor 和页面点击，2 项通过。
  截图保存在本地可视化目录 `workspace-patch-recovery.png`，不提交原始浏览器产物。
- 最终复核将任务监控与概览之间的切换也绑定页面代际；仅重跑 3 项 controls 回归通过，旧回复不跨页面生效。

```powershell
node --test apps/desktop/test/workspace-patch-recovery-host.test.mjs apps/desktop/test/workspace-patch-recovery-controls.test.mjs apps/desktop/test/task-monitor.test.mjs
# 显式选择现有浏览器；默认工作区测试不要求安装或启动浏览器。
$env:PA_PATCH_RECOVERY_BROWSER = '<已有 Edge 或 Chrome 可执行文件>'
node --test apps/desktop/test/workspace-patch-recovery-render.test.mjs
```

浏览器用明确 Fake application，经真实 host projector 驱动实际页面；没有真实文件变更、云调用或用户项目访问。
宿主测试证明只调用原 Runtime 恢复方法，原 task/run 的文件/SQLite 取消幂等由依赖 PR #359 的定向回归提供证据。
本轮没有完整 Electron IPC 联合实机、真实 AgentArts、UIA/F9、其他视口或全仓验证；这些不能由页面 fixture 替代。
PR 评审/合并与模块整体完成单独处理；不等待 CI、不合并、不强推。
