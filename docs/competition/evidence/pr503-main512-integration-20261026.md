# PR #503 与文字语音主线的局部整合验证

2026-10-26 UTC；Profile `huawei_ict_agentarts`。在既有独占隔离树
`pr503-orphan-recovery-20261026` 从 `bf2911bf3d3f061c3bf77c9a54aef96b0db4670f`
普通合并 canonical main `ad7276253ea352d3e4c4a34c745f46bd5a8f8836`（包含 #512）。
开始前本树干净，远端 #503 head 仍为 bf2911bf；没有新增接手/停止声明。
本包仅合并及本地验证，不推送、批准或操作真实账号；由 root 统一交付。

## 合并处置

- 生产源码全部正常自动合并，包括 `apps/desktop/electron/main.js`；
  `conversation-main-actions.test.mjs` 也自动合并。未选整侧覆盖或重写生产行为。
- 唯一冲突为 `docs/interfaces/CURRENT_INTERFACE_CATALOG.md` 的新增条目位置。
  按已有日期锚点排列：10/25 同对话 speakText → 10/23 mail.review →
  10/21 connector.watch。三段逐段与各自 parent 原文比对，全部内容精确保留。
  邮件读取许可、来源/目标/期限、unknown 不重发及语音 accepted 不代表播放等边界均保留。
- AGENTS/CONTRIBUTING 在两 parent 间没有变化；不改锁文件、CI、生产 Laya 或已存原失败日志。

## 本树构建及顺序验证

固定 Node 24.15.0 / npm 11.12.1。本树原先仅有 contracts dist，按 runtime/client
实际 workspace 依赖闭包顺序构建 25 个所需 workspace，退出 0。
未借用其他工作树 dist，未执行全仓 check。

初次较早的 host/main/live 分组中，mail/Laya/main-actions 均通过，但 Live 文件尚未
加载到本树未生成的 `@personal-agent/runtime/dist/application.js`，故 ERR_MODULE_NOT_FOUND。
该次为前置缺失，不能算 Live 通过；原失败日志保留。没有为此修改测试或断言。
闭包完整成功后，统一顺序运行以下精确组合一次：

```sh
node --test --test-concurrency=1 \
  apps/desktop/test/mail-review-host.test.mjs \
  apps/desktop/test/laya-controls.test.mjs \
  apps/desktop/test/laya-local-host.test.mjs \
  apps/desktop/test/conversation-main-actions.test.mjs \
  apps/desktop/test/live-text-output.test.mjs \
  apps/desktop/test/panel-event-readback-order.test.mjs \
  apps/desktop/test/panel-task-progress.test.mjs \
  apps/desktop/test/panel-task-refresh-order.test.mjs \
  apps/desktop/test/mail-review-integration.test.mjs
```

exit 0：65/65 pass，0 fail / 0 skip。包含原 mail/Laya 32 项、Runtime 接受后才绑定 Live、
取消/切换/晚到结果、panel 实际刷新/事件/终态优先，以及真实本地 Runtime/SQLite/授权宿主
消费 Synthetic 邮件固定结果与额外字段拒绝。`node --check apps/desktop/electron/main.js`
及 `git diff --check` 均通过。

这两项 SQLite 邮件集成不注入孤立 submitting 的崩溃窗口，不能升级本次 P2 恢复的
验收等级；P2 持久恢复仍仅由原 structuredClone trusted-host-state fixture 验证，属于
Synthetic，尚未做生产 SQLite 崩溃恢复验收。

忽略目录 `.cache/pr503-main512-integration/` 日志 SHA256：

- build.log：`f66327646b252c7904f30076b105f4ad9bb3334504daaa39dec0fc887f9754aa`
- host-main-live.log（前置缺失失败）：`9692752ac215c2f321f54730062fd88bfb4041ab928f54bbd807a541f097e1f0`
- combined-green.log：`da43520623bd80d18ea5e243ee739fcb7a103c235cdcef693fd2de5ddfcd7088`

这些是 Linux 本地局部集成证据。邮件/模型/通知数据明确 Synthetic，Live 不调用真实云服务。
原 Windows/QQ/Laya/AgentArts 的历史真实验收继续绑定原版本，不冒充本次组合已实际验证
Windows 桌面、真实邮箱、真实云音频、扬声器或新镜像部署。新 head 正式技术 CI 仍须独立读回。
