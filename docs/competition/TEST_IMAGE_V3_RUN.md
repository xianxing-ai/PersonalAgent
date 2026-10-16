# V3 本地运行与协作者接线

目标为 `huawei_ict_agentarts`。本指南对应仓库现有公开入口；先阅读
[协作者接口](PROACTIVE_COLLABORATOR_INTERFACES.md)、[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)
及[验证记录](TEST_IMAGE_V3.md)。新增主动接口仍为 provisional，缺端口明确 unavailable。

当前本地 tag 为 `personal-agent:test-v3-final-local-laya`，已构建并上传现有私有 SWR：
`swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:local-laya-v3-244ca434`。
ARM64 index 摘要为 `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`；
现有自有 Runtime 版本 `arm64-local-v3-244ca434` 已经精确目录调用验证。
见[发布回执](evidence/test-image-v3-20261015/owned-release.json)。tar/压缩包另以实际清单为准，
上传与目录调用本身不代表完整业务验收。当前 Wukong、Pelican 的本机镜像全流程证据
另见 [真实结果](evidence/test-image-v3-20261015/full-workflow-results.json)，不扩大到全部业务。

## 仅查看原 Node.js 设计网页

先解压 `PersonalAgent-source.zip`，进入其中的 `PersonalAgent/`。直接用浏览器打开
`docs/design/workflow-architecture-20261013/index.html` 即可离线查看，无需模型、Docker 或账号。
如果要修改源码或用 Node.js 启动网页：

```powershell
cd docs/design/workflow-architecture-20261013/source
npm ci
npm run export:offline
npm run preview -- --host 127.0.0.1 --port 4173
```

在 Chrome 打开 `http://127.0.0.1:4173/architecture.html`。
本轮沿用原 React/React Flow 网页，更新全部 28 工作流、节点详情、机制、平台和协作接线。
网页检查见其目录的 `viewer-validation-20261016.json`；页面不调用真实模型或工具。
以下章节用于完整 Agent，需要另行准备宿主与服务配置。

## 载入与启动完整 Agent

在已具备 Docker ARM64 运行能力的机器上，用 PowerShell 7 执行。路径由接收者本机输入；tar 与预期 SHA256
从最终交付 manifest 获取，当前不预填。`docker load` 只是载入镜像，不会安装本机 Laya 权重。

```powershell
$paTar = Read-Host '最终镜像 tar 的本机绝对路径'
Get-FileHash -LiteralPath $paTar -Algorithm SHA256
# 与实际最终 manifest 独立核对后继续。
docker load --input $paTar
$paImage = 'personal-agent:test-v3-final-local-laya'
docker image inspect $paImage --format '{{.Id}} {{.Architecture}}'
```

若 tag 不存在或不是 arm64，先核对实际交付，不能自行把中间镜像改名当最终镜像。
受信宿主在仓库外准备专用 env-file，限制文件访问权限，不把其内容附到日志、聊天或 Evidence。
以下只是字段模板，所有尖括号均须以部署方真实配置替换；不包含可调用端点或凭据：

```dotenv
PA_AGENT_HOST_MODE=agentarts
PA_AGENT_LAYA_MODE=local
PA_AGENT_MODEL_ROUTE=agentarts-proxy
PA_AGENT_MODEL_BASE_URL=https://<实际AgentArts代理域名>/inference/v1
PA_AGENT_MODEL_PROXY_KEY_HEADER=Authorization
PA_AGENT_MODEL_PROXY_KEY_PREFIX=Bearer
PA_AGENT_MODEL_API_KEY=<该AgentArts入口的实际凭据>
PA_AGENT_MODEL=<平台实际启用的DeepSeek模型标识>
PA_AGENT_MODEL_REQUEST_PROFILE=huawei-openai-v1
PA_AGENT_WSS_AUTH_TOKEN=<至少32字符的本地受信传输令牌>
PA_AGENT_INBOUND_TOKEN=<至少32字符的外层入站令牌>
```

