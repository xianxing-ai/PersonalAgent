# Live 后台结果公开端口交接提案

状态：**proposed，尚未实现或注册**。生产事实基线为 #406 `2e45faa5885ed5370eaa654aa0802f79f7c69450`，目标 profile 为 `huawei_ict_agentarts`。本交接只新增说明，不修改 ModelGateway/Provider、Runtime、Host 或 Renderer，不提升当前接口冻结或真机验收状态。

模型公开契约与 Provider 由 `goo122` 维护；Electron main/Live Host 的可信消费由 `zemeng5208` 负责；Renderer 工程与页面仍归 `2511375597-lab`。以下 API 名称和形状是供双方确认的最小方案，不表示仓库已导出这些符号。

## 当前生产事实与缺口

主文字请求由受信 parent 自动派发原 `user-work` child；实际处理完整请求的文字模型在该 child 中读取原完整业务 Schema，经原 Policy/ToolGateway 执行。Live `request_work` 同样向原 UI conversation 提交 Runtime Task，不直接执行业务。原任务、确认与结果可通过 `read_context` / `wait_for_task` 续接，关闭语音不取消后台任务。

Live 启动的 `history.context` 已合并可信 `readContext` 中的文字消息/任务与 Live 恢复历史；不是另开一份孤立对话。完整注册 Schema 支持 32000 字符内分页，但目录可见不代表本次就绪、出机许可或业务授权。

当前主动播报的实际缺口：

| 位置（基线行号） | 当前行为 |
| --- | --- |
| `packages/models/src/realtime.ts:11`，`RealtimeSession` | 仅 `sendAudio`、`interrupt`、`close`、可选 `askUserQuestion`，没有后台结果投递端口。 |
| 同文件 `:137`、`:196`～`:204` | 工具结果写入原 `function_call_output`；只有 `call.turn === turn` 才发起续答。打断递增 turn，旧轮结果不会主动触发新轮播报。 |
| 同文件 `:291` | `askUserQuestion` 专门注入“当前待确认问题、等待真实回答”，且有未返回 call 时拒绝。不能用它伪装任务结果。 |
| `packages/models/src/agentarts-realtime.ts:113` | AgentArts Gateway 委托同一个原生实时实现，没有另一结果推送接口。 |
| `apps/runtime/src/application/runtime-application.ts:1319` | `createLiveVoiceModel` 只透传原 Gateway `connect`，没有独立可绕行的播报入口。 |
| `apps/desktop/electron/main.js:1202`，`pumpEvents` | 原终态事件更新任务/UI；没有向 Live 投递后台完成结果。120 秒本地等待先返回 pending 后，后续完成仍需原任务续读。 |

另一个已知约束是 `realtime.ts:206`：已发送 `response.create`、尚未收到 `response.created` 时打断，会明确关闭本次 Live 并保留后台任务。该响应归属问题不应在 Host 猜测，也不是本提案顺带删除的保护。

## 建议 goo 提供的最小可选端口

在既有 `RealtimeSession` 增加一个**可选、仅可信宿主调用**的投递方法；不增加模型工具、Client wire、业务执行器或第二 Provider。候选形状：

```ts
interface RealtimeTaskResultNotice {
  deliveryId: string; // 本原生 session 内固定、无秘密的幂等标识
  text: string;       // 已经宿主审查且获准发送给本模型的有界结果数据
  deadline: string;  // 不晚于原 session 期限
}

interface RealtimeTaskResultAcceptance {
  state: 'accepted' | 'duplicate' | 'busy' | 'unknown' | 'unavailable';
}

// 提案；当前未导出。
offerTaskResult?(notice: RealtimeTaskResultNotice): RealtimeTaskResultAcceptance;
```

该方法只提供原 session 的结果消息与后续自然续答，不执行任务、不查询 Runtime、不接受用户授权。`text` 在 Provider 表达为带来源边界的宿主结果**数据**：可简洁告知结果，不代表用户新命令、同意、工具调用或待确认问题。具体原生消息类型由 goo 根据已支持协议实现并验证；不由 Desktop 直接写 WebSocket，不拼接 `askUserQuestion` 的确认话术，不重新发送旧 call 的第二份 `function_call_output`。

