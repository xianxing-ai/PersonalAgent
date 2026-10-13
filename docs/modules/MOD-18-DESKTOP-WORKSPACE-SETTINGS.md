# MOD-18 Desktop 编程工作区设置

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人：zemeng；待非作者评审，尚未真实联合验收。
- 工作树：`mvp-assembly`，分支：`codex/mvp-assembly`。
- 范围：Desktop 可信组合与设置。复用 coding-tools，不修改公共 Schema 或业务连接器。

设置中的 Worktrees / 环境页面提供系统目录选择器，并分别声明工具结果发送 AgentArts、写入和受限命令许可。目录使用 Electron safeStorage 加密保存；许可仅在本次应用进程有效。新目录需重启装配，重启后重新授权。Renderer 只收到目录简称和能力状态。

可信宿主注册读取、枚举、预览、候选、条件应用补丁，以及固定的 Git 差异检查命令。应用补丁复用独占句柄、恢复目录 ACL 和原 SHA 校验；不可用时准确显示。命令不是通用终端或 OS 沙箱。移除早期 4 KB 限制，复用 coding-tools 默认 256 KiB 读取和既有预览限额；补丁只修改已有文件，命令运行固定 `git diff --check` 参数。工具执行继续经过 Runtime、Policy、ToolGateway。

普通产品启动不再自动公布固定会议夹具为编程能力。历史夹具验收需显式设置 `PA_DESKTOP_SYNTHETIC_FACT_SOURCE=1`。云端续答取消额外的 8 KiB 演示上限，统一使用既有 CoordinationContinuation 的 1 MiB JSON 边界；这不是外部模型上下文容量保证。Desktop 采用已有文字工具流程的八轮预算并在任务创建时持久绑定；审批恢复不会重置预算，历史任务保持四轮。

工作区许可绑定任务 checkpoint 和本次许可代次。撤销会取消本宿主在途调用并禁止后续执行、结果发送；重新授权不复活旧任务。已经发生的文件写入不会因撤销自动回滚，结果未知应通过既有恢复证据核实。

必要验证：专属宿主测试 1/1 通过，覆盖目录配置、进程重建后不继承许可、绑定读取、撤销及旧任务不能使用新许可；相关 JS 语法和差异检查通过。用实际设置组件及合成状态检查了浏览器布局。本轮未执行真实项目补丁、命令、Electron 或 AgentArts 联合验收，不据此宣布 MOD-18 或 MVP 完成。

## 原输入框的固定 Node 提案消费（2026-10-07 续接）

新增独立消费者证据沿现有 PR #302 交付，没有修改源码或重跑旧正式套件。
原 Worktrees 表单只开启工具结果出云及受限命令许可，写入与项目代码许可保持关闭；
原 panel 输入框提交两个任务，经实际 AgentArts Runtime factory/HTTP adapter 的
显式 Fake JSON 工具提案，再由实际 Runtime/Policy/ToolGateway 调用固定
`workspace.node_check`、真实 Node24.15.0 `--check`。没有诊断 HostTool 提交，
也没有 Fake 审批决定；原 main 的受控 routine policy 消耗真实任务/参数绑定单次 grant，
每个调用之后 usesRemaining 为0。

错误语法真实 exit1/passedfalse，正确语法 exit0/passedtrue；两任务的已确认命令结果
均可令编排任务 succeeded，界面仍分别显示“语法检查未通过”与“通过”，不混淆二者。
源文件的顶层写文件 canary 没有执行。Fake 云续发仅收到 recipeId/exitCode/passed，
没有 stdout/stderr、工作区或源路径。最终两次原提交、两次真实 Node、四次 Fake HTTP，
原 panel/CSP exit0、console/pageerror为零，撤销后 Node 不可用。

另一次独立失败路径在真实 Node 已 confirmed 后，显式延后续发前的第二次 Fake
credential read，再通过原 Worktrees 控件撤销许可。实际第二次出云门禁拒绝续发，
保留本地 confirmed record/Evidence、已消耗 grant 与 export-withheld；任务为
waiting_reconciliation/UNAUTHORIZED，原 panel 显示待核实并保留新草稿。
实际 Node1、HTTP仅initial1、credential read2；再消费三轮事件没有重做命令或续发。
撤销禁止未来动作与输出，未把已发生操作抹去或自动重试。

