# Z-10 隐私物理擦除图谱断链、原生托盘总暂停与 28 图可执行底座验收清单（2026-11-19）

> 目标 Profile：`huawei_ict_agentarts`（通用 Local Profile 仅保留既有 `runAgent()` 与 `ModelGateway` 边界，未新增或扩展，且不得静默回退）。  
> 工作流分支：`codex/z10-privacy-tray-image28-20261119`（基于 `origin/main@f33ef3837`）。  
> 状态口径：本文严格区分 **`verified_local_or_docker`（本机门禁 / SQLite / 本地 Docker 容器已实证）** 与 **`pending_real_human_or_cloud_acceptance`（需真人授权 / 真机 Windows 桌面 / 真实华为云 AgentArts 联调与推送授权）**。任何本地 Fixture、SQLite 或本地容器验证均不冒充真云或真机验收，也不自动触发 SWR `-Push` 或切换云端 `Latest`。

---

## 0. 门禁与本地/容器验证摘要（`verified_local_or_docker`）

| 验证项 | 命令 / 载体 | 实测结果 | 边界说明 |
| --- | --- | --- | --- |
| 架构与生成契约 | `npm.cmd run check:architecture` / `check:generated --workspace=@personal-agent/contracts` | `3/3` 通过 / 退出码 0 | 结构与生成 Schema 一致 |
| 契约夹具与能力覆盖 | `npm.cmd run test:contract-fixtures` / `verify-graph-capability-coverage.mjs` / `export-bindings.mjs --check` | `33/33` 通过 / 声明 `110`、提供者 `28`、缺口 `open=72, in-flight=10, needs-real=0` / 11 项绑定一致 | `workspace.patch_scope_check` 移入 `resolved`（`closedLoop: false`）；`voice.*` 与协作者缺口保留 |
| 全仓构建与类型检查 | `npm.cmd run build` / 6 个核心工作区 `typecheck` | 37 个工作区全部退出码 0 | `dist/` 为本地产物，不入 Git |
| 工作区单测 | `contracts`(34)、`goals`(33)、`coordination`(303)、`agentarts`(361)、`runtime`(1474)、`agentarts-runtime` 5 套件(20)、`desktop` Z-10(8) | **2,233 / 2,233** 通过（0 失败 0 跳过） | 含 `z10-privacy-graph-unlink`、`operator-brake-tray`、`execution-epoch`、`f09`/`f14`/`f20`/`shadow` 测试 |
| 根集成测试 | `node --test tests/integration/owned-agentarts-image.test.mjs tests/integration/z10-image28-priority-graphs.test.mjs` | **5 / 5** 通过（0 失败 0 跳过） | 真实 SQLite `TaskRuntime` + Policy `allow_once` + HTTP `createAgentServer` + `executionEpochVersion=1` 跑通 `F09/F13/F14/F15/F20/F22/F26/F28` |
| 本地 ARM64 镜像构建 | `pwsh -NoProfile -File scripts/agentarts/release-owned-image.ps1 -Build -Image personal-agent:z10-image28-20261119 ...` | 成功构建 `arm64`（`sha256:924653bb348b3dc2564f0e667e9a92df4c6d8a7367de452158dea20906d22481`），`published: false` | **严禁未经授权 `-Push`** |
| ARM64 容器内 `v24.15.0` 服务与 28 图冒烟 | `docker run --rm -i --platform linux/arm64 personal-agent:z10-image28-20261119` | `Node v24.15.0`、`arch: arm64`、`/ping=Healthy`、`/bindings=11`、`F01`–`F28` 28 图 `/invocations` `advance` 均 200 | 校验信封 `executionEpochVersion=1` 往返 |
| Node `24.15.0` 超时与 POSIX `SIGTERM` | ARM64 & AMD64 `node:24.15.0` 运行 `cloud-fetch-timeout-bootstrap.test.mjs`；原生 AMD64 `node:24.15.0-bookworm-slim` 运行 `server-shutdown.test.mjs` | `bootstrap` **4/4**（双架构通过）；`server-shutdown` **11/11**（含 5 条 `actual SIGTERM`，AMD64 通过） | 注：x64 宿主下的 `linux/arm64` QEMU 仿真因启动 >5s 超过 `server-shutdown` 5s 启动阈值，已在原生 AMD64 `v24.15.0` 完整实测通过 |

