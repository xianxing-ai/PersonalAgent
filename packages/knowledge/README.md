# @personal-agent/knowledge — provisional Vault ports

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

PA008 MVP 新增独立受控写端口与受信知识源配置，目标 profile 为 `huawei_ict_agentarts`。
下面 MOD-08A～F 是历史分片证据；其中“无生产注册”的描述不能代表当前 main 的装配状态。
当前 main 已有启动目录绑定的只读工具，本包将其替换接线交给 P8；设置与主对话必须消费同一个
`createKnowledgeSourceConfig`，不得继续使用独立 ENV/default Vault 或仅切换 private-memory 控制器。

## PA008 受信知识源与整理端口

`apps/desktop/electron/knowledge-source-config.js` 的异步
`createKnowledgeSourceConfig` 只在主进程创建。必需输入为 `userData`、Electron `safeStorage`、
稳定的 `namespace` / `hostIdentity` 和原生 `selectDirectory` / `selectNoteFiles`；
`confirmPermissions` 负责本机明确确认，写入额外需要可信 PowerShell 7 的绝对路径。
根目录、目录身份及笔记范围随配置用现有安全存储加密；Renderer 快照只含显示名、
不透明 sourceId、namespace、递增 configRevision、启停、数据级别及已选笔记的相对路径。
缺配置、解密失败、目录身份改变都显式 unavailable，没有默认目录、ENV 或 Fake 回退。
选库、变更权限、选笔记、停用和撤销会使旧租约取消，并增加配置版本。写入和出机许可仅本会话有效，
重启只恢复用户选定的只读配置；长期保存公开数据标签不等于长期出机授权。

新 Runtime 工厂 `createTrustedKnowledgeTools(source)` 位于
`apps/runtime/src/application/knowledge-tools.ts`；P8 在公开 `runtime/application` 入口导出并组合。
工厂注册现有 `RegisteredTool`，不新建执行器。调用 `bindApplication(application)` 后，
任务通过原 Runtime 检查点绑定 sourceId/configRevision；本机提交器在 prepare 与 finalize 之间
调用 `bindTask(taskId)`。主对话的新 `knowledge.search@1.0.0` 输入为
`{query,limit,sourceId,configRevision}`，版本与旧只读工具 `0.1.0-alpha.1` 明确区分。
旧审批或旧任务不能在切库后消费新来源。底层 `KnowledgePort` 仍保持只读；文件适配器新增
host-only `readNote({path,deadline,signal})` 用于用户通过本机选择器选定笔记的本地版本预览。

`@personal-agent/knowledge/write` 独立导出 `KnowledgeWritePort`、
`openControlledVaultWriter`、`createKnowledgeWriteTool` 和 `registerKnowledgeWriter`。
固定工具 `knowledge.apply_note_patch@1.0.0` 接收：

```json
{"sourceId":"opaque-source","configRevision":1,"path":"demo.md",
 "expectedSha256":"64-character-source-sha256",
 "edits":[{"oldText":"唯一原文段落","newText":"整理后的段落"}]}
```

Schema 拒未知字段，最多 16 个精确替换，每段 16 Ki 字符、单篇/候选最多 512 KiB；
baseline 是原始文件字节的 SHA-256。工具只接受宿主通过原生文件选择器选定的普通 Markdown，
拒越界、链接、硬链接、配置/文件变更及不唯一匹配。保留 BOM、换行、原有 frontmatter、
wikilink、Markdown 内联/引用链接、引用定义与块 ID，不能删除笔记或目录。
链接保护采用保守平衡括号/转义扫描，连快捷引用及代码中的完整方括号文本也保留；
无法完整解析的括号跨度明确拒绝整理，不猜测链接目标。
Policy 必须授权 `knowledge:read`、`knowledge:write` 及底层明确声明的
`workspace:read`、`workspace:write`、`workspace:apply`；适配器不补造 scope、不自行签发授权。
Runtime/ToolGateway 的审批摘要绑定完整 sourceId/configRevision/baseline/精确 edits。

