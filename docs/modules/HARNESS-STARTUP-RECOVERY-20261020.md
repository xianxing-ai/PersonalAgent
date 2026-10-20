# 原任务启动恢复及 Runtime 构建身份

Profile：`huawei_ict_agentarts`；模块：MOD-03 / 原生 harness。分支 `codex/harness-startup-recovery`，基线 main `80376bc2e037f05aaeda2ab2faf117f32348e542`。本包与 #448 的云终态失败核实修复独立，不改写其 PR。

## 原断点及实现

原 `TaskRuntime` 构造函数只打开存储、策略及工具宿主。`recoverInterruptedTasks()` 只在测试中显式调用，将 planning/running/waiting_external/verifying/cancelling 统一置为 waiting_reconciliation；生产初始化未调用，也未排除当前活动 worker。本包保留既有状态机，并补充：

- `recoverInterruptedTasks()` 跳过当前 Runtime worker / 工具执行，沿原任务检查点写入 `runtime-interruption:v1`，保留原状态、revision、已有错误与本次恢复身份，然后进入核实。没有新增任务库、迁移或模型循环。
- `isTaskActive()`、`listCheckpointKeys()`、`readToolDescriptors()` 为受信宿主只读口。`createRuntimeStartupRecovery()` 从 Runtime 根公开，使用既有任务分页、执行记录、缓存、父子绑定和检查点做分类，结果保存到原任务的 `runtime-startup-recovery:v1`。
- 仅独占原数据库的 Desktop singleton 可调用恢复。普通中断任务的自动启动只接受原 Competition/configuration、deadline/goal、父子 worker 及精确工具版本保持一致的两个模式：已证明尚未首次发送的阶段；已 confirmed 且已有缓存的只读 continuation。二者都要求原 WSS 配置具有发送前持久 intent。HTTPS、缺少原 marker、未知检查点/私有或专用 workflow、未确认操作、未知云结果、confirmed write 和需要原审批的任务均不据 checkpoint 缺失推定安全。
- `RuntimeStartupResumeRequest.assertUnchanged()` 在原 worker 交接前同步重读 task/revision、全部相关检查点、执行记录、descriptor 与父子状态。恢复入口不清 inflight、不续期、不重新签发授权。安全取消/到期只本地结束；未知操作即使取消仍保留核实。
- 主对话只交互/汇总、原产品子智能体执行的分工由原 RuntimeApplication/子 worker 保持，本模块不派生第二套执行器。

## 唯一写入者接线合同

Runtime 唯一写入者 H1 已在 `7149d728` 保存 `RuntimeApplication.resumeStartupTask(request):{accepted:boolean}`：先同步调用 guard，confirmed_read 沿原 `resumeConfirmedTask`；before_first_send 沿原 `startCoordinationTask`，created root 不伪造 approval，已恢复等待任务经 `prepareVerifiedContinuation` 交接；child 经原 `runSubagentWorker` 的原模型及 frozen tools。独立工作包状态不替代后续集成和统一验证。

Desktop 唯一写入者 H2 的生产调用位置为 `initializeRuntime()` 完成 model/coding/skill/private 等宿主绑定之后，**在 `goalHost.resumeApproved()`、Client register/connect、任务刷新和 proactive pump 之前**：

```js
const recovery = createRuntimeStartupRecovery({
  runtime: runtimeApplication.runtime,
  configurationRef: runtimeApplication.coordinationConfigurationRef,
  exclusiveOwner: ownsDesktopInstance === true,
  durableCloudDispatch: agentArtsTransportConfig.transport === 'wss',
  resumeOriginalTask: request => runtimeApplication.resumeStartupTask(request),
});
await recovery.recover();
```

H2 必须使用原实际 transport 与 singleton 值；不得以 helper 存在、配置写入或返回 accepted 冒充任务完成。Runtime 适配与 Desktop caller 的集成 SHA / PR、统一类型及行为验证待对应唯一写入者提交后补齐。

### 原子事件受理与首次 enqueue 之间的崩溃窗口

