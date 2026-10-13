# P7 关注事项与知识增量更新：集成说明

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。本文只说明 Desktop 消费宿主。`snapshot().mountedInMain` 恒为 `false`。导入本模块或跑测试都不等于桌面进程已经挂上。

P7 宿主及测试由 zemeng 维护；`apps/desktop/electron/main.js`、Runtime Application 和共享 UI 由 P8 总装者串行接线。当前文档同时记录宿主契约和 P8 真实接线状态。

拥有文件：

- `apps/desktop/electron/knowledge-watch-host.js`
- `apps/desktop/src/app/knowledge-controls.js`
- `apps/desktop/test/knowledge-watch-host.test.mjs`
- `apps/desktop/test/knowledge-watch-due.test.mjs`
- `apps/desktop/test/knowledge-controls.test.mjs`
- `apps/desktop/docs/knowledge-watch-integration.md`

## 公开导出

```js
import {
  createKnowledgeWatchHost,
  createUnavailableSourcePort,
  knowledgeWatchCheckpointKey,
  knowledgeWatchConversationId,
  knowledgeWatchScheduleInput,
} from './knowledge-watch-host.js';
```

`createUnavailableSourcePort` 只给显式测试装配。生产构造不要调用它，也不要把它的返回值传进 `sourcePort`。省略来源时，`refreshSource` / `refreshSubscribedFeed` 返回 `availability: "unavailable"`、`reason: "source_provider_missing"`，不写检查点，也不带 `provider: "fake"`。

宿主内部从 `@personal-agent/cognition` 使用：

- `buildInterestOptions`：只生成选项，并在模型返回后按当前墓碑和范围重验。它不是 Laya 的选择。
- `LayaInterestDecisionService`：只有传入 `layaChooser` 且没有另传 `interestDecider` 时，宿主才 `new LayaInterestDecisionService(layaChooser, now)`。
- `planKnowledgeReevaluation`：只重评仍绑定同一 `sourceId` + `sourceRevision` + `contentSha256` 的依赖。

宿主不调用 `LayaActionChoiceService` 来给兴趣选项排序，不取第一项，也不读取提供者私有字段。

## 构造参数和提供者

| 参数 | 必须 | 现有提供者 | 宿主实际调用 |
| --- | --- | --- | --- |
| `profile` | 是 | 固定 `huawei_ict_agentarts` | 其他值抛 `INVALID_ARGUMENT` |
| `namespace` | 是 | `desktopHost.userNamespace` | 写入检查点并拒绝不一致事件 |
| `checkpointTaskId` | 是 | 已存在的 Runtime 任务 `taskId` | 传给 `loadCheckpoint` / `saveCheckpoint`。宿主不创建任务 |
| `checkpoints` | 是 | `runtimeApplication.runtime` | `loadCheckpoint(taskId, key)`、`saveCheckpoint(taskId, key, value)` |
| `now` | 否 | 桌面时钟。正式模式用 `Date.now` | 兴趣服务和来源时间都用这一只钟 |
| `layaChooser` | 生产要跟踪时需要 | 现有 `localLaya`。它的 `choose(request)` 是 `LayaActionChoiceService` 的单参数形态 | 包进 `LayaInterestDecisionService`。不要把 `localLaya` 直接当作 `interestDecider` |
| `interestDecider` | 否 | 测试双份，或已经构造好的 `LayaInterestDecisionService` | `choose(input, {deadline, signal})`。有它时不再包一层 |
| `runtime` | 来源变化要提交工作时需要 | `runtimeApplication.runtime` | `submitTask`、`findTaskByIdempotencyKey`；若同时有调度方法，也用于下面三行 |
| `workPort` | 否 | 只在显式测试里代替 `runtime` | `read` / `submit`。传入后不再改编 `runtime.submitTask` |
| `scheduler` | 否 | 同上 Runtime，或单独传入同名方法 | `createSchedule`、`listSchedules`、`reconcileSchedules` |
| `feedCollect` | 要读真实订阅时需要 | `feedsHost.tools` 里 `descriptor.name === "feeds.collect"` 的 `execute` | `feedCollect({subscriptionId, cursor?}, signal)`，对应 `FeedService.collect` |
| `feedSubscriptionId` | 否 | 已配置订阅的 `id`。`feeds.subscriptions` 只返回 `id`、`title`、`sensitivity` | `refreshSubscribedFeed()` 省略参数时使用 |
| `notificationService` | 否 | `@personal-agent/notifications` 的 `NotificationService` | `ingest`、`drain`。宿主不调用 `acknowledge` |
| `notificationPort` | 否 | 显式测试双份 | `send`，可选 `read`。传入后不再改编 `notificationService` |
| `policyPort` | 范围扩大、私有或高风险时需要 | `AuthorizationPolicy` | 生产走 `authorize(request)`。测试双份可以是 `evaluate` |
| `authorizationRef`、`policyToolName`、`policyScopes` | 调用 `authorize` 时三者一起给 | 已登记的授权引用、工具名、范围。没有默认范围 | 缺任一项则 `allowed: false`，原因 `policy_request_incomplete` |
| `readTrackingGrant` | 否 | 能读当前跟踪授权的现有函数 | 副作用前重读。未注入时只重读宿主自己的墓碑和关注状态 |
| `sourcePort` | 否 | 旧的显式读取口。生产 RSS 用 `feedCollect` | `read({namespace, sourceId, signal})` |
| `subscriptions` | 否 | 只有真有 `subscribe(handler) -> unsubscribe` 时才传入 | `start` 登记一次。当前桌面没有这个推送总线 |
| `knowledgeMaxAgeMs` | 否 | 默认两小时 | 传给 `planKnowledgeReevaluation` 的 `maxAgeMs` |

