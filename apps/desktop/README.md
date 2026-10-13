# PersonalAgent Desktop

## 2026-10-09 自有镜像 WSS 消费增量

Competition可信主进程已消费WSS传输及连接状态，此接入仍为 **provisional**。启用`PA_AGENTARTS_TRANSPORT=wss`时，必须显式提供`PA_AGENTARTS_WSS_URL`，没有自动推导的公网地址，也不会依次试探不同路径。地址限定同一 HTTPS 网关 origin 与运行时名称，只接受`/runtimes/{runtimeName}/ws`或`/runtimes/{runtimeName}/invocations/ws`这两个精确路径；明文、跨源、URL认证信息、查询参数与其他路径均拒绝。

官方目前只确认镜像内的`/ws`容器入口。直接公网`/runtimes/{runtimeName}/ws`没有已验证依据；`PREFIX_MATCH`的`/runtimes/{runtimeName}/invocations/ws`只有普通请求映射依据，WebSocket Upgrade 转发尚未证实。两个配置候选均不能据此宣称华为公开 WSS 已支持；实际公开地址、Upgrade、鉴权与连接生命周期须另行验收。

`PA_AGENTARTS_APP_TOKEN`与镜像`PA_AGENT_WSS_AUTH_TOKEN`匹配并只留在受信环境。`PA_AGENTARTS_HTTPS_FALLBACK=1`明确允许证明未发出invoke的连接失败使用同部署备用。降级/认证失败/未知核实可见，未知任务不会重发。既有未配置消费者保留HTTPS兼容。配置、实际TLS连接、Runtime和Desktop合成验证分别记录，不代表华为公开WSS或物理窗口验收。具体接口与余项见[镜像接口](../../docs/competition/OWNED_IMAGE_INTERFACES.md)。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 2026-10-07 原功能源码核对

本节核对 `main@4b5ec614` 已有入口；当前开发 PR #302 尚未合并，其新增修复不能记为该基线已交付。下文旧日期的记录保留原验收范围，模块状态继续为 `in_progress`。

