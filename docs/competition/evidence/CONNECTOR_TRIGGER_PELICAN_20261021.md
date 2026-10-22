# 默认 Desktop 鹈鹕验收与连接器触发工作包（2026-10-21）

目标 profile：`huawei_ict_agentarts`。工作树 `D:\worktree\f809\PersonalAgent`，分支 `codex/autonomous-change-loop`。本页只登记默认 Desktop 公开鹈鹕 fixture 的验收入口与实际回执；连接器变化触发 Laya 的实现和测试由同工作包其他负责人登记。

## 默认生产入口与验收门槛

当前 Desktop 生产组合已接入 `workspace.read_text`、`workspace.preview_text_patch`、Windows 原生 `workspace.apply_text_patch` 与受限 `workspace.npm_test`。主面板通过安全 IPC/Client 提交原任务，Runtime 原委派机制创建子任务；工具执行继续经过原 Policy、ToolGateway 和工作区出机许可。

新增手工 runner：[desktop-pelican-default-live.cjs](../../../tests/manual/agentarts/desktop-pelican-default-live.cjs)。它直接启动 `apps/desktop`，不使用 `--fake-runtime`、`--fake-model`、`PA_DESKTOP_SYNTHETIC_MVP`、FakeCoordination 或替代 CAS 工具，也不调用旧 `pelican-repair-live.mjs` 的专用 F15 装配。无参数模式要求个别 workspace 工具；`--workflow` 模式允许模型从真实主面板调用当前公布的生产 `coding.repair.workflow`，仍须实际完成原 F15 与本地工具，不能以旧手工 runner 代替默认 UI 接线。

成功必须同时满足：

1. 当前公开 fixture 的原缺陷由固定 Node 测试实际复现；只允许修改 `pelican.svg` 现有动画的 `begin` 属性。
2. 真正设置页面选择新 fixture 工作区与受信 Node/npm，重启生产工具装配后，在原对话统一授权卡逐操作确认读取、写入、命令和出机范围；设置选择仅保存配置。
3. 主面板实际输入并发送自然语言任务；默认原父子任务成功。个别工具模式要求子任务实际执行 read → preview → native apply → 固定项目测试；workflow 模式要求原 F15 六节点 completed/settled，原 `coding.repair.read`、N04 预览、N05 实际检查、N06 原生 CAS 发布均有绑定原父子的 host 任务与确认记录。
4. 原工具记录必须为 `confirmed`、`policyDecision:allow`、`executionStarted:true`；原子任务 Evidence 被父任务保留，固定项目测试原始返回 `exitCode:0`。workflow 模式逐一重读原 host command、参数散列绑定、原检查回执中 `npm-test:VALID/0`、原 CAS before/after SHA256；所有结果与图检查点一致，未核实操作不能放行。
5. 关闭本 runner 启动的隔离 Desktop 后，重开同一个 SQLite 核验原父子任务、工具记录、Evidence 和原 AgentArts 请求身份。不能用模型自报成功或 UI 文案替代这些条件。
6. 用户 fixture 工作区必须仍只有原来的 `pelican.svg`、`pelican.test.cjs`、`package.json` 三个普通文件，不允许新增文件、目录或链接；原测试文件和 `package.json` 字节不变。独立 Node 复验通过，真实 Chromium 渲染观察两帧，两个车轮和脚踏均移动。

文件集合门槛仅检查本 runner 新建的 `workspace/` 源码目录。生产 F15 的独立会话、基线、内部工作副本、恢复与 journal 位于同一任务 `user-data/coding-isolation/`，与用户 fixture 工作区分开；这些明确的内部产物不计作用户源码新增文件。runner 不删除它们，不把任何未知目录泛化为内部例外。

runner 为本次新建公开 fixture 自动处理系统文件选择器和原对话统一授权卡，只选择“仅允许本次”。它先只读核对原父子归属、pending invocation、参数散列与期限，再经真实可见卡片及生产 handler 提交；公开源码仍由原宿主按实际字节、SHA256 和 consumed export lease 核实。它不证明物理人工点击审批，也不授予私人资料或真实账号业务写入。记录中的 `fakeModel:false`、`fakeTools:false` 与“公开测试 fixture”是不同维度。

## 复现准备

