# ADR-0026：Competition 可见模型请求预算

- 日期：2026-10-14
- 负责人：goo122
- 状态：proposed，待非作者评审与集成
- Profile：`huawei_ict_agentarts`；依赖 ADR-0024/0025

## 决定

沿 Competition 已有 OpenAI compatible Provider，在文字工具协议包装之后生成一次不可变的请求 JSON。受信宿主可注入同步、确定性的模型专用输入计量器，读取完整序列化请求并计算消息、可见系统提示、工具目录、回执和模型提示模板的输入占用。计量器须绑定模型、tokenizer 和宿主配置版本；窗口容量必须显式配置，不使用历史默认 32k 作为预算依据。

输出预留既是缺省输出上限，也是本配置允许的最大输出。调用方可收窄，不能扩大；按原生配置只发送 max_tokens 或 max_completion_tokens 中的一个。每次调用在读取凭据前校验输入与输出总额，凭据等待后复测；计数漂移拒绝 I/O。序列化请求在等待期间不再从可变调用参数生成。无计量器时结果明确 unmeasured，既有路径保持兼容。

计量范围为 provider-body，平台隐藏提示和宿主 fetch 的后续改写均未知；可信计量器收到 JSON 不表示把 JSON 字符数当作模型 token 数。不安装猜测适用的 tokenizer，不把离线合成计数器称为精确模型验收。

公开 host-only ModelCapabilities 保存不含函数的预算版本描述，Competition 子任务沿原 subtask-model-binding 检查点比较它；恢复前配置、tokenizer、窗口和预留变化拒绝旧提案。ModelResult 仅附计量元数据，不新增私人正文持久副本，沿原 Agent 检查点和逐事实任务删除链路处理。此增量不替代 Agent 原有累计 usage 预算，也不改变 cloud goal 的 16000 UTF-16 上限。

## 兼容与后续

不新增 wire Schema、capability、数据库迁移、依赖或 Local 执行入口。Pangu 工厂拒绝此配置，不能静默忽略。仅完成共享 Provider 与 Competition 辅助模型的纵向增量；自有镜像、真实模型/tokenizer 配置、Desktop 展示、平台隐藏上下文和跨角色累计预算仍待后续工作包。真实云端验收维持暂停。接口为 provisional。
