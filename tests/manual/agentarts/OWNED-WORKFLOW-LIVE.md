# 自有镜像 28 图目录与公开读取闭环验收

入口：`tests/manual/agentarts/owned-workflow-live.mjs`。目标 profile：`huawei_ict_agentarts`。
此 CLI 使用真实 AgentArts HTTPS / SSE 及镜像里的真实模型配置，不提供 Fake selector/model 或 Local 回退。
它只验收固定公开合成文件的一次生产 `workspace.read_text` 和来源回执续图，不代表 28 个真实业务全部完成。

## 前置条件

1. 使用仓库要求的 Node 24.15.x / npm 11.12.x；依赖和相关 Runtime/Client/coding-tools/agentarts 已构建。
   全新 checkout 按根构建脚本准备一次；该 CLI 不安装依赖、不构建、不部署镜像。
2. 华为端确实部署带 Laya 和本版 `workflowVersion: 1.0.0` 的 ARM64 镜像，模型和宿主凭据已注入。
   原镜像只有 8 Workflow / 3 Controller 时，CLI 会拒绝目录，不能以老版本通过替代本轮证据。
3. 从受信本地凭据存储读取平台入站 Authorization 与镜像独立 WSS/宿主 Authorization。
   通过 stdin JSON 提供；CLI 不读取私人 `.env`、不要求密钥出现在命令行、不把密钥写入回执。
4. `deadline` 必须显式提供，贯穿实际网络、本地任务和模型过程。任何未知请求都不会自动重试。

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
- 可选 `receiptSecret` 是与镜像一致的独立宿主回执 key。未提供时，明确采用现有独立宿主 bearer 的
  trusted-development 派生 key；这种共享开发模式不能抵御该 bearer 持有者自行派生签名，
  正式环境应使用独立 key。来源签名核实已有结果，不授予 Policy 权限。
- 可选 `expectedSourceRevision` 记录调用方期望的 40 位源码 SHA；它仍是 expected，
  不会被 CLI 写成已经通过平台部署读回验证。
- 可选 `runtimeLogFile` 指向已有真实平台 stdout 导出 JSONL。CLI 仅筛选 `laya_ready` 和
  与此次随机 requestIds 匹配的 `laya_choice`，不输出原始日志或其它上下文。
  文件来源真实性须由平台导出证据另行证明；没有日志不会伪造 Laya 记录。

PowerShell：用现有安全凭据读取代码构造内存对象，然后直接管道给 Node。

```powershell
$liveInput | ConvertTo-Json -Depth 8 -Compress | node tests/manual/agentarts/owned-workflow-live.mjs
```

CLI 标准输出只有脱敏实测 JSON。`failed_or_unknown` 或语义复核的 partial 会退出 1；
不要通过重复发起新任务掩盖 unknown，先使用后面的本地读回入口。

## 实际验收流程

1. 在当前仓库 `.cache/owned-workflow-live/live-*` 创建独立 SQLite 和固定公开文件，保留继续/核实证据。
2. 真实 HTTPS 请求镜像目录，验证 28 个唯一 F01—F28 身份及所选完整模板。
3. 真实云端推进 F20/F15 首节点。唯一 Laya 从真实执行模型准备的合法候选中选择；
   CLI 只接受精确 `workspace.read_text`、当前版本、当前 revision 和固定公开路径。
4. 原 RuntimeApplication `submitHostToolTask` 创建稳定操作关联任务；Policy 必须先进入 waiting_approval，
   审批前实际读取次数必须是 0。CLI 的已有 Client 仅对此固定公开读取提交一次 allow_once。
   这是用户授权的验收程序，不是 Desktop 人工点击或语音确认实测。
5. 生产 ToolGateway 与实际文件读取必须只执行 1 次；核对 Policy allow、原工具执行记录、Evidence
   和独立文件读回 SHA。宿主桥仅从该真实 confirmed HostToolTaskReadback 产生来源签名。
6. 把原 sealed checkpoint 和该回执提交同一云图；原工具节点必须为 completed，并保留原 Evidence。
   检查实际后续模型节点是否完成；弃权/unknown 会明确记录 partial，不伪造全图结束。
7. 关闭后用 TaskRuntime 重新打开同一 SQLite，只读回原任务、执行记录和 Evidence，新增网络/工具执行均为 0。

原云端 graph state 不写成本地 TaskRuntime 终态；单个真实工具宿主任务的 succeeded 与整个业务任务完成分开记录。
目录、镜像版本、模型调用、实际 Laya 日志、工具 Evidence、平台原生知识/MCP/观测/评估也是分别验证的表面。

## 输出和恢复

脱敏 JSON 与 `receipt.json` 包括 requested version（未直接验证）、真实目录/模板版本和摘要、
HTTP 状态/类型/耗时/requestId、原 operationId/toolVersion、Policy/执行/Evidence、文件摘要、
来源回执续图、重开读回，以及未验证/未知/不可用项。

`state.json`、SQLite 和 sealed checkpoint 属于本地验收状态，不应放进 PR 或公开 Release。
没有保存 Authorization、回执 key、完整模型回复或私人上下文。
原始 `receipt.json` 仍含本机绝对 `runDirectory`，只能留作内部验收材料或白名单投影输入，不能直接公开。
使用 `scripts/agentarts/export-owned-release-evidence.mjs` 生成最终白名单 Evidence JSON，再审查该输出用于公开材料；
不公开原回执、SQLite、state/checkpoint 或原日志。导出器只投影明确材料，不自行证明真实平台部署或完整业务通过。

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

已执行 Node 语法检查及纯消息/SSE 解析测试 **4/4 通过**，包含原消费端支持的 null 元数据和索引去重/冲突拒绝。
解析用例不产生网络调用、不替换 selector/model，不计为真实华为验收。
真实云端调用由集成人用已授权的可信配置运行并另行保存实测回执。
