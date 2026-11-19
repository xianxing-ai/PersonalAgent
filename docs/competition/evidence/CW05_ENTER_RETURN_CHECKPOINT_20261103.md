# CW-05 无人值守/归来控制与 Checkpoint 恢复接线记录

目标 profile：`huawei_ict_agentarts`。分支：`zemeng/cw05-enter-return-checkpoint`，基线提交 `ed30f1db9c23d5cd51d942d322513d82aeefee6a`（PR #543 / `codex/pr531-cloud-persistent`，基于 #535 与 #531）。唯一负责人：`zemeng5208`（MOD-28 / MOD-30）。状态：`review`；接口：`provisional`；真实云宿主与关机持续执行：**unverified**。

本记录覆盖 CW-05 无人值守（`enter_unattended`）与归来（`return`）控制与底层 TaskRuntime Checkpoint 持久化、SQLite 重启恢复、未知操作防重提、控制版本（`controlRevision`）CAS 校验，以及配置缺失 fail-closed 的本地可验证缺口交付。

---

## 1. 改动与接线说明

### 1.1 enter/return 控制与 Checkpoint 持久化接线
- **Runtime 侧**（`apps/runtime/src/application/cloud-persistent.ts`）：
  - 在 `handle()` 的 `control` 分支中，当操作为 `enter_unattended` 或 `return` 时，通过 `host.control()` 推进控制版本 `controlRevision`，将状态及未执行前沿提案失效写入 `TaskRuntime` checkpoint（`save(snapshot)`）；
  - `enter_unattended` 将工作流模式推进为 `unattended`，`return` 将模式推进为 `attended`；
  - 控制执行完成后调用 `application.resumeProactiveTask(binding.taskId)` 唤醒后台 worker 继续执行对应模式的前沿；
  - 在 `readback()` 中通过 `readPersistedRuntimeProactiveWorkflow()` 校验原 session checkpoint 是否存在，并校验 `taskDeadline` 未被篡改；若缺失或期限不一致，明确返回 `RESULT_UNKNOWN`（`Original unattended control checkpoint is unavailable`），杜绝回退为伪造的零版本。

- **Desktop 侧**（`apps/desktop/electron/cloud-persistent-host.js`）：
  - 在 `act('control', input)` 前置校验：若本地已存有 `saved.lastReply.controlRevision`，则强制要求 `input.control.expectedControlRevision === saved.lastReply.controlRevision`，版本不匹配直接拒绝（`REVISION_CONFLICT: 控制必须匹配原云会话的当前控制版本`），避免网络盲发造成未知状态；
  - 控制发送前将本地记录标记为 `transportState: 'unknown'` 并持久化 checkpoint；仅在收到远端确认且版本合规的 reply 后才转为 `confirmed`。

### 1.2 恢复与续跑路径（重启恢复与未知操作防重提）
- 进程重启后通过 `restarted.runtime.recoverInterruptedTasks()` 与 `createCloudPersistentRuntimeHost(restarted, options)` 重建会话；
- 重启后 `readback` 完整读回已持久化的 `controlRevision` 与目标任务状态；
- 若某条控制命令已被记录（`cloud-command:<hash>` 已入账），但未生成 confirmed reply，则该命令被判定为未知操作（`RESULT_UNKNOWN`），禁止自动重放执行，必须先经原会话 readback 确认。

### 1.3 缺失配置/无存储 fail-closed
- Desktop 未配置 `cloud-persistent-binding.json` 或 runner 未启用该云宿主时，`status()` 明确返回 `{state: 'unavailable', sourceTasks: [], sessions: []}`，任何调用抛出 `UNSUPPORTED_CAPABILITY`；
- 云端缺少 `qualificationEvidenceRef` 或 `assertCurrent` 失效时，立即抛出 `UNSUPPORTED_CAPABILITY`；
- 若云会话任务丢失 checkpoint 或 checkpoint 中 deadline 冲突，返回 `RESULT_UNKNOWN`，不假装成功。

---

## 2. 本地实际运行并通过的检查

所有检查均为离线本地测试（Fixture/Fake，不连真实外网，不访问真实云与真实密钥），均已在当前工作树实际执行并通过：

| 测试文件 / 命令 | 结果 | 验证内容与证据边界 |
| --- | --- | --- |
| `node --test apps/runtime/test/cloud-persistent.test.mjs` | **5/5 通过** | 覆盖 `enter_unattended` 持久化 checkpoint、控制版本递增、相同 commandId 幂等缓存防重跑、SQLite 重启后 readback 恢复版本 1、过期 `expectedControlRevision: 0` 拒绝、有效 `return` 控制恢复模式至 `attended` 并递增至版本 2、未完成命令拒绝重复执行（`RESULT_UNKNOWN`）、丢失 checkpoint 读取明确报错。 |
| `node --test apps/desktop/test/cloud-persistent-host.test.mjs` | **3/3 通过** | 覆盖未配置宿主返回 unavailable 与拒绝调用、失联控制持久未知、Desktop 控制前置核对 `expectedControlRevision`（版本不匹配抛 `REVISION_CONFLICT`）、confirmed reply 本地持久化及宿主重建后读取。 |
| `node --test apps/runtime/test/proactive-workflow-application.test.mjs` | **24/24 通过** | 覆盖原 TaskRuntime 控制端口 `createRuntimeProactiveControlPort` 对 `enter`/`return` 的 checkpoint 检验、原子控制修订号、暂停/取消控制屏障、离线设备 waiting_device。 |
| `node --test apps/runtime/test/proactive-workflow-session.test.mjs` | **11/11 通过** | 覆盖 SQLite 重启后 checkpoint 完整性、pure frontier 重算、CAS 与请求幂等性。 |
| `tests/integration/proactive-image-host.test.mjs` | **3/3 通过** | 覆盖主动工作流与镜像宿主集成、离线连接器事件沉降与归来摘要。 |
| `npm run check:architecture` | **3/3 通过** | 验证各工作区依赖与公开接口边界，无反向依赖，无未授权跨包导入。 |

---

## 3. 仍需真实验收项（当前保持 unverified）

以下项目受硬件、真实华为云凭据及物理环境限制，本地离线环境**不得伪称已验收**，必须在获得正式资源及环境授权后按规定流程验收：

1. **真实 Linux 主机与独立服务进程**：
   - 需真实 Linux ECS/VPS、非 `tmpfs` 的独立持久化卷、私有 socket 目录及独占 `.runtime-owner.lock`。
2. **物理关机期间云持续运行**：
   - 需在客户端物理关机或网络断开期间，由独立云端宿主持续执行 Scheduler 调度与工作流循环；本地测试环境仅验证了 SQLite 进程重开恢复，**未宣称物理断电/关机持续运行已验收**。
3. **真实 AgentArts 平台闭环**：
   - 需真实华为云 AgentArts endpoint、固定 deploymentVersion、真实平台调用 trace 及云端模型真实读回。
4. **真实设备与业务账号边界**：
   - 物理麦克风/扬声器（F02）、WinForms 目视与真人签名（F15）、真实业务连接器（F06/F08 日历与邮件）仍归原负责人及环境分别验收。
