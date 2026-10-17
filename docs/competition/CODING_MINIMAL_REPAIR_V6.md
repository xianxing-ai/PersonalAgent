# 镜像内最小修复：F15 与协作者接线

目标 profile：`huawei_ict_agentarts`。Owner：zemeng5208。此增量基于已合并 #376，复用原镜像、Runtime、Policy、ToolGateway、Evidence 与子任务分派，不重新定模型或整体架构。接口保持 provisional。

## 本次交付的分工

| 运行位置 | 实际职责 | 公开入口 |
| --- | --- | --- |
| AgentArts 自有镜像 | F15 多轮控制、失败定位材料、精确补丁分析、候选代价比较、验证有效性与停止条件 | `@personal-agent/agentarts` 的原 OwnedWorkflowEngine 与新增 coding-repair exports |
| 本机 Runtime Application | 原主任务派发 coder 子任务、逐次调用云图、原审批恢复、签名 HostBridge、阶段时间和原 Evidence | `@personal-agent/runtime/application` |
| 本机受信编码宿主 | 用户基线、独立任务目录、精确预览/应用、真实检查、包级 STALE、逐文件 CAS 与未知结果核实 | `@personal-agent/coding-tools` |
| Desktop 主进程 | 安全配置、工作区绑定、工具装配、原生精确源码导出许可；不复制模型或修复循环 | 现有 workspace-config-host / product-tools-composition |
| Renderer | 原主对话、子任务进度、审批与结果 | 原 IPC，不直接访问源码/凭据或运行命令 |

镜像生产依赖显式增加 `diff@8.0.4` 与 `typescript@5.9.3`。jsdiff 实际计算 hunk 和改动成本；TypeScript Compiler API 实际提供 JS/TS 语法及包围声明。写入仍用唯一精确文本与 SHA 校验，不使用模糊/偏移补丁应用。

## 从主对话触发

普通主模型通过原工具提案调用 `coding.repair.workflow@1.0.0`：

```json
{
  "subtasks": [{
    "subtaskId": "repair-animation",
    "role": "coder",
    "goal": "检查当前项目动画，修复实际检查发现的问题并验证。"
  }],
  "codingRepair": {
    "mode": "main",
    "allowedPaths": ["src/animation.js", "index.html"]
  }
}
```

`subtasks` 复用原单 coder 子任务结构，可带宿主目录中已公布的 `model`、原生 `reasoningEffort` 和既有步骤设置 `thinkingDepth`。省略型号时使用当前可信默认选择；显式指定时绑定原目录 revision、型号与 effort。未知型号/不支持的强度不静默换模型。

`allowedPaths` 只能限制原工作区内可修改路径，不能注入本机绝对路径、命令或凭据；范围来自原授权。`mode: isolated` 是独立影子：有独立 session 和目录，可读、生成和验证补丁，不能向主目录 publish。

入口复用 `createRuntimeSubagentDispatchTool` 与原父任务聚合。通过 `coding-repair:request:<subtaskId>` 绑定原提案，在原 child 的 `runDefaultSubagentWorker` 进入 F15，不另建调度器。结果、审批和重新启动仍归原 TaskRuntime。

## 完整工作流

```text
主对话提出 coding.repair.workflow
  → Runtime/Policy 校验原派发与工作区授权
  → 原 coder 子任务 → coding.repair.start
  → 捕获包含用户未提交内容的基线 → 独立工作区
  → 元数据导出许可 → 固定版 AgentArts F15
  → N01 真实快照 → N02 范围与诊断
  → N03 真实源码读取/精确导出 → 增量候选与代价比较
  → N04 精确预览与审查
  → N05 隔离区应用 → 真实检查 → 带输入指纹的回执
      ├─ confirmed FAILED：封存本轮 → 重读当前代码 → 下一轮 N01…N05
      ├─ unknown/stopping：核实原操作，不重发写入
      └─ 必选检查在当前代码下全部 VALID → N06
          ├─ main：相关读集仍为用户基线 → 逐文件 CAS → 写后读回
          └─ isolated：只读 shadow_artifact_verified → 不发布主目录
  → 原子任务结果/Evidence 回父任务 → 主模型汇总
```

每个新操作绑定原任务、session、轮次和当前源码指纹。相同源码、失败与补丁组合再次出现时停止无进展循环；取消、期限和预算沿用原宿主设置，不额外发明固定修复轮数。

“最小”指按诊断/包依赖圈定范围并比较实际改动文件数、增删行及 hunk，不能证明全局数学最优或语义必然正确。检查脚本、断言及来源仍须可信，不能删断言或加 skip 伪造通过。其他语言不冒充已有 AST 支持，可继续消费宿主实际公布的检查配方。

## 编码宿主接口

