# 编程工具：可信工作区能力（MOD-18）

## H3 候选隔离试跑（2026-10-20，接线中）

`createHarnessCandidateTrialTool(options)` 返回普通 `coding.repair.trial@1.0.0` RegisteredTool。
输入为 `{candidateId, patches: CodingRepairPatch[], recipeIds: string[], parentTrialRunIds?: string[]}`；一次原 ToolGateway
调用试跑一个候选，原 Policy 须授予 `workspace:read/write/apply/execute` 对应四个 scope。
工具不产生授权，也不调度其他候选。模型不能指定工作区、命令、owner、配置或来源摘要。

可信宿主注入原 F15 `IsolatedCodingRepairHost`、`readBinding(context,candidateId)`、
`readSession(context)` 和 `saveSession(context,input)`。后两者接原 Runtime 的 task/run/input
检查点，须写入一次并保持同 run 幂等；在任何候选 patch 前先保存原会话。已有会话时拒绝重做，
通过该原 session 的 `reconcile` 核实未知执行，不从新 run 或新目录重试。取消/期限沿原 ToolContext，
已发生的隔离修改保留；命令仍不明确停止时不能发新的命令。

`readBinding` 返回唯一 `@personal-agent/contracts/harness-candidates` 的
`HarnessCandidateContext`。共同 owner 为 `binding.taskId`，实际执行者为
`binding.trialTaskId === session.taskId === context.taskId`；跨 task 合法性由 Runtime 原委派记录验证。
需要组合时，模型仅提供两个以上原 `parentTrialRunIds` 引用；
`readParentArtifactDigests(context,candidateId,parentTrialRunIds,patches)` 只从同 owner、合法执行者的已确认
原 run 读回真实父产物并核对实际组合输入，拒绝跨 scope、未确认来源和循环，不能把模型摘要当来源。
每个引用须有独立产物摘要，试跑前后重新核对；组合在新会话完整重新验证，不继承父检查。
未提供该端口时普通候选父列表为空，组合请求明确返回 unsupported；工具也拒绝引用当前自身 run。

宿主可用 `expectedBaselineSnapshotId` 锁定所有候选的原基线；基线变更会在新会话复制前拒绝。
每个候选复用 F15 独立文件副本、依赖准备、精确补丁、固定 recipe 和原验证指纹。
所有 required recipe 必须实际调用，失败保留 FAILED，未知调用抛给原 Runtime 等待核实；
未运行、超时或取消不伪造通过回执。输出只含绑定、文件摘要和验证元数据，省略文件正文及原命令诊断。
验证引用当前外层 run；比较模块必须等 Runtime 确认该执行并核对原输入后才接受，引用本身不是 Evidence。

候选会话始终 `isolated`，禁止发布主目录。选中后应由原主 F15 会话按精确补丁重新验证后 CAS/readback，
比较建议不能直接把隔离会话改为可发布。目录隔离沿用 F15 应用层边界，不是任意恶意代码的 OS 沙箱。
Runtime 工具注册、原 task/run 检查点与比较消费由对应拥有者接线；在联合验证前，本节不代表完整 H3 或云端验收通过。

`createHarnessCandidateAdoptionTool(options)` 提供 `coding.repair.prepare_adoption@1.0.0`，
模型只传 `{trialRunId}`。新增受信 `readSelection(context,trialRunId)` 从原 Runtime 已确认的比较/试跑
及原精确调用参数读取 `{trial,comparison,patches}`，不能把模型提交的正文或选择声明当来源。
该工具检查 owner、实际 child/session、原 run、共同配置与配方、所选 artifact 和原 required 验证，
再从相同基线开新的 `main` 会话重新应用并执行检查。它返回新的 `CodingRepairCheckReadback`，
失败配方保留真实状态；失败或 unknown 不构成可发布成果。新产物摘要须等于所选 artifact，
期间选择/配置变化则拒绝；主目录到此仍未写入。

采用准备、确认和发布分为原工具链中的不同调用：Runtime 先确认 prepare 的真实结果/Evidence，
之后原 `coding.repair.publish` 才能用该新 main session 的验证 run 经 Policy/CAS 交付并读回。
没有原确认 Evidence、验证失败或用户并发修改时原宿主会拒绝或返回 conflict，保留双方文件。
`recommendation.publishRequest` 中的隔离 session 只是产物建议引用，不能直接用作交付目标。