| 功能 | 已有源码与消费入口 | 具体剩余边界 |
| --- | --- | --- |
| 桌面本机设置 | [DesktopHost](electron/desktop-host.js) 提供托盘及后台的“桌面设置与恢复”、偏好读取/保存、窗口恢复；[设置页](src/desktop-settings/settings.js) 和 [外壳](src/ui/desktop-shell.js) 消费本机偏好 | 这是 Desktop 本机设置，不是 Runtime `settings.get/update`；后者仅有 Schema/Fake，生产握手不公布且调用返回 `UNSUPPORTED_CAPABILITY`。物理多屏/DPI、真实崩溃及快捷键冲突仍须 Windows 验收 |
| 授权管理 | [后台](src/features/admin/view.js) 消费待处理审批、公开 `approval.list` 的脱敏分页历史及一次性允许/拒绝；[受信宿主](electron/evidence-host.js) 逐次检查会话与任务归属，消费已有宿主元数据读取和授权撤销端口并核对 grant 删除读回 | 不提供原始参数或 Evidence 内容；宿主撤销不是新增 wire operation，也不代表跨任务持续授权或完整凭据管理已完成 |
| AgentArts 配置与状态 | [后台模型页](src/features/admin/agentarts-model.js) 展示配置状态，并挂载 [配置控件](src/app/agentarts-controls.js)；[主进程配置](electron/agentarts-config.js) 负责 HTTPS 目的地校验、加密保存、恢复与撤销，配置路由消费 Runtime 启动结果并提示是否需重启 | `configured` 表示已持有配置，配置快照的 `runtimeReady` 只表示目的地可供本机装配；Runtime 启动成功、云端连接成功和真实任务完成分别核实。真实 deployment/version/trace、工具回传及云端结果仍待联合验收 |
| 文字会话与 Live 历史 | [会话元数据](electron/conversations.js) 持久化面板/工作区任务归属、每会话思考/辅助模型偏好及 Live 发言；任务恢复使用公开 `task.list/conversation.list/approval.list`，状态仍由 Runtime 决定 | 当前使用 `desktop-panel`、`desktop-workspace` 两个固定会话；显式创建、重命名、归档、删除和重试关联尚无公开生产 API，不能由 UI 另建任务或会话系统 |
| SIS 与 Live 语音组合 | 主进程 `initializeSisVoice()` 已把 Huawei SIS 端口、同一授权 PCM 源、[Desktop 语音消费](electron/voice-input.js) 及本机 WAV 播放装配；听写仅填输入框。Live 使用独立可信宿主和显式开启入口，业务工作仍经过 Runtime/Policy/ToolGateway | 本机 `voice.record.*`、播放及停止入口不等于生产 wire `voice.start/stop` 已公布；本轮未重新执行真实 SIS/IAM、麦克风、扬声器、Live 网络续连或 AgentArts 联合验收，也不撤回旧记录中用户确认听到 Live 的事实 |
| 有界唤醒 | 根 build/锁文件已包含 `@personal-agent/voice-wake`；`@personal-agent/voice` 已公开 `bindVoiceWake`、共享 PCM 端口和 Windows System.Speech 限定词检测器 | Desktop 尚未注册 `WakeLifecycleController`、可信唤醒授权和检测器组合，也没有显式启用入口；需先按已公布端口确认组合方案。中文识别器可用性、实际命中、误触、回声和设备释放另需 Windows 实测 |
| 受控编程工作区 | [WorkspaceConfigHost](electron/workspace-config-host.js) 与 Worktrees/环境控件已消费受限枚举、读取、补丁预览/暂存/条件应用及固定命令；许可绑定本次进程、任务 checkpoint 与代次，撤销不复活旧任务 | “写入和命令未交付”是历史状态；当前能力仍受权限、平台和已有文件限制。Artifact 服务、真实项目补丁/命令、Windows 恢复与 AgentArts 联合验收未完成，详见 [工作区设置边界](../../docs/modules/MOD-18-DESKTOP-WORKSPACE-SETTINGS.md) |

本节通过源码、公开接口目录和入口归属核对更新；没有运行真实云服务或设备验收。生产设置/连接器 wire API、会话管理 API 和完整持续授权仍按 [接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) 保持未公布边界。只读 AgentArts 状态页及唤醒首片的旧模块说明是历史增量记录，不能据其中“未接线/未纳入根 build”的旧结论否认当前已存在的代码，也不能据新代码宣布整个模块完成。

## 语音设备释放与配置编辑

### PR #302 的未合并唤醒增量（2026-10-08）

上表保留 `main@4b5ec614` 的基线含义；该main没有Desktop Wake宿主。现有PR #302的工作树已由 `initializeSisVoice()` 装配 [Wake宿主](electron/wake-voice-host.js)、共享授权PCM及限定词检测器，并提供可信面板的显式 `voice.wake.enable/disable`。单次许可最多10分钟，隐藏面板、撤销、停止或释放未确认仍按原生命周期处理，唤醒后的听写只填输入框。新增源码未合并，不记为main已发布；中文识别器、真实命中/误触/回声和Windows设备释放仍需现场验收。

本轮补充了活动任务拒绝退出前的资源保护，以及SIS配置保存失败时保留可显式重新启用的旧Wake宿主。原启动、晚到任务和未知释放守卫保留，不自动续退或复活许可；保存后资源释放未知不回滚已保存配置。原公开消费者及合成端口检查分记于[本轮集成交接](../../docs/modules/MOD-27-28-INTEGRATION-HANDOFF.md)，不能当作真实设备或云验收。

晚到任务阻止退出后，显式成功配置新的语音宿主会重新建立该宿主的退出清理归属；下次显式退出取消新宿主尚在识别的请求。初始化失败或旧资源释放未知仍保留原守卫。检查使用实际公开Voice/Config组合和合成ASR、app及设备回执，不证明物理设备验收。

### Goal审批到期的界面恢复（PR #302 未合并增量）

