# 自有 AgentArts Runtime 镜像

## 2026-10-16 AgentArts 实时语音代理

同一 `/ws?endpoint=<version>`（含原 `/invocations/ws` 路由别名）由唯一 upgrade listener 按
`Sec-WebSocket-Protocol: pa.realtime.v1` 分流；不带该协议的原 invoke/status/cancel 帧、HTTP 和原 API 设置保持兼容。
客户端保留平台外层 `Authorization`、镜像内层 `X-PA-Agent-Token`、
`X-Hw-Agentarts-Session-Id`，并传 `x-pa-deadline` 原会话期限。外层凭据仍由 AgentArts 网关验证；
实时分支必须显式内层头，不借外层凭据放行。URL 只允许已有 `endpoint` 参数，凭据不放 query。

镜像受信启动环境新增两个字段：

| 配置 | 含义 |
| --- | --- |
| `PA_AGENT_REALTIME_WORKSPACE_ID` | 北京百炼业务空间 DNS 标识；仅字母、数字、内部连字符，最长 63 字符 |
| `PA_AGENT_REALTIME_API_KEY` | 由受信宿主注入的百炼凭据；不得写入模型帧、Renderer、日志、文档或镜像层 |

两者均缺省时实时升级返回 503，原文字入口仍可用；部分配置或非法受信配置使启动明确失败且错误脱敏。
上游固定为 `wss://<workspace>.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime`，
不接受调用帧提供端点、凭据或替换模型，不跟随重定向。这里只代理既有 Qwen 原生 JSON（含 Base64 音频）；
不发送自制 ready/success，首个就绪事实来自上游 session 事件，既有 Qwen parser 继续消费。
本代理不执行模型工具请求，也不拥有 Runtime 任务终态、Policy 或 ToolGateway 授权。

会话不超过原 deadline 与宿主 120 分钟上限；连接和并发沿用原共享限额。
每帧及待发送缓冲各限 1,200,000 字节，握手最长 15 秒；连接建立前仅保留有界帧队列。
截止、断开、服务停止、错误或缓冲超限均关闭两端；并发槽等原上游实际关闭才释放，最多等待 1 秒后强制停止。
不重连或重放音频，不记录音频、转写、上游错误正文或密钥。

离线行为检查：`node --test --test-isolation=none apps/agentarts-runtime/test/realtime-proxy.test.mjs apps/agentarts-runtime/test/websocket.test.mjs apps/agentarts-runtime/test/server.test.mjs`。
这些回环/显式替身验证不代表百炼、AgentArts 公网双工、物理麦克风/播放或真实语音审批已经验收。

<!-- current-design-alignment-20261015 -->
## 当前口径与历史适用性（2026-10-15）

当前以[详细设计](../../docs/design/CURRENT_DESIGN_20261015.md)区分设计意图、已有代码、待接线与真实验收；架构仍未最终定型。
本机Laya、全部28图/185节点镜像串行编排，未合格判断升级经AgentArts代理的DeepSeek；语音百炼既有端口，SIS平台不可用。
SWR `local-laya-v3-244ca434` 已发布，digest `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`，
云指定版本 `arm64-local-v3-244ca434` 目录与关联日志已验，见[发布回执](../../docs/competition/evidence/test-image-v3-20261015/owned-release.json)。
两案例完整执行表面为本机同版镜像+本机Runtime/Policy/工具/Laya+远端AgentArts模型代理，
见[真实执行汇总](../../docs/competition/evidence/test-image-v3-20261015/full-workflow-results.json)：Wukong167.432s、Pelican第二轮81.611s，41工具Evidence；首轮partial保留。
分支父成功、协调锚点created；28目录不等于28业务验收。6次判断182–618ms未达150ms，各案例3裁决均升级DeepSeek，未证高级调用减少或训练。
主动责任、无人值守、归来摘要、用户可调打扰/静默feed与语音确认复用原端口。
高级影子与已有判断合并、主任务优先、按机会资源/收益决定；真实runner目前顺序await主/影，机会并行与普通任务先交主结果仍待接线。
以下带日期的嵌入式、直连MaaS、未发布与旧未验记录均保留原版本范围，冲突部署/完成状态已superseded，不作为当前启动参数。
当前启动只用 `PA_AGENT_LAYA_MODE=local`，镜像不含模型权重、Python或PyTorch；不直连提供商fallback。
旧协作门槛以当前CONTRIBUTING/AGENTS为准，文档或receipt不授予权限。

