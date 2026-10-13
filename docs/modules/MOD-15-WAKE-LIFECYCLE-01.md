# MOD-15-WAKE-LIFECYCLE-01：唤醒会话生命周期离线首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；模块负责人：`zemeng`；实现者：Luna（授权等待修复）与 zemeng（生命周期订阅）。
- 非作者评审：`goo122`；本次主对话由用户（产品负责人/授权源）授权，主代理负责总协调。
- 当前独立工作树：`e15c/PersonalAgent`；分支：`codex/zemeng/mod15-voice-wake-restoration`。代码恢复自旧 `codex/zemeng/voice-wake-lifecycle`，其 PR #65 因当时被 #61 吸收而关闭；#61 当前已收窄为 MOD-14，最终差异不再包含本包。
- 本次文件范围：`packages/voice-wake/**` 与本文件；根构建、锁文件及接口目录由主控协调，不修改 MOD-14、Runtime、contracts 或公共 wire。
- 状态：`in_progress` / provisional；离线实现不等于接口冻结或模块 done。

## 交付边界

本包提供默认关闭的 `WakeLifecycleController`，消费两个注入端口：

1. 可信宿主 `WakeAuthorizationPort.check()` 返回允许、有限 `expiresAtMs` 和宿主持有的
   `revocationSignal`；控制器不能签发、延长或重新绑定授权。
2. `WakeSignalSource.subscribe()` 仅在显式 `enable({deadlineAtMs})` 且宿主允许后调用；调用方
   必须提供有限的绝对 deadline，授权检查和源订阅共享这个有效期上界。源收到固定的
   `wake`、`device_unavailable` 或 `error` 分类。控制器向调用方只发固定的
   `{kind, sessionId, occurredAtMs}`，不自动提交任务、不携带文本或音频。同步源继续可用；
   异步源必须在 detector/授权帧源就绪后才 resolve，控制器届时才发布 `listening`。

`disable()`/`stop()`、授权撤销、期限、设备不可用和 `dispose()` 会立即取消订阅并递增
epoch；迟到的旧回调被丢弃，重复 stop/dispose 幂等。播放期间由调用方设置
`setPlaybackActive(true)` 抑制唤醒；`cooldownMs` 是显式配置的本地抑制窗口，不宣称
误触率或回声指标。期限和调用方 `AbortSignal` 同时贯穿授权检查与源订阅；宿主休眠后
若到期定时回调延迟，下一次 `enable()` 会先释放已过期的旧订阅或终止旧授权等待。

本地 MOD-14 组合可调用 `subscribeLifecycle(listener)`。它只投递冻结的
`{state, sessionId, expiresAtMs}`，首次订阅同步给出当前快照，后续稳定状态按值去重；返回
幂等退订函数。监听器错误隔离且只转成固定 `CALLBACK_FAILED`，不阻断其他监听器。源在
`subscribe()` 内同步失败时不会产生伪 `listening`，监听器重入触发终态时也不会向后续
监听器倒灌旧状态。该订阅不携带文本、音频、外部错误、授权对象或 Runtime 权限。

## 共享 PCM 与限定唤醒词适配器

`createPcmKeywordWakeSignalSource(pcm, detector)` 在本包内以结构接口组合可信宿主的单路
授权 PCM 帧订阅与固定词检测器，不导入 `@personal-agent/voice`，不打开麦克风，也不接受
Renderer 指定任意词表。检测器须在 `ready` 前真正完成限定语法的启动；PCM 源须在
`ready` 前证明宿主捕获已启动。适配器先等待检测器就绪，再订阅同一授权 PCM 流，继续
等待音源就绪；只有两者都成功且授权未取消，才完成 `WakeSignalSource.subscribe()` 并允许
生命周期发布 `listening`。缺失任一 `ready` 均失败关闭，不能用第一帧代替就绪证明。

