# F12 原语音通知关联方案与证据

目标 profile：`huawei_ict_agentarts`。沿原百炼 RealtimeSession、Live host、NotificationService 和 Runtime/Policy，不使用旧 SIS 或其他 provider 替代，不新建调度或存储。根负责 Main 和最终真实设备/云探针。原 `speakText` accepted、音频产生、Renderer drained 和真实硬件回执是不同事实；没有可信真实回执时原 voice attempt 保留 unknown，不能宣称 delivered 或重放。

公共协议兼容增量：`RealtimeSession.speakText` 的返回值新增可选 `renditionId`；RealtimeEvent 的 audio、assistant final transcript、turn_complete 新增可选关联字段，turn_complete 带已校验的原 responseId。Qwen 原单轮串行执行只将原临时输入 item id 关联到当前 response，所有输出继续经过当前 responseId 校验；输入语音不借该标识，中断/结束清除，旧回执不能挂到下一轮。没有修改外部服务请求字段，未声称服务端支持新的 echo metadata；字段是本机关联与供应商事件身份，既非授权也非播放证明。旧调用方忽略新增字段，旧 provider 缺身份时普通聊天兼容，通知关联不可用。

首批协议增量为 `115935b1`，之后的宿主增量沿原 Live 会话接入原 F12_N04。`live-notification-output.js` 只管理原 Live 当前朗读的临时关联，持久事实仍存于原 Runtime 与 NotificationService：绑定原通知 round、固定提示文本摘要、task/run、原 conversation/session、deadline，与同一 rendition/response 的音频、精确最终文本和专属 drainId。取消、重连、插话、旧 drain、替换文本均不确证，不借用当前 questionDelivery 回执。

本地协议验证：models 与 Runtime 构建通过；`realtime.test.mjs` + `agentarts-realtime.test.mjs` 47/47，覆盖同一 rendition 的音频/最终文本/完成关联、错误 response、输入音频不借用输出身份、中断后旧事件及下一轮清除。原 `live-voice-host`、`live-text-output`、`live-voice-playback` 47/47，普通聊天与原 Question drain 路径兼容。没有调用真实百炼、播放设备或完整 F12 语音图；测试事件来自显式协议 Fixture，不构成云服务或物理播放验收。

宿主准入：`notification-application-host` 仅接受原 `workflow.host.f12_n04` 的活动 host task/run/参数、已消费的独立 Policy allow 执行证据与仍有效的原 grant；原业务 guard 再核对选择、策略、队列和 graph。通知文本严格来自原选择的固定提示，不接受模型编写的标题、正文或收件人。普通 `deliverBatch` 不因 Live 连接存在而自动改走语音。`hasVoicePort(conversationId)` 核对同一真实活动 Live 会话、闲置状态和原问题卡，缺失时不提交语音图。

原 `beginDelivery` 先落库，再调用 Live；`desktop-notification:voice:<round digest>` 在原 N04 任务保存本机 binding 和分级 receipt。`accepted`、`draining`、`renderer_completed` 均保持 `playbackVerified:false`，原 voice attempt 一律 `unknown`，原工具/图进入 reconciliation，feed 保持 unread。Renderer 报告排空并不证明 DAC/扬声器输出或人已听到；本包没有构造硬件回执入口。重提图、旧 drain、重开数据库均不重播。结果摘要与云出口不会收到本机原始播报文本、音频或私有回执。

Main 注入：在原 `createDesktopNotificationApplicationHost` 构造中追加 `getVoiceHost:()=>liveVoice`（惰性读取已存在的原 host）；不另建连接，不改 Renderer 协议。原 F12 工厂按已绑定 `preferredChannel` 选择 N04 声道，配置摘要升级 `business-20261101-f12-v4`，节点仍为原 185 个。旧配置图拒绝新摘要。统一 Main 尚由根代理集成，真实百炼凭据/音频、物理设备和云整图尚待验；`f12_voice_hardware_receipt_unavailable` 明确保留，不能据本地排空通过认定 F12 全完成。

宿主验证：原 `business-workflow-f12-runtime`、新 voice 实际 Runtime 场景、F12 ports、Notification Application、Live Notification/Voice/Text/Playback 共 118/118。新场景以原 Engine、SQLite、Policy、AuthorizationQuestions、NotificationService 和 Live host 串联，仅云、selector、问题卡回答和 Renderer 事件是显式 Fixture：双项单轮一次朗读、Renderer 排空后仍 unknown/unread；重提图与 SQLite 重开保留原回执且零重播；拒批、写前取消/撤销、播报期间 grant 撤销、文本替换和错误会话拒绝。另有排空边界前撤销/取消专用断言。没有测试使用真实账号、支付云调用或声卡硬件。

最终边界修复后，Live/Voice/Text/Playback 与实际 voice 图定向 66/66；增加“intent 已保存后、调用 session 前”的同步来源复核，Live Notification 最终 13/13。撤销后的该 rendition 音频不再转发 Renderer，旧 drain 不释放原通知占用。架构门禁 3/3、`git diff --check` 通过；整仓检查由根代理统一运行，不重复付费云验收。
