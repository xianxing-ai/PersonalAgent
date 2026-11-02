# PR #534 未知执行与评论去重修复

目标 profile：`huawei_ict_agentarts`。修复基线 `b9b5eb21`，工作树 `.worktrees/pr534-repair`、分支 `codex/pr534-repair-20261102`。本记录只覆盖本地实现和明确 Fixture，不是 ECS/VPS、真实 GitHub 或 AgentArts 验收。

## 已实现

- Runtime 在任何异步分派前用原 TaskRuntime `saveCheckpointOnce` 保存任务、kind、repo、payload 摘要和 unknown。同键输入变化、旧记录无摘要均拒绝；并发或重启只读原记录。`exec` 调用后异常、错绑回执、取消、超时均保留原主机 unknown，不再三次 SSH 重试、换主机或本地重放。只有明确未调用 `exec` 的会话准备失败可继续原回退路径。
- 正式回执核对 v1、jobId、idempotencyKey、kind。新 `signal`/`deadline` 可选参数由原调用方传入；宿主单次最多 60 秒，较短原期限保留。取消本地 SSH 或杀死超时命令不等于证明远端副作用已停止。
- 远端 stdin 与 inbox 两个入口复用原状态文件：执行前原子落盘 unknown，完成后 fsync + rename；损坏状态失败，不重置空历史。独占文件锁防止多个 SSH 进程同时执行/覆盖状态。该最小实现实际串行处理同一状态文件，崩溃残留锁不自动过期；原操作仍可只读，恢复需要运维核实后解除锁，不能重新执行 unknown。
- Desktop 用系统实际临时目录保存本次私钥与 known_hosts；准备失败和会话关闭均清理，重复 close 幂等。非默认 SSH 端口按 `[host]:port` 固定主机密钥。原心跳测试多开未关闭会话的问题同时消除。
- duty 子包 `6ca26e2d`（本树集成为 `4575914e`）：评论分页最多 100 页，未读完/失败返回 unknown；原未知评论必须精确核实原 ID/正文后才能改正文；两个提交入口在 POST/PATCH 前保存原 unknown，并按原 Runtime/task/comment 键串行。
- Desktop 每次评论发送前需要受信宿主同步核验原目标与完整正文；`policy.comment` 不构成该授权。当前 Main 没有原 ToolGateway 内容授权端口，真实自动评论明确 unavailable，仅保存 `requires_authorization` 意图和继续只读，不发 POST/PATCH。没有新增替代授权系统。

## 验证

本树使用原锁独立安装依赖（`npm ci --ignore-scripts --no-audit --no-fund`，跳过 Electron 下载），按根 build 依赖顺序直接运行 TypeScript。`agentarts` 的原 `scripts/build-observability.mjs` 也执行；源码型 `apps/agentarts-runtime` 不存在 tsconfig，未伪称执行其 TypeScript 构建。Runtime 构建通过；整合 duty 后仅重编 GitHub 与 Runtime，通过。

- `node --test apps/runtime/test/remote-runner.test.mjs apps/runtime/test/remote-runner-persistence.test.mjs apps/desktop/test/remote-runner-ssh.test.mjs`：首轮 12 项中的 10 项通过；两项分别受 Windows 沙箱原子 rename 的 EPERM、PATH 缺 `sh` 影响。保持断言，使用受允许执行环境并加入已有 Git `sh` 后，仅复验 `--test-name-pattern='file host persists|headless process'`，2/2 通过。
- 后续新增错绑回执拒绝用例，仅运行 `--test-name-pattern='receipt for another job' apps/runtime/test/remote-runner.test.mjs`，1/1 通过。本包合计 13 个不同用例通过，未重复跑全套。
- SSH 错误收尾统一终止本地子进程后，仅复验其 cancellation 用例，通过。
- duty 独立树：`node --test --test-concurrency=1 packages/connectors/github/test/developer-duty.test.mjs apps/runtime/test/developer-duty.test.mjs apps/desktop/test/developer-duty-github.test.mjs`，21/21 通过。包括第二页 marker、分页失败、并发、重启 unknown、误匹配拒绝、缺正文授权零写入。
- 相关 JavaScript `node --check`、`git diff --check` 通过。未运行全仓测试、真实 SSH、真实 GitHub 写入或云验收。

## 兼容和剩余边界

没有数据库迁移、新依赖或第二套任务库。原 runner v1 wire 增加/使用 deadline，宿主公开端口增加可选 signal/deadline；已有未带输入摘要的持久任务不会升级为新授权或重放，只会拒绝并保留原记录。远端服务必须和宿主修复一起部署，旧服务不具备跨进程执行前落盘保证。

异步子任务 active 生命周期、取消与已确认自定义类型约束由独立修复包覆盖，其结果另行记录。本记录不把尚未集成的该包当作通过。真实 SSH 令牌装配、Linux 部署、关机持续运行和真实 GitHub 正文确认链仍未验收，Competition/模块整体状态不得据本地测试提升为完成。
