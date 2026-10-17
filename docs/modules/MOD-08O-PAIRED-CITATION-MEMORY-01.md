# MOD-08O：配对插件引用与逐条记忆确认

> 公开脱敏投影：历史命令中的机器专属路径已改为接收者可配置占位或仓库相对路径；日期、数值、失败与原哈希保留。占位不是可直接执行的配置，运行前使用本机受信Node/npm、工作树及运行环境路径。

- 状态：review；#323 已合入 #322 父分支，尚未进入 main；来源恢复验收增量已验证并获独立 PR 交付授权
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

### 2026-10-12：实际重启后重新配对与引用恢复

- 本次更新前刷新远程，#320/#321/#322/#323 均为 OPEN、当时 head 两项 Foundation 成功
  （#323 为 `39b6bd7e`）；本次新 head 的 CI 以 PR 读回为准。
  #321 的历史失败已重跑成功，无需以新产品代码修复。尚无非作者评审，未合并。
- 本次只扩展既有定向/双进程验收并更新文档，无生产接口、行为、依赖或迁移变化。
  `node --check tests/manual/obsidian/desktop-pairing.mjs` 与
  `node --test apps/desktop/test/paired-citation-memory.test.mjs apps/desktop/test/obsidian-pairing.test.mjs`
  均退出 0，13 tests / 13 pass；`.cache/paired-citation-recovery-tests.log`。
  新断言证明旧租约在重启后拒绝，重新配对的来源身份不同且旧绑定不能获取新租约。
- 使用同一实际双进程命令，最终退出 0；
  `.cache/paired-citation-recovery-dual-process-final.log` 与
  `.cache/obsidian-installed-host/case-9AaW0i/evidence.json`（verified）。
  实际 Desktop 重启后，原配对码经专用密码窗口提交仍被拒绝、不触发新的原生批准。
  重新生成 PA2 并原生 Fake 批准后，搜索恢复，任务使用新的 sourceId。
- 新记录器在实际 plugin peer 引用读取之后只记录 path/line/revision，保留原只读端口。
  查看持久记忆触发实际插件读回；已确认事实、稳定 pageId 和内容版本不变。
  新预览返回准确摘录，同一摘要重复保存保持版本 2、不弹出内容确认、不新增事实。
  重新撤销后搜索再次拒绝/禁用，仍能撤回目标至版本 3、删除所有版本并保留无关事实。
- `desktop-memory-repaired.png` 已目视核对恢复后的搜索、目标版本 2 与无关版本 1；
  evidence 检查无配对码/secret/私钥。Fake 批准、合成 Vault/SQLite、云调用 0 和原 Vault
  未访问/修改的边界不变；本次进程已关闭、合成插件已卸载。
- 首轮验收记录器试图改写冻结端口且 CLI 结果为数组，导致验收失败；改为观察现有 peer
  并返回有界 JSON 对象后通过。失败日志 `.cache/paired-citation-recovery-dual-process.log`
  保留，不作为成功证据；没有放宽产品校验。
- 本次增量结果为上述 13/13 与实际双进程；完整 check 的 2714/2689/25 记录来自
  2026-10-11 已交付代码，未冒称本次重新运行。

## 交付与剩余边界

2026-10-12 非作者对 #320～#323 提出共同继承的原写入恢复 P2；已将源修复 `5918e706`
按依赖栈同步至本包。配置变化不阻断原写入确认，旧投影绑定与读取权限检查保持；原写入
核实后再独立恢复投影，不重写正文。定向 15/15，最终本包组合 check 2717/2692 pass/
25 skip/0 fail，实际双进程配对/重启/已存引用/撤回删除继续通过；证据与边界见
[MOD-08I 修复记录](MOD-08I-WIKI-WRITE-RECOVERY-01.md)。新的 head 待远程门禁与非作者
复核，原 CHANGES_REQUESTED 留存；与其他未合并 PR 的组合冲突未在本包宣称解决。

