# PR #503 孤立 submitting 恢复：隔离补丁

2026-10-26 UTC；Profile `huawei_ict_agentarts`；基线 PR #503
`06a0848ffa7d4ce84bb1f4454f3179eb0efd3eb4`。本补丁仅处理
[P2 恢复意见](https://github.com/xianxing-ai/PersonalAgent/pull/503#discussion_r4369577045)。
用户授权后，在独立 `codex/pr503-orphan-recovery-20261026` 分支实现；不修改作者原分支或工作树。
10/23 关于“不改写 #503”的评论只是当时 #511 工作范围协调记录，并非外部 Owner 的停止指令；
当前用户已明确授权收尾 #503。本轮保留原工作树，交 root 审查及沿原 PR 正常交付，
本实现工作包不推送、批准、合并或发布。

## 恢复依据与行为

原 Desktop host 先保存 submitting，随后提交 Runtime，再保存 taskId；中间退出可留下永久 active、但无法读回的条目。
修复在 active 计算之前，只处理当前 generation、submitting 且缺 taskId 的记录：

- 沿既有公开 `TaskRuntime.findTaskByIdempotencyKey` 读取
  `host-tool:${JSON.stringify([namespace, commandId])}`。这与原
  `RuntimeApplication.submitBoundHostToolTask` 的键一致；Desktop composition 已把
  `desktopHost.userNamespace` 作为 host namespace 注入。
- 通过既有 `loadCheckpoint(taskId, 'host-tool-intent')` 校验 namespace、commandId、
  tool/version、完整 arguments 及 deadline，再使用 `readHostToolTask` 只读确认原任务。
  匹配则保存原 taskId/pending，补原缓存受理绑定，继续既有终态消费。
- 不存在、不匹配或读回异常时持久化 unknown；保留原条目及排除键，不重发原命令，
  允许其他新邮件继续。取消、过期均不调用 submit 恢复原任务。

没有新增恢复 API、wire/schema、权限、依赖或数据库迁移。缓存受理仍由原宿主端口校验；
读回不能赋予出机权限，未知操作不能自动重试。

## Linux 验证

固定 Node 24.15.0 / npm 11.12.1，隔离树独立 npm ci（ignore-scripts），仅构建 contracts。
未扩大 Runtime build 或运行全仓检查。

同一最终测试对原 host（精确 git show 基线源码，生成到忽略目录）先红，再对修复源码变绿：

| 命令/目标 | 结果 |
| --- | --- |
| `node --test .cache/pr503-orphan-recovery/red.test.mjs`，原 host | exit 1；12 项，8 pass / 4 fail / 0 skip |
| `node --test apps/desktop/test/mail-review-host.test.mjs`，修复 host | exit 0；12/12 pass，0 skip |
| `node --check apps/desktop/electron/mail-review-host.js` | exit 0 |
| `git diff --check` | exit 0 |

新增四类回归：缺原任务时 unknown 持久化并重建 host、24h 后重建且新信继续；
匹配的已提交原任务恢复 taskId/缓存并仅应用一次；namespace/tool/version/arguments/deadline
不匹配拒绝；原任务取消/到期及查找异常均无重发、通知或错误应用。

持久化测试是 **Synthetic**：显式 fixture 使用 structuredClone 保存 trusted-host-state，
重建 host 读回，任务/邮箱/通知也均为 fixture。它验证生产 host 的恢复消费路径，
不宣称生产 SQLite 重启、真实邮箱、AgentArts、Windows 横幅或实体设备通过。
没有模型/真实账号调用。PR 当前旧 Windows 失败与此局部修复分开记录。

忽略目录日志 SHA256：

- red-pinned.log：`7f738b7ac2b7eff7c36f3e1b5e021234ec13d3a3baf03e47d38face208255aea`
- green.log：`c08f359f7e12deba4a059d1f7941e6e09710b202b60cf5d15e8d6ee89f59c5c5`

## 旧 Windows 失败定位（只读）

成功通过正常 run logs ZIP 读回 [Foundation 39964718003](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39964718003)，
该 run 绑定原 #503 head。Windows job `120452363717` 的完整检查失败于：

- `apps/desktop/test/laya-controls.test.mjs:157`：
  `artifact identity changes require explicit stop before another start`。
- 162 行预期 `identity_changed`，实际 `ready`。
- Desktop 总计 1863 项：1854 pass / 1 fail / 8 skip。

这是已确认的旧 CI 缺项，未在本局部补丁内修复，也不是 #511 的两处中文展示断言问题。
ZIP 位于忽略目录 `pr503-run-logs.zip`，SHA256
`e7be995b813e112a798931cc253d2ab4e3145f42a1dcc421ccd6ce769264c917`。
后续仍须定位该身份变更消费问题、整合主线及确认新提交的必要 CI；本补丁不表示 #503 已可合并。