`createHarnessCandidateRecoveryTool({host,readOriginalSession,now?})` 提供
`coding.repair.reconcile_trial@1.0.0`，输入仅 `{trialRunId}`，返回唯一 `HarnessTrialRecovery`。
Runtime 的可信 `readOriginalSession(context,trialRunId)` 从原 task/run 检查点读回 `CodingRepairInput`；
必须保持实际 `context.taskId === session.taskId`。owner 核实子任务时，由 Runtime 沿原合法执行者调用，
不能伪装 owner 身份去改写 child context。工具复用原 `reconcile`，以只读 `host.readback` 返回原
snapshot/verification 元数据；没有新 patch、命令或验证，不用恢复 run 代替原验证 Evidence。
`clear` 只表示原 journal 已没有未停操作，旧 UNKNOWN 验证仍为 UNKNOWN，不能当通过或重开终态。

本包独立依赖安装和必要 contracts/models/agents/github/policy/tool-gateway/coding-tools 定向构建已完成，
Node 24.15.0、TypeScript 编译通过。依用户“先完成全部代码，再统一验证”的最新优先级，
`test/harness-trials.test.mjs` 的 13 项回归已保存但尚未执行；未声明实际 Runtime、云端或最终采用验收完成。

Desktop 原 `WorkspaceConfigHost` 现公开稳定 `harnessRepairHost` deferred 代理和
`readHarnessCandidateContext(context,scope)`。代理保留原 root/Node 身份、许可、任务绑定、代次与取消检查，
参数进入异步操作前复制，返回前再次校验，不暴露新的根目录或绕开 Policy。上下文按原已选工作区
捕获 baseline/recipes，owner/input/configuration 来自 Runtime 已校验的 `RuntimeHarnessScope`。
主进程须注入 `readHarnessVersions()` 的可信 `{workflowVersion,runtimeVersion,executionKind:'real_host'}`，
缺少版本或异步读回期间版本/授权变化时返回 unavailable；协议版本不能冒充运行版本。
Runtime 组合入口使用 `{host: workspace.harnessRepairHost,readContext: workspace.readHarnessCandidateContext}`，
具体 main.js 注入由其唯一写入者完成；本包不覆盖 main/settings/停止按钮改动。

等待核实的任务不能再执行模型工具，因此原生 `task.reconcile` 另使用
`IsolatedCodingRepairHost.reconcileOriginalSession(input)`，Workspace 对外为
`reconcileHarnessOriginalSession(input)`（也挂在 `harnessRepairHost`）。输入是
`{session: CodingRepairInput,trialRunId,expectedRevision,deadline,signal,assertCurrent()}`，
只由 Runtime 从原记录/会话/用户权限构造。该方法按原实际 task/session 精确读 journal，
不伪造 ToolContext、不创建 Gateway run、不执行 patch/check/command，也不改原执行或 Evidence 为 confirmed。
所有异步读回和 journal 保存前后执行 revision/权限 fence；补丁 marker 保留供原结果核实，
`clear` 仅表示 journal 的操作已停，不代表 UNKNOWN 验证通过。Runtime 原生入口再沿原 UI 解释结果。
此次仅该 native revision/停止读回关键单例 1/1 通过，余下行为回归仍后置。

经验生命周期的 Main-only `WorkspaceConfigHost.readHarnessExperienceCurrentSync()` 当次读取原源文件，
返回 `{snapshot,versions,configuration:{bindingId,workspaceId,recipeFingerprint}} | undefined`。
该同步方法不要求源 owner 仍 running；仍复核当前工作区/Node 身份、许可、代次、配置和同步版本来源。
版本 port 若返回 Promise 则拒绝，不读取异步缓存，不轮询，也不在普通 publish 时自动扫描。
H1/H2 以真实稳定配置组装经验 scope，方法不接收模型 task/scope，不返回正文或绝对根路径。
底层 `captureCodingRepairSnapshotSync(root,assertCurrent?)` 与原异步 capture 共用同一 metadata/包图组装，
过滤、路径/链接拒绝、SHA 和 snapshot 语义保持一致。仅执行同步/异步过滤与包图一致性关键单例 1/1 通过；
行为全测和真实经验次任务接线验收仍按统一顺序后置。

原 `coding.repair.publish/snapshot/readback/reconcile` 通过 Main-only Runtime 只读方法
`isHarnessCodingRepairSession(context,{sessionId,operation}): boolean` 核实原 H3 main session、实际调用者、
当前 started 输入与已确认的 prepare 验证来源。只有明确 true 才转向 `harness-isolation`；
缺方法或 false 保留原 F15 `coding-isolation`，异常直接拒绝。模型不能选择目录/后端，
不合并两种 journal，不把实际 executor 改写为 owner；最终 publish 仍用原 Policy/CAS/readback。
其他会话操作及 HostBridge 保持原路径，Runtime reader 不为其授予 H3 路由。

