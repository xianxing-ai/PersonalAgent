# 镜像内 Laya 与 28 工作流：发布和开发调用

<!-- current-design-alignment-20261015 -->
## 当前口径与历史适用性（2026-10-15）

当前以[详细设计](../design/CURRENT_DESIGN_20261015.md)区分设计意图、已有代码、待接线与真实验收；架构仍未最终定型。
本机Laya、全部28图/185节点镜像串行编排，未合格判断升级经AgentArts代理的DeepSeek；语音百炼既有端口，SIS平台不可用。
SWR `local-laya-v3-244ca434` 已发布，digest `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`，
云指定版本 `arm64-local-v3-244ca434` 目录与关联日志已验，见[发布回执](evidence/test-image-v3-20261015/owned-release.json)。
两案例完整执行表面为本机同版镜像+本机Runtime/Policy/工具/Laya+远端AgentArts模型代理，
见[真实执行汇总](evidence/test-image-v3-20261015/full-workflow-results.json)：Wukong167.432s、Pelican第二轮81.611s，41工具Evidence；首轮partial保留。
分支父成功、协调锚点created；28目录不等于28业务验收。6次判断182–618ms未达150ms，各案例3裁决均升级DeepSeek，未证高级调用减少或训练。
主动责任、无人值守、归来摘要、用户可调打扰/静默feed与语音确认复用原端口。
高级影子与已有判断合并、主任务优先、按机会资源/收益决定；真实runner目前顺序await主/影，机会并行与普通任务先交主结果仍待接线。
以下带日期的嵌入式、直连MaaS、未发布与旧未验记录均保留原版本范围，冲突部署/完成状态已superseded，不作为当前启动参数。
当前启动只用 `PA_AGENT_LAYA_MODE=local`，镜像不含模型权重、Python或PyTorch；不直连提供商fallback。
旧协作门槛以当前CONTRIBUTING/AGENTS为准，文档或receipt不授予权限。

> 2026-10-15 当前方向已经由 Owner 改为 **本机 Laya + 镜像串行工作流**。
> 本文件下文保留旧版本的发布和实测记录；新代码调用见 [当前接线说明](LOCAL_LAYA_WORKFLOW_WIRING.md)，
> 不把历史嵌入式镜像Evidence当成本版发布证据；早期暂不发布限制已由后续明确授权及独立SWR回执取代。

目标 Profile：`huawei_ict_agentarts`。对应设计 PR #349、设计页 PR #352；本文件随实现 PR 交付。

## 历史开发增量（早期2026-10-15，当时尚未发布）

当前开发源码为 `e4c87c1d25514422880f370f939a0a41a8962725`，模板版本为 `2026.10.15.1`。
它没有发布到 SWR 或 AgentArts；下节 `fe886677` 的历史镜像、平台调用与公共 Evidence 保留原样。
完整开发证据及缺项见[2026-10-15 开发记录](OWNED_LAYA_DEVELOPMENT_20261015.md)。

28 个功能、185 个详情节点的范围保留，以设计页 PR #352 已评审的数据同步生成来源与投影。
F20 的四节点职责已修正：N01 读取代码/契约来源，结果为 `sourceReadback`；N02 基于实际来源比对，
生成 `diffFields`、`docMarkdown` 和 `exampleArguments`；N03 请求原受控命令，由真实 `tsc --noEmit`
与固定公开 fixture 差异检查共同验证，必须 `sourceDifferenceMatched=true`；N04 根据真实来源及检查回执
复核候选，保持 `synchronized:false`，不表示已经外部发布。

模板版本与摘要变化会拒绝旧模板 checkpoint。这里没有自动跨模板迁移：原版本保留在途任务，
不得把旧检查点或未知操作换成新模板重新执行。相同模板内的受信 revision 迁移，只新增一项恢复：
受影响、无 proposal、因 `Unique selector requested recheck; no operation proposal emitted` 进入 `unknown` 的 tool 节点可回到 pending。
相同 revision 不重新选候选；已有 operation 的原身份、参数、回执与效果记录均保留，迁移证明不授予执行权限。