检查点键是 `knowledgeWatchCheckpointKey(namespace)`，即 `knowledge-watch:v1:<namespace>`。对话 id 是 `knowledgeWatchConversationId(namespace)`，即 `knowledge-watch:<namespace>`。这个对话只放本宿主的调度，避免 `reconcileSchedules` 取消别人的提醒。

`saveCheckpoint` 会先 `getTask`。任务不存在时 Runtime 抛 `NOT_FOUND`。这不是空关注列表，宿主不会改写成首次运行。`loadCheckpoint` 没有行时返回 `undefined`，那才是空文档。加载抛错，或文档版本、命名空间、墓碑、已投递却无回执不合法，则 `health.status = "unreadable"`，`watches` 为 `null`，消费抛 `CHECKPOINT_UNREADABLE`，并且不回写。

## 尚缺、不能由本宿主补上的依赖

- `feedsHost` 不导出 `FeedService`。公开入口是工具 `feeds.collect`。`prepare()` 之后才出现在 `feedsHost.tools`。会话未 `authorize({readAndCloudConsent: true})` 时，现有包装会抛 `订阅读取许可已撤销或任务绑定已改变`。宿主把这种失败记为 `source_unavailable`，不把关注清成空列表。
- `createDesktopTodoHost` 内部的 `NotificationService` 没有公开句柄。没有可传入的实例时就省略 `notificationService`。提醒保持 `delivered: false`，原因 `notification_port_missing`。不要在总装里伪造 `{delivered: true}`。
- `localLaya.choose` 不是兴趣决策。兴趣决策必须经过 `LayaInterestDecisionService`。模型进程仍只有现有的 `localLaya.start` / `localLaya.stop`。
- 桌面没有来源推送总线。不要为了本宿主新增 `setInterval`。到点后由现有 Runtime `dispatchDueSchedules` / `recoverMissedSchedules` 产生任务，再显式调用 `refreshSubscribedFeed`。宿主自己不调用这两个分发方法。

## 2026-09-30 专属到期消费接口（P8 挂载）

本增量基于 main `dedd52c5`；仅修改 P7 owned 宿主、知识页和专属测试/本说明。
保留 Runtime checkpoint v2、真实来源回执与本地判断 Evidence 门槛。宿主没有执行循环、
轮询、任务库或模型进程，不调用 `runTask`，也不改变任务终态。下面接口需由 P8
接入共享 main / Runtime Application；本 PR 的局部通过不证明接线已生效。

1. 可信主对话持续兴趣证据仍调用 `consumeInterestSignal(signal, {deadline, signal})`，
   `signal` 中的 source/scope/evidence 来自已有宿主。外部 excerpt 不进 `task.goal`，
   不允许 Renderer 自报授权、来源版本或兴趣证据。一次搜索仍 `suggested`。
2. 已有合法公开低风险范围且 Laya 真正选中后，可在 request 附上
   `feedCheck: {checkId, runAt}`。仅结果为 `tracked` 时自动调用现有 Runtime schedule；
   返回 `result.feedCheck`，失败不冒充已注册。`runAt` 必须由可信 Runtime 调度策略提供，
   本宿主不推算下一次时间，不启动周期任务。
3. 显式注册为 `registerFeedCheck({checkId, runAt, subscriptionId, topicIds?})`。
   `subscriptionId` 必须等于每个消费者现有 `boundSource.sourceId`，省略 `topicIds`
   取这个来源的当前 tracked 消费者。当前 scope/expiresAt 必须有效。公开 Runtime
   `ScheduleInput` 不变；精确 schedule、subscriptionId、consumer revision、boundSource、
   scope 和期限写入同一 root task 的 `knowledge-watch-feed-check:<scheduleId 的 SHA256>`
   检查点，写后回读。相同 checkId 改输入或消费者返回 `REVISION_CONFLICT`。
   旧调用未提供 subscriptionId 且构造未配置默认 id 时仍可注册，`bound:false`；
   这种旧记录不能触发来源读取，需以新 checkId 注册明确绑定。
4. Runtime 原有 due 分发后，`getFeedCheckContext(taskId)` 只认**真实 fired schedule**、
   同一 taskId/idempotencyKey/conversation/goal，以及完整 durable 消费者绑定。
   不匹配返回 `null`。main 的 `task.created` 及启动恢复遍历均可用它路由；
   执行前读 `runtime.getTask`，已 running/终态/unknown 的任务不能重新提交或重跑。
5. Runtime Application 的受控 worker 调用
   `consumeFeedCheck(taskId, {signal: context.signal})`。这只执行 `feedCollect`，
   后者仍须使用已 prepare 的 `feeds.collect.execute(query, {taskId: rootTaskId, signal})`
   和现有 availability/授权门槛。返回 `accepted/reason/availability/notified/submitted` 与
   `taskId/scheduleId/subscriptionId`。任务 `succeeded` 只表示该 worker 完成来源检查；
   不能把它当语义重评或新版本已绑定。失败返回必须由 Application 映射明确错误，
   `feed_page_incomplete` 也不能写成完整来源检查成功。
