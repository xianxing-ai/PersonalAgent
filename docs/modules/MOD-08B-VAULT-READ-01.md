# MOD-08B：脱机 Vault 只读检索

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 关联需求：PA-008
- Profile：`huawei_ict_agentarts`
- 依赖：已合并 PR #93 的 MOD-08A，基线 `origin/main@0ba2d00`
- 分支：`codex/mod-08b-vault-read`
- 负责人：`goo122`
- 评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`done`，PR #94 经非作者评审后已合并；仅完成本片离线验收

## 交付边界

- `@personal-agent/knowledge/filesystem` 提供 `openReadOnlyVault({vaultId, rootPath})`。
- 宿主显式绑定绝对 Vault 根，查询只能返回有界 Markdown 片段与内容摘要引用；
  `readCitation` 校验 Vault、相对路径、行号与内容版本，变更后拒绝旧引用。
- 读取前后检查规范路径、链接、文件身份与内容变化；搜索过程中出现拒绝或超限
  不返回部分结果。合成临时 Vault 覆盖越界、符号链接、取消/到期及过期引用。
- 每次查询重扫，没有持久索引或数据迁移，也不新增外部依赖。

## 非目标与权限

本适配器不是用户授权服务。仅可信宿主在得到对应权限后才能注入根目录；
当前未接 Runtime、ToolGateway、Policy、Desktop 或 AgentArts，不得作为生产
capability 公布。未访问真实私人 Vault，未安装 Obsidian 插件、写入笔记、做
向量/FTS 索引或 LLM Wiki。Obsidian Vault API 优先路径留待后续工作包。

文件系统路径校验与句柄身份检查能防普通越界/链接和多数替换，但不构成对
恶意并发操作者的 OS 沙箱；此部署条件必须在生产授权接线前另行评估。

## 验收

- `npm run build --workspace=@personal-agent/knowledge`：通过。
- `npm run test --workspace=@personal-agent/knowledge`：10/10 通过。
- `npm run check`：通过全工作区与根集成 7/7；真实服务测试未启用。
- `git diff --check`：通过。
- 真实 Vault、插件 API、授权接线和 AgentArts 端到端验收均不计入本片。
