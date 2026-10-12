# 自有 AgentArts Runtime 镜像

2026-10-12 真实部署增量：ARM64 源码 `194799c6979ed47d20dfd2d3ea17bbfd16f63fd6` 已发布并替换 Huawei Latest。平台公开路径为 `/runtimes/<runtimeName>/invocations/ws`，目录为 `/runtimes/<runtimeName>/invocations/bindings?endpoint=Latest`；平台 Session 头、外层鉴权及独立镜像凭据均必需。官方 MaaS DeepSeek 的 none 参数经宿主映射为 `chat_template_kwargs.thinking=false`。真实 WSS 模型/本地一次性授权文件读取/Evidence/续答场景已通过；逐项绑定、写入、Wiki、完整自主修复和备用整链仍未验收，详见 [实际证据](../../docs/modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。这是未合并预览，不提高公共协议冻结状态。

2026-10-12：同一 HTTP/WS query 可显式选择8个Workflow或3个Controller；新增受宿主凭据保护的
`GET /bindings`，可信启动可设置 `PA_AGENT_DEFAULT_CONTROLLER_ID`。普通调用保持兼容。
World/Plan角色报告保持独立，不作为旧公共候选执行；原空MVP标记新owned绑定。
详见 [资源绑定与调用](../../docs/competition/OWNED_IMAGE_BINDINGS.md)。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
