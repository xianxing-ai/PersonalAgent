# 用户工人持久化 + 华为真实 WSS / 本地 ARM64 构建 · 2026-11-21

Profile：`huawei_ict_agentarts`  
工作树：`D:\PersonalAgent\.worktrees\zemeng-owned-image-remediation-20261119`  
分支：`codex/zemeng-owned-image-remediation-20261119`

## 1. 用户自定义工人持久化（已做）

| 面 | 内容 |
| --- | --- |
| SQLite | migration `v15` 表 `workers`（builtin + user） |
| Runtime | `createWorker` / `renameWorker` / `deleteWorker` / `listWorkers` / `getWorker` / `resolveWorker` |
| Desktop IPC | `worker.create` · `worker.rename` · `worker.delete` · `workers.list` · `worker.get`；snapshot.`workers` |
| 规则 | 内置不可删改名；自定义上限 24；忙碌中不可删 |

定向测试：`user-worker-persistence.test.mjs`、`workers-frontend-interface.test.mjs`、`front-desk-worker-roster.test.mjs` 通过。

## 2. 华为真实调用（已跑）

### 2.1 WSS 绑定 live

入口：`tests/manual/agentarts/owned-binding-live.mjs`（本树已同步 Z01：目录允许多余顶层字段）。  
配置：既有 `.cache/z01-live-20261120/live-config.json`（不落库明文到回执）。

| 项 | 值 |
| --- | --- |
| Runtime | `pa-z01-model-accept-20261119` |
| Case | `fast` / `71f3004f-…` |
| 结果 | **passed** |
| requestId | `772af68e-a2f4-4b84-b7dd-df624cc15679` |
| evidence | `real-huawei-wss-attempt` |
| 回执目录 | `.cache/front-desk-live-20261121/bindings2/` |

### 2.2 Trace / Logs 读回

对同 runtime 调 `GET /v1/ops/observation/agent-run/.../log`，鉴权为 inbound+WSS：

| 项 | 值 |
| --- | --- |
| HTTP | **401** |
| hits | 0 |
| 探针 | `.cache/front-desk-live-20261121/trace-probe.json` |

结论：WSS 业务调用已 verified；**平台 Logs / ShowOpsTrace 仍需 console 会话或 AK/SK 签名**，本机无 `~/.huaweicloud/credentials`，不冒充 Logs verified。

### 2.3 镜像构建（本地 ARM64）

`scripts/agentarts/release-owned-image.ps1 -Build`：

| 项 | 值 |
| --- | --- |
| image | `personal-agent:front-desk-20261121` |
| architecture | **arm64** |
| imageId | `sha256:8de1c5e59804a983f2c58077b4a603f81dff99559c5a8ed11f0defa026b24e65` |
| built | true |
| published | **false**（无 SWR login / registry 引用） |
| runtimeDeploymentVerified | false |
| 回执 | `.cache/front-desk-image-build-20261121/release.json` |

## 3. 未完成（需宿主凭据）

1. `docker login` + `-Push -RegistryReference …` 推 SWR  
2. 控制台 `UpdateCoreRuntime` 切 Latest / `PA_AGENT_DEPLOYMENT_VERSION`  
3. AK/SK 或 console `cftk` 做 Logs / ShowOpsTrace 对上本轮 `requestId`  
4. 新镜像上线后，再验云端 `frontDeskWorkerVersion`（当前云端仍为 image28-receipts 代）

## 提交状态

未提交、未建 PR。
