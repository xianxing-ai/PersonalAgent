# MOD-14/15：期限与释放修复、实机验收交接

- 目标：`huawei_ict_agentarts`，MOD-14/15，PA-007/PA-021；负责人 zemeng。
- 工作树：`.worktrees/zemeng-voice-completion`；分支 `codex/zemeng-voice-completion`；起点 `5b581139`。
- 本增量为可审查离线修复；整体 MOD 仍 `in_progress` / `provisional`，不宣称 done。
- 首次两个增量位于 `packages/voice/` 与 `packages/voice-wake/`；后续分工正式增加
  Desktop `voice-input-core.js` 及其两份直接测试。未修改 main.js、models、公共 contracts、
  根装配、依赖/锁文件、数据库或共享 ROADMAP。

## 已交付行为

1. Wake 源异步/同步就绪后复查授权及调用方期限。即使休眠导致 timer 迟到，过期源
   不再发布 listening，迟到句柄只释放一次。
2. PCM 唤醒组合在 detector/capture 就绪边界及每帧/检测回调复查期限；过期不启动
   新采集、不投递帧或唤醒，关闭两个句柄。公共端口形状未变。
3. SIS 复查 token、HTTP/body、播放及最终结果的实际期限；非合作 transport 取消后
   迟到的 Response body 仍被取消。token/fetch/playback 原始异常不对外回显。
4. SIS 每段 WAV 的成功、失败、取消/打断共用第一次释放 Promise。播放结果失败也先
   等待 release；缓冲在释放结算后覆零。释放失败保持可观察，真实 VoiceSessionManager
   拒绝再次开会话；停止语音仍不调用 task.cancel。
5. 提供 `scripts/check-wake-readiness.mjs`：仅启动固定原生宿主和限定词语法，经 stdin
   提供生成的 100 ms 静音，然后关闭。启动期限为 15 秒；不打开麦克风或扬声器，
   不读取凭据、不联网。成功也只证明引擎就绪及本地句柄关闭，不证明中文命中或设备。
6. SIS Base64 使用有界线性扫描，修复合法 4,096,044 字节 WAV 在旧重复分组正则中
   栈溢出的问题；仍拒绝非法字符、长度和 padding，不放宽原大小上限或 WAV 校验。
7. VoiceSessionManager 在调用 provider 前登记操作；recognize/consume/speak 内同步
   stop 也必须等待最终返回的句柄释放。识别、消费和播放失败或打断时，释放完成前
   不恢复 listening；迟到的 stopSpeaking 回执不能覆盖新识别状态或会话终态。
8. PCM 起动或释放失败后禁止在同一 port 重开 attachment；Windows System.Speech
   并发及重复 dispose 共用释放 Promise，全部调用都等待所有 child close。
9. Desktop 听写在最终 cleanup/revoke 延迟期间被取消或销毁，不再回填旧草稿；手动和
   共享听写都在投递前复查 sessionDeadline。普通 cleanup 不被当作取消，正常听写仍
   只生成可编辑草稿；并发 cancel 清空 UI 错误不再导致 finishCapture 返回空异常。

## 首次增量验证（提交 `185185ce`）

环境：Windows x64、Node **24.15.0**、npm **11.12.1**，此工作树独立安装必要 workspace
依赖，未复用其它工作树 node_modules。仅构建 contracts → client → voice-wake → voice。

| 检查 | 结果与证据边界 |
| --- | --- |
| 两包 TypeScript 构建及 `--noEmit` | 通过；不等于设备可用 |
| 原生 `build-host.mjs` | 通过；生成的 exe 不提交 |
| 两包全部测试 | 最终 144/144，其中 SIS 定向 14/14；全部是合成/Fake 证据 |
| Desktop 消费测试 | 39/39；真实 Host/Core/Voice 代码，permission、设备、ASR、HTTP、播放均为 Fake |
| 架构检查 | 3/3 |
| preflight 脚本语法、`git diff --check` | 通过 |

以上完整测试属于首次增量；后续修复使用下面的定向检查，未重复整包/全仓检查。

对应命令（在仓库要求的 Node/npm 环境，从本工作树运行）：

