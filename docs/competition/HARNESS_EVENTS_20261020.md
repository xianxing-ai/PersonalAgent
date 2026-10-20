# H6：原生 harness 主动事件消费

Profile：`huawei_ict_agentarts`。Owner：zemeng5208。当前为源码实现／接线阶段，接口 provisional。

`apps/runtime/src/application/harness-events.ts` 消费原 `RuntimeProactiveWorkflowHost` 的持久 entries，
不创建新的事件队列、来源注册表、调度器、数据库或模型执行循环。原 confirmed source router 经
`host.eventSink.persist` 写入来源事件；原 Scheduler 经 `host.ingestWake` 写入已触发的 wake。
H6 订阅同一个 host，逐来源实体、版本与变化类型去重；原 sink 与来源游标提交关系不变。

工厂 `createRuntimeHarnessEvents(options)` 返回 `start/flush/stop/reconcile/inspect`。
`start` 扫描已有原 entries 并订阅新事件；`stop` 持久化停用、解除订阅及取消在途等待。
调用方重建后须明确 start，不从构造函数启动工作。原 Runtime atomic host state 只记录生命周期与
pending/confirmed/suppressed 投递回执，来源正文继续保存在原 host；这里没有新的待办来源库。

每条事件由受信组合的 `resolveAnchor(event)` 从原持续责任与 sourceTaskId 解析：
`{sourceTaskId,parentTaskId,deadline,responsibility}`；responsibility 复用原
`Omit<ProactiveResponsibility,'proof'>`。固定父锚点不能代表整个应用的全部会话。
`assertCurrentAuthorization(anchor,event,context,mode)` 必须读回原责任 revision、来源版本、
原始用户引用、scope、tracking lease 和 Policy；mode 区分 dispatch 与仅读已有结果的 readback。
`readControl` 的 enabled/quiet/revision 仅为受信偏好，不授予权限。所有实际工作仍经原
Runtime user-work 子智能体及 Policy/ToolGateway。

`delivery.consume({deliveryId,eventDigest,anchor,event},context)` 由 H1 原组合实现；
`readReceipt({deliveryId,eventDigest,anchor},context)` 只能读同次原操作。
回执为 `{deliveryId,eventDigest,taskId,parentTaskId,receiptRef}`。消费者验证原 child 的
`subtask-parent` 和原 conversation；它只确认投递受理，不修改主／子任务终态。
原父 root 已完成时，H1 可在原责任权限与原 conversation 创建新交互／委派轮，禁止重开旧终态。
新 root 必须先保存 `harness-event-origin`，内容严格为
`{deliveryId,eventDigest,sourceTaskId,originalParentTaskId}`；H6 会独立核对。

投递前先存 pending。异常、取消、deadline 或丢失响应均保留 pending；重启只查原 receipt，
不会再 consume。过期事件可通过显式 reconcile 在新的只读请求期限内核实原回执，不延长原执行权限。
quiet/disabled/expired/cancelled 在首次处理时保存 suppressed，之后不补发；scope 撤销或版本漂移拒绝。
外部异常仅投影固定错误码，不返回正文或凭据。

## 生产接线责任

H6 独占新 consumer、`harness-event-delivery.ts`、对应测试及本文。H1 独占 RuntimeApplication/subagent-host 与公开 application export；
H2 独占 Desktop main/settings。已向主控交付上述准确端口，由原 owner 在创建原 host 后装配 H6、
提供实际来源／责任授权与原 user-work 消费器，并绑定启动、关停和 native control 更新。
现有 host 的 controller port 只接收 child report，不能把来源事件冒充 child report。
共享接线未读回前，不把本 consumer 宣称为完整产品链或真实平台验收。

`createRuntimeHarnessEventDelivery` 已实现 consume/readReceipt glue。H1 仅提供
`submitHarnessEventTask(input: SubmitTaskInput & {deadline:string;origin:HarnessEventOrigin}): TaskSnapshot`，
使用现有 `submitTaskWithCheckpoint` 在 root 入队前持久 origin，再沿原 enqueue。
同 deliveryId 固定为 `harness-event-root:` idempotency key。helper 验证原 required-user-work 委派绑定及
canonical 子任务，root 仅受理而尚无子任务时保留 RESULT_UNKNOWN；下一次只查原 child，不重新 submit。
H1 原派发／完成通知需唤起 flush；不增加轮询。
投递工厂允许 `runtime: () => application.runtime` 延迟读取；构造时不访问尚未初始化的 Runtime。
H2 锚点读取位置为 `host.inspect().application.state.responsibilities[id]` 与原 `sourceQuotes`；
原 host 的 quote 以 `messageId=sourceTaskId`、`quoteRef=runtime:task:<id>:goal` 和原 goal SHA 绑定，
应读原任务核对，而非从事件自报 parent/authorization。wake 还须匹配原 `state.schedules`。
新 root 的期限取当前有效责任/lease、事件过期和原持续 host 上限之交，不读取历史 source root 的旧 deadline；
已过期 host 自身不能因新投递被延长，须由原生命周期策略处理。

