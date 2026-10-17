# V3 主动工作流与用户通知测试镜像

2026-10-15，目标 `huawei_ict_agentarts`，实施工作树 `laya-owned-runtime/PersonalAgent`。
本轮在既有 F01–F28 工作流目录及 185 节点模板之外增加主动责任工作流和本地通知宿主接线。
28/185 是目录与模板数量，不能解释为 28 项业务或 185 个真实服务节点已验收。
版本目录、代码、离线测试、实际 Docker 运行、真实模型/设备与平台发布分别验收。
Owner 随后明确授权上传当前自有镜像，已替换本轮原先“暂不发布”的安排。
当前 SWR 为 `personal-agent-owned:local-laya-v3-244ca434`，ARM64 index 摘要
`sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`。
现有自有 Runtime 新版本 `arm64-local-v3-244ca434` 已配置读回并取得精确版本目录 HTTP 200；
真实模型代理也已 HTTP 200。孙悟空、鹈鹕公共编码夹具的主/影子/一次交付已通过，见本文最新实测节。
这些测试使用相同已发布镜像的本地 Docker 实例、本机 Runtime/Laya 与真实 AgentArts 模型代理；
远端 Runtime 精确版本目录和平台日志另行验证，不能写成全部 28 条真实业务链或整个远端闭环通过。
见[当前发布回执](evidence/test-image-v3-20261015/owned-release.json)。V2 与下文历史记录保留原时间范围。

## 主动入口与阶段

`proactive.responsibility.v1` 为外层增量，`changesOwnedF01ToF28:false`。
仍通过原 `POST /invocations` 的 query JSON 调用，不新增不兼容的 wire REST 端点：

- `{proactiveVersion:1,operation:'describe'}`：读取四入口、阶段、adapter 要求和启动期已注册的问题契约。
- `{proactiveVersion:1,operation:'advance',taskId,controlRevision,taskDeadline,hostFrame,...}`：推进原受信检查点。

四入口为连接器事件 `connector`、用户指令 `user_instruction`、子任务回执 `subtask_feedback`、
有明确原因的唤醒 `wake`。没有订阅不自动等于无关；先保留来源版本、实体/锚点、目标/责任和 Evidence，
再读取相关原用户引文、Goal、记忆、经验及既有 scope 引用。

之后按照当前阶段产出有界请求：读取上下文 → 本机 Laya-first → 契约成熟度/不确定性核对 →
必要时 DeepSeek 教师接管 → 原宿主动作 → 实际回执 → 更新原事项 → 有原因时交原 Scheduler。
同一成熟契约下，只有明确独立的问题可以批处理；复杂、未验或重要的抑制候选不能靠 Laya 自报置信放行。
成熟普通决策可以直接推进，不固定每次调用第二模型；教师返回自己的决策来源，不能假装本机 Laya 已执行。

动作涵盖 continue/research/delegate/local_plan/shadow/notify/request_user/defer/ignore，但动作名不是能力。
每项仍须有可信当前 capability，并由原 Runtime/Policy/ToolGateway 校验真实授权、参数及执行条件。
`inferred_interest`、源引文、模型输出和来源签名均不能生成权限。

## 来源、签名与能力缺口

`createProactiveHostProofs(secret)` 由受信宿主签名 frame/event/responsibility/receipt/control，密钥不得进入
模型、Renderer 或公开 Evidence。签名绑定原 taskId/sessionId/controlRevision/taskDeadline；
frame 还绑定当次 requestId、真实 hostAvailability 和 availableCapabilities。
客户端必须使用相同 `x-hw-agentarts-session-id` / `x-request-id`，不能在 JSON 中添加一个“可用工具”就授权执行。

源事件必须来自已持久化的连接器/用户/子任务/唤醒记录，带原 sourceVersion、payloadDigest、锚点、观察时间、
责任/Goal 引用和 Evidence。原事件 ID 不得绑定新内容；更正、删除、撤回和源版本冲突需保留，不能只取模型的新摘要。
责任记录保留原 conversation/message/quote 摘要；显式指令不等于工具授权，推断兴趣不能携带执行 scope。