`huawei-openai-v1` 是当前平台 StandardOpenAI 请求适配；若实际供给协议不同，须由宿主核对实际 deployment
及已支持的 request profile，再明确配置，不能靠改模型名猜协议。模型四角色 fast/world/plan/review 默认共享上述
模型配置，也支持 main.mjs 既有角色配置。DeepSeek 必须经真实 AgentArts `/inference/v1` 代理；适配器追加
`/chat/completions`，以指定 header 及显式 prefix 注入原始代理密钥，禁止直接 MaaS/供应商 fallback。
本轮同一密钥的实际单变量鉴别中，自定义头收到入站 401，Authorization Bearer 通过入站并到达出站凭据读取；
因此以上模板按该代理实际结果填写，而不是把文档中的自定义头示例当作已实测可用。原始 key 不包含 Bearer。
当前代理的出站凭据权限与最终模型回复已取得 HTTP 200，时间、请求 ID 和范围见发布回执；
协作者自己的配置仍须独立验证。底层供给若为平台 MaaS，
在回执中如实记录。URL 与 header 格式通过只证明配置合法，不证明平台已启用或模型可调用。

```powershell
$paEnvFile = Read-Host '仓库外受信 env-file 的本机绝对路径'
docker run --detach --rm --name pa-v3 --platform linux/arm64 `
  --publish 127.0.0.1:8080:8080 --env-file $paEnvFile $paImage
Invoke-RestMethod 'http://127.0.0.1:8080/ping'
```

生产入口需要到真实模型代理的网络；离线 `--network none` 只适用于已有 synthetic smoke，不能用于真实推理。
首次不要添加源码 overlay。可选 `PA_AGENT_SERVICES_CONFIG_FILE`、`PA_AGENT_PLATFORM_ADAPTER_FILE` 指向的是
**容器内**受信文件路径，须另用只读 bind mount 映射本机配置/适配器，并按其公开契约提供依赖；不能仅填宿主路径。
未绑定端口可读取 descriptor，但不能执行对应能力。容器本地盘不代替原 Runtime 持久状态。

## 认证读取目录与状态

下面只读取目录，不调用模型。输入与 env-file 中 `PA_AGENT_WSS_AUTH_TOKEN` 相同的令牌；不打印令牌。
`x-pa-agent-token` 走现有受信内层认证。外层 AgentArts 接入还保留其原认证，不混用代理模型 key 与此传输令牌。

```powershell
$paTransportToken = Read-Host '本机传输令牌' -MaskInput
$paHeaders = @{
  'x-pa-agent-token' = 'Bearer ' + $paTransportToken
  'x-hw-agentarts-session-id' = 'local-v3-directory'
}
function Read-PaV3([hashtable]$Value) {
  $paHeaders['x-request-id'] = [guid]::NewGuid().ToString()
  $paBody = @{query=($Value | ConvertTo-Json -Depth 30 -Compress)} | ConvertTo-Json -Compress
  $paFrames = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/invocations' `
    -Headers $paHeaders -ContentType 'application/json' -Body $paBody
  $paFrames[0].data.text | ConvertFrom-Json -Depth 50
}
Read-PaV3 @{workflowVersion='1.0.0';operation='catalog'}
Read-PaV3 @{proactiveVersion=1;operation='describe'}
Read-PaV3 @{platformVersion=1;operation='list'}
```

预期 workflow 目录保留 F01–F28 / 185 节点模板；这不是 28 项业务验收。proactive descriptor 为
`proactive.responsibility.v1`，入口 connector/user_instruction/subtask_feedback/wake。
`/ping`、目录与认证成功均不证明连接器账号、模型、语音或设备已接通。
完成后用 `docker stop --time 10 pa-v3` 停止自己启动的容器。

## Runtime、连接器、通知的组合位置

在已有受信 Runtime composition 中使用公开 exports；完整参数类型见协作者接口与各模块源码/README。
这些是宿主组合接口，不是向模型开放的新 REST，也不能用签名 receipt 当授权。

| 组合入口 | 必须绑定的实际内容 |
| --- | --- |
| `@personal-agent/runtime`: `createRuntimeAtomicStatePort(runtime,namespace)` | 原 TaskRuntime SQLite；同步 read/CAS，不以普通 StoragePort 冒充原子状态 |
| `@personal-agent/runtime/application`: `createRuntimeProactiveConnectorHost({atomicState,...options})` | 原 ConnectorHost、已授权 source、持久 event sink、原 Scheduler；pending→sink durable ack→cursor，不丢失未确认批次 |
| 同入口 `createProactiveWorkflowSession({atomicState,binding,assertActive,advancePort,verifyAdvance,...})` | 原 task/session/controlRevision/taskDeadline；认证 HTTP、请求/响应验签；先存 intent，CAS 后释放 proposal |
| session 可选 execution | 原 AgentToolPort、resolveInvocation、readExecution；Policy/ToolGateway 的原授权及 run/Evidence 读回；未知写只核原 operation |
| session `recoverPendingRequest` | 仅受信 `pureAdvance:{kind:'signed_frontier_no_effects'}` 可重算丢失纯 frontier；使用冻结输入，不能调用模型/工具或延长期限 |
| 同入口 `createRuntimeNotificationHost(runtime,{policy,settingsScopes,verifyUserCommand,...})` | 内部复用 `device-notifications` 原子 namespace；真实最终用户命令验证不可省略，partial/echo/model 不能更改设置 |

通知 facade 的 ingest/feed/read ack、policy、reserveInterruption、beginDelivery、completeDelivery、getDigest
全部委托同一 NotificationService。global→connector→responsibility 继承，全局静默和额度不能被局部绕过；
发送前再查最新策略及 preferredChannel。同轮跨通道/重试只计一次，unknown 不退款或另建轮次重发。
静默继续工作与 feed；return 仅汇总仍有效变化，不重播旧横幅/语音。实际渠道投递仍须原设备工具和 Evidence。

frame/event/responsibility/receipt/control 使用
`@personal-agent/agentarts-runtime/proactive-controller` 的 `createProactiveHostProofs` 及原受信密钥派生，
绑定实际 task/session/revision/deadline；frame 另绑定 requestId 与真实当前 capability/hostAvailability。
HTTP headers 必须匹配，不能直接复制 synthetic smoke 的证明材料用于真实任务。

## 本机 Laya 与语音

Laya 沿用本机 `convaiinnovations/laya` multilingual（mmBERT322M），既有 revision
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`、SDK `0.3.20` / transformers `5.17` 基线；
实际安装与模型 manifest 由接收者本机独立读回。本包不下载、更换、训练或升级权重，权重不在此镜像中。
宿主通过既有本机 Laya 端口完成候选选择并提供受信回执；`PA_AGENT_LAYA_MODE=local` 只是声明该部署方式，
不代表容器可访问接收者 GPU、模型目录或已运行的进程。CPU/CUDA、精度、线程及端口均须显式按本机条件选择。