先按当前 workspace 构建依赖。使用实际兼容的 Electron、Node 和 npm CLI；将当前源码构建的 `WindowsJobProcessHost.exe` 及其同名 DLL、deps/runtimeconfig 文件放在受信宿主目录。可用仓库原 `packages/coding-tools/native/build-helper.mjs --target-dir <repository 外任务目录>`，要求本机已安装 .NET SDK，不自动安装。

通过当前进程环境提供以下宿主路径，不在聊天或 Evidence 中提供解密凭据：

```powershell
$env:PA_MANUAL_DEFAULT_PELICAN_LIVE='1'
$env:PA_PELICAN_ELECTRON='<absolute path to current electron.exe>'
$env:PA_PELICAN_NODE='<absolute path to trusted node.exe>'
$env:PA_PELICAN_NPM_CLI='<absolute path to trusted npm-cli.js>'
$env:PA_PELICAN_JOB_HOST='<absolute path to current WindowsJobProcessHost.exe>'
$env:PA_PELICAN_SAVED_CONFIG_DIR='<explicitly authorized local encrypted AgentArts config directory>'
& $env:PA_PELICAN_NODE tests/manual/agentarts/desktop-pelican-default-live.cjs
# 真实默认主面板使用已公布生产 F15 聚合工具的独立模式：
& $env:PA_PELICAN_NODE tests/manual/agentarts/desktop-pelican-default-live.cjs --workflow
```

只复制批准配置目录中的 `agentarts-config.json` 与 `Local State` 到新建隔离 userData。只向云端发送本次公开任务与公开 fixture；不复制邮件、用户历史或其他业务数据库。每次运行保留唯一 `.cache/desktop-pelican-default-*` 目录及原始 `receipt.json`、原 SQLite、产物和截图；这些文件不提交 Git。

runner 等待的是原 UI 提交请求持久化的 `application-deadline`，不修改产品任务期限，不通过反复新建任务重做未知写入。`waiting_reconciliation` 会停止并保留原任务供核实。

## 本轮实际记录

状态：`in_progress`。入口语法与差异检查已通过；首次真实任务已发现下述生产目录缺口，当前未通过默认 Desktop 公开文件修复验收。

已确认历史宿主目录中的旧 `WindowsJobProcessHost` 不支持当前源码所需的 `--query-process-start-time` 入口，原返回 exit 1。已用当前仓库源码和本机 .NET 8 SDK，通过原发布脚本生成任务独立 helper；当前 SHA256 为 `4745764914811aaec58c09a42a29e85264b4348f692ee013615a8ace0b162ed2`，原生进程身份只读探针通过。这个构建回执不替代默认 UI 工具链验收。

前两次 runner 调试分别发现 Playwright Electron 主进程评估不支持裸 dynamic import，以及 `admin.open` 的直达页面白名单不含 environment；runner 已改用内置模块读取和真实设置侧栏导航。两次未提交云模型任务，失败原始回执保留，不能写成产品任务通过或云端故障。

第三次使用真实主面板提交，原任务 `844428c7-ba30-4497-8940-fdfbd57c954d` 和默认子任务 `d3fce6de-0172-49c2-a7de-75ea21ba3a3b` 的 Runtime 终态均为 `succeeded`，但子模型回答因目录未公布 `workspace.npm_test` 而无法执行。原记录只有一次 `subagent.dispatch`；鹈鹕文件未修改。因此任务终态不构成本 fixture 的修复通过。

该次原父目录只有 `subagent.dispatch`，子目录 16 项，包括本轮新增的三项 `connector.watch.*`，没有达到 64 项上限。`conversation-tool-surface.js` 当时仅依据注册集合中存在 `workspace.run_allowed_command` 就把 `workspace.npm_test` 等固定命令标为 internal，而统一命令没有达到实际公布条件，导致该次目录没有可用命令。生产默认 `coding.repair.workflow` 另有公布；该次测试采用个别原生工具模式，其失败不代替聚合入口的独立验证。

该次 runner 在后续截图阶段也发生透明/隐藏窗口的 Playwright screenshot 超时，属于验收采集问题；已改用原 webContents renderer capture，并把原 SQLite 工具证据检查放在动画播放检查之前。原始失败收据未改写。当前这些回执只用于定位缺口，不据此声称云调用、UI或编码能力通过。