| 状态/端口 | 可证含义 | 不可据此声称 |
| --- | --- | --- |
| descriptor / adapter requirements | 镜像公布功能与所需公开端口 | 所有连接器账号已接通 |
| host_receipts_required | 已装配主动控制器，仍需实际来源与回执 | 主动服务已在真实账户闭环 |
| capability_unavailable / blocked | 对应宿主能力未绑定，明确保留缺口 | 使用另一个本地实现静默替代 |
| waiting_device | 原能力依赖离线设备，或没有真实云持久宿主 | 容器自身接管本机 Laya/桌面 |
| waiting_reconciliation | 原操作结果未知，保持 operation/digest | 自动重复未知副作用 |
| waiting_user | 真实流程需要用户处理 | 模型已替用户批准 |
| verification:unverified | 编排结果，实际执行仍需宿主验证 | TaskRuntime 已完成或平台已验收 |

离线本机动作不阻塞其他独立的 cloud_persistent 分支；cloud_persistent 只在真实可信当前观察可用时推进。
镜像本身不新建事件库、通知队列、持久主控、授权器或第二个 Scheduler。
源缺口、配置缺失、模型或宿主不可用明确返回；不把 JSON descriptor、测试 Fake 或页面截图当生产连接。

## 无人值守、回执、归来与时间

受信控制包含 pause/resume/cancel/enter_unattended/return。无人值守继续原任务与原检查点，
不改变原 taskDeadline、scope、授权和幂等参数；设备离线保留待设备状态。
未知操作必须读回原 operation，教师或新 revision 不能把它变成一次新执行。

return 汇总原持久状态的 done/changed/pending/blocked，并列新增 Evidence operation；
`replayedNotifications:0`，归来不是重放过去的横幅或语音。再次归来不重复新增 Evidence。
source、proposal、receipt、control 和 advance 的 startedAtUtc/finishedAtUtc/wallMs 保留于签名 timeline，
HTTP 分派及 AgentArts 模型代理也提供阶段计时；耗时范围分别标明，不将本机函数耗时当端到端模型延迟。

## 主动连接器与 Runtime session 恢复

`createRuntimeProactiveConnectorHost({atomicState,...options})` 复用 connector-host 的公开主动来源端口，
`createProactiveCheckpointAdapter` 把来源检查点绑定到原 Runtime atomic namespace。
宿主可读取 sources/status，调用 start/tick/tickMany/stop/recover/dispose；唤醒建议交原 Scheduler 登记，
不另建常驻调度器。来源批次先持久化 pending，再交事件 sink，确认后才提交 cursor；sink 失败或重启后
恢复同一 pending，而非跳过尚未确认的批次。断线、授权恢复、cursor 过期与设备恢复通过显式 recover 处理；
缺少来源 reconcile/readback 时保留 reconciliation_required，不能清空 cursor 冒充恢复。
这些端口已具备离线夹具证据，实际账号订阅、授权恢复和设备长期在线仍须单独验收。

`createProactiveWorkflowSession(options)` 复用原 Runtime SQLite CAS，绑定原 taskId/sessionId/
controlRevision/taskDeadline。宿主必须注入 assertActive、advancePort、verifyAdvance；执行配置仍经
原 AgentToolPort、Policy/ToolGateway，resolveInvocation 只映射已有授权，readExecution 读取原 run/Evidence。
advance 在 HTTP 前写入 intent，验签和 CAS 提交后才释放 proposal；executeProposal 在调用前持久化原
operation/参数，未知写只读回原操作，不重新执行。重启不会重置 scope、期限或操作标识。

recoverPendingRequest 仅在启动时受信配置 `pureAdvance.kind:'signed_frontier_no_effects'` 下，使用冻结的
原 request/input/checkpoint 重算丢失的纯 frontier 响应；这不是重放历史成功，也不能运行模型、工具或外部写。
并发恢复竞争同一 pending CAS，失败方不释放 proposal；当前时间可能改变 freshness，不能冒称返回历史同一响应。
原请求过期、取消或 revision 改变不能借恢复取得新执行权；历史未知写的受限 readback 与新执行分开。

