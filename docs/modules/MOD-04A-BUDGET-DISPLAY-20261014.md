# MOD-04A / F27：预算展示与 tokenizer 离线核验

- 负责人 goo122；Profile `huawei_ict_agentarts`；状态 in_progress，接口 provisional
- 基线 #357 `e60d45e3df9b56365c816726d2bf53c1ab77f643`
- 工作树 `.worktrees/goo122-budget-telemetry-20261014`；分支 `codex/goo122-budget-telemetry-20261014`
- 实施日期 2026-10-14～15；方案 [ADR-0027](../adr/0027-model-budget-display.md)

## 实现及边界

Desktop 可信模型宿主沿原 `modelApi.state` / Admin snapshot 接收共享 Provider 的 requestBudget。只有范围、隐藏上下文状态和网关预算声明一致、计数合法且未越界的结果才能显示；仅复制输入计数、窗口、输出预留与本机配置引用。无效/缺失计量显示未计量，不接收额外正文、错误、密钥或外部自报版本。

每个模型只展示最后发起调用的有效结果，较早的迟到结果不能覆盖。调用开始清除旧计数，失败、取消、配置修改/撤销及释放不恢复旧值；重启回到未计量。新增 Map 只在内存中，既有加密配置不写入采样元数据，也不新增任务/记忆存储或私人正文副本。

Renderer 通过 textContent 显示可见输入、窗口、输出预留和隐藏上下文未知。Admin 将预算变化与配置变化分开刷新，保留用户编辑中的字段；目的地改变后不显示旧计量。原 nativeReasoning、确认、加密保存、步骤预算与模型撤销语义保持。

## 本地验证

| 检查 | 实际结果 |
| --- | --- |
| 依赖安装 | 两次在线安装遇 read ECONNRESET；保留日志；将同锁文件工作树的包缓存复制到本工作树独立缓存后，npm ci --offline exit 0 |
| npm run build | exit 0 |
| 配置/预算宿主及 Renderer 定向 | 最终 16/16；初次新增测试有括号语法错误，修正后重跑，原失败日志保留 |
| 实际 Electron 主进程 / IPC / Admin | 原生设置烟测 exit 0；未计量展示、加密配置重启、目的地重置、删除/撤销通过，模型调用 0 |
| 原生截图校对 | native-settings.png 中预算说明可见，无截断；使用合成模型配置 |
| 官方词表 Windows 离线核验 | 4 组公开原始文本通过；ASCII / 中英 emoji / 回执引号换行 / 特殊 token 字面量均可往返；错误文件 SHA-256 明确拒绝 |
| 完整 npm run check | exit 0；37 个汇总，3095 总计，3064 通过、31 跳过、0 失败；含架构、生成类型、构建、类型检查、工作区及集成 |
| 标准 Desktop npm run test:smoke | exit 0；现有 Fake Runtime 窗口、Preload、提交/取消及 Admin 关闭回归通过 |
| npm run dev / demo:protocol / demo:runtime | 三项均 exit 0；最后 Runtime 演示 succeeded，7 条事件；均为既有离线演示 |

证据为工作树忽略目录的 `.cache-budget-telemetry-*.log`、`.cache/tokenizer-probe.json`、`.cache-tokenizer-invalid-hash.log` 和 `.cache/native-reasoning-product/`。宿主测量回归使用实际公开 ModelGateway/Provider、注入 fetch 与明确合成计数器；界面烟测是真实 Electron/IPC，但不是实际模型调用。原 Vault 不读写，真实云调用 0。

## tokenizer 来源与复现

官方来源：[DeepSeek recipe 的 tokenizer 文档](https://github.com/deepseek-ai/deepseek-recipe/blob/8cadfede7063c896b944e7bae05daa3549ae97ea/docs/tokenizer.md)、[V4.1 词表来源说明](https://github.com/deepseek-ai/deepseek-recipe/blob/8cadfede7063c896b944e7bae05daa3549ae97ea/static/tokenizers/v41/README.md)。上游提交 `8cadfede7063c896b944e7bae05daa3549ae97ea`，文件 `static/tokenizers/v41/tokenizer.json`，6,367,247 字节；SHA-256 `81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99`，与官方来源说明一致；MIT，Copyright (c) 2023 DeepSeek，许可证保存在同一忽略目录。

官方 recipe Python 0.1.1 分发不含 Windows wheel；本机 Docker 引擎未连通，不修改 Docker/WSL 配置来替代生产验收。当前在独立 `.cache/tokenizer-venv` 安装 [Hugging Face tokenizers 0.23.1](https://pypi.org/project/tokenizers/0.23.1/)，只加载本地固定词表，不使用 from_pretrained、不加载模型权重、不联网推理。此工具不加入 npm 依赖或产品分发。

复现入口：`tests/manual/models/deepseek-tokenizer-offline.py --tokenizer .cache/tokenizer-v41.json`，使用上述 venv 的 Python，设置 HF_HUB_OFFLINE=1。脚本固定校验词表 SHA 与后端版本，只处理源码内公开合成文本，输出 `scope=raw-text-only`、`templateApplied=false`、`providerBodyBudgetSuitable=false`、`maasTemplateMatch=unverified`。

实测原始文本 Token 数分别为 1、4、10、7；这不包括完整对话模板，尤其不能用特殊 token 字面量的原始编码推断端点转义策略。官方完整模板、MaaS 同名部署和实际 fetch 改写后的请求匹配仍未验收，因此生产不自动注入本实验作为可信 meter，Desktop 保持未计量。

## 后续

1. 由 Runtime 与 AgentArts 镜像组合明确最终请求变换发生位置，确保计量的是实际发送的可见消息模板；原 fetch 事后改写不在 #357 范围内。
2. 在受支持环境使用锁定版本的官方完整模板，验证工具包装、继续回执、思考模式及特殊字面量；先取得离线模板证据，再讨论 MaaS 匹配，真实云验收继续暂停。
3. 完整生产 tokenizer / 镜像打包与真实端点计量尚未完成；本包 Git 交付、非作者批准及主线集成另按对应授权，不把完整 F27 / MOD-04 / MOD-09 标记 done。
