# Issue #443 云端续接失败后 competition-cloud-inflight 释放回归

Profile：`huawei_ict_agentarts`。从 main 干净重建，不带 #531/#535/#543 堆叠提交。生产代码未改：修复已在 main（#448，`e2e54f6b`）。

## 保留的新覆盖

`apps/runtime/test/subagent-termination-reconciliation.test.mjs` 已经覆盖：子任务确认读后的 WSS 终态失败、历史 `legacyHold` 父任务对账、直接取消子任务并释放 inflight、手工写入 `competition-cloud-unknown` 后拒绝对账，以及仍处于 `waiting_reconciliation` 的 SQLite 重开。

本文件只保留该套件没有的路径。夹具按 main 当前 WebSocket 帧读写 `frame.payload.query`，不依赖堆叠链上的 `tests/helpers/synthetic-agentarts.mjs`。

| 用例 | main 上尚未覆盖的点 |
| --- | --- |
| 有效投影后的 WSS 终态 | 子任务 `research.search` 回执与 `tool-result` 缓存保留；inflight/received 释放为 null；父任务自动续接并在下一次云调用终态失败，父 inflight 同时释放（调用次数 4），而不是停在 `waiting_reconciliation` 等人工对账 |
| 续接断开 | `socket.disconnect()` 产生未知结果：子任务保持 `waiting_reconciliation`，写入 `competition-cloud-unknown`，inflight 仍在；对账拒绝 `RESULT_UNKNOWN` |
| 已释放 inflight 的 SQLite 重开 | 非 legacy 路径上，子任务已是 `failed` 且 inflight 已是 null；重开数据库后 null、`failed` 与已确认的 `research.search` 都还在 |
| 父任务成功续接 | 子任务终态失败并释放 inflight 后，父任务云续接成功，父任务 `succeeded`，摘要为观察子任务结果后的完成文本，父 inflight 为 null |

未再复制的用例：历史 `legacyHold` 父任务对账释放 inflight，以及直接对子任务对账。二者分别对应现有用例 `historical confirmed-read child and its original pending parent terminate expired locally` 与 `direct child cancellation reconciles its original terminal error without resuming the parent`。

## 本次在 main 上的检查

- `npm run build`：通过。
- `node --test apps/runtime/test/issue443-cloud-inflight-release.test.mjs`：4/4 通过。
- `node --test apps/runtime/test/subagent-termination-reconciliation.test.mjs`：42/42 通过。
- `npm run check:architecture`：3/3 通过。

## 未做项

未改 Renderer。未连接真实华为云，也未读取凭据。