---

## 1. `#10` / MOD-27：隐私物理擦除与图谱断链闭环

### 1.1 本机已验证交付（`verified_local_or_docker`）
- **实现文件**：
  - `apps/runtime/src/fact-erasure.ts`：新增 `verifyPhysicalErasureGraphUnlink`（基于 `assertPrivacyDeletionReceipt` 与 `eraseDependentGraphHistory` 校验目标节点与传递衍生依赖零残留、图谱单调 `revision` 不重排、累计 `erasedGraphRevisions` 一致，不匹配时抛出 `GraphError('INVALID_ARGUMENT' | 'REVISION_CONFLICT', ...)` 并返回冻结校验报告）。
  - `apps/runtime/src/index.ts`：导出 `eraseDependentGraphHistory`、`verifyPhysicalErasureGraphUnlink` 及报告类型。
- **验证证据**：`apps/runtime/test/z10-privacy-graph-unlink.test.mjs` 在真实临时 SQLite（`openSqliteMemoryHost` + `TaskRuntime` + `createSqliteFactProjectionHost`）中验证：多版本目标与衍生 `goal`/`plan` 传递断链、保留无关兄弟节点、`beginFactErasure` → `preflightErasure` → `resumeFactErasure` 重启读回、擦除后追加节点维持 `revision = 6` 单调递增不复用 `[1,3,4,5]`、撤销回执及版本号错配负例，与相关套件合计 33/33 通过。

### 1.2 待现场真机真人授权与物理擦除验收清单（`pending_real_human_or_cloud_acceptance`）

- [ ] **前置**：在真实 Windows 桌面打开配置了私钥库（`PRAGMA secure_delete = ON`）的生产用户数据目录，记录擦除前 SQLite 路径及存在待删除私密事实及其衍生 `goal` / `plan` 节点的任务快照 ID。
- [ ] **现场人工授权**：用户在桌面端隐私/记忆管理页触发真实删除确认（不得使用测试夹具替代），生成真实 `PrivacyDeletionReceipt`。
- [ ] **物理擦除与图谱断链核对**：确认 `beginFactErasure` → `preflightErasure` → `resumeFactErasure` 执行成功；调用 `verifyPhysicalErasureGraphUnlink` 返回零残留目标节点与衍生节点、`erasedGraphRevisions` 与删除边界一致。
- [ ] **重启读回与单调版本校验**：完全退出桌面应用并重新冷启动后，检查 UI 列表、知识搜索与 SQLite 事实投影不再返回已删节点或明文碎片；新建后续图节点验证 `revision` 保持单调递增且不复用已擦除位置。
- [ ] **验收签署**：将本次人工验收时间、执行人、截图/日志摘要写入真实环境回执（当前代码级 `privacy-deletion-acceptance-plan` 保持 `closedLoop: false`）。

---

## 2. `#23` / PR `#637`：总暂停原生托盘触发、面板同步与待对账不重放

### 2.1 本机已验证交付（`verified_local_or_docker`）
- **实现文件**：
  - `apps/desktop/electron/operator-brake-host.js`：新增 `operatorBrakeTrayTooltip` 与单飞串行控制器 `createOperatorBrakeTrayController({operatorBrake, setToolTip, setMenu, publish, onError})`，保证连续快速点击时按单飞队列顺序串行切换状态，并与托盘 tooltip、右键菜单标签、主面板 IPC 快照保持严格一致。
  - `apps/desktop/electron/main.js`：将 `refreshTrayMenu()` 与 `toggleOperatorBrake()` 委托给 `operatorBrakeTray`（未改动 PR `#681` 所在组合区域）。