## 本次验证范围

按用户当前“优先全部源码与接线，最后统一测试”的要求，不安装依赖、不运行完整测试、全仓 check 或重复构建。
新增四条 fixture 覆盖终态父的同会话新轮、去重、unknown 重开只读、quiet 不重放、版本漂移与撤权；
fixture 尚未执行。通过现有 TypeScript transpileModule 的源码语法诊断及 Node --check；
工具进程 Node v26.3.0，只用于语法检查，不代表项目要求的 Node 24 运行验证或完整类型检查。
首个检查脚本在 Windows ESM 导入使用绝对盘符路径失败（ERR_UNSUPPORTED_ESM_URL_SCHEME），
改为标准 file URL 后语法检查成功；没有更改产品依赖。不能以新增测试文件视为通过。
未调用真实云、模型、业务账号或设备，不改变平台冻结或发布状态。

## 2026-10-20：原生调用方顺序修复与启动前纯读取

H2 接入发现，先读 grant 再处理 quiet/disabled 会漏记 suppressed，旧失效 entry 也会阻塞后续事件。
现逐 entry 先验证原持久结构、身份、版本与 digest，再将 native quiet/disabled/host paused、过期与取消
原子记录为 suppressed；无须让失效 grant 假通过。可投递事件才核原锚点与权限，明确撤销／不可用
记录固定 authorization_denied，之后启用也不回填。结构损坏记录限于原 entry 的拒绝 tombstone。
每条失败隔离；已经调用 consume 的 pending 保留，只能读原回执。

新增 host-only `manager.readOriginalDelivery(origin)`，精确读取原 host/session 与 Runtime ledger，
返回 `HarnessOriginalDelivery` 的原 event、anchor、control、deadline、ledger state/revision 和
同步 `assertCurrent`。这些只读信息及 fence 供 H2 组合当前配置／权限，再由 H1 对同一 created root
做已证明尚无 attempt 的原首次续排；H6 不创建替代 root，也不重新 consume。
正常 shutdown 的 lifecycle.running=false 不代表用户撤权；纯 reader 读取 lifecycle revision/running
并纳入 fence，以当前 enabled/quiet、有效原权限及 admitted controlRevision 精确相等为准。
显式停用／暂停／再次开启产生新 control revision 时，旧 pending 不能用于首次续排或历史回填。
H1/443 仍只允许 pending、created、无 cloud/tool attempt 的原 root；confirmed 只供读回，不能重新入队。

启动阶段尚无 live host 时，`readPersistedRuntimeProactiveWorkflow(runtime,taskId,sessionId)`
在原持久模块封装 application/session key，读取原 TaskRuntime atomic state；
`readPersistedHarnessOriginalDelivery(options,origin)` 组合相同证据和当前授权／偏好。
无 host constructor、adapter.describe、网络、签名、调度或状态初始化；缺原 session 或 ledger 不补造。
读取的是本机原持久记录，不把读取操作本身视为平台签名重新验真。只供 trusted host，不返回 Renderer 或模型目录。

新增一条针对性组合回归已在 Node v24.19.0 运行，1/1 通过；覆盖 quiet 下失效 resolver、撤权后不回填、
损坏旧 entry 后的新事件、unknown 保留与只读 origin fence。使用当前源码的隔离 transpile，
contracts 使用原已存在产物，未安装／重建其他 workspace。
隔离工具首轮 NodeNext 缺 package 上下文生成 CommonJS，导入 named export 失败；
改为显式 ESM 后单例通过，此工具修正没有更改产品模块语义。
随后追加的静态 startup reader 仅检查 TypeScript 语法及 Node --check，未扩大测试。
最后按新增 shutdown 恢复要求扩展同一单例并补跑 1/1，覆盖 running=false 的只读恢复证据、
lifecycle revision fence 和显式 control revision 改变后拒绝旧 pending。该单例不调用静态 startup reader；
隔离装载器对这个未测入口注入显式抛错替身，不能据此声称静态 reader 或整图通过。
旧四条 fixture、完整类型检查、H1/H2 生产装配和统一验证仍待执行，不以此单例完成整个 H6 验收。