实际 tokenizer 预检动态设置完整 SDK 窗口，最高受已加载编码器的 8192 token 限制，核对实际 usage 与预期序列，
不截断源材料；超限在 forward 前拒绝。tokenizer 预检后、启动 forward 前重新检查原 deadline，
父 worker 未启动时也不会等待不存在的 finally。当前节点职责、候选所处阶段和准确发布的工具 Schema
同时提供给 MaaS 候选制备和 Laya；这些修复没有改变唯一 Laya 的决策位置或移除 review。

| 2026-10-15 验证表面 | 实际结果 |
| --- | --- |
| 原生 Windows 真实调用 `live-wmFfjy` | 实际 MaaS 与真实 Laya；N01 选择 `owned-review`，父任务 failed，工具/Evidence 均为 0；完整 F20 未跑通 |
| 本次时间与 token | 提案 HTTP 4,699 ms；MaaS 2,747.0691 ms；Laya SDK `predict_batch` 1,917.7058 ms；selector 1,943.6092 ms；1,007 tokens、dropped=0、未截断 |
| 固定 6 探针 | 两种固定提问 × 合法路径/错误路径/缺 Schema，真实权重均选择 review；输入为手写公开 fixture，无 MaaS，不作为准确率或泛化结论 |
| 受影响测试 | 75 项通过：图 18、orchestrator 20、selector 14、manual/exporter 23；这些测试各自的替身与真实编译器范围不变 |
| 全量检查 | 本轮 `e4c87c1d` 的 `npm run check` exit 0：3,111 项，3,093 通过、18 跳过、0 失败；`388a7e5` 历史 3,108 项单独保留，不累加 |
| ARM64 增量镜像 | 独立实际验收尚未完成；不以本地 Windows、旧短样本或增量镜像准备状态填充通过 |

上述 Windows 时间不是华为原生 ARM64 延迟，也不是纯神经网络 forward 基准或稳定 SLA。
目前源码仍是唯一 Laya 决策、国内 MaaS 生成执行候选；改为一个国内 MaaS 决策中枢仍属建议，尚未获替换实施授权。

## 历史发布实测状态（2026-10-14）

本版是可供协作者继续开发的预览。SWR 镜像和 AgentArts 新版本已分别读回；真实云调用已完成一次公开文件读取、来源回执入图及持久读回，平台日志已关联本次两次 Laya 选择。后续模型节点由唯一选择器请求复核，整图为 `unknown`；这是语义复核，不是网络断流或工具 `RESULT_UNKNOWN`，不得报告完整业务成功。

本次随 PR 提交的[公共 Evidence JSON](evidence/OWNED_LAYA_20261014.json)将镜像、SWR、部署、真实工具、日志及缺项分阶段列出。
完整源码 SHA 来自 buildx provenance；平台配置引用对应的摘要由 SWR 独立读回关联，
不是控制台直接报告完整 SHA/digest。原 CPU 验收回执未内嵌源码或摘要，目录数量保留为未绑定观察；
原云调用回执缺 invokeMode，因此发布与本次调用的完整关联仍未升级为 verified。

