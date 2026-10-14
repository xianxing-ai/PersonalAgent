# 自有镜像 28 图目录与公开 F20 完整流程验收

入口：`tests/manual/agentarts/owned-workflow-live.mjs`。目标 profile：`huawei_ict_agentarts`。
此 CLI 使用真实 AgentArts HTTPS / SSE 及镜像里的真实模型配置，不提供 Fake selector/model 或 Local 回退。
F20 模式验收固定公开合成 API 的全部四个节点：读取源代码/契约、真实模型生成并选择文档候选、实际 TypeScript 编译、最终来源复核和候选文件交付。
F15 保留首个公开读取与模型续图模式，不把它当作完整 F15。
两种模式都不代表 28 个真实业务全部完成；历史 117 字节说明文件的 partial 回执保持原样，不转写成 F20 完整验收。

## 前置条件

1. 使用仓库要求的 Node 24.15.x / npm 11.12.x；依赖和相关 Runtime/Client/coding-tools/agentarts 已构建。
   全新 checkout 按根构建脚本准备一次；该 CLI 不安装依赖、不构建、不部署镜像。
   F20 还使用仓库实际安装的 `typescript/bin/tsc`，不会以模型自报“通过”替代编译器。
2. 华为端确实部署带 Laya 和本版 `workflowVersion: 1.0.0` 的 ARM64 镜像，模型和宿主凭据已注入。
   原镜像只有 8 Workflow / 3 Controller 时，CLI 会拒绝目录，不能以老版本通过替代本轮证据。
3. 从受信本地凭据存储读取平台入站 Authorization 与镜像独立 WSS/宿主 Authorization。
   通过 stdin JSON 提供；CLI 不读取私人 `.env`、不要求密钥出现在命令行、不把密钥写入回执。
4. `deadline` 必须显式提供，贯穿实际网络、本地任务和模型过程。任何未知请求都不会自动重试。

## 显式本地开发实测

比赛镜像的开发验收还支持两个独立入口，复用下面的完整 F20、真实 MaaS/Laya 和原 Runtime/Policy/工具链。
这是调用者明确选择的开发表面；`live` 失败不会自动切到这些入口，也没有新增 Local 产品 profile。

| operation | 调用对象 | providers.cloud | 完整结果状态 |
| --- | --- | --- | --- |
| `live` | 真实 AgentArts HTTPS Runtime | `real_agentarts_https` | `passed_public_f20_documentation_workflow` |
| `image-live` | 已运行的本地自有镜像容器 | `real_owned_image_http` | `passed_local_image_f20_documentation_workflow` |
| `runtime-live` | 同源码的原生本地自有 Runtime 进程 | `real_owned_runtime_http` | `passed_local_runtime_f20_documentation_workflow` |

本地两种模式必须显式提供 `http://127.0.0.1:<端口>/invocations`；仅接受这个精确回环地址和显式有效端口。
它们拒绝 `localhost`、非回环主机、HTTPS、路径或查询参数替换，以及 `gatewayUrl`。平台模式仍只接受可信 HTTPS 平台路径。
鉴权值、宿主回执 key、deadline 和凭据的安全 stdin 传递方式不变；本地进程/容器的启动、模型配置由受信集成人负责。
CLI 不创建镜像、启动模型、安装依赖或配置平台。

```json
{
  "operation":"runtime-live",
  "invocationUrl":"http://127.0.0.1:18080/invocations",
  "runtimeName":"<本次原生Runtime标识>",
  "version":"<本次本地期望版本标识>",
  "inboundAuthorization":"Bearer <受信调用值>",
  "innerAuthorization":"Bearer <该Runtime宿主凭据>",
  "deadline":"<调用者设定的UTC ISO时间>",
  "workflowId":"F20",
  "runtimeLogFile":"<本次显式提供的真实stdout JSONL>"
}
```

实测容器时明确改为 `image-live` 并填写本次容器端口/标识。`version` 在本地模式只是调用方的期望标签，不选择平台版本，也不证明镜像或源码摘要。
`target.kind`/`validationSurface` 分别记录 `local_owned_image` 或 `local_owned_source_runtime`，平台部署状态为不适用。
原生 Windows 时延、ARM 容器/QEMU 时延、华为原生 ARM 时延分别记录，不互相代用。

## 调用输入

stdin 的对象形状如下；示例里的凭据占位符要在本地内存中替换，不提交包含真实凭据的文件。

```json
{
  "operation":"live",
  "gatewayUrl":"https://<平台公布的可信网关>",
  "runtimeName":"<已部署Runtime名称>",
  "version":"Latest",
  "inboundAuthorization":"Bearer <平台入站凭据>",
  "innerAuthorization":"Bearer <镜像独立宿主凭据>",
  "deadline":"<调用者设定的UTC ISO时间>",
  "workflowId":"F20",
  "invokeMode":"published"
}
```