6. 同一个 feed check 在途重复调用返回 `feed_check_in_progress`。取消、stop、pause/revoke、
   scope 变化、消费者变化会阻止迟到读取落入事实投影。注入 `readTrackingGrant` 时，
   读取前后针对每个 `{namespace, topicId, sourceId}` 重读准确 grant 的 id/revision/expiry。
   此处是重验已有授权，不是为每次公开读取新增审批。
7. 初始化 `start()` 后调用 `restoreFeedChecks()`，只列出既有 Runtime schedules，
   并恢复 pending 调度的取消责任。`cancelFeedChecks()` / `stop()` / `dispose()` 保留
   原有专属对话取消边界；不会取消他人的 schedules。暂停/恢复增加 consumer revision，
   旧 due 与旧重评任务不再恢复有效，恢复后需要新 checkId。

精确接线入口（伪代码中的 dispatch 函数需由 P8 在 Runtime Application 中提供）：

```js
// task.created / 启动恢复；只路由公开 Runtime 返回的 taskId。
const context = knowledgeWatchHost.getFeedCheckContext(task.taskId);
if (task.state === 'created' && context) {
  // Application 负责状态、deadline、取消、错误与 Evidence；main 不直接 runTask。
  dispatchKnowledgeFeedCheckTask(task.taskId, {
    consume: workerContext => knowledgeWatchHost.consumeFeedCheck(task.taskId, {
      signal: workerContext.signal,
    }),
  });
}
// 原有 RECHECK <workKey> 路由仍使用 getRecheckContext(workKey)、
// createProductionKnowledgeReevaluator({layaChooser: localLaya}) 和现有 checkpoint v2。
```

本宿主不提供伪成功的 dispatch 函数；P8 尚未挂载上述 Application 回调。
回调读到 `observed/unchanged` 与 `submitted` 以后，仍由既有真实 RECHECK 路径完成重评。
绑定动作仍由 `bindObservedRevision(topicId)` 严格校验准确 consumer/workKey/版本/hash/
citation/来源回执/判断 Evidence；`succeeded`、已读、系统已投递都不能代替它。

### 知识页动作与 P8 IPC

| UI 动作 | main 必须调用 | 含义 |
| --- | --- | --- |
| `knowledge.watch.refresh`，`{subscriptionId}` | `refreshSubscribedFeed(payload)` | 按 tracked source ID 串行读取，未变化不报更新 |
| `knowledge.watch.read`，`{id}` | `await markNoticeRead(id)` | 宿主时间记录用户已读，幂等；不修改 delivered/boundSource |
| `knowledge.watch.pause`，`{topicId}` | `await pause(topicId)` | 暂停并使旧 consumer 失效 |
| `knowledge.watch.resume`，`{topicId}` | `await resume(topicId)` | 恢复合法未过期关注；不重开撤销墓碑 |
| `knowledge.watch.bind`，`{topicId}` | 既有 `bindObservedRevision(topicId)` | 精确 v2/Evidence 读回后绑定 |

所有动作由 P8 在现有 Competition IPC 白名单接线，校验 payload，仅传规定字段，
`await` 后 `publish()`。UI 每次动作后回读 `knowledge.watch.status`，不先改本地事实。
`dialogue.items[].binding` 新增 `{ready, reason, taskState?}` 展示字段，只在宿主同步读回
准确 v2/Evidence 后 ready；绑定方法仍做完整异步重验。未知/不相关/不完整结果按钮禁用。
保留玻璃/CSS；不安全引用协议只显示文字，错误/外部字符串先转义。

`observeNotificationAcknowledgement(batch)` 仅由可信系统通知适配器提供真实 batch 回执。
用户界面不再调用 `knowledge.watch.acknowledge`，P8 应移除此 Renderer IPC 权限。
旧 IPC 不能继续接受 Renderer 提供的 `state:delivered`。已读通过 notice 的可选 `readAt`
保存于现有检查点，无公共 Schema/数据库迁移，也不创建另一份通知库。

### 引用限制与实际验证

未注入 v2 回执端口时，v1 单一 citation 仍只表示第一项 contentRef；多个不同
contentRef 返回 `feed_citation_ambiguous` 并保留旧来源头/绑定/任务。
已注入端口的多文章路径使用下述逐项引用；单一文章和同源多个 topic 仍按 consumer/workKey 绑定。

### 多文章来源回执 v2（P7 实现，P8 公共导出与接线）

P7 新增 `createKnowledgeFeedReceiptFromCollectResult({namespace, sourceId, result})`，
作为原始 `feeds.collect` 返回到 v2 的同一确定性映射入口。只接受 `fetched`、完整单页
（`hasMore: false`）、非空 items、准确 subscriptionId 和合法 validators；不接受 304 或
分页未完成结果作为新来源回执。存在原 record.accountRef/fetchedAt 时须与这次 collection
一致。沿用标题 200、摘要 500 字符截断、dedupeKey 排序、原内容哈希和 validator revision。
无法构造时返回 undefined；结构与映射通过不代表 HostTool/Policy 已执行。
P8 在公开 application exports 增补此函数；Host 注入端口包含它时直接复用，旧四函数端口仍兼容。
Runtime 应从实际 confirmed HostTool result 调用相同 helper，并将重建的 receiptId 与 root
来源回执准确比较，保留真实 task/run/argumentsDigest/query/result 与 receipt 的持久关联。
本增量定向验证：严格单文件编译、raw mapper 正向及十类失败路径 1/1、双 consumer
宿主/回执恢复使用该 mapper 1/1、host 语法和 diff check；没有重跑旧全套或真实模型。