写入复用 `@personal-agent/coding-tools` 的 Windows FileShare.None helper：锁内核验 baseline、
写入、flush 和 SHA 读回。知识层先持久化独立备份、操作身份与每笔记 pending 锁；
成功后继续留存备份，回执只含相对路径、hash、operationId、backupId 和 verified/conflict。
成功回执应由 Runtime 重放，底层同 task/run 不重复执行；取消、超时或未确认结果不自动重试。
未知结果保留 pending 锁，由 host-only `reconcile({taskId,runId,argumentsDigest},context)`
确认 helper 退出并重新读回，返回 applied / not_applied / in_progress / unknown。
两次受信读回不一致时返回 unknown；unknown 不清锁、不回滚、不覆盖用户后续改动。
仍存在共享 helper marker 时只读桥保留两种锁并返回 `lockRetained:true`，即便已观察 applied/not_applied，
也须由可信 Runtime 另行核对持久执行记录后完成最终释放，不能调用会清 unknown marker 的共享默认清理。
恢复备份必须是另外一次明确审批的操作，
本包不增加自动回滚。备份正文和本机 receipt 留在独立的当前用户受保护 ACL 目录，
同一物理 Vault 重选也复用恢复目录和 pending 锁。
Runtime 工厂还提供 host-only `reconcileWrite({sourceId,configRevision,taskId,runId,argumentsDigest},context)`，
使用当前已选知识源读取原操作回执；本机重选同一物理 Vault 可核实旧 sourceId 下的操作。
该桥不注册新工具，不消耗或签发写权限，也不更新 Runtime 任务终态；
`waiting_reconciliation` 必须由受信 Runtime 另行核对持久执行记录和读回，不能直接改为 succeeded。

最终释放端口为 `KnowledgeWritePort.finalize(acceptedOriginal,{deadline,signal})`，
Runtime 工厂的 host-only 桥为 `finalizeWrite({sourceId,configRevision,acceptedOriginal},context)`。
外层 sourceId/configRevision 绑定当前用户选定的同一物理 Vault；acceptedOriginal 保留**原操作**的：
`taskId/runId/toolName=knowledge.apply_note_patch/toolVersion=1.0.0/argumentsDigest/operationId`、
完整 `originalInput`、已核实 `outcome=applied|not_applied/currentSha256`、
原 `executionRecordId` 和不透明 `readbackEvidenceRefs`。这些接受数据只能由可信 Runtime 核对
自己的原持久执行记录和读回 Evidence 后构造，不能来自 Renderer、模型、审批复选框或任意新 task。
桥不注册 model tool，不提供 Renderer 释放 IPC，不签发新 scope。

固定 `scripts/locked-finalize.ps1` 只处理本机恢复元数据：在源文件独占句柄范围重新读哈希，
独占原操作回执和两 marker、确认共享 marker 的原 run/digest/before/after 与停止进程，
先将可信 Runtime 接受回执写入独立 `knowledge-finalization.json` 临时文件并 flush/readback，
同目录重命名发布完整回执并再次核对，然后按已锁定句柄标记删除两个 marker。
原操作日志保持只读和字节完整；取消发生在元数据持久化期间也不损坏原身份。
已有接受回执保持不可变，身份、结果或 Evidence 引用不一致时拒绝释放。
它不写笔记正文、不删备份、不执行模型代码、不重试原 write、不改变 Runtime 终态。
原 marker 错配、当前文件未知、进程尚在/未知或旧 source/config/输入不一致时返回 `still_unknown`，
保留原现场；成功返回 `finalized` 和原已知 outcome/hash/operationId。
P8 只有核对该 finalized 元数据回执后才能在原执行记录上完成恢复，不能创建新 operation 代替旧 run。

准确限制：现有底层是锁内原地写入，**不是崩溃原子的文件替换**；应用/主机中断可能留下
部分结果，必须通过保留备份和 unknown 读回处理。路径/身份检查不是对恶意并发操作者的
OS 沙箱。本片不把该实现宣称为完整原子写入验收，也不扩展 coding-tools 原源。
Vault 的自动索引、LLM Wiki 和可安装 Obsidian 插件仍未交付。

