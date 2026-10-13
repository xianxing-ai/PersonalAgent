# P8 已批准版本的 Runtime 消费验收

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。负责人：zemeng/P8；集成评审：goo122 或 Potatos498。
此处只验收隔离本地总装，不操作用户 Desktop、记事本或真实账号。

## 集成基线

- 独立分支：`codex/zemeng/p8-approved-runtime-consumption`，从 #243 `85b16831633126d157bc56791ea3bdbac7d42a1c` 建立。
- 正常 merge #237 `542a2cd592b06c53597ea2821ca1c02e8bba02e0` → `b60a302c01258abec092cda361973c77eb41cf70`。
- 正常 merge #234 `b4d09b7e28d19d20ba57f32abf5c3baf8abffa38` → `c902db6abfec3d5f754a7fba14d8f2d082d31c44`。
- 两个源包已由非作者 Potatos498 批准，CI 各双绿；源包文件与批准版本零差异。
  本地 merge 不表示两个源 PR 远端已合并，也不批准继承的 #236/#243 配置/消费内容。
- #236/#240/#243 原分支 head 保留；此分支不包含 #240 尚待评审的分类器身份增量。

## 最小执行

在 Windows、已安装工作区依赖及 PowerShell 7 的仓库根目录执行：

```powershell
npm run build --workspace=@personal-agent/coding-tools
node tests/manual/desktop/p8-approved-runtime-consumption.mjs
```

仅构建变动包，不重复其单元测试或全仓 check。脚本在 `.cache/p8-approved-consumption-*` 新建
工作区、独立配置、Runtime/Memory SQLite 与 receipt.json，保留可继续的证据，不删除用户文件。

## 当前已取得的证据

- 真实 Desktop `createWorkspaceConfigHost` 构造公开工具，经正式 AgentArts Runtime Application、Client、Policy 和 ToolGateway。
- 四个本地任务：read、preview、apply、read-back；各有真实 Runtime `allow_once` 审批，审批前未发生补丁写入。
  使用第一次 read 的 path/sha256 构造同一补丁；预览不写，应用后独立文件字节与再次工具读回相符，BOM/CRLF 保留。
- 四个执行记录为 confirmed，四条 Runtime Evidence 的 verification 均为 `conditional`，未人工升格。
  文件系统独立读回证明这次隔离文件确已改变；不代表正式窗口、云提案或用户工作区验收。
- Goal 源回执、Laya 与 HTTP 都为显式夹具；Runtime/SQLite/cognition host 和 P8 状态消费函数真实。
  未授权出云拒绝，同 review 两次接管只创建同一 task，Fake 编排 succeeded 后仍显示
  “编排任务已完成，目标更新尚未核实”，executionVerified/graphUpdateVerified=false；Goal 写入 0，图版本维持 5。
- 产物 `.cache/p8-approved-consumption-n3POGY/receipt.json`：整体 conditional；realLocalExecution=true、
  filesystemReadbackVerified=true；desktopUiVerified/cloudVerified/safeStorageVerified/formalF9Verified=false。
- 最初脚本漏传显式 initialRequestMode 被 Runtime 拒绝，未启动任务；修正为正式总装同款
  goal-with-tools-json/tool-proposal-json 后上述关键链通过。未改生产检查、作者源码或断言。

尚未验证：正式 Electron 新版本加载/完整 UI，真实 AgentArts 编排、真实 Goal 更新及 revision/Evidence，
F9/记事本、麦克风、真实凭据加密、崩溃恢复。本片没有远端合并、应用重启或真实云发送。
## 私人记忆本机验收

此增量验收使用 `huawei_ict_agentarts` 的真实 Electron 管理后台、本机来源和隔离的
`PA_USER_DATA_DIR`，不使用 `--fake-runtime`、`--fake-model` 或原生对话框替身。
本地持久化验收不需要云端 Authorization；宿主需要一个有效的目标地址和运行时名称才能装配，
若以明确的验收占位目标启动，必须保持无凭据，不提交云任务，也不将占位配置记为真实连通。

1. 打开“记忆”，在系统文件夹对话框中选择用户指定的 Vault。确认搜索可用、写入门禁就绪。
2. 用户选择一条最小摘录、填写摘要，点击“检查并确认”。先取消一次，确认已保存列表没有新增。
3. 用户再次检查原文和摘要，亲自在原生对话框确认。记录事实引用和版本，不公开原文、路径或摘要。
4. 关闭此验收实例并用同一隔离 userData 重启；不重新选择 Vault，查看已保存记忆，确认事实仍在。
5. 重新选择同一来源，逐条确认更正；核对新版本和旧版本基线，取消更正应保留原头。
6. 撤回此事实，核对后续消费拒绝；刷新管理列表并重启，仍可找到已撤回的当前版本和删除入口，
   不重新暴露旧有效摘要。未获得逐任务许可时，不启动真实模型或云端消费。