Goal任务只在原公开审批记录的身份、任务、工具、revision与状态全部匹配时展示原期限。期限缺失、无效或已过期时不提供批准/拒绝按钮；页面打开期间到期也会更新，点击时再次检查。刷新和取消目标任务仍可使用，已受理或受理未知的写入继续锁定，不能重复提交。界面时钟检查不替代Runtime原审批期限守卫，也不改变原授权或图版本；真实Runtime/SQLite与原完整HTTP页面的合成期限验证另记于本轮交接。

Live 输出和麦克风采集在确认音频上下文关闭（采集还需确认所有轨道停止）前保留当前设备归属；释放未确认时阻止新会话。单个清理步骤失败仍继续尝试释放其余资源，迟到回调和已注销页面的命令不会重新开启设备。停止语音继续与 Runtime 任务取消分离。

Live 配置保存期间可继续编辑。保存成功后，新修改保留为未保存草稿，宿主刷新不覆盖它；没有新增修改时才关闭设置并接受后续读回。正在处理的保存和界面启停请求不会重复提交。

上述边界由 `test/live-voice-playback.test.mjs`、`test/microphone-capture.test.mjs` 和 `test/live-voice-controls.test.mjs` 的合成测试覆盖；它们不证明 Windows 麦克风、扬声器或真实 Live 云端验收。

### 隐藏面板后的听写恢复（PR #302 未合并增量）

隐藏、主页面导航或 renderer 崩溃时，主进程请求关闭唤醒并取消活动的手动听写；
`cancelCapture` 中止该次会话，随后等待采集、识别和相关资源的释放确认。
迟到的旧听写不能重新填入草稿；停止语音不自动提交或取消 Runtime 任务。
仅隐藏同一存活面板保留当前输入草稿；导航重载和崩溃不承诺草稿持久化。
重新打开面板不会自动恢复 Wake 或录音，须在有效 SIS 配置及释放确认后显式开启；
原唤醒许可的取消与期限继续生效，不能借重开延长或恢复旧许可。
释放未确认时保持设备门禁；退出或重启不能作为物理释放已验证的回执。
此说明对应尚未进入 main 的 [PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302)，
不改变旧设备验收记录；实现与现场边界见 [MOD-14](../../docs/modules/MOD-14-VOICE-SESSION-01.md)
和 [MOD-15](../../docs/modules/MOD-15-WAKE-LIFECYCLE-01.md)。

## 2026-09-27 当前语音与主动提醒增量

本轮按 Competition Profile 区分两个入口：麦克风使用 SIS 听写，只填入可编辑输入框，
不自动发送；波形按钮和可配置快捷键开启原生 Live，千问负责连续听说，业务工作继续
由 AgentArts 与本地 Runtime / Policy / ToolGateway 处理。用户本轮已确认听到 Live
并能正常对话。期间几次停止是主代理操作，不能作为 Live 自行断连的证据。

Live 双方发言与文字混合展示、持久化、去重、定位及续连的新增代码已完成定向离线验证；
当前运行进程尚未重载，不能据此宣称关闭重开、应用重启和真实网络续连已验收。
“电脑操控”页主动监控与云分析目前只有接口和逻辑离线验证，尚无实机云链验收。
监控设计为只读 CPU / 内存、30 秒采样、本次应用会话最长 8 小时；开关默认关闭且不跨重启恢复。
显式开启云分析后，持续压力可触发最小脱敏指标的 AgentArts 分析，亦可手动请求；
实际系统调整仍须经过 Policy 和必要审批。配置、采样、云分析与本地执行分别验收。

邮件、订阅与社交变化进入带来源的事实与目标影响链；Laya 负责已授权范围内简单低风险的
自主分类与决策，Agent 汇总重点和处理结果。这是本轮要求，尚不能据此声称连接器闭环
或千封吞吐已验证。具体证据和继续入口见 [本轮记录](docs/live-proactive-20260927.md)。

下文保留历史里程碑；旧 SIS 播报与旧语音交互说明不替代本轮原生 Live 的验收。