| 验证表面 | 本次实际结果 | 范围 |
| --- | --- | --- |
| 源码基线 | `fe886677d72a6f7a3312e054c68ef4d74a804fc4` | 本版镜像的应用源码；后续文档提交独立于镜像版本 |
| ARM64 CPU 镜像 | Linux ARM64、Torch `2.14.0+cpu`、Laya `0.3.20`、真实 multilingual 加载预热及 typed choice 通过 | 本机 x86 经 QEMU，网络 none、一个 Laya 实例，0 MaaS、0 工具、0 外部副作用 |
| 模型 revision | `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` | 五个实际模型资产，启动前 SHA 清单核实 |
| 图目录 | 28 个模板、185 个详情节点 | 不等于 28 个业务能力全部验收 |
| SWR | 同内容推送最终 exit 0，独立 `imagetools inspect` exit 0 且 ARM64 manifest 摘要一致 | 镜像发布确认，与 AgentArts 运行分别记录 |
| AgentArts | 现有 Runtime 的 `Latest` 已读回为 `arm64-laya-fe886677`，本版镜像 tag 已读回，日志开关已开启 | 日志配置开启与实际请求日志关联分别记录 |
| 真实云目录 | 28 项目录 HTTP 200，879 ms | 本次请求总耗时 |
| 真实云提案 | 2,726 ms，精确公开文件读取提案 | 本次请求总耗时，不能当单独 Laya 前向耗时 |
| 本地执行与续图 | 审批前读取 0 次；一次 `allow_once` 后生产读取 1 次、Evidence 1 条（`conditional`），独立文件 SHA 读回；来源签名续图 3,997 ms，原 N01 completed | 验收程序对固定公开 fixture 的授权，不是 Desktop 或语音确认实测 |
| 持久读回 | SQLite 重开后保留原工具/Evidence，新增网络和工具执行均为 0 | 不重放原操作 |
| 后续模型与整图 | `partial_receipt_admitted_model_recheck`，后续完成模型节点 0，图为 `unknown`；F20_N02 明确记录选择器请求 recheck，不执行或激活分支 | 三次派发均 `response_validated`、`unknown[]` 为空；保留语义 partial，不强制覆盖选择结果或反复运行消除 partial |
| 平台日志关联 | 控制台真实日志读回 `laya_ready`：embedded / multilingual / warmed=true，并关联本次 proposal 与 receipt_resume 的 `laya_choice` | 平台运行日志观测已验证；完整 OTel Trace、原生知识/MCP/评估仍另验收 |

本版 SWR 引用：

```text
swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:laya-fe886677
```

远端独立读回的单 ARM64 manifest：

```text
sha256:8120ad11915c5de9c6daa61b492d3228872978ccfbc0f9a79acf59432f42366c
```

本地构建产生的 OCI index：

```text
sha256:8dd561e49b45e5f352e08be30bd001c330f8592ff8f49b10ea3e3a691a7c4b2a
```

推送使用 `--platform linux/arm64`，远端保存单 ARM64 manifest，因此 index 和 manifest 摘要不是同一种对象。部署及远端读回对照 ARM64 manifest；不把二者差异直接判断为上传损坏。

原生华为 ARM64 的本次平台日志样本：

| 请求阶段 | 关联 requestId | Laya 选择 | 日志记录的选择耗时 |
| --- | --- | --- | --- |
| proposal | `owned-2810ad87-81ab-4d59-bf71-04aab8495632` | `candidate-001` | 881 ms |
| receipt_resume | `owned-21a88893-6c0a-4cbb-9782-ccfe28d408cd` | `owned-review` | 1,477 ms |

这些是两条真实平台选择记录，不是稳定延迟 SLA 或纯模型 forward 基准；日志耗时是选择器记录的整体区间。上表 HTTP 总耗时仍为目录 879 ms、提案 2,726 ms、续图 3,997 ms。QEMU 的 58,697 ms 合成 choice 与原生平台样本属于不同执行环境，分别保留。

## 交付边界

本次提供镜像内真实 Laya multilingual 权重与 CPU 服务、28 个图模板和推进器、可信本地工具回执桥。
图目录不是 28 个业务能力的完整验收。实际注册的工具经过原 Runtime / Policy / ToolGateway；
未接入的语音、知识、平台 MCP、业务写入、影子隔离和评估宿主明确返回 unavailable。
现有 Runtime wire `1.0.0`、Coordination 传输 `0.1.0` 保持原含义；图的
`workflowVersion: "1.0.0"` 是独立的 provisional 应用协议，不等于旧 CloudAgentPort 已能直接消费图结果。

