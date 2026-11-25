# Z-01 剩余两项 · 2026-11-20 现场回执

Profile：`huawei_ict_agentarts`。Runtime：`pa-z01-model-accept-20261119`。

用户已确认通过：令牌轮换、F20、旧 ARM64（`image28-receipts-20261120`）。本回执覆盖剩余两项。

## 1. 11 绑定 + 业务结果

| 项 | 结果 |
| --- | --- |
| 状态 | **passed** |
| 发现 | 8 workflows + 3 controllers |
| 通过数 | **11 / 11** |
| 传输 | 真实华为 WSS |
| 回执 | `.cache/z01-live-20261120/bindings-round4/receipt-e44ffe98-e369-425c-b88c-a015d87eb413.json` |

逐项均有 `requestId`，且 `dispatch/accepted/terminal=true`。旧失败项 `plan` / `plan_1` / `review` / `review_1` / `router` / `controller_repair` / `controller_router` 本轮全部通过。

脚本修正：云端目录多了 `workflowBindings` / `controls` 等顶层字段，验收脚本原先用 exact top-level 误报 `CATALOG_MISMATCH`；已改为只校验 11 条 owned binding 内容（`z01-agentarts-bindings` 工作树 `owned-binding-live.mjs`）。

### Trace

本轮拿到全部 `requestId`。后续已用控制台会话调用平台 Logs API，**11/11 requestId 命中**并映射到平台 `traceId`（见 `Z01_ENV_AND_TRACE_20261120.md`）。`ShowOpsTrace` 对本轮 runtime 本地 `traceId` 返回空 span；未使用 observation AK/SK。

完整列表见 `.cache/z01-live-20261120/z01-triple-and-bindings-20261120.json`。

## 2. 固定版 / 源码 / ARM64 三方一致

| 维度 | 值 | 对齐 |
| --- | --- | --- |
| 已确认交付源码 | `ac9a2552e6ae75b180b23197fc2394acd1a7c5a9` | 基线 |
| 已确认 ARM64 摘要 | `sha256:9e235024e658d8e554cdaf3f4526eb59c890ed02db7565d69d6037a4171a6fe0` | 与 remote-inspect 一致 |
| 已确认 SWR 标签 | `…/personal-agent-owned:image28-receipts-20261120` | 基线 |
| 平台 Latest 容器镜像 | 同上 `image28-receipts-20261120` | **一致** |
| 平台 Latest 版本名 | `image28-f20-env-1120`（由 `image28-f20-20261120` 更新生成） | 名称 ≠ 镜像标签（镜像本体已对齐） |
| 桌面固定部署版本 | `image28-f20-20261120` | 与环境变量对齐 |
| 平台环境变量 `PA_AGENT_DEPLOYMENT_VERSION` | `image28-f20-20261120` | **已改齐**（见 `Z01_ENV_AND_TRACE_20261120.md`） |

结论：**镜像三方（源码 SHA + ARM64 摘要 + Latest 容器镜像）已对齐**；`PA_AGENT_DEPLOYMENT_VERSION` 已通过控制台 `UpdateCoreRuntime` 改为 `image28-f20-20261120`。11 个 requestId 已在平台 Logs API 对上；ShowOpsTrace span 库对本轮 runtime trace 仍为空（详见 env/trace 回执）。

## 未做 / 不宣称

- remediation 未提交本地修复镜像的 Push / 切 Latest（仍 sourceDirty）
- APM ShowOpsTrace span 级读回对本轮 owned-binding traceId 仍为空（Logs 级已对上）