### 已准备依赖与安全结果投影增量

依赖项目使用原 `package-lock.json` v2/v3 与 `node_modules/.package-lock.json`，核对根/工作区
manifest、已安装版本/来源 metadata，再封存真实依赖字节指纹。原 Workspace `authorize(input)`
现在返回 `Promise<原snapshot>`，Main 必须 await；一次授权内的临时 FS worker 完成并退出后才返回。
准备期间开发配置和隔离工具明确 unavailable，撤销取消原 worker，旧代次不得回填。
普通配置 getter 不遍历依赖。该指纹证明授权时已准备字节的一致性，不证明 registry tarball 真实性。

`prepareIsolatedCodingDependencies` 仅独立复制这些已准备文件，保留目录内的 workspace/bin 链接，
拒绝外部链接/未锁顶层包/敏感配置，不安装、联网或共享可写文件身份，不复制主目录构建输出。
已有锁包中的 bundled/fixture payload 也纳入字节指纹。复制前后和实际 verify/publish 前后用
可取消、原 deadline 限定的 worker 重新核实；改动或未知保持 closed。原固定配方按受信顺序先 build
再 test，不能由模型倒序。候选 npm 使用空的私有配置、home/cache/tmp、offline 和 ignore-scripts，
不能隐式消费账户 npm 配置。此仍是应用层约束，不是任意项目代码的 OS 沙箱。

经验同步 scope 仍只表示当前源文件/包图、封存配置、真实版本与配方，不声明 live node_modules 字节；
不在同步经验 final gate 扫描依赖，也不把授权指纹伪称当前执行证明。实际执行边界另做上述异步核实。

Desktop 原 competition 出口为全部注册的 `coding.repair.*` 及 F15 原 aliases 增加
`coding-repair-metadata-v1` 投影。保留 session/snapshot/相对文件 SHA/真实验证状态与原 run 引用；
read 只返回路径/编码/字节数/SHA，省略正文，verify/check 省略自由诊断文本，preview/patch 省略正文。
publish 保持 `{version,sessionId,state,files:[{path,beforeSha256,afterSha256}],evidenceRefs}`。
原 ToolGateway cache/Evidence 不改写，原 consent/任务绑定/export policy 仍是前提，未知不能变成功。

此增量 Node 24.15.0 的 coding-tools TypeScript 编译通过，依赖/投影小例 13/13、npm 私有配置
小例 1/1 通过。真实本树 201 包只读指纹 probe 通过（38.466s，Main 事件循环计数 2409）；
没有对真实依赖执行复制/安装/构建或云调用。实际 Workspace consumer 小例因本隔离树缺
`@personal-agent/runtime/dist/application.js` 未加载，已适配全部旧授权测试调用方并保留断言，交整合树验证。
未以此宣称整个 Runtime/Desktop、真实 AgentArts 或原补丁任务现场恢复验收完成。

发布历史读回先匹配原 journal 中已保存的精确请求，再返回原 `published` 回执；后续源码或依赖
变化不触发新的准备检查、命令或写入。变造请求仍拒绝，未完成发布仍需原 reconciliation。
新发布继续执行依赖实时校验。新增回归以真实临时文件、原 Policy/ToolGateway 和固定 Node
配方复现旧顺序的 `RESULT_UNKNOWN`，修复后 1/1 通过，并确认用户后续编辑未被覆盖；
Runtime 选择/确认与依赖变更端口为显式 fixture，不代表真实云端或现场取消恢复验收。

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-18（zemeng5208）、MOD-34（Potatos498）、MOD-35（Potatos498）。产品流程：F15、F17、F16、F18；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

F15 注册工具 `coding.repair.preview`（包括 Desktop 的 `workflow.host.f15_n04` 别名）只返回会话、预览确认及路径/前后 SHA/变更标记；完整预览正文保留在本地宿主，须在 ToolGateway 记录和原回执签名前完成投影。源码出机继续走原 `coding.repair.read` 的精确原生许可，不能以元数据许可替代。宿主本地 `preview()` 返回及实际补丁/CAS 校验保留。

2026-10-13：已更新 [真实补丁/固定命令与恢复验收](ACCEPTANCE-20261013.md)，修复旧 P6 runner 缺少生产恢复绑定的问题，并验证真实 marker 的派发前退出与写后清理失败恢复。当前合并规则以根 AGENTS/CONTRIBUTING 的一位非作者有效批准为准，覆盖下方历史双人门槛。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。