Laya 只在有限候选中做语义选择；MaaS 执行模型生成候选。模型不签发授权，也不决定本地任务终态。
新镜像要求 embedded Laya，不会缺配置回退到其他决策模型。平台失败不静默回退 Local。

## 可复现构建

使用根 `.node-version` 与锁文件规定的 Node/npm，先执行 `npm ci` 和 `npm run build:owned-agent`。
受信构建机以环境变量指定公开模型缓存；不要把整个用户缓存或云导出放进上下文：

```powershell
$env:PA_LAYA_MODEL_SOURCE = '<multilingual 模型目录>'
$env:PA_LAYA_ASSET_ROOT = '<上述五个公开资产真实路径的共同信任根>'
$env:PA_LAYA_MODEL_REVISION = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'
$env:PA_LAYA_WHEELHOUSE = '<完整 cp311 Linux ARM64 CPU wheelhouse>'
$context = node apps/agentarts-runtime/scripts/image-context.mjs | ConvertFrom-Json
docker buildx build --platform linux/arm64 --load --progress=plain `
  --metadata-file .cache/image-build.json -t personal-agent-owned:<版本> $context.context
docker image inspect personal-agent-owned:<版本> --format '{{.Os}}/{{.Architecture}} {{.Id}}'
```

导出只包含五个生产 workspace、公开 Python 源、五个模型资产及清单；无本地数据库、云导出、`.env` 或账号。
资产逐文件 SHA256 验证。Docker 使用独立 Linux Python 3.11 venv；Torch 固定
`2.14.0+cpu`，从预准备 wheelhouse 离线安装完整依赖、`pip check` 和真实 CPU 导入。
普通 PyPI ARM64 `2.14.0` 包有 CUDA 依赖，不能替代 `+cpu`。CPU 包来源、SHA 和国内镜像约束见
[镜像 README](../../apps/agentarts-runtime/README.md)。模型启动和推理无需国外网络；
首次构建机仍需获得 CPU wheel 与固定 Node 基础镜像，不能把这一点写成无条件墙内可重建。

为他人运行提供国内 SWR 成品镜像，构建日志、镜像 digest 和模型 revision 分别留证。
镜像不内置生产密钥；需使用原受信宿主配置。

本次实际成功使用 Docker 客户端，任务专用 Docker 配置调用 Windows `desktop` 凭据 helper；登录以安全内存 stdin 向 `docker login --password-stdin` 提供凭据。以下变量只包含公开镜像引用和任务配置路径，占位路径由操作者本机替换，不公开个人路径或凭据配置：

```powershell
$taskDockerConfig = '<任务专用 Docker 配置目录>'
$releaseImage = 'swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:laya-fe886677'
docker image tag personal-agent-owned:laya-fe886677 $releaseImage
docker --config $taskDockerConfig push --platform linux/arm64 $releaseImage
docker --config $taskDockerConfig buildx imagetools inspect $releaseImage
```

应分别记录 push 的退出码和随后独立 inspect 的 digest。本次首次网络提交超时后，独立读回尚无 manifest；相同内容续推最终成功，再经独立读回确认上列摘要。该内容寻址镜像上传记录不授权重试未知业务写入。

## 发布到现有 AgentArts Runtime

1. 将新版本镜像推送/上传到同区域 SWR 的原私有组织和镜像仓库，保留旧 tag。
2. 在现有 Runtime 编辑镜像，保存新版本；保持既有委托、入站 API Key、网关、规格、端口 8080 和出网配置。
3. 环境配置保留既有国内 MaaS 和四角色设置。镜像提供 `PA_AGENT_LAYA_MODE=embedded`、离线资产路径；
   可由原运行环境设置 `PA_LAYA_STARTUP_TIMEOUT_MS`。内部 Python Bearer 在进程内随机生成，不需要共享。
4. 图 checkpoint 与宿主回执使用 `PA_AGENT_WORKFLOW_CHECKPOINT_KEY`、`PA_WORKFLOW_RECEIPT_SECRET`。
   正式生产应使用受信宿主独立秘密；受信协作者的开发环境可从既有 WSS secret 做用途分离的 HKDF，
   但持有该共享 secret 的开发者也能签回执，不能据此声称防恶意调用者伪造。
5. 开启原生日志，运行 JSON stdout 进入 AgentArts / LTS。日志仅含运行关联、Laya ready/choice 及选择耗时、角色开始/完成/失败和 token，
   不含源正文、模型提示或密钥。平台日志开启与真正收到本版日志分别记录。
6. 读回 Runtime/version/image/访问方式；针对新版本实际调用。配置成功和 HTTP 200 都不能替代工具/Evidence 验收。

现有目标：区域 `cn-southwest-2`，Runtime `pa-owned-bindings-0dae0ff5-api`，
ID `9a65747e-05f0-475c-a2dc-f24dd3ed87ae`。网关：
`https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com`。
`Latest` 是可移动访问方式；开发验收必须同时记录平台读回的实际版本和镜像，而不是只记录请求中的 version。

本次实际保存后的 `Latest` 指向 `arm64-laya-fe886677`。调用方继续使用明确版本进行复现，并在调用前重新核对平台当前读回；此处已记录的历史读回不能保证别人在未来调用时 `Latest` 仍指向相同版本。

## 开发接口

入口为 `POST /runtimes/pa-owned-bindings-0dae0ff5-api/invocations?endpoint=Latest`。
平台外层 `Authorization` 由受信宿主提供；镜像独立凭据放 `X-PA-Agent-Token`。
沿用 `X-HW-AgentArts-Session-Id`、`X-PA-Request-Id`、`X-PA-Deadline`。
不要把凭据放 URL、`query`、Renderer、日志、PR 或示例数据。

目录请求的 HTTP JSON 正文：

```json
{"query":"{\"workflowVersion\":\"1.0.0\",\"operation\":\"catalog\"}"}
```

查询特定模板在内部对象加 `"workflowId":"F20"`。平台返回 SSE 事件中的文本是图应用 JSON，
需要校验 workflow/template/digest，不能把 `task_end` 或模型自报文字当作本地完成。

推进内部对象：

```json
{
  "workflowVersion": "1.0.0",
  "operation": "advance",
  "workflowId": "F20",
  "taskId": "<原本地任务 ID>",
  "controlRevision": 1,
  "input": {"goal": "核对公开契约并准备 API 文档"},
  "availableTools": []
}
```

`availableTools` 必须来自真实工具目录的完整描述，不能只有自造工具名。
图结果 `proposals` 只表示提案；经本地 Runtime / Policy / ToolGateway 执行并读回后，
使用 `OwnedWorkflowHostBridge.readReceipt` 生成与原参数、runId 和 Evidence 绑定的签名回执。
后续请求带原 `checkpoint` 与该 `receipts`。严禁把客户端 `success:true` 当实际工具证据。
`settled` 仍为 `verification: "unverified"` 的云图状态，本地任务终态由现有 Runtime 判断。

修改原目标/参数后使用原 Runtime controlRevision 与受信 `migration`，不能丢掉 checkpoint 重新发写操作。
旧未提交提案不能在新 revision 首次执行；已有操作只核实/读回。大结果保留原可信来源，
通过哈希绑定的 `resolvedValues` 恢复；没有对应 Artifact/来源适配时明确 unavailable。

## Evidence 与验收记录

应分别保存：源码提交、上下文公开文件清单/哈希、构建结果与 image digest、ARM64 实际加载/前向、
SWR 上传读回、AgentArts 新版本读回、云请求关联、原本地工具 task/run/Evidence、续图与平台日志。
公开记录只保留非敏感摘要；本地 SQLite/完整私有日志不提交 Git。

原始 live `receipt.json` 包含本机绝对 `runDirectory`，连同 `state.json`、SQLite、sealed checkpoint 和原始日志均为内部验收材料。先通过白名单 Evidence exporter 投影，再审查其最终输出用于 PR/公开材料；不能直接公开原始回执，即使它没有明文密钥。

2026-10-14 阶段的历史本地检查：根 `npm run check` 为 3096 项（3073 通过、23 跳过、0 失败）；
随后恢复修复的定向图 15 项和真实 SQLite/Policy/ToolGateway 桥 1 项均通过。
这些本地测试中的模型/选择器是明确替身，不能冒充 Laya/MaaS/AgentArts 实测。
这些历史计数不覆盖本页 2026-10-15 开发增量。实际发布与调用结果在对应日期的 Evidence 中分别记录。

真实镜像离线验收：`tests/manual/agentarts/owned-laya-image.mjs`，必须在 Linux ARM64 镜像内
以 `--network none` 挂载执行；一个真实 Laya 实例，无 MaaS、工具或账号调用。
本机 x86 经 QEMU 的时间不能推断原生华为 ARM64 延迟。
第一次实际选择返回 408，诊断确认旧适配把显式 deadline 截为 30 秒；已修正为原剩余期限，
无期限旧兼容入口仍默认 30 秒。相应 Python 定向测试 3 项通过；未放宽概率、候选和身份校验。

实际成功的 QEMU ARM64 回执位于本机忽略目录 `.cache/laya-arm64-fe886677-real.jsonl`。测量结果：CPU probe 11,631 ms，服务加载与预热 74,294 ms，公开合成 choice 58,697 ms，停止 201 ms。它验证真实 CPU 权重/协议/生命周期，不验证分类质量，也不能预测华为原生 ARM64 冷启动或常态延迟。

复现时用单独容器覆盖入口，挂载当前手动脚本，不与生产入口再启动第二个 Laya 服务：

```powershell
$manualScript = (Resolve-Path tests/manual/agentarts/owned-laya-image.mjs).Path
docker run --rm --platform linux/arm64 --network none --memory 6g --cpus 2 `
  --entrypoint node `
  -e PA_EXPECTED_LAYA_REVISION=55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851 `
  -e PA_LAYA_STARTUP_TIMEOUT_MS=600000 `
  -e PA_TEST_CHOICE_TIMEOUT_MS=180000 `
  --mount "type=bind,source=$manualScript,target=/opt/personal-agent/tests/manual/agentarts/owned-laya-image.mjs,readonly" `
  personal-agent-owned:laya-fe886677 tests/manual/agentarts/owned-laya-image.mjs
