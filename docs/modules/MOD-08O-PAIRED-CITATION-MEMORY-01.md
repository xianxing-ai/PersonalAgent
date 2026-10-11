# MOD-08O：配对插件引用与逐条记忆确认

- 状态：ready；实现与本包验收通过，待 Git 交付、非作者评审/集成
- 日期：2026-10-11；Profile：huawei_ict_agentarts
- 负责人：goo122；非作者评审：zemeng 或其他已登记协作者
- 工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-paired-citation-memory`；基线：PR #322 `7f1b4f1b`
- 依赖：provisional WikiPort、私人记忆/删除协调、MOD-08M/N 认证桥接

## 范围

方案、兼容性和证据身份见 [ADR-0021](../adr/0021-paired-citation-memory.md)。桥接版本 2
新增有界 readCitation 与固定错误码；PA2 要求插件/Desktop 同时升级，新客户端仍可用
PA1 搜索，但 PA1 无确认引用能力。复用原有四字段 KnowledgeSource，不增加 task wire
operation、依赖或数据库迁移。

Runtime 的 Wiki 租约使用原本机来源的稳定 sourceId/configRevision/pageId，并对插件
文件夹内的检索命中读取本机页身份和版本。实际摘录由插件经认证连接读回，本机在之后
再次核对。插件失效或任一侧不同则拒绝；不使用本机 search/scanPages，不静默回退。
插件自报变更或替换摘录只能使证据 unavailable，不能自行撤回已确认事实；本机验证版本
改变时才复用现有来源失效投影。plugin 模式暂停文件源监视。

Desktop 私人记忆页选择当前配对来源，预览准确摘录，原生确认显示来源版本、摘录及摘要，
默认取消且跟随来源信号/期限。复用原 ingestConfirmedPrivateCitation/CAS，不自动保存。
重复提交已存在内容不创建版本；更正仍逐条确认。增加现有撤回操作的管理页按钮，删除继续
使用应用副本/备份协调；整篇相关备份保留并报告删除未完成。

重启后记忆头仍可管理；plugin 模式保持 unavailable，不恢复旧 session。重新配对同一
来源后才能检查持久引用，旧任务授权不复用。原 Vault 只读，云验收继续暂缓。

## 验证记录

- 定向 Runtime/Wiki/记忆/实际插件包组合 12/12 通过：`.cache/paired-citation-focused-closure.log`。
  最终信任边界补充之后的结果以完整 check 为准。
- 正常沙箱无法选择合成本机 Vault；切换到平台授权的 Windows 本机测试环境，没有
  放宽产品身份校验。初轮测试发现超限摘录应断连及测试夹具回调/租约期限错误，已修正；
  初轮日志保留，最终验证另记。
- 最终 `npm run check` 退出 0：2714 tests / 2689 pass / 25 skip / 0 fail / 0 cancelled，
  包含架构、生成类型、类型检查、workspace 与根集成；日志 `.cache/paired-citation-full-check-final.log`。
  使用既有隔离 .NET SDK 8，保留中文 TEMP；没有系统配置变更。
- `npm run test:smoke --workspace=@personal-agent/desktop` 退出 0；日志
  `.cache/paired-citation-desktop-smoke-final.log`。该 smoke 使用 Fake Runtime，不能作为云端证据。
- 真实双进程命令：`node tests/manual/obsidian/plugin-installed-host.mjs --executable <Obsidian.exe> --dual-process`，
  退出 0；实际 Obsidian 1.12.7 与 Electron 44.2.0，独立合成 Vault/SQLite，
  记录 `.cache/paired-citation-dual-process-closure.log` 与
  `.cache/obsidian-installed-host/case-lGTWJV/evidence.json`（state verified）。
  实际原生密码窗口、IPC、TLS、Runtime/Policy 检索和管理页保存/更正/撤回/删除均执行；
  逐条内容、配对与撤回/删除决定均为 **explicit Fake**，不代表真实用户批准。
- 合成流程先取消保存并验证 0 事实，再保存 A、重复提交保持版本 1、更正 B 为版本 2，
  同时保存无关事实。实际插件撤销与 Desktop 活跃配对重启后，检索拒绝且界面搜索禁用；
  已存事实保留。撤回目标为版本 3，再删除所有版本并读回，仅剩无关事实；原笔记保留。
  最后显式恢复文件源，关闭本次启动的进程、卸载合成插件；云调用 0，原 Vault 未访问/修改。
- 复验修复了 PA2 被验收码读取器/原生窗口的旧 PA1 校验拒绝，以及记忆页仍按原文件源
  显示可用的缺陷。原生版本输入回归 5/5；最终完整 check 与上述双进程已包含产品修复。
  最新截图 `desktop-memory-erased.png` 已目视核对失效提示、搜索禁用、目标删除和无关事实；
  evidence 不含配对码、secret、私钥。失败轮次保留于独立缓存，不充作成功证据。

## 剩余边界

真实人类逐条内容确认、真实私人数据出机和 AgentArts 云端验收未执行。插件页移动的全库
扫描不提供；缺页保持来源不可核实。接口 provisional，待非作者评审和依赖栈集成。
完整 MOD-08/09 仍 in_progress，本包不合并或发布。
