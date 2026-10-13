# PA020 私人记忆与流程学习生产桥

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 2026-10-06 收口验收矩阵（2026-10-07 更新）

目标 profile 为 `huawei_ict_agentarts`，负责人 goo122。远端 main 核对基线为
`e86bac5382180495854923dbcf4ca9bbaf3a9b55`（2026-10-08 复核）；原生验收基线为 `74b64c35`，后续仅交接文档变化。共享根工作区保留，不作为本轮验证基线。
保留本节标题以兼容已有链接；最新真实本地结果见 [2026-10-08 验收记录](MOD-09-REAL-LOCAL-LIFECYCLE-20261008.md)。
本节区分当前集成状态与下面保留的历史验收记录，不将阶段测试累计成完成百分比。

| 验收项 | 当前证据 | 剩余条件 |
| --- | --- | --- |
| 同步消费门禁、实际 Runtime 父子副本清除 | #285 已合并；实际 SQLite/Runtime 回归，云响应与确认回调为 Fake | 原生许可和真实云消费不能由该回归替代 |
| 流程验证、启用、回退、重启与删除 | #289 已于 2026-10-06 合并，提交 `1ecab685960c364016364d171fdc00a704aeccb5`；实际官方 filesystem stdio、Client、SQLite Policy/Runtime，公开合成文件 | 真实用户流程与原生启用/回退另验 |
| 撤回后管理、全版本删除及取消异常恢复 | #294 已进入 main；#304/#305 原生控件及来源状态保护也已合并。2026-10-08 真实原生撤回 v3、重启管理、三版本删除及再次重启无复活通过 | 取消异常与混合批次无关数据保留仍为合成回归；新增真实副本或恢复路径需另验 |
| 真实来源持久生命周期 | 用户逐条确认 A/B 并委托原生操作；独立正式装配完成保存 v1、更正 v2、重启读回、撤回 v3、全历史/回执删除及重启空查询；原文件哈希不变 | 本轮仅一条已确认事实；无关多事实保留不能冒充真实验收，详见本次记录 |
| Electron 原生交互 | 2026-10-07 只读/取消通过；2026-10-08 真实保存、更正、撤回、删除对话与已保存列表通过，未用替身确认器；#304/#305 已合并 | 本地确认不授予云发送或子任务消费许可；GitHub reviews 为空的已合并 PR 仍需按用户工作规范补核非作者评审 |
| 私人 parent→child 消费 | 当前私人派生提案在审批、工具执行和子任务创建前拒绝；父许可不传递给子任务 | 与 P8/认知负责人明确交付范围及逐任务许可；保持拒绝行为，不用副本删除测试冒充消费支持 |
| 真实 AgentArts 消费 | 本工作包没有真实云调用证据 | 可用部署、明确任务目的地及独立出机/云调用授权；记录 deployment/version/trace、本地 Evidence 和读回 |

`74b64c35` 的 Foundation 重跑终态为 success；首次失败记录保留，后续工作包 CI 另核对。
执行顺序：交付本次脱敏验收记录与矩阵
→ 明确 parent→child 范围和逐任务许可 → 独立授权后的真实 AgentArts 消费及用户流程验收。
已确认 A/B 的本地原生生命周期通过，不重复索要相同本地授权；
不得使用 Fake 自动确认私人内容、使用其他账号自评或因 CI 成功提前合并。
MOD-09 保持 `in_progress`、接口保持 provisional，只有约定验收、非作者评审和集成都满足后再调整状态。

## 2026-10-06 撤回后的管理入口补修

目标 profile：`huawei_ict_agentarts`；goo122 延续在途 MOD-09 工作，状态 `in_progress`。
基线 `e02865c`；隔离工作树 `.worktrees/mod09-withdrawn-memory-management`，
分支 `codex/mod09-withdrawn-memory-management`。保留已有原生验收实例和共享工作区。

- 失败复现：私人记忆更正为 v2、撤回为 v3 后，重启时管理列表只查询有效事实，
  找不到撤回头，无法从列表选择全部历史删除。新增合成用例在修复前准确失败。
- SQLite 新增 host-only `listUserFactHeads`，复用原快照/游标和水位，列出每条
  `private/user_confirmed` 的当前头，包括撤回和过期；最新头不满足范围时不回退。
  管理快照与 consumer query、其他 namespace 隔离，删除时失效相关快照。
- Desktop 管理列表使用该端口，展示版本和撤回状态。撤回或删除确认成功后刷新列表，
  任务选择只保留有效 active 引用；取消不刷新或改写引用。
- 不新增 wire operation、Schema、迁移或依赖。`MemoryQueryPort` 的有效查询和任务消费授权不变，
  接口仍为 provisional。真实原生逐条确认、真实来源持久生命周期和真实 AgentArts 消费尚未通过。
- 验证：`npm ci`、根构建、native Release 构建通过；定向回归 35/35、Memory 工作区 44/44，
  根集成 22/22。数据和确认回调均为显式合成，不构成原生确认或真实云端证据。
  `npm run dev`、`demo:protocol`、`demo:runtime` 均通过；Runtime 演示 verification 为 mock。