`@personal-agent/coding-tools` 为 `huawei_ict_agentarts` Competition Profile 提供两个受限只读工具、一个须由可信宿主显式注册的固定命令工具，以及独立授权的补丁候选和原文件应用工具。它不接受自由 shell/argv，不自动把候选文件应用到原文件，不自动发布，也不提供 Artifact/Evidence 服务。

## 当前增量：独占句柄内应用文本补丁

`createWorkspacePatchApplyTool(options)` / `registerWorkspacePatchApply(host, options)`
显式提供 `workspace.apply_text_patch@1.0.0`。它复用现有只读 preview 的严格
相对路径、原 SHA-256、唯一精确编辑和有界 UTF-8 候选字节；额外要求
`workspace:apply`，不能把 stage 的 `workspace:write` 授权升级为源文件应用。
可信宿主提供工作区根、工作区外且已限权的恢复目录、受信 PowerShell 可执行文件；
helper 脚本和可执行文件也必须位于授权工作区外，模型和工具输入都不能改变
这些位置。当前仅支持 Windows，默认不注册到产品。

源码仓库本身作为 `rootPath` 时，默认包内 helper 位于可写工作区内，仍会安全拒绝。
受信宿主可预先在工作区与恢复目录之外的独立、已限权安装目录部署本版本
`scripts/locked-apply.ps1` 的字节一致副本，并显式提供绝对 `helperScriptPath`。
`createDevWorkflowsRuntime` 通过 `workspace.patch.helperScriptPath` 接入该配置；
公共 apply factory/register 也转交同一可选字段。未配置时保留既有默认路径与隔离要求，
不缩小全仓 root，也不移除 in-root 执行保护。

factory 核对外部脚本为单硬链接常规文件、canonical 路径不在 workspace/recovery 内，
并与包内已审查脚本的字节摘要一致；每次 apply 在预览前及启动 helper 前复核路径与摘要。
模型、补丁参数和 PR 内容不能选择该路径；本包不自动复制、安装或执行未知脚本。
该配置是兼容增加的进程内受信宿主选项，不改变工具输入/输出、scope、wire operation 或数据库。
宿主仍须核实安装目录/脚本的 Windows ACL；摘要预检并不消除可被其他进程并发修改目录的
TOCTOU 风险。新增外部路径与突变拒绝的 Windows 场景源码尚未运行，交 Potatos498 集中验证、
goo122 公开消费兼容评审。

固定的 `scripts/locked-apply.ps1` 不使用 `ExecutionPolicy Bypass`，通过 stdin
接收本次 preview 生成、SHA 绑定的候选字节，不信任可由其他进程修改的 stage
文件。它用 .NET `FileStream` 的 `FileShare.None` 在同一独占句柄内核对源 SHA、
最终路径和单硬链接身份；首写前在受信恢复目录排他创建备份并 `Flush(true)`、
读回备份，之后才原位写入、截断、`Flush(true)` 并在仍持锁时读回目标 SHA。
打开文件时已有其他句柄或原 SHA 不符时不写。成功结果只证明独占读回的那个
时刻，锁释放后的用户编辑仍可继续。写入开始后故障、超时或进程终止可能留下
部分文件与备份，必须以任务/运行标识查找备份并重新核对当前源文件及授权，
不自动重试或盲目回滚。恢复目录还按源文件保留 `.inflight` 标记及 helper 的进程身份（PID
和进程起始时间 token）：
候选字节发送前持久创建，只有进程 `close` 确认后才删除；2 秒停止等待超时
可以先向上层返回未知，但标记未消失前不得对账或再次 apply 同一源文件。
进程/宿主崩溃留下的标记只能由受信恢复流程确认同一进程身份已退出、核对备份和
当前源文件后处理。原位写入不是断电/崩溃时始终原子旧或新的替换。

此工具仍不构成任意路径的 OS 沙箱；Node 先拒绝链接、硬链接和越界路径，
helper 再对已打开句柄核对最终路径和链接数，无法证明时不写。恢复目录必须由
可信宿主预先创建并限制访问；本包不把备份当作 Artifact，也不允许其内容自动
送往云端。当前 factory 只确认恢复目录位于工作区外且存在，不能证明 Windows
ACL 已限权；正式组合在核验目录访问控制前不得注册 apply。合成临时目录测试
不构成该核验。现有 ToolGateway 对所有 `local_write` 异常保守映射
`RESULT_UNKNOWN`，包括可以证明首写前安全拒绝的冲突，需由公共 owner 后续
明确分阶段错误；本包不越界修改 Gateway。真实用户工作区验收须与命令工具
共用编程链的一次联合回执。

### 受信恢复对账

