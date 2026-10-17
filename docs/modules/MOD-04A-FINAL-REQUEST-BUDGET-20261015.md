# MOD-04A：最终可见请求与预算边界

- Profile：huawei_ict_agentarts；负责人：goo122。
- 状态：in_progress；接口：provisional；G04 首个纵向增量。
- 实现基线：PR #358 / fae47a96；工作树：`.worktrees/goo122-final-request-budget-20261015`。交付前 #358 → #357 已合入 #351，交付基线随依赖收拢为 #351。

## 问题与改动

旧版本实际离线复现：Provider 计量包含 reasoning_effort:none 的 JSON，镜像 fetch 才改写为 chat_template_kwargs.thinking:false，两个正文不一致。

1. 镜像宿主按原有精确 endpoint/model 白名单显式选择版本化 requestFormat。
2. Provider 在序列化之前应用原有兼容转换。计量前、读凭据后复查、最终传输使用同一份不可变 JSON；fetch 只保留 redirect:error。
3. requestFormat 同时进入模型能力、预算声明和子任务恢复身份。即使没有计量器，格式改变或移除也不能消费旧任务许可。
4. Runtime 公开工厂透传格式，Pangu 明确拒绝。没有 wire Schema、迁移、新依赖或新模型入口。

方案与兼容性见 [ADR-0028](../adr/0028-final-visible-request-body.md)。未配置格式时保持原 Provider 行为；不按品牌推断原生能力。

## 验证记录

- 独立工作树 `npm ci --offline --cache .cache/npm` 与根 `npm run build` 退出码 0；使用原锁文件和已有包缓存，无依赖变更。
- 最终三文件定向测试 28/28：模型预算、镜像 Huawei 兼容传输、Runtime 子任务绑定；0 跳过、0 失败。
- `npm run check` 退出码 0：37 个汇总块，共 3100 项，3069 通过、31 跳过、0 失败；包含架构、Schema/生成类型、类型检查、工作区与集成测试。原生 Job helper 独立构建后注入，PowerShell/OpenSSL 使用现有工具链。
- `npm run test:native-reasoning-smoke --workspace=@personal-agent/desktop` 退出码 0：实际 Electron main/preload/IPC/Admin，合成配置的加密、重启、目的地重置、移除及未计量显示通过，模型调用 0。
- 真实本机 HTTP 回环服务收到的 Unicode/转义/思考开关正文与两次计量正文逐字一致。超限在凭据读取及传输前拒绝；SQLite 重启后相同格式可恢复，格式增加/移除保持原 grant 未消费。
- `git diff --check` 与受影响文档相对链接检查通过。日志位于忽略的 `.cache-final-budget-*.log`，不提交测试数据或截图。

所有模型计量值、凭据和服务回答为显式合成数据；回环 HTTP 是真实本机传输，不是 MaaS 连通证据。远程模型请求、AgentArts 调用、原 Vault 访问均为零。

## 完整模板验证的准确边界

上游官方 [tokenizer 文档](https://github.com/deepseek-ai/deepseek-recipe/blob/8cadfede7063c896b944e7bae05daa3549ae97ea/docs/tokenizer.md) 的完整流程是 ChatCompletionRequest.convert(ConversionOptions()) 后用 DeepseekV41Encoding 编码 conversation。此前 raw-text 词表核验不等于这个完整流程，也不证明 MaaS 采用相同转换。

本次再次检查现有 Docker 引擎，实际返回 `dockerDesktopLinuxEngine` 管道不存在，无法运行受支持的 Linux recipe 验证。没有启动容器、部署、修改 Docker/WSL 配置或调用真实模型。完整官方模板、供应商特殊 token/工具/续答/思考映射及 MaaS 对齐仍未验收，生产计量继续保持未注入/未计量，平台隐藏上下文 unknown。

## 后续与交付

1. 在受支持环境固定官方 recipe、完整模板与 tokenizer，验证完整公开合成请求向量；无需私人内容或云模型调用。
2. 模板经验证后，接入受信生产计量器与精确窗口配置；云端模板/usage 对比按恢复后的独立授权执行。
3. 用户已授权本包提交、普通推送和创建独立 PR。#358 与 #357 已依次合入 #351；新 PR 指向包含它们的 #351，避免交付到已关闭的父 PR 分支。上述 3069/31 为原实现基线的本地结果，同步后的门禁另行记录。实际提交、远程检查与非作者批准以当前 Git/GitHub 为准；整个 MOD-04A/F27 不因本包转为 done。