实现提交 `2718f064` 已推送至 [PR #323](https://github.com/zemeng5208/PersonalAgent/pull/323)，
base 为 PR #322 分支 `codex/goo122-desktop-unicode-pairing`。这是原交付快照；2026-10-12
#323 已由外部 squash 合入 #322，提交 `38a41c4d`，不等于进入 main 或产品发布。
本节交付记录为后续纯文档提交，不改变上述已验证代码；远程 CI 状态以当前 PR head 为准。

真实人类逐条内容确认、真实私人数据出机和 AgentArts 云端验收未执行。插件页移动的全库
扫描不提供；缺页保持来源不可核实。接口 provisional，待非作者评审和依赖栈集成。
完整 MOD-08/09 仍 in_progress，本包不合并或发布。

### 2026-10-12：来源离线变更、改名与临时缺页恢复验收

- 工作包：MOD-08O 来源恢复验收；负责人 goo122；Profile `huawei_ict_agentarts`。
  隔离工作树 `.worktrees/goo122-wiki-source-recovery-acceptance`，分支
  `codex/goo122-wiki-source-recovery-acceptance`，基线 #322 `18635529`。
  复用现有 paired-citation 回归与实际 Obsidian/Desktop 验收，没有新建产品执行入口。
- 本包仅修改测试、验收脚本和文档；无生产代码、公共协议、接口状态、迁移、依赖或权限变化。
  Wiki/记忆接口仍 provisional。用户要求的非作者评审继续执行，不以存量文档的自审规则替代。
- 定向命令 `node --test --test-reporter=tap apps/desktop/test/paired-citation-memory.test.mjs apps/desktop/test/obsidian-pairing.test.mjs`
  退出 0：**17/17、0 skip**。来源被编辑时追加一次撤回，原引用不可消费；改名、越界和
  暂时缺页返回 source_unavailable，不追加事实、不推断删除。原路径恢复后仍是原版本；
  无关事实可获得显式 Fake 消费授权，目标失败在授权回调之前，原文件检索 fallback 禁用。
- 删除/备份/来源观察命令运行 `private-memory-backups.test.mjs`、`private-memory-erasure.test.mjs`、
  `wiki-memory-source.test.mjs`、Runtime `wiki-source-monitor.test.mjs`，退出 0：**20/20、0 skip**。
  保留原有逐事实应用副本清理、不相关任务/检查点保留、未知结果恢复，以及相关整篇备份
  保留时删除仍未完成的约束。本包未扩展删除保证到应用不管理的独立副本。
- 实际命令 `node tests/manual/obsidian/plugin-installed-host.mjs --executable <Obsidian.exe绝对路径> --dual-process`
  退出 0；Obsidian 1.12.7、实际 Electron Desktop、原生密码窗口、Preload/IPC/TLS 和 SQLite
  在独立合成 Vault 中运行。最终证据 `.cache/obsidian-installed-host/case-urpZzt/evidence.json` 为 verified，
  不是云端或真实私人数据验收；逐条内容、消费和配对决定全部 **explicit Fake**。
- 实际流程：A/B 确认至版本 2；改名/移出允许文件夹/暂存原文件后重新配对，旧引用拒绝，
  已保存事实和无关版本 1 不变；同一文件恢复不新增版本。断连后编辑正文，断连期间不
  推断变化，重新配对读回后旧事实变为 external_observation 撤回版本 3；不自动保存新内容。
  原正文恢复也不复活事实。新摘录经一次独立 Fake 原生确认成为版本 4；断连后手动撤回
  成为版本 5，再删除所有版本并读回，仅剩无关事实；原合成笔记还在。
- 截图 `desktop-memory-source-changed.png` 和 `desktop-memory-erased.png` 已目视核对：
  来源变化时显示“后续任务不可消费”，目标删除后无关记忆保留、失效配对的搜索禁用。
  evidence 已检查无配对码、secret、token 或私钥；本次启动的应用进程按原脚本关闭，合成
  插件卸载。云调用 **0**；原 Vault `<private-vault>` 未访问、未修改，没有保存其中新事实。
- 首轮 unit 夹具误将消费授权注入删除回调，修正为 authorizeConsumption 后全通过；首轮
  双进程“临时缺页”夹具删除重建文件，触发正确的 SOURCE_CHANGED。改为暂存/恢复同一个
  文件，不放宽身份/版本断言。失败日志保留 `.cache-wiki-recovery-focused.log`、
  `.cache-wiki-recovery-dual-process.log`；最终日志 `.cache-wiki-recovery-focused-verified.log`、
  `.cache-wiki-recovery-erasure-source.log`、`.cache-wiki-recovery-dual-process-verified.log`；
  最终同一命令合并运行六个回归文件 **37/37、0 fail/取消/skip**，日志
  `.cache-wiki-recovery-final-tests.log`。补证已撤回的当前版本也在消费授权之前拒绝，实际
  手动撤回版本 5 明确读回，双进程最终日志 `.cache-wiki-recovery-dual-process-final.log`。
- 本次没有重跑全仓 check，不把上文历史完整门禁计数作为本包新结果；本包行为验收为
  上述 **37 项回归**及实际双进程。本包已获提交、普通推送与独立 PR 授权，以 #322 为 base；
  新提交的 Foundation 与非作者评审单独核对，模块不转 done。
  最新 #320 相对 main 存在冲突，#320→#321→#322 尚未进入 main；集成仍是独立下一步。
