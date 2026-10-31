# 生产接线：仍显式 unavailable 的面（2026-10-28）

分支：`codex/zemeng-production-wiring`。Profile：`huawei_ict_agentarts`。

| 面 | 接线状态 | 启用条件 |
| --- | --- | --- |
| proactive controller | Desktop 已注入 `createDesktopProactiveControllerHost` | 默认可用 |
| voice final → 审批卡 | Live `onWaitingApproval` + bridge | Live 遇到 waiting_approval |
| 离开/归来 UI | 设置页 `proactive.workflow.control` | 用户填写 taskId |
| cloudPersistentHost | **未注入** | 有真实云持久 port 后再传；当前关机后继续 unavailable |
| workflowShadowRelease | 仅当受信 configurationPort/acceptance 存在才注入 | 缺 port → F23 工具不注册 |
| observation AK/SK | 可选安全存储 `agentarts-observation-v1` | 缺则观测 unavailable，不降级 Bearer |
| voice.final_transcript / F02_N03 | adapter factory + Runtime/Desktop 可选注入已接；`resolveDesktopVoiceFinalTranscript()` 无 port 时工具不注册 | 仅当 Desktop 注入受信 final-only `readFinal` 才 available；缺 port → 明确 unavailable，不静默 Fake ASR |

电脑控制由其他对话负责，本分支不改 `computerControlLease` / windows-host。