7. 在原生对话框确认删除此验收事实的全部版本；读回删除收据，重启后目标事实和历史仍不存在，
   其他事实和 Vault 原文件保持原状。应用管理副本存在时还须核对相关精确收据和恢复状态。
   返回 `pending/private_copy_erasure` 时来源已停止引用，关联任务副本仍待清除，不能标记取消或删除完成。
   来源删除已提交后，任务取消失败也必须保留 pending；启动恢复沿用原删除标记，
   已有精确清除收据的副本不再取消或重做，未核实副本仍不可宣称完成。

### 私人管理的合成 Electron 回归

依赖已安装并构建后，在仓库根目录运行 `node apps/desktop/test/private-memory-smoke.cjs`。
脚本新建隔离 userData 与公开合成 Vault，使用替身选择/确认对话、合法合成目标和空云凭据。
检查确认取消、保存、更正、撤回刷新、重启后仍可删除撤回头、全历史删除及再次重启读回，
保留夹具原文；fetch 陷阱计数必须为零。另以明确的 Renderer fixture 检查副本清除 pending 展示。
仅清理脚本创建且已校验范围的临时目录；不使用已打开的验收实例或真实来源。
此回归不属于真人原生确认或真实云端验收，不能代替以上手工生命周期证据。

仅打开窗口、选择来源、合成测试通过或列表暂时为空不构成全部验收通过。持久保存、更正、
撤回、删除和任务消费分别记录实际证据；真实 AgentArts 发送须另取用户对应授权及原生出机许可。

### 2026-10-05 本机增量记录

- 生产 filesystem 只读适配器读取用户指定真实 Vault：有界检索一条引文、精确读回、内容版本校验
  及源文件未变化检查通过。没有持久事实写入或云调用；不公开来源路径、正文或摘要。
- 独立合成 Vault 与 SQLite 的串联验收通过：取消零写入、重启读回且来源选择不持久化、
  更正 revision 2、拒绝旧版本撤回、撤回后拒绝消费、删除全部目标历史、删除标记读回、
  保留无关事实；最终测试事实为零。此路径覆盖未绑定任务副本的私人库，确认回调为显式测试替身。
- 原生 Windows 工具初始化报 `windows sandbox failed: helper_unknown_error: setup refresh had errors`，
  重置后仍不能启动。此前窗口打开不代表原生保存、更正、撤回和删除确认已通过。
- `tests/integration/private-memory-runtime-copies.test.mjs` 通过实际 Client、AgentArts Runtime Application、
  Runtime/Memory SQLite 与生产私人消费/删除 host：同步就绪对象允许消费，异步清单检查在确认和发送前拒绝；
  更正后的事实按任务确认，旧版本撤回拒绝，撤回后消费拒绝，父任务及实际 SQLite 子任务副本删除待处理、
  重启按原 marker/收据恢复并读回清除、全部事实历史为空、无关事实/任务保留，恢复不重复发送。
  两项新集成与已有消费/删除六项回归合计 8/8。确认回调、HTTP 和子任务工作者均为显式替身；
  子任务由可信测试夹具写入实际 Runtime，不表示完整工具分派、原生子任务许可或真实云编排验收通过。
- 私人真实持久确认和真实 AgentArts 消费仍待验收；MOD-09 保持 `in_progress`。
- 主线集成候选复查原生工具：首次 Windows sandbox 初始化失败，重置后
  `trusted Node process exited unexpectedly; kernel reset, rerun your request`；未取得新的窗口操作证据。

### 实际本地 MCP 学习集成验收

构建当前工作树依赖后执行：

```powershell
node --test tests/integration/memory-learning-mcp.test.mjs
```

实际官方 filesystem stdio、Competition Runtime Application、Client、SQLite 审批和 Learning
在独立 `.cache/memory-learning-mcp/` 夹具运行：候选验证、拒绝启用、逐任务读取审批、
版本回滚后旧任务零读取并记录失败、重启、删除全部流程版本与取消排队任务、保留无关流程和源文件。
测试结束释放本次进程和数据库，仅清除本次新建夹具。使用公开合成资料，云凭据读取/云调用为零；
原生启用/删除确认是显式替身，不能代替上文真人逐条确认、原生窗口或真实云消费验收。

### 父子分派的私人许可拒绝验收

```powershell
node --test tests/integration/private-memory-runtime-copies.test.mjs
```

除原副本删除/恢复用例，还验证私人派生云提案零审批、零工具执行、零子任务，以及公开任务
通过原 SQLite 审批实际分派默认 Competition 子工作者。公开父子没有私人消费绑定，
删除无关私人事实保留任务及父子关系。资料、原生确认回调和 HTTP 为显式合成/Fake；
本机 Runtime/Policy/子任务分派使用生产实现。父任务许可不授予子任务，
生产路径仍拒绝私人派生提案直接分派；本记录不表示已完成真实云或真人子任务许可验收。
