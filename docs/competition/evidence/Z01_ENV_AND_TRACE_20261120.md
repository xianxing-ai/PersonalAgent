# Z-01 环境变量改齐 + Trace 对上 · 2026-11-20

Profile：`huawei_ict_agentarts`。Runtime：`pa-z01-model-accept-20261119`（`3a2c906a-477a-42f5-9837-fc7ee10253c4`）。

## 1. `PA_AGENT_DEPLOYMENT_VERSION` 改齐

| 项 | 值 |
| --- | --- |
| 方法 | 控制台会话 `PUT /v1/core/runtimes/{runtime_id}`（请求头 `cftk` = `console_cftk`） |
| 旧 Latest | `image28-f20-20261120`，环境变量仍为 `image28-live-20261120` |
| 新 Latest | `image28-f20-env-1120`（版本名 ≤24 字符） |
| 新环境变量 | `PA_AGENT_DEPLOYMENT_VERSION=image28-f20-20261120` |
| 容器镜像 | 仍为 `…/personal-agent-owned:image28-receipts-20261120` |
| 状态 | `READY` |

说明：`UpdateCoreRuntime` 每次会生成新版本并切为 Latest；旧版本名 `image28-f20-envfix-20261120` 超长（27）被平台拒绝。

## 2. Trace / Logs 读回

绑定回执 11 个 `requestId` 全部在平台 Logs API 命中：

`GET /v1/ops/observation/agent-run/pa-z01-model-accept-20261119/log`

| requestId | 平台 traceId | logHits | 事件 |
| --- | --- | --- | --- |
| `89df559e-…` | `68b6f07a-…` | 4 | `stage_timing`, `owned_role` |
| `3113a9de-…` | `44b83632-…` | 2 | `stage_timing` |
| `181696c1-…` | `974c6f13-…` | 4 | `stage_timing`, `owned_role` |
| `6dba9751-…` | `97e637f1-…` | 4 | `stage_timing`, `owned_role` |
| `245ffdba-…` | `09b7ccdd-…` | 4 | `stage_timing`, `owned_role` |
| `d2c2f69b-…` | `2d02b764-…` | 4 | `stage_timing`, `owned_role` |
| `ebbd2be0-…` | `36b820c8-…` | 4 | `stage_timing`, `owned_role` |
| `1703b3de-…` | `7e37fddf-…` | 8 | `stage_timing`, `owned_role` |
| `e919350f-…` | `a8714b41-…` | 4 | `stage_timing`, `owned_role` |
| `ffe45635-…` | `591084ce-…` | 8 | `stage_timing`, `owned_role` |
| `2ed400e0-…` | `6d578f29-…` | 8 | `stage_timing`, `owned_role` |

完整对照见 `.cache/z01-live-20261120/z01-triple-and-bindings-20261120.json` → `platformTraceReadback`。

### ShowOpsTrace 边界

`GET /v1/ops/observation/traces/{traceId}` 对上述 runtime 本地 `traceId` 返回 HTTP 200 且 `total=0`。`POST /v1/ops/observation/traces` 列表仅见无关 studio LLM 错误 span，未收录本轮 owned-binding 调用链。结论：**平台 Logs 已按 requestId 对上**；APM ShowOpsTrace span 库对本轮 runtime trace 为空，不冒充 span 级 verified。

## 机器回执

- `.cache/z01-live-20261120/z01-triple-and-bindings-20261120.json`（`envFix` + `platformTraceReadback`）
- 绑定源回执：`.cache/z01-live-20261120/bindings-round4/receipt-e44ffe98-e369-425c-b88c-a015d87eb413.json`
