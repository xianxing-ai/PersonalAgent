# MOD-27/28 本地消费者集成交接

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

日期：2026-09-10；profile：huawei_ict_agentarts；消费者负责人 zemeng。
状态：原离线图谱工作包已在 PR #37 评审合并为 `41ea79d`，含根构建接线；不代表 MOD-27/28 整体验收完成。
存储首片见 [COORDINATION-STORE-01](COORDINATION-STORE-01.md)，已在 PR #38 经消费方非作者评审并合并为 `87ee444`；接口仍待持久图消费者纵向验收后评估冻结。
以下原工作树/基线及交接需求保留为当时记录；MemoryQueryPort、FactChangeFeed 仍 unavailable。
工作树 `.worktrees/zemeng-mod27-goal-graph`；分支 `codex/zemeng/mod27-goal-graph`。
本轮 fetch 确认 origin/main 为 59440614a15623e6190e0df5542dc9ff8d019d0c。

## 已有能力与不可用边界

- `packages/goals`：纯内存版本图、严格历史校验、expectedRevision 校验和历史查询。
- `packages/cognition`：精确版本依赖影响、KEEP/RECHECK、显式 summary 候选的 REVISE 差异。
- 公开入口消费者示例：`packages/cognition/examples/meeting-replay.mjs`。
- 基线提交本身不包含上述实现；两包与此交接记录作为同一图谱影响工作包提供和评审。
- PR #36 的 CoordinationPort/CloudAgentPort 是 provisional 文字子集；结果只允许
  kind/text/verification，不可塞入 PlanPatch、授权、Evidence 或任务状态。
- 接口目录中的 MemoryQueryPort、FactChangeFeed 仍 unavailable；CoordinationStorePort
  的首片已集成为 provisional。本文原始段落只描述当时消费需求，不扩大 wire DTO。

## goo122 端口交付需要覆盖的消费者场景

| 边界 | 最少行为 | 必须拒绝或显式暴露的情况 |
| --- | --- | --- |
| 图谱存储 | 命名空间读回、版本追加、提交时原子 CAS、历史保留 | 两个调用者使用相同旧 revision 只能一个成功；不得先读后无条件写 |
| 隔离与访问 | 由可信宿主判定用户与命名空间、敏感数据范围 | 更换命名空间字符串不能获得另一个人的图；错误不回显私人正文 |
| 事实读取 | 稳定来源、精确 revision、有效期、修正和撤回语义 | 缺失版本、缺来源、越权或不可用不能伪装成空结果/有效事实 |
| 变化流 | 可恢复游标、去重、顺序及缺口处理、取消/deadline | 重复事件不追加重复事实；乱序/缺口需重同步，不能跳过后声称最新 |
| 保留与删除 | 区分撤回历史和隐私删除；定义删除后依赖处理 | 当前图谱会保留旧摘要，不能把撤回称为物理删除；删除策略未定前不导入真实私人数据 |
| 重启恢复 | Fake 和持久适配分别展示读回、游标与 CAS 语义 | 内存 Fake 跨调用成功不作为进程重启证据 |

端口类型、Fake、错误语义及冻结状态由负责人交付。zemeng 在公开入口上补消费者
测试，不读取 Memory 数据库或导入存储私有实现。纯 appendVersion 的检查不能代替
存储原子事务；当前示例中的顺序追加也不证明并发安全。

## 本地可复现验收入口

在此工作树运行 `npm run demo --workspace=@personal-agent/cognition`。
合成会议从 15:00 改为 17:00 后，3 个节点 RECHECK；只显式重绑 Goal 后仍有 2 个；
显式更新 Decision/Plan 依赖后为 0 个。无关计划逐字段不变，旧历史可恢复查询，
旧 revision 的修订候选被拒绝。所有时刻、文本和重绑选择均为固定夹具，非智能推理。

最近验证：goals 8/8、cognition 10/10；根 check 在核心依赖增量时通过；后续示例
通过模块测试、构建与 demo。Node 26.3.0 / npm 11.16.0；目标 24.15.x / 11.12.x 待验。

## 接线顺序与所有权