- `npm run check` 的架构、协议夹具、生成检查与全工作区类型检查通过；工作区测试共
  2074 项，2047 通过、2 失败、25 跳过。失败代码均未修改：Desktop
  `coding-tool-host.test.mjs:72` 在默认 TEMP 环境的装配断言失败。最初观察到 `where.exe`
  输出解码后路径不匹配，但当前主线已经直接搜索 PATH，该观察不能作为本次装配失败的根因。
  另 `windows-host-fixture.test.mjs:34`
  要求稳定 .NET 8 SDK，本机只枚举到 SDK 10.0.302；已有 .NET 8 Runtime 不等于 SDK。
  此为首次运行的失败记录，未修改这些门禁或顺带扩展 Windows 宿主范围。
- 2026-10-06 环境复核：微软官方 SDK 8.0.425 zip 经官方 SHA-512 校验后解压到项目忽略缓存。
  仅验证进程使用该 SDK，并把 TEMP/TMP 指向工作树外的项目缓存；原宿主装配门禁单独通过，
  两项 Windows 门禁合计 7/7。默认 TEMP 兼容问题仍待 Windows 宿主负责人定位；本补修不声明解决它。
- 隔离环境完整 `npm run check` 通过：工作区测试 2074 项，2049 通过、0 失败、25 跳过，
  根集成 22/22；架构、协议夹具、生成检查和类型检查均通过。验证条件如上，不宣称默认 TEMP 兼容修复。
- 本增量通过独立 PR 交付；当前提交的远程 CI、非作者评审与合并仍为集成条件，
  不把本地通过记作主线交付或 MOD-09 完成。

### 同日继续：删除待清除状态与 Electron 合成回归

- 管理页此前把私人来源已删除、关联任务副本仍待清除的 `pending` 误报为“已取消”。
  Renderer 合成响应准确复现该问题；现在刷新当前头，显示删除尚未完成，不保留已删除引用供任务选择。
  独立控件对 `private_copy_erasure` 同样刷新；拒绝确认保持原引用。
- 更新已有 `apps/desktop/test/private-memory-smoke.cjs`：旧回环网关不满足当前可信配置校验，
  旧“所有私人写入禁用”和 fixture-root 开关也已不符合 main 的生产装配。现在以合法合成目标、
  空云凭据和独立 userData 启动正式 Competition 装配，不配置真实账号、不提交云任务。
- 实际隔离 Electron 回归通过：替身确认取消/保存、更正 v2、拒绝撤回、撤回 v3 后自动刷新、
  无消费按钮、关闭重启且不重新选择 Vault、拒绝删除保留三版本、删除三版本、再次重启仍为空。
  原夹具文件字节保留；验证进程 fetch 陷阱计数为零。待副本清除展示使用显式 Renderer fixture。
- 原生 Computer Use 初始化及重置后重试仍报 `trusted Node process exited unexpectedly`，
  没有原生窗口输入；上述自动化与替身对话不代替真实用户逐条确认或真实 AgentArts 验收。
- 本补修 Desktop 类型检查与完整模块测试通过：444 项，442 通过、0 失败、2 跳过；
  沿用上节的隔离 SDK/TEMP 验证条件。无公共接口、迁移或 Runtime 执行语义变更。
- 首提交 `e829aef` 的远程 Foundation run `37446016736` 失败于未修改的 Calendar
  `cloud-business.test.mjs:88`：deadline 预期 `TIMEOUT`，实际 `EXTERNAL_FAILURE`；同一用例本机复跑通过。
  该目录不在本 PR diff 中，保留失败记录，不据复跑通过宣称远程门禁通过；后续提交须重新核对 CI。

### 同日继续：删除提交后的取消异常恢复

- 新用例准确复现：私人来源删除已提交，取消某个派生任务抛错，清理整批中断，
  不能返回该副本的 pending 状态或继续处理其他目标副本。
- `private-memory-erasure-host.js` 将释放、取消和精确副本清理纳入原失败收集边界。
  取消失败保留该 taskId 为 pending，继续处理同事实的其他副本；恢复只使用原删除标记。
  已有精确 `taskId/factId/bindingDigest/purged` 收据的副本跳过释放、取消和清理，
  失配收据仍不能当作完成。不改 Runtime 取消受理语义，不重放工具或云调用。
- 合成源库及替身取消端口复验覆盖部分清理、重启恢复、重复恢复零取消和无关副本保留；
  连同实际 Runtime 父子副本、生产管理/消费门禁定向 13/13 通过。
  无 Schema、公共 operation、数据库迁移、依赖或权限变化。
- Desktop 类型检查与完整模块测试通过：445 项，443 通过、0 失败、2 跳过；
  隔离 Electron 合成生命周期再次通过，fetch 陷阱计数零。沿用前述 SDK/TEMP 条件，
  原生逐条确认及真实云端验收仍未完成。
- 中间提交 `ce95539` 两项 Foundation（run `37447588019`、`37447583221`）成功，
  暂无非作者评审。该证据仅覆盖此取消异常补修之前的提交；新提交须重新验证 CI 和评审。

## 2026-10-05 主线确认与实际 MCP 学习验收

目标为 `huawei_ict_agentarts`，工作树 `.worktrees/main-ci-foundation-validation`，
分支 `codex/mod09-learning-mcp-acceptance-20261005`，基线为
`origin/main@53e627480dd455a06151263a8d1e1e60464d82e4`。