目录折叠修复后，下一次真实主任务 `6d1a6d61-8701-4c47-8d5c-97a659bb6799` 的子目录增至 19 项，`workspace.npm_test` 已公布。`workspace.read_text` 实际执行为 Policy allow/confirmed；原生公开读取与精确字节出机确认通过。但原子任务 `9219e618-3e62-4251-8883-07708c73c04f` 续回合仅总结文件内容，没有继续预览、应用或测试，产物仍是原缺陷。

本次启动没有 `PA_AGENTARTS_CONTINUATION_CONTEXT=goal`，生产组合因而沿用旧续接协议，仅携带当前工具回执。现有 [上下文完整性记录](../../CONTEXT_INTEGRITY_20261020.md) 已说明新协议曾按单个启动进程启用，而其他入口仍保留旧协议；本轮将这个默认启动差异交生产组合负责人修复/校验。当前不能把单次读取通过算作修复闭环。

该次 runner 也暴露 Evidence 读取投影的验收器错误：公开 Evidence DTO 不含 taskId，runner 应将原 `readEvidence(taskId)` 的检索身份绑定到本地比较，已修正；没有修改数据库、Evidence DTO 或原任务记录。即使修正此比较，该次仍缺少实际 preview/apply/test，不能转为通过。

随后仅在新独立目录显式设置 `PA_AGENTARTS_CONTINUATION_CONTEXT=goal` 做配置兼容探针，原主任务为 `e6926c3e-3c15-4b1c-b877-d05eff7b672d`。当前配置公开 snapshot 请求 pin 为 `arm64-v5-d92a17a4-r3`、WSS，尚无平台独立版本读回；不能把请求 pin 当作镜像实际摘要自省。云调用没有拒绝该请求，但仍只读取文件、解释最小改法，没有实际补丁或项目检查，因此个别工具闭环仍未通过。此探针另遇设置 renderer 无响应；只关闭带唯一测试 marker 的本次隔离实例，原父子任务和失败报告保留，没有修改用户现有应用或云部署。

新增 `--workflow` 模式后，首轮由于任务文字直接要求模型不可见的“AgentArts F15/原 CAS”内部名称，模型未执行，仅表示愿意使用实际公布的 `coding.repair.workflow`。保留原任务 `c1459419-5bfe-4844-aed5-30833b0dc160`，没有把该次模型拒绝当作 F15 执行失败；runner 现只向模型提出可见工具名和用户文件修复目标，内部验证由验收器负责。

下一轮原主任务 `277c4ca6-b2c0-4de4-b96b-0262adf2e5d9`，原子任务 `4b071ca7-c678-44cd-9e0c-338a8331acca`，实际进入 F15。原 `coding.repair.start` 经 UI 审批后为 Policy allow/confirmed；F15_N01 的 `decision.choose_candidate` 原 host 任务 `cb360fe9-cd65-48fc-8b14-93cad41c972f` 为 Policy allow/failed，图 sequence 2、state failed，其余节点 pending，没有原文件写入。隔离 Desktop 的本地 Laya 尚未启动；默认 coding decision 直接调用该 chooser，没有把缺少模型伪装成成功或随意挑选候选。

随后 runner 新增真实设置 → 连接 → 启动本地 Laya 的步骤，只使用现有模型与 Python，不下载权重。本轮该新独立目录在提交云任务前被生产内存门禁拒绝，state 为 `memory_insufficient`；同期系统总内存 `16,780,455,936` bytes、可用 `1,795,944,448` bytes，低于原宿主 2 GiB 门槛。没有降低门槛、启动替身模型或关闭用户应用。主控随后只读核查本工作树/runner标记/测试toolchain，未找到可释放的本轮遗留检查进程。用户明确选择“先保留代码和证据，真实验收稍后继续”，本轮不再加载模型或发起新的真实云任务。当前真实聚合闭环仍未通过。

runner 的快照读取和 renderer capture 已加工具级超时，避免无响应页面使验收器无限等待；不更改原任务期限。真实失败、原 SQLite、截图和未修复 fixture 均保留；不能将入口实现、Laya 文件存在、任务受理或父任务最终回答写成修复完成。

恢复入口：设备可用内存达到原门槛后，复用上面的受信宿主路径，执行 `desktop-pelican-default-live.cjs --workflow`。它会新建公开 fixture，先从真实设置启动并读回 Laya ready，再提交默认主面板任务；不会重开、重发或清除上述原失败任务。当前没有环境变化时不重复失败加载，不降低内存门禁。

