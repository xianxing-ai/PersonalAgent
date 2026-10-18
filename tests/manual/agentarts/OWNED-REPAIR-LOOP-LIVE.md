# 自有镜像的固定合成修复闭环验收

`owned-repair-loop-live.mjs` 仅验收当前自有镜像的 Competition Profile。导入文件不读凭据、不联网、不打开数据库。
云端采用 WSS `/runtimes/<runtimeName>/invocations/ws`，关闭 HTTPS 回退。运行前由操作者确认该 Runtime 的实际镜像版本；脚本本身不读取平台 trace 或证明部署版本。

## 复用的生产入口

1. `createAgentArtsRuntimeApplication`：生产 WSS 客户端、Runtime、SQLite、Policy、ToolGateway 与 Evidence。
2. `createSyntheticMeetingToolset`：既有固定公开合成 `fixtures/mvp-meeting/meeting-update.json`，通过生产 `workspace.read_text` 读取；不能指定真实项目或用户文件。
3. `createSyntheticRepairHost`：既有 SQLite Memory/FactChangeFeed 投影、影响分析、来源 Evidence 绑定与严格合成修复上下文。内容全为虚构；沿用宿主内部的 `private` 分类不代表使用私人数据。
4. `readRepairCandidate` / `host.readBinding` / `submitLocalRepair`：云端候选严格校验后创建独立本地修复任务。
5. `authorization.respond`：分别为读取、修复提供一次性允许，执行 `cognition.commit_repair` 的原有 Policy/CAS 路径。

脚本明确把批准者记录为 `authorized-synthetic-acceptance-harness`，不声称用户在 Desktop 手工点击。只有明确传入 `--approve-synthetic-fixture` 才执行这两个合成场景批准。

## 实际验收步骤

- 在项目忽略的 `.cache/owned-repair-loop-live/case-*` 创建全新 Runtime/Memory 数据库；保留数据供失败诊断和复核，不覆盖旧库。
- 初始图版本 5。读取任务先进入 `waiting_approval`；断言工具未开始、图未变，再批准。
- 确认文件读取产生 1 次执行、1 条 Evidence；通过既有 FactChangeFeed 投影到图版本 6。仅三个相关节点为 RECHECK。
- AgentArts 返回 `repair_candidate` v1.0；现有合成宿主逐项核对目标、摘要、依赖版本，失败即停止。
- 独立修复任务先进入 `waiting_approval`；断言图未变、修复未执行，再批准。
- 原有生产工具完成一次原子批量 CAS，三个节点各追加一个版本，图版本 6→9；核对 1 次 confirmed 修复执行、1 条 Evidence、无关计划完全不变和重新分析结果 KEEP。
- 关闭并重开同一 SQLite 库，只读核对任务、执行、Evidence、完整图。重复提交同一修复身份必须复用已成功任务，不执行第二次修复，也不得重发云调用。

KEEP 只说明依赖/有效期检查通过。固定摘要由合成宿主约束；成功不证明模型在开放任务中生成了正确修复、不证明完整无人值守产品或全部 MOD 完成。

## 执行入口

先按仓库固定 Node 24.15.x 完成生产构建。使用 PowerShell 7，由本机受信 helper 解密现有凭据后经**标准输入**传入以下 JSON 的四个字段：

```json
{"gatewayUrl":"https://<gateway>.cn-southwest-2.huaweicloud-agentarts.com","runtimeName":"<owned-runtime>","inboundAuthorization":"Bearer <runtime-key>","wssToken":"<independent-wss-token>"}
```

调用参数：

```text
node tests/manual/agentarts/owned-repair-loop-live.mjs --live --approve-synthetic-fixture --deadline <UTC-deadline>
```

密钥不写命令参数、仓库文件或报告；脚本不自行读取环境变量、DPAPI、浏览器或 MaaS Key。所有主动调用共用给定 deadline；无自动重试和 Local 回退。每次执行创建一个新合成验收；结果未知先检查保留的库和收据，不盲目重跑。

失败收据保留阶段和固定错误码，不输出模型正文、原始异常、凭据、候选全文或摘要散列。若 `hostCleanupVerified` 为 false，不能宣称宿主已正常释放。成功输出仍需与本次实际部署读回及云端模型调用证据合并判定。

初次读取审批前失败也会保留 `sourceState` / `sourceErrorCode`，并读回执行、Evidence 和图版本。`cloudDiagnostics` 只接收生产适配器诊断中的白名单 `stage`、`code`、`schemaCategory`、标准 HTTP 状态及适配器本地产生的请求 UUID；缺失字段不补造，未知值和原始 body/URL/error 均丢弃。它不是平台 trace 或请求已到达云端的证明。

## 离线验证

```text
node --test tests/manual/agentarts/owned-repair-loop-live.test.mjs
```

测试仅显式 Fake 云协调，沿用生产本地存储/授权/工具/CAS；收据固定 `verification: mock`。它证明 runner 的本地接线，不构成真实 WSS、模型或华为云验收。真实执行须由已获授权的父任务完成。
