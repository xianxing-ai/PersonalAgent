# Context & Memory V2 实现审计

审计提交为 `24b3fb45`，基线和工作树见[分支审计](V2_BRANCH_AUDIT.md)。表中「生产」指该分支正常入口已装配。「集成」表示实际消费者配合 SQLite、Electron 或合成端口执行。真实环境列单列 Electron/Windows 与 AgentArts 模型端的证据范围。

| 模块 | 已实现 | 生产接线 | 单元测试 | 集成测试 | 真实环境验收 | 缺陷或缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| Context Budget Manager | 是，字符、UTF-8 字节、token 能力等级与输出预留 | Runtime 规划和测量已接入 | 通过 | Runtime/Coordination 合成请求通过 | 模型端预算开放 | AgentArts 模型有效输入和输出上限未读回。未知 token 明示未测 |
| Structured Conversation Summary | 是，结构、来源及原文保留校验 | Runtime 显式与自动压缩已接入，复用任务上下文 | 通过 | Runtime compaction 和恢复夹具通过 | 真云摘要未验收 | 持久命中受任务快照、来源变化和模型版本限制。全量缓存命中率未测 |
| Encrypted Summary Cache | 是，密文持久化、标识绑定、失效 | Desktop safeStorage 与 Runtime 摘要持久端口，在配置允许时使用 | 通过 | 文件重开、密文与来源失效已覆盖 | Windows safeStorage 有合成数据验证 | B4，复原同内容的合法来源版本无法重新绑定。并行快照的缓存周转待测 |
| Conversation Memory SQLite Store | 是，迁移、generation、摘要与片段接口 | 摘要有生产消费，持久片段写入/读取暂无生产消费者 | 通过 | 本地 SQLite 和 Desktop 摘要适配测试通过 | 实机本地摘要链有验证，持久片段开放 | 持久索引仍缺生命周期接线，多实例并发与崩溃恢复待验收 |
| BM25 Retrieval | 是，词法检索、来源检查及排序 | 比赛设置中的会话历史搜索 | 通过 | 桌面历史夹具与基准通过 | Windows Electron 设置可查询合成会话 | B2/B3，取消后的分块完整性和撤回后的候选填充存在缺陷 |
| Local Vector Retrieval | 是，可注入仅本地 embedding 并融合排序 | Desktop 构造未传入 embedding | 通过 | 端口与融合仅有合成向量集成测试 | 开放 | B5，忽略取消的端口可阻塞返回。模型缓存、超时和本地资源成本未验证 |
| Cross-session History Retrieval | 是，即时索引当前和归档会话，交付前重读原始记录 | Desktop 主进程 `memory.history.search` | 通过 | 两会话含归档、受信设置入口及非授权入口测试通过 | Windows Electron 真 UI、合成会话 | B2/B3，首次查询同步建索引，重启后重建。Runtime 不自动注入私人历史 |
| Wiki Source Validation | 是，严格证据定位及最终原件校验 | Runtime Wiki 工具与 Desktop 配对宿主已接入。来源适配器可用，未装配进默认 resolver | 通过 | `knowledge-tools.test.mjs` 覆盖撤回、来源变化、上下文漂移 | 既有测试为受控 vault，真实用户 vault 开放 | 旧证据需按当前策略重新取证。插件型来源的读取和最终校验证据不等同 filesystem |
| Runtime Context Resolver | 是，来源适配、预算、敏感度、有效期和最终同步断言 | 仅明确允许且确认的公开事实进入已装配云路径。会话与 Wiki 适配器未启用 | 通过 | 合成来源、过期、预算与 Runtime 绑定测试通过 | 真云读回开放 | `requiredIds: []` 只处理可选召回。私有上下文仍由既有任务和权限路径管理 |
| Final Send Guard | 是，计划后复核 deadline、来源、对应请求和请求测量 | Runtime → Coordination 在实际发送前同步运行已有授权及来源检查 | 通过 | 模拟 source drift、异常、预留与零调用场景通过 | AgentArts 的真实 token/最大输出开放 | B1 含接线测试回归。平台模型不可见包装和输出配额未能由本地守卫验证 |
| Subagent Memory Isolation | 是，V2 resolver 对 subagent 不召回，私有 Episode 检索限制为本地 primary | 已接入 V2 委派及 Desktop 历史入口 | 通过 | 合成委派及用途范围覆盖通过 | 真实委派/云端回读开放 | 结论限于 V2 记忆路径。既有同会话工具和偏好注入保留自身授权规则 |