### 用户恢复真实验收后的当前记录

用户随后明确恢复真实验收。新独立运行 `desktop-pelican-default-tvvay4` 使用原 `--workflow`、默认 Desktop 配置与同一公开 fixture，没有 `PA_AGENTARTS_CONTINUATION_CONTEXT` 环境覆盖，没有修改原加密配置或云 pin。当前 helper SHA256 仍与前述构建相同。运行前系统可用内存为 `3,304,177,664` bytes，高于原 2 GiB 门槛；真实设置页面重新选择工作区、Node/npm、固定测试文件，重开生产装配并确认本次四项许可。

本次真实设置 → 连接 → 启动 Laya 成功读回 `ready:true`，耗时 `64,848` ms，`calibrated:false` 按原状态保留。加载前可用内存 `3,141,218,304` bytes，读回 ready 后为 `1,370,169,344` bytes。这证明本次实际本地模型启动成功，不代表后续判断、F15 或文件修复通过。

默认主面板原任务为 `6794c33b-7936-4beb-9bd9-2ad639e69db5`，子任务为 `54edc24e-cddf-4d6d-94d8-fa820958a0b1`。父任务最终 `succeeded`，子任务在进入 F15 前 `failed`，原错误为 `REVISION_CONFLICT: Coding work cannot replace the current worker thinking binding`。原子任务 `subtask-thinking-binding.depth` 为 `1`；云模型对 `coding.repair.workflow` 提案的 `subtasks[0].thinkingDepth` 为 `3`，而该次实际目录仍公布 `integer`、`minimum:0`、`maximum:5` 的通用 Schema。原生产 guard 拒绝替换当前工作智能体的绑定；该次目录没有表达这个固定约束。已交生产负责人修复目录与同任务绑定的一致性，没有移除原拒绝检查。

原 SQLite 只有 `subagent.dispatch` 的 `Policy allow/confirmed` 执行记录，没有 F15 图或原生补丁记录。runner 在重开原 Runtime Evidence 阶段依据 `every original child must succeed` 正确拒绝通过。源码目录仍仅有原来的三个普通文件；`pelican.svg` SHA256 与基线同为 `f89f9342473941d2a26c2759670f490068234cd1df456285e17b8a33ae06f268`，尚未修复。原收据、SQLite、公开 fixture 与截图保留在该唯一运行目录，未改写旧失败记录。

本次隔离 Desktop 关闭后，可用内存恢复为 `3,235,377,152` bytes；已将共享本机 Laya 资源交回主控进行连接器触发验收。本轮不得依据父任务成功或 Laya ready 宣称默认鹈鹕闭环通过；后续仅在生产修复带来新证据后重新验收新的独立公开 fixture。

生产修复后，独立运行 `desktop-pelican-default-9dlRFd` 的原主任务为 `ce953ba2-026d-418d-bcd4-4c46e0a3f9a0`，子任务为 `6b1ac2f8-4cb0-423c-9585-64edc8e5677d`。从原 SQLite 实际目录确认，该次 `coding.repair.workflow.subtasks.items` 仅包含 `subtaskId`、`role`、`roleLabel`、`goal`，且 `additionalProperties:false`；模型、原生推理档位与 thinkingDepth 三个固定配置字段确已移除。根注册 Schema 和原拒绝检查仍保留。此轮没有再次出现前次绑定替换错误，已进入原 F15 隔离初始化审批。

该次真实 Laya 再次 `ready:true`，耗时 `34,751` ms；生产启动前可用内存 `2,281,730,048` bytes，ready 后 `818,155,520` bytes。runner 随后在真实设置授权页面的 `coding.repair.start`“允许一次”按钮发生 Playwright `locator.click` 的 30 秒 actionability 超时；原错误记录显示已多次解析到具有正确审批 ID、task ID 和 revision 1 的按钮，失败截图显示按钮完整可见。当前只能确定验收自动化没有完成审批；不能将推测的页面刷新稳定性原因写成已确认产品故障。

原父子任务仍为 `waiting_approval`，F15 graph sequence 为 `0`，只有父任务 `subagent.dispatch` confirmed/allow，无 F15 host 或 CAS 写入。`pelican.svg` SHA256 仍与原基线一致，源目录仍只有原三个文件。旧 runner 将错误消息截为 400 字符；该次原收据按原样保留，未恢复或编造未采集到的日志尾部。