## 用户通知策略与协作者组合接口

通知在原 `NotificationService` 上扩展，详见 [模块 README](../../packages/notifications/README.md)。
`createRuntimeNotificationHost(runtime,options)` 把同一服务装配到原 Runtime SQLite
`createRuntimeAtomicStatePort(runtime,'device-notifications')`；未增加数据库或第二待裁队列。
SQLite CAS 对完整原值原子比较，旧 raw state 以 revision 0 读取并保留。

| 接口 | 宿主职责与证据 |
| --- | --- |
| getInterruptionPolicy(scope) | global → connector → responsibility 继承；显示 effective，同时保留不同窗口的父层 constraints |
| applyUserCommand / settingsTool | 注入 verifyUserCommand；绑定最终结构化 UI/语音命令与 operation/revision/scope/patch，拒绝 partial/echo/model/过期命令 |
| ingest / notificationFeed | 静默时继续接收；稳定 cursor、有效/过期/撤回状态，unread 与 deliveredAt 独立 |
| acknowledgeRead | 用户已读的幂等操作；不伪造投递，不重置配额 |
| reserveInterruption | 同通知轮次原子预占；显式 channels/原 expiresAt，同轮跨通道只计一次 |
| beginDelivery | 发送前读最新策略（含 preferredChannel）、配额、期限与有效性，先持久化 sending；maySend 只是既有授权执行路径的必要条件 |
| completeDelivery / getInterruptionRound | 通道实际 Evidence 与原回执读回；unknown 不退款、不重发，换 roundId 也不能绕过同一通知原操作 |
| getDigest(trigger) | on_return/scheduled/on_demand；只汇总仍有效未读变化，查询本身不计打扰 |

完整全局用户字段为 mode normal/silent、maxInterruptions 非负或 null、用户选定 windowMinutes、
silentUntilUtc、preferredChannel banner/voice/auto、allowUrgentBreakthrough、digestMode 及原 quietHours。
无擅自“每小时两次”等默认预算；0 不允许打扰，全局静默/配额不能被局部配置绕过。
静默不停止 ingest 或工作，过期/撤回变化不会在归来摘要重新打扰；已发送不自动已读。
重要节点还通过 onStage 提供 observedAt；策略、预占、发送、回执和 feed 保留各自时间。

`StoragePort` 只有 get/set/delete，不能宣称跨进程配额安全；未注入原子端口时 status 明确
`interruptionQuotaSafety:unavailable`，新配额/策略写入拒绝。真实设备横幅/语音需另经其原 Runtime 工具，
本地库测试不会启动麦克风或凭模型内容直接更改用户设置。

## 生产模型路由与 ARM64 冒烟

AgentArts 生产模式强制模型代理路由；真实端点、模型和凭据由受信宿主注入，不能从网页/模型内容覆盖。
本轮选定 DeepSeek 经 AgentArts proxy，底层为平台实际配置的 MaaS 等供给时如实记录，不能把代理路由
误写成平台自有模型。语音选择阿里百炼；Laya 在本机运行，容器不凭 descriptor 获得设备连接。
华为 SIS 平台链路尚未证实，不标记已接通。上述选择/接线不代表本轮已产生模型或语音端到端成功回执。
普通 Provider 的直接 Bearer endpoint 不能冒充 AgentArts 代理。当前代理要求 `/inference/v1` 路径，
明确 API-key header，禁止跳转、隐式备用源和未知付费请求重试。

[test-image-v3-smoke.mjs](../../tests/manual/agentarts/test-image-v3-smoke.mjs) 读取 stdin：

```json
{"docker":"<local docker executable>","image":"<already built V3 image>","output":"<local receipt JSON>"}
```

脚本只运行已经构建的 ARM64 镜像，`--network none`、非 root uid1000；检查无 proxy header 和显式
direct-validation 路由在生产模式被拒绝。正控仅使用
`https://proxy.synthetic.invalid/inference/v1` 与 `PA_AGENT_MODEL_PROXY_KEY_HEADER=x-test-key`，
不发送任何模型请求。真实 `/ping`、F01–F28/185 目录、主动 descriptor、retrieve→Laya候选→teacher frontier、
无人值守/return 和篡改帧拒绝由实际生产 main/HTTP 路径读取；Fake 只在合成回执的数据内容中明确出现。
脚本记录每阶段时间、镜像 ID 与 network 模式，不发布镜像；缺 MCP/ToolExecution 等端口保持 unavailable。