## 2026-10-15 当前开发入口：本机 Laya + 镜像串行工作流

Owner 已明确改为本机 Laya。当前生产入口使用 `PA_AGENT_LAYA_MODE=local`；28 项流程的编排留在镜像，
判断通过 `decision.choose_candidate` 和原 HostBridge 回执完成。镜像不再包含 Python、PyTorch 和权重。
工作流串行推进，主流程和隔离影子分别接真实宿主；缺适配器明确 unavailable。
完整配置、所有接线清单、主/影子及鹈鹕增量修复验收见[当前调用文档](../../docs/competition/LOCAL_LAYA_WORKFLOW_WIRING.md)。
本版SWR发布与指定云目录/日志已按上述回执读回；以下带日期记录保留当时事实，不是当前启动要求。

## 2026-10-14 镜像内 Laya 增量（历史版本）

当时的历史入口要求 `PA_AGENT_LAYA_MODE=embedded`：`laya[serve]==0.3.20` multilingual 的权重、encoder 配置、tokenizer 与 Python CPU 服务随自有 ARM64 镜像一起交付。它不是把 MaaS 模型改名 Laya，也不会把 Windows venv 或 wheels 拷入 Linux。通用国内 MaaS 经现有 ModelGateway 生成候选；一个镜像内 Laya 实例在有限候选中选择。TaskRuntime、Policy、ToolGateway、实际工具、终态与 Evidence 仍在可信本地。

Node 生成仅本进程使用的随机内部 Bearer，启动 Python 回环服务；SHA 清单验证、权重加载及一次真实 synthetic 前向均通过后才开始监听 8080。Python 异常退出会关闭入站服务并使宿主失败，缺权重或 Laya 配置不会静默用旧 Agent。两个进程的受控停止复用原取消链；CPU 前向不可强制 HTTP 抢占，结束前服务保持忙状态。Python stdout/stderr 不公开，凭据与源正文不进入日志；公开 JSON 日志只记录 `laya_ready`、`laya_choice` 的请求、候选及耗时。

所有工作流与旧编排器共享同一 typed-choice 队列。候选生成与无关工具可并行。CPU 默认使用受信启动策略 `PA_LAYA_CPU_EXECUTION_POLICY=sequential`：selector 立即派发一个单项请求，保持 FIFO，首项完成即可交付，不等待无关兄弟，也不为组批增加 timer。显式 `packed` 才用 `setImmediate` 收集同时就绪的判断，最多沿用既有 4 项协议容量。每项保留完整 state、questions、候选及原 deadline；不增加权重实例、不拼接正文，也不把依赖节点强行并行。四项 dense 合批的历史样本更慢，因此不再作为默认 CPU 策略；这不等于已实测出新的提速结果。

原 deadline 与取消覆盖等待。客户端超时后先读回 `/health.inferenceBusy`，只对明确未受理的 429 等待空闲后重新提交，已受理的模型调用不重放。这个机制不改变未知工具写入必须先核实的规则。独立批接口也遵循启动策略：`sequential` 在一次 HTTP 内逐项执行实际 forward；`packed` 才跨项拼张量。响应 `execution.forwardCount` 和每项 `forwardId/forwardIndex` 区分真实前向；日志 `batchId` 仅关联 HTTP，不再等同一次前向。forward 耗时按 `forwardId` 去重，HTTP 编码准备 `preparationMetrics` 按 `batchId` 去重；`precheckScope` 区分完整窗口预检与 forward 组 collation，不能把重复回执相加。