后续 PR #289 的首提交 `e16470e907ab373686a6b181fc8d62afeea68b66` 两项远程 Foundation 成功，
已请求 Potatos498 非作者评审；本节父子分派增量改变 head，必须以新 head 的 CI/评审为准。

- #285 已由 Potatos498 对 `e3a5881cb6e1388243e994dc008ad337c6be3471` 批准，
  两项 Foundation CI 成功，合并提交 `74acc37ed9c040c750cdfd4ad1ac4374dac962cc` 已在当前 main 祖先链中。
  #284 的同步消费门禁修复及实际 Runtime 父/子副本测试已进入主线。
- 新增 `tests/integration/memory-learning-mcp.test.mjs`：实际启动锁定的官方 filesystem stdio 服务，
  使用公开合成 Markdown、正式 Competition Runtime Application、Client、SQLite Policy/Runtime 与 Learning。
  通过原 `authorization.respond` 逐任务审批，不直接签发测试授权；检查实际读取正文、摘要哈希、
  confirmed 执行记录和 Evidence。启用及删除确认回调为显式 Fake，不属于真人原生交互证据。
- 验收首次复现：已排队版本 2 在回滚到版本 1 后获批，绑定门禁阻止读取，
  但内部 `NOT_VALIDATED` 被直接当成公共任务错误码，失败快照 Schema 校验拒绝，任务遗留在 `running`。
  修复 Runtime 失败路径：先用现有公共快照契约验证错误，内部未知码映射为 `EXTERNAL_FAILURE`，
  保留现有公共错误码及失败消息；不新增公共错误码、Schema、迁移、依赖或执行权限。
- 定向 12/12 通过：未经验证不得启用、拒绝启用不激活、执行仍需新审批、回滚后旧任务零读取且
  持久化 `failed`/失败事件、重启读回原激活版本并再次审批、删除全部流程版本并取消排队任务、
  保留无关流程和原文件。实际 MCP 读取四次，云凭据读取及云调用为零。
- 原生工具本轮初始化仍报 `trusted Node process exited unexpectedly`；重置后
  Windows sandbox 再次报 `helper_unknown_error: setup refresh had errors`，没有新的原生窗口操作。

真实用户逐条确认、Electron 原生生命周期、完整 parent→child 许可与真实 AgentArts 消费仍待验收。
本工作包保留 goo122 在途验证范围；MOD-09 保持 `in_progress`，接口仍为 provisional。
下文保留候选与历史分支的时间点记录，不代表当前 PR 合并状态。

本轮 `npm ci`、build、Windows helper Release 构建与定向 12/12 通过。
完整 `npm run check` 的架构、契约夹具、生成类型、类型检查与 Runtime 323/323 通过；
汇总 1766 项，1741 通过、1 失败、24 跳过。失败为未修改的主线
`apps/desktop/test/coding-tool-host.test.mjs:72`：仓库根工作区的 patch 工具装配断言失败，单独复跑一致。
该测试、Desktop workspace/coding host 及 coding-tools 与 main 基线零差异，调用路径不经过本次 Runtime 失败处理。
本机 PowerShell 7.6.5 实际存在，但 `where.exe` 输出按 UTF-8 解码所得路径不存在、含替换字符，
按 GBK 解码所得路径存在，导致 workspace host 无法找到 PowerShell；仅调整验证 shell 代码页未解决。
此问题属于 Desktop 受信程序发现的本机兼容性，按 P8/P6 文件归属交接，不在本记忆包改写。
check 因失败未启动根集成，已单独运行 `npm run test:integration`，20/20 通过；不宣称完整 Foundation 全绿。
`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 通过，演示明确为 mock。

### 实际父子分派与私人许可边界

`private-memory-runtime-copies.test.mjs` 后续增加两个用例，使用正式 AgentArts Runtime Application、
真实 SQLite Policy 审批与 `createDesktopSubagentDispatchTool` / 默认 Competition 子工作者：

- 私人事实已按父任务确认时，Fake 云返回有效子任务提案。Runtime 写入私人派生拒绝标记，
  在原审批、工具执行和子任务创建前拒绝；协调边界对外固定脱敏为 `EXTERNAL_FAILURE`，
  不公开内部私人原因。删除父任务绑定副本后精确 `purged` 收据可读，且不重发提案。
- 公开父任务等待原审批，审批前没有子任务；通过 Client 的 `authorization.respond` 后由实际工具
  创建并运行子任务，原执行记录为 confirmed/allow。父子任务没有私人消费绑定，
  三次 Fake HTTP 请求不包含已保存的任何私人事实摘要；删除无关私人事实后公开任务及原父子关系保留。

新增父子用例与原副本/学习用例合计 5/5，通过全部根集成 22/22。
确认回调及 HTTP 是显式 Fake，资料仍为合成；不是原生审批、真实 AgentArts 或真实私人发送证据。
现有生产行为禁止私人派生提案直接分派子任务，父许可也不会自动成为子许可；
需要另行公共任务及其对应授权，不扩大本次实现或真实验收的权限。

## 2026-10-05 主线集成候选（已通过 #285 集成）

目标为 `huawei_ict_agentarts`，工作树 `.worktrees/main-ci-foundation-validation`，
分支 `codex/mod09-main-acceptance-20261005`。基线为 `origin/main@7b7f30906ddf375526edecf9fb601cce7927a91d`。

- #280 已合入 main；Potatos498 批准源头 `d484c8648af67af1e476cefe9ff140318945f4e5`。
- #284 已获 Potatos498 对 `39e03e7f4019aa457681de64402d91d56c817eec` 的批准，
  合并提交 `e19b22a9b96bbaef5577a1005f64088deaaa5009` 的目标仍为
  `codex/main-ci-integration-recovery`。上述 main 基线未包含同步门禁修复和新增集成测试。
- 本候选通过正常 merge 接续该精确来源，保留来源提交及 main 的其他模块改动；
  生产增量仍只有私人消费 host 的同步就绪判定。接口、Schema、依赖和已发布迁移不变。
- 接口目录与 ROADMAP 同步反映正式装配和副本门禁，保持 provisional / in_progress，
  不把源 PR 合并或离线验证记为真实验收完成。
- 原生交互复查首次报 `windows sandbox failed: helper_unknown_error: setup refresh had errors`，
  重置后报 `trusted Node process exited unexpectedly; kernel reset, rerun your request`。
  没有原生窗口输入、真实事实写入或云调用；真人逐条确认及真实消费仍待验收。

本候选 `npm ci`、Windows helper Release 构建及完整 `npm run check` 通过：
1638 项测试中 1618 通过、0 失败、20 跳过，跨模块集成 19/19；架构、契约、生成类型与类型检查通过。
官方 filesystem stdio 和原 Runtime reference Skill 读取/恢复用例实际调用本地 MCP，
内容为公开合成文件；不能据此宣称真实用户流程的原生启用/回退或云消费验收通过。
`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 全部通过，两个演示明确为 mock。
实际 Node 24.15.0 / npm 11.12.1，测试显式使用真实 native helper 与缓存 .NET 8 运行时。
本记录为候选验收时的状态；后续 #285 非作者评审及 main 合并已完成，见上文主线确认。