语音使用既有百炼 Live 端口：在 Desktop 的 Live 实时语音设置中配置本机业务空间/API Key，走主进程既有
加密存储和上传同意流程；不把语音 key 写进镜像 env-file，不把语音 endpoint 当 DeepSeek fallback。
最终结构化用户命令经 NotificationHost 的 verifyUserCommand 绑定设置 operation/revision/scope/patch；
听到语音不等于模型获得改策略权限。AgentArts→华为 SIS 平台适配仍 unavailable；旧本地 SIS 设置与百炼
Live 是不同链路，存在设置 UI 不能当平台连接证据。真实麦克风、音频上传和播报须各自实际验收。

## 显式启动公开 Wukong runner

这是会调用真实模型并启动本机浏览器/Laya 的手工验收入口，仅在获得该范围授权且完成实际接线后运行。
从仓库根目录、匹配本仓库要求的 Node 环境执行；先确认容器以 `PA_AGENT_TEST_VERSION=1` 启动，
否则 testVersion capabilities/model_turn 不可用。它使用公开 fixture 目录，不把用户实际工作区当试验目标。
`run-wukong-test-version.ps1` 已改为参数化本机 Python、模型、浏览器、Node/Docker、设备与端口。
本文的 stdin 入口与该 launcher 共用原 runner；launcher 不安装依赖或下载模型。