MOD-11 / MOD-12 / MOD-13，负责人 `zemeng`。桌面工作区增量已随 PR #25 合并，本地外壳增量随 PR #33 合并；PR #34 已将任务、会话和脱敏审批恢复迁移到公开 Client 查询。模块仍按未完成边界保持 `in_progress`。关联 PA-001、PA-002、PA-004，消费公共客户端和契约 `0.1.0-alpha.1`。

Desktop 只依赖[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)中已冻结的 Core Runtime Profile 1；事件通道、Host 生命周期和 Model/Agent/Tool 路径仍为 `provisional`，语音、设置/连接器生产路由、Windows Host 等未公布能力显示为 `unavailable`。

当前新增界面与集成只服务 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)。正式比赛界面必须显示实际 profile、AgentArts deployment/version、trace 与不可用状态，不得把 Local/Fake 输出标成 AgentArts 结果，也不得静默回退。现有盘古/Local 配置界面作为可选历史基线保留，当前不新增功能且不进入比赛退出条件。

Competition 文字接线由可信 Desktop 主进程显式选择，不由 Renderer 决定。部署完成后可
仓库构建后运行根命令 `npm run start:desktop`，默认选择 `huawei_ict_agentarts`。缺少 AgentArts 配置时从模型设置保存加密凭据，保持该 profile；不自动切换 Local。可通过进程环境显式提供 `PA_RUNTIME_PROFILE=huawei_ict_agentarts`、
`PA_AGENTARTS_GATEWAY_URL`、`PA_AGENTARTS_RUNTIME_NAME`、
`PA_AGENTARTS_INVOKE_MODE=published` 和完整的
`PA_AGENTARTS_AUTHORIZATION` 请求头值。Authorization 只在每次云调用时由主进程
读取，不进入任务正文、Renderer 快照、日志或仓库。缺少或非法配置会让 Runtime
初始化或调用明确失败；Competition 模式不会回退到盘古、Local Agent 或 Fake。
Competition 的 `task.submit` 使用 180 秒请求 deadline，以覆盖多工作流编排；该 deadline
仍由 Client 写入请求并贯穿 TaskRuntime 与 AgentArts 调用。本地取消或超时沿现有契约
传递：任务 deadline 到期时 Runtime 向协调与 AgentArts 调用传播终止信号，用户取消则
通过 `task.cancel`；提交调用本身超时不等于任务已经停止。上述路径均不自动重试，
远端是否停止仍需 AgentArts trace 独立读回。
Local 与 Fake 继续使用 Client 的默认 deadline。
管理后台原有盘古配置、测试和启停动作在 Competition 模式下会明确拒绝，避免把
Local 配置误写成 AgentArts 状态。

Competition 对话提交显式提供 120 秒任务期限，覆盖云端工作流与本地后续处理；
回答提前完成时立即返回，用户仍可取消。状态查询继续使用 Client 的 10 秒 RPC 默认值。
此期限经公开请求传给 Runtime，不能把默认 RPC 期限误当成整个云端任务的执行预算。

Competition 语音试用显式接华为 SIS 短音频 ASR 和同步 TTS，保持现有按键采集、
Runtime 文字消费和本机 WAV 播放。可信面板中的“华为 SIS 语音配置”只接受
`cn-north-4` 或 `cn-east-3`、对应项目 ID 和**独立的 SIS IAM Token**；
主进程用 Electron `safeStorage` 加密后写入当前用户数据目录，不向 Renderer
快照、日志或 AgentArts 请求暴露 Token。启动时也可由主进程读取
`PA_HUAWEI_SIS_REGION`、`PA_HUAWEI_SIS_PROJECT_ID`、
`PA_HUAWEI_SIS_IAM_TOKEN` 和可选的 `PA_HUAWEI_SIS_TOKEN_EXPIRES_AT`，已保存的加密配置优先。Token 到期后须在可信
面板更新；当前没有自动刷新。未配置或无法解密时明确显示不可用，不回退到
Windows 本地识别/合成。配置成功仍仅表示端口可用；SIS 云请求、麦克风、
扬声器及完整语音收发尚需一次真实验收。

