# 原任务补丁恢复 Electron IPC 联合夹具（WIP）

Profile：`huawei_ict_agentarts`；负责人 zemeng；状态 `in_progress`，仅保存未完成工作。
分支 `codex/desktop-patch-recovery-ipc`，基线 `9bdca215`，依赖 PR #363（其依赖 PR #359）。

## 已保存范围

- 将 `coding.reconcile` 的管理窗口、主 frame、当前 Application 和 Competition 检查抽成共用主进程处理函数，正式 main 与隔离 Electron 夹具调用同一函数。
- 新夹具计划使用真实 Runtime Application、SQLite、Client、Preload、BrowserWindow 与临时文件，云端和写入助手均为显式 Fake；恢复读回适配器也是夹具实现，不证明生产 Windows 补丁助手。
- 拟验证未知写入后取消、重启原 SQLite、IPC 核实原 task/run、并发请求、不可信窗口拒绝及确认后重试不重写。测试断言已写，不代表通过。

## 未完成与准确证据

原 2026-10-15 保存版本没有完成的构建、测试或渲染验收；2026-10-16 后续静态补丁在保存时也尚未独立运行。当时唯一一次联合测试启动后被中断，进程退出码 1，没有通过结果或截图证据；不能把依赖 PR 的定向测试结果归到本包。后续本包隔离复验见下文。

2026-10-16 后续静态修补：共用 IPC 核实原任务后改为等待带会话校验的 `refresh(taskId)`，在 `task.get` 等待前后复核管理窗口/Application，并保留更高 revision 缓存，不再先发布旧缓存；隔离 Electron 夹具改用同一回调。新增普通 Node 合成测试断言新快照、较新事件泵 revision、会话撤销及刷新失败不重放；保存时尚未独立执行，后续定向结果见下文。原生产问题最初由静态检查指出，当前仍不宣称完整生产修复已验证。

2026-10-16 窗口等待修补：夹具先创建管理窗口和其他窗口，再加载管理页；创建事件发生时可能仍是 `about:blank`，或早于 launch 返回，不能用未来 `window` 事件的瞬时 URL 筛选。联合测试先监听新窗口，再取得已有窗口快照，对每个候选异步 `waitForURL()`，以实际管理页导航完成为准；去重候选并在结束后清理监听器。此处只改联合测试，未改生产代码；实际 Electron 复验结果另记。

本次独立隔离树使用 Node 24.15.0、npm 11.12.1 安装锁定依赖（禁用安装脚本），所需 22 个 workspace 构建通过。首次目标检查为 8 通过、1 失败、0 跳过：普通 action 断言通过，唯一 Electron IPC 项在 `electron.launch` 25 秒超时，尚未到窗口或 IPC 断言，无截图。Electron 为 44.2.0；错误日志只到 Node inspector 连接。随后修补夹具的 ESM 启动：将顶层 `await app.whenReady()` 改为注册 `whenReady().then(...)` 后完成模块导入，避免主入口加载与 ready 相互等待。

第二轮实际复验越过 `electron.launch`，但选择 `firstWindow()` 后的 URL 等待 30 秒超时（0 通过、1 失败、0 跳过），不能假定 Playwright 观察到的首窗口就是管理窗口。因此改为上面的多候选导航等待。第三轮到达全部原 IPC、回执、取消、重启和不重写断言之后，额外启用的可选隐藏窗口截图在 30 秒超时；保留该失败，不算截图或视觉通过。

最终按原测试默认关闭可选截图，运行 `node --test --test-isolation=none apps/desktop/test/workspace-patch-recovery-action.test.mjs apps/desktop/test/workspace-patch-recovery-ipc.test.mjs`，显式配置 `PA_PATCH_RECOVERY_ELECTRON` 为 Electron 44.2.0，Playwright 1.63.0：**9/9 通过、0 失败、0 跳过，exit 0**，总时长 1753.2002ms，实际 Electron IPC 项 1509.5945ms。保留所有原断言，覆盖原临时 SQLite 任务、真实 Client/Preload/窗口 IPC、其他窗口拒绝、并发核实、缓存更新、重启及确认后不重写；云端、写入助手和读回适配器仍为显式 Fake。未运行完整生产 main、真实云端、真实 Windows 写入助手、物理设备或视觉验收，PR 继续保持 Draft。

独立工位为 `.worktrees/pr365-window-race`，基线 `b816c721`，只修改本说明和两个测试文件。构建日志、四轮测试日志及带文件 SHA256 的 `validation.json` 留在该工位被忽略的 `.cache/pr365-window-race-validation/`；未把初始失败或可选截图失败隐去。

恢复时还需检查 `task.cancel` 参数与当前 Schema 的兼容性、夹具启动及清理；可信子 frame 与会话失效联测仍待完成。没有执行整个正式 main 的完整产品装配；共用 IPC 函数的隔离组合不等于完整应用验收。

联合测试默认跳过，只有显式设置 `PA_PATCH_RECOVERY_ELECTRON` 才启动独立 Electron；`PA_PATCH_RECOVERY_SCREENSHOT` 可指定本地截图输出。没有安装新依赖、调用真实云端或操作用户任务；无公共 Schema、数据库迁移或新 capability。

2026-10-15 原收尾仅检查差异、敏感信息和文件范围，提交为独立 Draft PR；不合并，不续开工作包。未验证真实 AgentArts、UIA/F9、用户工作区或产品完整启动。已有测试进程已终止，收尾只读查询未找到对应测试/夹具进程。