`apps/runtime/src/application/knowledge-feed-receipt.ts` 提供纯确定性构造与验证。
沿用 feeds.collect 的五个条目字段和整页哈希，增加逐项
`citationItems: [{itemKey, contentRef, itemContentSha256}]`；receiptId 包含该映射。
每条 summary 记录原始标题、摘录、定位符和条目哈希，不把生成摘要作为来源内容。
多定位符页面的 citation 为内部 `knowledge-feed-citations:<hash>` 身份，不能作为网页引用。
主对话 answer 将它放入 citationBundleRef，citation 为 null；items/citations 各带原文、
自己的定位符和来源版本。知识页将每条摘录紧邻其对应引用显示，通知同样使用逐项引用。

P8 在 `@personal-agent/runtime/application` 公开导出以下四个函数，替换生产 evaluator
的手写 v1 来源校验，同时保留根任务、consumer/binding、授权、deadline、取消和 Evidence 门槛。
`verifyKnowledgeFeedReceiptBinding(raw, {namespace, sourceId, observedAt, revision,
contentSha256, citation, receiptId, summary})` 要求当前 context 精确一致；summary 为回执前 2000 字符。
main 通过 `knowledgeFeedReceipts` 注入以下同名函数，不经跨应用私有路径导入：

```js
knowledgeFeedReceipts: {
  createKnowledgeFeedReceipt,
  parseKnowledgeFeedReceipt,
  verifyKnowledgeFeedReceiptBinding,
  knowledgeFeedReceiptItems,
}
```

旧 v1 单文章回执保持可恢复；旧 v1 多文章回执保持结构可读，但不能提升为当前事实。
不覆写旧 unknown 工作或已有回执；获取 v2 需合法的新采集与重评上下文。
来源头缺失回执字段时只从同一根任务、准确 source/revision/hash/time/citation 的唯一
持久 context 恢复映射，不能用别的根任务或模型声明替代。篡改映射/摘录/哈希、缺定位符、
来源或版本不匹配均拒绝。重评结果仍沿用既有 v2/Evidence，未修改公共请求 Schema 或数据库迁移。

本增量局部验证：单文件 TypeScript 严格编译；回执测试 3/3，覆盖逐项映射、篡改拒绝和 v1 恢复；
宿主/展示测试 2/2，覆盖两个 consumer、合成 judgment/Evidence 门槛、检查点恢复与逐项引用转义。
宿主测试直接注入该纯 helper，仅为离线组合夹具；P8 公共导出及实际生产 evaluator 接线尚待读回。
此次没有重跑浏览器、模型或 Desktop 冒烟，真实 RSS/用户会话/Laya/AgentArts 仍未验收。

局部验证：新增 due/取消/暂停恢复/准确 grant/已读/v2 门槛 8 项离线端口测试；
既有相关 5 项测试；两个 owned JS 的语法检查和 `git diff --check`。
知识页使用已有 Playwright 和已安装 Chrome、1100×1050 合成 fixture 实际渲染，
检查来源 ID、已读/系统投递分离、暂停/恢复/撤销、绑定按钮门槛、注入转义与无控制台错误。
渲染测试显式 `PA_KNOWLEDGE_UI_TEST=1`；可用 `PA_KNOWLEDGE_UI_BROWSER` 指向已安装浏览器，
默认测试不会安装或下载浏览器。它不是 Electron/Live/真实 RSS/Laya/AgentArts 端到端验收；
未启动模型、未改 Live/SIS 配置，P8 统一接线与整体验收仍待完成。

取消链补充：due worker 的 signal 和精确绑定重验贯穿来源消费、workPort read/submit、
来源/提醒落盘及通知前后；每次 await 后、下一提交和同步落盘前再次检查。
已经开始而回执未确认的提交/投递保留 unknown，不在取消后盲重试。
通知发送资格在持久记录锁内从最新 notice 原子领取；并发消费只允许一次 send，
已领取的其他消费只能读回或跳过，迟到的读回不会覆盖已确认投递。
新增单项并发回归覆盖两个来源消费同时领取同一 notice，确认 send 次数为 1；通过。
新增单项局部回归覆盖 feed 返回后 read/submit 挂起再取消两种情况，通过；
仅运行这项和宿主语法/diff 检查，没有重跑上述浏览器或旧测试。

## 初始化和生命周期

挂载位置在 `apps/desktop/electron/main.js`：`const namespace = desktopHost.userNamespace` 且 `runtimeApplication` 已赋值之后，与 `feedsHost.bindApplication(runtimeApplication)`、`feedsHost.prepare()` 同一段。退出释放放在现有 `feedsHost?.close()` 之前。下面使用的都是该文件里已经存在的对象；`watchTask` 和 `collectTool` 是这两次调用的返回值，不是预先存在的全局变量。

```js
import {createKnowledgeWatchHost, knowledgeWatchConversationId} from './knowledge-watch-host.js';

const watchTask = runtimeApplication.runtime.submitTask({
  goal: '保持关注事项检查点',
  conversationId: knowledgeWatchConversationId(namespace),
  idempotencyKey: `knowledge-watch-checkpoint:${namespace}`,
});
const collectTool = feedsHost?.tools.find(tool => tool.descriptor.name === 'feeds.collect');
const knowledgeWatch = createKnowledgeWatchHost({
  profile: 'huawei_ict_agentarts',
  namespace,
  checkpointTaskId: watchTask.taskId,
  checkpoints: runtimeApplication.runtime,
  now: () => Date.now(),
  layaChooser: localLaya,
  runtime: runtimeApplication.runtime,
  feedCollect: collectTool
    ? (query, signal) => collectTool.execute(query, {taskId: watchTask.taskId, signal})
    : null,
});
knowledgeWatch.start();
```