## 当前验证记录与边界

以下为 2026-10-15 已存在回执，UTC 时间与 wall 各按原记录范围列出；未执行新的构建/测试来更新本文。
阶段来源为 `.cache/test-image-v3-phases.jsonl`，中间容器证据为
[container-smoke.json](evidence/test-image-v3-20261015/container-smoke.json)。

| 检查 | 已知结果与范围 | 证据 |
| --- | --- | --- |
| notifications | **39/39 pass，0 fail/skip**，包括最新通道变更发送前复检；替代早期 37/37 计数 | `.cache/test-image-v3-check.log` notifications runner |
| 通知 host + atomic-state | 原 SQLite 双连接 **5/5 pass**；构建 wall 3071.1402ms，测试 wall 510.9607ms | `.cache/notification-host-build.log`、`.cache/notification-host-targeted.log` |
| Runtime session + image-host integration | **11/11 pass，0 fail/skip**；UTC 12:56:57.8869960Z–12:56:59.8669291Z，wall 1968.5021ms | `.cache/proactive-session-image-host-target.log`，SHA256 `62fceff3c1db5618317455b848a20d99641ae757713293564300308a7ce56487` |
| 根 integrations | **46/46 pass，0 fail/skip**；UTC 13:06:11.9622043Z–13:06:21.8289365Z，wall 9851.8384ms | `.cache/test-image-v3-all-integrations.log`，SHA256 `172e122d5e8dfa26dbd1fc96c50cfc0ea87fab13a3644f3ce424cb7b559a5829` |
| Wukong fixtures | **7/7 pass，0 fail/skip**；UTC 13:11:24.4996722Z–13:11:27.6978285Z，wall 3196.9407ms | `.cache/wukong-review-targeted.log` / `.json`，SHA256 `7c19dec0d9ed61ace30021199aca4f20f46f48f6d3538c86a655b98fce727e67` |
| 主动控制器 HTTP fixtures | **6/6 pass**；签名四入口、独立分支、unattended/return、篡改和过期拒绝 | 显式 synthetic 决策/回执，不是实际模型或账号验收 |

session/integration 使用真实 Runtime SQLite、公开端口和 HTTP，但模型与账号回执为明确 Fake/mock；
Wukong 7 项仅为 Python checker 与内存页面 stub 夹具，未启动浏览器或调用真实模型。
Wukong runner 已绑定模型初稿、真实失败反馈、主/影子相同 fault baseline/currentSHA、最新验证 SHA 与单次交付 CAS；
夹具检查画作祖先及自身矩阵、等价 begin 属性故障注入、保留原 ID/画作和计时，这些是测试机制证据，
尚不能据此声称孙悟空骑白龙马已真实生成、修复或视觉验收。

初次 `npm run check` **exit 1**，UTC 12:48:30.4107481Z–12:54:04.9195223Z，wall 334489.757ms。
Desktop `live-voice-boot-history.test.mjs:83` 的 failed boot history sink 用例在第 87 行出现 `false !== true`；
原日志 `.cache/test-image-v3-check.log` SHA256 为
`8821764d462c6dd7f72cc387d3eb51e5cf69a470f758901e5a7b686e07bf3c4a`。
同文件随后单独复测 **3/3 pass**，UTC 12:54:29.1112121Z–12:54:29.5590355Z，wall 438.7984ms；
日志 `.cache/test-image-v3-desktop-retest.log` SHA256
`7821be6c0faac0d75561786c187744cd4eebfc33d4b9ecb7ff04d541d9cf5c32`。
复测不覆盖原失败，不推断根因，也不把这次失败的门禁改记为通过。后续独立门禁记录如下。
阶段记录另保留了早期 proactive integration exit 1；纯 frontier 恢复修正后已有上述 11/11 与 46/46。

