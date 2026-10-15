# 自有 AgentArts Runtime 镜像

## 2026-10-14 镜像内 Laya 增量

正式入口现在要求 `PA_AGENT_LAYA_MODE=embedded`：`laya[serve]==0.3.20` multilingual 的权重、encoder 配置、tokenizer 与 Python CPU 服务随自有 ARM64 镜像一起交付。它不是把 MaaS 模型改名 Laya，也不会把 Windows venv 或 wheels 拷入 Linux。通用国内 MaaS 经现有 ModelGateway 生成候选；一个镜像内 Laya 实例在有限候选中选择。TaskRuntime、Policy、ToolGateway、实际工具、终态与 Evidence 仍在可信本地。

Node 生成仅本进程使用的随机内部 Bearer，启动 Python 回环服务；SHA 清单验证、权重加载及一次真实 synthetic 前向均通过后才开始监听 8080。Python 异常退出会关闭入站服务并使宿主失败，缺权重或 Laya 配置不会静默用旧 Agent。两个进程的受控停止复用原取消链；CPU 前向不可强制 HTTP 抢占，结束前服务保持忙状态。Python stdout/stderr 不公开，凭据与源正文不进入日志；公开 JSON 日志只记录 `laya_ready`、`laya_choice` 的请求、候选及耗时。

所有工作流与旧编排器共享同一 typed-choice 队列。候选生成与无关工具可并行；同一事件循环内已就绪的独立判断经 `setImmediate` 收集，最多按现有服务能力合为 4 项异构微批，没有另设固定等待窗。每项保留自己的完整 state、questions、候选及原 deadline；一个预热实例将独立编码行放入一次 SDK forward，分别解码。只有一项时继续走原单项接口，不把依赖节点强行并行。批与批之间仍串行，不增加第二权重实例或固定排队上限。

原 deadline 与取消覆盖等待。客户端超时后下一批先读回 `/health.inferenceBusy`，只对明确未受理的 429 等待空闲后重新提交，已受理的模型调用不重放。这个机制不改变未知工具写入必须先核实的规则。日志的 `batchId` 标识共享 forward；`batchSize` 为实际进入 forward 的有效项数，`submittedBatchSize` 为 HTTP 提交项数，`batchItemId` 是内部随机身份。多 question 项可能编码为更多行，项数不冒充编码行数。`sharedForwardScope=sdk_heterogeneous_forward` 的时间在每项回执重复出现，不能相加为多次独立前向。

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

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-12）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [当前设计审查门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。任意一位符合条件的非作者在当前 head 实际阅读并有效批准后，才可按授权合并；三人平等分担审查与合并责任，不得推卸，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
- `PA_AGENT_INBOUND_TOKEN`：可选额外入站保护；至少32字符，调用方走已有Authorization宿主注入。
- `PA_AGENT_WSS_AUTH_TOKEN`：可信宿主注入的入站 WSS/状态查询凭据，至少32字符；缺省继承 `PA_AGENT_INBOUND_TOKEN`，二者都缺失时 `/ws` 与状态查询关闭。与模型密钥无关。

`npm run start --workspace=@personal-agent/agentarts-runtime`。
独立模式只绑定 127.0.0.1，不改变 Desktop 的正式比赛 endpoint。
AgentArts 模式监听 0.0.0.0，必须由平台入站认证保护；直接运行裸容器不等于安全公开服务。
session 与 request 头只用于关联，不记录模型输入和凭据，不宣称已迁移平台会话存储。

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