runner 现把审批动作改为先检查实际按钮可见、启用，再原子核对审批 ID、task ID、revision 和 `allow_once`，单次调用原 DOM 按钮的 click，继续走原生产 UI handler、Preload/IPC、Runtime 审批与 Policy。没有直接调用授权接口、强制放行审批或跳过 revision；这仍明确标记为非物理人工点击。今后失败消息仅移除终端控制字符与本机绝对路径，不再截断诊断日志。修正通过语法与差异检查；等待主控完成用户授权的真实邮箱配置及共享模型槽安排后，才启动下一轮新 fixture，不重开旧 pending 任务。

### 最新完整实际运行：原保守 review 使 F15 停止

主控完成邮件与天气本轮实际验收并释放模型槽后，使用最新 Runtime、原 `--workflow` 与修正后的 runner 新建 `desktop-pelican-default-LUCLdz`，没有续接环境覆盖、云部署或原账号业务写入。预检可用内存 `3,211,309,056` bytes；真实设置启动 Laya 时为 `2,491,363,328` bytes，仍满足原 2 GiB 门槛。Laya 于 `54,822` ms 后读回 `ready:true`、`calibrated:false`，可用内存 `1,069,789,184` bytes。

默认主面板原任务 `4074d8ad-d796-425d-8203-3bd14e48e64c`，原子任务 `dacfd393-4494-48b8-a5bc-7f3c7a156ee6`。本次原 `coding.repair.start` 的 UI 审批成功，经原 Runtime/Policy 为 allow/confirmed/executionStarted；随后进入原 F15 N01，原 host 任务为 `ce4472d3-f491-416a-95b1-002d7fc875ca`。原 `decision.choose_candidate` 也经其原 UI 审批并达到 allow/confirmed/executionStarted，host 任务为 succeeded。两次审批均按原 revision 1 精确绑定，没有再次发生前轮点击 actionability 超时。

N01 的实际确认结果以及图中 `resolvedValues.F15_N01` 均为 `{"selectedId":"owned-review"}`。F15 按原保守规则进入 sequence `2`、state `unknown`；N01 为 unknown，N02～N06 仍 pending，原子任务为 `waiting_reconciliation`，原父任务保留 `waiting_approval`。单凭这个结果不能确定是模型主动选择保守 review，还是模型结果未满足协议后采用安全 fallback；当前没有独立诊断证据，不作归因，也没有强选业务候选或把 review 当成成功。

原任务期限为 `2026-10-21T15:16:25.517Z`；runner 按原期限等待后正确以 `production task terminal readback did not reach the required state before its deadline` 拒绝通过。没有重开旧任务、重复发送原操作或更改 unknown。原 SQLite、审批/ToolGateway/Evidence、图状态、截图与未修复 fixture 全部保留在该唯一目录。该次没有补丁、项目检查或 native CAS 发布；源码目录仍仅原三个文件，`pelican.svg` SHA256 仍为原基线 `f89f9342473941d2a26c2759670f490068234cd1df456285e17b8a33ae06f268`，因此独立最终测试、重开成功终态与动画播放验收均未达到执行前提，不标记通过。

本次隔离 Desktop 和 runner 已关闭，读回应用也已释放 SQLite，收据结束时间为 `2026-10-21T15:17:05.071Z`。随后可用内存恢复 `3,302,973,440` bytes，唯一任务标记的只读进程检查没有本次 Electron；已交独立协作者只读复核原收据及数据库。当前完整真实默认 Desktop 鹈鹕闭环仍未通过，原保守判断和全部后续验收门槛保持不变。

## 2026-10-22 统一授权卡与本地 typed 诊断增量

本增量在 `D:\worktree\f809\PersonalAgent\.worktrees\pelican-real-completion`、
`codex/pelican-real-completion`，基线 `cb120aca060b6448852b2d1b9b5087c3b2b9d53e` 实现。
保留主线 metadata projection、原操作 export lease、目标与执行模型绑定；没有修改 Desktop main、
Laya 阈值、Policy、任务预算、旧 unknown 任务或原失败回执。

