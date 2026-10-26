# 文字模型结果驱动语音输出

基线 `ad1a045`，目标 `huawei_ict_agentarts`。文字任务继续由原 Runtime、ModelGateway、Policy 和授权卡执行；新增接线只负责最终回答的声音呈现。

用户先开启当前对话的 Live，然后在该对话发送文字。Desktop 在原 `task.submit` 受理后将 taskId 绑定到当前 Live session/conversation；原任务事件或 `task.get` 第一次读到成功终态时，把与文字展示相同的结果交给现有 RealtimeSession.speakText。Live 自己的 request_work 不进入此绑定，因此不会重复播报。纯文字对话、其他对话、旧会话和恢复的历史任务不会自动开启语音或补播。

播报沿现有 AgentArts WSS/百炼实时 ModelGateway，使用原 24 kHz PCM 音频事件和 Desktop 播放消费。模型收到 JSON 数据与本轮逐字朗读指令，禁用本轮工具；本地同时拒绝播报期间的工具调用。播报临时 item 在完成/打断时发送 conversation.item.delete，避免留作后续用户请求；正常工具对话随后恢复。未新增 Runtime 执行循环、工具授权、公开 voice wire、provider、依赖或凭据入口。

最多保留 256 个当前会话任务绑定、8 个待播结果，单条 8000 字符；超限不截断，提示查看完整文字。当前轮繁忙时等待原 turn_complete/drained，不另开轮询。停止 Live、打断、到期及会话替换丢弃队列与晚到结果。任务取消沿原 Client/Runtime；播报不会代签或重试任务。没有 Live、provider 缺 speakText 或发送失败时明确返回 unavailable/failed，原文字结果保留。

`textOutput.state=accepted` 仅代表请求交给语音模型，不证明收到音频、逐字准确或扬声器播放。现有 UI 显示等待、受理或固定失败原因。`playbackVerified` 始终 false。response-scoped tools/tool_choice/instructions 和 item 删除的实际供应商兼容性、真实文字模型→真实语音模型音频及实体设备仍须单独验收；配置缺失不回退 Fake/SIS，不宣称通过。

ADR-0011 的纯文字默认保持；本次补充为用户已显式开启 Live 的同对话最终文字结果播报。语音停止与 task.cancel 继续分离，审批仅在原卡完成。

本地验证使用 Node 24.15.0/npm 11.12.1、工作树独立 npm ci。新增模型事件测试及 Desktop 队列/生命周期测试均为明确 Synthetic，不构成真实云或实体音频证据。原始日志位于当前工作树忽略目录 `.cache/voice-text-output-20261025/`。