`reconcileWorkspacePatchApply(options)` 是宿主在 apply 返回未知或进程/宿主重启后使用的
显式对账入口。它只接受可信宿主提供的工作区根、工作区外恢复目录和原相对源路径；先读取
对应 `.inflight` 的严格记录（必须同时包含 PID 和进程起始时间 token），再由宿主注入的
`isProcessAlive(identity)` 确认同一 helper 身份的状态。检查器必须返回 `running`、`exited`
或 `unknown`；也可由可信宿主提供绝对 `processIdentityHelperPath`，让本包通过受信
`WindowsJobProcessHost.exe --query-process-start-time` 查询 PID 的起始时间并与 marker 比对；
没有 native helper 时保留绝对 `powerShellPath` 兼容路径。未提供检查器、native helper 或
PowerShell 路径、PID 已复用、起始时间不匹配、
查询不可用或结果不确定，都保留 marker 并返回 `RESULT_UNKNOWN`。helper 仍存活时返回
`in_progress`，不会删除标记、启动或终止进程。确认同一身份已退出后，它重新检查受保护源文件的真实身份并读回 SHA：当前值等于候选 SHA
返回 `outcome=applied`，等于原 SHA 返回 `not_applied`，其他值返回 `unknown`；三种结果都
不会伪装成成功。只有退出确认、源文件读回和 marker 身份均稳定后才删除标记，允许下一次
独立授权的 apply；进程身份未知、记录损坏、源路径变化或对账竞态会保留标记并返回
`RESULT_UNKNOWN`。该入口不会自动重试、回滚、删除备份或改变 ToolGateway 的错误映射。

首次等待前复制本次 options；等待时复用或修改调用对象不能改变原执行绑定、进程 checker 或 `retainMarker`。保留标记后仍须宿主持久化可信回执再显式清除，不增加自动恢复或重试许可。

## 既有增量：授权后的文本补丁候选文件

`createWorkspacePatchStageTool(options)` 提供显式注册的 `workspace.stage_text_patch@1.0.0`。可信宿主提供工作区根；现有 ToolGateway/Policy 按任务、工具、参数和 `workspace:read` + `workspace:write` 授权，本包不签发授权。输入沿用预览的规范路径、`expectedSha256` 和有界 `edits`。它拒绝链接、硬链接、目录逃逸、敏感文件和过期哈希，在可信根下排他创建 `.pa-stage-*.patch` 候选文件，读回摘要并复核原文件。返回的 `stagedPath` 是相对路径；原文件始终不打开写入、不重命名、不覆盖。`registerWorkspacePatchStage(host, options)` 沿用现有 ToolHost 生命周期，默认不在产品中注册。

候选文件创建属于 `local_write`，不支持自动幂等重试与恢复；失败时尝试删除本次候选，无法确认清理则报告 `RESULT_UNKNOWN`。候选文件不是已应用补丁或最终 Artifact。上述 apply 是独立的独占句柄原位应用路径，不把 stage 的哈希检查或 rename 冒充原子 CAS。

## 公开入口

- `createWorkspaceReadTool(options)`：创建 `RegisteredTool`；`options.rootPath` 必须由可信宿主注入，不能来自 AgentArts、模型输出或工具参数。
- `register(host, options)`：使用现有 `ToolHost.register()` 注册并返回 dispose，不创建第二套 registry。
- 工具 scope：`workspace:read`。授权仍由 Runtime/Policy/ToolGateway 签发、绑定和消费；本包不创建授权引用，也不扩大 scope。
- 输入：`{path, maxBytes?}`。`path` 只接受规范的相对子路径，`maxBytes` 只能收紧宿主上限。文件必须完整落在上限内；不截断、不提供无限输出。
- 输出：`{path, encoding:'utf-8', byteLength, content, sha256}`。`sha256` 是同一次读取的原始字节摘要，可作为该 `path` 后续 preview/apply 的 `expectedSha256`；不能让模型另行计算摘要或用一次新读取替换旧版本。只返回相对路径，不披露宿主工作区绝对路径。
- UTF-8 BOM 以正文首个 U+FEFF 保留，换行不归一化；摘要、`byteLength`、preview 重编码与 apply 原始字节校验一致。文件在读取后变化时，旧摘要必须触发冲突，不构成写入授权。
- `workspace.read_text@1.0.0` 的 provisional 输出 Schema 兼容增加可选 `sha256`：历史无摘要结果仍可校验，当前 provider 成功读取必带摘要。严格消费者需发现当前 descriptor，不能以缓存旧 Schema 校验新输出；缺摘要历史结果需显式重新读取后重新拟定补丁。
- 序列化边界：结果自身的 UTF-8 JSON 最多为 `MAX_SERIALIZED_WORKSPACE_READ_RESULT_BYTES`（当前为 960 KiB），为现有 `tool.invoke` / Response 包装预留 64 KiB；超限拒绝，不截断。