契约最低要求：

- 同一原生 session 中，`deliveryId` 与全部载荷摘要绑定；相同内容重复投递返回 `duplicate`，变更内容拒绝，不再生成第二次回答。Provider 内部有界记录，不持久化业务任务。
- `accepted` 只证明 Provider 接受进入本 session 的消息/续答路径，**不证明服务收到、模型说了、扬声器播放或用户听到**；`duplicate` 只证明同一已接受标识存在。
- `busy` / `unavailable` 必须在创建消息或请求续答前返回，零部分投递。用户正在说话、有活动回答/待确认续答、原工具 call 尚未返回时，保守返回 `busy`，不取消它们抢占播报。
- 原生发送可能已发生但不能确认时返回 `unknown`，或抛错由 Host 按 unknown 处理；不得把部分发送误写为 busy 后允许盲重发。
- 检查期限、signal/session 关闭、文本和标识上限；建议结果文本不超过现有 8000 字符。实际常量由公开契约明确，不截断授权参数或把未知结果改为成功。可选端口缺失时保持现有 context/wait 行为。

本方案不要求新异步 ack、恢复服务或跨 session 发送队列。若 Provider 无法实现上述“busy 零发送/accepted 幂等”的最小语义，应明确 unavailable，而不是导出无实际能力的空入口。

## zemeng main/Host 的可信投影与消费点

业务事实继续来自原 Runtime。不要把任意 `task.completed.payload`、child 终态或工具原始输出直接送进该端口。

1. 在原 `main.js pumpEvents` 的 accepted 原事件循环中识别原 parent 的 `task.completed` / `task.failed` / `task.cancelled`。用公共 task readback 核实相同 taskId、当前 terminal state、revision 和 resultSummary；原 child 完成不能冒充 parent 成功。
2. 用 `conversationToolAccess.resolveConversation(taskId)` / 原 `readToolConversation` 与 `conversations.containsConversation` 核 canonical UI 归属；必须与捕获的 Live record conversationId 精确相同，禁止 startsWith、固定旧 ID 或当前 active UI 的临时替代。
3. 默认仅考虑**本活跃 Live record 实际已受理**且持有 taskId 的原 parent；不得从全局 task 列表推送其它来源的结果。已关闭 Live、跨 session/restart 或没有可信 taskId 的 unknown 提交不自动认领任务。
4. 以固定 allowlist 构造宿主本地 notice：原 parent taskId、canonical conversationId、原终态/revision、结果内容摘要与 deliveryId。私有路径、repository、token、未知字段、child 内部错误对象和原始工具响应不随对象 spread 外发。送 Provider 只需 deliveryId/已许可文本/期限，任务身份留在 Host 本地核对；不要求模型朗读 taskId。
5. 使用原可信完整出机检查/来源过滤，确认**本次要送的精确文本与当前模型配置**可以出机；先前工具元数据/别的结果许可或“原 text 模型已见过”不能自动等同 Live 可发送。缺明确可复用的许可来源时，本次主动投递保持 unavailable，仍让用户通过现有受控 read_context/wait 续接。原审批 pending、待核实/unknown 不投为成功。
6. 在 Host 新增宿主方法（候选 `offerOriginalTaskResult`，不是模型工具）接收该已审查 notice，最后再核 session identity/期限、canonical conversation 与捕获的用户交互 epoch。只由 Host 调用可选 `record.session.offerTaskResult`，不暴露给 Renderer 或模型参数。

精确挂点：原 `onTaskSubmitted` / `requestWork` 的 receipt 绑定处记录可播报的原 task；`main.js:1202 pumpEvents` 读取原终态；`live-voice-host.js:147 onEvent` 与 `:477 receive(drained)` 消费已有空闲信号；`:80 releaseActive` / `stop` 清理本 session 的 notice。不得创建第二任务循环、额外轮询器或后台业务执行器。

## 不抢话、去重与未知边界