```

以上内存、CPU 和期限是复现这次本机 QEMU 验收的容器参数，不是产品任务预算或语义选择门槛；部署环境使用其实际受信配置。脚本结果只收集本次公开合成答案的受限字段，不输出 Bearer、正文或凭据。

真实云端公开读取与图续跑：参照 [验收 CLI 说明](../../tests/manual/agentarts/OWNED-WORKFLOW-LIVE.md)，
从安全存储在内存构造配置，通过 stdin 调用 `owned-workflow-live.mjs`。
该 CLI 无 Fake 模型，不重试未知云请求；等待原 Policy 后只授权精确公开文件读取，
保存实际原工具/Evidence/签名续图与 SQLite 重开读回。纯 SSE 解析测试 4 项通过，不计云验收。

在已构建的本地仓库执行；`$platformBearer`、`$imageHostBearer` 由现有安全存储代码仅在内存提供，`$chosenDeadlineUtc` 由调用方按本次任务选择，示例不包含真实凭据：

```powershell
$liveInput = @{
  operation = 'live'
  gatewayUrl = 'https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com'
  runtimeName = 'pa-owned-bindings-0dae0ff5-api'
  version = 'arm64-laya-fe886677'
  expectedSourceRevision = 'fe886677d72a6f7a3312e054c68ef4d74a804fc4'
  inboundAuthorization = $platformBearer
  innerAuthorization = $imageHostBearer
  deadline = $chosenDeadlineUtc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
  workflowId = 'F20'
  invokeMode = 'published'
}
$liveInput | ConvertTo-Json -Depth 8 -Compress |
  node tests/manual/agentarts/owned-workflow-live.mjs