默认 Runtime coding chooser 将原 `LayaActionSelection` 的固定字段保存在原 host task 的
`coding-repair:local-decision:v1:<runId>`。记录包含 typed state/reason/selected/eligibility、
原概率/confidence、calibrated=false 和原 receipt 摘要，绑定 task/run/request、精确参数、context、
candidate-set 及逐候选摘要；区分直接选择与保守 review fallback。上下文正文、源码和自由模型文字不进入此记录。
诊断没有执行授权；原公开工具结果仍为原 `selectedId`，typed 诊断不进入云投影。

统一主线的 F15 metadata 回调此前也会处理 `decision.choose_candidate`，但工作区宿主只识别自身实现，
没有为 Runtime 内部 decision 准备对应 export requirement。本增量只为原 F15 graph、
`coding-repair:parent` 与 owner `coding-repair:host` 相互绑定的同一 host operation 准备该 requirement；
它限于原候选 selectedId 枚举，消费原统一卡后保存精确 export lease。参数、归属、候选或字段替换均拒绝。
完成后的 host 回执经原 confirmed receipt reader 核对，不重执行 decision。

runner 已移除设置页旧会话许可及旧审批按钮调用，改为原对话统一卡的“仅允许本次”。
审批前只读核对原 descendant、pending invocation、参数散列及期限，并复查实时卡片身份与可见启用状态，
经生产 UI handler 单次提交。需要原生进程边界时，其 unavailable/unenforced 状态不能被自动批准。
最终读回增加 typed 诊断与原确认结果、原 selectedId export lease、编译后 helper 和源码 SHA 的核对。

本工作包的实际本地检查如下，所有通过测试均为 **0 skip**：

| 检查 | 结果 | 本地原日志 |
|---|---|---|
| Node 24.15.0 / npm 11.12.0，`npm ci --ignore-scripts --no-audit --no-fund` | 201 packages，exit 0；未运行 Electron postinstall | `.cache/pelican-npm-ci-network.log` |
| Runtime/Desktop 必要依赖闭包，31 workspace 的原 build 脚本 | 全部完成；没有构建 obsidian-plugin | `.cache/pelican-build.log`、`pelican-build-resume.log`、`pelican-build-final.log` |
| `npm run typecheck --workspace=@personal-agent/runtime` | exit 0 | `.cache/pelican-runtime-typecheck.log` |
| Runtime decision、workspace-config-host 与 runner SQLite 绑定三个定向测试文件 | 75/75，exit 0；其中 decision 15 项、另两文件60项 | `.cache/pelican-focused-final.log` |
| `npm run check:architecture` | 3/3，exit 0 | `.cache/pelican-architecture.log` |
| 变更文件语法与 `git diff --check` | exit 0 | 命令回执 |

首轮 sandbox npm 下载为 ENOTFOUND，语音宿主 EXE 构建和 native path/TEMP 测试分别被拒绝；
均保留原失败日志，经平台 `require_escalated` 原机制继续，未调整代理、断言或保护。
独立 npm 包的原包装器不能在其 `bin/` 下解析自身入口，本任务仅在忽略的 `.cache/pinned-bin/` 放置固定
Node/npm 路径包装器，使嵌套脚本沿同一版本；未改仓库锁文件或系统工具链。

15 项 decision 测试的 chooser/image 明确为 Fake。新增工作区集成用例使用真实 Runtime/SQLite/Policy/
ToolGateway/统一问题宿主与 consumed export lease，推理仍是显式 Fake；它证明相同操作的结果绑定与拒绝路径，
不证明真实 Laya 判断质量、AgentArts 或文件修复。**本增量尚未启动 Desktop/Laya，也未进行新真实鹈鹕运行。**
完整默认父子、F15 六节点、N05 npm-test VALID/0、N06 native CAS SHA、三个原文件及两帧运动仍为 `not_run`，
须由主控整合源码并重新 build、在模型槽与可用内存达到原 2 GiB 门槛后，用上方 `--workflow` 新建唯一公开 fixture 验收。
沿用当前源码构建的四个 WindowsJobProcessHost 产物与受信 Node/npm；不重放 `LUCLdz` 或其他旧未决任务。

## 2026-10-22 设置导航回归与验收同步