Node 将同一个受信策略同时交给 selector 和 Python，并核对 `/health.executionPolicy`、`inferenceMode=inference_mode` 后才就绪；请求正文不能改变策略。推理模式在 worker 线程内进入，仍固定 CPU 两线程、原精度及原 native MHA 设置。此模式只完成无权重回归，新代码的真实权重、时延及峰值内存待用户稍后实测，未发布镜像。

该主流程微批属于尚未部署的源码增量。协议、单实例及实测入口见 [2026-10-15 批处理记录](../../docs/competition/OWNED_LAYA_BATCHING_20261015.md)。微批只合并同时就绪的判断，不能跳过实际工具回执、MaaS 候选制备或用户问题依赖，也不保证固定提速或修复语义 review。

Python 服务遵循调用方的显式原 deadline，不另行截为 30 秒；仅旧无 deadline 兼容入口保留 30 秒默认值。实际模型耗时需要 ARM64 运行记录，不能由该期限修正推断。

`OwnedAgentOrchestrator` 普通 fast 结果、World/Plan 的 KEEP/RECHECK，以及修复终审候选都经过 Laya；确定性命令结果校验保持代码执行。28 个功能的独立依赖图模板和推进器通过同一 Laya 选择端口组合；新图中的本地/平台 Host、真实回执验证缺配置时明确 unavailable，不把目录存在或 Fake 通过宣称为 28 个功能真实可用。

受信配置还包括 `PA_AGENT_WORKFLOW_CHECKPOINT_KEY`（至少 32 字节，稳定的宿主密钥，用于图检查点完整性；不授予动作权限），以及既有国内 MaaS 与入站配置。`PA_WORKFLOW_RECEIPT_SECRET` 可注入已有本地 Host 工具任务结果的签名核实器；显式专用密钥优先，未指定时公开 `deriveOwnedWorkflowKeys` 从既有可信 `PA_AGENT_WSS_AUTH_TOKEN` 以 HKDF 不同 purpose 派生稳定的 checkpoint/peer-receipt 子密钥。本地可信桥接宿主用相同安全配置派生；没有任何配置不会生成假信任。签名核对受信 peer 来源和具体原回执，不能代替本地 Policy 或独立外部读回。`LAYA_MODEL_PATH` 在镜像中默认 `/opt/laya/models/multilingual`、`LAYA_PORT=8000`；Python 默认 `/opt/laya/venv/bin/python`，冷启动期限由 `PA_LAYA_STARTUP_TIMEOUT_MS` 配置。`legacy-without-laya` 只在明确 `standalone-validation` 的离线传输夹具中可用，AgentArts 模式拒绝这个值。

模型资产导出需要显式环境配置：

```powershell
$env:PA_LAYA_ASSET_ROOT = '<可信本地模型缓存根，仅该模型>'
$env:PA_LAYA_MODEL_SOURCE = '<该根下 snapshots/<revision>/multilingual 绝对目录>'
$env:PA_LAYA_MODEL_REVISION = '<40 位 revision>'
npm run build:owned-agent
npm run image:context --workspace=@personal-agent/agentarts-runtime
```

导出器只复制五个命名资产，允许解析信任根内的 HF blob 文件链接；拒绝链接逃逸和目录别名，不导出 cache/token/其他模型。新导出清单记录 revision、实际 bytes/SHA，不泄露原缓存绝对路径。tokenizer 配置只在新导出中进行 SDK 相同的兼容转换，不改原缓存。运行时强制 HF/Transformers offline，模型不在启动时访问海外服务。