目录枚举使用独立入口与 scope：

- `createWorkspaceListTool(options)` 创建 `workspace.list_entries@1.0.0`；`registerWorkspaceList(host, options)` 注册并返回只释放该工具的 disposer。
- 工具 scope 为 `workspace:list`，不会把已有 `workspace:read` 授权扩大为枚举权限。
- 输入为 `{path, limit?}`；只有 `path:'.'` 表示受信根，其他路径必须是规范相对子目录。默认 limit 为 100；宿主 `maxEntries` 可降低请求上限，模块硬上限为 1000。
- 输出为 `{path, entries:[{name, kind:'file'|'directory'}], truncated}`。只返回直接子项名称与类别，不递归、不读取正文，也不返回绝对路径、权限、所有者、大小或时间；结果自身同样受 960 KiB 序列化门禁约束。

固定命令使用独立入口与 scope：

- `createWorkspaceCommandTool(options)` 创建 `workspace.run_allowed_command@1.0.0`；`registerWorkspaceCommand(host, options)` 显式注册并返回 disposer。`rootPath`、非空 `recipes` 及其中每个绝对可执行文件路径和完整 argv 均来自可信宿主；可执行文件不能位于可写工作区内。工具输入仅有 `{recipeId}`，严格枚举并拒绝额外字段。宿主配置在注册时复制，不受后续数组修改影响。
  执行开始时一次捕获宿主时钟，将任务 deadline 与最长执行时间合为本次期限；直接子进程结束、输出解码后再次检查取消与期限，延迟计时器不能使过期结果变为成功。时钟异常固定脱敏拒绝，取消保持优先；即使拒绝返回成功，命令也可能已产生副作用，仍不能自动重试。