Competition 工具目录由主进程从实际注册的工具生成。当前只选择
`workspace.read_text@1.0.0`，根目录固定在随 Desktop 提供的合成夹具目录，
且 `meeting-update.json` 必须仍是预期内容、可读取、未过期且任务未取消。
云端只收到受限输入 Schema；只有提案精确请求这一个文件，并经本地 Policy、
ToolGateway 与结果校验后，才会投影合成正文。原始工具结果、Evidence、绝对路径、
凭据和其他文件内容不外发。Goal 工具仍在受信宿主目标操作入口执行，本片不列入
云端可选目录；普通目标读写闭环等待各自已登记的公共接口和审批验收。
目录选中只证明本地合成读取条件，AgentArts 部署与真实调用仍须独立读回验证。
显式空 `PA_RUNTIME_PROFILE`、空/非法 `PA_AGENTARTS_INVOKE_MODE` 以及
Competition 与 `--fake-model`/`PA_DESKTOP_MODEL_MODE=fake` 的组合都会拒绝启动；
只有完全未提供 profile 时才保留既有 Local 默认，`--fake-runtime` 仍是显式离线入口。

## 已落地的界面

2026-09-06 外观更新：ORB-02 所有粒子固定纯白、满不透明度，正反面及所有任务状态保持高亮，不再随状态变暗或闪烁。原稿的点数、位置和尺寸保留；此前逐像素一致记录对应调整亮度之前的版本。

原版 ORB-02 示例引擎移植到 `src/features/orb/orb.js`：170 个 Fibonacci 球壳点、matrix 渲染。原版比选卡片没有使用 lattice 纬度环分布；不能把同名“规则点阵”布局替换进去。待机绘制参数保持原样，只在产品代码修正状态切换的 shape 取值及减少动效时的重绘。

球体窗口 112px，画布按原版卡片保持 132px 并居中（球面约 70px），避免缩小画布后点距变密。无窗口阴影、无球体模糊，透明边缘用径向渐隐。以球心 90px 检测靠近，420px 面板按工作区左右避让；拖动抑制展开，输入/点击固定。独立后台关闭不销毁 Runtime。冷光青与标准毛玻璃令牌来自恢复后的原稿；后台表格共享父层玻璃材质。

任务提交、快照读取、事件订阅、能力目录、授权决定和取消调用公共 SDK。桌面主进程普通启动使用项目内持久化 `TaskRuntime`，显式 `--fake-runtime` 才使用测试 Runtime；两者都通过 `@personal-agent/client` 握手。没有 UI 计时器伪造任务进度，状态由 `event.subscribe` 后的 Runtime 事件回读驱动。取消受理显示“正在取消”，终态以 Runtime 快照为准。停止播报是独立的 `voice.stop` 操作，不调用 `task.cancel`；SIS 未配置时保持不可用并提示配置原因。

安全页将待处理授权与已处理历史分开。历史通过主进程的只读分页入口读取公开、脱敏的 `approval.list`，每页最多 50 条，可刷新或继续加载更早记录；历史行不提供批准动作。授权响应成功后重新读回首批历史，不用界面猜测最终状态。此入口不公开原始工具参数或新 Runtime operation。

后台“模型”页已提供盘古 V2 的真实 API 配置与连接测试：Endpoint、模型、部署和 API Key 通过受限 IPC 发送到主进程。ModelArts MaaS 可填 `https://api.modelarts-maas.com/openai/v1`，适配器会追加 `/chat/completions`；点击“测试真实连接”才会发起实际请求。保存配置时 API Key 使用 Electron/Windows 加密存储，绝不进入快照、日志或前端；重启后会自动恢复，无法使用系统加密存储时会拒绝落盘。面板思考滑块和快速模式可在连接失败时继续调整，用于桌面测试，但 Runtime 尚未公开对应参数，尚未把它伪装成任务参数。

