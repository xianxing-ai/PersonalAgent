# Z 系列续接 · Codex（前端已交 Gemini）

2026-11-20。前端专用交接：[FRONTEND_DESIGN_HANDOFF_FOR_GEMINI_20261120.md](file:///D:/worktree/e84d/PersonalAgent/.worktrees/image28-live-acceptance/docs/competition/evidence/FRONTEND_DESIGN_HANDOFF_FOR_GEMINI_20261120.md)。

## 工作树

| 用途 | 路径 | 分支 | 状态 |
| --- | --- | --- | --- |
| Z-01/02/03/06 + S531 本地修复 | `D:\PersonalAgent\.worktrees\zemeng-owned-image-remediation-20261119` | `codex/zemeng-owned-image-remediation-20261119` | **未提交**；Gemini 已完成本地实现与定向测试 |
| 已推 SWR 的 image28 回执 | `D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance\.cache\image28-receipts-20261120\` | 源码 `ac9a2552…` | 摘要 `sha256:9e2350…`；`runtimeDeploymentVerified=false` |
| 11 绑定 live 脚本 | `D:\worktree\e84d\PersonalAgent\.worktrees\z01-agentarts-bindings` | `codex/z01-agentarts-bindings` | 入口 `tests/manual/agentarts/owned-binding-live.mjs` |
| Z-04/05 通过树 | `D:\worktree\e84d\PersonalAgent\.worktrees\z04-notepad-uia` | （用户现场已通过） | 不再重开 |
| Z-10 | `D:\PersonalAgent\.worktrees\z10-privacy-tray-image28-20261119` | Draft PR `#689` @ `7bfb23ae` | CI 绿；待非作者批准与真机隐私/托盘；桌面 28 图总入口仍等 `#681` |

## 关键结论

1. **remediation 树已含本地代码**：`/invocations/f09`、评估超时开关、`traceId` 关联、`planGuidance` / MCP 防重复只读提案、PR `#531` 评估/只读模块等。本机 Node `24.15.0` 下 agentarts-runtime 定向测试通过（239 pass / 6 skip / 0 fail）。
2. **云端尚未吃到这些修复**：已推 SWR 的 image28 源码是 `ac9a2552`，**早于** remediation 未提交改动。因此 Z-02 云前缀、Z-03 平台分与 Trace、Z-01 新 11 绑定、Z-06 直连 MCP **都不能**用当前云 Latest 冒充已验收。
3. **Z-01 剩两项（2026-11-20 现场）**：详见 [Z01_BINDINGS_AND_TRIPLE_20261120.md](./Z01_BINDINGS_AND_TRIPLE_20261120.md)。
   - 11 绑定 live：**11/11 passed**（真实 WSS）；平台 ShowOpsTrace 观测读回仍缺 AK/SK。
   - 三方一致：**Latest 容器镜像 = 已确认 image28-receipts 源码/摘要**；`PA_AGENT_DEPLOYMENT_VERSION` 环境变量仍指向旧 `image28-live`，需控制台改齐后才能标 `runtimeDeploymentVerified=true`。
4. **未授权动作**：不自动 `git commit` / push / 新建 PR / `release-owned-image.ps1 -Push` / 切换 AgentArts「最新」；不自动改平台环境变量。

## 建议下一刀顺序

1. 用户确认后：将 remediation 树 scoped commit → Draft PR（仅 `packages/agentarts` + `apps/agentarts-runtime`）。
2. 启动 Docker Desktop，用 remediation HEAD 本地 `-Build`；**另需明确 `-Push` 与切换固定版/Latest 授权**。
3. 推仓并切换后：跑 `owned-binding-live.mjs` + `read-platform-trace.mjs`；云读 `/invocations/f09`、评测集分数与 `ShowOpsTrace`；直连 MCP 一轮。
4. 并行可推进、不依赖新镜像的项：Z-07 真机语音（需 SIS）、Z-08 日历/邮件触发与目录读 Policy、Z-09 余下 #05/#19/#25 与真机通知中心手点。

## 本回合已做

- 前端交接文档写给 Gemini；总交接文已加指针。
- Codex 根目录切到 remediation 树；确认 Z 本地修复与 image28 云回执不同源。
- **Z-08 后半（云常驻宿主）**：新增 `apps/desktop/electron/cloud-persistent-host.js`，Main 注入 `cloudPersistentHost`；快照暴露可用性；定向测试 15 pass。仍缺：真实 AgentArts 配置下的关机交接回执、`business_source_adapters`（Potatos）。
- **Z-09 #17 本地增量**（见 [Z09_NOTIFICATION_COLD_ACTIVATION_20261120.md](./Z09_NOTIFICATION_COLD_ACTIVATION_20261120.md)）：`nativeTag` + `activateByNativeTag` + win32 `Notification.handleActivation`；兼修 `briefing.openDecision` 放行 panel/workspace。定向 28 pass。仍缺：真机 toast 手点、#05/#19/#25。
