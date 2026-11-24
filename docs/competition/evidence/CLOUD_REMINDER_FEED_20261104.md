# F06/F12 独立云待办与通知 feed 接线

目标 Profile：`huawei_ict_agentarts`。工作分支 `codex/pr531-cloud-reminders`，从 #543 的 `ef0d9fb8` 隔离开发；冻结的 #543 与最终验收候选未被修改。

## 范围依据

- [IMAGE28 开放清单](IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md) 的 F06/F07 行要求 F06 关机持续运行，F12 行要求通知关机云持续运行；#531 仍须全部接线与真实验收。
- [当前设计](../../design/CURRENT_DESIGN_20261015.md) 第 3 节和 [公开协作接口](../PROACTIVE_COLLABORATOR_INTERFACES.md) 的“无人值守、静默与打扰次数”区分真实 `cloud_persistent` 与离线 `waiting_device`。没有要求把每个邮件、日历、GitHub 连接器全部迁成云守护进程。
- 因此本包只补 F06/F12 必须独立运行的待办计划、通知持久 feed、原状态读回和用户已读消费。原 F06/F12 完整图、真实账号以及实体 banner/voice 仍分别验收，不能用此后半链代替。

## 实现及兼容

原 `productivity.register` / `TodoService` 使用原 Runtime 的任务隔离存储。公开 cloud-persistent v1 增加有界 `todo` 和 `notification` 原生操作与可选读回字段；旧请求仍兼容，旧服务明确拒绝新操作。Todo 创建/修改准备为固定原 HostToolTask，原 Policy 待审批，跨父责任、参数、版本、期限不匹配拒绝。来源/云配置不签发 grant，未知子操作只能核实，不新建替代任务。

原 `createReminderDeliveryHost` / Scheduler 持久到期任务进入原 `RuntimeNotificationHost`；共用维护循环在平台 describe 之前推进已批准的原提醒，不增加定时器或数据库。原 `proactive.notify` 只作持久 ingest，位置来自真实 Runtime owner；设备渠道仍未注册。Todo 的 delivered 状态仅代表宿主队列回执，UI 明确不代表设备送达或用户阅读。

通知使用原责任 scope、期限和已读记录；原来源事件保持不变，通知 identity 绑定责任、来源与原 dedupeKey，保留 connector 策略继承并按同 scope 读回，两个责任订阅同一事件不会串回执。当前有效未读来自显式 `on_demand`；自动归来候选来自原 `on_return` 策略，未配置时为空，不默认填入全局额度。用户手动已读只改变原 feed 记录，不产生渠道回执、额度预占或补弹。

没有新外部依赖、数据库迁移、云资源、凭据读取或设备操作；初次新树依赖从既有本机缓存安装。部署须重新固定本包 sourceRevision、Runtime artifact 和宿主资格，见 [部署说明](../../../scripts/remote-runner/CLOUD_RUNTIME.md)。

## 检查与真实缺项

必要检查仅覆盖受影响行为，不重复整个仓库测试：

- 新树构建完成（根构建推进至 Runtime 后修复一处类型推断，定向 Runtime 类型编译及剩余 Obsidian 构建通过）；`contracts/scripts/generate.mjs --check` 与 `git diff --check` 通过。
- 新协议字段/原版本约束与 Desktop 实际卡片参数消费，各定向 1/1 通过。
- `node --test scripts/remote-runner/cloud-runtime-notifications.test.mjs scripts/remote-runner/cloud-runtime-reminders.test.mjs` 首次 2/2：真实本地 SQLite、原 Runtime/Policy 人工 `allow_once`、固定未知子操作不重提、暂停待审批身份、原 Scheduler 入队与重开回执、跨责任拒绝、过期不补弹。scope 修正后仅通知用例定向复验 1/1。
- `apps/runtime/test/proactive-workflow-application.test.mjs` 双责任同一来源事件的原 Runtime/ToolGateway/NotificationService 定向 1/1；`apps/desktop/test/proactive-runtime-pump.test.mjs` 平台不可达时先推进已授权 native 维护、过原期限不执行，定向 1/1。新增双责任 fixture 首次缺少原 connector tick，修正 fixture 后只复验该项。
- 独立静态审查发现并修复同事件跨责任全局去重问题；修复窄复核通过。该子智能体审查不等于 GitHub 非作者批准。完整必需 CI 和正式非作者批准由 PR 门禁继续执行。
- 部署预检发现原 runner 安装器固定 Node 22.21.0，与根 Node 24.15.x/npm 11.12.x 不符。已最小修正到 `.node-version` 的 24.15.0 和 CI 的 npm 11.12.1，提前返回也复核实际 systemd 二进制版本。静态版本一致性及当前 Node 24 的原 runner `--verify` 通过；Windows 沙箱阻止 MSYS `sh -n` 启动（`NtCreateDirectoryObject ... 0xC0000022`），未冒称 shell 语法或真实 Linux 安装通过，未重复已绿行为测试。

尚无本任务获准可用的 Linux/SSH/独立持久卷目标，未部署或真实关机验收。Fixture 和编译不能作为 #531 的云持续、完整图、真实设备、F23/F26 或独立真人签名证据。