模型页使用“模型列表 → 添加或编辑”结构，并支持真实启停；停用后的模型不会用于新任务。管理后台提供个人、集成、编码、任务四组共 20 个导航入口，配备统一线性图标和导航搜索。主题和降低动效会在桌面窗口间同步；新增页面中尚未接入的服务显示明确状态，页面数量不代表对应后端能力已经交付。

## 运行

先在仓库根执行已有的 `npm ci` 和 `npm run build`。桌面 workspace 的 `postinstall` 会安装锁定版本的 Electron 二进制；桌面依赖由根 workspace 解析。若只单独运行本模块可使用：

```powershell
npm install --prefix apps/desktop --package-lock=false --cache .cache/npm
$env:electron_config_cache = Join-Path $PWD '.cache/electron'
node apps/desktop/node_modules/electron/install.js
npm start --prefix apps/desktop
```

普通启动使用 `.cache/runtime.sqlite` 中的本地 Runtime；显式联调命令为 `npm run dev:fake --prefix apps/desktop`。fake 标识常驻面板和后台，任务状态由“推进联调一步”手动驱动，测试数据仅在内存，本机联调配置在模块 `.cache`。无真实盘古、语音、外部账号调用。

`electron/runtime.js` 提供 `register({transport, now?, readEvents?, attachClient?})`，生产路径传入 `@personal-agent/runtime/application` 的传输对象；生产路径不会自动加载 testkit。托盘菜单可打开面板、后台或退出应用，关闭后台不会销毁 Runtime。Electron 44.2.0 仍是模块开发依赖，根 workspace、锁文件和打包流程待 goo122 统一集成。当前应用不含分发安装包。

## 验证与限制

2026-09-05：Windows / Electron 44.2.0；公共底座 build 通过；关键测试 2/2；Electron smoke 通过原生热区、收起、拖动抑制、面板/后台和任务取消流程。`orb-fidelity.cjs <原版设计目录>` 在 132px 原稿尺寸验证产品待机球体逐像素一致（170 点）。已直接观察实际窗口截图。Node 26.3.0 与底座声明的 Node 24.15.x 不同，目标 Node 版本待集成环境验证。


`npm test --prefix apps/desktop` 检查跨屏工作区定位和公共客户端取消到终态的语义。Desktop 改动按范围运行以下 Electron 验收：

```powershell
npm run test:smoke --workspace=@personal-agent/desktop
npm run test:workspace-smoke --workspace=@personal-agent/desktop
npm run test:runtime-application-smoke --workspace=@personal-agent/desktop
npm run test:text-smoke --workspace=@personal-agent/desktop
```

截图保存在模块 `.cache` 下的对应 QA 目录。真实模型、付费服务和外部账号仍需用户另行授权。

后台未连接的业务页显示真实空状态，不把设计稿的手写业务数据带入产品。盘古 Provider 已接入，但真实 Endpoint/API Key 需要在“模型”页显式配置和测试；思考参数仍待 Runtime 公共契约与根装配接入。SIS 语音仅完成代码接线，真实服务和设备未验收；外部 Runtime 进程/Named Pipe、全局快捷键、安装卸载仍待对应模块接入。当前玻璃为 CSS 材质；原生 Windows 桌面背景模糊未验收。多屏位置算法已测，物理多显示器/DPI 切换未实机验收。PR #25 已合并，但不代表 MOD-11/12/13 或 P0 全部完成。

## Competition 本机私人记忆确认