### 后续已有门禁与定向回归

[checks.json](evidence/test-image-v3-20261015/checks.json) 从现有 phase journal/raw log 汇总，
不含账户、凭据、配置路径或平台原始 secret 错误。未记录执行时源码 SHA 的地方保持 null，不能以当前工作树代填。

后续 `.cache/test-image-v3-final-source-check.log` 曾 exit 1，UTC 13:14:59.2384397Z–13:20:32.0341830Z，
wall 332778.0177ms；36 个 runner 汇总 3274 tests / 3252 pass / 19 skip / 3 fail。
失败是 Desktop `quit-task-preflight.test.mjs:194/207/223` 的三个消费 fixture；原 SHA256
`627cad16e43ff2e01844a468a5e2aa706ac55b33e7e8cb66e3d43ad9bc126a8e` 保留。
消费 fixture 修正后单独回归 **21/21 pass**，UTC 13:21:34.5803917Z–13:21:34.9910358Z，
wall 401.2502ms；[日志](evidence/test-image-v3-20261015/desktop-quit-sis-consumer-target.log) SHA256
`5de12cc3a2de8f51e3fd57dfbab9e84ba80ee999cba5476a67390f2e2352a234`。
另一个 settings 渲染目标先 26/27 pass、1 fail，修正后 **27/27 pass**；后者 UTC
13:12:21.9172671Z–13:12:24.4683893Z，wall 2540.7172ms，
[日志](evidence/test-image-v3-20261015/desktop-settings-target-fixed.log) SHA256
`67023d26fa26c349e1b459de82c7fb9016044f0fa823acd156879a9b52dc9e62`，不能与 21/21 混为同一目标。

之后 `npm run check` **exit 0**，UTC **13:22:28.0579997Z–13:28:09.3527356Z**，wall **341279.292ms**；
37 个 runner（含根 integration）逐条 summary 合计 **3320 tests / 3301 pass / 19 skip / 0 fail / 0 cancelled**。
原日志 `.cache/test-image-v3-final-check-fixed.log` SHA256
`38e82681aef7894228b236bf8872ec1583cf00571151d6a78c836ad0c9d7d586`。
这是当时源码的完整门禁；其后的 Bearer 前缀、思考字段和持久 timing 改动不能冒充已由该旧快照覆盖。

| 后续目标 | 已有回执 | 安全日志与 SHA256 |
| --- | --- | --- |
| proxy Bearer/startup | 13/13 pass，0 fail/skip；UTC 13:38:01.8168448Z–13:38:04.8211404Z，wall 2992.9145ms | [log](evidence/test-image-v3-20261015/v3-proxy-bearer-startup-regression.log)，`8f178a05fd30519c56c3e9a0dd703a556bb490d2ee91a5ad424850e988eca996` |
| durable timing + proxy/Wukong | 15/15 pass，0 fail/skip；UTC 13:40:34.4688879Z–13:40:37.6712634Z，wall 3193.4592ms | [log](evidence/test-image-v3-20261015/v3-durable-timing-and-proxy-targets.log)，`2c2368e45055d6efd6d7c91f1847e8ee5488af819caf950ec8d964b914f98855` |

这些为受影响目标回归，不能反写成旧快照覆盖。收敛后已独立运行最后一次源码门禁 `npm run check`，
**exit 0**：UTC **13:43:24.2365036Z–13:48:59.0410310Z**，wall **334790.382ms**。
从原日志 37 个 runner 的 summary 实际合计 **3321 tests / 3302 pass / 19 skip / 0 fail / 0 cancelled**，
包含根 integration。[完整安全日志](evidence/test-image-v3-20261015/test-image-v3-prebuild-final-check.log)
SHA256 **`fe4047fe8ba56bfff1f37acd06abbeb55ddafb2b87b0461226ec8445a458cf53`**。
checks.json 的 `finalRepositoryGateAfterLaterChanges` 现为 passed，并引用该独立回执；旧失败及旧快照仍保留。
此门禁对应协调侧已冻结的生产源码，后续仅文档更新不重复测试；不能据此声称最终镜像或真实模型验收完成。
DeepSeek 已在 UTC 14:05:09.100Z–14:08:10.399Z 进行真实 AgentArts 代理请求，耗时 181298.7166ms，
入站鉴权及 Policy 均成功，但 HTTP 500：`Failed to create sandbox: Timeout waiting for registration`。
两项精确 CSMS/KMS 策略已保存绑定，仍不能据此证明运行时实际读密钥/解密成功；没有模型回答或 usage。
没有直连 MaaS 回退。真实 Wukong/当前路由 Pelican 仍受阻于模型，最终镜像尚未 build。

