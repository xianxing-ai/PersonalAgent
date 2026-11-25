# 前端增量复查与观测表单修复（2026-11-19）

- Profile：`huawei_ict_agentarts`；模块：MOD-11/13 前端设置消费。
- 基线：`origin/main` `ac68fbf9`（已合并 #671）。
- 工作树：`.worktrees/frontend-audit-20261119`；分支：`codex/frontend-audit-20261119`。
- 范围：复查 #671 的观测凭据表单；本记录不代表整个 #379、全部 PR 或真实平台验收完成。
- 保留根工作树的 README 修改和其他活动分支；未修改 Gemini 的返修分支。

## 问题与最终行为

`agentarts-controls.js` 原先仅在 Application ID 输入为空时回填宿主快照。因此用户主动清空 ID 后，后台刷新会恢复旧值；未编辑的非空字段又不能跟随宿主变更或撤销。显式 `observation: null` 还会在读取状态时抛错。

观测表单现在跟踪未保存编辑。后台快照保留草稿（包括空字符串），未编辑时同步最新 ID；保存或撤销获得确认后，使用该操作读回重置草稿状态和字段。失败继续保留原草稿及可重试凭据，不把后台快照当成该操作的成功回执。空观测快照按未配置展示。

只修改 Renderer 私有表单状态；沿用 `agentarts.observation.configure/revoke`，无公共协议、依赖或数据库迁移，不改变真实账号授权及 Competition/Local 行为。

## 验证

- 先添加回归测试，原实现 17 pass / 2 fail，复现宿主更新不生效及空草稿被覆盖。
- 修复后 `node --test apps/desktop/test/agentarts-controls.test.mjs apps/desktop/test/agentarts-observation-config.test.mjs`：24 pass / 0 fail。
- `npm run typecheck --workspace=@personal-agent/desktop`：通过（该脚本实际执行 JavaScript 语法检查）。
- `git diff --check`：通过。
- 修复后验证使用本机 bundled Node `24.22.3`；仓库要求 `24.15.x`，未据此宣称精确版本 CI 验收。首次复现使用默认 Node `20.19.5`。
- 测试为合成 DOM、Fake IPC 及临时安全存储；没有调用真实 AK/SK、云模型或平台账号。
- 未启动应用；未运行 Electron GUI smoke、整仓构建或全量检查。本增量只涉及设置表单私有状态，不变更窗口、IPC、Runtime 或工作区装配。实际桌面交互与规定 Node 版本 CI 仍需后续验证。

## 远端返修定位（只读快照）

核对时当前账号为 `2511375597-lab`，名下没有开放 PR；#671、#670、#668、#667、#666 均已合并。开放 PR 的审核门禁失败和技术 CI 失败应分别处理，不能靠修代码代替独立批准。

- [#531 Windows CI](https://github.com/xianxing-ai/PersonalAgent/actions/runs/44469170191)：提交 `76486710`，日志包含 Desktop `authorization-runtime-integration.test.mjs:239`、`f02-live-capture-evidence.test.mjs:8` 失败，以及 Runtime `task-activity.test.mjs:72`、`user-assistants.test.mjs:56` 失败。后两项期望 `waiting_approval`，实际 `failed`。
- [#641 Windows CI](https://github.com/xianxing-ai/PersonalAgent/actions/runs/44469293444)：提交 `913cc765`，日志包含同名 Runtime 审批状态失败。尚未完成所有失败项归因；不能据同名测试推断两 PR 根因完全相同。
- #618 的技术检查通过，但仍有 `CHANGES_REQUESTED`；#642、#645、#615 的技术检查通过，仍需独立评审。以上为读取时状态，后续以 PR 最新提交和检查为准。

## 交付状态

本次改动在独立隔离工作树 `.worktrees/frontend-audit-20261119`（分支 `codex/frontend-audit-20261119`）完成验证并推送 PR，等待非作者审查与 GitHub 技术 CI。整个 #379 及真实平台/设备验收仍保持原限制。