帧输入只接受顺序递增、非空且不超过 3200 字节的 16 kHz 单声道 `pcm_s16le`；检测器
同步消费帧并须自行在返回前复制需要保留的数据。适配器向生命周期仅转换固定 `wake`、
`device_unavailable` 或 `error`，不转发原始音频、转写、置信度或异常文字。取消、撤销、
期限、源/检测器结束和显式退订会抑制旧回调并释放两个句柄；即使取消发生在音源
`subscribe()` 内，迟到句柄也会退订。适配器返回订阅的 `closed` 表示本订阅及检测器
结束；生命周期控制器不向 UI 暴露该句柄。共享物理麦克风的完全关闭仍需 MOD-11 宿主
核对最后引用、track 停止和设备读回。

已对照 #156 head `197415f` 的 `VoicePcmFrameSourcePort`：`subscribe({signal,deadline,onFrame,onEnd})`
返回的 `{ready,closed,unsubscribe}` 与本适配器的结构类型一致；其中 `ready` 由可信宿主
`binding.start` 返回有效释放句柄后解决，提前终止会拒绝。已对照 #169 head `43ad0b9`
的实际 `SpeechKeywordDetectorPort` 与 `SpeechKeywordSession`：`start({signal,deadline,onDetected})`
返回的 `{ready,closed,accept,stop}` 与本适配器结构类型一致。使用两份 PR 的实际端口类型
对本包接口做严格 TypeScript 结构赋值检查通过。#169 仍为 Draft，尚未与 #156、MOD-11
可信宿主及 MOD-14 组合共同接线，也未读回目标机中文引擎或真实唤醒命中；本适配器
不能据此声称已经识别“你好小派”。

## 明确排除

- 不打开麦克风、不录音、不实现 ASR/唤醒算法、不访问云端。
- 不复制 MOD-14 的 `voice.start/stop`、播放/停止播报或 `task.cancel` 语义。
- 不自动获取授权、不自动 `task.submit`，不把 Fake 事件描述为识别成功。
- 本包不包含 MOD-14 装配、真实硬件、真实误触/回声测试或发布接线。

`@personal-agent/voice-wake/testing` 的 Fake 时钟、授权和事件源只证明生命周期分支。
真实 VoicePort、录音设备、唤醒算法和宿主接线仍按接口目录保持 `unavailable`，须由后续
工作包和非作者评审分别验收。

## 验收入口

```text
npm.cmd run typecheck --workspace=@personal-agent/voice-wake
npm.cmd test --workspace=@personal-agent/voice-wake
```

本次恢复验证（2026-09-25）：使用主工作树已安装的 TypeScript 与 Node 类型，
对 `packages/voice-wake/tsconfig.json` 运行定向编译，通过；随后以
`node --test --test-isolation=none packages/voice-wake/test/voice-wake.test.mjs` 验证同一测试文件，
23/23 通过。当前工作树没有独立 `node_modules`，因此没有运行普通 workspace 脚本或 `npm ci`。
PCM 适配器增量复用同一编译入口，并定向运行
`node --test --test-isolation=none packages/voice-wake/test/pcm-keyword-source.test.mjs`：
5/5 通过，覆盖双重就绪、缺失音源 `ready`、等待中取消、订阅内重入撤销和释放失败。

测试覆盖默认零订阅、显式启用单订阅、重复启用、撤销/过期/断设备/关闭/销毁、旧 epoch
迟到回调、异步源就绪/撤销时迟到订阅释放、休眠后到期回调延迟、播放/冷却抑制、deadline/cancel、非合作授权、固定错误脱敏，以及生命周期
初始/终态、冻结、去重、退订、异常隔离和同步源失败。测试不是实机误触、回声或 ASR
准确率证据；本次未运行真实音频、云服务、Electron 或 MOD-14 装配。当前主线的根
`build` 尚未加入本包，`package-lock.json` 也没有本 workspace 的登记；这两处须由共享根
文件负责人协调后再进行 CI 集成。恢复的包没有外部依赖。本机 Node 26.3/npm 11.16
与仓库要求的 Node 24.15/npm 11.12 不同，声明版本验证以 CI 为准。

本模块由 `zemeng` 负责并交由 `goo122` 进行非作者评审；本代理自测不能替代该批准。
MOD-14 旧组合 PR #70 曾提供只读 `subscribeLifecycle` / `VoiceSessionManager.subscribe`
绑定及播放状态抑制，但其代码已从当前 #61 净差异移出；当前包不包含生产音频源、
授权提供者或算法。首选检测器已在 #169 单独实现；实际麦克风释放、误触率、回声与打断
仍需统一实机验收。