两项最终进程分别实际 exit0；Desktop main固定 blob
`741f8f42595baf2ddc3d697203bc5e3ea63e258d`，所用六个公开编译出口在各次前后相同，
root的主动expiry producer差异不参与此流程。私有工件位于 Desktop 工作树的
`workspace-node-proposal-*`，包括完整命令、JSON、原截图、失败 helper尝试及撤销原始
描述误写twice的保留文件/另份明确once纠正记录；没有将这些错误尝试记为最终通过。
HTTP/凭据端口、IPC/windows/safeStorage为明确Fake；没有真实云调用、原生function
calling、Electron/Windows加密或进程宿主、真实用户项目验收，不据此完成整个MOD-18。

执行前撤销的独立对照同样实际 exit0：原输入框已发 initial Fake HTTP并公布合法
node_check catalog，显式延后其合法提案回执；原控件撤销后放行，实际工具可用性复核
拒绝首次执行，任务为 failed/UNSUPPORTED_CAPABILITY。原 panel显示失败与权威错误、
发送可用且新草稿保留，console0；Node/执行记录/grant/续发均为0，initial HTTP1，
再消费三轮事件没有重试。证据 `workspace-node-proposal-before-revoke-consumer-*`；
权威错误仍为英文，此项不声称完成中文本地化，也不把前置拒绝写成已有操作待核实。

原 composer 的两项独立拒绝消费者进一步核对合法 catalog 后的参数和目标变化，
没有源码修改或重复正式测试。实际 node_check 输入Schema为空对象且
additionalProperties:false；Fake 外部提案额外带 file/argv，真实公开校验在首次执行和
grant前拒绝 INVALID_ARGUMENT，许可和节点可用性仍true。另一合法空参数提案在回执
延后期间，仅把新私有cache固定目标替换为指向外部fixture的symlink；当前云/命令许可
仍true，实际 WorkspaceConfigHost/recipe target复核不可用，放行后拒绝
UNSUPPORTED_CAPABILITY。它限制canonical普通文件，不把源内容固定为不可修改；
前述真实bad→good普通编辑仍允许。不触碰用户项目、Node安装、Windows junction或ACL。

两项进程分别实际exit0，Node/执行记录/grant/续发/canary均0，源或外部fixture SHA保持；
原panel保留新草稿并显示权威失败，console/pageerror零，后续公开事件消费无重试。
私 workspace-node-proposal-expanded-args-consumer-* 与 target-pin-consumer-* 保存完整
命令/JSON/日志/截图，七个相关公开编译出口每项前后相同。日志比保存JSON的旁观
clientCalls各多一次末尾定时订阅，源于await writeFile前后活体数组序列化，原件保留，
不据此声称所有旁观计数原子一致。实际Runtime/Policy/ToolGateway与明确Fake
HTTP/JSON提案/凭据/IPC边界不变，均不替代真实云native function calling或设备验收。

## 原工作区候选、取消与公开读取的消费者（2026-10-07 续接）

新增原composer消费者均实际exit0，使用新合成cache项目、原panel/Worktrees/main函数和
公开Runtime/Policy/ToolGateway，不修改产品源码。main固定741f8f4；每项列明的编译出口
before/after相同，不据此推断整个source/dist一致。HTTP文字JSON提案、凭据、原生窗口、
IPC和确认dialog均为明确Fake，不是AgentArts原生function calling或Windows验收。

运行中Node取消：真实固定Node24 --check已spawn，探针仅对其新私有PID实施显式Fake
OS调度SIGSTOP并核对/proc身份。原stop经过真实task.cancel和native abort，SIGKILL/close
及PID消失确认回收；不证明语法检查完成。原local_write描述未变，因此执行记录仍是
unknown/RESULT_UNKNOWN，任务waiting_reconciliation并保留cancelRequested，单次grant
已消费为0；进程死亡不等于确认结果或任务终态。原界面待核实、草稿保留，三次后续pump
无命令重做或续发，清理后readonly SQLite确认没有第二次事件。证据
workspace-node-running-cancel-consumer-*及post-finally-readback.json；不推广Windows进程语义。

Preview/Stage：原cloud+write许可经两次真实参数绑定grant，preview与stage各confirmed。
实际stage创建64B候选，SHA0fdc8b14bd648e277a54f7f73c09048aca0be6e4c40734b74331598750f19c13，
原文件字节不变；仅既有previewed/staged/changed布尔投影出云。任务成功表示候选流程完成。
PowerShell/native apply不可用，实际catalog无apply，未注入替代提供者。合法stage提案等待时
外改合成文件，真实provider在创建前REVISION_CONFLICT，既有写工具保守记录unknown，
无候选、外改内容保留；只读许可则stage缺catalog，执行/grant前拒绝UNSUPPORTED_CAPABILITY。
三项后续pump均无重做，分别保存workspace-patch-stage-composer/boundary-consumer-*。

