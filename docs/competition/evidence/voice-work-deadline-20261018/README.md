# Live 原工作等待期限修复（Local / Synthetic）

基线：#406 `2e45faa5885ed5370eaa654aa0802f79f7c69450`。失败事实来自 Foundation `39170582755` / job `117802593424`：`live-voice-recovery.test.mjs` 的 `P2 task.get late result past request deadline cannot escape as a successful reply` 未得到预期拒绝。此项是实际生产期限回归，不是 Windows 计时或旧 fixture 应删除的断言。

`requestWork` 的本轮工作期限为原 `workDeadline = min(sessionDeadline, start + 120s)`。消费者失败后的 fallback task.get 曾改用 session 剩余期限加五秒，且只重核 session，导致原工作窗过期后仍可返回迟到成功结果。修复让 fallback read 仍受原 workDeadline 约束，并在读取前、读取后及异步原审批摘要完成后重核工作期限；只有通过检查才将 receipt 改为 result_returned。

本轮等待过期会拒绝迟到结果，但保留已受理的原 taskId、awaiting_result receipt 及 Runtime 后台执行。用户接续时，`wait_for_task` 以新的只读等待窗查询同一原任务；不取消、重提或自行批准。新 callId 的完全相同 pending goal 仍沿原 task 续读，unknown 提交与迟到真实受理回执的保守行为不变。

保留原 P2 到期断言，并检查仅一次 submit/一次原 task read、原 receipt 未错误标成功。新增一个异步审批摘要跨原工作期限的定向控制；原 Host 中“过期后直接回读并外返”的新 fixture 改为明确到期拒绝、随后显式 wait_for_task 读回同一原 task，保留无重复提交断言。

独立 worktree `.worktrees/voice-windows-fixture-20261018`，Node `24.15.0`，仅运行两个精确文件：

```sh
node --test apps/desktop/test/live-voice-host.test.mjs apps/desktop/test/live-voice-recovery.test.mjs
```

**43/43 通过，0 失败、0 跳过**，报告耗时 `1428.547053ms`。原日志 `.cache/wiring-20261018/voice/live-work-deadline-test.log`；冻结元数据同目录 `live-work-deadline-freeze.json`。没有扩大测试到全仓、运行真实设备/音频、真实云或 Laya；此证据不证明原生模型语言质量、端到端延迟或后台主动播报已实现。