## 2026-10-05 私人消费与实际 Runtime 副本复核（历史分支验收）

目标为 `huawei_ict_agentarts`，工作树 `.worktrees/main-ci-foundation-validation`，
分支 `codex/mod09-native-source-acceptance`。本轮延续 #280 当前生产代码，未合并远端 PR。

- 修复生产私人消费门禁：`privateErasure.assertReady([])` 同步返回就绪对象，
  消费 host 原先拒绝任何非 undefined 返回值，导致正式接线无法消费。现在只拒绝 Promise/thenable，
  保持消费前及最终发送前的同步检查。未改变逐任务原生许可、公共 wire、迁移、依赖或 Local Profile。
- 新增 `tests/integration/private-memory-runtime-copies.test.mjs`，使用实际 Client、
  AgentArts Runtime Application、Runtime/Memory SQLite 与生产私人 host；
  更正事实、逐任务消费、旧版本撤回拒绝、撤回后拒绝、父/子副本删除 pending、
  重启按原 marker 恢复、精确 purged 收据和正文 redaction、源事实全部历史清除、无关事实/任务保留通过。
  子任务继承的 copyOnly 元数据不构成消费许可，清除恢复不重复 HTTP 调用。
- 新集成 2/2，已有私人消费与删除回归 6/6，合计 8/8。确认回调、HTTP 响应和子任务工作者
  使用显式替身；子任务由可信夹具写入实际 Runtime，不构成完整工具分派或原生子任务许可验证。
- 用户指定真实来源已通过生产只读适配器的有界检索、引文读回、版本匹配及原文件未变化检查；
  未持久写入真实摘录或调用云服务。合成私人库生命周期和原生验收限制详见
  `tests/manual/desktop/README.md`；真实来源路径及正文不进入公开记录。

