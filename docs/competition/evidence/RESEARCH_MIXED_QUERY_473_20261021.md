# #473 混合研究查询与来源回执

目标 Profile：`huawei_ict_agentarts`；MOD-24 / PA-010；工作包实施与消费接线由本 PR 负责人完成，正式非作者审查与 CI 独立记录。
独立分支 `codex/fix-research-mixed-query-473`，实现基线 `e7d4e0c6f0830f7078a49438ea7d31fe39293394`。

## 实现与边界

- 生产入口仍为 `research.register` → `ResearchService` → `OpenAlexProvider`；Runtime/Policy/ToolGateway 的授权、取消和版本核验保持原实现。
- #447 的 C++/C#/版本化词元及原文相邻汉字边界保留。检索/论文/优化等泛词不作主题证据；引用数、venue 和英文请求本身也不作相关性证明。
- 明确中文主题可在题名或有界摘要里通过有限、审查可见的中英词表匹配；题名只有语言名而无已识别主题不放行。词表之外仍用原题名词面桥，未确认的材料继续过滤，不声称实现通用语义 rerank。
- 只有中文主题和指令词全部可解释时，使用同一词表生成一次英文主题源查询。原文、实际检索词、逐项映射都在 `queryRewrite` 披露。未知主题/条件、否定或时间限制不能被忽略，保留原查询。
- 摘要反排索引最多 4096 位置、32768 输出字符，坏形状/重复位置/越界不能成桥；缺口不拼出相邻英文短语。摘要仅供本机主题比对，不把全文或原响应导出。

## 工具输出与实际消费

`OpenAlexProvider.search()` 保留数组返回；可选 `searchWithReceipt()` 提供 `{materials, retrieval}`。
旧 Fake/自定义提供商没有该方法时不伪造原始命中数；新 Service 缓存回执与材料一起保存，fresh/stale 仍指向原抓取，不把失败刷新冒充新源页。

`research.search` 独立输出契约版本为 `0.1.0-alpha.2`，npm/Connector manifest/Core wire/数据库/锁不变。
严格的旧 `alpha.1` 输出 Schema 会拒绝新字段，不能直接拿来消费新回执；已注册目录/availability/export 按新版工具绑定。
旧任务版本由原 ToolGateway `PROTOCOL_MISMATCH` 校验拒绝，不自动改绑新版。新描述器可接受缺回执的旧提供商载荷。

`retrieval` 对本次**实际源页面**披露：源 URL（剥联系邮箱/URL 凭据）、策略、raw/invalid/filtered/returned 计数、源空/本机筛空/无效条目的区别、中文说明，以及逐条 externalId/依据/匹配词。
计数关系为 `raw = invalid + filtered + returned`，不是 OpenAlex 全库命中量。
`source_empty` 与 `filtered_empty` 都不能表述为“语料没有这类文献”。纯拉丁透传标 `provider_rank`，不宣称本机确认了语义。

实际 Desktop 公共连接器导出原先只保留 results/cache，本次补齐 research 白名单回执，绑定 `RESEARCH_SEARCH_VERSION` 与 `public-research-retrieval-v2`。
来源引文/日期保留，账号、私有错误、未白名单字段和完整摘要不导出；没有改 Desktop Main 或其他连接器的权限段。
接口等级仍 `provisional`，不提升 AgentArts、真实账号或所有研究主题的验收状态。

## 必要工程验证

环境：Windows、Node `24.15.0`、npm `11.12.1`、TypeScript `5.9.3`。
独立依赖仅限定 research/contracts/testkit，`--ignore-scripts`，安装 28 包；未改锁、未运行 Electron 安装钩子。
首轮沙箱 DNS `ENOTFOUND registry.npmmirror.com` 导致 npm `Exit handler never called`；平台最小网络权限下同命令成功。这是 setup 故障，不计作产品失败。

