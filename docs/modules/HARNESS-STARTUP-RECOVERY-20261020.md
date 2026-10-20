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

Runtime 唯一写入者 H1 已在 `7149d728` 保存 `RuntimeApplication.resumeStartupTask(request):{accepted:boolean}`：先同步调用 guard，confirmed_read 沿原 `resumeConfirmedTask`；before_first_send 沿原 `startCoordinationTask`，created root 不伪造 approval，已恢复等待任务经 `prepareVerifiedContinuation` 交接；child 经原 `runSubagentWorker` 的原模型及 frozen tools。原子 event created 间隙的同 taskId 分支另保存于 `49cccffc`。独立工作包状态不替代后续集成和统一验证。

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

H2 必须使用原实际 transport 与 singleton 值；不得以 helper 存在、配置写入或返回 accepted 冒充任务完成。H2 的实际 main caller、原事件 facade 纯读 fence 及 Runtime artifact 身份组合已保存于 `b3d75029`：先绑定宿主并建立纯读 facade，等待恢复，再 start 原事件 consumer，之后 register/connect。统一类型及组合行为验证待代码汇合后执行。

### 原子事件受理与首次 enqueue 之间的崩溃窗口

`submitHarnessEventTask()` 在原子提交新 root + `harness-event-origin` 后才进入原 enqueue，可能留下尚未产生 application 元数据的 created root。不能重新提交事件、创建另一 root 或猜原权限。本包只识别四字段 origin、精确 `harness-event-root:<deliveryId>` 幂等行、检查点仅 origin/本模块观察、没有 tool/child/cloud/send attempt 的原 created root。

H2 的可选 `canResumeHarnessEvent({taskId,expectedRevision,conversationId,origin,phase})` 必须从 H6 原持久 delivery/anchor、原持续责任、native lease/control 与当前模型/工作区配置纯读返回 `{deadline,configurationRef,fence,assertCurrent}`；`phase` 为 `created_root` 或 `continuation`，taskId 总是原 event root。factory 的每次 guard 都重新读取并调用 `assertCurrent()`，只保存不含事件正文的 fence 摘要参与身份比较。子任务续接也重新核对其原 event root 的当前授权。

完整 fence 存在时，request 使用原 `before_first_send` 模式并附加 `harnessEventOrigin`，H1 在缺少 application 配置时走原 `dispatchAcceptedTextTask()`，使用同一 taskId/goal/conversation，不调用 submit，不扩充权限。此原子受理间隙的安全依据为尚未 enqueue，普通 HTTPS 中断续接仍不自动采用。H6 不提供再次 consume/retry 的旁路。

缺少完整 fence 时保留原 created/manual；不伪造 deadline 或默认授权。原 `task.cancel` 对精确、无活动/工具/云尝试的 unstarted event root 可直接确认取消；普通 created task 仍保留原取消语义，未知操作不因此清除。当前 created 间隙、lease 在交接前撤销已补小回归；H6 `readOriginalDelivery` 与 H2 的真实 fence 组合由各自唯一写入者交付并在合并图中验证。

## 原生只读核实后的原子终结

原生 H3 会话实际 clear/停止后，单独调用 `transitionTask` 或 `confirmCancellation` 不能把原 session、只读回执及 owner/peer 事实校验和终结放进同一事务；旧 confirmed-subagent 终结又要求所有工具 confirmed，不能处理必须保留的 UNKNOWN。本包新增受信宿主口，未注册为 wire、工具或模型输入：

```ts
interface NativeReconciliationTerminationInput {
  terminal: 'failed' | 'cancelled';
  evidenceRefs: readonly string[];
  reason: string;
  assertUnchangedAndStopped(): void;
}
runtime.finishNativeReconciliation(taskId, expectedRevision, input): TaskSnapshot;
```

同一原 SQLite 事务先检查 waiting_reconciliation/cancelling、精确 revision 和没有原 worker/工具活动。随后同步调用 H1 的 guard；guard 必须重读精确原 session 已 clear/停止、原核实 checkpoint 及完整 canonical owner/peer/child 事实，所有需收敛成员已终态且无活动。运行时拒绝 Promise、thenable 及任何非 undefined 返回。core 还核对 guard 前后原 TaskSnapshot、全部 checkpoint 原始 JSON/时间戳、工具记录完全不变；变更、旧 revision 或 guard 抛错均回滚。