真实用户逐条确认、原生窗口完整生命周期及真实 AgentArts 消费仍待完成；MOD-09 保持 `in_progress`。
本轮 `npm run check` 全部通过：架构、契约夹具、生成类型、类型检查与 workspace/integration 测试，
合计 1629 项，1609 通过、0 失败、20 跳过；其中跨模块集成 19/19。
Windows helper Release 构建通过并显式提供真实 helper 路径及缓存 .NET 8 运行时。
`npm ci`、`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 均通过；
两个演示明确为 mock。本轮基础代码已接入 #280 精确头 `d484c8648af67af1e476cefe9ff140318945f4e5`，
依赖合并前后代码树一致，增量保持独立 PR，尚未完成非作者评审或主线集成。
下文是历史工作包证据，不表示最新 PR 状态。

## 2026-10-04 集成复核

以 `origin/main@330be3862eb7ba9b50709ec8ac0c6292ff7829fd` 为依据：
PR #209/#210 已进入 main，#211 的恢复增量经 #210 集成；本生产桥经 #270 合并，
P8 的共享接线也已进入 main。下文原工作包的 `review`、旧工作树与“等待 P8”描述保留为历史记录，
不代表当前合并状态。MOD-09 整体仍为 `in_progress`。

- 主对话已装配 `privateConsumption.prepare/assertCloudSend`、原 Runtime 消费 marker，
  以及 `privateErasure` 的 inventory/cancel/redaction/readback 端口；不是仅有未调用的 host 工厂。
- 写入按实际未接管副本清单和删除准备状态开放；没有接通、来源变化或副本清单变化时拒绝。
  “所有真实 Vault 写入始终禁用”已不符合当前代码；本次没有对用户的真实来源执行写入或外发。
- 最终同步发送检查已调用 `assertCopyManagement`。本次补充凭据 await 后新增未接管副本的
  生产适配器回归：即使此前已确认，最终 guard 也拒绝且零 fetch，不泄露内部拒绝原因。
- 私人记忆、学习 facade、消费和删除恢复四套测试 **14/14** 通过；再加真实 Runtime 的会议事实
  评审测试 **16/16**，合计 **30/30**。全部为隔离合成数据/显式 Fake 传输，未访问真实账号。
- 主分支加本次 CI 修复的完整 `npm run check`：架构、契约夹具、生成类型与 workspace 类型检查
  通过；1609 项测试中 1579 通过、20 跳过、10 失败。5 项失败由独立 PR #278 处理，另 5 项
  Windows native helper 测试因本机缺少 `Microsoft.NETCore.App 8.0` 失败。
  隔离组合 `#278@d004849c9df2c76ef1c80052500379a87729d237` 加本次补丁：构建通过，
  106 项定向回归与 17 项跨模块集成全部通过；这不等于远程 CI 已通过或 PR 已合并。

