# PR #404：退出前草稿预检

目标 Profile：`huawei_ict_agentarts`；Desktop MOD-11/12/13。修复 app.quit 先销毁宿主、随后 Renderer 草稿保存失败却保留窗口的退出顺序问题。

主进程在原 Runtime 活动任务和提交中请求门禁之后、所有宿主清理之前，要求 Panel 与 Workspace 的原会话控件完成同步草稿保存。所有窗口确认后冻结输入再重入原退出流程，最终 beforeunload 不重复启动可能失败的写入。保存失败、页面失效或后续资源释放错误时取消预检并恢复保留窗口的编辑；晚到听写不追加到已冻结草稿。复用原可信主 frame 草稿 IPC，不新增任务授权、公共协议、数据库格式或云端调用。

验证（Node 24.15.0 / Electron 44.2.0）：

- 退出预检、对话控件、实际 main 退出回调和广播快照四个测试文件：39/39 通过。
- `node apps/desktop/test/pr376-regressions-smoke.cjs`：14 项通过。实际 Renderer、Preload、草稿 IPC 和隔离 Electron 窗口；覆盖原生关闭保存失败、app.quit 保存失败时清理次数为零、窗口仍可编辑、显式重试成功退出以及最终草稿磁盘读回。
- 更新旧 smoke：Workspace 当前没有任务输入框，改为在真实 Panel composer 输入草稿，并让 Workspace 会话控件参加应用退出预检；不再等待已移除的 Workspace textarea。
- 原始 Electron 回执保存在工作树被忽略的 `apps/desktop/.cache/pr376-regressions/run-SrgBJb/receipts.json`，含 9 组布局检查及其他行为回执。单元检查与原生窗口检查分别计数，不等于整仓或真实云端验收。

所有数据、加密端口和模型配置均为显式离线夹具，使用隔离 userData；未操作真实模型、日历、邮件或现有运行会话。当前头的完整检查、主线同步、远端 CI 和非作者复审需单独读回；不撤销或冒签原 Changes Requested。
