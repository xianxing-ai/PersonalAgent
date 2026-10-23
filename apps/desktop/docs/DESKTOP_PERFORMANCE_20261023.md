# Desktop 卡顿本地修复（2026-10-23）

- 目标 Profile：`huawei_ict_agentarts`，MOD-11/12 与 MOD-18 Desktop 宿主、既有待办/知识状态展示。
- 状态：`review`。用户已体验本地版本并授权提交 PR，尚未集成。
- 工作树：`.worktrees/desktop-lag-local-20261023`，分支 `codex/desktop-lag-local-20261023`；基线 `0df3006899d5791ec54f67e85e15057f37a3934b`。根 main 不改动。
- 本包实现、调用方接线与验证由本轮开发 Agent 本人完成；未启动其他 Agent。无需真实 AgentArts 模型/云评测：本包验收对象是本机事件循环、Windows 权限检查与 UI 展示，不对云端编排能力作完成声明。

## 问题和修复

原配置的主进程调用栈为待办 tick → publish → coding snapshot → writeAvailable → applyHost.available → execFileSync/pwsh。7 次成功 ACL 检查每次等待 1.43～1.91 秒，累计占 11.727 秒时段的约 97.4%。UI 生成快照时执行了原本属于工具执行边界的耗时检查；窗口消息和 IPC 不能及时处理。低 CPU 并不代表事件循环畅通。

1. 编码宿主区分轻量 `ready()` 提示与实际执行检查。快照和能力发现读取固定路径/身份及未决 marker，不启动子进程；这不是权限授予，不能被 Runtime 或 Renderer 视为一次执行的安全证明。真正补丁执行和恢复协调仍先检查 ACL，执行期改用异步 `execFile`，保留原脚本、超时、输出上限和隐藏窗口。等待前后重验固定身份、关闭与取消，执行前再次拒绝新出现的未决 marker。保留同步兼容检查供初始化及既有受控调用使用。
2. 写入型知识源的 UI snapshot 读取独立 readiness，仍检查当前来源/原生 helper 身份；原受控 writer 的实际绑定、ACL、原提问卡授权检查保留。没有把 UI 提示当作写许可，也没有修改知识包的同步绑定契约。真实知识写入性能不在本轮已验证范围内。
3. 待办 Scheduler 仍按原节奏运行。只有项目、通知、暂停状态或错误等可见快照变化时才调用 onUpdate，减少无变化全量广播；到期通知、失败恢复及持久化语义保留。
4. 常驻球与工作区球的 Canvas 绘制上限为 30fps，动画时钟仍按经过时间推进；隐藏/降低动效和状态切换语义保留，停止再启动不补播后台时间。相同尺寸的 ResizeObserver 不再重复清空 Canvas backing store。没有删除既有视觉设计或修改用户动效偏好。

没有新增依赖、公共 wire/Schema、数据库迁移、Provider、授权层或任务库。主进程仍是可信宿主；Renderer 权限未扩大。`writeAvailable` 是装配/展示提示，ACL 变化必须在真正执行时拒绝，不能以该布尔值跳过 ToolGateway/Policy。

## 验证记录

隔离工作树独立 `npm ci`，Node 24.15.0/npm 11.12.1，`npm run build` 通过。

99 项定向回归通过，涵盖真实 Windows Unicode 路径 ACL 正负例、配置后的 UI snapshot 零同步子进程、ACL 漂移拒绝、异步等待期间撤销/取消/文件替换/新 marker 拒绝、待办到期交付与去重、60/120/144/240Hz 下限帧和隐藏恢复、原工作区授权/出机回归。架构检查及 Desktop typecheck 通过。`test:smoke`、`test:text-smoke`、`test:workspace-smoke`、`test:runtime-application-smoke` 全部通过；显式 Fake/Local 的组合烟测不作为 AgentArts 真实云调用证据。

原配置独立副本实测（`.cache/perf-fix/benchmark.json`）：编码配置及 writeReady 都为 true，排除关闭编码宿主伪造提速；8.006 秒中同步子进程 0 次，50ms 主循环定时器采样 129 次、p95 间隔 78.75ms、最大 110.44ms，对比修复前最大 1953.5ms。前台 5.002 秒 569 次 rAF、147 次球体绘制（约 29.4fps）、0 次长任务、25ms Renderer 定时器最大间隔 26.7ms、无待办空转广播，用户降低动效偏好仍未设置（未替用户更改）。原配置副本启动 runtime=ready、agentArtsConfigured=true；无真实模型任务。

Native computer-use 已确认连接卡片滚动产生实际位移；自动拖标题栏未读到窗口位置变化，不能声明真人窗口拖动手感已验收。诊断采样后正常退出 PID 9108，改以不带 inspect/remote-debugging 参数的标准实例 PID 38760 启动供用户体验。后续 UI 自动化碰到用户输入，停止争抢焦点。用户实际拖动、长会话滚动与其他机器仍待体验，不把窗口烟测和短采样扩大为所有场景均已修复。

保留首次失败：一轮测试早于依赖构建结束，两组报 `runtime/dist/application.js` 缺失；新限帧逻辑首次在 60Hz 回归中超出目标，修正后通过。后续 text-smoke 仍使用旧 `#model-label`，实际模型选择器早已改为 `.model-thinking-trigger [data-picker-model]`；旧 Fake 模式也没有 AgentArts 目录。更新用例以断言该显式 Fake 模式无目录、模型选择不可用，不冒充真实目录；保留实际 Fake Model 回答、宿主模型标签和终态断言，没有更改生产模型选择器来适配测试。

本地原始日志、首次失败和性能证据在本工作树忽略目录 `.cache/perf-fix/`。真实模型/付费账号、Live、邮箱、云端部署均未启用或宣称已验收。修复不能据此保证所有机器、所有写入/外部服务场景均无卡顿。

## 本地体验与继续入口

原配置及数据库先备份，另复制到独立 `PA_USER_DATA_DIR` 运行本地修复版，避免共享数据库。原始 userData 保留；体验副本中的新对话或设置也应保留，后续切回前按实际数据交接，不能覆盖丢弃。快照提示不恢复跨重启许可，仍由原提问卡处理权限。

提交前自审收紧知识 writer 的闭包：每个实例的执行 guard 捕获自己的固定 readiness，后续重新绑定只替换当前 UI 的提示函数，不能让旧 writer 使用新配置的 readiness。旧来源、旧版本、撤销与关闭的失效语义保留。

用户已授权提交本修复 PR，拟审查者 goo122，拟合并者 Potatos498（待实际接手确认）；首次非作者批准、必需 CI 与实际合并记录待 PR 补充。继续保留长会话、其他机器和真实知识写入性能的验证边界；不自行合并或发布。未运行整个仓库全量 check；本轮改动均限 Desktop 私有宿主/Renderer 与其测试，无公共协议迁移。