`submitHarnessEventTask()` 在原子提交新 root + `harness-event-origin` 后才进入原 enqueue，可能留下尚未产生 application 元数据的 created root。不能重新提交事件、创建另一 root 或猜原权限。本包只识别四字段 origin、精确 `harness-event-root:<deliveryId>` 幂等行、检查点仅 origin/本模块观察、没有 tool/child/cloud/send attempt 的原 created root。

H2 的可选 `canResumeHarnessEvent({taskId,expectedRevision,conversationId,origin,phase})` 必须从 H6 原持久 delivery/anchor、原持续责任、native lease/control 与当前模型/工作区配置纯读返回 `{deadline,configurationRef,fence,assertCurrent}`；`phase` 为 `created_root` 或 `continuation`，taskId 总是原 event root。factory 的每次 guard 都重新读取并调用 `assertCurrent()`，只保存不含事件正文的 fence 摘要参与身份比较。子任务续接也重新核对其原 event root 的当前授权。

完整 fence 存在时，request 使用原 `before_first_send` 模式并附加 `harnessEventOrigin`，H1 在缺少 application 配置时走原 `dispatchAcceptedTextTask()`，使用同一 taskId/goal/conversation，不调用 submit，不扩充权限。此原子受理间隙的安全依据为尚未 enqueue，普通 HTTPS 中断续接仍不自动采用。H6 不提供再次 consume/retry 的旁路。

缺少完整 fence 时保留原 created/manual；不伪造 deadline 或默认授权。原 `task.cancel` 对精确、无活动/工具/云尝试的 unstarted event root 可直接确认取消；普通 created task 仍保留原取消语义，未知操作不因此清除。当前 created 间隙、lease 在交接前撤销已补小回归；H6 `readOriginalDelivery` 与 H2 的真实 fence 组合由各自唯一写入者交付并在合并图中验证。

## 实际 Runtime 构建身份

根公开 `readRuntimeBuildIdentity(): string | undefined`，格式为 `runtime-artifacts:sha256:<64位小写摘要>`。它在该模块首次加载时，固定自身相邻 `dist` 中实际 `.js` 的稳定相对路径及字节摘要；每次读回核对同一文件集合。增删改、缺失、符号链接或读取失败使本进程身份永久失效，须重新启动。源码 TS 直接运行不产生构建身份。

此口只读取 Runtime 自身 dist，不扫描仓库、当前目录或用户配置；不将新 dist 标为已加载代码。它不是发行号、云版本或平台验收。H2 从公开根口将它交给 Windows host 的 `readHarnessVersions`，再独立组合真实 AgentArts 钉版；Desktop/app/protocol 的版本不得代替 Runtime 身份。Electron 打包使用自身正常 fs/.asar 路径，本包未启动真实 Electron 验收。

## 最小检查及后续

按当前“代码先齐、随后统一测试”要求，本包没有安装依赖、全量构建或重跑 #448 的 110 项。仅对新增两个模块与最小 core 改动使用现成 TypeScript 做纯转译语法检查；两份小回归覆盖分类/原身份交接、confirmed read/write/unknown、HTTPS/私有 checkpoint 拒绝、active/approval 保留、取消/到期、交接前 revision 变化、独占要求、事件 created 窗口与 lease 撤销；独立临时 dist 的字节绑定及失效不重新认领。实际结果在本 PR 验证记录中列明。

startup 回归使用显式 Fake Runtime port，不能称实际 SQLite/进程重开或生产消费通过；build identity 使用私有临时文件夹，未改生产 dist。另保存 `startup-recovery-core.test.mjs` 三个实际 core/SQLite 用例，留待统一构建后执行，本轮 `not_run`。完整 TypeScript、实际 SQLite 重开、H1/H2 组合调用、Windows packaged/.asar、云端 API 和实体应用仍 `not_run`，待代码汇合后统一验证；CI、独立批准、合并与发布分别记录。接口保持 provisional，不新增公共 Schema/capability 或权限。