私人结果不得因为截短就默认发送给 AgentArts。Competition availability/export 默认拒 private；
公开资料还需本会话 native 确认出机、精确查询 allowlist、同一任务/来源/配置版本。
公开读投影最多 5 条、每条 200 字、总计 16 KiB；写回执投影只有 state/changed，
不出机绝对路径、备份身份、operationId、原始 Evidence 或私人的正文。
私人预览只用于本机管理员；若将私人检索走 Runtime 本地任务，现有 SQLite 确认结果保留边界
仍见 ADR-0009，不能因此宣称私人 Runtime WAL/备份删除已验收。

P8 唯一共享接线：公开导出工厂、root lock 记录 knowledge→coding-tools 依赖，
构建顺序 coding-tools 在 knowledge 前；替换旧知识目录装配和截短出机投影；
main/preload/admin IPC 仅允许管理员调用 `knowledge.source.*`，选择器不接受 Renderer 路径；
`submitPatch` 走 prepare → bindTask → finalize → 原审批 UI；
`mountKnowledgeSourceControls` 用 `snapshot.knowledgeSource` 更新。
P7 knowledge-controls / knowledge-watch-host、private-memory/learning 与 Potatos 文件不在本包修改范围。

公开合成演示目录为 `packages/knowledge/demo-vault/`；用户本机选中后设置公开范围，
仅授权查询 `PA008演示` 并选 `公开资料.md`，可替换“待整理的演示段落”验证真实文件读回。
该目录只含仓库自编公开合成资料，仍需另外记录真实 AgentArts、完整 Desktop 和用户私人 Vault 验收。

定向检查入口：`packages/knowledge/test/write.test.mjs`、
`apps/desktop/test/knowledge-source-config.test.mjs`、`apps/runtime/test/knowledge-tools.test.mjs`。
不新增 wire Schema、数据库迁移、账户调用或付费模型依赖。

本工作包必要验证（2026-09-30）：现有 Node 24.19.0 / npm 11.16.0 与仓库要求
24.15.x / 11.12.x 有差异；未安装版本，也未宣称指定版本验收。
本树最少依赖安装后 contracts/coding-tools/knowledge/policy/tool-gateway 定向 tsc 通过，
Runtime 工厂以仓库相同 strict / NodeNext 选项单文件类型检查和发射通过。
首轮配置/Windows 真实合成文件写入 12/12 通过；独立评审新增 4/4 失败边界用例通过，
Runtime 工厂 Policy / 私人拒出机 / 公开绑定 / host-only 读回 4/4 通过，未跳过 Windows symlink 用例。
架构依赖门禁、JS 语法和 diff 检查通过。不运行全仓 check、旧只读搜索全套、旧 Desktop smoke、
真实私人 Vault 或真实云 API；最终共享接线、界面和 CI 由 P8 与唯一 PR 队列验收。
补充最终释放和尾窗检查：最后一次读回后的撤销会保留 pending 锁；受信已知原结果的最终释放
在真实 Windows 独占句柄下清两 marker 而不再次写笔记；原 marker 错配和用户改动则留两锁，
这三个新用例分别通过，未重跑旧 12/4/4。必要 root build 顺序与单依赖 lock hunk
来自 P8 的 `be9c093`，本分支只按授权交换 coding-tools/knowledge 顺序，不带入未合并 MCP/Skills。

## 历史只读分片

Competition Profile 的 MOD-08A 只交付 `KnowledgePort.search` 契约及显式测试
`createFakeKnowledgePort`。可信宿主创建时绑定一个 Vault；消费者仅能以文字查询，
得到有上限的匹配行及 `vaultId/path/line/revision` 引用。引用中的 revision 是测试文档
内容的 SHA-256，不代表真实 Obsidian 文件版本。