### 百炼握手与本机 Laya 实测的有限结论

安全百炼回执为真实 WebSocket **HTTP 101**，观察到 session.created/session.updated，状态 session_configured；
UTC 13:03:19.497Z–13:03:20.335Z，wall 837.6694ms。`microphoneOpened/audioSent/devicePlayback/responseProduced`
均为 false，usage 未提供；这不是麦克风、语音内容、模型输出或端到端听说验收。
原安全回执 SHA256 `db53d84dfc1c11c70598c466d430d4caad1f6396c276191d87d423000e50c7fb`，
公开 checks 仅投影状态、事件与时间，不抄账户配置。SIS 平台链路继续不可用。

本机 [native comparison 原始公开回执](evidence/test-image-v3-20261015/local-laya-native-comparison.json)
SHA256 `cb9ab6eea7dd29ee62b6b0ec917d9bd22cb0ca0ef8e3d6de848beddff1e434c2`。
UTC 13:42:02.608Z–13:42:32.364Z；native Windows CUDA、torch 1 线程、bf16 autocast、单模型实例，
未施加 CPU/内存 quota，qualityVerified=false。下面的 wall 是预热后 selector + loopback HTTP + 完整推理，
不含约 15.035s / 12.707s 的 sequential / packed 启动；不是平台或真实业务端到端延迟。

| 服务策略 / 请求方式 | 样本数 | p50 ms | p95 ms | 最大 ms |
| --- | --- | --- | --- | --- |
| sequential / serial | 20 | 23.258 | 25.751 | 26.947 |
| sequential / parallel requests | 20 | 63.241 | 89.222 | 99.731 |
| packed / serial | 20 | 20.590 | 23.404 | 28.427 |
| packed / parallel requests | 20 | 54.134 | 79.185 | 79.250 |

两策略使用相同 4 组公开输入 SHA，编码 token 分别 274/320/275/347，每组运行 5 轮；每轮 4 请求的
总 wall 才适合比较吞吐：sequential 的 serial/parallel 五轮总计 464.317/450.946ms（每组平均 92.863/90.189ms），
packed 为 418.799/294.648ms（平均 83.760/58.930ms）。packed 会合批独立请求，单张图内部仍串行；
不能把并行请求的单请求等待时间当作单次 forward 提速，也不能从 4 个短输入外推任意上下文均低于 150ms。
sequential choicesStable=true；packed choicesStable=false，public-delta 的 serial 选择为 delta-unknown、
parallel 为 delta-different。因此更快不能证明质量等价，不据此晋升策略或决定换模型，也不声称与 Codex 资源相同。

历史 native 阶段第一次与第二次分别 exit **-1073740791**，wall 614.8824/21677.4522ms；根因未确认，
不能写成“已修”。随后 traced 与 final 两次阶段 exit 0，wall 31356.8089/30046.9602ms；
checks 保留全部四个阶段的 UTC、退出码与日志 SHA，后两次完成不覆盖前两次异常。

中间 V3 ARM64 镜像已完成本机 build：UTC 12:59:25.0148200Z–12:59:58.5165738Z，wall 33490.6641ms，exit 0。
其后容器 smoke UTC 13:00:45.686Z–13:01:08.825Z，wall 23131.8468ms；回执镜像 ID 为
`sha256:de927b62362a5012d38d2eea3955c446d525d2418b937f90917b4ffa910999d5`，仅标识该中间构建。
实际结果为 arm64、uid1000、network none、ping 200、28/185 目录、主动 retrieve→laya→teacher frontier、
unattended/return 及篡改帧 HTTP 401；缺代理 header 和禁止的 direct 路由均启动拒绝。
`realModelCalls:0`、`actualConnectorCalls:0`、`actualDeviceCalls:0`、`attemptedExternalCalls:0`，
`syntheticDecisionReceipts:true`、`platformConnected:false`、`published:false`。
这证明当时生产入口与合成回执路径，不证明模型、连接器或平台接通。此前“测试后统一构建、不发布”的
安排随后被 Owner 明确要求上传当前自有镜像替代；实际发布与真实测试以最新实测节的独立回执为准。