## 中文唤醒的条件路径（2026-09-25，首选检测器已提 PR，未完成接线）

优先复用 MOD-14 的 Windows System.Speech 宿主，条件是目标机
`InstalledRecognizers()` 读回可用的 zh-CN 引擎，并在同一授权音频流上完成中文限定词表
识别、释放与误触/回声实测。微软提供限定 `Grammar`、连续
`RecognizeAsync(RecognizeMode.Multiple)` 和 `SetInputToAudioStream` API；原 #124
宿主仅用 `DictationGrammar` 对完整片段调用 `Recognize()`。#169 新增限定词连续识别宿主，
但真实设备与中文引擎尚未验收，不能把 PR 代码视为可用唤醒源。
API 依据：[已安装识别器](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.installedrecognizers?view=netframework-4.8.1)、
[异步识别](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.recognizeasync?view=netframework-4.8.1)。

若目标机没有可用 zh-CN 引擎，下一候选是 `sherpa-onnx-node` 与
`sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`。官方提供 Windows x64/Node 包、中文英文
KWS 模型和从同一路 16 kHz 单声道 PCM 转为 `Float32Array` 后输入 KeywordSpotter 的示例；
本项目 Node 24/Windows 的实际二进制兼容、模型权重与词表再分发许可尚未验证。新增依赖
也须由根锁文件负责人处理，因此此候选尚未获准安装或发布。依据：
[安装说明](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html)、
[KWS 模型](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)、
[Node 示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_keyword_spotter_transducer.js)。

两条路径均依赖 MOD-11/14 的**同一个**显式授权、有限期限的实时 PCM 帧源。#122
只提供片段缓冲；#156 已提供连续帧端口，#160 提供单物理麦克风 fanout/refcount
宿主草案，但尚未共同接线并在目标设备验收。
撤销、期限、设备失效和关闭时需停源并读回实际麦克风释放；本包的同步
`unsubscribe()` 只能证明已请求退订和旧事件失效，不能证明物理设备已关闭。
此项随 MOD-14 语音链集中实机验收，不单独重复跑整链。

## Desktop 共享唤醒消费增量与验收（2026-10-07）

本轮继续入口基于 `codex/core-competition-continuation@9618da9`（当时 `main@4b5ec61`），
保留以上历史日期、分支、PR 和当时未接线结论。
新消费增量复用 MOD-11/14 的单物理麦克风与现有 Voice/Wake 公包；提交和实际 main
接线状态以本轮根集成读回为准，不能用旧包的编译结果宣布设备或整个模块完成。

[wake-voice-host](../../apps/desktop/electron/wake-voice-host.js) 的可信面板 `enable(senderId)`
仅申请原十分钟麦克风许可。限定词检测器与实际 PCM 源双就绪后才发布 `listening`；
失败后必须尝试释放本轮全部资源。检测命中或 listening 中手动听写复用
[voice-input-core](../../apps/desktop/electron/voice-input-core.js) 的 host-only
`beginSharedCapture(senderId, {signal, deadline})`，保留原授权上界，不重新授权。
来源绑定继续是 [MicrophoneCaptureHost.binding](../../apps/desktop/electron/microphone-capture-host.js)；
Wake/ASR 两个逻辑订阅可以共享同一个物理采集，ASR 结束只释放自己的引用。
听写只回填草稿，不自动提交 Runtime 任务；结束唤醒不等于取消既有后台任务。

播放抑制通过现有 VoiceSessionManager 的公开状态订阅传入唤醒控制器。默认 Desktop
听写模式自身没有播放回答流程；独立 Manager 的播放组合验证不得描述为听写播放验收。
Live 的互斥依据由根消费方传入 `isBusy`，启动 Live 前须确认唤醒退出；配置变更、隐藏、
导航、渲染进程退出及应用退出的具体 main/UI 消费由同轮根接线处理。