已执行：storage → contracts → client → testkit → research 顺序 build、research typecheck；首轮 research 测试 46 项，45 通过、1 既有 live 门控跳过、0 失败。
该轮覆盖 #445/#447 全部既有边界及新增混合主题、摘要、泛词误留、计数、注册 Schema、旧严格 Schema 拒绝、新旧载荷与缓存隔离。
最终源查询改写后，重新构建 research/weather 并通过 research typecheck；research 47 项（46 通过、1 既有 live 门控跳过），架构 3/3 通过。
首次 Desktop host 测试因沙箱拒绝创建本树 weather workspace junction，报 `ERR_MODULE_NOT_FOUND`，其余 research/architecture 已通过；平台最小权限只补本树 link 后，仅重跑该 host 文件，6/6 通过。未重新安装或重复已绿项。
host 检查实际新注册工具、availability/export 同版绑定、主题/筛选回执透传、旧载荷无回执、私有未白名单字段剔除；旧严格 Schema 拒绝新字段的负例仍保留。

## 公开来源小矩阵

只调用固定 7 个公开学术查询，每次 `per-page=5`，无账号/密钥/付费模型/桌面活库；生产 Provider/Service 处理实际响应。
首轮 7 个真实 GET 均 HTTP 200，当前结果已与 Issue 历史样本不同。未改写时原话与“分配器调优”各 raw5/filtered5/returned0；内存池和动态分配各 raw5/filtered4/returned1，后两者来自明确摘要主题；3 个拉丁查询均 raw5/returned5，但只证明提供商返回。
这说明单改放宽题名桥仍不足以解决原话检索，因此实现了上面的可审计源查询归一。

最终改写四题在 `2026-10-21T12:01:52.765Z` 至 `12:01:58.356Z` 真实执行（均 HTTP 200）：

| 原查询 | 实际源查询 | raw / filtered / returned |
| --- | --- | --- |
| 搜一下 C++ 内存分配器优化的论文 | C++ memory allocator optimization | 5 / 2 / 3 |
| C++ 内存池 优化 论文 | C++ memory pool optimization | 5 / 1 / 4 |
| C++ 内存分配器 调优 | C++ memory allocator optimization | 5 / 2 / 3 |
| C++ 动态内存分配 论文 | C++ dynamic memory allocation | 5 / 0 / 5 |

所有 invalid 均为 0；按原中文主题继续过滤，4 题共过滤 5 条，没有因改写成英文而全部放行。
每条保留材料都有题名或摘要的实际主题词依据；这不是语义准确率或全文验收。
两阶段逐请求 source URL、HTTP、原响应 SHA、元数据/摘要 hash、材料 ID、依据及实现文件 hash 见 [安全回执](RESEARCH_MIXED_QUERY_473_20261021.receipt.json)。

复现（先构建本模块及依赖）：

```sh
node --test packages/connectors/research/test/*.test.mjs
node --test apps/desktop/test/public-connector-host.test.mjs
node packages/connectors/research/test/live-mixed-query.mjs
# 仅重验新增源改写的四题：
node packages/connectors/research/test/live-mixed-query.mjs --covered-only
```

原响应保存在 ignored `.cache/issue473/raw-*.json`，首轮未改写材料保存在其 `unrewritten/` 子目录；公开只交白名单来源元数据、计数、匹配依据及散列，不提交 raw JSON/依赖缓存。
PowerShell 首次解析摘要的 `Browser/browser` 大小写键冲突为取证 setup 错误；已用 Node 原 JSON 解析，未将该错误计为 raw0。

## 未验证与恢复

本轮是公开 OpenAlex 源请求与本地工具/消费投影修复，没有调用或重新部署 AgentArts，没有真实模型/账号、整图平台评分或 UI 交互验收。
平台无法代替本机 Provider 的原页面/过滤计数检查；本轮不把本地回归或公开 GET 当作 Competition 整图完成。
撤销本 PR 可恢复旧连接器/工具描述器和导出；无数据迁移或远端写入需补偿。有限词表之外和仅词面相关的残余风险保留，源排序变化需以新回执为准。
新 PR 仅提交与审查交付，本轮不启 auto-merge、不入队或合并。
