# 自有镜像 11 个绑定的真实调用验收

`owned-binding-live.mjs` 只在显式 `--live` 启动时访问服务。目标 profile 为
`huawei_ict_agentarts`，接入已部署的自有 ARM64 Runtime；不使用 Studio 历史工作流。
本程序独立于模块完成判定；逐项调用通过不证明真实工具执行、平台评估、费用、Wiki、完整自主修复或所有 MOD 已完成。

## 使用前提与命令

使用仓库声明的 Node 24.15.x、PowerShell 7；先完成现有依赖安装和
`npm run build:owned-agent`。不要重复构建已验证且未变的依赖。

先查看选择结果：不会读凭据、创建网络连接或调用模型。

```powershell
node tests/manual/agentarts/owned-binding-live.mjs --plan --group all
node tests/manual/agentarts/owned-binding-live.mjs --plan --binding 998031d7-ec28-40ed-83e6-96667f22ff51
```

真实调用的 CLI（UTC 截止时间由调用方按本次授权填写）：

```text
node tests/manual/agentarts/owned-binding-live.mjs --live --group all --deadline <UTC-ISO-8601> --out .cache/owned-binding-live/current
```

只运行 World（无前置阶段），用相同 stdin 方式提供凭据：

```text
node tests/manual/agentarts/owned-binding-live.mjs --live --binding 7d06153e-6262-4679-86ae-1914b38e11f3 --deadline <UTC-ISO-8601> --out .cache/owned-binding-live/world
```

必须通过受信宿主的管道向该进程 **stdin** 写入一个 UTF-8 JSON，写完关闭 stdin：

```json
{
  "gatewayUrl": "https://<gateway>.cn-southwest-2.huaweicloud-agentarts.com",
  "runtimeName": "<已部署的自有镜像Runtime名称>",
  "inboundAuthorization": "Bearer <平台入站API凭据>",
  "wssToken": "<独立WSS令牌，不含Bearer前缀>"
}
```

这四个字段必须齐全。`gatewayUrl` 为 HTTPS 华为 AgentArts 网关的 origin；不能含路径、查询参数、
重定向地址或用户名密码。推荐受信宿主在内存中解密现有 DPAPI 文件后写入子进程 stdin；不要把
凭据放入命令参数、命令历史、日志、环境转储、Git 或聊天，也不要把示例占位符作为真实配置。
stdin 不需要模型密钥：真实模型由云端镜像的现有配置调用。

`--group` 支持 `all`、`ordinary`、`repair`、`controllers`。也可以重复使用 `--binding <精确ID>`；
`--binding` 与 `--group` 互斥。默认选择全部 11 个入口。
选择 Review 会自动加入同一运行中的 World 和对应 Plan，选择 Plan 会加入 World。
`--plan` 输出中的 `prerequisite: true` 标出额外必需调用；不会复用历史报告或跳过依赖校验。
同一次运行不会重复调用共享 World，整组并行度固定为 1。每个请求沿用同一绝对 deadline。
PowerShell `DateTime.UtcNow.ToString('o')` 生成的七位小数时间会在输入处统一为 JavaScript
UTC 毫秒格式，例如 `.0528240Z` 转成 `.052Z`，与公共 Coordination/WSS 契约一致。
该转换不会分配新期限；回执和全部请求使用同一个规范化后的截止时间。

## 场景与依赖

| 分组 | case | 场景 | 依赖 |
| --- | --- | --- | --- |
| ordinary | fast | 普通公开问答，无工具目录，期待 text | 无 |
| ordinary | deterministic | 单一“语法检查”意图，未公布工具，期待 RECHECK text | 无 |
| repair | world | 公开合成时间从 14 点改为 16 点的来源投影，期待合法 REVISE 报告 | 无 |
| repair | plan | 最小修复报告 | 本次 world |
| repair | plan_1 | 独立历史 Plan 绑定 | 本次 world |
| repair | review | 审查完整报告，期待一个最小修复候选 | 本次 world + plan |
| repair | review_1 | 独立历史 Review 绑定 | 本次 world + plan_1 |
| repair | router | 镜像内部修复流水线 | 镜像内部 World/Plan/Review |
| controllers | controller_mvp | 新建 owned Controller 的普通问答 | 镜像内部 fast |
| controllers | controller_repair | 仅修复 Controller，最小修复候选 | 镜像内部 World/Plan/Review |
| controllers | controller_router | 普通/修复 Controller 的修复路径 | 镜像内部 World/Plan/Review |

固定发现入口 `GET /runtimes/<runtime>/invocations/bindings?endpoint=Latest` 必须返回精确
8 Workflow / 3 Controller 的 ID/type/name/origin/roles/requirements。目录缺失、重复、漂移
会停止所有调用，防止把其他 Runtime 的结果记入本验收。

