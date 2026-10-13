# MOD-08D：Obsidian Vault API 只读适配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 关联需求：PA-008
- Profile：`huawei_ict_agentarts`
- 依赖：已合并 PR #93、#94、#95
- 分支：`codex/mod-08d-obsidian-read`
- 负责人：`goo122`
- 评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`done`，PR #97 经非作者评审后已合并；仅完成本片插件侧适配器的离线验收，插件装配和真实 Vault 验收仍未完成

## 本片交付

- `@personal-agent/knowledge/obsidian` 消费 Obsidian Vault API 的只读子集。
- 可信宿主必须显式绑定 Vault ID 和允许的文件夹；查询、引用参数不能改变范围。
- 只列举并读取范围内的 Markdown，限制文件数、大小、查询长度和返回数。
- 引用包含 Vault、路径、行号和内容摘要；变更、重命名、删除后拒绝旧引用。
- 取消、到期、读取失败和扫描超限不返回部分结果。

## 不在本片

尚无可安装的 `plugins/obsidian` 入口、用户选库与撤销流程、Runtime 默认注入或
真实 Vault 验收。Obsidian API 的单次读取不能被 AbortSignal 中断，只能在返回后
拒绝结果。没有写入、持久索引、LLM Wiki、AgentArts 数据出境或生产 capability。
文件读取和云端发送分别需要用户授权；本片不替代 MOD-08E 的可信宿主接线。

## 离线验收

- `npm run build --workspace=@personal-agent/contracts`：通过。
- `npm run build --workspace=@personal-agent/knowledge`：通过。
- `npm run test --workspace=@personal-agent/knowledge`：16/16 通过，含合成 Vault 的
  文件夹隔离、引用读回、修改/重命名/删除、限额、取消和读取失败。
- `npm run check`：通过；真实 Obsidian 插件验收仍需单独完成，不由离线结果替代。