- **验证证据**：`apps/desktop/test/operator-brake-tray.test.mjs` 等 8 条相关桌面与运行时测试全部通过（8/8 + `runtime` `operator-brake.test.mjs`）：
  - 验证快速双击不交错竞态；
  - 验证托盘 tooltip、菜单项文本与主面板状态同步；
  - 验证在并发运行中同时存在只读任务（`read`）、本地写入任务（`local_write`）及云端未知状态（`competition-cloud-unknown`）任务时：拉闸后立即阻断新任务与调度提交；松闸后**仅只读任务恢复**（`calls === 1`），`local_write` 与 `cloud-unknown` 严格保持在 `waiting_reconciliation` 且不重放写入（`writeCalls === 1`），且重启 SQLite 后状态持久保留。

### 2.2 待真机 Windows 托盘交互验收清单（`pending_real_human_or_cloud_acceptance`）

- [ ] **托盘外观与多 DPI**：在 Windows 真实桌面托盘区域核对应用图标、悬停 tooltip 文案在正常态与暂停态准确切换（含 `100%` / `125%` / `150%` 缩放）。
- [ ] **托盘触发与面板双向同步**：
  - [ ] 通过系统托盘右键菜单触发「总暂停」，确认主窗口设置/控制面板实时变为已暂停，且提示文字与托盘一致；
  - [ ] 从主窗口开关解除「总暂停」，确认托盘菜单标签与 tooltip 同步更新为恢复态；
  - [ ] 连续快速点击托盘菜单切换两次，确认无状态倒挂、报错弹窗或渲染阻塞。
- [ ] **在途写任务与云未知任务现场复验**：在存在真实 `waiting_reconciliation` 写入任务或云端挂起任务时从托盘解除暂停，确认系统仅放行只读任务，原待对账写入任务不会被自动重放，且重启桌面端后仍保留待对账边界。

---

## 3. `#671` / IMAGE28：28 图可执行底座、Z-10 优先图与镜像交付

### 3.1 本机已验证代码与集成基线（`verified_local_or_docker`）
1. **Contracts / AgentArts / agentarts-runtime**：
   - `packages/contracts/schema/f20-candidate.json` 与生成物就绪（`F20_N02`/`F20_N04` 候选 schema）。
   - `packages/agentarts`：`F20_N03` 绑定工具 `coding.repair.trial`；`F24_N02` 与 `F24_N09` 对 `F24_N11`（`runtime.recover_checkpoint`）声明恢复前置依赖；`F09_N02` 透传 `predecessorOperations.F09_N01`；补齐 `owned-image-build`、`pinned-version-readonly`、`platform-evaluation-binding`、`ordinary-competition-sampling(-summary)` 与 `workflow-wiring.json`（28 图 / 185 节点 / 152 外部适配器）。
   - `apps/agentarts-runtime`：支持 `evaluationVersion` 服务控制器、`pinned_readonly.correlate` / `evaluation.bind` / `publish.record` / `deployment.build_plan` / `deployment.correlate_readback` 及向后兼容的 `executionEpochVersion: 1` 请求/响应信封校验。
