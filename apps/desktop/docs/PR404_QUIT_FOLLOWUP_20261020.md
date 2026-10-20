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

## 同步单主对话与滑块后的回归入口

协作者将 main 的 #407 普通合并到 `b859b5c4` 后，生产面板有意隐藏会话管理、将原生思考控件改为滑块。原手动 smoke 仍等待 `.conversation-sessions` 可见，已在实际隔离 Electron 复现 30 秒超时；这是夹具入口失效，没有证据表明草稿退出生产路径回归。

本次仅更新 smoke：确认隐藏的会话组件仍挂载、按当前 `#mm-slider` 检查缺目录的禁用状态；面板 9 组尺寸/缩放检查继续验证线程、输入框与模型菜单可达性，不再向已隐藏的面板会话管理注入归档按钮。原 Workspace 会话组件、无任务输入框、通知 scope/revision、配置秘钥清空、关闭保存失败、app.quit 清理次数为零、失败后可编辑及显式重试后的最终草稿磁盘读回断言全部保留。没有恢复已移除的产品界面或修改生产代码。

Node 24.15.0 / Electron 44.2.0 的实际 smoke 14 项通过，回执为 `apps/desktop/.cache/pr376-regressions/run-NmyBBj/receipts.json`；失败前日志和修正后日志分别保留在 `.cache/pr-maintenance/latest-native-{before,after}.log`。同步后的五份退出/会话/原生思考单元文件也通过。未重复完整 Desktop/全仓检查；真实账号、云、音频、现有数据与其他应用会话均未参与。

## 退出回执绑定原页面生命周期

后续静态复核发现：草稿预检 ready 后等待异步宿主关闭时，旧回执没有绑定原页面。若同窗口、同 PID 甚至同 mainFrame 对象重载，新页面可能未经预检就复用旧 ready 状态进入 Runtime/托盘清理。

预检现绑定原窗口集合、webContents 与主 frame，并在主 frame 跨文档导航开始/提交、renderer 消失或销毁、窗口关闭时使 pending/ready 回执失效；同文档和子 frame 导航不撤销回执。每次 allow 仍核对原实体集合；加载中的替换页面拒绝预检，待就绪后显式重试。失效/取消/超时清理监听器和计时器，并尝试解冻仍存活的原页面及当前页面；旧异步成功不能再触发 quit。保持原 5 秒上限、原清理顺序和权限，不新增关停流程。

初轮导航回归后补齐正常退出的最终提交边界：Main 完成全部异步释放及最后活动任务门禁后，在注销快捷键和同步 Runtime/托盘清理前调用 `commit()`。该调用同步重验 ready 页面，成功后移除生命周期监听器，正常窗口 destroyed/closed 不再报告退出失败；失败阻止清理并重新预检。同步清理失败仍沿 `reportQuitFailure` 调用 `cancel()`，解冻保留页面。手动 smoke 的显式 Fake before-quit 组合也对齐该提交边界，没有修改其保存或清理断言。

对应轻量回归覆盖同窗同 frame 重载、窗口替换、pending 导航及迟到成功、重复取消清理、同文档/子 frame 导航、renderer 消失、加载中替换页、最终 commit 后正常两窗口销毁及同步 Runtime 关闭失败解冻。Node 24.15.0 下，`draft-quit-preflight`、`conversation-draft-close`、`quit-task-preflight` 三文件最终 38/38 通过，Desktop typecheck、smoke 语法与 diff 检查通过；日志在忽略目录 `.cache/pr-maintenance-20261020/pr404/page-generation-final-{tests,typecheck}.log`。未重跑实际 Electron smoke 或全仓测试，不沿用上节实际 smoke 结果冒充新版本验证。初轮 `f542ad93` 不含 final commit，不能作为最终交付版本。

## 同步启动语音宿主后的失败解冻

以分支 `863e20e6` 和 main `8edc4899` 静态核对：#444 新增的启动语音退出释放在失败时仍只广播错误，未沿原 `reportQuitFailure` 取消草稿预检，可能使保留窗口持续只读和 inert。本次将该明确的清理失败接入原解冻路径；缓存原释放 Promise，不重做结果未知的设备释放。每次显式退出都观察同一 Promise 的失败并解冻，重复点击等待同次成功释放时仅允许一次退出重入。

同类的 SIS 释放未知状态继续阻止退出且不重做释放；再次显式退出仍调用原失败解冻路径，不留下新一轮预检冻结。新增实际 Main 回调与真实草稿预检的失败/再次退出回归，以及待释放期间重复退出的单次释放/重入回归，并补强原 SIS 回归的每次解冻断言。仅静态检查及 `git diff --check`，未在此云 Git 工作区运行构建或测试；最终提交仍须独立审查和当前头远端 CI，不沿用上述历史通过结果。主线接口目录冲突保留 Desktop 与日历两段新增登记，不更改冻结等级或原协作者内容。