```powershell
$paPython = Read-Host '含原 Laya SDK 的 Python 绝对路径'
$paModelPath = Read-Host '含已验证 asset-manifest.json 的本机模型绝对目录'
$paBrowser = Read-Host '本机 Edge 可执行文件绝对路径'
$paPwsh = (Get-Command pwsh).Source
$paSteps = [int](Read-Host '本次明确选择的 maxSteps')
$paDeadline = Read-Host '本次原任务 deadline，UTC ISO，例如 YYYY-MM-DDTHH:mm:ss.fffZ'
$paLocalPort = [int](Read-Host '本次本机 Laya 空闲端口（>=1024）')
$paConfig = @{
  image=@{url='http://127.0.0.1:8080/invocations';token=$paTransportToken;modelRef='plan';reasoningEffort='none'}
  localLaya=@{modelPath=$paModelPath;port=$paLocalPort;device='cpu';torchThreads=1}
  python=$paPython;browserPath=$paBrowser;powerShellPath=$paPwsh
  maxSteps=$paSteps;deadline=$paDeadline;faultInjection='pause_smil'
  modelRevision='55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'
}
$paConfig | ConvertTo-Json -Depth 20 -Compress | node tests/manual/agentarts/wukong-test-version.mjs --live
$paRunExit = $LASTEXITCODE
$paConfig = $null
'runner exit code: ' + $paRunExit
```

CPU 示例只说明参数形状，不承诺速度；CUDA 必须有匹配的原环境，按实际条件显式修改 device/torchThreads，
需要隔离依赖目录时使用现有可选 pythonModulePath。runner 会先让模型从 scaffold 生成初稿；初稿自然失败
直接保留真实失败反馈，否则按两个动画 ID 注入暂停并实际验证失败。主/影子共用同 fault baseline/currentSHA，
分别执行与验证，最终按最新 SHA 单 CAS 交付。JSON summary 返回实际 `.cache/wukong-test-version-*` 目录，
其中 report.json 含各阶段时间、模型调用、分支、失败、SHA 与交付回执；失败/unknown 按报告处理，不盲重试。
真实视觉可辨识性仍需查看实际截图，不把静态 ID 和运动检查当“孙悟空/白龙马”语义验收。

## 尚需绑定或独立验收

未绑定 MCP/ToolExecution、持久云宿主、真实连接器授权/订阅、配置发布 port、设备通知/语音或本机 Laya 时，
相应接口保持 unavailable/waiting_device/waiting_reconciliation；不会由容器、模型或新的队列兜底。
本地 load/run、目录、synthetic smoke、真实模型、真实设备、最终构建和平台部署分别提供回执。
当前最终镜像 tar 的 SHA、包内容和制品下载地址以
[交付清单](evidence/test-image-v3-20261015/test-kit.json) 为准。
当前两条成功案例、保留的鹈鹕首轮失败、41 条持久 Evidence 和 150ms 未达标结果见
[完整结果](evidence/test-image-v3-20261015/full-workflow-results.json)。
本指南不会自动发布镜像，仓库提交也不代表已合并；平台调用和设备能力各按实际回执验收。

## 真实双案例 launcher 与本机凭据配置

以下操作只在执行者已获真实模型调用授权时使用。接收者在自己的 Windows 账户内创建
DPAPI CurrentUser 配置，不能复制其他用户的密文冒充接入成功。模型代理 key 与 Runtime 入站令牌
分开，下面只保存模型代理配置，不把明文 key 放到参数、Git 或输出。

```powershell
Add-Type -AssemblyName System.Security
$paProxyUrl = Read-Host 'AgentArts 模型代理完整地址，结尾 /inference/v1'
$paProxyModel = Read-Host '代理实际启用的模型 ID'
$paProxyKey = Read-Host '该代理的原始入站 key' -MaskInput
$paProxyConfig = @{
  proxyBaseUrl=$paProxyUrl;proxyModel=$paProxyModel;proxyApiKey=$paProxyKey
  proxyKeyHeader='authorization';proxyKeyPrefix='Bearer';requestProfile='huawei-openai-v1'
}
$paBytes = [Text.Encoding]::UTF8.GetBytes(($paProxyConfig | ConvertTo-Json -Compress))
try {
  $paProtected = [Security.Cryptography.ProtectedData]::Protect(
    $paBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  New-Item -ItemType Directory -Path '.cache' -Force | Out-Null
  @{ciphertext=[Convert]::ToBase64String($paProtected)} | ConvertTo-Json |
    Set-Content -LiteralPath '.cache/local-model-proxy.dpapi.json' -Encoding utf8
} finally {
  [Array]::Clear($paBytes,0,$paBytes.Length)
  $paProxyKey=$null; $paProxyConfig=$null
}
```

