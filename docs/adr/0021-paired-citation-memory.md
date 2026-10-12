# ADR-0021：配对插件引用与逐条私人记忆

- 状态：proposed
- 日期：2026-10-11；负责人：goo122；Profile：huawei_ict_agentarts
- 依赖：ADR-0019/0020、PR #322、provisional WikiPort 与私人记忆宿主

## 缺口与决定

版本 1 桥接只有 search；其临时 sourceId 不能直接成为持久 Wiki 引用，私人记忆页面仍读取
原文件源。扩展现有 peer 的可选 readCitation，沿用 KnowledgeSource 四字段与字符串摘录，
使用版本 2 的 PA2 配对码和认证帧。新客户端接受 PA1 搜索，但旧连接不提供引用能力；
旧客户端拒绝 PA2，需同时更新插件与 Desktop。不增加通用 RPC、写入或云权限。

新增帧为 `{version:2,kind:'citation',id,source,deadline}`；source 仅 vaultId/path/line/revision，
必须匹配已配对 Vault 和 Markdown 文件夹，未知字段拒绝。返回沿用 result 帧，result 为
最多 4000 字的单行摘录。预期失败仅返回固定 KnowledgeError code 的 failure 帧，不传异常
文本；协议错误、取消或超时仍关闭会话。一条在途读取与原有 TLS/期限/上限保持一致。

Runtime 的 Wiki 租约复用 createWikiPort 与本机受信来源可选 readPage，只针对插件检索命中
读取稳定 pageId 和内容版本；不调用本机 search 或 scanPages。引用读取必须同时通过
本机页身份/版本、插件实际摘录以及读取后的本机版本校验。任何一方不可用或不一致都拒绝，
没有文件源回退。插件自报 SOURCE_CHANGED 或替换摘录仅使证据 unavailable，不能自行撤回
已确认事实；只有本机受信读取证明版本改变才能触发现有来源失效投影。scanPages 明确
unavailable，不将缺页当作删除或声称可验证移动。

持久引用使用原本机 sourceId/configRevision/namespace 和私人 dataLevel；任务检索继续使用
每次配对的新 sourceId。两者用途分开：前者标识证据，后者隔离会话授权。重启可列出已保存
记忆，plugin 模式仍 unavailable；重新配对相同来源后才能验证持久引用。旧搜索结果的期限、
来源或版本不能复用。通过专用 memorySource 选择与 epoch 租约接入既有私人记忆控制器，
不会在插件失效时自动使用文件源。文件源监视在 plugin 模式暂停，不在后台越过配对文件夹。

复用 ingestConfirmedPrivateCitation、原生逐条确认、CAS 事实版本、撤回与删除协调。
确认显示准确摘录、拟保存摘要和来源版本，默认取消；保存前再次读回，不自动存储。
数据仍在原私人 SQLite/备份体系，无数据库迁移、新依赖、task wire capability 或第二套 feed。

## 验收边界

验证 Fake 内容批准、合成 Vault 的实际 Obsidian/Electron 双进程保存/重启/撤回/删除，以及
版本替换、取消、来源切换和越界拒绝。原 Vault 保持只读，云调用为 0。真实人类逐条确认、
云消费、非作者评审和主线集成分别记录；接口保持 provisional，整个 MOD-08/09 不转 done。