- `runtimeId` 可替代 `runtimeName`，以平台公布的实际调用路径为准。
- `invocationUrl` 可替代 `gatewayUrl`，传完整可信 HTTPS `/runtimes/<id>/invocations` 地址；
  CLI 使用同一明确的 `version` 设置 `endpoint`，不尝试猜测或轮询其它地区/资源。
- `workflowId` 支持 F20 或 F15，它们的首节点都要求生产 workspace.read_text。缺少精确能力不会换工具。
  F20 同时公布原有 `workspace.run_allowed_command` 的唯一固定 `validate-public-api-docs` recipe。
  命令实际按原 descriptor 的 `local_write` 接受 Policy 检查和一次审批；云节点的“读取”分类不会改变宿主权限。
  该命令只处理本次公开缓存内的固定源文件和模型候选，不修改项目代码、不操作账号或发布文档。
- 可选 `receiptSecret` 是与镜像一致的独立宿主回执 key。未提供时，明确采用现有独立宿主 bearer 的
  trusted-development 派生 key；这种共享开发模式不能抵御该 bearer 持有者自行派生签名，
  正式环境应使用独立 key。来源签名核实已有结果，不授予 Policy 权限。
- 可选 `expectedSourceRevision` 记录调用方期望的 40 位源码 SHA；它仍是 expected，
  不会被 CLI 写成已经通过平台部署读回验证。
- 可选 `runtimeLogFile` 指向已有真实平台 stdout 导出 JSONL。CLI 仅筛选 `laya_ready` 和
  与此次随机 requestIds 匹配的 `laya_choice`，不输出原始日志或其它上下文。
  文件来源真实性须由平台导出证据另行证明；没有日志不会伪造 Laya 记录。
  本地两种模式可显式提供各自真实 stdout，来源仍须与本次进程/镜像独立绑定。
  新日志保留 `queueWaitMs`、完整 criterion 描述已纳入 state 的固定标记，以及白名单 tokenWindow 计数。
  必须 droppedTokens=0、未截断，encodedTokens 与实际序列/预期计数、header+state+分隔符一致且未超 encoder 窗口。
  缺字段的旧日志标为未记录，不能补造 0 token 丢失；非法计数不会作为完整上下文证据。

PowerShell：用现有安全凭据读取代码构造内存对象，然后直接管道给 Node。

```powershell
$liveInput | ConvertTo-Json -Depth 8 -Compress | node tests/manual/agentarts/owned-workflow-live.mjs
```

CLI 标准输出只有脱敏实测 JSON。`failed_or_unknown` 或语义复核的 partial 会退出 1；
不要通过重复发起新任务掩盖 unknown，先使用后面的本地读回入口。

## F20 实际验收流程

1. 在当前仓库 `.cache/owned-workflow-live/live-*` 创建独立 SQLite 和固定公开 API JSON 文件，保留继续/核实证据。
   文件含真实可核对的 TypeScript 请求/响应接口、实现、完整请求 JSON Schema、API 方法/路径/版本和旧文档。
   接口支持 `name` 与可选 `language`，旧文档遗漏 `language`，因此文档生成有明确的实际任务。
2. 真实 HTTPS 请求镜像目录，验证 28 个唯一 F01—F28 身份及所选完整模板。
3. 原 `TaskRuntime.runTask` 管理父任务；真实云端推进 F20_N01。唯一 Laya 从真实执行模型准备的合法候选中选择；
   CLI 只接受精确 `workspace.read_text`、当前版本、当前 revision 和固定公开路径。
4. 原 RuntimeApplication `submitHostToolTask` 创建稳定操作关联任务；Policy 必须先进入 waiting_approval，
   审批前实际读取次数必须是 0。CLI 的已有 Client 仅对此固定公开读取提交一次 allow_once。
   这是用户授权的验收程序，不是 Desktop 人工点击或语音确认实测。
5. 生产 ToolGateway 与实际文件读取必须只执行 1 次；核对 Policy allow、原工具执行记录、Evidence
   和独立文件读回 SHA。宿主桥仅从该真实 confirmed HostToolTaskReadback 产生来源签名。
6. 把原 sealed checkpoint 和该回执提交同一云图；F20_N01 必须为 completed，并保留原 Evidence。
   F20_N02 由真实执行模型准备 `docMarkdown` 与 `exampleArguments`，由 Laya 选择；把实际选出的值保存到固定候选文件。
   来源、实际候选和候选 Markdown 分别记录 SHA256，不用预写文档或固定示例替代模型结果。
7. 下一轮仅接受 F20_N03 的既有命令工具及唯一 recipe。命令必须先进入 waiting_approval，审批前执行次数为 0。
   用已有 Client 对该固定公开编译命令提交一次 allow_once 后，生产 ToolGateway 才运行子进程。
   子进程核对源文件和候选的实际摘要，用 JSON 字面量安全生成 TypeScript 示例，并真正编译接口、实现和示例：`tsc --noEmit`。
   多余参数、字段类型不匹配或摘要变化均失败。`noPhantomFields` 只证明示例参数与接口一致，不自动证明整个 Markdown。
