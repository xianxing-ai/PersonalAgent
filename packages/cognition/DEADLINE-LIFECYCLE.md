# ProactiveDecisionService 的独立期限生命周期

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

旧服务只依赖 `AbortSignal.timeout`。永不 settle 且不持有其他句柄的 model Promise 可能随事件循环退出，调用方得不到约定的 TIMEOUT。无其他句柄的 CLI 实际观察到 unsettled top-level await；仅增加诊断 keep-alive 后才读到 TIMEOUT。#261 CI 文件级失败与此相符，但其日志没有内部错误，本地 Node 24.19.0 与 CI 24.15.0 不同，不能宣称已确认那次 CI 根因。

服务改为有引用的 deadline timer 与 AbortController，保持原最长 30 秒及调用方 deadline。finally 清理 timer 和 caller abort listener；已有 chooseBeforeAbort 清理内部 listener。已取消请求在启动前拒绝，运行中取消保持 CANCELLED，deadline 保持 TIMEOUT。正常结果、模型失败和生命周期拒绝均释放计时器，不增加模型、授权、调度或云调用。

原 deadline 单例增加三个无其他句柄的独立子进程检查：真实 TIMEOUT/exit0、调用方取消 CANCELLED/exit0，以及正常完成后直接退出。测试不创建 keep-alive；子进程保护超时只用于发现泄漏，完成/取消请求期限为 10 秒，保护期限为 5 秒，因此遗留 referenced timer 不能通过。

此包只涉及旧 ProactiveDecisionService。新 Goal 的 LayaActionChoiceService、阈值、共享 Runtime 和真实验收槽不变。必要验证仅 cognition 最小编译、原 deadline 单例及无句柄 CLI 前后对照；具体结果随提交交接，不将此修复当作云或新 Goal 验收。

## 本次必要验证结果

- P8 明确交接短槽后，本工作树 `node node_modules/typescript/bin/tsc -p packages/cognition/tsconfig.json` 通过，工具 wall 4.148 秒；只更新本工作树 dist，没有安装或重编依赖。
- `node --test --test-name-pattern='deadline bounds' packages/cognition/test/laya-decision.test.mjs`：1/1 通过，单例 261.0649ms、Node 总耗时 381.551ms。包含原超时/取消检查，以及 3 个无 worker 句柄子进程的 TIMEOUT/CANCELLED/正常退出断言。
- 同一 `.cache/p5-deadline-probe.mjs` 不设置 keep-alive，修前输出 unsettled top-level await、未 TIMEOUT；修后实际输出 TIMEOUT、exit0。未修改该诊断程序来保活。
- `git diff --check` 通过；本地 Node 24.19.0。没有下载 CI 24.15.0、全包/全仓测试、新 Goal 重测、真实模型或云调用；不能据此声称 #261 旧 head 全绿或真实 MVP 完成。
- 检查完成即释放短槽，P8 后续 Runtime 与真实 Goal 验收独立继续。