这些检查不证明盘古/DeepSeek 原生工具调用、真实连接器、实际通知设备、AgentArts 部署/评估、
真实 Wukong 从编码到自修过程或全部 28 项业务已经验收。对应结果须各自提供实际回执及来源范围。
最小修复算法和产品架构是否定稿以用户授权及当前实际实现为准；本工作包未实现新的补丁/依赖重规划算法。

### 追加：真实本机质量与长输入测试

[原始安全回执](evidence/test-image-v3-20261015/local-laya-quality-and-long-input.json) 与
[实时验收检查点](evidence/test-image-v3-20261015/live-test-checkpoint.json) 记录 UTC
14:14:41.213Z–14:15:17.061Z 的本机测试；外层启动总 wall 36329.9816ms。
原缓存 multilingual 权重、CUDA BF16、PyTorch 1 线程、单实例，无 CPU/内存配额。
共 24 次质量判断和 16 次新增长输入性能请求，0 接口错误、0 教师调用、未修改标签或训练模型。
数据集由宿主预先编写并冻结，属于合成样本，不是独立人工标注的生产验收集。

| 质量范围 | 标签命中 | 模型自选 review |
| --- | --- | --- |
| development | 5/12 | 8/12 |
| holdout | 2/12 | 10/12 |
| 合计 | 7/24 | 18/24 |

这些 review 均是模型实际选择，`laya_rejected` 为 0，不是后处理门槛拒绝。
7 个正确结果中 5 个为正确 review，只有 2 个是明确业务标签；不能把 review 当真阴性以掩盖未决项。
8 个长案例全部位于 holdout，长度与数据划分混杂，不能把 holdout 的差异单独归因于长度或泛化。
本轮不能从低命中率直接判断根因是模型、中文表达还是输入包装，也不能宣称业务判断质量合格。
质量调用的首个预热后请求为 121.432ms；之后短输入 15 次 p50/p95 为 26.399/30.747ms，
长输入 8 次为 65.034/69.394ms。全部质量单次低于 150ms，不包含模型装载和内部预热。
sequential / packed 服务启动分别约 19.244s / 14.330s；没有真实冷前向数据。

四个相同长输入为 1627/1632/1683/1626 tokens，均无截断，各性能臂只跑一轮：

| 服务策略 / 请求方式 | 请求数 | p50 ms | 样本最大 ms | 四请求组 wall ms |
| --- | --- | --- | --- | --- |
| sequential / serial | 4 | 79.095 | 79.395 | 309.878 |
| sequential / parallel requests | 4 | 204.340 | 259.531 | 260.152 |
| packed / serial | 4 | 58.565 | 122.984 | 288.081 |
| packed / parallel requests | 4 | 274.268 | 274.353 | 274.488 |

因此不能承诺同时提交长输入也低于 150ms；本轮 packed 并发组比 sequential 并发组慢约 5.5%，
不推广合批，也不据此取消其他范围的并行。小样本不能证明可靠 P95 或普遍性能。
两组长输入均选择 review；选择一致不等于质量通过，早先短输入 packed 的选择变化仍保留。

500ms 外部采样中实际 Python worker 最大观察 RSS 约 2.24GiB、进程峰值约 2.27GiB，
观察到最多 12 个 OS 线程；这是驱动/运行库等总线程数，与 PyTorch 计算线程 1 不同。
CPU 累计包含装载、预热与推理，没有进行 Codex 同任务资源对照，不能声称资源占用相同。
离散采样最后一条早于服务停止，缺少 GPU 显存/利用率，也不能宣称已捕获全过程峰值。
原始每次判断保留 token、队列、loopback HTTP、前向、输入 SHA、概率/分差及 UTC。