主控整合上一增量后，新独立运行 `desktop-pelican-default-wn3zWB` 在
`start-original-local-laya` 阶段失败：原启动按钮已存在，但 Playwright 等待可见性 30 秒后超时。
该轮尚未启动 Laya、尚未提交默认主任务，原三个文件和失败回执保留；不能算作模型或 F15 验收。
旧回执未采集当时的 DOM section、host navigation revision 和隐藏祖先，因此该轮具体触发原因仍为 unknown。
另在空配置的隔离导航回归中观察到 `webContents.capturePage` 可在切页后立即返回上一页的合成帧；
旧截图不能单独证明当时的 DOM 页面或侧栏 `aria-current`。

本增量基于 `7e95cbccc10927d3440e67bafdeee68a8706c48f`，仅调整 admin view、对应导航测试和 runner。
可复现的独立缺陷是 view 用 `revision !== previous` 消费倒序快照：修复前，新回归用例在
revision 5 后接收 revision 4 会真实退回常规页，定向结果 10/11；修复后只消费有效且递增的 host revision。
正文、挂载控件和监听器完成后才一起提交侧栏、main/content 页标记与 `aria-busy=false`；
中途渲染失败不会声明新页已完成。相同 host revision 的日常更新仍保留本地侧栏选择，新的合法 IPC 导航仍生效。

runner 的 `openSettings` 先等待原 IPC 返回后读取到的 host revision 已渲染，再确认正文页标记、
侧栏和目标真实控件可见。成功与失败都记录固定字段的导航/可见性诊断，不记录配置值、正文或凭据。
保留主控对启动子进程剔除全部继承 `PA_*` 的修改，不强制点击隐藏按钮、不缩短原等待、不启动替身。

实际检查：

| 检查 | 当前结果 |
|---|---|
| admin Evidence/导航与 runner 原 SQLite 绑定定向检查 | 14/14，0 fail、0 skip；日志 `.cache/admin-navigation-focused.log` |
| Desktop 原 `typecheck`（变更 view、renderer 等原语法脚本）及 smoke/runner 语法 | exit 0 |
| `admin-navigation-smoke.cjs` | 原 Competition Main/preload/renderer，独立空 userData，实际导航及确切送达的旧公开快照回归通过 |
| 模型、任务、网络与异常 | Laya 始终 stopped、tasks=0、health=0、external blocked=0、renderer errors=0 |
| 原生 Electron 画面 | Playwright 正常截图并人工回看连接页 Laya 控件和环境页工作区控件；无隐藏点击 |

Browser plugin 不在当前可用能力中，回归使用仓库已有 Playwright 与受信 Electron。
轻量回归收据和正确截图保留于本机专属临时目录 `pa-admin-navigation-lCesn6`，
项目运行入口和回执路径在 `.cache/admin-navigation-smoke.log`；旧公开快照倒序是显式 synthetic ordering case，
不冒充真实 AgentArts/Laya 推理。主控新增的 Main `environment` IPC allowlist 不在本工作树编辑范围；
根集成后需运行同一脚本的 `--require-environment-ipc`，核对原 host page/revision 确实变化。
当前仍未进行新真实鹈鹕聚合运行，完整必验项继续等待主控的新唯一 fixture，不重放任何旧未决任务。

### 原 start 提问失效与私有诊断

主控整合导航修复及 `environment` 原 IPC 后，独立空配置导航回归
`pa-admin-navigation-Y3Ufl9` 的 `--require-environment-ipc` 已通过（主控执行）。
随后公开运行 `desktop-pelican-default-b14XGw` 的 Laya 实际 ready，耗时 52,656ms，
启动前/后可用内存分别为 2,484,318,208 / 877,944,832 bytes；默认父任务
`0f5186c6-d99c-4ceb-ab8c-0d97dd224439` 最终 succeeded，但原子任务
`0efabfe0-35a3-4ce5-b88d-76232a8de95a` failed，验收器正确拒绝通过。

仅只读检查该明确公开 fixture 的 `runtime.sqlite`：start 原审批在
`05:45:29.319Z` 创建，`05:45:29.369Z` 被系统以 stale 撤销；原 invocation、参数摘要、期限及
question binding anchor 已存，而 durable questions 数组为空。F15 sequence/advance 为 0、没有 host task，
没有 N01 typed 诊断或文件写入。失效范围收敛在原卡持久化之前，但原抛错未保留，
不能确定是校验、卡不可用、策略或资源 current 检查中的哪一项；不能倒推 Laya 原因。

