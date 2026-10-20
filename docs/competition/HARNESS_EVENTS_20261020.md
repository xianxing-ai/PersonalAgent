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

## 本次验证范围

按用户当前“优先全部源码与接线，最后统一测试”的要求，不安装依赖、不运行完整测试、全仓 check 或重复构建。
新增四条 fixture 覆盖终态父的同会话新轮、去重、unknown 重开只读、quiet 不重放、版本漂移与撤权；
fixture 尚未执行。通过现有 TypeScript transpileModule 的源码语法诊断及 Node --check；
工具进程 Node v26.3.0，只用于语法检查，不代表项目要求的 Node 24 运行验证或完整类型检查。
首个检查脚本在 Windows ESM 导入使用绝对盘符路径失败（ERR_UNSUPPORTED_ESM_URL_SCHEME），
改为标准 file URL 后语法检查成功；没有更改产品依赖。不能以新增测试文件视为通过。
未调用真实云、模型、业务账号或设备，不改变平台冻结或发布状态。
