# F13/F14 系统与设备接线工作包

目标 profile：`huawei_ict_agentarts`。工作树 `.worktrees/pr531-system-observation`，基线 `d9f35bea`。状态 `review`；本记录不声明真实整图验收。

## 实现前的边界与兼容方案

- F13 复用 `computer.system.observe` 和原 Runtime 记录。现有系统采样没有云服务存活、远端配额或安全恢复结果；配置存在、RSS/CPU 和空闲锁快照均不能推断这些结果。缺少真实探针或恢复 provider 时，固定 worker 明确不可用，不创建正常值或自动释放未知操作资源。
- F14 沿已有受控浏览器路径观察、串行填充、正式原卡确认及提交。每个浏览器操作都是原图宿主下独立的 business child，经原 Policy/ToolGateway。固定输入只有原 URL、字段标签/值及提交标签，控件引用只能从当前原浏览器观察唯一匹配。
- `browser-control-host` 的原 targetRef 默认仍仅限原 task。新增 Main-only 回调只接受确证的原 graph/session、当前固定 action child、原观察 task/target 及当前设备 generation/page；不允许任意兄弟任务共享引用。过期、撤销、页面改变或未知写入均拒绝，不换 ID 重放。
- `computer-control-lease` 在原实例内增加整图 reservation。每个实际设备动作仍持有原 active/settling 锁；reservation 不签发权限，其他任务不能占用。进程重启不重建失去的 reservation；持久 unknown 记录仍阻止写入，释放不证明未知效果已撤回。
- 不新增 wire Schema、数据库迁移、第二套任务调度器或资源锁库。默认没有注入上述受信回调时保持既有行为。公共 Runtime 导出与 Main 接线由集成工作树统一完成。

## 验证计划

真实 Runtime/Policy/原审批卡配明确 Fake 镜像和设备，验证完整固定 worker、独立批准、拒绝、参数替换、精确子任务/观察谱系、并发输入互斥、取消/期限、未知写不重放、重启失去会话不恢复。真实设备/UI 由主工作树串行安排，另记证据。

## 实现与根装配

- `createF14WorkflowWorkerPorts({getApplication,browserHost,computerControlLease,authorizationQuestions,authorizeExport})` 返回 `tools`、`configuredWorkflowWorkerPorts`、`authorizeWorkflowTarget`。构造前可以懒取 Runtime；实际调用只接受当前 Runtime。Main 将原浏览器构造的 `authorizeWorkflowTarget` 迟绑定至该函数，继续使用同一 `computerControlLease.wrapTools`，并移除旧孤立 N01 的重复注册。
- 固定入口 `workflow.browser.form` 输入为 `{url,values:[{label,text}],clickTarget}`。仅消费已有、自有、已连接页面；不自动打开页面，不导航任意窗口。URL 禁止凭据、query/hash，字段标签唯一，当前控件必须唯一匹配。每次填写读回新观察，下一步只承认该原返回的 targetRef。当前完成范围要求提交后仍在原页面，导航结果不冒充已验证业务成功。
- N01 原独立 `browser.observe`；N02 原输入锁 reservation；N03 每个字段独立 `browser.type`；N05 原正式卡 `currentRequirement`；N06 只有 N05 确认后才能独立 `browser.click`。每个 host 与 business child 都有独立 Policy。不要把 N05 配为跳过原卡的自动工具。
- N05 的已消费回执只在 confirmed 后读取。最终成功必须具备全部五个原本地节点和原提交回执，结果 `{receiptId,lockReleased:true,goalVerified:false}` 明确不证明外部业务办理成功。回执出口在原授权等待前后复核原 grant，取消、撤销与过期不会借新出口审批继续执行。
- `createF13WorkflowWorkerPorts({getApplication,systemObserveTool,authorizeExport})` 同样返回两类端口。N02 真实 system tool 经独立原 child 执行，但本地采样没有 cloud/quota/lock 三项所需证据；N04 没有可确认恢复 provider，明确拒绝。整个 worker 保持 `f13_cloud_quota_lock_probe_and_confirmed_recovery_unavailable`，`available=false`。这不是 F13 全图完成。
- 新 Runtime 公共导出仅 `createRuntimeF14DeviceControlHost` 和 `createRuntimeF13DiagnosticControlHost`；没有新 wire、Schema 迁移、依赖或第二套调度器。原 browser/lease 默认路径不变。

## 本地结果与未验证项

- 根构建、最终 Runtime 构建、架构门禁通过。
- 受影响 Desktop 浏览器/共享锁、F13/F14 配置与 Runtime 图宿主定向 **83/83**。配置测试包含实际委派 worker、Runtime、Policy、原卡、共享输入锁和 SQLite；镜像、设备和系统采样为明确 Synthetic/Fake。
- 覆盖独立批准、原 N05 成功/拒绝/跳过、固定参数替换、错误原 target owner、丢失 reservation、取消、到期、原 host grant 撤销、等待导出期间撤销、出口拒绝、伪 cloud settled，以及原 click unknown 只发生一次。真实 SQLite 重启保留 unknown，原 reservation 不重建，新写仍被持久记录阻止。
- 浏览器宿主回归使用真实生产 host 配合 Fake Playwright，证明跨 task 回调默认为拒绝、原 target 一次性、并在 attempt 等待后、实际 I/O 前重验当前受信 handoff。若原 attempt 已记而授权随后失效，保守保留未知并阻断，不猜测撤回。
- 初次浏览器测试因 sandbox 自身 loopback `EACCES` 导致四项失败；获授权后按原代码与断言重跑通过，未放宽网络边界。完整 `npm run check` 另记录；83 项定向不替代全仓检查。

主装配/AgentArts 原部署及 trace、实际页面/设备整链尚未验收。F13 真实远端探针与确认恢复 provider 仍缺失；F14 仅已打开自有页面的固定表单路径，不代表任意 Windows 窗口或所有站点可用。不得据本包宣布 PR #531 已达真实验收合并条件。