PUBLIC读取：原main的NativePublicReferenceConsent/WorkspaceReferenceExport先确认1024B
范围，再确认真实read_text返回的76B CRLF文本与精确SHA，两阶段身份/期限一致。
正常一次confirmed读取，消费workspace:read grant，仅6个公开结果字段经
workspace-reference-3.0.0发送；无路径、authorizationId或合成private remainder。
前置拒绝没有读取/grant；精确确认拒绝保留已confirmed读取和原tool-result，任务
waiting_reconciliation/UNAUTHORIZED，无continuation，不重读。许可投影已保存后，在第二次
异步Fake凭据返回前原Worktrees撤销，最终beforeSend拒绝发送，保留receipt/continuation及
export-withheld；撤销清宿主许可并旋转generation，不逆转已消费数据库grant。
两阶段dialog各自在pending时由原stop取消的独立对照均到cancelled；精确阶段保留confirmed
只读结果，迟到确认不成为新authorization或续发。证据workspace-reference-read-composer、
final-guard和dialog-cancel-consumer-*，独立审查读回SQLite/原文件/截图。只读取消结论
不能套到写入，PUBLIC验收不等于真实云、用户工作区或完整ArtifactPort验收。

原插件设置的另一个独立消费者实际exit0：通过原连接按钮启动已有官方filesystem
2026.8.31/SDK1.31.0的固定stdio服务，发现14个工具，仅暴露批准的mcp.workspace.read_text。
原启用摘要/run按钮调用既有worker-level Skill，经真实Runtime/Policy读取同76B CRLF
合成参考文件一次，confirmed、单次grant消费为0，原panel显示确定性摘录和本地SHA。
这条native摘要不调用模型或云，HTTP/凭据读取均0，不等于云端选择Skill或PUBLIC出机。
原stop按钮等待dispose后，服务unavailable、Skill disabled、run禁用且不重读；未独立观察
PID/reap，不推广OS进程树验收。desktop-reference-ui-native-summary-consumer-*保存命令、
JSON/日志/三张原admin/panel截图；四次helper失败留存，最终完整消费者才计通过。

该真实消费者还复现原控件的独立可用性缺口：受理IPC回执延后时，ready状态刷新会
提前启用run；停止服务后迟到回执的finally又会无条件启用。原host拒绝误点，实际任务/
读取仍各1，不是授权突破。控件按action保留pending，render/finally共同依据当前snapshot
同步按钮，拒绝disabled/重复pending点击；失败恢复可用动作，卸载后不处理迟到回执。
只改reference-tools-controls.js与其行为回归测试，不改main/MCP/Runtime/CSS/协议。
新两项测试在原不可变源码实际2fail，修复后2/2exit0；原stdio/UI AFTER pending仍disabled，
stop后晚回执仍disabled且误点不派发，重新连接/启用可正常提交第二个独立任务，真实
读取/confirmed grant分别各一次，旧任务不重复，cloud0/凭据0/errors0。私
desktop-reference-run-late-receipt-before/after/fixed-*保存原失败、JSON/日志和截图；
source固定d3152570a9e063c3e885220f11be23e92a7893ed，test固定
1870bcc2b0608d8a8038c1bd16c3e28586d6d4c2，必要整仓检查另在root新固定head执行。

原320插件页的路径input还有实际布局缺口：宽210/right377超过viewport320与卡片right290，
main可用202而scroll259；该完整before实际exit1保留。仅在原pathlabel外加普通
div.settings-form，复用已有label grid与无type input的width100%/border-box，不新增form
提交、共享CSS或事件。最终controls blob de96171eeda20d3c094d7305fb9f0930ec13269f。
修后320原连接/启用/输入/摘要/stop完整消费者实际exit0，三个阶段input104/right271在
卡片/viewport内，main202=scroll202；原read/confirmed/任务成功各一次，grant0、cloud0、
credentials0/errors0。420仅同页便宜几何核对，未重复已绿任务流程。原纵向滚动保留，
不称首屏全部可见；证据desktop-reference-narrow-{before,after}-consumer-*及fixed-validation。

另一个原Worktrees撤销消费者使用实际官方stdio/Runtime/Policy/SQLite，并明确Fake调度
hold已返回的76B原文在RegisteredTool→Gateway确认前。原record仍started、task running、
grant0。原撤销先await referenceHost.invalidate/dispose并请求任务取消，再清workspace许可；
放行后record failed/CANCELLED、task cancelled9，不成为confirmed或重读。
Skill checkpoint却为unknown/evidenceRefs空，不能把Task终态推广到所有层级。后续pump
无第二record、cloud0/credentials0，10个具体compiled出口前后稳定，不证明整构建或PIDreap。
证据desktop-reference-workspace-revoke-consumer-*；首helper把started误写running的exit1
保留，最终完整实际exit0，不计首失败为通过。不套用到写工具或真实用户项目。