| 场景 | 最小消费规则 |
| --- | --- |
| 原 request_work / wait_for_task 尚能在当前轮正常返回 | 继续原 onTool 结果路径，不同时追加 notice；只有已脱离当前轮续答的原工作才有主动通知候选。 |
| 相同终态事件重放、同一原任务多次刷新 | 本 session 按原 parent taskId + terminal revision + 结果摘要去重；Provider deliveryId 再做原生幂等。已有正常轮结果已投回时不再追加主动播报。 |
| 用户说话、输出未 drained、当前确认待回答或其它轮仍活动 | 仅保留有界候选；不插话、不 interrupt、不冒充确认问题。已有 turn_complete/drained 空闲事件可重新评估，禁止新重试定时器。 |
| 接受任务后有新的用户输入或用户主动打断 | 本地交互 epoch 改变，旧候选自动播报资格撤销，保留原文字结果供续读。不得从 goal 语义猜测“还是原话题”，也不在用户说完新话题后突然补播旧结果。 |
| 用户询问原工作 | 继续现有 read_context / wait_for_task 返回该原任务，走本轮自然续答；不重新 submit、不再补发旧候选。 |
| Provider 返回 accepted / duplicate | 本 session 记为已接受，不记为已听到；随后取消或被打断不自动再播，结果仍可读。 |
| 端口 unknown、发送异常或 accepted 后连接丢失 | 保守封闭该 notice 的自动重发；不标播放成功，不重派原工作。用户后续明确查询时读回原 Runtime 事实。 |
| 明确 busy 且保证零发送 | 仅在相同 interaction epoch 的已有空闲事件重新评估；期间新输入、关闭或到期即撤销。队列应有硬上限，溢出留在文字中，不驱动新任务。 |
| Live 关闭、到期续接/重新启动、新 conversation | 撤销 session 候选和投递资格，不自动跨 session 重播，不以保留 Runtime 任务为由重开麦克风。新会话由历史/context 承接。 |
| unknown 提交无 taskId，或 child 成功而 parent 未终态 | 不生成成功 notice，不猜测原任务身份，不据此再次 task.submit。 |

这个保守方案让**未被新输入替代的原后台任务**在原 Live 空闲时可自然告知结果；打断或切换话题后的恢复仍保留原 context/wait 控制，避免凭语义猜测抢话。更积极的用户关注点跟踪属于后续产品决策，不在本最小交接内。

## 交付与真实设备验收

goo 交付应包含实际公开 export/类型、原 Gateway 的同 session 原生实现和有界失败语义；zemeng 随后接原 main/Host 消费与精确出机许可。先用 Local/Synthetic 小场景验证同 canonical parent、零业务重执行、正常结果与 notice 互斥、busy 零发送、重复/新话题/unknown/关闭；这只证明控制边界，不证明真实语音效果。本次说明不运行新增测试。

后续真实验收必须另行获得有效模型/设备配置，并记录精确版本、源 SHA、原 task/证据与结果：

1. 实际 Windows 麦克风/扬声器与 AgentArts 原生 Live：原任务超过本地等待后完成，闲置同会话收到一次自然结果；文字细节仍在原会话，用户无需重复任务。
2. 用户正在说话、输出播放未结束、当前参数确认待回答时完成任务：不抢话、不混入审批、不消费 echo；审批后不重复问或重复执行。
3. 打断后转到新话题、关闭/重开 Live、切换 conversation：旧结果不突然播出；明确续问仍读原任务，跨会话结果不可见。
4. 实际响应创建竞态、网络掉线/发送不明、设备断开：不声称用户已听到、不自动补发/重执行、不泄露其它会话，原 Runtime 结果可核实。
5. 核实际服务消息接收、模型输出、PCM 播放 drain 分别成立；drain 不等于人耳听见。记录首个可听结果延迟和重复播报次数，不用合成测试或主观承诺宣称已达到 GPT Live 的质量/延迟。

当前尚无以上新端口实现或真实验收；生产仍以 #406 的原任务续答能力和已登记限制为准。