Docker 使用独立 Linux venv 与 `scripts/laya/requirements-image.txt`，apt/npm 默认华为公开镜像，其余 Python wheels 可从国内 PyPI 预取。导出锁将官方 npm tarball URL 映射到 `PA_IMAGE_NPM_REGISTRY`（默认华为），保留 version/integrity/依赖图及自有 registry URL，来源记录在 `npm-registry.json`；不改根锁或全局 npm。bookworm 的 Python 3.11 使用华为索引实际提供的 ARM64 NumPy 2.4.6 wheel；Windows 原 venv 仍为 2.5.3，不升级或拷入镜像。

`PA_LAYA_WHEELHOUSE` 必须指向完整预下载的 Linux ARM64/pure Python CPU wheel 目录。2026-10-14 首次真实 Linux 构建发现 PyPI `torch==2.14.0` ARM64 包要求 CUDA 13，不能把 Windows 下载解析成功当 CPU 兼容证据。现固定 `torch==2.14.0+cpu`，使用 [PyTorch 官方 CPU 索引](https://download.pytorch.org/whl/cpu/torch/) 的 cp311/aarch64 wheel，SHA256 `08894195f84541edcbd09072e6c53b791d4cdd09f650b05473f35718a848fd7b`。该官方 CPU wheel 已下载并按官方索引 SHA 核对（159,239,175 bytes），METADATA 无 CUDA 依赖；华为 PyPI 本轮没有这个 `+cpu` 包，不能声称它由国内 PyPI 提供。

导出仅 regular `.whl` 与 SHA 清单，拒绝符号链接、Windows/其他架构 wheel、普通 GPU Torch 或 CUDA runtime。BuildKit 从单独 stage 只读绑定 wheelhouse，以 `--no-index` 安装完整依赖、运行 `pip check` 并断言真实 Linux `torch.version.cuda is None`；不在最终发布镜像保留第二份大 wheel 包，不用 `--no-deps` 掩盖缺项，也不在构建/启动时访问官方海外 CPU 索引。墙内重建需先提供已准备的 CPU wheelhouse；正式用户与协作者拉取国内 SWR 镜像运行，无需这次上游下载。缺依赖明确构建失败，不切换到 GPU 包。基础镜像可由 `NODE_BASE_IMAGE` 指定已核验的国内 SWR 同版 ARM64 镜像；原默认 Node digest 只表示历史固定基线，不能保证所有网络可拉 Docker Hub。实际 Linux 导入、权重加载、平台发布与业务读回仍须分别验收，下面 2026-10-12 记录不能证明这个新增 Laya 版本已部署。

新图应用返回仍为 `verification=unverified`。HTTP 图响应使用既有上传范围内的 1,100,000 字节限制，旧应用仍 64,000；WSS 保持已发布 0.1.0 传输的 64,000 字节结果限制，大图结果需显式 HTTP 调试，不能假称现有本地 Coordination 消费器已能自动消费新图协议。

2026-10-12 真实部署增量：ARM64 源码 `194799c6979ed47d20dfd2d3ea17bbfd16f63fd6` 已发布并替换 Huawei Latest。平台公开路径为 `/runtimes/<runtimeName>/invocations/ws`，目录为 `/runtimes/<runtimeName>/invocations/bindings?endpoint=Latest`；平台 Session 头、外层鉴权及独立镜像凭据均必需。官方 MaaS DeepSeek 的 none 参数经宿主映射为 `chat_template_kwargs.thinking=false`。真实 WSS 模型/本地一次性授权文件读取/Evidence/续答场景已通过；逐项绑定、写入、Wiki、完整自主修复和备用整链仍未验收，详见 [实际证据](../../docs/modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。这是未合并预览，不提高公共协议冻结状态。

2026-10-12：同一 HTTP/WS query 可显式选择8个Workflow或3个Controller；新增受宿主凭据保护的
`GET /bindings`，可信启动可设置 `PA_AGENT_DEFAULT_CONTROLLER_ID`。普通调用保持兼容。
World/Plan角色报告保持独立，不作为旧公共候选执行；原空MVP标记新owned绑定。
详见 [资源绑定与调用](../../docs/competition/OWNED_IMAGE_BINDINGS.md)。


目标为 `huawei_ict_agentarts`；同一核心代码支持显式 `standalone-validation` 验证。
本入口提供标准 8080 `/invocations`、`/ping`、同端口 `/ws` 和只读 `/invocation-status`，无需把现有 TS 改写为 Python。
ModelGateway 是唯一模型入口，真实提供者由宿主配置，不会缺配置回退 Fake。

## 配置与运行

使用仓库 `.node-version` 的 Node 24.15.0、npm 11.12.x。先运行根构建。
以下配置由可信部署宿主注入，密钥不要填入 Dockerfile、Git、日志或聊天：

- `PA_AGENT_HOST_MODE`：`agentarts` 或 `standalone-validation`，必须明确。
- `PA_AGENT_MODEL_BASE_URL`：HTTPS OpenAI Chat Completions 兼容入口，包含版本路径。
- `PA_AGENT_MODEL`：实际模型名；每角色可用 `PA_AGENT_FAST/WORLD/PLAN/REVIEW_MODEL` 覆盖。
- `PA_AGENT_MODEL_KEY_FILE` 或 `PA_AGENT_MODEL_API_KEY`：宿主秘密文件或运行时环境；每角色可独立覆盖。
- `PA_AGENT_MAX_OUTPUT_TOKENS`：单角色输出预算，默认 2048；修复最多顺序调用三个角色，无自动重试。
- `PA_AGENT_TIMEOUT_MS`：服务期限上限，默认 60000；取与原 `X-PA-Deadline` 的较早值。
- `PA_AGENT_WORKFLOW_GOAL_INPUT`：可选的单一旧 Workflow 输入名。
- `PA_AGENT_DEPLOYMENT_VERSION`：可选的宿主显式固定版本标签，例如 `arm64-194799c6`。仅允许 1～128 个 ASCII 字母、数字、点、下划线、连字符且以字母/数字开头，拒绝 Latest/default/stable/current/unknown 别名或组成段；非法配置启动失败，不回显原值。缺省时回执记 `unknown`，不从模型、URL 或可变 Latest 推定。
- `PA_AGENT_INBOUND_TOKEN`：可选额外入站保护；至少32字符，调用方走已有Authorization宿主注入。
- `PA_AGENT_WSS_AUTH_TOKEN`：可信宿主注入的入站 WSS/状态查询凭据，至少32字符；缺省继承 `PA_AGENT_INBOUND_TOKEN`，二者都缺失时 `/ws` 与状态查询关闭。与模型密钥无关。

`npm run start --workspace=@personal-agent/agentarts-runtime`。
独立模式只绑定 127.0.0.1，不改变 Desktop 的正式比赛 endpoint。
AgentArts 模式监听 0.0.0.0，必须由平台入站认证保护；直接运行裸容器不等于安全公开服务。
session 与 request 头只用于关联，不记录模型输入和凭据，不宣称已迁移平台会话存储。

stdout 的 `owned_role` 回执通过字段白名单输出 requestId、独立 spanId、角色、提示词版本、
开始/结束 UTC 时间、单调时钟耗时、状态和可用的 token 数。`deploymentVersionSource` 为
`host_configuration` 或 `unknown`，只表明显式宿主配置来源，不证明平台版本已被独立读回。
该回执的 `scope=model_call`：completed 不代表报告/候选校验通过，不代表本地工具执行或任务完成，
也不是华为平台 trace。正文、任意错误、endpoint、凭据和额外属性均不输出；日志写入失败不改变编排结果。

## WSS 主通道与 HTTP 备用

容器内部 `/ws` 使用 WebSocket，公开 `wss://` 的 TLS 必须由可信平台或反向代理终止。
调用方保留平台外层 `Authorization`，把本镜像入站凭据放在
`X-PA-Agent-Token: Bearer <secret>`；WS 握手必须同时带
`X-HW-AgentArts-Session-Id`，每个消息的 `sessionId` 必须与此头一致。
凭据不进入 URL、消息正文、普通日志或镜像；显式错误的自定义凭据不会回退到外层凭据。
现有 HTTP 调用仍兼容 `Authorization` 入站凭据；使用自定义头时校验 WSS 入站凭据，允许平台 IAM 和镜像凭据分开。
`/ws` 要求显式入站凭据，不能因为 HTTP 平台模式兼容而开放裸 WebSocket。

传输信封使用公开的 `@personal-agent/contracts/agentarts-transport` provisional `0.1.0`，
与本地 Runtime wire `1.0.0` 分开。`ready` 公布 `invoke/status/cancel/ephemeral-replay`、
`restartRecovery:false` 和心跳间隔。调用包含原 HTTP `payload`、原期限、
`sessionId/requestId/idempotencyKey/payloadDigest`，摘要由公共 helper 计算。
`accepted` 仅确认受理；`result.events` 与 HTTP 的三个事件相同，工具提案仍回本机 Runtime/Policy/ToolGateway。
容器不会执行本地工具，也不能根据 `task_end` 改写本地任务终态。

调用与 HTTP 共用并发限额，上传/输入最多 1,200,000 字节，结果事件最多64KB，
默认最多64条连接，256条进程内回执，已完成回执保留5分钟。
这些是服务资源限额，不是用户任务预算；模型期限继承原期限并取宿主上限较早值。
服务器每15秒 ping，未响应连接会关闭；断线、取消、期限和服务器关闭都向原模型调用传播取消信号。
已受理连接断开时不新建另一次模型调用；非配合的提供者不会使已取消请求占住并发槽。

同一会话幂等键绑定原 request、摘要和期限；任何替换均拒绝，正在运行的重复请求只确认已受理，
已完成请求只重放回执。`POST /invocation-status` 以公共 `status` 信封、相同入站凭据和会话头查询，
运行中的调用占满并发槽时仍可查询，结果包含 `running/completed/cancelled/failed/unknown`。
缓存仅为传输去重，不是第二套任务库；进程重启后的 `serverInstanceId` 改变，回执丢失。
保留期结束和未命中都返回 `unknown`，不证明从未受理；本机应进入协调，不能因此自动重发。
不宣称跨重启 exactly-once、SSE 断流续传、租户隔离或自主工具授权已实现。

本机测试使用显式合成编排器与回环 WS；容器支持 `/ws` 不证明 AgentArts 公网 Upgrade、认证、
WSS 保活或真实模型/工具验收已通过。部署后还必须实测这些平台表面。

`npm test --workspace=@personal-agent/agentarts-runtime` 覆盖认证、严格消息、结果、幂等重放、
状态读回、原期限、取消、断线不重发、共享并发、回执容量、心跳及安全关闭。

## 构建与回滚

`npm run image:context --workspace=@personal-agent/agentarts-runtime` 生成新的 allowlist 上下文。
新导出目录明确为0755、公开文件为0644，避免严格umask或源文件权限使镜像默认`node`用户无法读取入口；仅规范本次新上下文，不修改源码、旧上下文或私人文件，也不扩大allowlist。POSIX权限组合测试在Windows明确跳过，原隔离测试仍跨平台执行。
仅复制本入口和四个公开依赖包的 dist/schema/package.json，不复制 Desktop/Runtime、
私人数据库、`.env`、云导出或当前根目录其他文件。

在返回的 context 目录执行：

```powershell
docker buildx build --platform linux/arm64 --load -t personal-agent-owned:20261008 .
docker image inspect personal-agent-owned:20261008 --format '{{.Os}}/{{.Architecture}}'
```

固定依赖来自根锁文件；基础镜像固定24.15.0标签及2026-10-08读回的多架构索引 digest，已确认含 linux/arm64/v8。
2026-10-08 已构建并实测 `personal-agent-owned:20261008`，读回 linux/arm64、USER node。
索引 digest 为 `sha256:d126119af47c23445280d831e0f4b04c49c92403902d8d751340739962eb96e5`，
后续代码修改应重新生成上下文、构建并登记新的 digest。
只在同区域 SWR 与 AgentArts 新 runtime/version 部署，先保留旧 runtime。
ping 仅证明进程健康；真实模型、工具、trace、评估及取消须分别验证。
回滚为恢复旧 endpoint/配置，不清库、不重做已确认工具，不删除旧云资产。

当前状态及缺口见 `docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md`。

## 生产入口的离线验证

`test/production-transport.mjs` 是手动运行的合成传输检查，不会随普通单元测试读取真实模型配置。
在项目忽略目录用 OpenSSL 生成短期证书和私钥（SAN 包含 IP 127.0.0.1），
将测试目录和证书目录只读挂载到镜像，设置 `PA_TEST_TLS_DIR` 为容器内证书目录，
执行 `node apps/agentarts-runtime/test/production-transport.mjs`。
目录需包含 `key.pem`、`cert.pem`；容器使用 `--network none`。
该脚本启动实际生产入口，仅子进程通过 `NODE_EXTRA_CA_CERTS` 信任此测试证书，
验证既有 HTTPS Provider、四角色路由、错误、期限及关闭；不关闭 TLS 校验，不调用真实模型。

原始导出清点：`npm run inventory --workspace=@personal-agent/agentarts-runtime -- <原件绝对路径> <新清单绝对路径>`。
清单只输出白名单元数据和源片段哈希，保留原件在项目忽略目录；不执行 DSL 或 Python，不输出认证配置。

### Trusted execution model directory

The trusted `PA_AGENT_MODEL_CATALOG_FILE` alternative reads JSON once at startup. It is mutually exclusive with `PA_AGENT_MODEL_CATALOG`; an unreadable/invalid file stops startup with a sanitized error. The shipped metadata file is `src/default-model-catalog.json`; deployment must opt into it explicitly. Directory entries remain unverified until actual model requests pass. Desktop configuration, realtime routing and acceptance boundaries are documented in [the V5 wiring guide](../../docs/competition/DESKTOP_AGENTARTS_MODELS_V5.md).

`PA_AGENT_MODEL_CATALOG` accepts JSON `{version:"1.0",defaultModelId,models:[{id,displayName,reasoningEfforts,requestProfile,route,type?,availability?}]}`. Profiles are `standard`, `deepseek-native-v1`, `bailian-deepseek-v1` or `huawei-openai-v1`; routes are `agentarts-proxy` or `runtime-bailian`. Model entries cannot carry URLs, keys or headers. Omitting the environment variable preserves the existing role providers. The default model must be text and must not be unavailable. Native Bailian DeepSeek depth entries should expose only `none`, `low`, `high`, `max`; compatibility aliases in the legacy proxy do not establish independent native depth values.

The existing authenticated `/invocations` and WSS invocation query `{modelCatalogVersion:"1.0",action:"list"}` returns the directory using the existing message envelope and inner host credential. Its SHA256 revision binds normalized metadata; `executionModel:{catalogRevision,modelId,reasoningEffort?}` pins a selection. Unknown fields, stale revisions, unknown models and unsupported efforts are rejected. Native effort enters `ModelRequest.reasoningEffort`, never the prompt. Non-text/unavailable models remain visible but cannot execute thought requests. An unverified entry may be attempted; directory visibility does not verify inference authorization or native reasoning support.

`agentarts-proxy` retains the trusted AgentArts inference endpoint/authentication. `runtime-bailian` runs inside the owned AgentArts image and calls the fixed Beijing workspace compatible API using `PA_AGENT_REALTIME_WORKSPACE_ID` and its host-held `PA_AGENT_REALTIME_API_KEY`. This is an explicit route, with no error fallback, redirect or unknown-write retry. Response telemetry binds configured/returned model, requested effort, route and status without recording prompts or credentials. It is response evidence, not a platform trace readback.
