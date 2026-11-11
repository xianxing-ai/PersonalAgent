# F22 / F26 / F28 真实 Shadow、平台部署读回与模型能力 Gate 证据（2026-11-04）

目标 profile：`huawei_ict_agentarts`。工作分支 `zemeng/f22-f26-f28-readback-gates`，负责人 `zemeng5208`。
基线来源：基于 PR #543 head `codex/pr531-cloud-persistent`。

## 1. 覆盖矩阵

| 领域 | 端口 / Gate 项 | 实现文件 | 未配置 / 缺受信口行为 | 测试文件与关键断言 |
|---|---|---|---|---|
| **F22** | Shadow 观测宿主 (`F22_N01`) | `apps/runtime/src/application/workflow-f22-shadow-graph-host.ts` | 缺 options/端口时返回 `{tools:[], unavailable:'f22_shadow_observation_trusted_ports_unavailable'}`；执行时若 snapshot 缺/畸形/非对象或读取抛错，fail-closed 抛 `UNSUPPORTED_CAPABILITY`；导出未授权抛 `UNAUTHORIZED`；读回漂移抛 `REVISION_CONFLICT` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`（未配置返回 unavailable、端口抛错/畸形对象拒绝、导出拒绝、漂移拒绝、fixture 正例返回 `frozenComparisonInput`）；`apps/runtime/test/workflow-optional-graph-hosts.test.mjs` |
| **F22** | 原执行历史回放 (`workflow.f22.trace_replay`) | `apps/runtime/src/application/workflow-f22-trace-replay.ts` | 缺 options/端口时返回 `{tools:[], configuredWorkflowWorkerPorts:[], unavailable:'f22_original_trace_ports_unavailable'}`；未开启 admission 或主任务未具备优先级时 worker `available() === false`，调用时拒绝；回放结果保留 `counterfactualComparison:'unknown'`, `currentResultValidity:'not_independently_verified'`, `trainingPerformed:false` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`；`apps/desktop/test/f22-trace-replay.test.mjs`（真实 Engine/Runtime/Policy/SQLite 下未知写零重放） |
| **F22** | Desktop 回放与影子宿主 | `apps/desktop/electron/f22-trace-replay-host.js`、`apps/desktop/electron/workflow-shadow-release-host.js` | 缺 options 时 `createDesktopF22WorkflowWorkerPorts` 返回 `{tools:[], configuredWorkflowWorkerPorts:[], unavailable:'f22_desktop_trace_ports_unavailable'}`；`readDesktopWorkflowShadowRelease` 缺端口或 acceptance 时返回 `undefined`，tools 保持未注册 | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`；`apps/desktop/test/f22-main-configuration.test.mjs`；`apps/desktop/test/workflow-shadow-release-composition.test.mjs` |
| **F26** | 平台部署读回宿主 (`F26_N03`) | `apps/runtime/src/application/workflow-f26-deployment-graph-host.ts` | 缺 options/端口时返回 `{tools:[], unavailable:'f26_deployment_readback_trusted_ports_unavailable'}`；`readDeploymentRuntime` 抛错或返回非 boolean `podRunning`/`readinessProbe` 时 fail-closed 抛 `UNSUPPORTED_CAPABILITY`；导出未授权抛 `UNAUTHORIZED`；前后读回漂移抛 `REVISION_CONFLICT` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`（未配置 unavailable、抛错拒绝、缺少 boolean 探针拒绝、漂移拒绝、正例返回）；`apps/runtime/test/workflow-optional-graph-hosts.test.mjs` |
| **F26** | 发布验证 Worker (`workflow.release.verify`) | `apps/runtime/src/application/workflow-f26-worker.ts` | 缺 options 时返回 `{tools:[], configuredWorkflowWorkerPorts:[], unavailable:'f26_workflow_worker_ports_unavailable'}`；`sourceConfiguration` 未就绪时 `available() === false`；`readDeployment` 必须 `podRunning===true` 且 `readinessProbe===true`，否则 `UNSUPPORTED_CAPABILITY` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`；`apps/desktop/test/f26-release-worker.test.mjs`（一次完整图执行，SWR 摘要与工具回执核对） |
| **F26** | Desktop 发布端口模块 | `apps/desktop/electron/f26-workflow-worker-ports.js` | 缺 options/源码/固定工具链时返回 `{tools:[], configuredWorkflowWorkerPorts:[], unavailable:'...'}`；当底层 runtimeModule unavailable 时，`tools` 严格返回 `[]`，禁止将 `workspace.f26_release` command 暴露或导出 | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`（断言底层 unavailable 时 tools 长度为 0） |
| **F26** | 控制面部署读回与镜像绑定 | `apps/desktop/electron/agentarts-deployment-readback.js`、`packages/agentarts/src/owned-image-build.ts`、`packages/agentarts/src/pinned-version-readonly.ts` | 拒绝 Latest 与非法端点名；未读回时 `state:'unavailable'`, `reason:'control_plane_reader_missing'`；控制面 `READY` 仅表示 `runtimeReady`，`containerExecution` 与 `readinessProbe` 恒为 `unverified`，绝不混淆；本地执行必须为 `succeeded`，`localTaskCompleted` 恒为 false | `apps/desktop/test/agentarts-deployment-readback.test.mjs`；`packages/agentarts/test/owned-image-build.test.mjs`；`packages/agentarts/test/pinned-version-readonly.test.mjs` |
| **F28** | 原生配置 Host 与 Guard (`F28_N03`) | `apps/runtime/src/application/workflow-f28-model-native-host.ts` | 缺 options/端口时返回 `{tools:[], unavailable:'...'}`；`readNativeConfig` 抛错、缺少布尔型角色能力或 check 错配时抛 `UNSUPPORTED_CAPABILITY`；guard 状态非 `selected`/`skipped`/`unknown` 时抛 `UNSUPPORTED_CAPABILITY` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`；`apps/runtime/test/workflow-optional-graph-hosts.test.mjs` |
| **F28** | 模型候选 Worker (`workflow.f28.model_candidates`) | `apps/runtime/src/application/workflow-f28-model-candidates.ts` | 缺 options/端口时返回 `{tools:[], configuredWorkflowWorkerPorts:[], unavailable:'f28_original_model_ports_unavailable'}`；任一角色缺少 `capabilities.text` 时 `available() === false`，读取抛 `UNSUPPORTED_CAPABILITY`；结果始终为 `candidate_only`，`sourcesSupported:'unverified'`, `tests:'not_run'`, `nativeCapabilityVerification:'unverified'` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`；`apps/desktop/test/f28-model-workflow.test.mjs`（三次模型调用独立内容确认，本机 checkpoint 隔离） |
| **F28** | Desktop 模型端口模块 | `apps/desktop/electron/f28-model-graph-ports.js`、`apps/desktop/electron/f28-model-workflow-ports.js` | 缺 options 时返回 unavailable；`modelApiHost.readHarnessConfiguration` 缺失 roles 或未显式提供布尔值时抛 `UNSUPPORTED_CAPABILITY`（绝不从思考/预算标志假冒原生支持）；无原 dispatch 状态时 guard 返回 `unknown` | `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs` |

