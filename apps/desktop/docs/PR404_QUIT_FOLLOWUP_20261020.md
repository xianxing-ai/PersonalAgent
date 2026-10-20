# PR #404：退出前草稿预检

目标 Profile：`huawei_ict_agentarts`；Desktop MOD-11/12/13。修复 app.quit 先销毁宿主、随后 Renderer 草稿保存失败却保留窗口的退出顺序问题。

主进程在原 Runtime 活动任务和提交中请求门禁之后、所有宿主清理之前，要求 Panel 与 Workspace 的原会话控件完成同步草稿保存。所有窗口确认后冻结输入再重入原退出流程，最终 beforeunload 不重复启动可能失败的写入。保存失败、页面失效或后续资源释放错误时取消预检并恢复保留窗口的编辑；晚到听写不追加到已冻结草稿。复用原可信主 frame 草稿 IPC，不新增任务授权、公共协议、数据库格式或云端调用。

预检最多等待 5 秒；无响应或同步抛错都按失败处理，保留窗口和草稿，迟到确认不能再次触发退出。只有原退出门禁或清理失败回调会主动取消预检；普通 Runtime/configuration 错误广播不会解锁已冻结的输入。普通窗口关闭仍使用 beforeunload 保存失败拦截：浏览器允许用户选择强制离开，不能保证强制关闭或进程终止时保存；应用级 app.quit 走上述主进程预检。

验证（Node 24.15.0 / Electron 44.2.0）：

- 退出预检、对话控件、实际 main 退出回调和广播快照四个测试文件：39/39 通过。
- `node apps/desktop/test/pr376-regressions-smoke.cjs`：14 项通过。实际 Renderer、Preload、草稿 IPC 和隔离 Electron 窗口；覆盖原生关闭保存失败、app.quit 保存失败时清理次数为零、窗口仍可编辑、显式重试成功退出以及最终草稿磁盘读回。
- 更新旧 smoke：Workspace 当前没有任务输入框，改为在真实 Panel composer 输入草稿，并让 Workspace 会话控件参加应用退出预检；不再等待已移除的 Workspace textarea。
- 原始 Electron 回执保存在工作树被忽略的 `apps/desktop/.cache/pr376-regressions/run-SrgBJb/receipts.json`，含 9 组布局检查及其他行为回执。单元检查与原生窗口检查分别计数，不等于整仓或真实云端验收。

所有数据、加密端口和模型配置均为显式离线夹具，使用隔离 userData；未操作真实模型、日历、邮件或现有运行会话。当前头的完整检查、主线同步、远端 CI 和非作者复审需单独读回；不撤销或冒签原 Changes Requested。

## 复审增量

针对无响应 Renderer 与错误来源的意见，新增超时/迟到确认、同步崩溃、普通广播不解锁和明确退出清理失败解锁的回归，并补齐原 Live 退出 VM 使用的真实 helper 依赖，保留原断言。七份相关文件最终 60/60 通过；Desktop typecheck、原生退出 smoke 14 项及标准窗口/桥接 smoke 通过。最终原生退出回执：`apps/desktop/.cache/pr376-regressions/run-z2QAtn/receipts.json`。

最终完整 Desktop workspace 回归 1371 项，唯一失败仍为 Windows HostFixture 要求稳定 .NET 8 SDK；没有跳过或放宽该断言。完整日志 `.cache/pr-maintenance/review-followup-desktop-final.log`；前次运行在修改前加载旧 Live VM 夹具产生的失败保留于 `review-followup-desktop.log`，不把旧运行当作最终结果。仍不宣称本机完整检查全绿；远端当前提交 CI、原评审者复审及合并需另行确认。
