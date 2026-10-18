# 自有 AgentArts 镜像迁移工作包

> 公开脱敏投影：历史命令中的机器专属路径已改为接收者可配置占位或仓库相对路径；日期、数值、失败与原哈希保留。占位不是可直接执行的配置，运行前使用本机受信Node/npm、工作树及运行环境路径。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

初始日期：2026-10-08；当前更新：2026-10-12；状态：`in_progress`；负责人：zemeng。
目标：`huawei_ict_agentarts`。工作树：`<implementation>/agentarts-owned-image`，
分支 `codex/agentarts-owned-image`，基线 `origin/main@e86bac53`。
本包涉及 MOD-29/30/31 的云编排与既有 Coordination 消费接线。

## 2026-10-12 新版 ARM64 真实云验收增量

未合并预览源码 `194799c6979ed47d20dfd2d3ea17bbfd16f63fd6` 已发布 GHCR、导入 SWR，并替换 API Key Runtime 的 Latest 为 `arm64-194799c6`。真实 WSS 经 MaaS 模型提案、本地一次性 Policy 审批、生产文件读取、Evidence 和云端续答，任务 succeeded；执行 1 次、Evidence 1 条、HTTPS 应用调用 0、没有 Fake 或旧 Studio 调用。重开 Runtime Application 后仅持久读回验证关闭退出 0，没有网络或工具重放；云端目录发现 8 Workflow / 3 Controller。完整证据、原验收程序清理错误及尚未验收范围见 [真实华为记录](AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。

本增量只覆盖固定公开合成文件的真实读取场景，不能推导全部绑定逐项通过、真实写入、Wiki、自主修复或整模块完成。AMD64 Release/GHCR 专属版本已按用户确认撤销，详见 [撤销记录](OWNED-IMAGE-AMD64-RETIREMENT-20261012.md)。以下旧版本发布和失败为历史记录；工作包保持 in_progress，双人当前 head 阅读与审批门禁不变。

## 2026-10-12 可执行 Workflow/Controller 绑定

按用户要求补齐所有能够由镜像承载的绑定：8 个 Workflow、3 个 Controller 的固定资源目录、
独立阶段调用、同来源前置报告复核、确定性零模型提案、受保护目录与默认 Controller。
完整接口见 [绑定说明](../competition/OWNED_IMAGE_BINDINGS.md)，安全生成目录见
[绑定清单](OWNED-IMAGE-BINDINGS.json)，决定见 [ADR-0015](../adr/0015-owned-workflow-controller-bindings.md)。

原空 MVP Controller 新建 owned 主路由，原空导出事实保留；共享 Plan/Review 实现不冒充原提示词
等价。工具目录消费、实际执行、来源、凭据、持久任务和授权仍按原公开宿主端口提供。
未知/非法绑定、前置报告替换、目录缺失及候选无法表达的操作不放行。
普通调用、WSS/HTTPS、deadline/cancel、并发与 shutdown 沿原路径，无数据库迁移和新依赖。

实现阶段 pin Node24 的编排测试54/54（新增22项）与绑定/启动10/10通过；真实核心
在合成本机HTTP对全部11个资源完成dispatch，WS验证World/Plan/Review报告隔离。
原入口回归29通过、5个Windows SIGTERM边界跳过、0失败。完整check、镜像和发布
另记录最终结果，不把这些离线通过标为华为部署/真实模型验收。

本轮 Windows 根 `npm run check` 已退出0：各阶段累计2878项、2860通过、18跳过、0失败；
pin Node24.15.0/npm11.12.1。日志 `.cache/owned-bindings-20261012/full-check.log`，SHA256
`ad9bd6dc35249a1dcfde82fd03be4dbfa3ebadf04b3113677dfe614c423e0361`。
整仓结果包含全部11资源的真实核心HTTP分派与中文World报告到Plan的预算兼容回归。
后者按核心UTF-16字符限额处理，整体请求UTF-8限额和来源校验仍保持。
公开绑定清单经生成器 `export-bindings.mjs --check` 校验，catalogSha256为
`7666fd39dc5e59eed5a9f3e4fe3beaa3d4e6fd4e143f7d39c042dda154364c24`。

本轮源码 `0dae0ff5c1553b855825a29934b22270b675bb48` 已发布到 GHCR，多架构索引为
`sha256:82b7d1b0ac808ad89d2197b98871fd334084c88de9f56c016ffe29a75bd632dc`。
本地与发布的 AMD64/ARM64 镜像均以非 root UID1000、禁外网运行绑定测试，各9/9；
使用实际编排核心和显式 Fake 模型。GitHub Release 的两架构 tar、设计/接口包及校验附件已读回上传状态，
下载方法、源码版本和验证限制见 [已发布预览](../competition/OWNED_IMAGE_BINDINGS.md#已发布预览与使用入口2026-10-12)。
这是当时的未合并预览；其真实 Huawei 部署和模型/工具闭环当时尚未完成。新版当前结果见上方增量，工作包仍保持 `in_progress`。

## 2026-10-11 公开消费者与 Goal 报告兼容

延续原 #317 与 `codex/agentarts-owned-image`，同步基线为 `main@e86bac53`。开发在独立 Linux 工作树进行，保留此前 Windows 工作树与原云资产记录；三名 GPT-6.1 Sol 按明确文件范围并行，根执行者核对冻结源码 SHA 和回归证据后整合。Desktop 展示修复单独沿原 #313 交付。

- 默认与显式 HTTPS 不再注册仅 WSS 支持的观察者。WSS 发出后结果未知或鉴权失败的诊断在 `closed` 后保留，下一次连接或配置绑定才更新；Workflow 名称在读凭据、连接前按原公开传输解析器校验。
- Runtime Application 拒绝关闭活动任务时保留现有 WSS 连接。Device 通知等待受原 deadline/取消约束，未知投递保留待核实；迟到结果不得重放或自行变成 confirmed。
- 合法首次规划与 Laya 不确定 RECHECK 进入纯文本分析；有效 KEEP 保持 KEEP。缺项、受影响分类或未完整描述的依赖更新不得成为有效 KEEP/修复候选。合法同批新版依赖仅作为 prospective 依赖，按生产者先于消费者的顺序预览，不冒充已提交来源。
- Host 共享出口在读凭据/提交前阻止无可发送来源、单来源摘要超过8192、缺少合法来源、目标或依赖数量超出原公开16上限；不截断、放宽公共候选或把失败改成自动云端重试。原通用 Host 的合法 Goal 修复能力保留。 实际工具目录模式还检查完整 `{goal,availableTools:[]}` 的 UTF8 空目录下界是否超过32768字节，超过则尚未提交Task；未知模式与直接goal模式保持兼容。下界通过不保证真实动态目录可容纳，目录合计超限仍由原adapter在读取凭据前拒绝，可能已登记本地Task。
- `owned-1.2` 对显式 prepared、最新有效的 Goal target 使用完整 World/Plan 内部报告1.2，affected kind 与已提交 Goal 来源精确一致。旧 Decision/Plan 的1.1及 compact 兼容保留；Goal 不接受旧报告、compact、混版、缺来源或替换候选。公开 candidateVersion1.0、审批、Policy 与 CAS 保持原约束，云端不直接写图。
- 生产模型入口拒绝重定向到未配置端点；真实本地 HTTPS 合成端点验证307/308目标端请求为零。镜像上下文使用唯一临时目录，固定时钟并行生成也不复用旧目录；原 allowlist 不扩大。
- 导出清点器异常只输出固定错误，元数据 level 仅投影安全整数；合法元数据、源字节/hash与拒绝覆盖旧输出的行为保留，不解释或执行 DSL。验证只用合成导出，未访问真实私有原件。
- 手动开发调用已发出却没有合法结果时记录 unknown、保留共享锁，后续调用不再派发；明确鉴权拒绝、成功和已证明发送前失败保留原完成行为。VM 执行原宿主/外层入口及实际公开端口，用合成磁盘锁验证，不等于实体 Electron 或真实账号调用。
- Goal get/list读取结果在投影、最终接收及异步凭据等待后的发送前，再核对原回执与当前精确 scoped Goal。原版本已受限、撤回或变化时保留旧confirmed回执及待核实Task，不发送陈旧投影、不覆盖或重放；新独立授权请求仍可正常执行，无关图更新不阻断。
- 服务关闭时取消已受理HTTP工作并保留原CANCELLED/499响应；已504或早期401/404/400但上传未完成、以及尚未结束请求头的TCP连接也在关闭时结束。普通超时/拒绝的原响应码与关闭前行为保留，WSS沿原transport.close；不承诺远端提供者停止计费。
- 新allowlist上下文明确目录0755/文件0644，严格umask下默认`node`用户也能读入口；只改新公开导出，不改源码、旧私有目录或allowlist。原本机f22上下文0700/0600导致EACCES的启动失败保留，不能由此推断GitHub普通umask产物失败。
- legacy Meeting崩溃恢复不再凭共享event标签归属跨会议历史。仅匹配确定性历史修订内容才恢复完整节点，否则只记录原精确Fact与原区间；不写图、不重放或调用模型。实际生产Desktop使用reviewed Runtime路径，历史匹配不证明事务、审批或ExecutionEvidence。

最新根固定提交`f5424159d5ba90b909c588ac73a7b45b25f15b09`在2026-10-11 01:13:32Z至01:21:19Z完成`npm run check`：2848项、2798通过、50跳过、0失败；Node24.15.0/npm11.12.1，1179个tracked文件哈希和HEAD前后一致。原日志SHA256为`86e43a5495cb2d51c112a31edc60bdbbe29da7fd5d1eec5e40c81d1ceae12f13`；手动未知结果保锁消费者另12/12，日志SHA256为`2155adfc5c94638e85bcfa200b80ab8554d596c286c7d5f74460dca153b456e6`。之后`1233a84b6f290bd0ee7ce1b6b9503ff2ae4518f2`仅给原五个POSIX SIGTERM用例添加明确Windows边界，所有生产源码及其余断言/期限不变；根Runtime55/55通过，日志SHA256为`615f6cfc0e148beebaf649421a5a7fb22e959f629cb3a9a3a8e5fcb0fcebd517`。旧公开f22两份Windows Foundation实际45/50，Node在Windows强制终止子进程不能证明POSIX优雅关闭，原失败日志保留；新head Windows检查另行核实，不用Linux结果冒充。

严格077的新f542本机LinuxAMD64镜像默认CMD/USERnode实际HTTP8/8、内部WS4/4通过，dist为`owned-1.2`；真实SIGTERM、取消/期限、原身份回执重放和两容器重启unknown均已验证。公开f22预览的AMD64固定digest`sha256:2ab9c16bf58ef50c804c7ed48e52ee83b938c48ba2a0682989ea119e9bf31773`也已实际拉取，revision与默认user精确匹配，独立HTTP8/8及PID1 UID1000探针通过；不借本机修复结果覆盖公开产物。ARM64固定digest`sha256:7b0e6e84a16d2fa95fbbca5a2f1e8261ee2159c1d2848e6a081287eb82578c6f`已拉取核元数据，未执行。供应商、凭据和结果均为合成；TLS严格验证，redirect目标零请求、无自动重试。内部WS不是公网WSS，短运行未达到Docker HEALTHCHECK间隔，真实模型2048-token完整Goal报告、平台部署与账单仍未验收。

固定提交 `0edf2449d820a1f3bcebf5e9939614004ca32cf7` 的完整 `npm run check` 在 Node24.15.0/npm11.12.1 下退出0：2839项、2789通过、50跳过；1179个tracked文件的检查前后哈希、HEAD与源码状态一致，原日志SHA256为 `34b34742bdb05b78d77df528dbcf0648a3de819fbb84cd19e46ebc4054a475ec`。该组合覆盖Goal1.2、UTF8下界、Goal read当前版本、服务shutdown及此前手动/元数据增量。之后仅HTTP canonical日期收口提交 `beeff9c7ed5826ba9eb1698398a75af7c2e2c531` 在根交付树以该轮已构建的Owned1.2依赖通过完整runtime50/50与类型检查，原runtime日志SHA256为 `479b3373a49ca2e293d0880d348fb2351414b95431eb6d60d5af014716da5c1f`；没有把旧完整检查借给新日期代码。HTTP非法日/月/24:00在dispatch前拒绝，合法Z/.000Z/.123Z及真闰日保持，公开Schema/期限预算不变。手动入口在workspace/integration测试globs外重新单独执行12/12。Goal合成路径使用实际Host/Client/Runtime/SQLite/公开候选预览，另由原本地Policy与测试审批完成CAS/Evidence/readback；云任务不执行工具、不获得本地审批。

本轮不自行批准或合并；两位协作者当前 head 的本机设计阅读声明门槛保留。真实 Windows/Electron、物理音频、Huawei deployment、公网 WSS Upgrade、真实模型与 usage/费用读回仍未完成，由实际环境持有人及对应模块负责人处理。离线通过、仓库交付和预览镜像均不能替代这些验收，全部 MOD 与整体 MVP 仍未完成。

## 2026-10-09 WSS实施增量（当前分支）

新增同容器`/ws`与受保护`/invocation-status`，独立传输0.1.0公开Schema/生成类型，WS与HTTP共享并发限制。Coordination复用会话连接、逐次重读凭据；Runtime在发送前持久身份/摘要，未知等待核实并阻止重启重发；Desktop受信环境装配WSS与显式HTTPS备用，状态可见。备用只允许证明invoke未发送的连接失败，同一profile/目的地且不回退Local/Fake。接口与上线配置见[精确说明](../competition/OWNED_IMAGE_INTERFACES.md)、[ADR-0014](../adr/0014-agentarts-wss-transport.md)。

owned-1.1完整World/Plan报告已实现严格源版本、互斥分类、依赖及Review一致性检查；现有candidate1.0无法执行的删除/新增步骤/工具动作明确拒绝，缺连续事实前后版本返回RECHECK。旧资产逐项对应与仍未等价职责见[迁移矩阵](AGENTARTS-OWNED-IMAGE-PARITY.md)，下文10-08静态缺口保留历史含义。

本地真实TLS回环10场景通过（显式Fake模型），服务21/21、客户端/Runtime与旧回归187/187及独立契约6/6通过；后续显式地址配置与相邻Desktop测试34/34，WS客户端18/18。完整根`npm run check`本轮退出0，末尾集成24/24；完整工具TLS联测与后续错误分类/重启窗口修复分别记录。新版GHCR源码`97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`已发布，索引digest为`sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70`，[Actions 37953071877](https://github.com/zemeng5208/PersonalAgent/actions/runs/37953071877)成功。已发布AMD64/ARM64镜像分别独立通过容器21/21与生产入口合成TLS9次请求；来源、下载和验证范围见[新版发布记录](../competition/OWNED_IMAGE_WSS_RELEASE_20261009.md)、[新版预发布页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6)。这些验证使用合成模型端点，不证明真实华为运行时已验收。

云控制台2026-10-09读回三个原运行时保留；贵阳一区SWR私有组织`zemeng5208-personal-agent`已导入新版ARM64原包并读回唯一`sha-97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`标签，未扩大委托权限。新托管表单准备8080、前缀路由及原`DefaultAgentArtsRuntimeAgency`/`defaultgw`，尚未提交创建新运行时；环境/鉴权、公开WS路径及公网Upgrade仍需以新部署实际读回。云端仅有界内存回执，`restartRecovery:false`；自动status协调消费者与持久云端恢复未交付，unknown不自动恢复。

## 实现与兼容

- `packages/agentarts`：自有 fast/world/plan/review 编排、严格输入和模型输出校验、目录约束工具提案、原期限/取消、无内容角色回执。
- `apps/agentarts-runtime`：8080 HTTP `/invocations`、`/ping`、受保护 `/invocation-status` 与 `/ws` WebSocket Upgrade，受信模型装配、超时/断连/共享并发保护、Linux ARM64/AMD64 镜像与 allowlist 上下文。
- 复用 ModelGateway/ModelPort 和现有应用 JSON；没有新增任务库、工具宿主、审批、授权或本地 Evidence 路径。
- Coordination 保留 `X-PA-Deadline` 与仅对 repairContext 续接添加候选提示；新增显式 WSS 配置、连接复用与受限 HTTPS 备用，已发送但结果未知时不备用重发，普通天气/文件续答不误入修复。
- 无数据库迁移；输出仍由本地 Runtime 严格解析，Candidate 仍须预览、Policy、CAS 与读回。接口为 provisional，云端输出始终 unverified。
- 同一服务可显式选择 `standalone-validation`，仅作为相同业务代码的独立验证入口，不在 Competition 失败后自动切换。

## 2026-10-08 云资产与原始导出（历史阶段）

以下保留当日清点与静态迁移判断；当前 owned-1.2 报告实现及仍未等价的职责以本文开头和 [逐项迁移矩阵](AGENTARTS-OWNED-IMAGE-PARITY.md) 为准，不沿用旧表宣称当前全量完成。

控制台实时读回：单智能体 0、多智能体 3、工作流 8。工作流导出在浏览器工具中报告下载被取消，
用户随后提供已下载原件 `workflow_[8]items_20261008203232.jsonl`。
已复制到本工作树 `.cache/agentarts-exports/workflows-20261008.jsonl`，两份 SHA256 一致：
`9e76c85486254acbbf66ce0de94026f1cfb89d60e087c2569ff2b6f38946798f`。
文件含 15 条记录、8 个顶层 workflow；关联 workflow/model/provider 引用全部存在。
白名单元数据、节点类型、关联引用和源片段哈希见 [资产清单](AGENTARTS-OWNED-IMAGE-ASSETS.json)。
导出包含 Provider 认证配置字段，原件仅保留在忽略目录，不输出或复用其密钥。
清点器只报告白名单字段、节点类型和提示词/代码哈希，不执行导出 DSL/Python。

重启后控制台重新登录，3 个多智能体已实际下载为 `Multi-agent_[3]items_20261008210740.jsonl`，
复制到 `.cache/agentarts-exports/multi-agents-20261008.jsonl`，原件与副本 SHA256 一致：
`baf48388dc8c79e81abbf45da8fbb8b260d8871e6341f6e37885b65143f7c507`。
导出含 12 条记录，3 个顶层 controller，workflow/model/provider 关联引用完整。
脱敏清单见 [控制器清单](AGENTARTS-OWNED-IMAGE-CONTROLLERS.json)。
只读取控制器提示、子工作流绑定、迭代和历史开关，没有输出或复用认证字段。

| 多智能体 | 导出配置事实 | 迁移判断 |
| --- | --- | --- |
| PersonalAgent持续认知协调器_1 | Normal/Default 两条终止绑定均指向 PA-MVP-受限主路由同一版本；max_iteration=1，history=false | 现有镜像确定性路由对应此链，不应重复执行两个相同绑定 |
| PersonalAgent持续认知协调器 | Normal/Default 均指向 PA-世界状态影响分析旧版本；max_iteration=9，history=false；提示要求唯一子工作流调用一次并原样返回 | 控制器本身不新增业务工具；旧 Workflow 报告及内部9节点链仍需兼容比对 |
| PersonalAgent-MVP协调器 | 仅默认 Controller 节点，workflows/agents/global_intents 为空，history=false | 名称和描述与实际空绑定不一致，不能把它计为已经实现的确定性意图链；不修改或删除云原件 |

| 顶层工作流 | 当前处理 | 尚需比对 |
| --- | --- | --- |
| PA-MVP-受限主路由 | 路由与 World → Plan → Review 已迁入代码 | 真实模型语义、角色输入/报告压缩与旧链等价性 |
| PA-MVP-快速工具与答复 | 动态工具目录、普通答复与 confirmed 续答已迁入 | 真实模型工具选择和多角色 subagent.dispatch |
| PA-MVP-确定性意图 | 由确定性入口解析/路由代替 | 3 个控制器已清点；未发现该工作流的实际控制器绑定 |
| PA-计划最小修复_1、PA-证据安全审查_1 | MVP 修复职责已迁入 | 候选与真实 Goal/Fact 变更同批验收 |
| PA-世界状态影响分析 | MVP 世界分析职责已迁入 | 旧泛化报告、9 节点链与历史路由未逐项证明等价 |
| PA-计划最小修复、PA-证据安全审查 | 保留云原资产及导出 | 旧报告和兼容入口尚未完成迁移 |

当前绑定模型从导出读回为 `deepseek-v4-flash`；新服务需由受信宿主独立配置实际入口和凭据。
没有把导出中的模型绑定或账号配置冒充真实模型调用成功。
当前“我的资产”页面已读回 Skill 无数据、MCP 无服务；重启后插件和独立提示词均显示没有资产，
记忆库计数0、知识库显示没有资产、自定义网关计数0（配额10）。
这些事实只描述本账号/当前区域云列表，不改变本地 MCP/Skills/知识/记忆的能力状态。
现有运行时列表加载后为3条，均显示“正常”、入网配置 `defaultgw`：
`PA-世界状态影响分析`、`PA-证据安全审查`、`PersonalAgent持续认知协调器`。
控制台正常状态不替代调用成功、镜像拉取权限或真实 trace 验收，也不能把平台内置 `defaultgw`
误计为当前自定义网关列表的资产。
3 个多智能体原始导出已保存；Identity、会话持久化及平台评估资产仍需继续清点。

旧工作流静态比对已确认：World 内部报告另含 observed_facts/changed_facts/affected_items，
Plan 内部报告另含 preserved/rechecked/revised/removed_steps、dependency_updates、evidence_required、local_next_actions。
旧 Review 最终仍要求现有 text/tool_proposal/repair_candidate 协议，禁止输出内部报告包装。
当前代码对内部报告进行了收敛，尚不能仅凭最终 JSON 兼容就认定这些内部分析职责完全等价；
继续入口是保留来源、直接/传递影响及保留/复核/移除步骤语义的逐项验证。

## 2026-10-08 验证与当时阻碍（历史阶段）

- Node 24.15.0/npm 11.12.1 的 `build:owned-agent` 通过。
- 核心/HTTP/续接针对性测试 22/22 通过：目录与 Schema、修复范围/版本/依赖/审查一致性、缺口、错误、原期限、取消、断连、慢上传及无回退。
- 镜像上下文生成 47 个 allowlist 文件；从裁剪根锁文件 `npm ci --omit=dev --ignore-scripts` 成功，11 个包；编排与服务入口可导入。
- 根 `npm run check` 的架构、契约夹具、生成类型、全工作区构建/类型检查和测试阶段通过；首次集成阶段因新增测试夹具配置名错误失败，已按公开契约修正并补全关闭清理。随后完整 `npm run test:integration` 24/24 通过，没有重复已通过的无关工作区测试。
- 新增两项集成验证使用 Fake 语义模型、真实本地 HTTP、SQLite Runtime 和真实合成文件：审批前读取次数为0，allow_once后读取一次并保存confirmed执行/Evidence；续答错误保留回执并进入 waiting_reconciliation，不重做工具或伪造成功。
- 基础镜像索引 digest 已读回并固定为 `sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`，含 linux/arm64/v8。
- Docker Desktop 4.94.0 已安装到 `<docker-install>`，数据位置指定 `<docker-data>`；官方包 SHA256 与 WinGet 一致，签名 Docker Inc 有效；CLI 29.8.2、Buildx 0.37.2 可执行。
- 用户重启后已实测 WSL 3.0.1.0、HypervisorPresent、Docker Linux Server 29.8.2 正常，D 盘 WSL 数据目录已创建。
- 应用镜像 `personal-agent-owned:20261008` 已实际构建并载入本机 Docker，读回 `linux/arm64`、运行用户 `node`、大小 93,263,449 bytes。索引 digest：`sha256:d126119af47c23445280d831e0f4b04c49c92403902d8d751340739962eb96e5`；ARM64 manifest：`sha256:68ced787fd9288427a13812720682d742671771f301b33fca67c7b524db173ad`。本地构建日志、元数据与上下文在 `.cache/agentarts-image/`，不等于远端 registry 已发布。
- 实际 ARM64 镜像在 `--network none` 下运行 HTTP/编排/缺配置启动测试 16/16 通过，测试目录只读挂载；缺少配置时生产入口退出 1，没有 Fake 回退。
- `test/production-transport.mjs` 在同一镜像内通过生产 `src/main.mjs` 和既有 OpenAICompatibleModelProvider，经只在该子进程信任的短期合成 TLS 证书进行 9 次回环请求：健康、认证、答复、工具提案、confirmed 续答、World→Plan→Review、非法模型输出、脱敏提供者错误、原期限和 SIGTERM 关闭均通过。未关闭证书校验、未改系统信任、未访问外部网络或真实付费模型。日志 `.cache/agentarts-image/production-transport.log`。
- 尚无 SWR 推送或 AgentArts 新 deployment 证据。
- 真实云模型、trace/usage/费用、工具闭环、评估、防静默回退及另一平台/自托管真实服务验收均未完成。

以上为 2026-10-08 阶段记录；当时尚未提交或发布。它不代表整个迁移包 done，也不提升 MOD-29/30/31 的真实可用状态。

## 2026-10-09 GitHub 交付更新

用户已授权提交本工作包的全部镜像源码、接口及设计文档，并向 GHCR 发布预览镜像。完整根 `npm run check` 已重新通过；设计阅读门槛 6/6 测试通过，39 模块与四幅 SVG/离线阅读页已检查。全仓文档同步清单见 [审计清单](../reviews/DOCUMENTATION_SYNC_20261009.json)。

main 远端已设置两次审批、最新推送后的批准、过期审批作废、必需 `check` 与 `design-read-confirmations` 检查、管理员同样受约束、禁止强推/删除。goo122 和 Potatos498 必须各自在本机打开当前设计并提交版本绑定的阅读确认及审批；不能强制合并。远端无法独立证明物理阅读，采用本人 GitHub 账号声明与本机文件摘要校验，见 [阅读门槛](../reviews/DESIGN_READING_GATE.md)。

发布采用仓库 Actions 的临时 `packages: write` 令牌；用户的现有 GitHub 登录没有包写入 scope，不复制个人凭据。源码、接口和文档已提交 [PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317)。前一HTTP预览`157d5769`曾发布并匿名拉取验证，ARM64/AMD64离线包已导出；其历史tag、digest、Actions、附件及校验和见[旧发布记录](../competition/OWNED_IMAGE_RELEASE_20261009.md)。该旧镜像两架构各16/16与生产TLS9次回环请求通过，仅记录旧版本。

最新WSS预览`97aa51a6`的GHCR发布、独立镜像验证与下载入口见[新版发布记录](../competition/OWNED_IMAGE_WSS_RELEASE_20261009.md)及本文开头；旧摘要不能证明新版内容。Wiki接入和完整常驻自主能力仍待交付，Wiki具体实施归goo122。公网Upgrade、真实华为deployment/模型/trace/评估、自动status协调和持久云端恢复仍待验收或实现。

## 续跑入口与回滚

1. 依据已保存的 workflow/controller 原件继续旧报告和其他云资产的移植与兼容验证；不能用空服务、提示词摘要或 Fake 替代全量验收。
2. 代码修改后使用本工作树 Node 24.15.0/npm 11.12.x 构建、重新生成 allowlist 上下文和 ARM64 镜像，记录新的 digest；现有镜像和验证记录可直接作为继续入口。
3. 在同区域 SWR/AgentArts 新 runtime/version 部署，保存 API/trace/模型/评估证据，再对同一 Desktop/Runtime 做真实普通答复、天气/工作区、Goal/Fact 修复和审批读回。
4. 同一镜像在显式独立宿主完成真实模型/工具验证，证明迁移性；比赛主配置保持 AgentArts。

回滚只恢复旧 endpoint/版本，保留旧资产、数据库、任务和已确认副作用，不重复未知写入。
部署授权、模型账号使用和公开发布按用户相应请求执行，不把本机现有凭据视作授权。
依据见 [ADR-0012](../adr/0012-owned-agentarts-image.md) 与 [服务说明](../../apps/agentarts-runtime/README.md)。

## 2026-10-12 无版本报告修复与源码传输验证

工作树 `<implementation>/agentarts-report-version`，分支 `codex/agentarts-report-version`，
HEAD `c5e9222f8c24032a41f6c697ae29745292c739c5`。修复尚未提交。绑定入口拒绝调用方提交的无
`reportVersion` World/Plan 报告。直接 `invoke()` 在 sources 为空时先判断 World 处置：紧凑 KEEP
返回「KEEP：世界状态分析无需修复。」；紧凑 REVISE/RECHECK 返回 RECHECK。无事实或 Goal 来源的版本化
KEEP 在校验中拒绝，不会返回 KEEP 文本。这些路径都不调用后续 Plan/Review，不产出 `repair_candidate`。

本段只记录本次源码进程验证，不改写上文容器和发布镜像的 9 次请求证据。

- 源码验证：`node --test packages/agentarts/test/orchestrator.test.mjs` 退出 0，13/13。新增紧凑 KEEP
  与版本化 KEEP 两条无来源用例。此前同一工作树的根 `npm run check` 已退出 0，覆盖当时的共享校验逻辑；
  本次没有再改 `packages/agentarts/src/index.ts`，也没有重跑全量 check。
- 源码传输：在忽略目录 `.cache/agentarts-image/tls-fixture` 用既有 OpenSSL 命令生成 1 天合成证书，
  SAN 为 `IP:127.0.0.1`，`notAfter=Oct 13 13:26:32 2026 GMT`。父进程未设置
  `NODE_TLS_REJECT_UNAUTHORIZED`，未写入系统信任库。命令为设置 `PA_TEST_TLS_DIR` 后执行
  `node apps/agentarts-runtime/test/production-transport.mjs`。子进程只通过 `NODE_EXTRA_CA_CERTS`
  信任该证书，模型是 `https://127.0.0.1` 上的合成端点。
- 该脚本在 Windows Node v26.3.0 上退出 1。关闭前的断言已通过：完整 World→Plan→Review 候选、无来源
  精确 RECHECK 且仅新增 1 次 World 请求、Plan/Review 提示词未出现、模拟队列在后续非法输出用例前为空、
  模型请求总数 10、提供者错误正文不含 `synthetic-private-provider-error`、stderr 为空、stdout 不含凭据。
  `child.kill('SIGTERM')` 的实际关闭结果是 `[null, 'SIGTERM']`，不是脚本要求的 POSIX `[0, null]`。
  因此 `main.mjs` 的 SIGTERM 关闭处理本次没有被证明已经执行。日志
  `.cache/agentarts-image/production-transport-20261012-source.log`。
- 容器验证：本次没有构建或运行容器。上文 2026-10-08 镜像内的 9 次回环请求、以及容器 16/16、21/21
  记录保持原样。
- 发布镜像验证：本次没有拉取、运行或发布 GHCR 镜像。`157d5769`、本地 `personal-agent-owned:20261008`
  与已发布 `97aa51a6` 的生产 TLS 历史记录仍是 9 次请求。`0dae0ff5` 的已发布镜像记录仍是绑定测试各架构
  9/9，本文没有把它改记成生产 TLS 10 次。当前未提交脚本比这些历史传输多一个无来源 RECHECK 用例，
  所以本次源码进程的模型请求断言是 10；上述 9 次记录保持不变。

## 2026-10-12 当前修复的 Linux AMD64 容器传输

上一节的「未运行容器」只描述当时的源码进程验证。本节追加其后完成的本地 AMD64 容器运行。
Windows 上 `[null, 'SIGTERM']` 的关闭失败、以及上文 9 次请求的历史镜像记录均保留，没有改写。
关闭断言仍要求 `[0, null]`，没有放宽为接受强制终止。ARM64 本次未构建、未运行，标为未验证。
镜像未提交、未推送、未发布。

构建时未提交补丁为 7 个文件，+308 / -51，HEAD 仍是
`c5e9222f8c24032a41f6c697ae29745292c739c5`。本节是容器跑完后追加的文档，不在镜像 allowlist 中。

- 编译与上下文：`npm run build --workspace=@personal-agent/agentarts`，
  然后 `npm run image:context --workspace=@personal-agent/agentarts-runtime`。
  上下文为 `.cache/agentarts-image/context-PpsvcR`，58 个 allowlist 文件。
  `packages/agentarts/dist/index.js` 的 SHA256 为
  `9e455ecf4cc82ba2e5c89d41c6c2124926f016a3a9e7795908ae3f5bc5560a6f`，工作树与上下文一致，
  且包含紧凑 KEEP 返回、`bound || hasGoalTarget` 和无来源 `Repair source projection required`。
- 镜像构建：在该上下文执行
  `docker buildx build --platform linux/amd64 --load --progress plain -t personal-agent-owned:report-version-local-amd64 .`，
  退出 0。日志 `.cache/agentarts-image/report-version-amd64-build.log`。
  本地镜像 ID `sha256:054138397547d9041d8534ba9ebaf8766a8bdafbb2c181c55684c67558571189`，
  配置 `sha256:822866cde5a24c582c3808087b3ebba9f24e551ff6c35d43f8bc050056c73403`，
  `linux/amd64`，用户 `node`，创建时间 `2026-10-12T13:40:09Z`，大小 392,049,593 bytes。
  检查记录 `.cache/agentarts-image/report-version-amd64-inspect.json`。
- 容器产物：`--network none` 下以 `node -e` 读取镜像内文件。`dist/index.js` 的 SHA256 与上述工作树构建一致，
  `apps/agentarts-runtime/src/main.mjs` 的 SHA256 为
  `2d9609cbf055586690174b4001a0965aca4588f6f3294b1552228a9a4dbe1aad`，也与工作树一致。
  容器为 `linux` / `x64`，UID 1000，Node `v24.15.0`。测试脚本不在镜像内，运行时只读挂载工作树中的当前脚本。
- 传输命令使用既有合成证书 `.cache/agentarts-image/tls-fixture`（SAN `IP:127.0.0.1`，
  `notAfter=Oct 13 13:26:32 2026 GMT`；核对时间为 `2026-10-12T13:39:03Z`）。未设置
  `NODE_TLS_REJECT_UNAUTHORIZED`，未改系统信任，未调用真实模型。容器 `--network none`，
  只读挂载测试目录和证书目录，`PA_TEST_TLS_DIR=/tls`：

```powershell
docker run --rm --name personal-agent-report-version-transport --network none --user node `
  --mount type=bind,source=<工作树>\apps\agentarts-runtime\test,target=/opt/personal-agent/apps/agentarts-runtime/test,readonly `
  --mount type=bind,source=<工作树>\.cache\agentarts-image\tls-fixture,target=/tls,readonly `
  -e PA_TEST_TLS_DIR=/tls personal-agent-owned:report-version-local-amd64 `
  node apps/agentarts-runtime/test/production-transport.mjs
```

- 结果：退出 0。stdout 为
  `{"status":"passed","productionEntry":true,"tlsVerification":true,"externalNetwork":false,"modelRequests":10,"cases":["health","auth","text","tool-proposal","continuation","world-plan-review","source-less-recheck","schema-rejection","sanitized-provider-error","deadline","shutdown"]}`，
  stderr 为 0 字节。该通过发生在脚本断言 `child.kill('SIGTERM')` 的结果为 `[0, null]` 之后，
  因此 Linux 容器内 SIGTERM 按预期正常退出。无来源用例的仅 World、队列清空和后续用例隔离断言也随脚本通过。
  日志 `.cache/agentarts-image/production-transport-20261012-container-amd64.log`，
  空错误日志 `.cache/agentarts-image/production-transport-20261012-container-amd64.err.log`。
- ARM64：未验证。没有执行 `--platform linux/arm64` 构建或运行。
- 这是本地测试镜像，不是 GHCR 发布镜像，也不替换 `personal-agent-owned:20261008`、`157d5769` 或 `97aa51a6` 的历史 9 次请求记录。

## 2026-10-12 当前修复的 Linux ARM64 容器传输

上一节写「ARM64：未验证」时，还没有执行 ARM64 构建。本节追加其后的 linux/arm64 验收。
源码测试、先前本地 AMD64 记录、Windows 关闭失败，以及已发布镜像的 9 次请求记录都保留。
本次没有把 AMD64 结果当作 ARM64。关闭断言仍要求 `[0, null]`。未调用真实模型，未部署华为，未发布镜像，
也没有修改发布流水线。

- 产物：重新执行 `tsc` 与 `image:context`。最终上下文 `.cache/agentarts-image/context-wsdYap`，60 个文件。
  它包含当前报告校验修复，也包含当时工作树里已有的生产入口改动：`main.mjs`、`server.mjs`、
  `model-fetch.mjs`、`request-path.mjs`。这些运行时文件不是本包修改的。
  `packages/agentarts/dist/index.js` SHA256 为
  `9e455ecf4cc82ba2e5c89d41c6c2124926f016a3a9e7795908ae3f5bc5560a6f`，
  含紧凑 KEEP 返回、`bound || hasGoalTarget` 和 `Repair source projection required`。
- 构建命令在该上下文执行，退出 0。日志 `.cache/agentarts-image/report-version-arm64-build.log`。

```powershell
docker buildx build --platform linux/arm64 --load --progress plain -t personal-agent-owned:report-version-local-arm64 .
```

- 镜像身份：本地标签 `personal-agent-owned:report-version-local-arm64`，
  ID `sha256:1e53e9de00619fe15566c563ff66f0907d89e9905a1c80a9c36d1c8861d4cfa9`，
  配置 `sha256:7363fb9efcb5a84aa6d38242a3d2ee2a13bab8d2c2bf0cfbdd323c66e6841715`，
  `linux/arm64`，用户 `node`，创建时间 `2026-10-12T13:54:39Z`，大小 93,286,301 bytes。
  检查记录 `.cache/agentarts-image/report-version-arm64-inspect.json`。
  同标签早先的 `sha256:a03aa711723ba18d3ecc8420f018e03e23179ed9006d15f97f60c935191e1e45`
  生成于上述生产入口改动进入上下文之前，不作为本次验收镜像。
- 容器读回：`--platform linux/arm64 --network none` 下 `process.arch=arm64`、`process.platform=linux`、
  UID 1000、Node `v24.15.0`。镜像内 `dist/index.js`、`main.mjs`、`server.mjs`、`model-fetch.mjs`、
  `request-path.mjs` 的 SHA256 与构建时工作树一致。Docker 引擎本身是 linux/amd64，ARM64 进程通过该引擎的
  linux/arm64 仿真运行；这不是 AMD64 容器结果。
- 传输使用既有合成证书 `.cache/agentarts-image/tls-fixture`，SAN `IP:127.0.0.1`，
  `notAfter=Oct 13 13:26:32 2026 GMT`。未设置 `NODE_TLS_REJECT_UNAUTHORIZED`，未改系统信任。
  测试目录和证书目录只读挂载，`PA_TEST_TLS_DIR=/tls`：

```powershell
docker run --rm --name personal-agent-report-version-transport-arm64 --platform linux/arm64 --network none --user node `
  --mount type=bind,source=<工作树>\apps\agentarts-runtime\test,target=/opt/personal-agent/apps/agentarts-runtime/test,readonly `
  --mount type=bind,source=<工作树>\.cache\agentarts-image\tls-fixture,target=/tls,readonly `
  -e PA_TEST_TLS_DIR=/tls personal-agent-owned:report-version-local-arm64 `
  node apps/agentarts-runtime/test/production-transport.mjs
```

- 结果：退出 0，stderr 为 0 字节。stdout 为
  `{"status":"passed","productionEntry":true,"tlsVerification":true,"externalNetwork":false,"modelRequests":10,"cases":["health","auth","text","tool-proposal","continuation","world-plan-review","source-less-recheck","schema-rejection","sanitized-provider-error","deadline","shutdown"]}`。
  脚本仍先断言完整修复链、无来源只新增一次 World 请求、后续用例队列为空，以及 `SIGTERM` 结果为 `[0, null]`，
  然后才写出该 JSON。日志 `.cache/agentarts-image/production-transport-20261012-container-arm64.log`，
  空错误日志 `.cache/agentarts-image/production-transport-20261012-container-arm64.err.log`。
- 分层：源码编排测试仍是此前的 13/13，本次没有重跑。ARM64 容器测试是本节。已发布镜像测试没有重做；
  `157d5769`、`personal-agent-owned:20261008` 和 `97aa51a6` 的历史生产 TLS 仍是 9 次请求。
- 剩余：没有原生 ARM64 硬件记录；没有推送或发布这个本地镜像；发布配置里的 AMD64 清理不在本包范围。