8. 编译 stdout 提交完整相关源对象、实际文档候选/示例、摘要、真实编译器版本/退出码和检查事实。
   只从真实 confirmed 命令任务产生第二条来源签名；F20_N03 接纳回执后，F20_N04 才有真实来源与编译依据。
   N04 输出实际源版本 `docVersion`、`synchronized:false`、精确的已检查 `docMarkdown` 和源/检查材料引用。
   `false` 表示文档尚未外部发布，属于本次候选交付的正确状态。
9. 必须四节点都 completed、图 settled、两个原工具 Evidence 都保留、源/候选/编译材料摘要对应，才交付 `owned-api-final-doc.md`。
   CLI 真实写入并读回该公开缓存候选文件，核对摘要、来源引用和字段；它不声称写了仓库或平台文档。
   验证通过后 worker 返回汇总与原 Evidence，由 Runtime 合法进入 verifying → succeeded；云图不能直接签发本地终态。
10. 显式等待原父 worker 收尾后关闭 Application，避免 Runtime deadline 先返回而异步 worker 仍写检查点。
    重开同一 SQLite，只读回父任务、两个工具任务和 Evidence；完整 F20 的父任务必须 succeeded，新增网络/工具执行为 0。

F20 的读取和编译工具分别真实执行一次；各自的 Policy 审批、签名回执和 Evidence 独立。
任何节点弃权、缺能力、源/候选不符或网络未知都会停止自动推进，保留原 checkpoint 与已发生结果。
未完成图保留 waiting_reconciliation/failed 等真实 Runtime 状态，不能以部分工具 succeeded 代替业务完成。
目录、镜像版本、模型调用、实际 Laya 日志、工具 Evidence、平台原生知识/MCP/观测/评估也是分别验证的表面。

## 输出和恢复

脱敏 JSON 与 `receipt.json` 包括 requested version（未直接验证）、真实目录/模板版本和摘要、
HTTP 状态/类型/耗时/requestId、原 operationId/toolVersion、Policy/执行/Evidence、文件摘要、
来源回执续图、编译器事实、全部节点状态、父 Runtime 状态、实际文档/源/候选/检查材料摘要、重开读回，以及未验证/未知/不可用项。

完整 F20 仅在四节点、真实检查、文件读回与父任务持久化都通过后记录 `passed_public_f20_documentation_workflow`。
F15 的 `passed_public_read_and_graph_resume` 仍只表示首读取和模型续图；partial 不升级。

`state.json`、SQLite 和 sealed checkpoint 属于本地验收状态，不应放进 PR 或公开 Release。
没有保存 Authorization、回执 key、完整模型回复或私人上下文。
原始 `receipt.json` 仍含本机绝对 `runDirectory`，只能留作内部验收材料或白名单投影输入，不能直接公开。
使用 `scripts/agentarts/export-owned-release-evidence.mjs` 生成最终白名单 Evidence JSON，再审查该输出用于公开材料；
不公开原回执、SQLite、state/checkpoint 或原日志。导出器只投影明确材料，不自行证明真实平台部署或完整业务通过。

导出器的三个执行材料槽也必须分开传入：`--cloud-receipt`、`--image-workflow-receipt`、`--runtime-workflow-receipt`。
它们分别投影为 `cloudPublicFixture`、`imageWorkflowFixture`、`localRuntimeWorkflowFixture`；本地成功不会升级华为调用或发布状态。
即便本地完整四节点通过，最终 `productionVerified` 仍为 false。镜像构建/ARM 实际推理、SWR 发布与平台读回使用各自独立材料。

发生 HTTP 断连、SSE 不完整、期限届满或模型复核时，本次发送身份和原状态已经保存。
只读回（不发网络、不补审批、不重放工具）：

```powershell
@{ operation='readback'; runDirectory='<CLI输出的runDirectory>' } |
  ConvertTo-Json -Compress |
  node tests/manual/agentarts/owned-workflow-live.mjs
```

恢复目录必须是该仓库 `.cache/owned-workflow-live` 下的实际本次目录。
云端未知发送如何核实仍使用原平台 requestId/日志/状态路径，CLI 不擅自重发。

## 本次脚本验证

已执行 Node 语法检查及定向测试：公开 API 输入、四节点完成门槛、真实 TypeScript 正负示例、摘要篡改、
原 local_write Policy/ToolGateway/Evidence/合法父任务完成、deadline 收尾、消息/SSE/null 元数据与索引去重/冲突拒绝。
本地测试不调用云或替换 selector/model，不计为真实华为验收。
真实云端调用由集成人用已授权的可信配置运行并另行保存实测回执。
