# MOD-09 / F27：版本化上下文、预算与删除覆盖

- 日期：2026-10-14
- 负责人：goo122；非作者评审待登记
- 状态：in_progress
- Profile：`huawei_ict_agentarts`
- 工作树：`.worktrees/goo122-versioned-context-20261014`
- 分支：`codex/goo122-versioned-context-20261014`
- 基线：#350 `a378c3df12b98990f8a10e02037f6c6eb3e6ae65`，父 PR 尚未合并
- 范围：PR #347 的 F27 第二工作包，复用 F04/F05 既有确认、版本及删除链路
- 方案：[ADR-0025](../adr/0025-competition-context-binding.md)

## 已实现

- `competition-context:v1` 保存编译输入的摘要和预算元数据，不保存新私人正文、来源路径、原消息 ID 或凭据。
- 后续发送和 SQLite 恢复校验同一上下文；来源/消息内容、私人绑定、配置及预算漂移拒绝继续使用。
- 原 16000 UTF-16 字符硬上限覆盖最终 JSON 包装和转义，不静默裁剪内容。
- 可信同步 goal tokenizer 端口支持计数加输出预留；计数/版本/预算在凭据读取后重验。未配置时明确 `unmeasured`。
- 历史任务变为 withheld 时拒绝旧上下文发送。新增内存记录在每次发送结束、close、原逐事实删除时释放；新检查点经现有父/子任务副本清理，无关任务不受影响。

## 验证记录

- 定向：`node --test apps/runtime/test/competition-context-binding.test.mjs apps/runtime/test/competition-conversation-context.test.mjs apps/desktop/test/private-memory-consumption.test.mjs apps/desktop/test/private-memory-erasure.test.mjs`：33/33，0 失败/跳过。
- 覆盖：最终包装与转义超限、token 边界/超限/非法/异步计数、凭据等待期间计数和配置漂移、SQLite 审批恢复版本一致或变化、历史 withheld、逐事实父/子任务清理、无关任务及重启保留。
- 新夹具首轮失败已修复：直接 TaskRuntime 提交补显式 conversationId，工具对象 Schema 补 properties；未修改生产协议/期限或放宽断言。原失败日志保留在忽略的 `.cache-context-tests*.log`。
- 本工作树 `npm ci`、根 build 已通过；`npm run check` 退出 0，37 个 Node 测试汇总块共 3081 测试：3050 通过、31 跳过、0 失败/取消；包括架构、契约夹具、生成类型、工作区类型检查/测试和根集成。使用项目已有 SDK8 与已构建的 WindowsJobProcessHost；未更改宿主生产超时。
- `git diff --check` 与新增文档相对链接检查通过。定向和完整日志分别为忽略的 `.cache-context-focused.log`、`.cache-context-check.log`。
- 用户授权 Git 交付后，当前工作树再次构建原生宿主并执行 `npm run dev`、`npm run demo:protocol`、`npm run demo:runtime`，均退出 0；三项演示使用既有合成路径，不当作新增上下文的真实云验收。完整 check 使用的原宿主与此构建来自相同未改动的源码。
- 原 Vault 未访问；数据均为独立合成夹具。真实云调用 0；合成 HTTP 仅注入 fetch，不访问网络。

## 未完成与交付边界

本增量不是完整 F27 或 MOD-09 done。Desktop 尚无已验证 tokenizer；当前 token 端口仅计编译 goal，完整云请求的工具目录/继续回执/额外提示计量、模型输出预留落实、历史选择与摘要副本仍需后续包。私人云消费验收继续暂缓，相关整篇 Wiki 备份仍保留并报告 pending。无 wire/迁移/依赖变化，接口继续 provisional。

用户已授权本包提交、普通推送并创建基于 #350 分支的独立 PR，交付以本页分支及 GitHub 记录追踪。非作者评审、远程门禁及主线集成待完成，依赖 #350 的当前状态以 GitHub 为准。