公开 factory：`createIsolatedCodingRepairHost(options)`；工具装配：`createIsolatedCodingRepairTools(host)`。所有操作仍是 RegisteredTool，经现有 Policy/ToolGateway 授权和执行。

| 工具 | 输入要点 | 输出/责任 |
| --- | --- | --- |
| `coding.repair.start` | mode、allowedPaths | 原 task/workspace 的 session、baselineSnapshotId、文件/包图、recipes |
| `coding.repair.list/read/snapshot` | 原 session、相对路径 | 隔离区目录、真实内容/SHA 或元数据；不是云导出授权 |
| `coding.repair.preview` | session、精确 patches | 只读预览，不将 stage 当只读 |
| `coding.repair.patch` | session、patch | 写隔离区，绑定 expectedSha256；新文件为 absence CAS |
| `coding.repair.verify` | session、recipeId | 原固定命令的真实退出码与诊断、验证输入指纹 |
| `coding.repair.check` | session、patches、recipeIds | 先应用、后检查、按实际检查后快照派生当前验证状态 |
| `coding.repair.publish` | 原 baseline/current snapshot、paths、verificationRunIds | 检查原 Runtime Evidence、主目录基线/依赖读集，逐文件 CAS 与读回 |
| `coding.repair.reconcile` | 原 session | 只读核实原写/进程/journal；不自动补做未知写入 |

F15 消费真实公布的别名：`workspace.coding_snapshot`、`workflow.host.f15_n04`、`workflow.host.f15_n05`、`workflow.host.f15_n06`；缺实现、配方、独立依赖准备或授权时返回 unavailable，不能虚构成功 descriptor。

宿主必需配置是可信 `workspaceRoot`、独立 `sessionRoot`、`workspaceId`、原精确 patch helper/恢复目录，以及真实固定配方 `createCommandTool`。可注入 `prepareWorkspace` 创建独立依赖/构建产物；不得可写共享主目录 node_modules 或 dist。`configurationRef` 绑定原工作区/工具配置，重启后配置不同不能接管旧 session。

`readVerificationEvidence` 必须从原 Runtime 已确认工具结果读取，不接受模型提供的 Evidence ID。`readCommandStopState` 必须由可信进程宿主确认；客户端取消受理不等于命令已经停止。无真实停止证据时继续 hold。

目录隔离保护正常项目任务的用户基线。现有 Windows Job Object 管进程树，不声称它是限制任意恶意项目脚本文件访问的 OS 沙箱。

## 验证回执与写回

共享 v1 数据从 `@personal-agent/contracts/coding-repair` 导出；不增加 Core wire operation 或数据库迁移。解析成功不等于可信。

每条验证包含原 session/run/recipe、包集合、inputSnapshotId、文件 SHA、可选 `packageGraphDigest`、真实 exitCode、Evidence 与诊断。缺包图摘要的旧回执仅可用于完全相同快照。

历史 Evidence 不重写；当前状态独立派生为 VALID / STALE / FAILED / UNKNOWN。包内任意源码、测试或配置变化使该包及生产下游的验证失效；根锁文件/构建配置变化或不完整依赖信息按保守影响处理。不能靠单文件 import 猜测跳过检查。

只有当前所有 required 配方 VALID 才进入交付。主目录写回逐文件检查启动时用户 SHA；验证涉及的包及生产依赖读集也需一致。未进入本次验证读集的无关包，其原有 dirty 或新编辑不因“全仓不干净”被拒绝；全量配方实际覆盖的包变化仍需重新核实。冲突保留用户新内容。

多文件交付不是断电原子事务。journal 持久化已写内容、预期版本与原操作身份；中断后先读回和确认进程，再区分 published / not_started / conflict / unknown，不能盲重试或隐去部分效果。

## AgentArts 与传输接线

使用 `createAgentArtsRuntimeApplication` 原组合；需要自行组合时，从 `@personal-agent/runtime/application` 使用 `createRuntimeOwnedWorkflowImageAdapter`、`RuntimeCodingRepairOptions` 及上述公开宿主工具。不要深导入私有源码或另写 Agent 循环。