原参考摘要无效路径消费者实际exit0：main先受理Skill任务，空path由worker校验FAILED/
INVALID_ARGUMENT、0toolrecord；../outside合成canary由真实服务拒绝，Task FAILED且
record FAILED/INVALID_ARGUMENT，已executionStarted/Policy allow/单次read grant消费0。
没有confirmed读取或canary正文；Skill checkpoint仍unknown/refs空，read-step快照running，
不称IPC拒绝、0task/0尝试或所有层终态。两失败不自动重试，用户明确改reference.md才
新建第三Task，真实76B CRLF读取confirmed/Task成功/Skill complete，cloud0/credentials0。
原UI保无效输入、支持明确重试；停止后run disabled。证据desktop-reference-invalid-path-
consumer-*，十个具体compiled出口稳定；仅body横向范围通过，不覆盖前述Live内部4px失败。

## 摘要启用按钮与连接状态（2026-10-07 续接）

原服务未连接、Skill 未启用时，启用按钮仍可点击，原 host 拒绝后只显示通用错误；
实际 task/read/服务/云凭据均0。控件仅增加连接谓词：未启用的 Skill 必须在
`mcp.connected === true` 时才可启用；已启用的 Skill 仍可在断开时关闭，原 pending、
重复点击、迟到回执与卸载保护保持。controls/test EXACT2，不修改 host/协议/CSS。
原 UI BEFORE actual1、AFTER actual0，断开点击和 dispatch guard 都不派发 IPC；新增两项
正式测试在原源码2fail，修后本文件定向4/4。连接/停止状态仅复用旧实际 stdio 快照做
FakeIPC renderer 对照，不重复或冒称新 stdio 验收。冻结 manifest SHA256
2f8202c4df6dfddc7ec9c4397fd25316ef5fcb6f940f77689d17c22fee839fe0。

根固定 dcfcf6bc/tree6f0edd11，将此变更与保存 Goal 卡片恢复一起执行原 Desktop typecheck、
两处 JS syntax 和完整 workspace test；18527/1470c2 实际 exit0，23:28:25Z：612项601通过、
失败/取消0、11跳过。日志 core-desktop-saved-cards-skill137-check.log SHA256
3afda5190a65e169d20caa13ed2df6e0830c38035e09b67c8526ebebe67c20bc，独立全文读回及源码一致。
中断的旧 overlay94070/4c6f19 actual1 仅留历史，不计通过；本节不是整仓、Windows 或真实设备验收。

## 服务停止回执 pending 时的摘要可用性（2026-10-08 续接）

原实际官方stdio服务已经完全disposed，Host disconnected/Skill disabled，而明确Fake
wrapper持住stop回执，UI尚显示旧ready时仍可点击run；Host拒绝一次IPC，Task/read/grant/
云凭据均0。只给run门禁增加pending mcp或skill；原连接/启用谓词、失败恢复、late/
卸载保护保持。已启用Skill仍能停用，run pending也不能阻止用户stop，不改Host/main/
Runtime/CSS。EXACT2 source6ddef98f/test955db9ce，冻结22artifact manifest SHA256
cc4c0651770f707f1b66e0ad8cdbc4caf6665602ae548ece783505012c4e95df。

原正式行为before33a541为4pass2fail，修后90a684为6/6 actual0。原消费者before
52300/194609 actual1保持；after60342/17e63d actual0，真实服务closed/stop回执held时
run disabled，native click及dispatched click都0run IPC；held期间已启用Skill仍可停用，
release后run仍disabled。
SQLite readonly task/toolrecord/grant均0，main DB字节不变；十个具体compiled出口稳定，
不称全build或PID/真实设备验收。最初loader/cleanup错误只保留历史。源码与完整消费者/
四截图、原失败及22hash独立只读核对；根在全仓d3cb结束后整合，本增量另作固定HEAD
必要Desktop检查，不挪用d3cb完整绿结果。

固定f04f3fcacf55a1e53aed5c87b2543026b23b3cf6、tree
e4277e65d1ae78f506c0f3905172101baa473cd5，原Desktop typecheck、control syntax及完整
workspace test 38391/bb0bbf actual0，00:23:05.521Z完成：628项、617通过、0失败/取消、
11跳过；三phase均0，原断言期限不改、Node24.15/4CPU。log62076B SHA256
ceb2124c02dd62e1b3e07a56e545f39a858585136aa0e782b5ea434ae7e38625。
d3cb至此只有这两源文件与两自有DOC变更；本节增量与d3cb完整2497项分别记载。
