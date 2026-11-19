# MOD-18 H3 候选试用与隔离修复边界验收记录（2026-11-07）

- **目标 Profile**：`huawei_ict_agentarts`（Competition Profile）
- **所属模块**：MOD-18（`@personal-agent/coding-tools`）
- **隔离工作树**：`D:/PersonalAgent/.worktrees/opus-coding-f15-f20`（分支：`codex/opus-coding-f15-f20`，基线：`main` `855a90c4`）

## 1. 主要改动
- `packages/coding-tools/test/harness-trials.test.mjs`：新增 6 项 H3 候选试用（`coding.repair.trial`）、未决恢复（`coding.repair.reconcile_trial`）与采纳准备（`coding.repair.prepare_adoption`）边界回归测试：
  1. 拒绝重复候选路径与自引用组合；
  2. 拒绝不一致的 `trustedBinding`；
  3. 恢复时强制要求 `read` 权限与原始持久化会话；
  4. 采纳准备在进入主会话前拒绝被篡改的选中试用回执；
  5. 拒绝试用后的配置漂移，且已恢复的采纳绝不重放；
  6. 拒绝在主会话新鲜重验期间发生变更的选择。

## 2. 验证结果
- `node --test packages/coding-tools/test/harness-trials.test.mjs packages/coding-tools/test/isolated-repair.test.mjs`：**34/34 passed**（22 + 12，exit 0）。
- `npm run check:architecture`：**3/3 passed**（exit 0）。
- `git diff --check`：**洁净通过**（exit 0）。
