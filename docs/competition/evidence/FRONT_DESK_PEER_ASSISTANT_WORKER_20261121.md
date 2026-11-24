# 前台 / 同级助手 / 固定工人 — 本地与镜像接线回执

日期：2026-11-21
Profile：`huawei_ict_agentarts`
工作树：`D:\PersonalAgent\.worktrees\zemeng-owned-image-remediation-20261119`
分支：`codex/zemeng-owned-image-remediation-20261119`

## 行为变化

1. **前台主助手与同级助手**：暴露同一套助手面——聊天 + 轻读（天气/通知/历史）+ `assistant.message` + `subagent.dispatch` 派工人；不再与子任务工人共用身份投影。
2. **固定工人池**：工人面不收口，拿到全部工具与连接器；助手只派工、工人干活。`DEFAULT_WORKERS` 优先复用，用户点名新建留给宿主决策。
3. **前端接口**：`listWorkers()` / `getWorker()` / Desktop `workers.list` · `worker.get` · snapshot.`workers`（只读展示，不授予权限）。
4. **镜像**：owned image 增加 `frontDeskWorkerVersion` 控制器（list_workers / classify_surface / assert_tool / resolve_worker）。

## 验证

本地定向测试（构建后）：

- `packages/agentarts` → `front-desk-worker.test.mjs`
- `apps/runtime` → `front-desk-worker-roster.test.mjs`
- `apps/agentarts-runtime` → `front-desk-worker-controller.test.mjs`
- `apps/desktop` → `workers-frontend-interface.test.mjs`

## 跟进（盘点后）

[盘点子任务](9d6090a9-64e7-4c80-99e5-17de88c5c8f2)指出：`delegateUserTasks` 仍会给每个主对话写 `required-subagent-delegation:v1`，根任务会被 `userTaskDelegationPort` 强制成只能 `subagent.dispatch`。已改为：**有 `front-desk-turn` 时不再写强制委派**，前台可直调轻工具并可选派工人。

## 后续完成

- 用户工人持久化 + 华为 WSS live / 本地 ARM64 构建：见 [USER_WORKER_AND_HUAWEI_LIVE_20261121.md](./USER_WORKER_AND_HUAWEI_LIVE_20261121.md)。

## 未验证 / 限制

- Renderer 工人卡片 UI 未画；IPC/snapshot 已留。
- SWR 推送与控制台切 Latest、Logs/ShowOpsTrace（需 AK/SK 或 console）仍缺宿主凭据。
- 本回执不构成接口冻结；`workers.*` 为 provisional 宿主面。