1. zemeng 提交可审查的图谱/影响增量并由非作者评审；Git 动作需要对应授权。
2. goo122 交付上述公共端口与 Fake，记录精确接口版本及迁移风险。
3. zemeng 使用 Fake 补重复/乱序/冲突/取消/隔离消费者测试，不接真实账号。
4. goo122 集成根锁、构建顺序（goals → cognition）、存储与 Runtime 注入。
5. 集成工作包运行根 check，并在项目要求 Node 版本验证；涉及真实状态时增加重启读回。
6. 云试用获批且用户授权后，另行验收 AgentArts 语义修复和真实执行；不以本地 demo 替代比赛 Golden Path。

PR #37 CI 后续修正：2026-09-10 的 run 34430658413 在 npm ci 因缺少两个 workspace
锁登记失败。本 PR 补充根锁的 4 个 package/link 记录（19 行），没有第三方升级；
此共享文件例外由 goo122 随 PR 评审。上文原定锁登记交接项由此次修正提前完成，
生产构建次序、公共端口与根装配仍待集成。未修改根 package、公共 contracts 或 Runtime。
只按用户授权提交、推送和请求 PR 评审，不合并或标记 MOD done。

## 当前源码能力与验收矩阵（2026-10-07）

以下依据 `main@4b5ec61` 的公开入口与实际调用点核对，区分已合并实现与尚未完成的
真实来源验收。上文 2026-09-10 的 unavailable、构建版本和验证数量保留历史含义，
不能作为当前源码缺项的结论；本次仅校正文档，没有新增实现或真实服务验收。