## 已复现的缺陷

| 编号 | 现象与证据 | 修复验收 |
| --- | --- | --- |
| B1a | `24b3fb45` 将 `apps/desktop/electron/main.js` 的 `onTaskTerminal` 由单表达式改为同时清 ContentFence 和置会话索引 dirty。`content-fence-product.test.mjs` 仍断言旧源码形状，测试失败。旧锚点在 `d7fdfccf` 和最新 `main` 均存在 | 通过行为测试确认两项副作用、调用顺序和未授权路径，无条件保留原 clearance |
| B1b | V2-04 的 Desktop 装配已给 `new Conversations()` 加编辑 hook，`laya-main-startup.test.mjs` 用旧构造语句做提取锚点，在 `d7fdfccf` 已找不到。最新 `main` 与共同祖先仍保有锚点 | 保留启动测试对真实入口的覆盖，验证合并后的启动和原安全断言 |
| B2 | `conversation-memory-index.js` 先登记 `records` 再逐块写入 postings，中途取消留下相同 digest 的不完整记录。合成 4,000 字符边界后取消，再查询尾部词返回空。全新索引可找到同一词 | 为一个消息原子发布整组片段，或者失败删除暂存项。取消/超时重试后片段完整 |
| B3 | 同文件只取 top 30，随后重读原件并去重。构造 31 条高分失效项丢失 dirty 通知时，低分有效项在本次结果中被挤掉，第二次刷新后出现。失效结果未返回 | 继续验证并有界补充候选或先刷新受影响会话。验证编辑、删除和多片段去重后，本轮仍可返回可见有效项 |
| B4 | `packages/conversation-memory/src/sqlite.ts` 记录失效指纹。`bindSource(A,0)` → `bindSource(B,1)` → 以当前 generation 尝试 `A` 仍被拒绝。Desktop 来源只用快照 digest，用户把内容改回原样也可能落入同一指纹 | 由受信原件的单调 revision 区分新的恢复与旧请求重放，同时保留 generation 检查和 tombstone。增加 `A→B→A`、过期任务与跨进程测试 |
| B5 | `packages/conversation-memory/src/retrieval.ts` 等待 embedding Promise 后才再次检查范围。合成端口忽略 signal 时，取消后调用仍等待，直到手动释放端口 | 开启生产向量前验证 deadline/取消及时结束、迟到向量不发布及有界并发。保留词法路径的结果与来源断言 |

B2–B5 在本地合成复现中逐一触发，临时脚本为 `.cache/context-memory-v2-audit/reproduce-findings.mjs`。B1 两处确认的是测试回归。实际清理调用仍存在，真实启动行为用 Electron smoke 另行验证。缓存键包含当前任务的上下文快照，若并行任务绑定不同快照可能反复替换 active generation，属于待测风险。

## 证据及限制

- 在生产接线工作树，Context、Conversation Memory、Runtime compaction/resolver/Wiki/绑定、Desktop 宿主/存储/历史及 Coordination 相关测试合计 175/175 通过。另跑 [HTTP 200 离线回放](../../tests/manual/agentarts/support/context-v2-http200-audit.test.mjs) 9/9。
- `node apps/desktop/test/conversation-memory-smoke.cjs` 运行真实 Electron 设置窗口，以合成会话确认当前与归档历史可以被本地搜到，未授权窗口被拒。Windows safeStorage 的历史探针验证合成摘要加密、重开与失效，范围为本机。
- 生产接线构建通过。已有 `npm run check` 日志 `.cache/context-memory-production-check.log` 记录 9 项失败。B1a/B1b 是接线引入的测试回归。其余是两个 symlink `EPERM`、一个配置替换 `EPERM`、三个缺少 .NET 8 的宿主或构建检查、一个 `spawn sh ENOENT`。未在最新远端 `main` 的组合树上重跑全量检查。
- 生产装配的证据入口在 `apps/desktop/electron/main.js`、`harness-context-host.js`、`context-memory-host.js` 和 `apps/runtime/src/application/runtime-application.ts`。SQLite 格式保留原始记录，V2 未新增公共 IPC 以外的云端能力授权或换用备用 profile。
- AgentArts 有一笔已授权合成请求的 HTTP 200 失败回执。模型用量、输出预留与真实成功链路的验收开放。详见[诊断与验收规范](../../tests/manual/agentarts/ADAPTER_FAILURE_ANALYSIS.md)。