2. **Coordination / Runtime / 优先图 Provider 适配**：
   - `packages/coordination`：`AgentArtsPayloadPreparer` 与 `executionEpoch` 封装（303/303 通过）。
   - `apps/runtime`：`TaskRuntime.readExecutionEpoch` / `advanceExecutionEpoch` / `assertExecutionEpoch` / `compareAndSetTrustedHostStateGuarded`；26 个 28 图 Host/Worker 执行模块及 [`runtime-application.ts`](file:///d:/PersonalAgent/.worktrees/z10-privacy-tray-image28-20261119/apps/runtime/src/application/runtime-application.ts)、[`agentarts.ts`](file:///d:/PersonalAgent/.worktrees/z10-privacy-tray-image28-20261119/apps/runtime/src/application/agentarts.ts)、[`f09-feed-graph-host.js`](file:///d:/PersonalAgent/.worktrees/z10-privacy-tray-image28-20261119/apps/desktop/electron/f09-feed-graph-host.js) 接线；新增 PR `#681` 兼容 fail-closed 适配器 [`z10-priority-graph-providers.ts`](file:///d:/PersonalAgent/.worktrees/z10-privacy-tray-image28-20261119/apps/runtime/src/application/z10-priority-graph-providers.ts)（覆盖 `F09`、`F13`、`F14`、`F20`、`F22`、`F26`、`F28`）。
3. **与 PR `#681` / 其他并行分支对齐说明**：
   - 未改动 PR `#681` 负责文件（`apps/desktop/electron/image-workflow-catalog.js`、`apps/desktop/electron/workflow-graph-composition.js`）；
   - `createZ10PriorityGraphProviders` 遵循 PR `#681` `createDesktopWorkflowGraphComposition({graphProviders})` 契约（缺受信端口时 `available() === false` 且 `compose()` 返回 `{tools: [], unavailable: [reason]}`；完整注入时返回 `entry`、`tools` 与 worker 配置）；
   - **`F20_N03` 对齐提醒**：本分支将模板中 `F20_N03` 从通用 `workspace.run_allowed_command` 对齐为专用 `coding.repair.trial`，PR `#681` 合入或联调时需确保 F20 工具可用性目录暴露 `coding.repair.trial`。

### 3.2 28 图分工、本机覆盖与真云/真机逐节点验收表（`pending_real_human_or_cloud_acceptance`）

| Workflow | 名称 | 责任归属（按能力缺口与分工） | 节点清单 | 本机 / Docker 验证状态 | 待真实云 / 真机 / 协作者闭环项 |
| --- | --- | --- | --- | --- | --- |
| `F01` | 主对话与责任理解 | `goo122` / `zemeng5208` / `2511375597-lab` | `F01_N01`–`F01_N09` | 镜像路由 + 模板加载（Docker 28图冒烟） | `memory.query`/`responsibility.snapshot`/`model.capabilities` 生产组合与 `Z-07` 语音询问闭环 |
| `F02` | 语音交互与确认 | `zemeng5208` / `goo122` | `F02_N01`–`F02_N11` | 镜像路由 + 模板加载（Docker 28图冒烟） | `Z-07` Windows 原生唤醒、SIS 就绪、防回声、麦克风 120m 许可释放（`voice.*` 保持 open） |
| `F03` | 世界状态、目标与局部重规划 | `goo122` / `zemeng5208` | `F03_N01`–`F03_N10` | 镜像路由 + 模板加载（Docker 28图冒烟） | 真实目标/补偿图状态切换与 `F03_N10` 语音确认实测 |
| `F04` | Wiki 与作用域记忆管理 | `goo122` | `F04_N01`–`F04_N07` | 镜像路由 + 模板加载（Docker 28图冒烟） | `memory.query`、`knowledge.source_and_write_check`、`goo122` 实际调用方接线与真库写入 |
| `F05` | 记忆搜索与来源回答 | `goo122` | `F05_N01`–`F05_N07` | 镜像路由 + 模板加载（Docker 28图冒烟） | 真实知识检索来源修订核对与引用发布 |
| `F06` | 待办、提醒与跟进 | `Potatos498` / `goo122` | `F06_N01`–`F06_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | Potatos498 真实 `todo.registered_write`、通知投递与桌面端消费（lab） |
| `F07` | 日历安排与冲突处理 | `Potatos498` | `F07_N01`–`F07_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | `Z-08` 日历真连接器与 freshness/write 读回验证 |
| `F08` | 邮件分类、草稿与发送 | `Potatos498` / `zemeng5208` / `goo122` | `F08_N01`–`F08_N13` | 镜像路由 + 模板加载（Docker 28图冒烟） | `Z-08` 邮件 task/grant 标识修复、真实邮箱归档/发送及待对账 |
| **`F09`** | 订阅、信号发现与筛选 | **Z-10 优先** + `Potatos498` / `goo122` / `Z-02` | `F09_N01`–`F09_N04` | **本地端到端通过**：`owned-workflow-f09-runtime`(4/4) + 集成全链 `settled` + Docker 冒烟 | `Z-02` 云端 `/invocations/f09` 入口修复后与 `Potatos498`、`goo122` 联跑 N01–N04 与 N04 入队 F10 |
| `F10` | 深度研究与证据汇总 | `goo122` / `Potatos498` | `F10_N01`–`F10_N06` | 镜像路由 + 模板加载（Docker 28图冒烟） | F09_N04 入队承接、真实 `research.search` 联跑 |
| `F11` | 天气、出行及计划影响 | `Potatos498` / `zemeng5208` | `F11_N01`–`F11_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | 真实日历联动更新与语音问询 |
| `F12` | 通知、安静时段与主动服务 | `Potatos498` / `goo122` | `F12_N01`–`F12_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | 安静时段与原生系统通知投递（依赖 `#574` 与真机桌面） |
| **`F13`** | 系统检查与故障诊断 | **Z-10 优先** (`zemeng5208` / `goo122`) | `F13_N01`–`F13_N04` | **本地端到端通过**：HTTP `createAgentServer` + `createRuntimeF13SystemProbeHost` + `F13DiagnosticControlHost` 全链 `settled` | 真实 Windows 宿主机系统探针与锁恢复真机复验（配合 PR `#681` Desktop 注入） |
| **`F14`** | 浏览器与桌面操作 | **Z-10 优先** (`zemeng5208`) | `F14_N01`–`F14_N06` | **本地端到端通过**：`F14ObservationHost` + `F14DeviceControlHost` (N01–N06 + Guard) 全链 `settled` | `Z-04`/`Z-05` 真实 Windows 窗口/UIA 控件与 100%/125%/150% DPI 真机输入确认闭环 |
| `F15` | 代码修改、补丁与命令执行 | `goo122` / `zemeng5208` | `F15_N01`–`F15_N06` | **本地端到端通过**：HTTP + SQLite + Policy 跑通 N01–N06 `settled`；`workspace.patch_scope_check` 移入 `resolved` | `Z-09` 真实工作区内容围栏放行受信任 `npm_test`、独立签名红线审查真人签约流程 |
| `F16` | CI 检查与修复 | `Potatos498` / `goo122` | `F16_N01`–`F16_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | GitHub 真实 CI 绑定解析与补丁测试闭环 |
| `F17` | 测试失败定位 | `goo122` | `F17_N01`–`F17_N04` | 镜像路由 + 模板加载（Docker 28图冒烟） | 真实工作区失败复现与诊断上报 |
| `F18` | PR 审查、批准条件与合并 | `goo122` | `F18_N01`–`F18_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | GitHub PR 真实 diff 门禁与注册合并动作实测 |
| `F19` | Issue 分诊与关联修复 | `goo122` | `F19_N01`–`F19_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | GitHub 真实 Issue 快照与合并读回关单 |
| **`F20`** | API 文档与一致性检查 | **Z-10 优先** (`zemeng5208`) | `F20_N01`–`F20_N04` | **本地全覆盖通过**：`f20-candidate`(Schema) + `owned-workflow-worker-runtime`(11/11 含 SQLite 重启原生恢复) + 集成全链 `settled` | `Z-01` 真实云端模型调用决策工具与真实文档/API 代码校对联跑（注意对齐 `coding.repair.trial`） |
| `F21` | MCP、Skills 和连接器接入 | `goo122` | `F21_N01`–`F21_N05` | 镜像路由 + 模板加载（Docker 28图冒烟） | `Z-06`/`Z-09` MCP 续传去重与插件最小权限真机验收 |
| **`F22`** | 工作流调试与影子实验 | **Z-10 优先** (`zemeng5208`) | `F22_N09`, `N01`–`N08` | **本地端到端通过**：`workflow-f22-shadow-graph-host` + `shadow-*` 单元测试 + HTTP/SQLite 集成 `settled` | 真实历史 Trace 影子隔离回放与平台对比观测 |
| `F23` | 决策配置、评估与版本晋升 | `goo122` / `Z-03` | `F23_N01`–`F23_N05` | `evaluation-controller` / `pinned-platform-loop` + `workflow-shadow-*` 通过 | `Z-03` 真实评估集列映射、防泄漏检查与版本回滚实测 |
| **`F24`** | 调度、并发、取消与恢复 | `goo122` + **Z-10 恢复序** | `F24_N01`–`F24_N12` | `f24-recovery-dependencies` 通过（`F24_N11` 先于 `F24_N02`/`F24_N09`）+ Docker 冒烟 | `Z-08` `cloudPersistentHost` 离线云续跑与真实取消恢复联调 |
| `F25` | 配置、账户、凭据和数据范围 | `goo122` | `F25_N01`–`F25_N04` | 镜像路由 + 模板加载（Docker 28图冒烟） | `Z-06` 出站凭据/上下文策略阻断实测与安全存储真机验收 |
| **`F26`** | 镜像、部署与比赛验收 | **Z-10 优先** (`zemeng5208`) | `F26_N01`–`F26_N05` | **本地构建与容器冒烟通过**：`release-owned-image -Build` ARM64 + `F26DeploymentReadbackHost` 集成 `settled` | **人工授权 `-Push` 推入 SWR** → AgentArts `Latest` 切换 → 真实 POD ReadinessProbe / WSS 令牌轮换（`Z-01`） |
| `F27` | 上下文预算、压缩与恢复 | `goo122` | `F27_N01`–`F27_N07` | 镜像路由 + 模板加载（Docker 28图冒烟） | 真实大模型 Token 预算与上下文压缩恢复 |
| **`F28`** | 多厂商模型、思考深度与主对话分配 | **Z-10 优先** (`zemeng5208` / `goo122`) | `F28_N01`–`F28_N12` | **本地端到端通过**：`F28NativeConfigHost` + 条件分支 + HTTP/SQLite 集成 `settled` | 真实盘古/多厂商模型目录、`thinking` 与子 Agent 工具范围限制实测 |

### 3.3 推送华为云 SWR 与切换 `Latest` 的授权前置门禁（未执行，需人工授权）

- [ ] **合入前门禁确认**：本分支与 `Z-01`..`Z-09`、PR `#681`、PR `#618` 合入目标基线后，先运行全仓 `npm.cmd run check` 并确认 `apps/desktop/electron/image-workflow-catalog.js` 中的 `F20_N03` 与 `coding.repair.trial` 一致。
- [ ] **显式授权镜像发布**：取得用户/Owner 明确授权后，在有 SWR 凭据的本机终端执行带 `-Push` 的发布命令（本任务**严禁自行推送**）：
  ```powershell
  pwsh -NoProfile -File scripts/agentarts/release-owned-image.ps1 -Build -Push -Image <swr-registry-image>:<tag>
  ```
- [ ] **平台端读回验收（对应 F26_N03 / F26_N04 / Z-01）**：
  - [ ] 读取 AgentArts 控制台或 API 确认新 ARM64 Digest 已生效且不再使用旧镜像或未轮换的旧 WSS 令牌；
  - [ ] 调用真实 `GET /bindings` 与 `GET /ping` 确认 11 项绑定在线；
  - [ ] 执行 `tests/manual/agentarts/` 下对应真实云端读回脚本并记录真实 `requestId` / `traceId` / `deploymentVersion`。