```text
node node_modules/typescript/bin/tsc -p packages/voice/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/voice-wake/tsconfig.json --noEmit
node packages/voice/scripts/build-host.mjs
node --test --test-isolation=none packages/voice/test/*.test.mjs packages/voice-wake/test/*.test.mjs
node --test --test-isolation=none packages/voice/test/huawei-sis.test.mjs
node --test --test-isolation=none apps/desktop/test/wake-voice-host-integration.test.mjs apps/desktop/test/voice-input-core.test.mjs apps/desktop/test/panel-voice-lifecycle.test.mjs apps/desktop/test/huawei-sis-playback.test.mjs
node --test --test-isolation=none tests/architecture/*.test.mjs
node packages/voice/scripts/check-wake-readiness.mjs
```

首次默认测试隔离子进程受到 sandbox `spawn EPERM` 限制；改用 Node 支持的同进程测试
模式通过。原生 C# 编译也先遇到 `spawn EPERM`，经平台授权后成功。依赖首次离线安装
缺 `undici-types` 缓存，经平台网络授权后安装成功；没有变更锁文件或版本。

### 后续增量的定向验证

- `tsc -p packages/voice/tsconfig.json`：最终源码通过。
- 最终生命周期调整：`provider-start-lifecycle`、`voice-session`、
  `resource-release-failure` 三个测试文件共 **32/32**。
- PCM 禁止失败后重开：`pcm-source-lifecycle` **7/7**；Windows 重复释放：
  `windows-system-speech` **8/8**；SIS 大 WAV 与 padding：`huawei-sis-wav` **3/3**。
- 在中途桥接改动上运行的既有 `concurrent-start`、`terminal-playback-release` **4/4**。
  这些未在最后的 catch 顺序调整后重跑；最后调整由上面的 32 项覆盖。
- 新增测试只使用合成 PCM/WAV、Fake 供应商、内存 transport 和受控 child；无麦克风、
  扬声器、网络或真实账号调用。最终 `git diff --check` 通过。

最终必要回归命令：

```text
node node_modules/typescript/bin/tsc -p packages/voice/tsconfig.json
node --test --test-isolation=none packages/voice/test/provider-start-lifecycle.test.mjs packages/voice/test/voice-session.test.mjs packages/voice/test/resource-release-failure.test.mjs
```

顺序调整中曾出现两项既有 interrupt 回执回归，已经修复：中断成立后再整会话 stop，
释放成功仍返回 interrupted，同时保留 stopped 终态；失败释放不恢复监听。最终 32 项
包含这两项。按当前工作要求停止等待/轮询 CI；不把远端 CI 或合并状态写成已通过。

### Desktop 听写取消增量

主对话后续明确分配 `apps/desktop/electron/voice-input-core.js`、
`voice-input-core.test.mjs`、`panel-voice-lifecycle.test.mjs` 与本记录，复用同一分支/PR。
显式取消标志独立于正常 cleanup 使用的 AbortController：手动取消、匹配共享租约的
直接取消及父 signal 撤销都立即标记；dispose 和 sessionDeadline 在最终投递前再次检查。
cleanup 仍共用一次释放，不触发 task.submit、task.cancel 或自动播报。

仅运行修改文件语法检查和两份直接消费者回归：**26/26**。新增六项覆盖延迟最终 revoke
后的正常成功、手动取消、销毁、期限到达，未 abort signal 的共享取消，以及识别完成后
隐藏/重开面板；包含真实 VoiceSessionManager/PCM 组合，供应商、设备与释放回执均为 Fake。
没有重跑前面的 32 项包测试、全仓检查、桌面冒烟或真实设备调用。

```text
node --check apps/desktop/electron/voice-input-core.js
node --test --test-isolation=none apps/desktop/test/voice-input-core.test.mjs apps/desktop/test/panel-voice-lifecycle.test.mjs
```

### 本机原生就绪读回（真实进程，非真实音频）

2026-10-13 09:25（Asia/Shanghai）运行固定脚本：`ready=false`、
`failureCode=UNSUPPORTED_CAPABILITY`、`closeReason=unavailable`、
`releaseConfirmed=true`、`syntheticBytesAccepted=0`、`detections=0`。
宿主已编译，但当前中文关键词引擎没有进入 ready；本轮未进一步安装/修改系统语音组件。
没有打开真实麦克风/扬声器，没有录音或调用 SIS/Live/AgentArts；不能把零检测解释为
静音识别通过，也不能把进程关闭解释为物理麦克风释放。