顺序：

1. 恢复：再次启动时用同一个 `idempotencyKey` 调用 `submitTask`。Runtime 返回已经存在的任务，不新建第二份。随后 `loadCheckpoint` 读回关注、墓碑、来源头、`feedCursor` 和未完成提醒。
2. `feedsHost.prepare()` 后才能找到 `feeds.collect`。用户是否允许本会话读取，仍走现有订阅设置里的 `authorize` / `revoke`。宿主不代用户打开许可。
3. `knowledgeWatch.start()`。重复调用直接返回快照，不会再登记一次 `subscriptions`。`start` 不创建调度，也不读网络。
4. 若要排一次检查，调用 `registerFeedCheck({checkId, runAt})`。它调用 `createSchedule`，输入来自 `knowledgeWatchScheduleInput`。同一个 `scheduleId` 配不同输入时，Runtime 抛 `REVISION_CONFLICT`，宿主返回该 `code`，不另造一条。`missedRunPolicy` 固定 `run_once`。宿主不计算下一次运行时间。
5. 进程重启后调用 `restoreFeedChecks()`，它只 `listSchedules`。到期分发仍由 Gemini 已有的 Runtime tick 调用 `dispatchDueSchedules` 或 `recoverMissedSchedules`。分发成功后，用订阅 id 调用 `refreshSubscribedFeed({subscriptionId})`。
6. 兴趣：`consumeInterestSignal(signal, {deadline, signal})`。`deadline` 和 `signal` 都要有，否则在需要模型时抛 `INVALID_ARGUMENT`。宿主把调用方信号和自己的停止信号合成一个 `AbortSignal`。
7. 撤销：`revoke(topicId, {id, revokedAt})` 同步写入墓碑。暂停和恢复是 `pause` / `resume`。唯一可以带用户重新开启的入口是 `enable(signal, enablement)`。
8. 停止：`stop()` 增加代际、中止在途信号、调用订阅的取消函数。若本实例登记过调度，再 `reconcileSchedules(conversationId, [])`，只取消本对话里仍为 `pending` 的调度。对话里若有不属于 `knowledge-watch:<namespace>:` 的调度，返回 `scheduler_conversation_not_exclusive`，不取消。
9. `dispose()` 调用 `stop` 并拒绝再次 `start`。它不调用 `localLaya.stop`，也不 `runtimeApplication.close`。退出时先 `knowledgeWatch.dispose()`，再执行现有的 `feedsHost?.close()`。

和 P5 共用模型时，进程归属仍是 `laya-local-host.js` 的 `localLaya`。本宿主只在 `choose` 期间借用它。`localLaya.snapshot().ready !== true` 时，现有 `choose` 抛 `本地 Laya 决策尚未就绪`，本次兴趣消费失败，已保存的关注不变。不要为 P7 再启动一个 Laya。

## 关注、来源和通知怎么走

一次提问保持 `suggested`（待建议），不调用模型。持续的公开低风险证据先由 `buildInterestOptions` 得到 `watch_public`，再由 `LayaInterestDecisionService.choose` 选择。只有 `outcome === "selected"`、`requiresHostRevalidation === true`，并且选中的 `track_public` 仍在当前选项里，才可能变成 `tracked`（已跟踪）。选择端口缺失时原因是 `decision_port_missing`，不是自动跟踪。

低风险公开跟踪沿用信号里的 `scope.publicLowRiskTracking`，授权投影是 `{basis: "existing_public_low_risk_scope"}`，没有默认的 `allowed: true`。`requestsScopeExpansion`、私有或高风险才调用 `AuthorizationPolicy.authorize`。成功时返回的 `scopes` 必须覆盖 `policyScopes`，原因记为 `authorized`。抛错时 `allowed: false`，原因用错误上的 `code`（例如 `UNAUTHORIZED`）。策略允许也不能越过兴趣政策把高风险来源变成跟踪。

`tracked` 会记下 `boundSource`（来源 id、版本、`contentSha256`、缓存版本、最近成功检查、有效期）、`scope`、`expiresAt`、`modelReceiptId` 和撤销所需的主题 id。

回执持久化审计：`writeWatch` 将 `choice.receipt.modelReceiptId` 写入关注记录，随后整份关注检查点由 Runtime 保存；读取时 `readableCheckpoint` 不会裁掉该字段，`projectWatch` 和对话投影也会保留它。此前真实 Laya 的 SQLite 重启输出只打印了状态与 `withheld` 原因，没有打印 `modelReceiptId`。因此现有代码路径指向记录输出遗漏；由于那次临时库和字段级读回没有保留，不能声称已核实那个具体回执的重启读回值。

`refreshSubscribedFeed` 读 `FeedService.collect` 的公开结果：

