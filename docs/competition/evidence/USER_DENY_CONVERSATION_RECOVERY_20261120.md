# 偶发拒绝授权不杀对话（本地增量）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/zemeng-owned-image-remediation-20261119`。

## 行为

- 对话 / Competition 任务上，用户拒绝**单次**工具授权：任务不再直接 `cancelled`。
- 协调环把拒绝回灌为 `continuation.result = {kind:'not_performed', reason:'user_denied', ...}`，云端下一轮可改用其他工具或用已有信息作答结束本轮。
- 一次性宿主工具（`host-tool-intent`）拒绝仍取消该宿主任务，行为不变。
- `CONTINUATION_TOOL_PROMPT` 明确：`user_denied` 不得伪造成功、不得同参重提。

## 验证

```text
npm run build --workspace=@personal-agent/runtime
node --test apps/runtime/test/user-deny-conversation-recovery.test.mjs \
  apps/runtime/test/competition-tool-export.test.mjs \
  apps/runtime/test/host-tool-task.test.mjs
```

未宣称：真机桌面点拒绝卡的端到端手点回执。