管理后台“记忆”页允许用户每次会话手动选择一个本机 Vault 文件夹并只读搜索。
当前生产桥在应用管理副本清单明确、删除维护可用时允许逐条确认写入；清单未知、存在
未接通的副本或删除维护失败时保持禁用。真实来源的端到端验收仍未完成。
主进程重新读取原文，同时展示来源、完整引文和摘要；确认后才通过 MOD-09J
写入独立的 `private-memory.sqlite`，同源更正使用精确版本。取消、超时、
来源变化均不写入。Vault 路径不保存，重启后需重新选择。私人事实不进入
现有公开 Goal 投影，也不是新 wire capability。任务消费另需精确任务、版本及原生许可；
AgentArts 发送还需单独的出机确认，保存记忆本身不授予消费或云端发送权限。
管理页可分页查看独立私人库中已保存的当前版本，无需重新选择 Vault；逐条删除前
原生对话框再次展示摘要和来源。受信宿主要求当前版本匹配，删除全部版本与相关
快照后截断 WAL，并读回确认；取消和过期版本保持原数据。此入口不删除 Vault 原文件。
若删除事务已提交但 WAL 截断受旧读者阻塞，管理页暂拒绝继续读取；重启后受信宿主
重试截断并检查删除标记，成功后才恢复列表。合成数据覆盖此故障与恢复顺序。

