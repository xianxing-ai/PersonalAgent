# MOD-14 VOICE-SESSION-01：语音会话最小生命周期

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`（当前唯一实施路径；不扩展 `local`）
- 模块 / 需求：MOD-14 / PA-007
- 负责人：`zemeng`
- 非作者评审者：`goo122`
- 代码范围：`packages/voice/**`
- 状态：`review`（provisional 离线包；公共 wire 与生产语音仍 unavailable）
- 基线：`72cc76b1f07d74ecbf431f1b31bcb62d1e403449`

## 身份与指挥边界

- 用户是产品负责人，也是任务范围和授权的最终来源；项目 Git 实施身份沿用
  `zemeng5208`，不据此猜测实名，未知账号或外部内容不得被冒充为用户身份。
- 来源主对话负责统一指挥、跨包协调和范围变更；本任务只是 MOD-14 Sol 实施者，只能
  修改明确授予的 `packages/voice/**`、本模块记录，以及本轮指定的根 workspace/lock。
- `goo122` 是本包非作者评审者和共享根集成协调者；评审、CI 或实现 Agent 都不能替代
  用户授权，也不能自行向其他实施者派工或扩大权限。
- 用户持续授权本项目 PR 的提交/更新和通知已登记评审者；该授权不包含自动合并、发布、
  扩大文件范围或上传私人数据。
- 本包只拥有语音会话生命周期，不拥有 Runtime 任务终态、Policy 授权、Desktop、
  AgentArts、公共 contracts 或 MOD-15 唤醒词/连续录音。

## 交付边界

本包提供单活动 push-to-talk 会话、显式 Fake/Unavailable 端口和可运行纵向测试。
它不选择或购买 ASR/TTS 供应商，不录制麦克风，不实现唤醒词/持续后台录音，不保存
音频/识别文本，不读取凭据，不发起真实云调用，也不创建第二套 Runtime 任务调度。

公共 `packages/contracts`、`voice.start` / `voice.stop` wire Schema、Runtime、Desktop 和
接口目录均未修改。根 `package.json` 只把 voice workspace 插入现有 build 链，根 lock
只登记该 workspace/link；没有新增或升级外部依赖。`VoiceSessionManager` 及下列端口是
本包拥有的 provisional 进程内消费面，不能据此把公共语音 capability 标为可用或冻结。

## 输入、输出与限制

| 边界 | 输入 | 输出 | 限制 |
| --- | --- | --- | --- |
| `SpeechRecognitionPort` | 调用方提供的 PCM S16LE / 16 kHz / 单声道音频、会话、locale、deadline、signal | 最多 8,000 字符的识别文本 | 60 秒且最多 1,920,000 bytes；包不打开麦克风；临时副本调用后覆零 |
| `TranscriptConsumerPort` | 识别文本、稳定 transcriptId、deadline、signal | 最多 8,000 字符的回复文本 | 只有调用方显式执行 `consumeTranscript` 才调用；本端口不得把停止等待解释成 `task.cancel` |
| `SpeechOutputPort` | 回复文本、replyId、locale、deadline、signal | 播报完成 | 只有显式 `speakReply` 才调用；`stopSpeaking` 只终止播报 |

所有供应商配置、凭据、上传目的地、数据出机授权和网络行为归以后由可信宿主注入的
适配器所有。本包默认注入 Unavailable，不以 Fake 冒充生产成功。快照、错误和 Fake
留存信息不含音频、识别正文或回复正文；供应商错误被固定错误码和固定消息替换。

`VoiceSessionManager.subscribe(listener)` 是 provisional 的进程内只读状态订阅，用于
可信宿主把 `playbackActive` 等快照状态同步给其他本地生命周期控制器。它在初始会话
可观察及每次 revision 更新后推送独立冻结快照，覆盖停止播报和终态；退订幂等，监听者
异常被隔离且不回显正文，通知中新增订阅从下一轮生效。该入口不打开设备、不检查或签发
授权、不提交/取消任务，也不是公共 wire 事件协议；真实音频与 Desktop 接线仍未验收。

通知按 session/revision 排队并去重；监听者重入触发更新时，不会向后续监听者倒灌旧状态
或重复终态。状态监听者在 `recognizing`/`consuming` 转换中同步停止或替换会话时，启动外部
provider 前会再次校验会话，已终止路径不会产生调用。每个 operation 的释放缓存首次 stop
原因与单一 Promise，终态停止和异步 `finally` 共享同一次释放，`resourcesReleased` 只在
该释放完成后确定。

## 状态机

```text
start
  -> listening
  -> recognizing
  -> awaiting_consume
  -> consuming             (调用方显式动作；不会自动 task.submit)
  -> awaiting_speech
  -> speaking
  -> listening

任一活动状态 --父 signal--> cancelled
任一活动状态 --deadline--> expired
任一活动状态 --stop--> stopped
旧会话 --新 start--> stopped/replaced；旧回调丢弃
speaking --stopSpeaking/interrupt--> listening；不调用 task.cancel
```

`stop` 重复调用返回同一个终态结果。终止会先中止 operation signal，再调用适配器的
幂等 `stop(reason)` 释放句柄并清除内存中的 transcript/reply。对已提交任务的业务取消
必须由调用方另外执行公共 `task.cancel`，不能由语音停止隐式触发。

## 依赖基线与验证

本包只使用 Node/TypeScript 标准能力，无新增第三方依赖，也不依赖 Runtime、Desktop、
Agent、ModelGateway 或具体供应商。Fake 测试覆盖：

- Fake 识别 → 调用方显式消费 → Fake 播报；
- 停止播报不取消/中止 transcript consumer；
- 父取消和 deadline 阻止后续输出并释放 operation；
- 被替换会话的陈旧回调不能污染新会话；
- 未配置供应商明确返回 `UNSUPPORTED_CAPABILITY`，外部错误不泄露私文；
- stop 重复调用幂等。

2026-09-24 对齐当前 main 后，定向 TypeScript typecheck/build 通过，
`concurrent-start.test.mjs` 与 `voice-session.test.mjs` 共 14/14 通过，架构依赖检查
1/1 通过。并发替换清理、订阅重入和 operation 单次释放修复保留。当前工作树未安装
`node_modules`，TypeScript 使用主工作树已安装的同版本编译器与 Node 类型运行；
本机 Node/npm 为 26.3.0/11.16.0，正式版本门禁以 CI 为准。

本记录的证据仅为 `mock`。真实麦克风采集、回声/VAD、真实 ASR/TTS、Windows 音频设备、
播报打断实机体验、数据出机同意、供应商费用/限流、Desktop 状态显示和公共 wire 接线
均未验收，因此 PA-007 与 MOD-14 整体不能标记 done。

## 根接线状态与剩余交接

1. 根 `package.json` 已在 client 后加入 `@personal-agent/voice`；唯一根
   `package-lock.json` 已离线刷新，仅增加 voice workspace 和 node_modules link。
   与当前 main 合并时保留了 main 的 Runtime deadline 测试和接口目录；共享根差异仅为
   voice 工作区构建顺序与 lock 登记，待 `goo122` 非作者复核。
2. 由受信 Desktop/Runtime composition 注入真实或显式 Unavailable 适配器；Renderer 不得
   持有凭据、直接上传音频或直接导入本包私有实现。
3. 若要公布 `voice.start` / `voice.stop`，先由公共协议负责人协调 wire 语义、音频
   Artifact/分片/背压和消费黑盒测试；现有 `voice.stop` 的 capture/playback 结果不能被
   私自解释为“只停止播报”。
4. 未来 Runtime adapter 只能把 `consumeTranscript` 映射成显式 `task.submit`；
   `stopSpeaking` 不得接线到 `task.cancel`。真实任务取消仍使用现有公共取消 API。
5. Desktop 尚未接线，真实麦克风验收尚未执行；在完成可见设备状态、真实 ASR/TTS、
   打断与数据边界读回前，接口目录继续保持语音能力 `unavailable`。

## 2026-09-30：首版 Live 宿主与共享历史修复

本节是后续 Desktop 消费增量，不改写上述历史 package 验收。当前根主控委派
MOD-14 对话维护 `apps/desktop/electron/live-voice-host.js`；P8 已在
`b34af799d27a2f4cc0d108d5c6dbc831f53edfce` 明确无在途编辑并交接。
实现基线为 main `803089919171d655b7a76c2df51cd2c297bf1d6f`，
profile 仍为 `huawei_ict_agentarts`。不修改原 voice package 或实时 provider，
不修改公共 wire、根 manifest/lock、SIS/Live 加密配置或 Runtime 的任务状态。

增量行为：

- `live-voice-history.js` 是原 `Conversations` 的进程内覆盖层，不建新任务库。
  磁盘写入失败不停止音频；失败消息保留到下次转写或开启 Live 时回补。
  UI 最近 20 条限制不会丢弃尚未保存的消息；同身份修订保留原创建时间，
  重放按消息 ID 去重，不按相同文字删除不同轮次。
- 初始和续接 Live 都合并文字任务与语音上下文，仅 `succeeded` 才作为成功回答；
  历史标为参考数据，宿主不会因恢复重发历史工作。
- 每个 `request_work` 独立绑定受理的 taskId。同 callId/同 goal 共享一次结果，
  换输入拒绝；并发失败只读本次 task，unknown/等待状态不宣称完成。
  consumer 工厂失败不再卡住会话。停止 Live 仍不调用 `task.cancel`。
- 停止期间等待在途连接完成释放，再允许新会话；连接关闭只调用一次。
  同步设备释放异常也继续清理其他资源，释放不明时禁止重开。

P8 消费合同：

1. 原宿主 API 保留，新增 `historyMessages()` 返回
   `{id,sessionId,role,text,createdAt}[]` 的独立副本，包含未保存覆盖层。
2. `readContext` 的持久语音消息必须保留 `id`，避免与覆盖层重复。
3. 文字上下文将 `historyMessages()` 与原 `Conversations.history` 按 ID 合并、
   按任务创建时刻截断；不把尚未保存的语音排除在文字后续轮次之外。
4. `onTaskSubmitted` 先保留受理 task 的内存 goal 关联，再保存 Desktop 元数据。
   元数据失败不能改写 Runtime 的受理状态。

验证：`node --test apps/desktop/test/live-voice-host.test.mjs
apps/desktop/test/live-voice-history.test.mjs` 共 18/18 通过；`git diff --check`
通过。覆盖多轮/续接/显式停止、失败回补与修订、并发 task 状态隔离、同 callId
幂等、consumer 工厂异常、在途连接关闭、同步释放失败及旧回调隔离。
独立合成夹具还实际读回原 `Conversations` JSON 文件：失败回补后的 user/assistant
与既有文字 task 共用该文件，修订同 ID 后重启读取不重复；未写入用户真实历史文件。
此证据为离线显式 Fake，仅证明宿主消费者行为；P8 的主进程/文字上下文消费、
真实千问双向音频与工具桥、物理麦克风/扬声器仍需在最终组合中分别验收。
磁盘持续不可写时，覆盖层不具备跨进程耐久性，不能宣称重启后仍保留未落盘消息。
当前增量为 `review` / `provisional`，不据此将 PA-007 或 MOD-14 整体标记 done。

## 2026-10-07：原面板与浏览器音频生命周期读回

本节是现有 PR #302 的独立消费证据，尚未合入 `main@4b5ec61`，保留前述历史结论。
使用原 panel HTML、Renderer、bootstrap、CSS/CSP 和 Chromium 原生 WebAudio；
IPC、Gateway 与桌面快照为显式 Fake；Live 采集回执为 Fake，PCM/WAV 为本地合成静音。
下述采集链使用浏览器明确的 Fake 设备，MediaStreamTrack/AudioWorklet API 实际运行。
没有调用真实 SIS、Live 或 AgentArts API，没有物理麦克风或扬声器验收。

- Live 正常链固定 head `70b506e8239f78b2376d27931fb764aaf869293c`：公开 Host 经原
  面板按钮收到 ready，原生 AudioContext 为 running/24 kHz；PCM 播放结束后原
  Renderer 发 drained，Host 恢复 listening。停止读回 context closed/stopped 后
  Host inactive；再次启动建立独立新 context，旧 context 保持 closed。ready/stopped
  各两次、drained 一次，Gateway close 与 Fake 麦克风授权/撤销各两次，console/pageerror 为零。
- 同一固定版本的故障链显式让 `context.close()` 拒绝：原 Renderer 报 error，Host
  经过原五秒确认期限保留释放未确认、active/hasActive 和错误原因。公开麦克风 Host
  的 Fake track 回执已 verified，而真实浏览器输出 context 仍 running；原面板手动
  录音与 Wake 禁用，重复 Live 点击没有新 context、Gateway 或麦克风授权。该结果
  证明两种资源读回必须分别核实，不能用采集回执推断输出已释放。
- SIS 播放固定 head `1a115444635d978191584f88f6e45efa86b1be14`：公开播放 Host 经原
  Renderer 对 50 ms WAV 实际 decode/resume/start/onended 后收到 completed，原生
  context 为 closed/44.1 kHz，Renderer 音频副本清零。第二个一秒 WAV 在 started 后
  并发停止，单一 stopped 回执、结果拒绝为已停止；两个 context 均 closed，音频副本
  清零，completed/stopped 各一次，error/release_failed 和 console/pageerror 为零。
- 采集链固定 head `5d68903956bd5614b9338fe2deae6318e877c4f3`：真实 localhost HTTP
  原页面和 MIME、原 CSP，经明确的浏览器 Fake media device/permission 开关，运行原
  AudioWorklet 与公开麦克风 Host/PCM source。两个逻辑订阅共享一个 native stream，
  均收到 16 kHz/3200 bytes 帧；释放首订阅后 track 仍 live，最后释放后实际读回
  track ended/context closed，Host verified。重开建立新代，旧代维持关闭，最终两代
  均 ended/closed，ready/stopped 各两次、console/pageerror 为零。最初虚拟 HTTP
  路由无法供 Worklet 独立加载的 AbortError 与生产清理读回保留；改用合法本地 HTTP
  后通过，没有放宽 CSP、禁用浏览器安全或修改生产源码。

私有诊断记录在 `.worktrees/mod15-host-20261007/.cache/review-evidence/20261007/`：
`live-native-webaudio-validation.md`、`live-native-webaudio-close-fault-validation.md`、
`sis-native-webaudio-validation.md`、`microphone-native-worklet-validation.md` 及相应
脚本、JSON、日志（包括首个 Worklet 宿主失败）。没有新增正式测试或重复
既有 Fake AudioContext 绿色套件。这些结果只核实真实浏览器 API 与公开 Host/原面板的
消费；Electron/Windows、实际 ASR/TTS、设备误触/回声、账号 API 和任务结果仍分别待现场验收。

## 2026-10-07：采集撤销与 Wake 原面板交错读回

以下新增独立场景固定源码 head `c7a619f6720ddc5d0002b910c739f626b9284ef9`，
没有修改生产源码或重跑上述已通过场景。使用原 panel/Renderer/Worklet/CSP、真实
localhost HTTP 和 Chromium 原生 track/context；浏览器设备、IPC/许可、keyword、ASR
以及 BrowserWindow 方法明确为 Fake。实际消费公开 Wake/VoiceInput/Microphone/PCM
Host；主进程相关路由从实际 main 源码提取执行，不等于运行 Electron。

- 采集迟到：原生 Fake-device track 已分配但 getUserMedia 返回被显式延迟。公开 Host
  撤销后保持 busy/未确认，没有提前 ready 或新授权；返回放行后原 Renderer 结束
  track，尚未建立 context，Host 最终 verified/revoked。因启动未返回 attachment，
  PCM ready 与 closed 均为 EXTERNAL_FAILURE；不能把 Host 的 native 句柄读回描述为
  attachment 成功完成。
- 采集关闭故障：track 实际 ended，但显式拒绝的 context.close 使 context 仍 running。
  Renderer/Host 保留 verified=false，PCM closed 拒绝；busy=false、订阅清零不能清除
  释放未确认锁，新授权仍拒绝，重复撤销不冒充已释放。
- Wake 正常听写：原按钮开启、Fake keyword 触发原听写，共享单一路 native 采集；
  原 talk 按钮完成录音后 Fake ASR 一次，actual onTranscript 只回填 textarea，Runtime
  调用零。Wake 继续监听且保留单订阅；原按钮关闭后 track ended/context closed、Host
  verified，已有草稿保留。
- Wake 取消识别：等待 Fake ASR 时按原 Wake 关闭按钮，中止 ASR signal、stop 一次，
  native 资源确认关闭、VoiceInput 无 active。迟到识别结果不会回填，音频缓冲清零，
  Runtime 调用零。恢复后的独立执行明确 exit0；首次私有等待条件错误记录保留。
- 面板收起：等待识别时按原收起按钮，actual hidePanel/stopWakeVoice 在资源 verified、
  Wake/VoiceInput 无 active 后才调用 Fake BrowserWindow.hide 一次；迟到结果仍丢弃。
  实际浏览器页面继续可见，不能将 Fake hide 方法调用宣称为 Electron 窗口已隐藏。
- 收起关闭故障：context.close 显式拒绝，track ended/context running；Wake logical
  disabled 仍为 release_unconfirmed/hasActive。actual hidePanel 不调用 Fake hide，
  面板 visible/pinned 保留；原 Wake/talk 禁用，实际 enable/record.start 路由也拒绝。
  迟到识别稿丢弃、音频清零；pressed=false 或 busy=false 不构成完整释放。
- 草稿与手动受理并发：Fake ASR 等待期间，用户原 textarea 输入并点击 send 一次；
  显式 Fake task.submit 受理被延迟。听写追加后原 draftRevision 保留新草稿，迟到受理
  不清除追加内容，按钮恢复。手动 payload 仅含点击时用户文字、手动提交一次、语音
  路径 Runtime 调用零；最终原 Wake 关闭确认 native 资源释放。此处没有真实 Runtime
  提交或云端执行。

各场景实际独立进程 exit0、pageerror/console error 为零。证据同前述私有目录中的
`microphone-native-late-acquire-validation.md`、`microphone-native-close-fault-validation.md`、
`wake-native-dictation-validation.md`、`wake-native-cancel-recognition-validation.md`、
`wake-native-hide-recognition-validation.md`、`wake-native-hide-close-fault-validation.md`、
`wake-native-draft-submit-validation.md` 及对应脚本、JSON、日志/截图。首次私有 helper
选择器匹配多个 textarea 的失败日志保留，修正 ARIA 定位后通过，未修改生产 Goal 控件。
这些结果仍不完成真实 Windows 中文唤醒、SIS/Live API、物理设备、回声/噪声或账号验收；
本模块继续 `review`，现场验收仍由原现场负责人执行。

后续独立 ended/retry 场景固定源码 `877c034ff46c4c8bfc540cd2391a84e956eb75ad`：
对 native Fake-device track 执行 stop 并显式派发 ended，是故障注入，不能称真实拔设备。
原 capture/Host/Wake 消费 device_unavailable，track ended/context closed、Host verified
后才允许原按钮显式 retry；待识别 signal 中止、迟到草稿丢弃、音频清零、Runtime 调用零。
新代分配后旧 keyword 回调不启动新的听写；最终关闭读回两代均 ended/closed。
独立进程 exit0、console/pageerror 为零，新增证据 `wake-native-device-ended-validation.md`
及对应脚本、JSON、日志/截图。未重跑前述正常/unknown 场景，不提升物理拔插或现场验收。

## 2026-10-07：原手动听写的重试与隐藏消费者

另两项原420 panel/CSP消费者实际exit0，没有源码修改或重跑旧正式套件。
原talk开始/结束经过实际VoiceSession/PCM、VoiceInput和MicrophoneHost，Chromium
context/track由明确Fake-device flags提供；ASR、许可、IPC和window为Fake。
首次结束先释放麦克风再等待ASR，识别失败经原core净化为“语音处理失败”，保留用户
在等待期间编辑的草稿。用户显式点击原按钮重试建立新的context/track，成功文字仅追加
一次到当时草稿，不自动提交任务；两代context closed/track ended、各6400B音频清零、
许可及识别handle各释放一次。正常失败/成功的ASR signal没有被abort，不能泛称中止。

另一独立消费者在手动识别pending时点击原close，Fake window派发原hide listener并启动
真实stopPanelVoice，探针另行等待聚合清理；hidePanel本身并不等待全部manual/Live释放。
此时ASR signal确实中止，handle停止、音频清零、Host verified；同renderer再次显示并
编辑草稿后，迟到Fake识别结果不追加文字、不重捕获。两项console/pageerror零，
manual-dictation-retry-consumer-*与hide-consumer-*保存原命令/JSON/日志/截图。
前者固定列明source和公开index，后者还固定全部已有Voice dist JS；不泛称全部依赖一致。
未消费Runtime，不代替真实SIS、物理麦克风或Electron隐藏时序验收。

## 2026-10-07：Live 双 native 链与聚合关闭反馈

固定源码 `4dc01f6f397e8d1e941fadc17ab031f95353b3de` 的新增独立原面板场景，
同时运行 24 kHz 输出 context、16 kHz Fake-device 采集 context/track/Worklet 和公开
PCM source；Fake Gateway 收到三个 3200 bytes 帧，没有真实音频上传。
实际 RuntimeClientTranscriptConsumer 经显式 Fake Runtime Client 提交一次并等待
不合作的 task.get；actual main 为同一任务保留 panel 关联。
原 Live 按钮关闭后等待被中止，native 两个 context closed、track ended、Host verified，
Gateway close 一次；已受理任务仍“结果待核实”，不 task.cancel 或重提。
迟到 succeeded 返回及旧 Gateway 回调均不能改草稿、任务界面或重新播放/提交。
此场景实际 exit0、console/pageerror 为零；证据 `live-native-runtime-wait-validation.md`
及对应脚本、JSON、日志/截图，仍非真实 Runtime/云/设备验收。

该固定版本的另一个 actual Live/main 复现显示：Live.stop 的既有 API 可以正常返回
error 快照并保持 hasActive 释放未确认，stopPanelVoice 仅检查 Promise 拒绝会误当
聚合关闭完成。现在在原 allSettled 结束后检查公共 Live.hasActive；所有清理仍尝试，
聚合拒绝由原 reportPanelVoiceFailure 显示固定错误。不改变 Live API、期限或任务取消。
新增实际 Live/Microphone/PCM 明确 Fake 组合与原四项共 5/5、语法/diff 校验通过。

独立原 native panel BEFORE/AFTER 让输出 close 显式拒绝：采集 ended/closed、Mic verified，
但输出仍 running/Live active；原收起的 Fake hide 回调随后执行聚合关闭。
修复前聚合 fulfilled、错误为空，修复后聚合 reject 并显示“语音资源释放未确认”；
Fake hide 已发生，本修复没有将其改成等待全部 Live 释放才隐藏。
待核实任务与 unknown 锁保留，迟到 task.get 不改变状态，两场景 submit/get 各一次，
不取消或重提。BEFORE/AFTER 各实际 exit0、console/pageerror 为零；首次私有 cleanup
重复关闭已 closed context 的 exit1 保留，纠正 helper 后才记录成功。
最终 main blob `f0f37bbefcb36dc5b413d89beb773d8104c535d8`；证据同私有目录中的
`panel-stop-live-unknown-fix-validation.md`、`live-native-panel-stop-unknown-{before,after}.json`
及脚本/日志/截图。IPC、Runtime/Gateway、BrowserWindow 和故障注入明确 Fake，
截图浏览器仍可见；没有 Electron 窗口、Windows、物理资源或真实业务终态结论。

后续原320手动听写重试消费者实际exit0，未重复420绿色流程：两轮原talk/native
Fake-device各6400B PCM，首次Fake ASR失败净化为“语音处理失败”并保留待识别时编辑的
草稿；明确第二次点击仅追加一次到当前草稿。两代context closed/track ended、音频清零、
subscriber0、许可/handle各释放一次；signalAborted实际false，Runtime调用0/errors0。
四阶段水平范围通过，原voice最终unavailable值保留，不称最终ready或物理设备验收。
证据manual-dictation-narrow-320-retry-consumer-*，六项具体source/dist blob前后相等。

原听写与提交交错消费者的两次实际exit1同样保留：pending重复click/Enter不追加提交，
迟到Fake task.submit回执保留新的听写草稿，明确第二次send提交精确新payload并只清
本轮未改草稿；无实际Runtime调用。唯一末尾严格几何失败为empty→Live后bar可用268而
scroll272，原send margin与窄屏grid造成内部4px溢出；按钮仍在viewport320及composer内、
无重叠/可见裁切。没有sharedCSS改动，不将功能断言成立写成完整消费者通过。
证据manual-dictation-composer-send-interleave-consumer-*及首失败日志。

原浏览器microphone permission denied/granted的新独立消费者实际exit0：原talk调用真正
getUserMedia得到NotAllowedError，未分配context/track、无ASR；Host error与stopped(true)
收据accepted、busyfalse/subscriber0、lastRelease stopped/verified true。界面却保守显示
“麦克风释放未确认”：公开PCM start失败未获得releaseHandle，closed合同特意reject，
voice core据此显示cleanup失败；宿主physical证明不能倒改这个公共合同。
不是Host锁死或泄漏证据，用户明确授权后原talk重试成功6400B听写、append一次、错误
清空、资源关闭/清零，Runtime0/errors0；最终voice.unavailable保留。CDP配置浏览器权限，
Fake-device/ASR/IPC/Host许可仍明确Fake，不是OS对话框/物理设备/SIS验收。证据
manual-dictation-native-permission-consumer-*；首CDP描述符错误和旧错误文案断言exit1
保留，最终完整资源/重试消费者才计通过。没有公共PCM或产品源码修改。

原close发生在manual acquiring的新组合实际exit0：native Fake-device stream已取得但
observer明确hold返回，原hide listener启动聚合停止；放行后实际context closed/track ended、
Host verified/subscriber0/许可撤销一次，PCM取得有效handle使aggregate fulfilled。
hold前track仍live/authorized busy，不能提前称已释放。ASR/dictation/Runtime调用0、草稿
保留；不同于上文start拒绝无handle的closed保守合同。证据manual-dictation-acquiring-hide-
consumer-*，child自身voice出口稳定、不借rootbuild；首无根据no-context断言exit1保留，
最终允许原native分配竞态、确认全部实际资源释放后才通过，仍非真实窗口/设备验收。

同一聚合修复的独立正常取消场景使用 child `ab7c5ef0979acc5f30870bfcc87c58c33ca1f180`：
24 kHz native output.resume 已执行，但返回被显式 hold；原面板关闭后 context closed、
Live inactive、聚合正常完成，尚未授权 Mic 或连接 Gateway。放行迟到 resume 不产生 ready 或新音源。
仅原按钮显式重试才建立新 output 和 16 kHz Fake-device input/Worklet；最终三 context closed、
track ended、Host verified，Runtime 调用零。此新场景实际 exit0、console/pageerror 为零，
证据 `live-native-resume-hide-validation.md` 及对应脚本、JSON、日志/截图。
resume hold、IPC 和 BrowserWindow.hide 明确 Fake，不能据此认定真实 Electron 或物理设备验收通过。

聚合修复与上述文档合入固定 `37c7f419a3d1c1cae0018c350162533256ddfb8a` /
tree `ac79880812fbd7608a713cc90acfc1a225c56599` 后，受影响 Desktop typecheck 与
工作区测试实际 exit0：587 项、576 通过、0 失败/取消、11 跳过，Node v24.15.0、
两核执行，完成于 2026-10-07 20:12:29 UTC。日志 `core-desktop122-live-aggregate-check.log`；
不据此宣称整个仓库、Windows CI 或真实场景已通过。

## 已保存 Live 快捷键的设置恢复（2026-10-08 续接）

原 ConfigHost 支持 F1–F24，原 select 只有 F1–F12；实际合成 F24 保存后重建 Host，
snapshot 仍 F24，但原 HTML select 为空，普通留空 key 保存被原 main/config 校验拒绝。
仅控件选项扩至24并设置稳定 value，保持默认F8、F9禁用/记事本提示与原保存/pending逻辑；
controls/test EXACT2冻结 manifest SHA256
a8cfd12d9f4354d7a73cdd7aa7a427caa125f82478283a54098fcf2a3dd73070。
原 UI d33996 actual1，新增两项正式回归原源码5pass2fail、修后7/7 actual0；原 panel/main/
ConfigHost after62ef71 actual0，F24 正常显示与保存，持久字节不变，0Live/音频/Runtime/云。
F13及F8/F9正式行为同时核对，未修改 main/config/CSS/许可。IPC、safeStorage及
globalShortcut明确Fake，不证明Windows物理快捷键、Electron加密或真实Live验收。

## 迟到手动录音回执的反馈顺序（2026-10-08 续接）

原手动录音start已成功，FakeIPC hold其回执；用户仍可及时finish。Fake ASR失败已由
当前finish显示主红字后，旧start成功却清空该区域，mic-state仍失败；原d63fb6 actual1。
仅 talk handler 增加动作序号及关闭保护：旧手动动作的success/error/finally不覆盖新动作；
当前success保留Host error，当前failure仍可报告，不以总pending或snapshot版本拦及时finish。
它不保证任意较新snapshot都抑制旧failure，其他handler与权限/Task合同保持。
renderer/new行为test EXACT2冻结manifest SHA256
de713722aa4230a58b1d95947997fd29887578b56f31d22c6f415d1e9c41e24b。
正式before2pass4fail、修后6/6 actual0；原消费者58c8ce actual0，先核当前finish主红字
再放旧start仍保相同错误。6400B PCM清空、context closed/track ended/Host release verified，
0dictation/Runtime/cloud，明确Fake-device/IPC/ASR，未宣称物理设备/SIS/Windows通过。
源码与正式/raw消费者及截图独立审核，本节之后根在新固定head执行必要完整检查。

## 连接中的 Live 显式停止（2026-10-08 续接）

原 Host 已发布 active/connecting、按钮已显示“关闭 Live”时，尚未返回的 start
回执使单一 toggling 标志吞掉第二次点击，原 main 的 stop 没被调用。只在最新
snapshot 已 active 时允许显式 stop 超越 pending start，分别标记 pending start/stop，
用动作 revision 防止旧 start 的 catch/finally 重开设置或覆盖当前反馈；初始 start
及 pending stop 仍防重复，当前 stop 失败可见并可明确重试。原保存、编辑和 F24
合同不变，未改 main/Host/CSS/音频/Runtime。
EXACT2 manifest SHA256 116551043dd3c9ade6e06a05fa6bd540e303dcc2eb52f19f3a762764da9b3c50，
sourcee2e49d4/test099bf5f9；正式旧源码3729e1 actual1（7pass2fail），修后d7cd85
actual0、9/9。fresh 原 HTTP/CSP renderer、LiveConfigHost/LiveVoiceHost/main
消费者60452/6701ef actual0：两次原 live.toggle IPC 的 start/stop token 对应，
Fake held Gateway 被 abort，Host inactive/idle，旧取消回执不恢复错误，尚未
分配麦克风或音源。IPC/window/storage/playback/Gateway 明确 Fake，无真实网络、
物理音频、Runtime task 或云验收；错误 helper 的 timeout/SIGINT 和原 before
77928/17c509 actual1 保留。根cf6f5ee已整合，完整检查结论另记。

## Live 显式重试成功后的错误反馈（2026-10-08 续接）

原首次 connect 失败后，明确第二次开启已到 listening/active，但设置仍显示旧连接
错误，before62132/c94db8 actual1。仅控件内部标记 toggle 错误所有权，重试捕获旧
标记，只有当前动作成功且该标记仍拥有反馈时清空；configure 的 pending/成功/失败
写反馈都取消旧 toggle 所有权。较新配置反馈、用户重开的 settings 和草稿保留，
不改保存关闭/凭据清除规则；旧 start 不能清当前 stop 失败，connecting stop 门禁保持。
EXACT2 manifest SHA256 5d26b559398817b26748428e747f299a88182253106641f2b07599bca8caceb1，
source8f6db419/test5d254e19。原新增7例84dec3 actual1（5pass2fail）；受影响完整
文件21cff4 actual0、16/16；成功进程未内嵌版本回执，冻结后同默认 PATH 环境观测
为 Node24.19，不能冒作该进程的独立版本证明。根固定1f548bb新完整检查用 Node24.15，
Desktop641/630通过11跳过，Runtime439/439；整仓唯一Calendar失败，结果另记。
fresh 原完整 HTTP/CSP renderer、持久 ConfigHost/LiveVoiceHost/main AST 消费者
11126/02b6d0 actual0：重试 listening/active、旧 result 清空、settings 仍开，
三次原 toggle IPC；stop 后 Fake source/session 各关闭一次、mic revoke2，Runtime0、
console/pageerror0。25 artifacts 核实；window/IPC/storage/Gateway/mic/source 明确
Fake，无真实 Electron、物理设备/音频、云账号/Provider 或 Runtime Task 验收。

## 启动时回补已有本地 Live 历史（2026-10-08 续接）

原 durable recovery cache 的待回补消息在新 Host overlay 可见，但正式主对话只读
Conversations，启动未调用已有 flushHistory，必须再次开启 Live 才能回补。仅在
原 main initializeLiveVoice 构造 Host 后调用原同步 local flushHistory；不启动
麦克风、Gateway、模型或 Task，不改 Host/store/协议/配置/quit 及未知释放保护。
写入失败保留 durable cache/degraded 和原2s unref重试，未保证每次启动写盘都成功。

EXACT2 manifest SHA256 eff4694d5ec1ae30d03da6e580694485cd13db9d2177d8db4a1d0d0d67efacd6，
main5146d65b/newtest2361a75a，25 artifacts。Node24.15 原源码4e8f38 actual1、0pass3fail；
修后89a5f3 actual0、3/3，覆盖重复重开、修订保原 chronology 及 sink 失败保留缓存。
fresh 独立已退出的 producer 进程存 pending1，再由原 main initializer/完整snapshot、
真实 History/FileStore/Conversations/Host 在新进程消费，4d68d7 actual0：正式主对话1、
持久重读1、cache pending0、activefalse/idle，0Mic/网络/Task，第二次 flush 幂等。
两进程内嵌 Node24.15，原 before75d7dc actual1 保留；formal 动态 voice import 与
时间端口为显式 Fake，fresh helper 使用真实 voice exports 但没有调用资源工厂。
这是本地 Node/文件的重启消费，不是 Electron、生产 userData、真实云或物理设备验收。
原 shutdown 未调用 dispose 的静态交接仍未改变；unref timer 不证明退出阻断，durable
cache 可由下次启动回补，不据静态遗漏宣称数据丢失。根新固定源码检查另记。

## Live 快捷键失败后的当前重试反馈（2026-10-08 续接）

旧快捷键首次失败后，成功热键或鼠标重试已listening/active，renderer仍拼接旧liveShortcut.reason。原main toggle共享操作revision、注册对象和自己错误token；当前同注册操作成功仅清自己旧错误，旧操作不能覆盖新F9保留原因/F24占用原因或新stop失败。原400ms门禁、active stop优先、配置/面板保护、原返回值与Error身份保持；不修改Host状态、未知资源释放或settings。fulfilled stop不构成设备释放验收。

maina7dfd5a5/newtest61bc26dd，仅两文件。最终manifest-v2 d26e35f69b38461e7524534d1b481a0fd86bb65251b26369956a796f629b50bd，24+原12 artifacts核实；V1初选相同bytes但非最终producer的配置路径，保留V1，V2绑定finalJSON配置。固定Node24.15原12项6通过6失败2c1bbb/1→完整12/12 abedae/0。fresh原main/Host/完整HTTP/CSP renderer热键16990/896cb3/0、鼠标22492/a2f4bb/0均内嵌24.15，旧reason清空、listening/active，随后原stop各source/session关闭1、mic revoke2、Runtime0、页面错误0。window/IPC/Gateway/mic/source为显式Fake；并非真实Electron/Windows快捷键、物理音频或云验收。A独审cc5d3e1a确认范围、全文及所有证据。