本轮交付后续：已推送 Draft PR #280，首提交 `67cfa25`。从 Microsoft 官方发布元数据下载
并验证 SHA512 后，将 .NET 8.0.31 运行时解压到项目忽略缓存；测试进程通过原可信 recipe env
显式指定 `DOTNET_ROOT_X64`，命令工具仍不继承宿主环境。原先缺运行时的两套 Windows helper
测试现为 16/16，通过包含原 5 项失败的用例；不修改系统安装或用户环境变量。
本轮已将 #278 精确头的原始提交纳入 #280，保留原作者及提交归属。隔离候选
`24a6b57bafc58ec448b941b1452046fec4be2480` 与 PR 代码头
`a2a7e9da80e2e1e124b4e981b1784246f3c0a01e` 的完整代码树一致；`npm ci`、`npm run check`、
`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 均通过。
workspace 测试 1589 通过、0 失败、20 跳过，跨模块集成 17/17，合计 1606 通过、0 失败、20 跳过。
Windows helper Release 构建通过，并用显式 `PA_TEST_JOB_HOST_EXE` 实际执行原生进程测试。
两个 demo 明确输出 `verification: mock`；不将演示或本地 Foundation 视为真实云端验证。
上述初次失败记录保留用于追踪；当前远程 CI 和已登记非作者评审待完成，模块仍为 `in_progress`。

下一步验收顺序：

1. 取得 #280 当前 head 的远程 CI 结果和已登记非作者评审，获得对应合并授权后再集成；本机 .NET 8 与完整 Foundation 已完成。
2. 在真实 Electron 原生对话中只读预览用户已指定来源，逐条确认最小摘录；确认前不能生成长期记忆。
3. 真实本地验证确认→重启读回→更正→撤回→彻底删除，检查原事实历史、应用管理副本与删除收据，
   保留无关事实；当前没有生产 backup/restore 路径，外部独立副本和已发送正文仍不能纳入本机删除保证。
4. 核对私人 parent→child 的真实 ancestry、逐任务配置与许可边界；需要真实 AgentArts 发送时
   单独取得该任务的原生确认和云调用授权。未取得这些证据前不把整个 MOD-09 标为 done。

## 原工作包记录

目标 profile：`huawei_ict_agentarts`。负责人 zemeng，非作者评审/集成由 PR 专线和 P8。
工作树 `D:/PersonalAgent/.worktrees/memory-learning-mvp`，分支 `codex/memory-learning-mvp`，
基线 `1db50397`。状态 `review`；共享 main/preload/view/application exports/root package/lock 由 P8 单独装配。

## 已交付端口

- `createPrivateMemoryController(file, confirm, confirmDelete, {confirmWithdraw, authorizeConsumption})`：
  保留既有引用确认后重读、纠正精确 revision、持久幂等回执及未绑定删除/WAL维护。
  新增 `previewSave(source)` 返回 `{configurationRevision,expectedRevision}`；
  `save(source,summary,baseline)` 检查该基线与来源配置，确认期间更换来源拒绝。
  `withdraw(ref)` 追加用户确认的 private 撤回头，旧版本不回退消费；撤回头仍可物理删除。
  `consumeConfirmed({refs,taskId,destination,deadline,signal})` 每次要求受信宿主原生确认，
  返回最小 `{ref,summary}`，不返回来源路径/原文。`destination` 为 local 或 agentarts，
  默认确认器拒绝，拒绝时零正文；确认之后再读精确有效头。不得缓存为长期出机授权，
  在实际发送前调用；结果始终作为用户数据，不成为 system 指令或工具权限。
- `createMemoryLearningHost({profile,privateMemory,learningApplication,publicErasure?,managedPrivateCopies})`：
  受信 Desktop admin facade。`managedPrivateCopies: []` 必须来自组合入口核实的实际应用副本清单，
  私人 namespace 从未有 feed binding 且删除维护通过才返回 `writeEnabled:true`。
  未提供清单/已有未接通副本均禁用；不能只移除旧 fixture gate。
  清单可为受信 live callback，每次写入/删除前重新读；启动后新增未接通副本也会禁用，
  不缓存空清单结论或宣称删除已覆盖新增副本。
  `memory.previewSave` → `memory.save({source,summary,baseline})`；
  `memory.withdraw` / `memory.delete` 均走原生确认，`memory.boundErase` 只消费明确注入的公共删除宿主。
- `createWorkflowLearningApplication({profile,namespace,conversationId?,learning,runtime,skillManifest,submitSkillTask,confirmActivation,confirmDeletion})`：
  learning 使用既有 `SqliteLearningHost` 独立域文件，不新增 Schema/任务库/调度器。
  唯一流程为公开 `workspace-reference-summary@1.0.0` 固定两步和
  `mcp.workspace.read_text@1.0.0` 只读能力。候选 sourceRef 绑定 Skill ID/version/digest/相对路径，
  不能选择脚本、工具或权限。
  `submitSkillTask(binding,context)` 必须通过现有 Runtime atomically 提交
  `learning:binding:v1` checkpoint（purpose、namespace、workflowId、revision、skillId、version、digest、path、operationId），
  再 dispatch 原固定 Skill worker。conversation 默认为 `learning:<namespace>`，P8须匹配它。
  `assertDispatchBinding(binding)` 在 worker 每步、审批恢复/对账恢复和结果提交前调用；删除或回退后旧任务拒绝。
  `startValidation` 只受理候选验证任务，pending/unknown不标记通过。
  `validate` 必须读回 succeeded 任务、Skill complete checkpoint、匹配内容 hash 的源结果、
  唯一已授权且执行过的 Runtime 工具记录和 Evidence；模型自报/空 Evidence 不足以通过。
  `activate` 单独可信确认且检查当前 active revision；旧已验证版本通过同端口回退。
  `run` 只提交已启用版本，工具授权仍由原 Runtime/Policy。
  `stop({workflowId,revision,taskId,deadline,signal})` 比对原 Runtime 任务 conversation 与持久学习绑定，
  只取消该精确任务；回退/删除之后仍可停止原绑定任务，不删除候选或启用历史。
  返回 `cancelRequested` 与实际当前状态，取消受理不等于执行已停止。
  `erase` 精确头、可信确认，向同conversation绑定任务请求取消并清除候选/验证/启用历史；
  `resumeErasureMaintenance(namespace)` 只重试已提交删除的 WAL 维护。
- `createBoundPublicFactErasureApplication({profile,memory,runtime,projection,memoryNamespace,graphNamespace,confirm})`：
  只用于真实绑定的公共源 store，不接受 `desktop-private`。通过现有 begin/preflight/resume 清除投影、
  来源回执、Memory 历史与 WAL。`reconcile(context)` 启动读 durable marker；有 Runtime receipt 时复用其原
  expectedGraphRevision，无 receipt 才做当前预检。未知/失败保持 pending，不创建新 operation 或盲重做工具。
  staged/untraced/跨图依赖等现有安全门槛仍 fail closed。
- 独立 UI：`mountMemoryLearningControls(root,{invoke,status,refs})`，路径
  `apps/desktop/src/features/admin/memory-learning-controls.js`。只接 metadata/opaque refs，
  private摘要/原文/来源路径/raw Evidence 不进入此组件；P8挂载和 Luna现有class样式。

## 删除与恢复边界

只读检查 main 的 `apps/`、`packages/`、`scripts/` 未发现复制 private-memory SQLite 的
应用 backup/restore 路径；coding-tools patch backup 只保留工作区补丁，与私人记忆库无关。
没有新增通用备份系统，没有扫描用户磁盘、清理用户备份或删除 Vault 原文件。

Memory 新 host-only metadata `listFactErasures(namespace,{limit,afterFactId?,deadline,signal})`
提供有界稳定 ID 分页。`restoreUnboundErasureMarkers(namespace,{markers,deadline,signal})`
仅接受由仍权威的原 store 读出的 completed 标记；在暴露应用恢复副本之前清除旧版本及其确认回执，
保留 marker 防重导入，无关事实保留；绑定 feed 的副本拒绝。原库已被替换、清单丢失或来源未知时不可宣称过滤完成。
Desktop `filterRestoredHost(restoredMemory,context)` 要求原库仍存在且与恢复副本不同。
此入口为未来真实已有 restore 调用方提供防污染边界；当前没有生产 backup/restore 调用路径。
外部任意副本及曾经导出/已发送的正文不在应用控制范围，需要用户自行处理，不能称作删除已覆盖。

## 主对话私人消费接线

`apps/desktop/electron/private-memory-consumption-host.js` 提供独立受信
`createPrivateMemoryConsumptionHost({profile,privateMemory,readTask,readTaskBinding,writeTaskBinding,readConfigurationRef})`。
P8 是共享 main/Runtime/主对话唯一写入者；组合入口必须提供原 TaskRuntime 的读写端口以及当前真实
Competition 配置的无内容 opaque ref。不得用 Renderer 的声明替代真实配置/原生确认。

- `select({conversationId,ref|null})` 仅选一个精确私人引用，不授予外发权限；来源配置变更后旧选择失效。
- `prepare({taskId,conversationId,goal,deadline,signal})` 在原 Runtime 受理后、原 worker dispatch 前调用。
  逐任务原生确认目的地、摘要、精确版本；确认前后重新读取 active/user_confirmed/有效期、来源配置、
  原任务取消/终态与 Competition 配置。拒绝返回原公共输入且不创建私有消费绑定。
- 允许后 `private-memory:consumption:v1` 只保存 task/conversation/config/deadline、输入摘要 hash、
  factRef、来源/记忆摘要 hash 与私人来源配置 opaque ref，不包含私有正文、源路径或 Vault 绝对路径。
  `goal` 返回值是仅内存的投影，摘要作为 `user_confirmed_data`。P8 不得写入 application-goal、
  原协调循环 checkpoints 或另建历史正文副本；原公共用户输入正常持久化。
- `assertCloudSend(request)` 必须接到原 AgentArts 最终同步 beforeSend：credential await 之后、
  fetch 之前重新验证实际 request.goal、原持久绑定、精确事实头、配置、deadline、signal 和 task。
  更正/撤回/删除/切 Vault/改变云配置/停止任务均使旧发送拒绝；续接也必须保留同一已确认投影并再查。
  重启有 metadata marker 却无原内存 lease 时拒绝，不恢复旧私人外发许可；重新提交任务、重新确认。
  `releaseTask` / `close` 清理内存许可。这里的 prepare/guard 不签发工具权限、不记录云完成证据。

2026-09-30 新增必要验证：`node --test apps/desktop/test/private-memory-consumption.test.mjs`
实际 3/3 通过；调用生产 `AgentArtsCloudAgentPort`、显式合成 credential/fetch，检查其真实序列化 body
只有更正摘要无旧摘要/来源路径，拒绝确认只有原公共 goal；credential await 中撤回使最终 guard 拒绝且
zero fetch；更改实际 goal/config、重启无 lease、native 确认期间切 Vault/取消均拒绝。
live inventory 新增副本立即禁用写入。此为生产适配器离线传输验证，不是真实账号云消费。

Runtime 单次 `tsc -p apps/runtime/tsconfig.json` 通过；仅新 `learning stop` 用例 1/1 通过（122.5ms），
实际 Runtime running worker 收到 abort 后 cancelled，其他任务与流程版本保留。
控件新增停止按钮以同一原 taskId/workflow/revision 发送，合成 Edge 交互验证
候选→验证任务→停止请求→显示 cancelling；1000×940 与 390×844 无横向溢出/裁切/console 错误。
此处仍未验证共享主对话调用、真实 Electron 原生确认、真实 Vault/真实 AgentArts 消费；
等待 P8 实际接线和相应读回，不能仅凭本源包标记整个 PA020 done。

## 应用派生副本清除接管合同

模型答案、工具 arguments/result、协调续接正文、派生子任务 goal 和 conversation 助手消息可能带有私人摘要。
仅删除私人 Memory 源库不足以消除这些副本。新增独立 `private-memory-erasure-host.js` 的
`createPrivateMemoryErasureHost` 由 P8 注入原 Runtime/history 的可信端口：

- `listBindings({limit,afterTaskId?})` 返回稳定 taskId 分页的 `{items:[{taskId,binding}],nextAfterTaskId?}`，
  覆盖所有原持久任务及实际派生子任务，不能只列在内存中的 lease。binding 为原持久消费 marker；
  派生 marker 必须使用实际子 taskId，保留同源 factRef，可附带真实 parent/root metadata。
- `cancelTask(taskId)` 只调用原 Runtime；`eraseTaskCopies({taskId,factId,bindingDigest,deadline,signal})`
  清除同原库/history 的实际私有正文副本，不能在 active/unknown/等待结果核实时提前删除必要 proof。
  未完成清除保持 pending，先持久 withheld 并让未来模型 history/引用消费拒绝该副本。
- `readCopyErasureReceipt(taskId)` 只读实际清除与读回之后的无内容
  `{taskId,factId,bindingDigest,state:'purged'}` 收据；原消费 marker 保留恢复关联。
  不接受模型自报、篡改 digest 或空 receipt 当作已清除。

协调器先精确原生确认并提交原 Memory 删除，再失效内存 lease、取消同源任务和调用实际 redaction。
过时 ref 拒绝且零取消；已提交 Memory 删除但 WAL维护/副本清除未完成返回
`pending/private_copy_erasure`，不能显示全部删除成功。`reconcile` 只复用原 completed erasure markers
与 task bindings/收据，不调用模型/工具或重建授权。`withdraw` 在源撤回之后失效并取消关联任务。
原外部云端曾经收到的正文不在本机清除范围。

facade 可注入 `privateErasure`；此时 `managedPrivateCopies` 指其他未登记副本，原任务副本通过协调器
实际 bindings inventory 登记。其他副本未知或未接通仍拒绝。消费 host 新增同步 void
`assertCopyManagement`：在私人消费前检查真实完整清单与清除端口，缺接线时保持消费禁用；
公共未选择私人引用的任务照常。P8 原配置/native/共享 Runtime/history 接线仍是唯一生产证据来源。

新增 `private-memory-erasure.test.mjs` 2/2 通过，仅显式合成 task/history redaction 端口：
原 SQLite 删除关联 parent/child 副本、保留独立事实；过时删除零取消；missing/错 digest 收据 pending；
重启从原 marker 接续后读回准确收据。不能把合成 redactor 验证写成实际 Runtime/history 已清除。

源码交云知识记忆接管时未补跑旧 suite；2026-10-04 已复验上述私人消费/删除 suite，最终 beforeSend guard
也已同步调用 `assertCopyManagement`，并补确认后登记变化的零 fetch 回归。剩余评审点：实际 parent→child inventory 与同配置 task-tree native
许可必须核对真实 ancestry，独立模型/provider 更换不得继承原逐任务许可。当前 owned host 不提供
自动子任务许可，P8 shared 路径和云知识记忆组接续；本地不再竞争 portable 文件写入。

## PR270 两项本机补修

吸收云端 exact `d875b9c262e3e137db27ea8d397aa06d2bf9eddc` 后恢复本包独占增量：
`SqliteLearningHost.assertSourceAvailable(namespace,sourceRef)` 只复用原持久来源撤销检查，
Runtime 在验证提交前后、每次 dispatch/resume 入口重新检查，不恢复已撤销来源或另起工具循环。
Evidence validator 在实际执行及 binding 的异步读回之后再查 Skill enabled/revision/content hash，
同时重新检查取消与 deadline，不能用等待前的 Skill 状态出具通过结果。
定向来源撤销、await 期间 Skill 变化、最终读取取消/超时用例已准备；本阶段按统一验收安排
只执行 TS syntax parse、测试文件 `node --check` 和 `git diff --check`，未运行测试、构建或服务。

非作者复核指出最终 `readSkill` 等待期间仍可能撤回 source binding，补修要求
`WorkflowEvidencePorts.readCurrent(candidate,binding,context)` 提供受信宿主原 mutation fences 下的
同步一致联合读回（当前 binding + Skill），最后检查精确 binding/Skill/取消/deadline 后无 await 直接返回。
缺少此端口、返回 Promise、原来源撤回或 Skill变化均拒绝；不可用异步快照拼装假 joint current，
真实 adapter 未接通前保持不可用，不给新许可或恢复已撤销来源。仅合成 fixture 接口已更新。
来源撤销的 `startValidation` 在调用时同步抛错，其用例改为 `assert.throws`，保留零新任务/MCP断言。
新增最终 Skill await 中撤销、缺失/异步/停用 joint gate 与 gate取消/超时用例仅准备，未运行。

## 验证与限制

定向 SQLite/合成 Vault 验证：私人确认纠正可查询、精确 baseline 及 config变更拒绝、
云授权拒绝零内容、确认期间撤回失效、撤回重启不复活、旧副本过滤保留独立事实；
固定 Skill 经真实 Runtime/ToolGateway/Policy实现但**显式合成工具端口**验证、启用、运行、回退、删除；
无工具证据的自报成功拒绝；Memory提交故障后 Runtime receipt 恢复不重做、原 receipt 保持。
既有 private-memory三用例含busy WAL重启维护也复验。

环境 PATH Node `26.3.0`；仓库要求 `24.15.x`，当前未找到匹配 executable。
本次未安装新版本，不能宣称版本匹配验证。真实 Vault 持久写入、用户原生确认/出机确认、
shared UI最终挂载、真实MCP运行与真实 AgentArts消费须在 P8/人在场另验；这里不宣称 PA020全部完成。
未改变已发布迁移，未改public wire或Local Profile，未运行全仓 tests/smoke。

非作者 review 的删除顺序 P2 已修：事务内精确最新头检查与删除持久接受在先，
dispatchBinding因候选移除立即失效，然后才请求取消关联任务；旧revision或原生确认中产生新revision
均拒绝且零cancel。WAL维护失败通过 `readErasureReceipt` 精确operation/revision读回确认已提交，
取消已失效任务后保留原始维护错误，不能报成功。

修复代码 exact head `3d6d918560da9eba4e47bfbda5f197d5d4882111` 的必要复验收据：
Learning/Runtime `tsc -p` 各一次通过；
`node --test --test-name-pattern='stale learning deletion|new head during deletion' apps/runtime/test/memory-learning-application.test.mjs`
实际 2/2 通过，分别 77ms / 64ms。未重跑旧8/11用例，WAL失败分支本次仅非作者静态复核，
不将其当作新增故障注入测试通过。当前相关不同用例累计13项（原私人3、新纵向8、删除冲突2）。

独立控件视觉验证使用既有 Playwright + 安装的 Edge（Browser skill未提供；默认Playwright
headless shell缺失，不安装，改用已存在msedge channel）。仅合成admin端口，复用原CSS classes，
1000×940 / 390×844 均无横向溢出、裁切或应用console错误；生成候选后表单输入保留，
未验证shared Electron宿主/原生对话框。临时fixture/server已结束，证据在本工作树忽略`.cache/memory-learning-visual/`。
