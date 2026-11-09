# 独立云持续会话的执行归属方案

状态：**proposed / in_progress**。目标 profile：`huawei_ict_agentarts`。本工作包从 `db3a5a746d6980515dc82f2d1575d66b5ac1ee5c` 分出，不改变 #531 的完整接线与真实验收门槛。

## 事实与范围

`RuntimeProactiveWorkflowHostOptions.cloudPersistentHost` 目前仅有 `ref` 与 `available()`；它不是远端任务端口。Desktop 的 `proactive-runtime-pump.js` 由本机轮询调用，本机关机后不会运行。AgentArts 的 `proactive-controller.mjs` 只根据传入检查点计算并签署下一前沿，不保存独立 Runtime、授权或 Scheduler。`remote-runner-service.mjs` 只有有限任务的提交与原结果读回，也不提供持续会话。

因此，给 Desktop 注入 `available: () => true`、把工具的 location 改成 `cloud_persistent`，或单独证明远端进程存活，均不能完成该接线。

当前 PRD 的“暂不承诺关机后持续执行”、架构的“首版没有关机持续运行能力”描述原首版能力。当前设计又允许真实独立的 `cloud_persistent` 分支，#531 的验收要求包含这一缺项。本方案显式记录所需的进程形态扩展；不把旧限制解释为已经验收或自动延期。

## 唯一执行归属

最小范围是**从创建时即属于固定云 Runtime 的新持续会话**。同一个逻辑会话只使用一套原 TaskRuntime、SQLite、Policy、ToolGateway 和 Scheduler。云端复用现有 RuntimeApplication；AgentArts 继续负责已部署的 Competition 编排。

- Desktop 已有会话继续属于本机，不热迁移、不复制整库、不复制授权，不在云端重建同一任务后假称原任务恢复。
- 云端新会话由受信组合选择固定 Runtime 身份和执行位置；Renderer、模型、来源事件、远端回执不得选择或改变归属。
- 每个会话持久绑定 Runtime 身份、位置、原 task/session、原 contract 与 deadline。重新打开同一库只能恢复同一绑定。换主机、换位置或缺少原归属，不是自动接管许可。
- 一个云 Runtime 数据目录只允许一个受信服务进程。部署宿主必须持有排他的进程锁；故障遗留锁不能按超时静默抢占。恢复前先核实原进程及未知副作用。
- 执行前与异步准备后同步复核原所有者、执行世代、取消、deadline 和 control revision。失去所有权后禁止新的模型/工具操作；历史读回不把 unknown 改成失败或可重放。
- core capability 的位置来自该受信所有者，不来自 `available()`。通知和实际业务工具仍逐个绑定真实执行位置；本机设备能力离线继续 `waiting_device`。

## 接线顺序与兼容

1. 在原 proactive host 中固定执行归属。旧记录没有归属字段时按本机历史会话读取；禁止通过新配置把它升级为云会话。字段为原 host state 的加法兼容，不新增数据库迁移、任务库或调度器。
2. 增加受信云进程组合，运行同一个 RuntimeApplication 与现有 proactive maintenance 逻辑。连接器、模型和凭据由部署宿主固定注入；不提供“上传任意模块/命令/授权”的入口。旧 Desktop 的默认 unavailable 保持到完整独立组合存在。
3. 复用已登记 SSH 主机、固定 known_hosts 以及 runner 的原提交/unknown/readback 语义，增加版本化的精确会话命令。Desktop 保存委派引用，不自行更新远端任务终态。首次提交前持久化原命令；丢失回执只查询原任务，禁止重新创建。
4. 暂停、取消、恢复及来源撤销进入云端原 Runtime 的控制 revision。SSH 登录权限不等于产品工具授权；任何具体副作用仍经该云 Runtime 的原 Policy。禁止把本机授权表整体发送到云端。
5. 云组合只调用原 Scheduler 的恢复/到期分派和原 worker 重入。进程维护轮询不维护另一份任务、日程或重试状态。

当前代码将归属、独立 Runtime 组合、固定 SSH socket 传输、Desktop 提交/控制/审批/读回及原维护循环一起接线，没有单独交付未消费的位置开关。部署前提、具体已装配工具与真实缺项见 [云宿主说明](../../scripts/remote-runner/CLOUD_RUNTIME.md)。仅有代码或离线 Fixture 不构成真实云持续验收。

来源增量复用原 confirmed-source router、原 HostToolTask/Policy 与原 Scheduler。公开 `source` 命令把原生用户选择绑定固定父会话/配置/revision/期限；子读取审批额外携带经过父会话核实的原 taskId。跟踪不等于 tool grant，每次网络读取仍须原 `allow_once`。当前限制每会话一个公开 feed，撤销同时取消该会话，防止撤销后继续发送旧来源；unknown 不另建读取或更换来源。旧 v1 消息不含这些可选字段时保持原行为；来源功能需要同一新 release 的云/桌面消费者，旧宿主将拒绝不认识的字段。纯 source router 提取保留 Desktop 原 CAS/state 键，未迁移用户数据。

## 必要验证与真实验收

本地最小验证覆盖：历史本机会话不能改为云归属；同一任务不能改 Runtime 身份、位置或 deadline；异步准备期间丢失所有权不能执行；原任务取消/过期与未知写入仍沿原拒绝和只读恢复路径。

真实验收需要一个明确获准使用的既有 ECS/VPS、固定 SSH 主机指纹、受限登录身份和独立云 Runtime 数据目录。此工作包不创建收费资源、不部署、不读取或复制真实凭据。

真实验收步骤：固定源码、镜像与 AgentArts endpoint/version；通过生产提交入口创建单一云会话；记录原 task/session/owner/contract/deadline；在原授权范围内观察一次真实业务来源及原 Policy/Evidence；确认 Desktop 断开并实际关机的时间窗口；由独立云主机在该窗口内记录原 Scheduler 的到期唤醒及实际执行读回；重新打开 Desktop 后只读取原会话、原执行记录及原幂等键。随后验证暂停/取消和设备依赖的 `waiting_device`，不得靠本地离线模拟替代物理关机证据。

F23/F26、实体麦克风/扬声器、WinForms 目视、独立真人审核签名仍是分开的验收项。云端进程存活、平台评分、Fixture 或镜像发布不替代任何一项。
