# ADR-0027：Competition 模型预算展示与离线 tokenizer 核验

- 日期：2026-10-14；负责人 goo122；状态 proposed
- Profile：huawei_ict_agentarts；基线 #357 / ADR-0026

沿现有 modelApi.state 与 Admin snapshot 展示共享 Provider 的 requestBudget，不创建任务事件或 wire DTO。可信宿主只接受与当前网关声明一致的 provider-body 计量元数据，复制固定字段；未知/无效数据明确未计量。显示最后一次发起的调用结果，较早调用迟到不能覆盖它；开始调用或失败时清除旧值，配置撤销和释放一并清除。元数据仅在内存中保留，不写模型加密配置、日志或新数据库，重启恢复为未计量。

Renderer 使用 textContent 显示可见输入、输出预留和窗口。平台隐藏上下文仍未知，保存配置不运行模型、不安装 tokenizer。预算单独刷新，不能因后台模型调用清空用户正在编辑的配置草稿。改变目的地后旧计量不再显示。

官方 DeepSeek recipe 提供 V4/V4.1 模板及 tokenizer；锁定上游提交和文件 SHA-256 后，只用公开合成消息作本地离线核验。官方 Python 0.1.1 分发没有 Windows wheel，本机 Docker 引擎未连通，因此当前只在项目忽略目录使用 Hugging Face tokenizers 0.23.1 与官方词表做 Windows 原始文本分词核验，不新增 Python/Rust/OpenCV 生产依赖。原始文本分词不等于完整请求模板计量，也不证明 MaaS 同名部署采用完全相同模板。生产 meter 未注入时始终 unmeasured，不用其他模型 tokenizer 或字符估算替代。

无 wire Schema、依赖、数据库迁移或新授权能力。原 Vault 不读写、私人记忆只逐条确认，云调用 0；真实端点/tokenizer 匹配与生产打包待后续独立验收。接口 provisional，完整 MOD 不转 done。