- `collection.state === "fetched"` 且 `hasMore === false`：用公开条目的 `dedupeKey`、`occurredAt`、`contentRef`、`title`、`summary` 计算内容摘要。版本是校验器 `{etag, lastModified}` 的摘要；两个都为空时，版本只来自这份正文摘要。比较只用相等，不按字符串大小判断新旧。引用用条目自己的 `contentRef`，不复制订阅 URL。
- `unchanged`：这是条件请求的未变化结果，不是空的首次运行。没有先前正文摘要时返回 `source_body_not_read`，不编造哈希。
- `hasMore === true`：只保存 `nextCursor` 到该来源的 `feedCursor`，原因 `feed_page_incomplete`，不宣告新版本。
- `TIMEOUT`、`EXTERNAL_FAILURE`、`RATE_LIMITED`：`source_transient_failure`。不改关注，不把检查点当首次运行。
- `NOT_FOUND`：按撤回交给现有来源消费。
- 结果缺字段：`invalid_feed_result`，不写版本。

来源版本变化只重评绑定该旧版本的事项。其他来源上的关注保持原绑定。工作项的幂等键是计划返回的 `workKey`。`submitTask` 的输入固定为 `{goal: "RECHECK <workKey>", conversationId, idempotencyKey: workKey}`。提交前先 `findTaskByIdempotencyKey`。已经有任务就记下 `taskId`，不再提交。读或写结果不明时保持 `unknown`，不把重评检查点写成已提交，也不发提醒。

用户撤销若发生在读取或提交期间，提交前会再看墓碑和 `tracked` 状态。已经撤销的事项不提交。已经进入 Runtime 的幂等记录不会被删除后再提交一次。

提醒只在回执 `delivered === true` 且 `receiptId` 非空时标成已投递。`NotificationService.drain()` 给出的 `ready_for_delivery` 只记下批次 id，原因 `awaiting_acknowledgement`，`delivered` 仍为 `false`。桌面现有确认路径调用 `acknowledge(batchId)` 后，把返回的批次交给 `observeNotificationAcknowledgement`。只有 `state === "delivered"` 且 id 匹配才完成。该确认表示投递已完成，不代表用户已读；当前没有用户阅读状态端口。未确认的事项留在 `listPending().notices`，不会被删掉。没有引用定位符的提醒原因是 `citation_missing`，同样留在待处理里。

来源摘要只放进带“不可信数据”字样的提醒，不改变授权、模型或工具。私人笔记和邮件不在这条 RSS 路径里，宿主不因为关注更新而发送它们。

## 主对话结果投影

`dialogueProjection()` 与 `snapshot().dialogue` 是同一份只读投影。检查点不可读时，`dialogueProjection()` 抛 `CHECKPOINT_UNREADABLE`，`snapshot().dialogue` 为 `null`。它不写检查点，也不把来源正文当成授权。

每条 `items[]` 里，主对话只消费 `answer`：

- `kind: "current_fact"`：`decideKnowledgeFreshness` 的动作是 `use_cache`，绑定版本和来源头一致，引用定位符存在，且该来源没有 `unknown` 提交。字段是 `sourceId`、`sourceRevision`、`contentSha256`、`fetchedAt`、`citation`。
- `kind: "latest_observation"`：来源已经读到新版本，旧绑定不能再当成当前事实。`boundRevision` 是仍绑定的旧版本，`sourceRevision` 与 `citation` 属于这次观察。
- `kind: "withheld"`：`reason` 为 `suggested_only`、`citation_missing`、`submission_unknown`、`user_revoked`、`user_paused`、`watch_expired`，或新鲜性决策自己的 `reason`（例如 `source_unavailable`、`content_changed`）。

`usableAsCurrentFact === true` 只出现在 `current_fact`。`update.untrustedExcerpt` 的 `dataClass` 是 `untrusted_source_text`，不要放进 `task.submit` 的 `goal`。现有主对话入口是 `apps/desktop/electron/main.js` 的 `task.submit`，它调用 `submitConversationTask(client, {goal, conversationId})`，没有单独的上下文字段。

投递确认、完成重评和绑定新版本是三件不同的事：

- 投递确认：`observeNotificationAcknowledgement({id, state: "delivered"})` 只把匹配 `receiptId` 的提醒标成已投递，不是用户阅读回执。`latest_observation` 不会因此变成 `current_fact`。
- 任务状态：Runtime `findTaskByIdempotencyKey` 返回的 `state === "succeeded"` 只证明 Runtime 任务进入成功终态。`submitTask` 刚创建时状态是 `created`；宿主会按原幂等键读回，不重新提交。
- 重评结果：Runtime `knowledge-recheck-result` v2 必须与原 `workKey`、taskId、namespace、consumer revision、旧绑定、观察 revision/hash/time、citation 和 source-read receipt 一致；还必须读回 `knowledge-recheck-judgment`。普通 `succeeded`、只有非空 evaluation、只有 citation、错任务或缺一份持久回执都会返回 `reevaluation_result_unavailable`。
- 绑定新版本：`bindObservedRevision(topicId)` 会再次核对当前 `tracked` consumer、有效期、旧来源绑定、最新观察头、feed receipt、Runtime taskId 和判断回执。只有 `relevant_update` 才更新 revision/hash/lastSuccessfulCheck；`not_relevant` 返回 `reevaluation_not_relevant` 并保留 latest observation。`validUntil` 不延长，因此已过期来源不会因重评成功重新变成 `current_fact`。