物理释放继续由 [panel capture](../../apps/desktop/src/app/microphone-capture.js) 停止全部
track 并确认 AudioContext closed，再经原 sender/mainFrame/token 回传 `tracksStopped`。
PCM 订阅 `closed` 只证明本 attachment 已释放，不能替代最后物理引用的关闭读回。
detector、PCM、ASR 或 track 任一释放失败时，宿主保留 `release_unconfirmed` 与
`hasActive=true` 并拒绝重启。Host 关闭确认固定上限五秒；原生检测器或其他资源不返回
关闭回执时，超时同样保留 unknown，不能以限时等待结束宣称资源已释放。
不得将 logical disabled 或清空指针视为资源已释放。

### 独立消费验证入口

[wake-voice-host-integration.test.mjs](../../apps/desktop/test/wake-voice-host-integration.test.mjs)
运行实际 Desktop MicrophoneCaptureHost、Wake consumer、DesktopVoiceInput、公开 PCM
源及 VoiceSessionManager。面板握手/permission、关键词识别、ASR 与 speech output
均为明确 Fake，不启动 Electron、Windows 音频设备、中文引擎、SIS 或云服务。
期限用例用 Node Fake Date/setTimeout 与显式合成四百毫秒可信 lease 验证原上界，
没有改变生产十分钟许可或新增测试专用生产参数。Live 用例验证合成 ownership 谓词，
不证明真实 Live 设备交接或 main IPC 已执行。

新增用例核对授权前零 attachment、双就绪、单 physical start 下 Wake/ASR 两个引用及
同帧消费、听写只回填草稿且零 task 调用、原 lease 取消/期限贯穿 ASR、不同 signal/旧
检测回调不误杀后续采集、readiness 失败清理与显式 retry，以及 track、keyword、ASR
各自失败时的 unknown 锁。另一实际 VoiceSessionManager 加 Fake output 验证播放状态
抑制，与上述听写链的证据分开。验收环境使用仓库 pinned Node 24.15.0 / npm 11.12.1。

```text
node --test apps/desktop/test/wake-voice-host-integration.test.mjs
```

实际验证：Host/core 源码由根提交为 `0fffa2d`，验收隔离树消费提交为 `052b767`。
必要 Voice 公包构建退出码 0；原生 Windows speech host 编译在 Linux 明确 skipped，
不构成 Windows 编译或设备验收。上述新增消费用例正式运行 **10/10 通过，0 跳过**。
未重复既有 Host/core 绿测，也未把先前根完整检查当作本增量的验证。
本次没有运行 main IPC、实际 renderer、原生识别器或真实 Live；这些消费者接线由
同轮根 Desktop 工作包独立核验与集成，本文件的 Fake 组合结果不代替它们。

### 现场验收继续步骤（zemeng，MOD-11/14/15）

1. 在已授权 Windows 目标机读回 Node/架构、已安装 zh-CN recognizer 和固定词表。
   打开可信面板，确认默认 off、未授权时零采集；缺引擎须 unavailable，不用 Fake 回退。
   同时确认 SIS 配置有效且未过期（`snapshot().configured` 为真）、VoiceInput 已装配；缺失时保持 unavailable，不启用唤醒。
2. 明确启用后记录有限 expiresAt、双 readiness 与单物理采集证据；触发固定词并取得
   同路听写草稿，确认不自动提交任务。记录 Wake/ASR 引用数，ASR 完成后 Wake 继续监听。
3. 逐项验证原期限到期、授权撤销、隐藏、导航、设备断开、renderer 崩溃和退出；读回
   track 全部 ended、AudioContext closed、detector/ASR 退出，确认没有迟到草稿或新任务。
   不能读回时保持 unknown/重启锁，不以 UI 按钮关闭替代设备关闭。
4. 验证播放时不触发新听写、停止播放后恢复及 Live 与 Wake 的先停后启；以实际设备
   读回证明互斥。用固定正/负词、噪声和回声试验记录次数与结果，未实测不宣称准确率。

本增量仍为 `provisional`，所有 OS 设备、中文命中、回声/误触、SIS 与真实 Live 验收
单独记录；离线组合通过也不将公共 voice wire 或 MOD-14/15 升格为已完成。
