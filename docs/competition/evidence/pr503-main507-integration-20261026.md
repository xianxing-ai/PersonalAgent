# PR #503 与已合并压缩主线的局部整合

2026-10-26 UTC；Profile `huawei_ict_agentarts`。开始时本独占树干净且 HEAD 与远端
#503 均为 `0cb7e614381ceb3ca301dd11732d6653cc9e53b1`，canonical main 已真实包含
#507，精确为 `78bbb63a4e36590e364b8b18c28aaf67d0f82832`。从前者普通合并后者，
不提前合入尚未进 main 的 #511。不推送、批准或操作真实账号，由 root 统一交付。

## 处置与边界保留

唯一文本冲突是接口目录同为 10/23 的新增条目。最终顺序：10/25 同对话语音 →
10/23 会话压缩 → 10/23 邮件云复核 → 10/21 connector.watch。
四段与各自 parent 原文逐段比对精确保留：摘要缓存不是出机授权，邮件仍核原来源/目标/期限，
unknown 不自动重发，语音 accepted 不代表真实播放。

全部源码正常自动合并，无整侧覆盖；`main.js` 保留原邮件/Live 接线并增加原压缩命令检查，
`runtime-application.ts` 同时保留 host mail.review 路径及主线压缩缓存/命令路径。
两个 context-compaction 实现文件与 main 一致；P2 host 源码与测试相对合并前未改。
未改锁文件、CI、生产 Laya 或先前任何红日志。未重新机械同步后续主线。

## 先构建，再一次组合

固定 Node 24.15.0 / npm 11.12.1；本树依赖 dist 已由前轮独立构建。
仅运行实际源码变化的 `npm run build --workspace=@personal-agent/runtime`，exit 0。
成功后执行：

```sh
node --test --test-concurrency=1 \
  apps/runtime/test/context-compaction.test.mjs \
  apps/desktop/test/mail-review-host.test.mjs \
  apps/desktop/test/mail-review-integration.test.mjs \
  apps/desktop/test/harness-main-composition.test.mjs \
  apps/desktop/test/model-api-controls.test.mjs
```

exit 0：100/100 pass，0 fail / 0 skip。覆盖压缩命令不进主模型/子任务、摘要来源/配置/
许可变化失效、原上下文与工具续轮、实际 Main/Harness 装配、邮件孤立绑定不重发及缓存结果消费。
`node --check apps/desktop/electron/main.js` 与 `git diff --check` 通过。
未重跑前轮已通过的 65 项整组，也未执行全仓 check。

日志在忽略目录 `.cache/pr503-main507-integration/`，SHA256：

- runtime-build.log：`f12efe3b91f5fb80470dcf208852b80690176834cb51f584201062daf5149855`
- combined.log：`719dcf393a40b853c9152340870893a51c73ac0f0327dc90f8b480ddfd40b1d4`

新证据为 Linux 局部 Synthetic 组合。两项邮件集成使用真实本地 Runtime/SQLite 和合成邮件，
未注入孤立提交崩溃窗口；P2 恢复仍为 structuredClone fixture，不能提升为真实 SQLite 崩溃验收。
历史 Windows/邮箱/云端实际回执继续绑定原版本，不冒称本次整合已真实验证 Windows、账号、
AgentArts、语音音频或新部署。最终 head 的正式 CI 仍须另行确认。
