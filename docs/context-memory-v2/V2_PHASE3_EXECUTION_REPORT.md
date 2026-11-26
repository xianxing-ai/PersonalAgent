# Context & Memory V2 第三阶段执行报告

2026-11-26 · `huawei_ict_agentarts` 与 Desktop 本地历史。审计工作树为 `隔离的生产接线工作树`，分支 `codex/context-memory-v2-production`。

## 交付结论

- 两个工作树原有提交完整。`d7fdfccf` 是 `24b3fb45` 的唯一父提交，生产分支包含五笔基础提交及一笔接线提交。远端 `main` 锚定 `802cfe91`，已包含 #700、#704。两条 V2 分支尚未落入该 `main`，生产分支预演发现一个文本冲突。[分支与完整差异](V2_BRANCH_AUDIT.md)
- 11 个模块均有实现或适配器，持久片段、向量及 Runtime 会话/Wiki 召回尚无对应生产消费。Desktop 真实 Electron 已验证合成历史的本地检索，真模型预算及实际云端召回验收仍开放。受影响测试 175/175，新增离线回放 9/9。已有全量 `npm run check` 记录 9 项失败，当前交付未达到可合并状态。[模块与证据矩阵](V2_IMPLEMENTATION_AUDIT.md)
- 发现两处 Desktop 测试接线回归 B1a/B1b。B2 取消可导致历史分块残缺，B3 陈旧候选会挤掉有效结果，B4 同内容的合法恢复可能无法重建摘要来源，B5 不响应取消的向量端口会阻塞返回。各项的触发和修复标准已记录。源码修复留在相应 PR。[缺陷详情](V2_IMPLEMENTATION_AUDIT.md#已复现的缺陷)
- HTTP 200 / `EXTERNAL_FAILURE` 的出现条件已在本地复现。旧回执缺少原始事件结构和平台 trace，线上根因仍未确定。实际模型窗口、使用量和输出预留待可信读回。本轮真实调用为 0。[AgentArts 诊断与验收规范](../../tests/manual/agentarts/ADAPTER_FAILURE_ANALYSIS.md)
- 全历史索引已完成独立设计，尚未实现。用户启用、本地私有、数据源分页与持久版本、批次提交/检查点、暂停与崩溃恢复、删除撤销及原件复核均为 V2-06 验收项。[后台索引设计](V2_BACKGROUND_INDEXER_DESIGN.md)

## Benchmark 复核与验收门槛

`tests/context-memory-benchmark/benchmark.mjs` 生成 10 种场景 × 20 题。每题对应五条正确记录和一条词法高权重、生成后撤掉来源的陈旧记录。另有 8,800 条背景数据，总计 10,000 条。题目从对应场景模板生成，中英文交错，每题直接复用五条正确记录的唯一 `paNNNx` 键。该过程不训练模型。其题目、标签和语料共用生成键，给离线检索提供了直接可区分信号，无法估计独立标注查询、改写或语义检索召回率。

每题 `Recall@5 = 对应标准集的有效命中数 / 标准集大小`，`Precision@5 = 有效命中数 / 5`，按 200 题分别取宏平均。每题五条相关记录使两个分母相同。复跑两次均达到 1,000 次有效命中，Recall@5 和 Precision@5 均为 1.00。计数 12,200 混合建索引、查询内检查及计时区间外的返回结果复核。它反映夹具对当前来源的断言次数。

历史 p95 为 3.45 ms，本轮两次分别为 4.35 ms 与 2.40 ms。nearest-rank p95 的计时包围 `await index.search`，含内存 BM25 排序、合成 Map/hash 校验和结果复制，输入已加载。SQLite 读取、密文解密、真实 Desktop/Runtime 原件校验、主进程队列和 IPC、显示或请求组装均在这个计时边界外。

| 端到端验收项 | 拟定门槛和测量方法 |
| --- | --- |
| 数据与质量 | 固定独立题集，按会话/主题划分调参和留出集。至少 200 道查询，包含中英文改写、否定、冲突、跨会话、归档、撤回、无可见答案。禁用明示答案键。单列 BM25 与本地向量，目标 Recall@5 ≥ 90%、Precision@5 ≥ 80% |
| 正确性 | 未授权、过期、编辑前、已删或 withheld 的结果输出数为 0。统计有效候选被挤掉与分页后的可见结果，重做撤回竞态并检查合成输入零网络 |
| 10k 预热查询 | 从 Desktop 搜索提交到展示经原件复核的结果。参考 Windows 测试机上 p50 ≤ 50 ms、p95 ≤ 200 ms、p99 ≤ 400 ms |
| 冷启动与重建 | 已有检查点的首个查询 p95 ≤ 1.5 s。10k 全量重建 ≤ 60 s。分别记录冷启动、写入积压、首屏可用和恢复时延 |
| 100k 与并发 | 100k 预热 p95 ≤ 500 ms。挂载索引后，SQLite 写活跃时主进程任务分段阻塞目标 p95 ≤ 16 ms、p99 ≤ 50 ms。报告峰值内存、磁盘、WAL、退避次数和批吞吐 |
| 分段计量 | 分开记录 SQLite/原件分页、解密、加载、候选搜索、授权与当前来源复核、片段组装、IPC 和窗口渲染。Runtime 出站分支另记组装及发送前测量，模型网络延迟单列。固定硬件、Node/Electron、数据与并发配置，多轮保存 p50/p95/p99 与源校验失败计数 |

以上是拟定门槛，须在同一参考硬件上固定负载并跑实测，现有 in-memory 结果只支持算法级小基准。

## 七个 PR 的交付范围

以下为可审查的拆分规划，没有创建分支或 PR。文件均相对于仓库根。`package.json`、`package-lock.json` 只更新本 PR 新增 workspace 或依赖边，`CURRENT_INTERFACE_CATALOG.md` 只发布各阶段可证实的能力。共享文件按 hunks 提取，避免重复拷贝。拆分后的路径和测试以重建结果复核，提案中的新文件在对应 PR 创建。

| PR | 已有文件范围及拟新增项 | 依赖 | 独立验证命令 |
| --- | --- | --- | --- |
| V2-01 Context Domain & Budget | `packages/context/{package.json,tsconfig.json,README.md,src/{types,index,budget-manager,context-planner,context-assembler,context-ranker}.ts,test/context.test.mjs}`，根 workspace/lock、接口目录 | 最新 `main`，继承 #700/#704 | `npm run build`，`node --test packages/context/test/context.test.mjs` |
| V2-02 Conversation Memory Store | `packages/conversation-memory/{package.json,tsconfig.json,README.md,src/{types,index,migrations,sqlite}.ts,test/sqlite.test.mjs}`，根 workspace/lock，接口目录。保留 V2-03 所需公开并发检查 | 最新 `main`，可独立抽取，正式堆叠时接在 01 后 | `npm run build`，`node --test packages/conversation-memory/test/sqlite.test.mjs` |
| V2-03 Structured Compaction | `apps/runtime/src/application/{structured-context-summary,context-compaction,context-compaction-model,context-summary-persistence}.ts`，`apps/runtime/{README.md,src/application.ts,test/context-compaction.test.mjs,test/context-compaction-model.test.mjs}`。Desktop `context-memory-store.js`、`harness-context-host.js`、`harness-configuration.js`、`model-api-config.js`、`main.js`、`src/app/harness-controls.js` 与 `context-memory-store.test.mjs` 的摘要/设置/缓存 hunks，相关 Desktop README、workspace manifests/lock | 01、02 | `npm run build`，`node --test apps/runtime/test/context-compaction*.test.mjs apps/desktop/test/context-memory-store.test.mjs apps/desktop/test/harness-context-host.test.mjs` |
| V2-04 Runtime Integration | `apps/runtime/src/application/{agentarts,context-binding,context-memory-resolver,context-source-adapters,runtime-application,knowledge-tools}.ts` 与 `application.ts`、Runtime 依赖/README/对应 resolver、compaction 和 Wiki 测试。`packages/coordination/src/agentarts.ts` 的请求测量和发前边界。Desktop `electron/{context-memory-host,context-memory-store,conversations,harness-context-host,main,memory-learning-host,obsidian-pairing-host,conversation-memory-index}.js` 中接线 hunks，`src/app/knowledge-controls.js`、`test/{context-memory-store.test.mjs,conversation-memory-index.test.mjs,conversation-memory-smoke.cjs,knowledge-controls.test.mjs}`，Desktop README/manifest、接口目录。抽取 `packages/conversation-memory/src/{index,retrieval}.ts` 最小 BM25 基线及对应测试。修 B1a/B1b、B2/B3，并补回归 | 01–03；不等待向量 | `npm run check`，`node --test apps/runtime/test/competition-context-binding.test.mjs apps/runtime/test/context-memory-resolver.test.mjs apps/runtime/test/knowledge-tools.test.mjs apps/desktop/test/conversation-memory-index.test.mjs apps/desktop/test/content-fence-product.test.mjs apps/desktop/test/laya-main-startup.test.mjs`，`node apps/desktop/test/conversation-memory-smoke.cjs` |
| V2-05 Hybrid Retrieval | `packages/conversation-memory/src/{index,retrieval}.ts` 的本地 embedding、融合、取消 hunks，`test/retrieval.test.mjs` 对应覆盖，包 README，`tests/context-memory-benchmark/{README.md,benchmark.mjs}`，接口目录检索状态。独立题集与端到端计量夹具为新增范围 | 02、04 的 BM25 基线 | `npm run build`，`node --test packages/conversation-memory/test/retrieval.test.mjs apps/desktop/test/conversation-memory-index.test.mjs`，`node tests/context-memory-benchmark/benchmark.mjs`，已合成的 Electron 基线 smoke |
| V2-06 Background Indexer | 拟增 `apps/desktop/electron/conversation-memory-indexer.js`、`apps/desktop/test/conversation-memory-indexer.test.mjs`。修改现有 `electron/{main,conversations,conversation-memory-index}.js`、受信设置 UI、Runtime 原件只读适配、`packages/conversation-memory/src/{migrations,sqlite,types,index}.ts`、对应测试、README、接口目录和设计。按原件分页结果决定持久游标改动范围 | 02、04；05 的向量为可选后续 | `npm run build`，新增用例后执行 `node --test apps/desktop/test/conversation-memory-indexer.test.mjs packages/conversation-memory/test/sqlite.test.mjs`，`node apps/desktop/test/conversation-memory-smoke.cjs`，执行已固定的端到端矩阵 |
| V2-07 AgentArts Acceptance / Adapter Fix | `tests/manual/agentarts/{README.md,ADAPTER_FAILURE_ANALYSIS.md,support/run-context-budget-probe.mjs,support/context-v2-http200-audit.test.mjs}`。若证据指向适配器，修改 `packages/coordination/src/agentarts.ts` 及其响应/诊断测试。Runtime 终态传播有缺陷时才改 `apps/runtime/src/application/{agentarts,runtime-application}.ts` 及对应测试。部署、计量与接口证据按实际更新 | 离线诊断可先行，真实预算验收依赖 03/04 和可关联 trace | `npm run build`，`node --test tests/manual/agentarts/support/context-v2-http200-audit.test.mjs packages/coordination/test/agentarts-response-text.test.mjs packages/coordination/test/agentarts-failure-detail.test.mjs`，满足 [真实验收标准](../../tests/manual/agentarts/ADAPTER_FAILURE_ANALYSIS.md#真实模型预算验收标准) 后才执行最小合成请求 |

| PR | 验收 | 风险 | 回退 |
| --- | --- | --- | --- |
| V2-01 | 精确 UTF-8/字符测量，强制保留项、全量预算和未测 token 均显式。公共入参行为稳定 | 主线长窗口逻辑和模型估值被重复应用 | 回退纯域/新依赖，保留 #700/#704 主线 |
| V2-02 | 新/旧库迁移、密文和 CAS、tombstone、重开、跨连接冲突及 B4 合法恢复测试 | DPAPI 不可用与来源版本歧义，新库 Schema 旧版无法读 | 先关闭消费，备份并隔离衍生库，使用原对话历史。保留已发布迁移 |
| V2-03 | 无效摘要拒绝、保留原文、`/compact`、取消、回放、同任务重开命中，保护并发快照 | 缓存配错模型或原文被替换，恢复不一致 | 关闭 V2 摘要缓存消费，沿用既有压缩和原件读取 |
| V2-04 | 三方冲突处理后全量检查通过。真实 Desktop/Synthetic Runtime smoke、授权与送前守卫、撤回、原件读回覆盖。B1–B3 修复可复现 | 源回调顺序、主进程首查阻塞、Policy 或旧消费发生变化 | 回退新增组装和 UI 消费。保留主线清理、Policy、来源验证与旧历史 |
| V2-05 | 仅接受本地 embedding，验证截止和 B5、词法可用、隐私测试及独立题集。端到端门槛有数据 | 向量忽略取消，模型版本错配，平台资源占用 | 关闭本地向量，回落至 04 词法及来源守卫 |
| V2-06 | 用户启用前零扫描，当前/归档/暂停/恢复/增量/编辑和删除可复验，源读回通过性能门槛 | 长事务、重启游标失效、撤回竞态、磁盘持有 | 停止后台索引，恢复按需词法和原件核验，依设计隔离衍生库 |
| V2-07 | 由实际失败 trace 与脱敏夹具确认故障和归属。保持未知响应 fail closed，无重发，正例具备模型 usage、配置上限和 finish reason | 宽松解析误判成功，部署间契约漂移，重复计费 | 回退适配器兼容分支和计量展示，保留显式失败和已知安全诊断。部署回退另行授权 |

V2-04 先带最小词法实现，是因为现有 Desktop 生产消费者直接依赖 `ConversationEpisodeIndex`。V2-05 承担向量和融合。V2-03 只逐步开放受信摘要缓存。V2-04 的 Wiki 路径继续拒绝旧版证据或无法及时复验的来源。根锁文件用项目工具生成，已发布迁移按版本向前演进。每份 PR 以可单独构建、验证、回退为边界，按 `.github/pull_request_template.md` 登记负责人、建议非作者审查者与拟合并者。创建 PR 和分派审查均待明确确认。

## 下一轮顺序与当前状态

1. 确认拆分边界，再以当时最新 `main` 在新审查分支逐块提取 01、02、03。保留两条原分支与提交。补 B4 受信来源版本回归，重新验证既有长上下文和配置。
2. 提取 04，解决 `conversations.js` 冲突及 B1a/B1b、B2/B3，验证 source guards、Native smoke 和完整 `npm run check`。在能运行 symlink、.NET 8、`sh` 和临时文件权限检查的环境完成交付门槛。
3. 基于 04 再提取 05，补 B5 和独立 Benchmark。随后按明确授权的用户设置推进 06，实际验证源游标、检查点、撤回、重启和容量。
4. 并行准备 07 的脱敏取证，先查先前请求可关联的受信 trace。定位后确定平台、适配器或 Runtime 的修复范围。真实模型预算在相应路径合成验收完成后独立登记。

本轮只留本地报告、离线回放和已忽略的证据文件。原有 V2 分支、`main` 和部署配置保持原状。审计已结束，后续实现与发布待确认。
