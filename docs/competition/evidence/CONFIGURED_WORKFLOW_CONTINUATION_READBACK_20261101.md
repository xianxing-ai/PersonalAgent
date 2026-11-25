# 当前工作流最终回执的只读绑定（2026-11-01）

Competition Profile。F05 最终发送前需要重读原来源；真实 Runtime 执行揭示图完成后 `competition-loop.pending` 已清除，原 `readConfiguredWorkflowBinding` 因而无法在最终 continuation 的发送许可中读取该图。此前只有元数据检查的 worker 没有触发这个缺口。

本次仅扩展原公开只读入口：原 pending 路径保留；没有 pending 时，只接受当前 confirmed continuation 对应、位于原 receipts 最后一项且唯一的原 worker 回执。原 proposal、selection、result、task/session/deadline、配置摘要、版本、描述符、原图 settled 状态和全部已确认工具执行仍逐项核对。RuntimeApplication 从注册 worker 取得唯一非空绑定，多匹配拒绝。旧 continuation、任意历史任务或同一任务中其他图不成为来源；不新增 dispatch、恢复、授权或调度行为。

兼容性：返回类型与方法参数不变。旧调用方只增加上述当前最终回执可读阶段；取消、期限变化、原证据污染继续拒绝。没有数据库迁移，也不修改历史记录。

本地验证：Runtime build、架构门禁 3/3、通用 configured worker 12/12（真实 Runtime/Policy/ToolGateway，Synthetic 图与工具）；覆盖原 pending 消费方、当前 continuation、重复/旧/跨图/外来 task/session、selection/result/revision 污染、取消与期限变化，原工具仅执行一次。F05 实际文件/SQLite 全链另见 F05 Evidence。以上不构成真实 AgentArts 或独立人工验收。
