# 镜像内 Laya 与 28 工作流：发布和开发调用

目标 Profile：`huawei_ict_agentarts`。对应设计 PR #349、设计页 PR #352；本文件随实现 PR 交付。

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

## 发布到现有 AgentArts Runtime

1. 将新版本镜像推送/上传到同区域 SWR 的原私有组织和镜像仓库，保留旧 tag。
2. 在现有 Runtime 编辑镜像，保存新版本；保持既有委托、入站 API Key、网关、规格、端口 8080 和出网配置。
3. 环境配置保留既有国内 MaaS 和四角色设置。镜像提供 `PA_AGENT_LAYA_MODE=embedded`、离线资产路径；
   可由原运行环境设置 `PA_LAYA_STARTUP_TIMEOUT_MS`。内部 Python Bearer 在进程内随机生成，不需要共享。
4. 图 checkpoint 与宿主回执使用 `PA_AGENT_WORKFLOW_CHECKPOINT_KEY`、`PA_WORKFLOW_RECEIPT_SECRET`。
   正式生产应使用受信宿主独立秘密；受信协作者的开发环境可从既有 WSS secret 做用途分离的 HKDF，
   但持有该共享 secret 的开发者也能签回执，不能据此声称防恶意调用者伪造。
5. 开启原生日志，运行 JSON stdout 进入 AgentArts / LTS。日志仅含运行关联、Laya ready/choice、角色耗时，
   不含源正文、模型提示或密钥。平台日志开启与真正收到本版日志分别记录。
6. 读回 Runtime/version/image/访问方式；针对新版本实际调用。配置成功和 HTTP 200 都不能替代工具/Evidence 验收。

现有目标：区域 `cn-southwest-2`，Runtime `pa-owned-bindings-0dae0ff5-api`，
ID `9a65747e-05f0-475c-a2dc-f24dd3ed87ae`。网关：
`https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com`。
`Latest` 是可移动访问方式；开发验收必须同时记录平台读回的实际版本和镜像，而不是只记录请求中的 version。

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

当前已通过的本地检查：根 `npm run check` 为 3096 项（3073 通过、23 跳过、0 失败）；
随后恢复修复的定向图 15 项和真实 SQLite/Policy/ToolGateway 桥 1 项均通过。
这些本地测试中的模型/选择器是明确替身，不能冒充 Laya/MaaS/AgentArts 实测。
实际发布与调用结果在同目录的发布 Evidence 记录中补充，以实际结果为准。

真实镜像离线验收：`tests/manual/agentarts/owned-laya-image.mjs`，必须在 Linux ARM64 镜像内
以 `--network none` 挂载执行；一个真实 Laya 实例，无 MaaS、工具或账号调用。
本机 x86 经 QEMU 的时间不能推断原生华为 ARM64 延迟。
第一次实际选择返回 408，诊断确认旧适配把显式 deadline 截为 30 秒；已修正为原剩余期限，
无期限旧兼容入口仍默认 30 秒。相应 Python 定向测试 3 项通过；未放宽概率、候选和身份校验。

真实云端公开读取与图续跑：参照 [验收 CLI 说明](../../tests/manual/agentarts/OWNED-WORKFLOW-LIVE.md)，
从安全存储在内存构造配置，通过 stdin 调用 `owned-workflow-live.mjs`。
该 CLI 无 Fake 模型，不重试未知云请求；等待原 Policy 后只授权精确公开文件读取，
保存实际原工具/Evidence/签名续图与 SQLite 重开读回。纯 SSE 解析测试 4 项通过，不计云验收。

平台能力接线沿用分工：[goo122 #353](https://github.com/zemeng5208/PersonalAgent/issues/353)；
业务消费与实际读回：[Potatos498 #354](https://github.com/zemeng5208/PersonalAgent/issues/354)。
不为该图模块复制他们的网关、注册宿主、业务连接器或数据库。

## 恢复

回滚恢复既有版本/镜像与访问方式，不删除旧云资产、不清本地数据库、不重做已确认工具。
推送、SWR 上传、AgentArts 配置、真实工具验收和完整产品发布分别陈述。
PR 需至少一位符合条件的非作者批准当前 head；本次提交不自动授权合并。
