# F08 / F21 / F28 Desktop 实际接线

目标为 Competition Profile，延续 PR #531；本记录不代表真实账号或整图云验收通过。

- F08：原 Runtime 邮箱来源与私密 Memory 独立命名空间接入原 business worker；管理页可选择仍在处理的原任务、读回来源、逐条确认摘要与有效期、撤回或删除原版本。Main 只接受已登记原对话任务，拒绝 Renderer 自报内部图/session。确认经原 AuthorizationIntent，正文不复制入授权记录。原 Plan 执行读取接入精确私密 Fact 版本。
- F08 删除读回范围为原私人 Fact 全历史和绑定图副本；不声称删除邮箱原记录或历史备份。旧 Vault 备份/恢复检查遇到邮件来源或删除标记时明确拒绝宣称完整覆盖。
- F21：Main 注入同一个 referenceHost、nativeExecutionHost、AuthorizationIntentHost 和 Runtime；固定只读 MCP 探测工具与 worker 注册进正式配置图。原生隔离和独立启用证据见 F21_REFERENCE_PROBE_WIRING_20261101.md。
- F28：Main 延迟绑定原辅助模型配置与 guarded ModelGateway，每次模型请求使用独立 developer.export 确认，绑定任务、节点、精确请求和模型目标；不复用 AgentArts 出机许可。当前候选证据与未测边界见 F28_ORIGINAL_MODEL_CANDIDATES_20261101.md。

新增必要检查为 Main 来源权限入口一例、旧备份覆盖拒绝一例及 JS 语法检查，均通过。各工厂已有必要实际 Engine 用例，不重复运行旧矩阵。2026-11-01 统一 `npm run build` 通过，日志位于本机忽略目录 `.cache/wiring-batch-build-20261101-f08-f21-f28.log`；最终提交的 CI 另记实际结果。F03 来源变化后的 Competition 重审、F10、F28 可选工具探索及真实服务验收仍继续推进。