## 2. 重点核验结论

1. **未配置 / 缺受信口 fail-closed**：所有 F22、F26、F28 的 Runtime 工厂与 Desktop 端口在缺少配置、参数不全或外部端口未注入时，一律返回 `tools: []`、`configuredWorkflowWorkerPorts: []` 并附带明确的 `unavailable` 错误标识；不向上层注册或发布任何工具能力，不返回伪造的 `ok`/`ready`/`succeeded`。
2. **探针与状态不混淆**：华为 AgentArts 控制面的 `READY` 状态仅映射为 `runtimeReady: true`，`containerExecution` 与 `readinessProbe` 严格保留为 `unverified`；只有当实际经过真实认证的容器执行或探针确认时才允许标记，绝不将控制面就绪等同于容器探针通过。
3. **模型能力 Gate**：严格要求 research/analysis/coder 角色具有显式的布尔值声明；缺少原生角色声明、缺少 `capabilities.text` 或仅声明思考预算时，均拒绝并抛出 `UNSUPPORTED_CAPABILITY`；候选生成结果严格标记为 `candidate_only` 与 `nativeCapabilityVerification: 'unverified'`，绝不伪造已验证状态。
4. **Desktop 发布命令防泄露**：当底层 Release Worker ports 为 unavailable 时，Desktop 端口包装层严格返回 `tools: []`，坚决不向系统暴露 `workspace.f26_release` 写入命令。

## 3. 代码改动说明

1. `apps/runtime/src/application/workflow-f26-worker.ts`:
   - 增加 `createF26WorkflowWorkerPorts(options?: F26WorkflowOptions)` 的入口参数防护：当 `!options` 或缺少必要回调与数组时，安全返回 `{tools: [], configuredWorkflowWorkerPorts: [], unavailable: 'f26_workflow_worker_ports_unavailable', readBuildBinding() { ... }}`，消除缺配置调用时的异常抛出。