新增原 start 调用的私有 `coding-repair:start-failure:v1:<runId>`，仅保留固定 code/reason 及
task/run/工具版本/参数摘要/期限；workspace current 拒绝同样保存首个固定原因和资源摘要，
后续取消不会覆盖最初失效。自由错误文本、源文件、账号与绝对路径不进入诊断，诊断不授予权限或出机许可。
runner 本地读回将诊断重新与原 invocation 核对，不向工作流模型发送。

原默认父子→user-work→F15 start→真实 Runtime/Policy/SQLite/question host 的公开 Synthetic 回归能够正常发布原卡；
卡前撤销资源版本的反例正确拒绝、零执行且记录 `question_current_changed` 与 `resource_generation_changed`。
该反例证明诊断可定位这类失效，不代表旧真实运行必由资源版本变化触发。
必要 Runtime TypeScript 构建通过；diagnostics、decision、workspace host 与 runner 四个定向文件
83/83、0 fail、0 skip，原日志 `.cache/pelican-start-diagnostics-focused.log`；语法及差异检查通过。
本增量没有启动真实服务、重放旧任务或修改全局授权 guard。下一轮仍须新唯一公开 fixture 完成全部原必验项。

### 原 F15 三组任务授权

在统一授权宿主的内部 taskConsent 端口上，默认原 F15 分为三组：初始化隔离区、选定源码只读检查及必要公开出机；
隔离副本编辑和固定检查；原 CAS 交付。三组均使用 workspace-write，第二组首次提问前要求原 Windows helper 验证，
并将同一 verified native binding 带到后续固定检查。首卡说明覆盖动作，后续原 host task 派生复用，
不再为同组每个读取、投影或节点单独弹卡。原 Policy 每个 run 仍产生并消费独立的精确一次性 grant。

分组只接受可信原 worker capability、原 pending/revision、graph/image 与互反 host operation 映射；
digest 绑定原 owner、初始 run、控制版本、原目标和源范围、期限、配置/资源版本、模型 destination 以及该组固定 descriptor/投影全集。
旧非默认 F15 缺少该绑定时保持原逐次授权，不能靠 conversation、session 或工具名认领分组。
源范围、配置、目标或映射变化会重新提问或拒绝；原 args、receipt、公开源码精确内容和 CAS 版本检查保持有效。
分组不携带 live 源文件 SHA 作为权限来源；原隔离基线和原 CAS 继续核对具体字节版本。

实际定向回归使用真实 Runtime、Policy 与 question host，native 身份为显式 Synthetic，未启动命令、模型或修改源码：
七个原 run（含 native 就绪前后的重复读取）只显示三卡，native required 为 false/true/false；
七个独立 grant 均仅消费一次。参数替换、越界 path、替换原 request、错误互反映射及原 graph 控制版本变化均拒绝。
原默认父子 start 正例、卡前资源撤销反例和分组回归 3/3、0 fail、0 skip，日志 `.cache/pelican-task-consent-targeted.log`。
runner 原 SQLite 绑定及原卡实际动作回归 2/2、0 fail、0 skip；仅当原 pending 同时给出
canReuseTask=true 和 suggestedDecision=allow_task 时选择该动作，否则选择 allow_once，重新核对后记录实际决定。
真实 workflow 模式遇到第四张核心卡会在点击前失败。四文件现有全集 85/85、0 fail、0 skip，
日志 `.cache/pelican-task-consent-focused.log`；上述最终增强分组边界另以 3/3 定向回归复核。语法和差异检查通过。

该分组实现与离线回归不证明旧 b14XGw 的具体失效原因已修复，也不构成新真实鹈鹕通过。
下一轮必须从新唯一公开 fixture 发起原默认父子任务，以新私有诊断定位任何卡前失效，并完成六节点、真实 npm-test、
CAS SHA 读回、仅三源文件及 Chromium 两帧车轮/脚踏运动的原必验项。

## 证据边界

默认 Desktop 公开文件修复通过，也只证明当前配置下该 fixture 的父子任务与本地工具闭环；不自动证明 F15 `workflow-advance` 六节点整图、平台 Trace API 逐条对账、物理语音/审批、任意项目自主编码或其余工作流通过。邮件/天气触发器的本地持久去重与 Laya 决策测试，也不自动证明所有连接器能实时推送或已完成真实账号持续接收。
