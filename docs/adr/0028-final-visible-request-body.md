# ADR-0028：在 Provider 内完成可见请求格式转换

- 日期：2026-10-15
- 状态：proposed
- Profile：huawei_ict_agentarts

镜像原有 fetch 包装器在 Provider 序列化与预算计量后，将 MaaS DeepSeek 的 reasoning_effort:none 改成 chat_template_kwargs.thinking:false。因而原计量正文与实际传输正文不同。

改为可信镜像宿主显式选择版本化 requestFormat，Provider 在唯一一次序列化之前应用既有转换。fetch 包装器只拒绝重定向，原样传输正文。默认 Provider 不推断格式；现有目标/模型白名单由镜像宿主维护，不扩大供应商能力声明。

requestFormat 进入 provisional 模型能力、预算绑定与 Runtime 子任务恢复身份。格式增加、移除或变化均使旧提案不可恢复，检查发生在消费原授权之前。旧配置未声明格式时保持兼容。没有 wire Schema、数据库迁移、新依赖或新的模型入口；不新增 Local Profile 行为。

计量器仍需明确注入，并使用匹配的官方完整模板；词表原始文本核验不构成完整请求计量或 MaaS 匹配证据。平台隐藏上下文保持 unknown。注入 fetch 是可信传输边界，不得再次改写已计量正文。
