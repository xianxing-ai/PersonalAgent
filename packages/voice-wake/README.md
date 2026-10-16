# `@personal-agent/voice-wake`

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-13）：以 [CONTRIBUTING](../../CONTRIBUTING.md) 为准；当前提交须取得一位非作者有效 Approve，并满足必要检查。禁止管理员绕过或虚构批准。

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-15（zemeng5208）。产品流程：F02；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

MOD-15 的 provisional 唤醒会话生命周期控制器，目标 Profile 为
`huawei_ict_agentarts`。本包只消费可信宿主的录音授权结果和撤销信号，默认关闭，
只有调用方显式 `enable({deadlineAtMs})` 后才订阅注入的 `WakeSignalSource`；调用方必须
提供有限的绝对 deadline，授权检查和源订阅都会收到同一个有效期上界。源可以同步
或异步完成订阅；只有真实 detector 与授权源就绪后才发布 `listening`，等待期间撤销或
到期会结束 `enable()`，迟到订阅会立即释放。

本包不打开麦克风、不保存音频、不做 ASR 或唤醒算法、不访问云端、不签发授权、
不提交任务，也不复制 MOD-14 的 `voice.start/stop`、播放或 `task.cancel` 语义。源事件
只允许固定的 `wake`、`device_unavailable`、`error` 分类；控制器向调用方只发
`WakeDetectedEvent`，不携带音频、文本或外部错误信息。

`disable()`、`stop()`、宿主撤销、设备不可用、截止时间和 `dispose()` 都会取消当前
订阅并使旧 epoch 回调失效；宿主休眠后若定时回调延迟，下一次 `enable()` 也会先核对
旧会话或待处理授权的期限，释放过期订阅或终止等待。播放状态由 MOD-14 调用方通过 `setPlaybackActive()`
提供；冷却窗口由构造参数 `cooldownMs` 显式决定，不代表或测量误触率。
异步或同步源就绪返回后再次检查实际期限；PCM 适配器在 detector/capture readiness、
每帧和检测回调处同样复查墙钟时间。休眠恢复后即使到期定时器尚未调度，也不发布
过期 listening、不继续启动采集或投递帧/唤醒，并释放该订阅及检测器一次。

MOD-14 等本地宿主可通过 `subscribeLifecycle(listener)` 只读观察固定三字段
`{state, sessionId, expiresAtMs}`。注册时同步收到冻结的初始快照；之后只发送稳定且变化的
`listening`、`disabled` 或 `disposed` 快照。返回值是幂等退订函数。监听器异常彼此隔离，
该通道不携带文本、音频、外部错误、授权对象或 Runtime 能力，也不能修改控制器状态。

`@personal-agent/voice-wake/testing` 公开导出 Fake 时钟、授权端口和事件源，仅用于离线
生命周期测试，不能冒充真实麦克风、识别成功或实机误触/回声指标。基线 `5b581139`
已有 Desktop `wake-voice-host.js` 与 MOD-14 的共享 PCM 组合；真实硬件验收及非作者
评审仍需完成，才可评估后续接口状态。

`createPcmKeywordWakeSignalSource(pcm, detector)` 是结构化接线入口：由可信宿主注入同一路
授权 PCM 帧源和已经配置固定中文唤醒词的检测器，本包不导入 MOD-14，也不打开第二个
麦克风。检测器的限定词表 `ready` 和音源的真实捕获 `ready` 都成功后，异步订阅才完成，
随后生命周期才可发布 `listening`。缺少任一 `ready`、源结束、取消或过期均失败关闭；
迟到回调无效，句柄释放可等待返回订阅的 `closed`。音源 `closed` 只证明本订阅引用释放，
若 ASR 仍在使用同一物理麦克风，须由宿主检查最终引用和设备 track 才能证明完全关闭。
MOD-14 音源和限定词检测器已提供所需端口及 Desktop 消费；目标机中文引擎、设备读回
和实机命中仍需验收。当前播放抑制只依据回调时的 playback 标志，不能识别播放结束后
迟到的声学检测；不得宣称回声消除已通过。最新结果和现场步骤见
[MOD-14/15 验收记录](../voice/ACCEPTANCE-20261013.md)。