当前仅有合成数据的持久写入和删除测试；真实 Vault 只验证了只读检索与拒绝确认，
尚无用户逐条确认的真实持久写入验收。删除保障覆盖当前应用数据库、已登记任务副本
及精确收据；私人 Memory 源库尚无生产 backup/restore 路径，外部独立副本与已发送正文不在本机删除保证内。
验收步骤见 [本机私人记忆验收](../../tests/manual/desktop/README.md#私人记忆本机验收)。

私人记忆控制器关闭后释放会话 Vault，并拒绝新的搜索和已开始搜索的结果；
关闭期间尚未完成的目录选择不得重新安装来源。该检查不声称中断已经发生的系统文件读取。
合成回归与验证条件见 [关闭生命周期记录](../../docs/modules/MOD-09-VAULT-LIFECYCLE-20261008.md)。

## 文字交互垂直链路

显式 `PA_RUNTIME_PROFILE=local` 时，文字任务通过 Runtime Application 的 `task.submit` 入口执行已有 Agent、`ModelGateway` 和 Provider。普通启动的 Competition Profile 由 AgentArts 编排，辅助模型配置只用于其委派子任务。Desktop 主进程负责安全配置、IPC、事件订阅和任务展示；缺少配置保持不可用，不会生成假回答。`--fake-runtime` / `--fake-model` 的显式联调入口默认 Local，不能与显式 Competition 同时启用。

离线验收使用显式 Fake Model：

```powershell
npm run dev:text-fake --prefix apps/desktop
npm run test --workspace=@personal-agent/runtime
npm run test:text-smoke --workspace=@personal-agent/desktop
```

Fake Model 只验证 Runtime、Agent、持久化和桌面显示链路，不代表真实盘古连接已经验收。真实调用仍需在“模型”页配置并手动点击连接测试。

## 2026-09-06 桌面交互里程碑

本轮在 MOD-11 / MOD-12 / MOD-13 已有接入之上完成了可用的文字对话交互：Enter 发送、Shift+Enter 换行、重复发送、发送按钮状态、自动滚动和真实模型名称展示；任务回答改为用户气泡与助手正文的对话布局，不额外插入任务 UUID。助手回答下方提供复制、系统分享（不可用时仅复制分享文本）和本地点赞反馈。

正文完整性修复后，Desktop 不再从 `resultSummary` 尾部猜测并删除模型元数据：
回答按不可信字面正文展示、复制和保留，HTML 展示继续转义。旧 Local 生产者附带的
`[model=...; verification=...; tokens=...]` 可能作为普通文本可见；结构化元数据需由
公共接口另行提供，不能由摘要文本推断。本项不会改变 Runtime 结果或验证等级。

执行中的任务由 Runtime 状态驱动“思考中 / 执行中 / 整理回答 / 等待中”，左侧使用 3×3 黑色底格与白色扫光动画。面板标题栏支持拖动面板与悬浮球，并根据工作区尝试左右换边和上下避让。剪贴板写入由主进程受控 IPC 完成，渲染器仍不能直接持有密钥或执行 Shell。现有 ORB-02 粒子动画未在本轮改动。

验证覆盖文字任务成功、Provider 不可用、取消中的模型请求、Enter 与按钮提交、自动滚动、复制与点赞、思考动画、面板和悬浮球拖动、工作区约束、后台关闭和任务取消；单元测试、类型检查及 Fake Electron 冒烟在本地通过。真实盘古配置可以由 Windows 加密存储恢复，但真实服务可用性仍以每次连接测试和任务结果为准。

### 已知问题：屏幕边缘拖动后的透明命中区域

在当前 Windows 分辨率 / DPI 环境中，把组合窗口拖向右侧的上角或下角后，仍可能在悬浮球右下方留下透明但会拦截鼠标的区域。代码已避免在拖动中主动重设悬浮球尺寸，并增加视口上限回归检查，但用户实机仍可复现，因此本问题保持未解决，不能把“无透明余块”列为本里程碑完成项。

后续需要按实际 DPI、显示器工作区和 Electron 原生命中测试继续采样，分别记录 BrowserWindow 外框、渲染视口和透明像素区域；验收标准是右上、右下、多显示器及不同缩放比例下，球体外透明区域均不拦截桌面点击，同时球体和标题栏拖动保持可用。

## 2026-09-08：独立桌面本地增量（MOD-11/12/13）

对应 PA-001 / PA-002，仅补桌面本地能力，不修改 Runtime、公共契约、业务通知、会话或审批语义。托盘和后台标题栏新增“桌面设置与恢复”入口：

- 保存悬浮球、后台、大工作区和设置窗口位置；显示器移除/工作区变化时修正可见位置；悬浮球拖动结束可贴近边缘吸附，保留原尺寸与动画。
- 可设置悬浮入口置顶、靠近展开、可选 Ctrl+Shift+Space 显示悬浮球；同一 userData 只启动一个实例，第二次启动显示已有面板。
- 独立设置页支持系统/浅/深主题、减少设置页动效、中英文与跟随系统；后台导航/窗口控件支持外壳语言切换，业务正文不在翻译范围。字体缩放影响设置、后台和大工作区，不影响球体与小面板；原有外观主题入口保持原语义。
- 本机版本、Electron/平台/显示器信息、脱敏本地日志、显示/重载/最小化/最大化恢复。重载由用户明确选择，提示未提交输入会丢失；设置页自身异常使用原生恢复提示。

偏好和轮转日志在 Electron 当前 userData 下，不发送外部服务；测试使用独立 userData。没有改动 ORB-02 动画源码、小工作区玻璃样式或其缩放。

新增命令：`npm run check:desktop-local --workspace=@personal-agent/desktop`、`npm run test:desktop-local --workspace=@personal-agent/desktop`。本轮本地单元测试 6/6、桌面语法检查与架构检查通过；隔离 Windows/Electron 测试验证设置保存、中英文、120% 字体、球体 zoom=1、置顶、窗口控制、单实例、日志及重启后的偏好/位置恢复。设置页原生 capturePage 截图已观察，120% 字体未横向裁切；pageerror/console error 检查通过。

限制：恢复测试触发的是 render-process-gone 处理器，不是操作系统级真实崩溃；真实强制崩溃会断开 Playwright，未据此宣称真实崩溃恢复通过。物理多屏/DPI 切换、系统热键冲突与原有透明命中余块仍需相应实机验收。本轮不代表 MOD-11/12/13 全部完成，也未制作安装包或自动启动真实模型。

### 基础桌面验收维护

在已合并 PR #33 的 `58b3dc8` 基线上，`test:workspace-smoke` 的原生窗口居中、主题、工作区交互及截图流程本机通过；历史居中失败此次未复现，尚不能据此保证所有 DPI 环境通过。

`test:smoke` 已更新为现行 420px（窄屏收缩）面板和 20 项导航的精确列表。任务监控通过现有 `admin.open({page:'tasks'})` 宿主入口打开，保留任务表状态、后台关闭后任务仍存续及取消到终态的检查。Windows / Electron Fake Runtime 验收通过，包括悬浮热区、拖动、模型配置与启停、主题、搜索及页面错误检查；未调用真实模型服务。
