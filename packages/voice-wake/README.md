# `@personal-agent/voice-wake`

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-15（zemeng5208）。产品流程：F02；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

统一语义裁决默认在华为国内MaaS唯一决策配置；本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。独立节点按真实依赖并行，影子/历史评估默认后台。

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

MOD-14 等本地宿主可通过 `subscribeLifecycle(listener)` 只读观察固定三字段
`{state, sessionId, expiresAtMs}`。注册时同步收到冻结的初始快照；之后只发送稳定且变化的
`listening`、`disabled` 或 `disposed` 快照。返回值是幂等退订函数。监听器异常彼此隔离，
该通道不携带文本、音频、外部错误、授权对象或 Runtime 能力，也不能修改控制器状态。

`@personal-agent/voice-wake/testing` 公开导出 Fake 时钟、授权端口和事件源，仅用于离线
生命周期测试，不能冒充真实麦克风、识别成功或实机误触/回声指标。模块仍需 MOD-14
装配、真实硬件验收及非作者评审后，才可评估后续接口状态。

`createPcmKeywordWakeSignalSource(pcm, detector)` 是结构化接线入口：由可信宿主注入同一路
授权 PCM 帧源和已经配置固定中文唤醒词的检测器，本包不导入 MOD-14，也不打开第二个
麦克风。检测器的限定词表 `ready` 和音源的真实捕获 `ready` 都成功后，异步订阅才完成，
随后生命周期才可发布 `listening`。缺少任一 `ready`、源结束、取消或过期均失败关闭；
迟到回调无效，句柄释放可等待返回订阅的 `closed`。音源 `closed` 只证明本订阅引用释放，
若 ASR 仍在使用同一物理麦克风，须由宿主检查最终引用和设备 track 才能证明完全关闭。
MOD-14 的 #156 音源和 #169 限定词检测器已提供所需端口；可信宿主的真实组合、
目标机中文引擎及设备读回仍需验收，不能据此声明生产唤醒已可用。