- scope 为 `workspace:execute`，descriptor 是 `local_write`、不可幂等/不可自动恢复；已有 Policy/ToolGateway 必须对精确参数审批并消费授权。当前 `requiresPresence:false` 仅因 Runtime 未提供独立在场字段，绝不代替审批。
- 用 Node 内置 `spawn` 的 `shell:false`、固定 canonical 工作目录、默认空环境（或由受信宿主注入并经过模式/敏感词校验的受控 `env`）及隐藏窗口执行；不引入 execa 或另一套调度器。运行期限默认 30 秒、至多 120 秒；合并 stdout/stderr 原始字节预算默认 64 KiB、至多 256 KiB。超限、截止或取消会请求终止直接子进程；无法在 2 秒内确认退出时返回未知结果。输出必须完整有效 UTF-8，不截断成功结果。
- 注册时绑定 canonical 根目录及其设备/目录身份；每次启动前同步复核路径仍解析到该目录、目录身份未变化。根被换为链接、另一个普通目录、文件或已移除时，公开工具拒绝 `SCOPE_DENIED`，不启动命令，也不自动重绑新目录。正常修改工作区内容不会使授权根失效；注册时提供的链接只解析到当时的 canonical 目标。检查仍不能消除复核与 OS 启动之间的路径竞态，不构成 OS 沙箱。
- 输出 `{recipeId,exitCode,stdout,stderr}` 只证明该直接进程的退出码与收集到的文本；非零码是失败的验证命令，不代表产物已读回、Artifact 已保存或副作用可重试。`ToolGateway` 对 `local_write` 异常统一返回 `RESULT_UNKNOWN`，调用方必须对账。
- `rootPath` 只是 cwd，不是进程文件系统边界。固定可信命令仍以宿主 OS 账号权限访问文件。在 Windows 上，直接执行 Node/npm 并在超时/取消时调用 `child.kill('SIGKILL')` 仅能终止直接进程，npm 脚本派生的子进程树会成为孤儿进程；为此在 `packages/coding-tools/native/` 下提供了 `WindowsJobProcessHost` 原生助手（基于 .NET 8 与 Win32 Job Object）：
  - 通过 `CreateJobObjectW` 与 `SetInformationJobObject` 设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)`，严禁 breakaway；
  - 使用 `CreateProcessW` 配合 `CREATE_SUSPENDED` 创建挂起目标进程与标准管道重定向；
  - 严格保持在 `ResumeThread` 前通过 `AssignProcessToJobObject` 纳管进程（分配失败立即 TerminateProcess 挂起进程），决不允许未纳管的进程开始运行；
  - 在宿主进程被杀、超时、取消或句柄关闭时，由 Windows 内核原子终止整棵子进程树，防止后台孤儿编译/脚本进程残留；
  - 根命令正常退出后先关闭本次 Job，再等待 stdout/stderr 排空；继承输出句柄的遗留子进程会随 Job 结束，保留根命令的实际退出码和已收集输出，不能作为后台服务启动器。
  - 仅用于受信 Desktop 宿主构造的受控命令（如 npm-build / npm-test），严禁向模型暴露任意 shell/argv。
  - 受信宿主可在 recipe 或 options 中注入受控只读环境变量（key 必须满足正则、严禁包含 TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL/AUTH 等敏感词、value 限制长度且不含 NUL）；未指定时默认空环境，绝不继承外部 `process.env` 私人凭据。
  - 提供了专属开发构建脚本 `packages/coding-tools/native/build-helper.mjs`，调用者必须显式传入工作区外的目标目录（例如 app `userData/native-helper`）并通过 `dotnet publish` 输出二进制；脚本严禁将发布目标设在仓库或工作区内部，要求系统预装 .NET 8 SDK，不执行 `ExecutionPolicy Bypass`，不自动下载外部 SDK。

## 安全边界

工具拒绝绝对路径、`..`、Windows 盘符与 drive-relative 路径、UNC/设备路径、ADS、保留设备名和含尾随点/空格的歧义段。可信根使用 OS-native 同步 realpath，候选文件使用异步 realpath，避免 Windows CI 临时目录的 legacy/native 别名差异造成错误拒绝；随后通过 `path.relative` 的目录边界判断，不会用字符串前缀判断 containment。打开文件前后会再次核对 realpath 和文件标识，读取期间按块检查取消与 deadline，并在文件元数据变化时拒绝返回。

默认敏感文件策略同时检查请求路径与 realpath 目标，拒绝常见 `.env*`、凭据文件、私钥扩展、`.git`/`.ssh`/`.aws`/`.azure`/`.kube`/`.gnupg`/`.codex` 目录，并对文本内容中的私钥头再做一次拒绝。只接受完整、有效 UTF-8 且不含二进制控制字符的常规文件；默认原始文件上限为 256 KiB，宿主可调整，最高不能超过协议 1 MiB 边界。

原始字节数不等于 JSON 帧大小：Tab、换行、回车、引号和反斜杠会在 JSON 中转义。默认 256 KiB 即使全部由当前允许的最坏单字节转义字符组成，结果自身仍落在 960 KiB 预算内；NUL 等会产生更大 `\u00xx` 膨胀的控制字符会先被二进制策略拒绝。宿主提高原始文件上限时，工具会按实际序列化大小再次 fail-closed。该预算只约束 `WorkspaceReadResult`，不是对任意未来包装的保证：公共 Schema 没有限制所有 ID 与 `evidenceRefs` 的总长度，上层仍必须调用 `encodeFrame` 执行最终 1 MiB 帧校验。

这是一层应用内约束，不是 OS 沙箱。跨平台 Node API 没有提供对整条路径逐目录、不可替换的句柄遍历；实现用 canonical path、打开句柄身份和读取后元数据复核缩小符号链接/junction 与 TOCTOU 风险，但不能在攻击者可并发改写目录项的工作区内宣称消除了所有竞态。只读检查与候选创建不能当作原文件写入沙箱；固定命令 provider 也不提升为任意代码隔离能力。

返回的源码只交给已经通过本地授权的调用路径。本包不会上传 AgentArts、写日志或持久化内容；调用方若要把内容发往云端，仍须单独执行最小化、脱敏和出机授权。

目录枚举在打开前确认请求目录位于 canonical root 内，拒绝把 symlink/junction 当作目标；遍历结束后再次核对路径和目录身份。枚举项只接受 `Dirent` 直接报告的普通文件/目录，symlink、junction、其他特殊项、不可由本包规范寻址的名称和默认敏感路径都会被省略，不跟随目标。敏感项不计入 `truncated`。

`workspace.list_entries` 使用 `opendir` 迭代，不先把整个目录读入数组；扫描期间仅保留至多 `limit` 个按 JavaScript 字符串码元升序排列的候选，因此输出与内存有界。为了得到全局稳定的前 N 项，仍会扫描到目录末尾，扫描过程逐项检查 deadline/cancel。真实文件系统枚举不是事务快照：读后 lstat/realpath/身份复核能拒绝可检测的目录路径替换，但 Node `fs.Dir` 没有公开可供本实现 fstat 的目录句柄，不能消除恶意并发替换竞态，也不能阻止扫描期间普通子项增删或改名；结果只能表示本次受限观察，不能当作完美快照。

## 当前状态与接线限制

本包消费 `@personal-agent/contracts@0.1.0-alpha.1` 的 provisional `RegisteredTool`、`ToolContext` 与 `ToolHost`，并按现有 Gateway/Policy scope 机制工作。它没有私设仍为 unavailable 的 `ToolExecutionPort`、ArtifactPort 或 EvidencePort。

已合并的只读工具验收不证明候选或 apply 工具已进入 Runtime 或真实 AgentArts。`workspace.list_entries`、固定命令、候选文件和 apply 工具均不会自动进入生产 composition。根 `package.json` build 编排与 `package-lock.json` workspace 记录随 PR #83 从 `main@1e3b56b6` 重建；旧 Draft #63 已关闭。

真实目标系统读回、Evidence 与最终回答仍须在 Runtime/Desktop 联合链路验收；本地工具测试不构成 Competition Golden Path 的完成证据。

已授权的 Local Profile 开发自动化另提供 `runCiFix` / `createCiFixWorkflow`，详见
[MOD-34](../../docs/modules/MOD-34-CI-FIX-01.md)。每次调用在首个异步派发前捕获执行配置，
复制源路径数组及 Issue、Git 工具名、源运行关联的子对象；调用方随后更新复用配置不会
改变本次仓库、分支、验证 recipe 或预算。新任务可使用新配置，旧 checkpoint 仍按原
identity 拒绝输入变更。factory 在创建时固定模型和工具对象，旧任务的 pending/unknown
恢复仍经原端口消费原 run；新 factory 可使用新端口，直接 `runCiFix` 则每次调用选取
端口。原对象的方法和注册能力，以及 Runtime 授权、确认回执就绪与时钟钩子保持实时；
配置快照不签发权限、不重试未知写入，也不证明真实修复闭环已验收。

## 定向验证

测试只创建系统临时目录中的合成文件，不读取真实用户项目内容：

```powershell
npm.cmd run build --workspace=@personal-agent/contracts
npm.cmd run build --workspace=@personal-agent/coding-tools
npm.cmd run typecheck --workspace=@personal-agent/coding-tools
npm.cmd test --workspace=@personal-agent/coding-tools
node --test --test-isolation=none packages/coding-tools/test/workspace-read-wire-boundary.test.mjs
node --test --test-isolation=none packages/coding-tools/test/workspace-list.test.mjs
git diff --check
```

读取覆盖：允许的 UTF-8 文本；精确 Schema；绝对/父级/盘符/UNC/设备/ADS；兄弟前缀和 symlink/junction 逃逸；敏感文件；大文件与二进制；缺 scope；deadline/cancel；现有 Host 的 register/dispose；控制字符转义膨胀拒绝与正常 UTF-8 序列化边界。

枚举覆盖：根目录 `.`、稳定排序、limit/truncated、不递归、逃逸/敏感项/symlink-junction、独立 scope、扫描中 deadline、取消、严格 Schema、register/dispose。测试只使用系统临时目录中的合成文件；不读取真实用户工作区。
## 2026-10-12 Windows 取消测试就绪同步

取消进程树测试在孙进程 PID 已写出且确实存活后才发送取消。就绪等待与命令宿主
既有 30 秒租约一致，以实际 deadline 计时；不会改变生产命令期限、取消结果或退出断言。
回归额外模拟 11 秒启动延迟：旧 10 秒测试期限先触发 TIMEOUT，修复后仍须得到
CANCELLED，并确认孙进程退出。专项 `workspace-command.test.mjs` 24/24 通过、0 skip。
日志保留在修复工作树 `.cache/readiness-tests.log` 和 `.cache/readiness-old-lease-repro.log`。
此为 #321 Foundation 的本地修复证据，尚不等于新提交的远程 CI 已通过。

## Process identity query budgets

Normal apply does not perform a second process identity query. The trusted PowerShell helper emits a READY frame on its own stdout containing its PID and canonical process-start ticks; the parent validates that frame from the same child under the caller's ToolContext deadline and AbortSignal before sending any patch bytes. Cross-restart reconciliation uses the trusted native WindowsJobProcessHost.exe query with a bounded startup budget of up to 10,000 ms for cold native startup, while the caller's remaining deadline and AbortSignal always cap it earlier. The PowerShell path is the helper executable only. Cancellation, deadline expiry, query failure, output-limit failure, or an identity mismatch remains unconfirmed (unknown); no patch bytes may be sent or an in-flight marker cleared from those results.