- WSS 与 HTTPS 均绑定同一个 gateway/runtime/精确 deploymentVersion；HTTP 使用 `?endpoint=<精确版本>`。WSS 优先，HTTPS 只在已授权且 invoke 未发送的连接失败时备用；accepted 后 unknown 不换通道重发。
- 传输鉴权与 HostBridge 签名是不同用途。宿主签名优先使用现有 `deriveOwnedWorkflowKeys` 的 receiptSecret；部署若显式覆盖签名 secret，须由安全宿主提供 `readOwnedWorkflowReceiptSecret`，不能猜测、打印或放 Renderer。
- Desktop 的 `fetchHandlesHostAuthorization: true` 只表示原受信 fetch 工厂负责 HTTP 宿主凭据注入；调用方不能注入或替换它的鉴权头。WSS 使用原安全凭据端口。
- 沿用原 `workflowVersion: 1.0.0 / operation: advance / workflowId: F15` 载荷。checkpoint、原 input、resolvedValues 与签名 receipts 继续原版本协议，不手写假的工具回执。
- owned 图响应解析由可信宿主显式选择现有图封装的 1.2MB 字节/字符上限；普通 coordination 入口仍默认1MiB字节与16k文本。WSS 完整事件字节预算继续原值。结果过大明确 unavailable 并保留可续检查点，不能静默提高协议上限或丢失原 Evidence。
- 当普通结果放不进现有 WSS 64,000 字节预算时，先尝试 `deflate:` 编码的签名 checkpoint，再沿用原可信工具结果引用；节点状态、候选、源码指纹与 Evidence 保持完整。HMAC 同时绑定编码标记和内容，先验签后有界解压；解压上限保持原 plain checkpoint 的可接受容量。新镜像接受旧 plain checkpoint；旧镜像不能读取新压缩 checkpoint，任务必须继续绑定同一个精确发布版本，不把新 checkpoint 交给旧镜像。

源码正文、路径/SHA 元数据和诊断都可能是用户数据。`authorizeMetadata` 检查当前原 `cloudExportAllowed`；`projectSource` 复用原生精确许可，绑定真实 coding.repair.read 的 task/proposal/run/path/SHA/字节数及配置。缺端口不是同意，已有相同有效许可不重复弹窗。不得冒充 workspace.read_text 绕过许可。

## 协作者继续方式

- goo122：消费公开 Runtime/coding-tools/contracts 入口及原任务状态，按接口注入可信依赖准备、进程停止与 Evidence 读回。公共协议仍以接口目录为准。
- Potatos498：消费真实 recipe/诊断与验证回执，把业务检查接到既有固定命令端口；不要删改断言制造成功，不替另外两人集中代验。
- zemeng5208：镜像 F15、Desktop 原组合、AgentArts 精确版本发布及真实云图/模型回执。

开发使用根 `.node-version` 与 npm 约束。必要构建/检查：

```powershell
npm ci
npm run check
npm run start:desktop
```

生产镜像继续由 `apps/agentarts-runtime/scripts/image-context.mjs` 新建 allowlist context，经锁文件递归带入生产依赖，华为 npm 镜像保留原 integrity；不把仓库根、用户配置、密钥或 Laya 权重打入镜像。端口8080，`GET /ping`，`POST /invocations` 及原 WSS。

## 本轮验收登记

源码实现、Fake 控制流、真实本机文件/命令、整图、镜像构建、SWR 上传、AgentArts 部署和真实模型分别记录，不能相互替代。本节发布前由实际回执补齐；此时不声明新镜像已在线，也不把 F15 通过推广为其余27条业务已验。

2026-10-17 的 `arm64-v6-b228afb6-r1` 已实际部署并通过固定版本 WSS 输入边界回归，但首次真实模型 F15 停于 N04：72,224 字节事件超过原64,000字节预算，N01–N03完成、没有源码写回。只压缩签名 checkpoint 的同状态离线尺寸核算为47,420字节，不作为修复后的云端通过记录。此处传输补丁须随新精确镜像版本重新验收；旧失败回执保留。

- 本机宿主真实文件/Node/Windows锁内写入：12/12；Evidence 查询为显式 Fake。配置绑定、取消实际PID停止、包级失效、相关依赖读集冲突、无关编辑兼容、partial重启核实均有回归。
- 原镜像引擎的新旧定向回归：93/93；模型及外部工具为显式 Fake，覆盖隔离影子与多配方补丁后失效重验。
- 公开响应解析兼容67/67；Desktop固定版本/精确许可14/14；未开麦或播放音频。
- 正常主Agent→原dispatch→生产F15 driver→HostBridge 的本机完整图四项已通过：主图8276.8ms、isolated影子8469ms、原N05审批与SQLite重启8373ms、并发CAS冲突7693ms。主/影子均完成N01–N06及真实检查先失败后修复；原用户注释/无关dirty保留，影子主目录0发布。外部模型/图候选是显式Fake；文件、Node命令、Runtime/Policy/SQLite/Evidence真实，不能冒充真实云模型耗时。
- 完整 `npm run check` 已通过：3933项，3912通过、21跳过、0失败/取消，371188ms。[本轮Evidence](evidence/coding-minimal-repair-20261017/README.md)保留分项及失败修正；新镜像、SWR、AgentArts精确版本与真实云调用另按本工作包PR的实际回执登记，不能用本机通过替代。