允许保留 UNKNOWN 工具记录、缓存及原 Evidence；只新增 `native-reconciliation-termination:v1` 原事实摘要/停止审计和 failed/cancelled 终态。合并原 evidenceRefs，reason 作为原任务结果说明，原错误保留。没有模型续接、工具重做或成功声明。取消也不把原未知操作说成已撤销。

任何未决、非法或错配 cloud inflight/unknown/received 均拒绝；只有完整 receipt 的 session/request/idempotency/digest/accepted/serverInstance 一致，且原 `wss_terminal_error` 精确匹配，才视为传输已终态。即使此时允许结束，全部原 marker 仍保留，不 consume/clear。H1 是原生调用方唯一写入者，负责先验原生用户权限/只读 scope，再给同步 guard 并以同口依次收敛真实 child、owner/root；本包不代签其组合验收。

## 实际 Runtime 构建身份

根公开 `readRuntimeBuildIdentity(): string | undefined`，格式为 `runtime-artifacts:sha256:<64位小写摘要>`。它在该模块首次加载时，固定自身相邻 `dist` 中实际 `.js` 的稳定相对路径及字节摘要；每次读回核对同一文件集合。增删改、缺失、符号链接或读取失败使本进程身份永久失效，须重新启动。源码 TS 直接运行不产生构建身份。

此口只读取 Runtime 自身 dist，不扫描仓库、当前目录或用户配置；不将新 dist 标为已加载代码。它不是发行号、云版本或平台验收。H2 从公开根口将它交给 Windows host 的 `readHarnessVersions`，再独立组合真实 AgentArts 钉版；Desktop/app/protocol 的版本不得代替 Runtime 身份。Electron 打包使用自身正常 fs/.asar 路径，本包未启动真实 Electron 验收。

## 最小检查及后续

按当前“代码先齐、随后统一测试”要求，本包没有安装依赖、全量构建或重跑 #448 的 110 项。仅对新增两个模块与最小 core 改动使用现成 TypeScript 做纯转译语法检查；两份小回归覆盖分类/原身份交接、confirmed read/write/unknown、HTTPS/私有 checkpoint 拒绝、active/approval 保留、取消/到期、交接前 revision 变化、独占要求、事件 created 窗口与 lease 撤销；独立临时 dist 的字节绑定及失效不重新认领。实际结果在本 PR 验证记录中列明。

startup 回归使用显式 Fake Runtime port，不能称实际 SQLite/进程重开或生产消费通过；build identity 使用私有临时文件夹，未改生产 dist。另保存 `startup-recovery-core.test.mjs` 三个实际 startup core/SQLite 用例，留待统一构建后执行，本轮 `not_run`。

原子终结追加只跑 `native-reconciliation-termination.test.mjs`，12/12 通过：失败/取消保留 UNKNOWN、旧 revision、异步 guard、读回变化回滚、host 拒绝、原 worker/工具活动、未决/错配/非法云绑定、精确终态 marker 保留、私有 SQLite 关闭重开后原记录及审计保留。执行使用 Node 24.15.0、现成 TypeScript 纯转译当前 index 与两个新 helper，依赖经只读 resolver 复用 #448 树先前已构建产物；没有安装依赖或写入他树的 node_modules/dist。此为本地 core 隔离回归，不等于当前树完整构建或原生 session/App 实机验证。命令形状为 `node --import ./.cache/native-core-minimal-preload.mjs --test apps/runtime/test/native-reconciliation-termination.test.mjs`；原始输出保存在忽略目录 `.cache/native-core-minimal-tests.log`。

完整 TypeScript、实际 startup SQLite 重开、H1/H2/H6 组合调用、Windows packaged/.asar、真实 native session clear、云端 API 和实体应用仍 `not_run`，待代码汇合后统一验证；CI、独立批准、合并与发布分别记录。接口保持 provisional，不新增公共 Schema/capability 或权限。