模型调用统一使用公开 `AgentArtsCloudAgentPort` 的 WSS text 模式，路径为
`/runtimes/<runtime>/invocations/ws`。text 只承载绑定响应信封，再显式区分 `role_report`
与 `application_result`；不把角色报告送入旧可执行 CoordinationResult 流程。
HTTP GET 仅发现目录，应用调用没有 HTTPS 备用或自动重试。

World/Plan/Review 输出复用公开 `OwnedAgentOrchestrator` 的正式校验：把已收到的 JSON 在内存中
通过显式 FakeModelProvider 回放一次，核对版本、来源、范围和候选一致性。此步骤没有网络、
不生成替代报告、不算真实模型调用或执行证据，产生的 Fake usage/receipt 全部丢弃。
传给下游的报告始终来自当前真实 WSS 上游返回值。

已知合成场景期待 REVISE：合法 KEEP/RECHECK 会保留 disposition 并记录场景失败；依赖它的
后续项为 skipped。其他独立入口继续，各自最多调用一次。发送后断线记录 RESULT_UNKNOWN，
不重发、不转 HTTPS，也不自动重跑整组。是否进行新的付费调用由操作者结合回执决定。

## 回执与证据边界

每次运行创建唯一 `receipt-<uuid>.json`，每项结束时原子替换该文件。回执包含固定 case/id/type、
通过/失败/跳过、kind/role、耗时、允许列表内错误码、报告 disposition、应用结果 kind。
每项同时保存公开端口回调产生的 `dispatch`、`accepted`、`terminal` 布尔；失败诊断仅保留
白名单 `stage/schemaCategory/code`、100–599 的整数 `httpStatus` 及严格 UUID 请求 ID。
`terminal` 表示已收到传输终态，不代表模型结果通过应用校验；回调缺失时不推断已经发帧。
同会话的下一项重新开始记录，不能继承上一项的失败诊断或请求 ID。
不保存原始报告、模型正文、错误 message/stack/response body、凭据或凭据摘要。
正常落盘时终端输出相同的脱敏回执。写入或替换失败会立即停止后续绑定，不重试写入、
重命名、发现请求或模型调用；stdout 仍输出内存中的终态回执，并将整体 `status` 置为
`failed`、退出码置为 1。已经收到的逐项结果保留，不能因落盘失败重发 invoke。

落盘诊断只包含 `persistence: {status: "failed", stage: "write" | "rename", errno: ...}`。
`errno` 仅取固定允许列表中的文件系统代码（例如 EPERM、EBUSY、ENOSPC），其它值为
`UNKNOWN`；不含错误 message、stack、路径、正文或凭据。目录创建失败归入 `write`，
发生在验收开始前时通过 stderr 报告 `PERSISTENCE_FAILED`，不会启动真实调用。
失败后保留已有 `.json` 和 `.json.tmp`，不清理、覆盖或把临时文件称为已保存的正式回执。
正式 JSON 可能仍为 `running`，tmp 可能完整或仅部分写入；此时以 stdout 的明确落盘失败
和已发生的逐项观察定位问题，独立核对文件后再人工恢复。EPERM/EBUSY 本身不能证明
本次就是临时文件锁；本程序不自动重新提交临时文件或重跑验收。

退出码 0 表示所选项全通过且最终落盘成功；1 表示验收失败、依赖跳过或落盘失败。

程序不注册工具、不签发 Policy 授权、不写业务数据、不提交修复候选。候选仅解析及核对，
永远不是实际执行授权或本地 Evidence。真实 HTTP 备用整链、模型用量和平台 trace
也不由这份回执证明。内部校验为 Fake 并不改变云调用的真实性，必须分别描述。

## 离线验证

```powershell
node --test --test-isolation=none tests/manual/agentarts/owned-binding-live.test.mjs
```

测试复用现有 FakeCloudAgentPort、SyntheticWebSocket 以及实际 owned 编排核心，覆盖精确发现、
两条报告链、非法/越界/旧版报告、Review 候选替换、依赖跳过、全局截止时间/取消、错误脱敏、
WSS 会话复用和发送后未知结果不重试。注入文件系统失败并实际读回测试目录，验证最终
rename 失败仍输出终态、部分 tmp 保留、首/中途 write 失败停止后续调用及错误脱敏。
这些是合成文件系统错误，不证明真实故障由文件锁引起。无需凭据，无外网及付费模型调用。
`--test-isolation=none` 避免受限 Windows 下测试 runner 创建子进程被 EPERM 拒绝。