`bindObservedRevision` 在任务未完成时返回 `reevaluation_unconfirmed` 和实际 `taskState`；已跟踪关注缺少对应 consumer 时返回 `reevaluation_consumer_missing`；任务与已持久接受的 `taskId` 不一致时返回 `reevaluation_task_mismatch`；缺少结构化重评或持久回执时返回 `reevaluation_result_unavailable`；有效判断为 `not_relevant` 时返回 `reevaluation_not_relevant`。过期关注返回 `watch_expired`；已经绑定返回 `already_bound`；撤销后返回 `user_revoked`。

## 状态投影

`snapshot()` 含 `namespace`、`running`、`disposed`、`health`、`wiring`、`checkpointKey`、`mountedInMain`、`watches`、`notices`、`submissions`、`sources`、`dialogue`。损坏时后五项为 `null`。

关注状态：`suggested` 待建议、`tracked` 已跟踪、`paused` 暂停、`revoked` 撤销、`expired` 过期、`source_unavailable` 来源不可用、`authorization_required` 待授权。

`listPending()` 返回待建议、待授权、来源不可用、暂停，以及未投递提醒和 `unknown` 提交。`listWatches()` 在检查点不可读时抛错，不返回空数组。

`wiring.source` 为 `feeds`、`injected` 或 `unavailable`。`wiring.layaChooser` 表示宿主自己包了 `LayaInterestDecisionService`。`wiring.main` 恒为 `false`。

## P8 总装接线

`main.js` 用 `knowledge-watch-root:<namespace>` 作为持久检查点任务，创建 `createKnowledgeWatchHost` 时注入实际 `feedsHost.tools`、`competitionToolAvailability` 授权检查和已存在的 `localLaya` 单例。`feedCollect` 仅在 `feeds.collect` 已注册且任务级会话授权仍有效时调用 `execute(query, {taskId, signal})`；未授权、来源不可用、未读到完整页面或本地 Laya 未就绪时不生成可绑定结果。

完整 `feeds.collect` 页面读回后，宿主将规范化的来源身份、revision/hash、观察时间、citation 与标题/摘要摘要持久化到 Runtime root-task checkpoint `knowledge-watch-source-read:<receiptId>`，并立即读回校验。变化任务只保存该 receipt 的 taskId/id；Runtime 再校验 receipt 内容、散列和原 source/consumer 绑定。未授权或 `unchanged` 条件响应不会制造新来源正文或延长原 `validUntil`。

正式重评按原绑定的 `cacheVersion`、`lastSuccessfulCheck`、`validUntil` 和观察时间运行 `planKnowledgeReevaluation`；变化版本的语义相关性由已存在的本地 `localLaya.choose` 端口从 `relevant_update` / `not_relevant` 两个合法候选中选择。不得把规划结果等同语义判断；弃权、review、取消、超时或不匹配都保留 `latest_observation`。

Runtime 检查任务的 `workKey`、namespace、conversation、topic/consumer revision、旧绑定和 feed receipt；await 后重新读回当前 P7 context、来源 receipt、取消和 deadline。只有 `local_laya` 判断回执与 feed receipt 都有效时才保存 `knowledge-recheck-result` v2、`knowledge-recheck-judgment` checkpoint，并在任务 Evidence refs 中引用这两个持久检查点。citation 只是定位符，不计作证据。P7 最终再次核对当前来源头、consumer、taskId 和两份回执；`relevant_update` 才能绑定观察版本，`not_relevant` 保持最新观察并拒绝绑定。绑定仅更新 revision/hash/lastSuccessfulCheck，不延长 `validUntil`。

`dialogueProjection().items[].answer` 是桌面可消费摘要。Runtime TaskSnapshot 中的 checkpoint 引用是本地可读回的受信执行记录，但当前接口目录仍将通用 `EvidencePort` 标为 unavailable；不得将这些引用宣称为通用/云端 EvidencePort 已冻结或生产可用。Feeds connector 只提供受限标题/摘要，不等同读取文章全文。标题、摘要、citation 均是不可信来源数据，不进入 task goal 或授权决策。

## 已验证和未验证

此前宿主单测曾有 15 项通过。本轮只运行受影响的单项检查，不重跑整组测试。此前“任务 succeeded 后绑定”的 Fake 断言现已改为：投递确认不表示已读；错误目标和 taskId 不匹配的任务不会被接受；更晚的观察不会被旧通用任务绑定；默认 Runtime 适配和注入式 `workPort` 即使都读回普通成功状态，缺少结构化重评结果时仍保持旧绑定和非 `current_fact`。受影响单测 1 项通过，`git diff --check` 通过。SQLite 重启复验未运行：此隔离 Desktop 工作树缺少 `@personal-agent/runtime` 安装入口，定向加载时报 `ERR_MODULE_NOT_FOUND`；没有因此安装依赖或构建共享 Runtime。此前其余测试覆盖偶然提问、持续跟踪、撤销、重复与乱序、损坏检查点、丢失提交和停止。此前端口适配覆盖：