2. `apps/desktop/electron/f26-workflow-worker-ports.js`:
   - 在导出工具前增加 `if (ports.unavailable) return {tools: [], configuredWorkflowWorkerPorts: [], unavailable: ports.unavailable};`，确保在底层发布端口不可用时不错误暴露 `workspace.f26_release` 外部写入命令。
3. `apps/runtime/src/application/workflow-f28-model-native-host.ts`:
   - 在 `readNativeConfig` 与 `resolveGuardState` 的调用处增加 `try / catch` 防护：当底层端口抛出异常时，统一 fail-closed 为 `failOwnedHost('UNSUPPORTED_CAPABILITY', '...')`，与 F22 / F26 契约保持一致。
4. `apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`:
   - 新增针对 F22、F26、F28 读回端口与能力 gate 的完整单元测试套件（8 项测试），覆盖未配置、端口抛错、畸形数据、能力不足、探针混淆防护及合法 fixture 正例。

## 4. 本地实际运行命令与结果

- `npm run build --workspace=@personal-agent/runtime`: 编译通过，退出码 0。
- `npm run check:architecture`: 架构边界检查 3/3 通过，退出码 0。
- `node --test apps/desktop/test/f22-f26-f28-readback-gates.test.mjs`: 新增 8 项 gate 门禁测试全绿通过（1327ms）。
- 批量运行相关测试（64 项测试）：
  ```bash
  node --test apps/desktop/test/f22-trace-replay.test.mjs \
              apps/desktop/test/f26-release-worker.test.mjs \
              apps/desktop/test/f28-model-workflow.test.mjs \
              apps/desktop/test/f22-main-configuration.test.mjs \
              apps/desktop/test/agentarts-deployment-readback.test.mjs \
              apps/desktop/test/workflow-shadow-release-composition.test.mjs \
              apps/desktop/test/f22-f26-f28-readback-gates.test.mjs \
              packages/agentarts/test/pinned-version-readonly.test.mjs \
              packages/agentarts/test/owned-image-build.test.mjs \
              packages/agentarts/test/workflow-shadow-release.test.mjs \
              packages/agentarts/test/workflow-shadow-policy.test.mjs \
              apps/runtime/test/workflow-optional-graph-hosts.test.mjs
  ```
  结果：64 pass, 0 fail, 0 cancelled, 0 skipped, 耗时 4008ms。
- `git diff --check`: 格式与空白检查通过，无违规输出。

## 5. 未完成的真实验收边界说明

1. **真实 Shadow 服务**：当前仅完成本地契约与 replay 门禁验证；真实机会并行、decision_shadow 隔离实跑及反事实收益评估仍需真人授权与独立云环境支持，保持未完成。
2. **真实 AgentArts 部署读回与容器探针**：控制面 ShowCoreRuntime / ShowCoreRuntimeEndpoint 的真实 AK/SK 平台调用与真实容器内部健康探针尚未闭合，不将控制面 READY 作为平台验收完成。
3. **真实模型能力读回**：原生 function calling 与实际模型原生推理能力尚未取得真实验证，保持 `nativeCapabilityVerification: 'unverified'`。
4. **Desktop main 生产组合**：按分工由 `2511375597-lab` 接入生产组合与设置页，本 PR 不修改 `apps/desktop/electron/main.js`，不跨界代接前端。

## 审阅补充（提交前）

- F28 的 `readNativeConfig` / `resolveGuardState` 抛错时，`CANCELLED`、`TIMEOUT`、`RESULT_UNKNOWN` 保留原错误码，不会被改写成 `UNSUPPORTED_CAPABILITY`，以免取消或未知结果被当作“能力不可用”处理。其余端口错误统一记为不可用。门禁测试已补这 3 种错误码。
- `createF26WorkflowWorkerPorts` 缺 options 时的分支，以及 Desktop 侧“底层 unavailable 时不暴露 `workspace.f26_release`”的守卫，都是防御性 fail-closed。现有 Desktop 组合总是传入完整 options，因此正常路径行为不变。
- `apps/desktop/electron/main.js` 组合未改动。三者在生产环境由 lab 按公开端口接入；真实 shadow 服务、AgentArts 部署读回与容器探针、真实模型能力读回都未验收。
