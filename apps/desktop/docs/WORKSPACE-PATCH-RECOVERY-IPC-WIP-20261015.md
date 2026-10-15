# 原任务补丁恢复 Electron IPC 联合夹具（WIP）

Profile：`huawei_ict_agentarts`；负责人 zemeng；状态 `in_progress`，仅保存未完成工作。
分支 `codex/desktop-patch-recovery-ipc`，基线 `9bdca215`，依赖 PR #363（其依赖 PR #359）。

## 已保存范围

- 将 `coding.reconcile` 的管理窗口、主 frame、当前 Application 和 Competition 检查抽成共用主进程处理函数，正式 main 与隔离 Electron 夹具调用同一函数。
- 新夹具计划使用真实 Runtime Application、SQLite、Client、Preload、BrowserWindow 与临时文件，云端和写入助手均为显式 Fake；恢复读回适配器也是夹具实现，不证明生产 Windows 补丁助手。
- 拟验证未知写入后取消、重启原 SQLite、IPC 核实原 task/run、并发请求、不可信窗口拒绝及确认后重试不重写。测试断言已写，不代表通过。

## 未完成与准确证据

本包没有完成的构建、测试或渲染验收。唯一一次联合测试启动后被中断，进程退出码 1，没有通过结果或截图证据；不能把依赖 PR 的定向测试结果归到本包。

源码候选问题：恢复处理仍只调用 `publish()`，而桌面快照读取缓存任务。联合测试要求立即发布新状态，当前尚未接入既有 `refresh(taskId)`。夹具已预备 refresh 回调，但生产处理函数尚未消费。候选缺口未经过运行复现，不宣称已修复。

恢复时还需检查 Electron 窗口事件等待竞态、`task.cancel` 参数与当前 Schema 的兼容性、夹具启动及清理；可信子 frame 和会话失效路径尚未补齐。没有执行整个正式 main 的完整产品装配；共用 IPC 函数的隔离组合不等于完整应用验收。

联合测试默认跳过，只有显式设置 `PA_PATCH_RECOVERY_ELECTRON` 才启动独立 Electron；`PA_PATCH_RECOVERY_SCREENSHOT` 可指定本地截图输出。没有安装新依赖、调用真实云端或操作用户任务；无公共 Schema、数据库迁移或新 capability。

本次收尾仅检查差异、敏感信息和文件范围，提交为独立 Draft PR；不合并，不续开工作包。未验证真实 AgentArts、UIA/F9、用户工作区或产品完整启动。已有测试进程已终止，收尾只读查询未找到对应测试/夹具进程。