- 真实 `LayaInterestDecisionService` 包住一个选择器双份：持续兴趣才调用模型形态的 `choose`，弃权不跟踪。没有启动 Laya 进程。
- 合成的 `FeedService.collect` 结果：只影响绑定该来源的关注；`unchanged` 不重复提交；`TIMEOUT` 不把文档当成首次运行。这不是真实网络变化。
- 版本字符串 `"2"` 可以替换更早观察到的 `"10"`，因为它们只是不同身份；更早的 `fetchedAt` 不会覆盖。
- `submitTask` 成功落账但响应丢失后，`findTaskByIdempotencyKey` 能对上，提交次数保持 1。这是内存双份，不是 Runtime 的 sqlite。
- `ingest` / `drain` 的 `ready_for_delivery` 不会标成已投递；`observeNotificationAcknowledgement` 只接受 `state === "delivered"`，这不是用户已读状态。
- 撤销发生在 `read` 返回之前时，`submit` 不会被调用。
- `createSchedule` 相同输入不产生第二条；`stop` 通过 `reconcileSchedules` 取消本对话的 pending 调度。
- `AuthorizationPolicy.authorize` 覆盖范围时记录 `authorized`；抛 `UNAUTHORIZED` 时 `allowed` 为 false。
- 主对话投影：一次提问的 `answer.kind` 是 `withheld` / `suggested_only`。跟踪建立后、还没有引用时是 `citation_missing`。合成 `FeedService.collect` 结果变成 `latest_observation`，`usableAsCurrentFact` 为 false，旧 `boundRevision` 仍是 `source-v1`。同一版本再读不增加 `submitTask`。撤销后投影保持 `user_revoked`，重启读回同样状态。来源摘录里的指令文本没有进入 `answer`，也没有改变 `authorization.basis`。

一次真实公开来源读并读回：用已构建的 `HttpFeedProvider` 和 `FeedService` 读取 `https://hnrss.org/frontpage`，经 `refreshSubscribedFeed` 进入宿主。兴趣选择器是双份，没有启动 Laya；检查点在内存，不是 Runtime sqlite。一次提问为 `suggested`，持续兴趣为 `tracked`。一页收集返回 `observed` / `available`，`notified` 为 true，`submitTask` 1 次。`answer.kind` 为 `latest_observation`，`usableAsCurrentFact` 为 false，`boundRevision` 为 `interest-binding`，`citation` 是该页条目的公开 `contentRef`。新建宿主读同一检查点后，引用和 `tracked` 状态一致。没有修改订阅，没有发通知，没有上传私人数据。这不是桌面会话授权后的 `feeds.collect`。

`feeds.collect` 的工具契约是 `execute(query, {taskId, signal})`，返回 `FeedService.collect` 的 `{items, collection, nextCursor, hasMore}`。宿主的 `feedCollect(query, signal)` 直接消费这个返回值；取消沿用传入的 `signal`。桌面包装在会话未 `authorize({readAndCloudConsent: true})` 或任务绑定改变时抛 `订阅读取许可已撤销或任务绑定已改变`，宿主记为 `source_unavailable`。本隔离工作树没有这层受信会话，所以没有把直接调用 `HttpFeedProvider` 当成正式工具路径。总装验收时用已经 `prepare` 和 `authorize` 的 `feedsHost.tools` 调用一次 `refreshSubscribedFeed({subscriptionId})`，再读 `dialogueProjection()`。

真实 Laya：通过 `createLocalLayaHost` 和 `layaChooser` 做了一次持续兴趣判断，随后停止进程。一次偶然提问保持 `suggested`，模型调用 1 次。公开返回 `state: "review"`、`selected: "review_public"`、`reason: "uncertain"`。宿主投影保持 `suggested` / `withheld` / `suggested_only`，没有改成 `tracked`，也没有创建重评任务。同一 SQLite 关闭后重建，读回仍是这个待建议状态。关闭前回执存在于内存投影；重启记录只打印了状态和 withheld 原因，没有打印回执 id。代码路径审计显示检查点与投影会保留该字段，但这次临时库没有保留字段级读回，具体回执的 SQLite 重启值仍未证实。

既有临时 SQLite 恢复实验使用 `TaskRuntime`、双份兴趣选择器和 synthetic 来源事件。它验证过关注、提醒、检查点、撤销和重复事件的持久化。实验 harness 随后手动调用 `runTask` 将通用 `RECHECK <workKey>` 任务推进到 `succeeded`，旧宿主据此绑定并投影 `current_fact`；这只验证了任务状态门槛，不能证明该任务实际重评了哪一版来源。按本轮收紧后的宿主行为，这种成功状态现在返回 `reevaluation_result_unavailable` 并保持旧绑定。该实验临时库没有保留；不把它记为正式重评验收。

此前未由总装验收的项目包括：`main.js` 替换旧构造、桌面会话授权后的 `feeds.collect`、界面上的投递确认按钮。UI 可复用现有宿主方法；绑定新版本仍需上述可信 Runtime 重评结果接口，不得用按钮或任务成功状态替代。

## P8 当前复验状态

- 当前实现位于隔离分支 `codex/zemeng/p8-shared-assembly`。`main.js` 复用宿主导出的 `createProductionKnowledgeReevaluator`，避免生产逻辑与测试副本分叉。
- 定向纵向测试通过 `FakeFeedProvider` 和合成 Laya chooser 检查生产 evaluator、来源/consumer 重验、Runtime source-read 与 judgment checkpoint 读回，以及 P7 绑定。该结果仅为 conditional，不代表真实订阅网络、真实 Laya 或桌面用户会话已验收。
- feeds connector 当前只提供条目标题、摘要和定位符；它不返回文章全文。checkpoint 引用也只代表本地 Runtime 记录，不能替代通用 EvidencePort。
- 真实 Electron、F9 用户审批、新空白 Notepad 目标读回和持久 Evidence 验收仍须单独完成；真实 Laya 启动受 2 GiB 空闲内存门槛限制时保持未验证，不得降低门槛。
