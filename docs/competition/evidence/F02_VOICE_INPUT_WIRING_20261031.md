# F02 原待决问题语音链接线记录

目标为 `huawei_ict_agentarts`，基线 `ec8be760`，隔离工作树 `.worktrees/pr531-voice`。本记录不将本机设备探测、Fake 服务或测试回执当作真实 ASR、回声消除或人工听感验收。

## 本次实现

- `createF02WorkflowWorkerPorts` 返回 13 个固定工具、`configuredWorkflowWorkerPorts` 和受信 `authorizeFinalRead`。复用既有 configured worker、HostBridge、Policy 与原问题服务，不建立新调度器。N04 继续由既有平台语义节点负责。
- 工具包含 N01/N03/N05 原宿主、N02/N06～N11 控制宿主，以及 N01/N05/N09 条件检查。固定 requiredTools、问题输入绑定、frontier、逐回执导出、最终本地读回均接入实际 worker。
- N02 只记录实际播放管线的同轮 drain、音频计数与原提示文本；N03 在自己的 Policy 授权下等待并读取原问题/revision 对应的最终事件，取消或撤销立即停止等待。`echo: unknown` 与 `questionPlaybackVerified: false` 保留，不提升为声学证明。
- 麦克风宿主提供当前授权租约、captureId、track 状态、帧/字节及非零帧计数。Live 将 speech 开始/结束计数绑定到原 final；不保存 PCM，不将文本历史当 ASR，不自动开麦、批准 OS 权限或发送录音。
- N05 支持原卡已经触发、消耗一次性授权并产生确切 confirmed 执行记录的情况；逐项核对原 task/run、工具版本、参数/范围、Policy、取消与期限。N06/N11 读取该次原操作，不重新提交或消费授权。
- N07/N08 只接受原卡真实失效/拒绝状态；N09 区分取消请求与停止读回；N10 只能聚焦原卡。语音与模型解释不决定授权。
- `authorizationQuestionHost.refresh()` 委托原问题服务；`readConsumedOperation()` 经原已消费结果门禁返回不可变 request/receipt，不签发授权。

## 根装配入口

在 Runtime 构造前创建工厂，传入懒取真实 `getApplication`、原 `authorizationQuestionHost`、Live、`microphoneCaptureHost`、`voiceCommandHost`、独立声学证明验证器和统一 `authorizeExport({taskId,workflowId,stage,value,deadline,signal})`。将 `tools` 合入原工具列表，将 `configuredWorkflowWorkerPorts` 交给既有 AgentArts 镜像装配。

Live 构造需要 `authorizeFinalRead: (binding, receipt) => f02Bundle.authorizeFinalRead(binding, receipt) === true`。该 gate 校验原 N03 已执行 Policy 与原图/问题身份；不能用恒真回调替代。不要同时注册旧 generic `voiceFinalTranscript` N03 适配器。

本包不改 `main.js` / `agentarts.ts`。实际根调用方由集成分支接入。未注入独立 `verifyAudioEvidence` 时明确返回 `f02_acoustic_playback_evidence_unavailable`，worker 不可用。实际 Live 的 unknown echo 不会因为有帧或有 drain 自动通过。

## 验证及边界

- 根构建、Runtime 构建、架构门禁通过。
- 受影响语音、麦克风、原卡及 F02 测试：244/244，通过明确外部临时目录运行。首次 sandbox TEMP 运行有两处未改动 `live-voice-config.js` 的 `rename EPERM`；原日志保留，未放宽断言或修改该存储实现。
- 实际 configured worker/委派子任务/Runtime/Policy/HostBridge/原卡服务测试 11/11：完整批准链只执行原业务一次；零次授权余额仍要求原确认执行；拒绝缺声学证明、伪 settled、导出拒绝、替换问题、取消等待播放/ASR、撤销 N03 授权、未知原写及参数替换。镜像、业务服务、ASR/设备/声学验证器明确为 Fake。
- 两个实际 Desktop 宿主的组合测试验证原帧清零、租约与转写关联、错误 drain 轮次、partial/旧问题拒绝。IPC、设备帧及 provider 事件为 Synthetic；没有真实云调用。
- 新增检查点只保存已验证原问题输入，恢复不会选择另一问题。原卡的进程内已消费绑定或 Live 会话重启丢失时拒绝读回；未知写入保留，不重放。

尚未完成：主装配验收、AgentArts 实际镜像/trace、真实 ASR 与独立回声/播报证明、真实设备上的产品整链和人工听感。当前代码与本地测试不代表 F02 或 PR #531 已完成真实验收。
