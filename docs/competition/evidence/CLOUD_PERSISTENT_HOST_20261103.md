# 独立云持续会话宿主接线记录

目标 profile：`huawei_ict_agentarts`。工作树 `.worktrees/pr531-cloud-persistent`，分支 `codex/pr531-cloud-persistent`，基线 `db3a5a746d6980515dc82f2d1575d66b5ac1ee5c`（#535）。状态：`review`；接口 `provisional`；真实环境 **unverified**。

本包接通公共命令 Schema、原云 Runtime/Policy/Scheduler、固定 SSH/socket、Desktop 可信 IPC 和远端执行器卡片。已有本机会话不迁移，首次云 owner 拒绝接管已有任务库，未复制 grant/整库或切换完全访问。生产固定服务当前只有原 core 和 AgentArts teacher，未宣称已经装配所有云业务连接器或实体设备。

原维护逻辑已抽到 `createRuntimeProactiveMaintenancePump`，Desktop 与独立服务共用。原用户指令在首个网络 await 前入队，describe 失败后只恢复原本地 admission；重复 tick 不再入队/通知。重启使用原 `recoverInterruptedTasks()`，未知工具仍需原结果核实。控制/审批发送前持久 unknown；离线取消/暂停和拒绝审批先提交原 Runtime 控制，不依赖平台 describe。

审批读回包含原完整参数，Desktop 重新核对 digest；runner 脱敏改变参数时拒绝批准。GUI 只有手动一次允许/拒绝。独立目录锁不超时抢占，固定宿主不可用不回退本地，不重新提交未知操作。

## 必要本地检查

| 检查 | 结果与证据边界 |
| --- | --- |
| contracts 生成一致性及 Runtime 依赖类型构建 | 通过；没有新增依赖或数据库迁移 |
| 新公共 Schema | 1/1；越权字段、操作体、浮动版本和期限拒绝 |
| 云 Runtime | 4/4；真实 SQLite/Policy，镜像、资格和模型为显式 Fixture；覆盖唯一任务、原审批绑定、重开、离线取消、describe 恢复、重复 tick、固定宿主无本地 fallback |
| Desktop 可信宿主 | 2/2；配置缺失、审批参数被脱敏改写、失联控制持久 unknown、重开只读恢复 |
| 共用维护逻辑原回归 | 5/5；原 Scheduler、原 worker 重入、分页与来源恢复顺序 |
| 私有 socket | 6/6；本机 Fixture，未发送与写后未知、尺寸、身份、deadline、不重试 |
| 远端卡片 | 4/4；DOM Fixture，提交/读回/控制/完整审批参数、未知门槛，未启动真实 Electron |
| 排他目录锁 | 1/1；不接管活跃或未知锁 |
| 原 headless 进程、安装脚本语法 | 通过；仅本机进程与 `sh -n`，未运行 installer。Windows 沙箱的 sh DLL 初始化失败后，仅该失败项在标准用户环境复验通过 |
| 架构门禁 | 3/3；依赖边界及原标准检查入口不变 |

只在新增修复或具体失败后复验对应项目，没有反复运行完整仓库测试。技术 CI 仍须对最终 PR 头执行仓库要求的检查；本地结果不替代 CI、独立非作者批准或 #531 真实验收。

## 仍需真实验收

当前没有本包获准且可用的 ECS/VPS、SSH、独立持久卷资格或关机窗口证据；本包未创建资源、未部署、未读取真实凭据、未调用真实云服务。部署前提与精确操作见 [CLOUD_RUNTIME.md](../../../scripts/remote-runner/CLOUD_RUNTIME.md)。需对固定 release 和 AgentArts endpoint/version，实际完成原任务/工具/Scheduler 读回、设备离线阻断、停止/恢复以及物理关机期间持续运行记录。

F23/F26、真实业务来源、物理麦克风/扬声器、WinForms 目视和独立真人签名仍按 #531 原约定分别验收。该接线 PR 的合入或本地 Fixture 通过均不能把它们标为完成。