| 能力 / 现有消费入口 | 当前源码状态 | 仍需完成的边界 |
| --- | --- | --- |
| [Goal 图与命令](../../packages/goals/src/index.ts)、[受控工具](../../packages/goals/src/tool.ts)、[Desktop Goal host](../../apps/desktop/electron/goal-host-core.js) | 已有 Fact/Goal/Decision/Plan 精确版本依赖、历史查询与撤回、SQLite/Fake 原子 `appendBatch`；Goal 创建/修订通过既有 Runtime 工具及图/Goal revision 检查，不由 Renderer 直接写图。 | 版本恢复是追加图版本，不回滚外部副作用；真实个人数据授权、删除与恢复读回不能由离线图测试代替。 |
| [SQLite fact projection](../../apps/runtime/src/application/sqlite-fact-projection.ts)、[CompetitionFactHost](../../apps/runtime/src/application/competition-fact-host.ts) | 已消费公开 `MemoryQueryPort` / `FactChangeFeedPort`、持久投影与确认读回，保留 consume/drain、completed impact 和恢复入口；当前 feed/query 固定 `allowedSensitivities: ['public']`，宿主写入来源是公开 Vault。 | 已有公开来源链不代表所有业务来源可用；不能将私人 Calendar 当公开 Vault 输入。真实来源修正、撤回、删除、权限撤销及重启的现场验收仍分别记录。 |
| [Committed fact consumer](../../packages/cognition/src/committed-fact-consumer.ts)、[Goal cognition host](../../apps/desktop/electron/goal-cognition-host.js) | 已有 KEEP/RECHECK/REVISE 影响回放与精确 completed projection 消费；Goal host 对已确认的创建/修订调用 `reviewGoalCreated` / `reviewGoalRevision`。 | 只复核有依赖的节点；模型建议或投影完成不能单独证明修复已执行，无关依赖不得被改写。 |
| [Runtime local repair](../../apps/runtime/src/application/local-repair.ts)、[Reviewed repair 接线记录](MOD-28-REVIEWED-REPAIR-01.md#当前源码接线核对2026-10-07) | 已有最小差异预览、可信 Goal 来源绑定及原 Runtime/Policy/原子 CAS/历史读回路径；main 已装配 P8 reviewed source resolver。 | 真实 Laya/AgentArts 候选、云执行、confirmed Evidence 与实际目标读回未由本次核验；未知写入不重发，不能用候选受理或 Fake 成功替代执行结果。 |
| [默认 P5 Calendar 交接](MOD-28-REVIEWED-REPAIR-01.md#默认-p5-会议链与可信来源交接2026-10-07) | 核心 committed reader 与 Goal 会议 review/repair 端口已具备；main 的 P5 仅注入 `calendarReadPort`，缺可信 meeting binding，仍保存 `requires_review`。 | 沿 #212：Potato 提供可信 Calendar sourceRevision→精确 Fact ref 与旧/新 baseline 顺序，goo 核对原 Memory/projection 的敏感范围与 completed 读回，zemeng 随后复用既有 composition/Goal host 接线；不得新造 Fact 来源、空转发或把无 binding 改为 KEEP。 |

现场验收继续使用上述既有模块记录与 #212 的步骤及负责人，MOD-27 保持 `review`、
MOD-28 保持 `in_progress`。接口状态以[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)
公布的子集为准；本次源码核对不冻结新接口，也不把合成绑定、实际 SQLite 持久读回或
一轮根检查记为真实 Calendar、私人 Memory、云或 Evidence 整体通过。

## 固定九项整合批次完整检查（2026-10-08 续接）

固定68fb1563ef73457dab1747e6eb15c08e6c32010a/tree8d6fa5b8ac47ff8d095d8c8dca0bd2f001f14bb0，Node24.15/4CPU原npm run check，01:19:57.495576Z至01:28:21.974862Z，实际session34257/dccf1d→dac3e6/exit0。34组2523项2473通过、0失败0取消、50跳过；Desktop647/636通过11跳过、Runtime439/439、Cognition273/273、Calendar47/44通过3跳过、root integration22/22。raw249163字节SHA5af62dc48f62442cf5dd9a22da3c63f6736c7951e0a52b038de76a9cff56e286；A独立完整raw+固定source核实4dd26739620a9d2249593f49db071ca711b20b1b900bbcb8d4707ec81342a0b3。原1f548整仓Calendar失败和同head隔离8/8仍完整保留，后来此批通过不能解释旧失败原因。此完整结果不覆盖随后新增Laya reader取消、Live shortcut反馈或Mail cache排序；新源码固定后须另跑原完整检查。没有借用旧远端Windows CI结论。

## 最终十二项自有增量的完整检查与交付（2026-10-08）

最终固定0b3eef9fa57340d2e992551dbcac26cea7827763/tree8918053995597cab9659dd29b1e37f5117d350e6，原npm run check实际5856/48cf7c→dd7d8c/exit0，01:40:40.655086Z至01:48:22.341844Z，Node24.15/实际4CPU/原期限与断言。34组2545项2495通过、0失败0取消、50跳过；Cognition283/283、Desktop659/648通过11跳过、Runtime439/439、Calendar47/44通过3跳过、root integration22/22；build/type/generated/architecture/contracts全部实际执行。完整raw3314行/251009字节SHAa8ba69d2a9d2068d54f5b47f8a0d9f9255fa4630524dabd9d8ac926e196edc22，A独审9f478df34f9c75bf69b6b9e5966488b3c4f9cc0e963bf233886fb64c3cec3fd8核全部34组七字段、50skip、全文及15冻结source/test。

覆盖原九项加Laya取消、Live快捷键反馈和Mail配置稳定排序十二项；此前68fb与1f548批次各自结果不混用，1f Calendar失败仍不解释根因。随后仅本文记录已发生结果的DOC提交，不改任何source/test；发布时须核源码一致、实际PR head/tree/全文件名/body。真实云/邮箱/Electron/Windows/物理设备与用户项目仍按原现场交接，未通过，不批准或合并；停止前由root向指定QQ邮箱发送实际结果、剩余事项、阻塞和责任人。

## 12:30续接的公开消费契约与前端恢复（2026-10-08）

用户将本轮截止延至北京时间12:30；先行清单邮件已实际发送并核实后，三个原GPT-6.1 Sol执行线在独立工作树继续自有工作。以下八个工作包已精确整合至本地交付分支，以本轮新固定源码的必要完整检查交付；不能借用前述0b3eef9检查或24a1290的两条Windows CI成功元数据。仍沿原#302交付，不自行批准或合并，整体MVP与真实现场验收未完成。

- Mail缓存身份绑定原分类criteriaDigest的精确标签顺序。同序跨locale重开infer0，改序重新分类并通过原公开Dispatch；旧收据仍按原校验拒绝。新增摘要字段会让所有旧配置的checkpoint首次可能miss，含默认标签；旧记录保留，无迁移或改写收据。原三个affected文件33/33，独立Node/disk公开消费者9进程，冻结清单72e2016a。
- Mail在分块之间取消或到达期限时，用原Laya/Dispatch定义的criteriaDigest生成剩余收据ID。真实AbortController和注入的合成期限时钟分记；剩余项不推理、不存瞬态checkpoint，重开复用已完成项。原三个affected文件38/38、独立Node/disk消费者6进程，de48fe11；没有额外缓存身份变化。
- 当前可信highImpact提示撤去时，之前仅因该提示产生的高影响缓存会重新分类，不伪造语义降级；模型高影响和meeting缓存继续保留。空输入缓存保留insufficient_input原因，只按当前提示选择deferred路线、infer0。无key或收据迁移。原duplicate测试的batch内OR断言保留，后续false的旧缓存预期改为有依据的新分类及公开Dispatch验收；首轮49/50失败日志保留，最终原affected50/50、独立Node/disk14进程，28457636。三项都是原基线已有公开组合缺口；未发现当前生产Pipeline→Dispatch调用，不能声称修复了真实邮件、Task或通知失败。
- Desktop有活动任务时，在永久关闭Wake/Voice前拒绝退出；活动任务完成不会自动续退，用户下一次显式退出才开始清理。原末尾任务守卫及未知Live/SIS释放阻塞保留。原五个affected文件39/39，原完整main quit/IPC和实际Voice/Wake公开消费者验证，863001fc；Runtime计数、app和设备端口为Fake，不算Windows退出验收。
- SIS无效参数、过期Token、加密不可用或文件写入失败不再提前永久移除旧Wake宿主。原初次disable和IAM前后活跃校验保留；旧宿主保持disabled，可由用户显式重新启用。配置成功才继续原永久替换；保存后若资源释放未知，保留已保存副作用且不初始化，不宣称原子回滚。原八个affected文件66/66，原main IPC与实际ConfigHost文件/Voice/Wake消费者，1a76abb9；加密和设备替身明确，无真实IAM/网络验收。
- Goal完整投影24338字符超出原AgentArts16000上限时，prepare/dispatch先阻塞提交，保留全部101项复查和原图。控件显示实数/上限；用户可通过原proactive.configure的严格两个Goal布尔字段撤销目标云端许可，保原本地分析、独立CPU租约/云开关及未保存草稿。当前无授权或图版本已失效时不伪造可用投影，旧已受理/未知/失败任务的锁和完整journal不变。原三个affected文件58/58和Desktop typecheck通过；原HTTP/CSP完整renderer、实际Proactive/Goal/SQLite新消费者与原失败DB独立字节副本读回通过，eea1e521。Fake IPC、Laya及工具授权上下文明示，不算物理Electron、云或修复审批通过。
- 超过320字符的触发原因使用原生details/summary，保留完整转义文本、101项范围和原状态/动作。原6367字符原因在520×900页面使状态和本地恢复按钮初始落在3474/3525处；折叠后为574/625，用户展开仍可滚动。原Tab可到达按钮，故这是首屏可读性改善，不记为旧键盘不可用缺陷。按reviewID保留用户实际open状态并清理缺席记录；仅原summary当前有焦点且同ID仍存在时，以preventScroll恢复焦点，不抢输入框或其他控制的焦点、不复活移除项。原2正式失败后23/23、补充原焦点失败后完整24/24；原HTTP/CSP页面连续Enter跨刷新无需重新focus可开/关，0376cb89链保留原58685fe0和before。IPC为冻结的原真实Host投影的Fake回放，本次未新增Host/DB/任务/许可操作，也不是物理Electron验收。

- Device检查点先在局部Map中验证并克隆全部来源，成功后才发布到当前状态。坏行使公开readFeedback或evaluate首次读取拒绝时，不遗留已验证前缀；可信宿主随后修为空或替换来源，同实例不会显示幽灵反馈或误判replayed，后续合法采样仍持久化并在重开后防重放。原四恢复子例及父聚合失败、另一个非JSON克隆失败均保留；修复后原五个完整affected文件56/56，四个独立Node/真实SQLite公开HostState/P5消费者读回精确，e228ef33。无shape/key/configDigest/schema/阈值/通知意图或迁移变化，旧测试字节相同。坏行与可信修复是合成输入，仅原migration10表，不算完整TaskRuntime或真实OS；unused Fake推理/通知均0，nonJSON克隆例保留原DataCloneError，实际JSON端口会提前拒绝该数据。

原before/final源码、完整raw、实际启动回执和独立消费者均冻结；C/A/D交叉只读核验全部证据字节与摘要，未为同行审核重复生产绿色测试。工具命令固定Node24.15；formal未打印内部版本的情况按实际pinned启动回执记录，公开helper的内嵌版本另记。夹具故障和原正式失败均独立保留。必要整仓检查和精确发布头读回结果在实际发生后追加。

### 本轮八包固定源码的必要完整检查

固定0a6abb72ec157407cd115b4826a2ecf51be1d342/treefafa73c1c68c317facf9f368fdfc1ba4dfe78cc7，原npm run check实际13229/968c83→068f90/exit0，03:24:02.381800Z至03:32:30.531926Z，Node24.15/实际CPU0–3/原期限断言。34组2593项2543通过、0失败0取消、50跳过；Cognition307/307、Desktop683/672通过11跳过、Runtime439/439、Calendar47/44通过3跳过、root integration22/22；build/type/generated/architecture/contracts实际执行。完整raw3367行255471字节SHA86feac67a0f027ac88083b65839817da17e202eed40294bc819a63d9f55d66d1；root独立逐组核全部七字段、固定producer和原记录，9a7e88c3905dc65d75313ef8b82c42c7886f48172db32196971a21f844900d3a。

以上覆盖原十二包及本轮八包；原旧完整失败和隔离结果各自保留，不解释他人模块失败根因。随后仅本文记录实际结果，发布时核全source/test/config/generated与0a6abb相同，不为DOC另跑绿检查。真实现场步骤已列入自有Voice/Goal交接，仍待用户和zemeng实际读回；没有批准或合并。后续新具体缺口须独立证据和新检查，不以本轮通过覆盖未来源码。

### 12:30续接第二批自有修复

八包已普通推送原PR #302至e942c16，原生head/body、全部150文件名和远端Git tree精确读回。随后四项新源码按原文件归属继续整合；前述2593完整检查及e942的Windows结果不覆盖本批，须固定本批源码另执行一次原完整检查。

- ProactiveDecision只在请求内部使用精确UTF-16顺序比较Fact ID，替代可能将不同Unicode ID视为相同的locale比较；合法引用反序仍合并同一版本，不规范化、去重或改变返回引用顺序。原四个affected文件49/49，三个独立Node locale公开消费者结果一致；原生产投影仍单Fact、其他构造仍syntheticMvp，未证明生产多Fact、Task或云效果。冻结d31d7ad1。
- 晚到任务阻止退出、之后显式成功配置新Voice时，成功发布新宿主后重置其清理归属。下次退出实际取消新pending识别；初始化失败和旧清理未知原守卫不改。原八个affected文件69/69，原main/实际Config文件、VoiceManager、Wake、Mic、PCM公开组合验证；ASR/app/设备端口Fake，capture此前已确认关闭，不声称设备泄漏或物理验收。冻结77cdf89c。
- Mail检查点先在局部Map完成原校验与克隆，全部成功后再发布，坏行或克隆失败不留下可在修复后重新持久化的前缀。原四个affected文件61/61、六独立Node/真实JSON文件的空与有效替换及重启读回；旧测试字节、null拒绝、瞬态过滤、摘要与key均保留，无新增迁移或缓存首次miss。原公开batchTail串行入口保留；并行首次load边界另以原/新消费者核对。坏行与可信repair为合成输入，未证明生产检查点、真实邮箱、Task或云效果。冻结12ae4b0f。
- Goal宿主仅对原公开getApproval的相同身份、任务、工具、revision和状态附上原expiresAt，NOT_FOUND保守，其余读取错误传播，不泄露scopes或原参数。有效未来审批保留原动作，缺失/无效/到期禁用并隐藏；当前任务计时器和点击门禁阻止迟到批准，close/changeView清理、旧回调不能清新timer，较新draft反馈保留。原两完整affected文件20/20；实际Runtime/SQLite与原完整HTTP/CSP页面从合法待审批到原10分钟期限+1ms，刷新/重开仍过期，原审批整行未改、Task waiting/revision4、Graph/tool/respond均0。注入时钟与只读FakeIPC明确，非真实批准、云或物理Electron验收。冻结c75a614b；首轮19/20计时器失败保留后修复，portable旧清单4/6路径连续、2个源路径更正到既有冻结副本，原c937/e566不覆盖，不重测。

本批各原正式失败、夹具/脚本错误、完整affected和新公开消费者分别保留，不将父测试聚合失败当作多个缺陷。root与三个GPT-6.1 Sol执行线继续独立核对源、回执和真实现场步骤；只沿原PR提交，不批准或合并。实际固定head与新完整结果在发生后追加，整体MVP与真实现场验收仍未完成。

### 第二批固定源码的完整检查实际结果

固定5a914851733e8df0854a9586acaf1e7493b1c1cd/tree675495396e586e6415a263f8208901d836b78d15，原npm run check实际92996/9d606e→8e9231/exit0，03:58:46.980177Z至04:09:52.674357Z，Node24.15/CPU0–3/原期限断言。34组2613项2563通过、0失败0取消、50跳过；Cognition320/320、Desktop690/679通过11跳过、Runtime439/439、Calendar47/44通过3跳过、root integration22/22；原build/type/generated/architecture/contracts全部执行。完整raw257325字节SHAb3602a0b770352cbd9c6010f1dd2a14a11f576160ef89f051ebf3a53adcfa4e0；root及三执行线分别独立核原日志、全七字段、原50跳过边界、固定21文件和原启动回执。

Mail并行首次load候选经原、新公开batchTail入口及真实async屏障分别核实：仅load1，两批全结果与两条JSON持久记录一致、随后重放infer0，无新增并行回归，未为该候选改源。只在本文追加已发生的完整结果，发布头与上述固定source/test/config/generated逐blob相同，不为DOC重跑绿检查；此前0a6/e942及历史失败各自保留。真实现场验收步骤已明确交给用户、zemeng及对应协作者；本轮停止不表示整体MVP完成，不批准或合并。

### 第十三项：Wake迟到响应保留较新反馈

原完整HTTP/CSP页面中，Wake关闭后的只读snapshot迟到会清除其间实际SIS配置拒绝的新错误；旧配置文件精确不变、Wake仍disabled、Task0，无权限或状态绕过。只在自有renderer统一反馈写身份，Wake迟到成功继续更新状态但保留新反馈，迟到失败也不覆盖；同文本新写仍归新操作，当前snapshot的connection/voice错误不再额外清除，原updateVersion/unload/受理门禁不变。新增7例原handler/feedback回归；旧talk测试夹具仅注入原setter及revision声明，原6个测试正文/断言/期限字节不变。

固定47b8f98c3b1a7fe07aa59c95e49949d2dac16199的原完整Desktop工作区测试及原typecheck实际75775/ea8ef3→ac9a5c/exit0，04:25:11.042906Z–04:25:53.585032Z，Node24.15：697项686通过0失败0取消11原跳过，7新增例均实际执行；raw68123BSHA353401e95b1efc7987f2a3bd05406b07fc480c8b6844f3f7858354d10cf694c4，typecheck595BSHA7f7884a613131fdf9ec4eab7cd5c69b76586f1af2b8819b0e73b28147df1e36b。此次为Desktop内部UI修复的必要完整workspace检查；此前2613整仓检查覆盖前十二包，不覆盖新renderer，计数不相加。首轮A隔离Desktop679/666通过2失败11跳过的missing-setFeedback夹具故障及原portable失败均保留。

fresh AFTER实际527304/59772→999857/exit0，冻结renderer741a7da，原main配置/Wake路线AST、实际Host和配置文件、原全页面保留相同新SIS错误，按钮恢复、文件精确不变、初始化/Task/pageError均0。Fake设备/IPC传递与合成snapshot包络明确，不称原main整个snapshot或真实SIS/设备验收；AFTER配置metadata补用原main voice property AST，原BEFOREv4漏该字段但原证据未改或重跑。冻结A d9b6573d(18项)、D AFTER0a6b69e8(14项)，root逐字节核全部；仅DOC追加实际结果，仍沿原PR，不批准/合并，现场与整体MVP未完成。