```

以上目标是 2026-10-14 已发布的历史版本，用于对照调用形状。当前 CLI 的完整 F20 验收需与对应源码和模板的
实际运行对象匹配；新源码仍未发布，不能把这里的 `fe886677` 目标或旧 partial 当作新版本已完成的验收。

独立回执 key 环境可按 CLI schema 加 `receiptSecret`，仅在内存传入；`runtimeLogFile` 仅指向真实平台导出的日志，并由 CLI 筛选此次 requestId。输入不写入文件、Git、命令行参数或聊天。脚本生成的原本地任务、操作身份与 sealed checkpoint 保留在 `.cache/owned-workflow-live/live-*`；本次为 `live-CisyZG`，其内部回执记录上述 partial。

HTTP 断连、解析缺项或语义复核均保留原结果，不通过新任务覆盖 unknown。只读回原验收目录：

```powershell
@{ operation='readback'; runDirectory='<同仓库 .cache/owned-workflow-live/live-* 实际目录>' } |
  ConvertTo-Json -Compress |
  node tests/manual/agentarts/owned-workflow-live.mjs
```

白名单导出器为 `scripts/agentarts/export-owned-release-evidence.mjs`。它只读取显式材料、保留材料 SHA、去掉私人路径与非白名单字段；它不访问云端，也不自行证明上传、平台部署或模型运行。公开 metadata 必须记录上列 source/index/ARM64 digest、SWR 引用、CPU/model 版本及独立 registry 读回；平台公开读回另记实际 Runtime/version/image、`Latest` 解析和日志设置，不能以 requested version 填充 observed 事实。

只先导出已有镜像/registry证据：

```powershell
node scripts/agentarts/export-owned-release-evidence.mjs `
  --metadata '<已核对的公开 metadata.json>' `
  --image-acceptance .cache/laya-arm64-fe886677-real.jsonl `
  --output .cache/owned-laya-release-public.json
```