## Desktop 接线与后续修复记录

当前基线已有组合，不需新建调度器、语音 wire 或第二套 Runtime：

- `apps/desktop/electron/main.js` 的 `initializeSisVoice()`（基线约 2604 行）创建 SIS、
  共享 PCM、听写 consumer 与 Wake；Live 装配约 2757 行。公共包修复直接由原消费生效。
- 分配说明里的 `apps/desktop/src/features/voice/` 当前不存在；Renderer 实际位于
  `apps/desktop/src/app/` 的 microphone/Live/SIS 文件。本包未迁移目录或修改 UI。
- **已修复并定向验证：手动听写迟到草稿。** 原 `electron/voice-input-core.js` 的
  `finishCapture()` dictation 分支在 cleanup 后只检查共享 parentSignal，手动模式没有
  signal；曾使用真实 VoiceSessionManager/PCM 和延迟 Fake revoke 复现 `lateDraftCount=1`。
  后续获得该文件所有权，增加独立取消标志与最终投递守卫，两份测试现为 26/26。
  `main.js` 的 `stopPanelVoice()` 保持原样，测试覆盖其实际函数调用 cancelCapture 后的
  延迟释放/隐藏/重开场景；Fake 无迟到草稿不构成真实设备或桌面现场验收。
- Desktop README 和接口目录里“main 仍只有堆叠语音/未接 Wake”的部分文字落后于源码，
  由根集成所有者同步；`voice.start/stop` 公共 wire 仍 unavailable，不因本机 IPC 改级。

## 现场验收继续步骤

所有麦克风/出机操作必须在用户现场明确启用后执行。默认关闭不能靠自动打开录音验证。
只用用户同意的短测试语句，记录元数据、时间与结果，避免把私人音频/转写放进仓库。

| 场景 | 准备与通过所需读回 |
| --- | --- |
| 引擎 | 在最终目标机完成 zh-CN 识别组件配置后重跑 readiness；缺组件继续明确 unavailable，不回退 Fake |
| 按键听写 | 可信可见面板明确授权；录音标志可见；结束后 track ended/context closed；SIS 返回测试句草稿，可编辑且未自动提交任务 |
| SIS 播报 | 显式播报测试回复；听到真实扬声器输出，打断后无后续片段；停止播报不取消已受理任务 |
| Wake | 默认 off；显式启用后有限 expiresAt，双 ready 和单物理流；“你好小派”命中后复用相同租约听写；结束听写仅释放自己的引用 |
| 撤销/期限/故障 | 分别验证关闭、隐藏、导航、设备断开、renderer 退出和原租约到期；track/context/detector/ASR 最终回执都可读，迟到草稿被丢弃；不明则 release_unconfirmed 并锁住重开 |
| 回声/误触 | 记录明确正词、相似负词、噪声和播放回声的输入条件、样本次数/时长、实际命中/误触数；同时覆盖播放结束后的迟到检测。现有 callback-time 抑制不等于声学回声消除 |
| Live 互斥/打断 | 使用已配置且获授权的真实 Live；Wake 先确认释放再启动 Live，双向音频与打断可听；停 Live 读回设备与连接结束；不隐式取消后台任务 |
| Competition 联合 | 语音显式提交工作，经当前 AgentArts/Policy/ToolGateway 和目标系统读回；在同一文字任务视图查到真实状态/Evidence，再语音查询进度。已有 WSS 文本成功不是本项证据 |

当前缺少上述实机与真实服务回执。安装语音组件、供应商配置有效性、识别准确率、
回声、物理设备释放及完整 Competition 语音闭环均未据此完成。

## 交付与恢复

本地实现、必要验证及自审完成后提交独立 PR；提交/PR/CI 的最终状态以 Git/GitHub 为准。
拟非作者审查：goo122（尚未请求/确认）；拟合并：zemeng5208，仅在一位非作者对当前提交
有效 Approve、必要检查通过且无阻断后。此记录不构成批准，也未发送审查通知。
修复无持久化/Schema 迁移；需要回退时通过正常 revert PR 恢复原包，不清理用户数据。