后续针对新增手动测试与覆盖补充的定向检查：Wukong gradient checker 8/8、
Wukong/Pelican 当前路由目标 19/19、主动连接器/静默通知补充覆盖 24/24、
决策验收夹具 8/8，均是明确的离线/Fake 范围，不替代真实模型或设备验收。
它们发生在上面的完整源码门禁之后，不反写为该次 3321 项检查已经覆盖新用例。

## 最新：当前自有镜像、真实模型与主/影子实测

[完整结果与逐阶段 UTC](evidence/test-image-v3-20261015/full-workflow-results.json)、
[发布及精确版本目录](evidence/test-image-v3-20261015/owned-release.json)、
[平台日志请求关联](evidence/test-image-v3-20261015/platform-log-readback.json) 分别保存。
新自有镜像已上传，旧版本保留；模型入口为新的 AgentArts 恢复代理，实际 DeepSeek-V4.1-Flash。
没有直连旧 MaaS API 的客户端回退；平台代理底层使用 MaaS 的事实保留。

原代理从 181.299s 注册超时进入模板 Error/NA.90001。独立恢复代理生成新模板后能访问上游，
随后暴露原 Key 仅允许 V4-Flash；Owner 授权全模型后按官方约五分钟传播窗口复测，
UTC 14:45:17.415Z–14:45:19.215Z 返回 200、实际模型 V4.1-Flash、9 input/2 output tokens。
模型 API Key 列表经正式删除及读回只保留当前使用的一枚；旧代理与 7 枚旧模型 Key 已删除，
语音、Runtime 入站、WSS、IAM、CSMS 和 SWR 必需凭据保留。原失败与删除审查记录不覆盖。

| 实际阶段 | 孙悟空 | 鹈鹕第二轮 |
| --- | --- | --- |
| 本机 Laya 加载与 readiness | 30.808s | 14.663s |
| 模型生成初稿 | 78.634s | 现有故障 SVG 夹具，不计为模型初稿 |
| main 整段 | 22.049s | 34.648s |
| shadow 整段 | 16.063s | 18.144s |
| 最终一次 CAS 写回工具 | 1.413s | 1.190s |
| flow wall（含上述嵌套阶段，不能再次相加） | 167.432s | 81.611s |
| 外层启动至清理 | 183.618s | 89.735s |
| 真实模型返回 / HTTP200 | 22/22 | 22/22 |
| 重开 SQLite 核验的 Evidence | 20 | 21 |

孙悟空原始图由真实模型从空 scaffold 生成，初稿动画已通过后显式注入暂停故障。
两分支从同一故障 SHA 出发，实际失败反馈可见；最终实际结构/浏览器动态检查通过、无 console
error/warning，当前交付 SHA 与最新验证一致，只有一次交付写入，用户未提交 note 保留。
最终图像已由主控直接查看；这不是人工用户批准。裁决来源为实际 DeepSeek 教师；Laya 仍未合格，
精确已验证经验复用没有训练权重。分支父任务及工具任务为 succeeded；协调检查点锚点仍为 created，
不能称整个协调父任务已进入完成终态。

鹈鹕首轮为 partial：main 成功，shadow 候选新增触发元素违反原固定结构合同、24 步耗尽，
33 次 API200 不能掩盖失败；[原报告](evidence/test-image-v3-20261015/pelican-first-failure.json) 与时间线保留。
第二轮只补齐规划、选择与执行共享的既有验收合同，没有放宽 checker 或增加预算，才取得双方通过。

150ms 目标在这些真实长上下文仍未达到：6 次本机 Laya 端到端约 182.036–618.041ms，
队列等待很小，主要是前向耗时。此前短输入单次低于 150ms 的证据不能外推到整条流程。
两条完整测试在同一已发布镜像的本地实例和原本机工具宿主执行；远端 Runtime 已单独验证精确版本目录
及日志，但本工作包未证明所有业务账号、设备、平台知识库/MCP/评估或全部 28 条远端业务执行完成。