加入已核对的真实内部回执与平台白名单读回后重新投影：

```powershell
node scripts/agentarts/export-owned-release-evidence.mjs `
  --metadata '<已核对的公开 metadata.json>' `
  --image-acceptance .cache/laya-arm64-fe886677-real.jsonl `
  --cloud-receipt .cache/owned-workflow-live/live-CisyZG/receipt.json `
  --platform-readback '<已核对的公开 platform-readback.json>' `
  --output .cache/owned-laya-release-public.json
```

`--output` 必须是仓库内相对 `.json` 路径；输入缺项继续显示 missing/not provided，平台草稿不能投影成 published，partial 不能变成完整业务通过。原始回执仅作为内部投影输入，供公开使用的是最终白名单输出。本次原回执尚未记录 `invokeMode`，不能用新版 CLI 的默认值倒填历史事实，Evidence 保留该来源缺项。真实控制台日志读回及上述 requestId 关联应作为白名单日志材料加入，不能把配置开关代替实际日志记录。

当前原生推理/MCP 网关、原生知识库、完整 OTel Trace、效果评估，以及 28 功能的完整业务验收仍分别待补。已观测的平台运行日志保持已验证状态，开发预览不标 `productionVerified=true`。

平台能力接线沿用分工：[goo122 #353](https://github.com/zemeng5208/PersonalAgent/issues/353)；
业务消费与实际读回：[Potatos498 #354](https://github.com/zemeng5208/PersonalAgent/issues/354)。
不为该图模块复制他们的网关、注册宿主、业务连接器或数据库。

## 恢复

回滚恢复既有版本/镜像与访问方式，不删除旧云资产、不清本地数据库、不重做已确认工具。
推送、SWR 上传、AgentArts 配置、真实工具验收和完整产品发布分别陈述。
PR 需至少一位符合条件的非作者批准当前 head；本次提交不自动授权合并。