从仓库根目录执行；Python/模型/浏览器路径由各自电脑配置。首次以 CPU/单计算线程运行；
需要 CUDA 时使用本人已具备的匹配环境并显式指定 `-Device cuda`，不自动安装 GPU 依赖。

```powershell
$paPython = Read-Host '已具备原 Laya SDK 的 Python 可执行文件'
$paModelPath = Read-Host '已核验 multilingual 资产目录'
$paBrowser = Read-Host '本机 Edge 可执行文件'
$paLaunch = @{
  ProxyConfiguration='.cache/local-model-proxy.dpapi.json'
  PythonPath=$paPython;ModelPath=$paModelPath;BrowserPath=$paBrowser
  Device='cpu';TorchThreads=1;Image='personal-agent:test-v3-final-local-laya'
}
& './tests/manual/agentarts/run-wukong-test-version.ps1' @paLaunch -Scenario wukong
& './tests/manual/agentarts/run-wukong-test-version.ps1' @paLaunch -Scenario pelican
```

两条命令串行运行，各自结果在忽略的 `.cache/<scenario>-launch-*` 和 runner 报告目录。
只有配置完成后才能运行；网络、账号或验证失败原样保留，不无限重试。默认端口 44173/44174
可分别通过 `-ImagePort`、`-LayaPort` 显式选择。需要隔离 Python 依赖时使用 `-PythonModulePath`。
`-UseCurrentImageSources` 仅作显式诊断，会记录 overlay SHA；正式已发布镜像验收不用它。
本轮运行路径参数化后只做语法及现有镜像身份核验，未为文档更新再次消耗模型调用。

## 构建、发布与制作交接包

`scripts/agentarts/release-owned-image.ps1` 默认只检查现有镜像；只有明确 `-Build` 或 `-Push`
才分别构建、上传。Docker 登录交给执行者本机已有 credential store；脚本不接收密码，
不新建 AK，不修改 IAM，不自动部署 Runtime。不要为保持登录把明文 key 写入脚本。

```powershell
# 初次拉取源码：使用仓库指定 Node 24.15.x / npm 11.12.x。
npm ci
# 如确实要产生新镜像；新摘要须独立验收，不沿用本轮 244ca434 的成功结论。
& './scripts/agentarts/release-owned-image.ps1' -Build -Image 'personal-agent:my-build'
# 已通过本机 docker login 后，明确指定自己的目标才上传。
$paRemote = Read-Host '已获发布权限的 SWR 完整镜像引用'
& './scripts/agentarts/release-owned-image.ps1' -Image 'personal-agent:my-build' -Push -RegistryReference $paRemote
```

现有发布不需要重新构建。平台部署沿用自有 Runtime，保留旧版本，新版本设置镜像引用、8080、
原入站/WSS 身份及 AgentArts 模型代理；以指定 `?endpoint=<version>` 调用读回目录并关联平台日志。
不要复制旧 Studio 镜像的 `AGENT_ENTITY_ID` 绑定操作，也不以变更网关描述当作沙箱修复。

交接包使用 `scripts/agentarts/package-test-kit.ps1`，参数是**已有**镜像摘要和由
`image-context.mjs` 生成的公开构建上下文。它不调用模型、不构建、不登录或发布。

```powershell
$paContext = Read-Host '本次已核验的构建上下文目录'
$paOutput = Read-Host '交接包输出目录'
& './scripts/agentarts/package-test-kit.ps1' -ContextDirectory $paContext -OutputDirectory $paOutput `
  -ExpectedImageId 'sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1'
```

包内含镜像 tar、构建上下文、源码快照、RUN 和 MANIFEST，均有 SHA256；不含本机 Laya 权重、
账号配置和缓存。镜像 tar 适用于具备 ARM64 Docker 运行能力的环境；有 Node.js 本身并不等于
具备 Docker、Python/Laya、浏览器和服务账号。每位 MOD 负责人按
[接线总包](COLLABORATOR_WIRING_PACKAGE.md) 完成自己的实际消费接线和验收。
