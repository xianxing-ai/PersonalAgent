# F12 原语音通知关联方案与证据

目标 profile：`huawei_ict_agentarts`。沿原百炼 RealtimeSession、Live host、NotificationService 和 Runtime/Policy，不使用旧 SIS 或其他 provider 替代，不新建调度或存储。根负责 Main 和最终真实设备/云探针。原 `speakText` accepted、音频产生、Renderer drained 和真实硬件回执是不同事实；没有可信真实回执时原 voice attempt 保留 unknown，不能宣称 delivered 或重放。

公共协议兼容增量：`RealtimeSession.speakText` 的返回值新增可选 `renditionId`；RealtimeEvent 的 audio、assistant final transcript、turn_complete 新增可选关联字段，turn_complete 带已校验的原 responseId。Qwen 原单轮串行执行只将原临时输入 item id 关联到当前 response，所有输出继续经过当前 responseId 校验；输入语音不借该标识，中断/结束清除，旧回执不能挂到下一轮。没有修改外部服务请求字段，未声称服务端支持新的 echo metadata；字段是本机关联与供应商事件身份，既非授权也非播放证明。旧调用方忽略新增字段，旧 provider 缺身份时普通聊天兼容，通知关联不可用。

后续宿主接线范围：绑定原通知 round、原已批准固定文本摘要、task/run、会话、deadline 与同一 rendition/response 的音频、精确最终文本和专属 drainId；取消、重连、插话、旧 drain、替换文本均不确证。不借用当前 questionDelivery 回执。持久记录使用原 Runtime checkpoint 与原 NotificationService attempt；accepted 和 renderer_completed 分级只读，均不得映射为真实已投递。该宿主阶段尚未在本首批协议增量中完成。

本地协议验证：models 与 Runtime 构建通过；`realtime.test.mjs` + `agentarts-realtime.test.mjs` 47/47，覆盖同一 rendition 的音频/最终文本/完成关联、错误 response、输入音频不借用输出身份、中断后旧事件及下一轮清除。原 `live-voice-host`、`live-text-output`、`live-voice-playback` 47/47，普通聊天与原 Question drain 路径兼容。没有调用真实百炼、播放设备或完整 F12 语音图；测试事件来自显式协议 Fixture，不构成云服务或物理播放验收。
