# @personal-agent/knowledge — provisional Vault ports

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-08（goo122）。产品流程：F04、F05；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用Wiki来源、配对引用、正文写入及恢复；检索来源可追溯，不把跨文件/SQLite称为原子事务。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

## 本机会话配对端口（MOD-08M）

`@personal-agent/knowledge/pairing` 公开严格版本化 `ObsidianPairingDescriptor`、
`ObsidianPairingPeer`、描述解析、物理 Vault 身份摘要和只读 peer 工厂。
身份以规范路径及文件系统标识计算，不使用可碰撞的 Vault 显示名。描述不携带绝对路径、
凭据或正文，且不构成授权。插件连接撤销和卸载中止 peer；Runtime 验证结果 Schema 与
相对文件夹范围。仅供可信 composition；跨进程公开桥接见下一节。
兼容与验收见 [ADR-0019](../../docs/adr/0019-obsidian-runtime-pairing.md) 和
[MOD-08M](../../docs/modules/MOD-08M-UNICODE-PAIRING-01.md)。

## 本机认证桥接（MOD-08N）

`@personal-agent/knowledge/bridge` 提供 `createObsidianBridgeOffer(peer)`、
`parseObsidianBridgeCode(code)` 和 `connectObsidianBridge(code,context)`。
插件显式生成一次性 32 字节随机密钥，监听 127.0.0.1 随机端口，TLS 1.3 加密。
Windows 原生 API 在内存生成临时证书，Desktop 先固定证书指纹，再发送密钥认证。
配对码 2 分钟有效；一个成功连接后停止监听，拒绝重用、描述替换与证书认证回退。
最多一个在途只读检索，每帧 128 KiB、每次读取 30 秒、会话 15 分钟。
取消、断连、非法消息和卸载关闭会话；无自动重试、写入、云端发送或持久凭据。
协议版本与严格字段见 [ADR-0020](../../docs/adr/0020-obsidian-authenticated-bridge.md)，
状态仍 provisional；配对码及结果均不能签发 Policy grant。

MOD-08O 使用 PA2/版本 2 帧增加 peer 的可选 `readCitation`：四字段 KnowledgeSource，
严格 Vault/文件夹/版本校验，返回最多 4000 字单行摘录或固定错误码；没有任意文件 RPC。
新客户端兼容 PA1 的搜索，但 PA1 不提供引用能力；旧客户端拒绝 PA2，需同时升级插件和
Desktop。Runtime 的 `wikiSource.acquireWiki` 结合本机稳定页身份与插件摘录重新验证，
使用既有 WikiSource 和逐条确认，不以临时任务 sourceId 标识长期事实。缺少任一侧证据即
unavailable；详见 [ADR-0021](../../docs/adr/0021-paired-citation-memory.md)。

## Wiki 第一包：只读来源身份与版本（MOD-08G）

`@personal-agent/knowledge/wiki` 提供 provisional 的 `WikiPort`：
`scanPages` 返回页面清单，`search` 返回带绑定信息的引用，`readCitation` 核对当前
页面身份和正文 revision 后返回所引用的一行。受信宿主选择已授权的整个根目录，
显式绑定 sourceId/namespace/configRevision/dataLevel/validUntil，并通过 `isCurrent()` 在每次
异步读取前后检查捕获的配置与读取许可；模型、Renderer 和正文不能提供此回调。
不授予写入、长期记忆确认或出机权限。

```js
import {openReadOnlyWiki} from '@personal-agent/knowledge/wiki';
const wiki = await openReadOnlyWiki({
  vaultId: source.vaultId, rootPath: source.rootPath,
  sourceId: source.sourceId, namespace: source.namespace,
  configRevision: source.configRevision, dataLevel: source.dataLevel, validUntil: readLease.validUntil,
  isCurrent: () => host.hasCurrentReadLease(source.sourceId, source.configRevision)
});
const pages = await wiki.scanPages({deadline, signal});
```

示例的 `source/host/readLease/deadline/signal` 由受信调用方提供，不能从模型请求自动产生。
Desktop 私人记忆已通过受信知识源配置装配此入口；不新增 Runtime capability。既有 `KnowledgePort` 消费方
保持原接口，不能将 Wiki 引用直接塞进旧工具的 wire 输出。

页面 ID 基于根目录和文件的原生身份（bigint dev/ino/birthtimeNs），正文 SHA-256
作为 revision；同内容的不同文件不会合并。同卷 rename 保持 ID，重新打开同一来源
也保持 ID；复制、跨卷移动、编辑器替换保存视为新页面。根目录替换或硬链接明确拒绝。
旧位置缺失/不可读返回 SOURCE_UNAVAILABLE，身份/版本不符返回 SOURCE_CHANGED。
扫描复用既有上限，不是全库原子快照；空清单或失败不授权删除事实、索引或原文件。
读取到来源变化时拒绝结果；没有 watcher、持久索引或自动确认。

`formatWikiCitationReference/parseWikiCitationReference` 生成/读取稳定的 `wiki-v1:` 证据引用，
不保存短时许可的有效期；`readReference` 只能在当前可信 lease 中核实该证据。
Desktop 的逐条确认及按需来源失效投影见 [MOD-08H](../../docs/modules/MOD-08H-WIKI-MEMORY-PROJECTION-01.md)。

显式测试可用 `@personal-agent/knowledge/testing` 的 `createFakeWikiPort`，其路径派生
ID 仅用于固定夹具。`createUnavailableWikiPort` 明确报不可用，不回退 Fake。
完整边界与验收见 [MOD-08G](../../docs/modules/MOD-08G-WIKI-SOURCE-REVISIONS-01.md)
及 [ADR-0022](../../docs/adr/0022-wiki-source-identity.md)。


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
本地 MOD-08K 增量提供每次查询重新验证来源的临时全文行索引（总正文上限 8 MiB），
以及 `apps/obsidian-plugin` 的可安装只读插件包；尚未评审集成或完成真实 Obsidian 宿主验收。
持久全文索引、插件 Runtime 配对和完整 LLM Wiki 仍未交付。

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