Fake 只扫描传入的合成 Markdown 文本，不读取文件系统、不调用模型、不写入数据。
查询最多 128 字符、20 条结果；测试 Vault 最多 100 篇、每篇 256 KiB。
超出范围、取消及到期均明确报错。此包不注册 Runtime capability，不提供真实
Vault 授权、索引、同步、写入或 LLM Wiki。不能把 Fake 测试视为真实知识检索验收。

构建与测试：

```powershell
npm.cmd run build --workspace=@personal-agent/knowledge
npm.cmd run test --workspace=@personal-agent/knowledge
```

MOD-08B 增加 `@personal-agent/knowledge/filesystem` 的脱机只读适配器。
可信宿主必须先完成用户授权，再以绝对路径显式绑定一个 Vault；搜索请求本身不能
指定根目录。适配器只读取 Vault 内普通 Markdown 文件，拒绝目录链接/符号链接、
路径越界、无效 UTF-8、超大或在读取中变化的文件；引用读回会重新校验内容摘要。
它不会写入、持久化正文、记录日志或发送云端。

当前采用每次查询重扫，最多 1000 篇、1000 个目录、16 层、每篇 512 KiB。
隐藏目录和文件不参与检索。超限或读失败会明确报错，不返回看似完整的部分结果。
这是脱机文件路径，不是 Obsidian Vault API 插件；在可对抗的并发文件替换环境中，
路径校验不能替代 OS 级沙箱。没有生产 Runtime/Policy 默认注入、真实私人 Vault 验收、
持久索引、写入或 LLM Wiki，因此生产 capability 仍 unavailable。

MOD-08C 新增可注入的 `@personal-agent/knowledge/tool`：固定名称
`knowledge.search`、范围 `knowledge:read`，由现有 ToolGateway 在执行前
检查 Policy 授权、任务、参数摘要和期限。可信宿主只能显式注入一个已绑定 Vault 的
`KnowledgePort`；工具参数只有查询文本与结果上限，不能指定 Vault 路径。
本片仅在合成 Vault 上验证，未在 Desktop/Runtime 默认注册，也没有向 AgentArts
发送私人内容。直接调用工具对象不是授权机制，生产必须通过现有 Gateway。

MOD-08D 增加插件侧只读适配器；持久索引与 LLM Wiki 留待后续工作包。接口保持 provisional，
调用方不得默认启用或失败回退 Fake。

MOD-08D 的 `@personal-agent/knowledge/obsidian` 是面向
[Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault) 的插件侧只读适配器，
由可信宿主显式传入 Vault、Vault ID 和允许的文件夹（`/` 表示明确选择整个 Vault）。
它使用 `getMarkdownFiles()`、`read()` 和 `getAbstractFileByPath()`，仅搜索范围内的
Markdown，返回内容摘要引用；文件修改、移动或删除后旧引用读回会被拒绝。
每次搜索最多 1000 篇、每篇 512 KiB，不建立持久索引、不写入或上传正文。
Obsidian 的单次 `read()` 不支持中途取消；适配器在调用前后检查取消和期限，
取消后丢弃返回内容。当前没有插件入口、用户选库流程或 Runtime 默认注册，
合成 Vault 测试不能替代真实插件和私人 Vault 验收。

MOD-08E 用合成 Vault 验证 Competition Runtime 显式注入 `knowledge.search` 后的
Fake 工具提案、本地审批和一次性执行；审批前不读取，真实云端提案仍在执行前拒绝。
审批拒绝时不检索，也不产生发往编排端的 continuation。
该测试不启用生产注册，不读取私人 Vault，也不允许将私人检索结果发给 AgentArts。
生产接线前必须另行确定用户选库授权和独立的云端发送范围/同意流程。
注意：本包的适配器本身不持久化正文，但现有 Runtime 会把确认后的工具结果
写入 SQLite 检查点。私人 Vault 接入前还需解决本地保留/WAL/备份和重启重放边界，
参见[ADR-0009 提案](../../docs/adr/0009-knowledge-data-boundary.md)。
