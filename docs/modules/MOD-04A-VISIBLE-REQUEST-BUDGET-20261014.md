# MOD-04A / F27：可见模型请求预算

- 负责人：goo122；非作者评审待安排
- Profile：`huawei_ict_agentarts`
- 状态：in_progress；接口 provisional
- 基线：#351 `3153e022d0b5a948e5166c7f63d49b485aa6f532`
- 工作树：`.worktrees/goo122-visible-request-budget-20261014`
- 分支：`codex/goo122-visible-request-budget-20261014`
- 方案：[ADR-0026](../adr/0026-visible-model-request-budget.md)

## 已实现范围

沿 ModelGateway 的公开 ModelRequest/ModelResult 与 OpenAI compatible Provider 接通 host-only 同步输入计量器。计量读取最终序列化 Provider 请求，包含文字工具协议提示、完整 Schema、消息、来源/goal 包装及继续回执中实际进入消息的部分。没有进入该 Provider 的 cloud goal/平台提示不能由本端口计量。

计量必须绑定模型、tokenizer/configuration 引用和显式窗口；读取凭据前检查总额，等待后再次计量并比较。实际输出使用唯一 max_tokens/max_completion_tokens 字段，缺省使用宿主预留，调用方仅可收窄；超限不读凭据。无计量器结果 unmeasured，隐藏上下文与 fetch 后续改写 unknown。没有字符估算或默认假 tokenizer。

Competition 工厂透传预算，Pangu 明确拒绝此配置；原 subtask-model-binding 检查点附预算版本描述，同身份的新 tokenizer、配置、容量、预留或移除计量配置均拒绝旧审批恢复。此元数据不含正文或计量函数；继续复用原 agent-loop、累计 usage、TaskRuntime 与 Policy。没有新的数据库、任务终态或持久私人正文，原父/子任务逐事实清理覆盖既有检查点。

## 验收记录

定向验证覆盖完整工具/消息/回执包装、中英/emoji/转义、精确边界与溢出、输出字段、无效/异步/抛错计数器、凭据等待期间输入快照与计数漂移、继续调用重测、未计量、取消/deadline，以及 SQLite 重启审批的同版本放行和漂移不消费授权。测试使用明确合成计数器与 Fake/注入 fetch，没有真实模型 I/O。

| 本地检查 | 实际结果 |
| --- | --- |
| 独立工作树 npm ci，按原锁文件 | exit 0，无依赖/锁文件变更 |
| 根 npm run build | exit 0 |
| 预算 Provider + 子任务绑定定向测试 | 20/20，0 跳过、0 失败 |
| 现有 Windows native 测试宿主构建 | exit 0，使用项目既有 SDK 8 |
| 完整 npm run check | exit 0；37 个测试汇总，3092 总计，3061 通过、31 跳过、0 失败；含架构、生成类型、构建、类型检查与集成 |
| npm run dev / npm run demo:protocol / npm run demo:runtime | 三项均 exit 0，均使用现有离线演示 |
| diff / 文档路径链接检查 | 通过 |

上述计数来自最终日志，不把明确跳过的真实服务/环境场景当作已验收。远程 CI 尚未运行。原 Vault 不读写，真实云调用 0。#350/#351 的当前 head Foundation 已成功，交付前再次查询 head 未变化且 reviews 均为空，设计批准门禁仍失败；本包不改变它们的交付状态。

## 后续与交付边界

1. 由宿主确认实际模型版本、容量依据与可信 tokenizer，将其正确绑定到上述端口；生产不把测试 meter 当成真实 tokenizer。
2. 自有镜像/AgentArts 必须核对实际可见模板和 fetch 改写位置，再接入计量；平台隐藏上下文保持未知，不扩大为整个云端请求已测量。
3. Desktop 沿已有 IPC 展示测量范围、未计量、输入占用与输出预留；本包没有新增 wire DTO 或 UI 持久状态。
4. 检索排序/选择性扩充、摘要和原文映射及新私人副本删除协调仍为后续工作包；原 16000 UTF-16 字符上限不变。

本包 Git 交付、非作者评审与主线集成尚未完成；完整 MOD-04/09 不据此转 done。
